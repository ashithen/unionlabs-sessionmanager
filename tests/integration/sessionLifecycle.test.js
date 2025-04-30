const { initDatabase, closeDatabase, getDatabase } = require('../../src/models/database');
const Session = require('../../src/models/Session');
const Testbed = require('../../src/models/Testbed');
const SessionManager = require('../../src/services/sessionManager');
const DockerService = require('../../src/services/dockerService');
const SSHTunnelService = require('../../src/services/sshTunnelService');
const VNCProxyService = require('../../src/services/vncProxyService');
const SchedulerService = require('../../src/services/schedulerService');
const CleanupService = require('../../src/services/cleanupService');
const portAllocator = require('../../src/utils/portAllocator');
const path = require('path');

jest.mock('dockerode');
jest.mock('ssh2');

describe('Session Lifecycle End-to-End Integration', () => {
  let sessionManager;
  let dockerService;
  let sshTunnelService;
  let vncProxyService;
  let schedulerService;
  let cleanupService;
  let testbed;

  beforeAll(() => {
    const dbPath = path.join(__dirname, '../../data/test-lifecycle.db');
    initDatabase(dbPath);
  });

  afterAll(() => {
    closeDatabase();
  });

  beforeEach(async () => {

    const db = getDatabase();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM testbeds').run();
    portAllocator.releaseAll();

    dockerService = new DockerService();

    sshTunnelService = new SSHTunnelService();
    sshTunnelService.simulationMode = true;

    vncProxyService = new VNCProxyService();
    schedulerService = new SchedulerService();

    cleanupService = new CleanupService({
      dockerService,
      sshTunnelService,
      vncProxyService,
      portAllocator,
      Session
    });

    sessionManager = new SessionManager({
      dockerService,
      sshTunnelService,
      vncProxyService,
      schedulerService,
      cleanupService,
      portAllocator,
      Session,
      Testbed
    });

    schedulerService.setSessionManager(sessionManager);

    dockerService.docker = {
      createContainer: jest.fn().mockResolvedValue({
        id: 'test-container-id',
        inspect: jest.fn().mockResolvedValue({
          Id: 'test-container-id',
          State: { Status: 'running', Running: true },
          HostConfig: {
            PortBindings: { '5901/tcp': [{ HostPort: '5900' }] }
          },
          NetworkSettings: {
            Ports: { '5901/tcp': [{ HostPort: '5900' }] }
          }
        }),
        start: jest.fn().mockResolvedValue(),
        stop: jest.fn().mockResolvedValue(),
        remove: jest.fn().mockResolvedValue()
      }),
      getContainer: jest.fn().mockImplementation(() => ({
        inspect: jest.fn().mockResolvedValue({
          Id: 'test-container-id',
          State: { Status: 'running', Running: true },
          HostConfig: {
            PortBindings: { '5901/tcp': [{ HostPort: '5900' }] }
          },
          NetworkSettings: {
            Ports: { '5901/tcp': [{ HostPort: '5900' }] }
          }
        }),
        start: jest.fn().mockResolvedValue(),
        stop: jest.fn().mockResolvedValue(),
        remove: jest.fn().mockResolvedValue()
      })),
      pull: jest.fn().mockResolvedValue({}),
      modem: {
        followProgress: jest.fn().mockImplementation((stream, onFinished) => onFinished(null, []))
      }
    };

    testbed = Testbed.create({
      id: 'testbed-1',
      name: 'Testbed One',
      description: 'A mock testbed for lifecycle integration testing',
      experiments: 'Testing',
      dockerImage: 'unionlabs/session:latest',
      sshHost: 'localhost',
      sshPort: 22,
      maxSessions: 2
    });
  });

  test('should execute full session lifecycle: PENDING -> PROVISIONING -> READY -> ACTIVE -> CLEANING_UP -> COMPLETED', async () => {

    const futureTime = new Date(Date.now() + 600000);
    const session = await sessionManager.createSession('testbed-1', 'user-999', {
      startTime: futureTime,
      duration: 30
    });

    expect(session.status).toBe('PENDING');

    let storedSession = Session.findById(session.id);
    expect(storedSession.status).toBe('PENDING');
    expect(storedSession.userId).toBe('user-999');

    const provisionedSession = await sessionManager.provisionSession(session.id);

    expect(provisionedSession.status).toBe('READY');
    expect(provisionedSession.vncPort).toBe(5900);
    expect(provisionedSession.vncUrl).toBeDefined();
    expect(provisionedSession.containerId).toBe('test-container-id');

    storedSession = Session.findById(session.id);
    expect(storedSession.status).toBe('READY');
    expect(storedSession.vncPort).toBe(5900);

    const activeSession = await sessionManager.connectSession(session.id);

    expect(activeSession.status).toBe('ACTIVE');

    storedSession = Session.findById(session.id);
    expect(storedSession.status).toBe('ACTIVE');

    const stopResult = await sessionManager.stopSession(session.id);

    expect(stopResult.success).toBe(true);
    expect(stopResult.errors).toHaveLength(0);

    storedSession = Session.findById(session.id);
    expect(storedSession.status).toBe('COMPLETED');
    expect(storedSession.vncPort).toBeNull();

    expect(portAllocator.getActivePorts()).toHaveLength(0);
  });
});
