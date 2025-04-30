const SessionManager = require('../../src/services/sessionManager');
const { SessionNotFoundError, ProvisioningError } = require('../../src/utils/errors');

describe('SessionManager Service', () => {
  let sessionManager;
  let mockDockerService;
  let mockSshTunnelService;
  let mockVncProxyService;
  let mockSchedulerService;
  let mockCleanupService;
  let mockPortAllocator;
  let mockSessionModel;
  let mockTestbedModel;
  let mockIo;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDockerService = {
      pullImage: jest.fn().mockResolvedValue(),
      createContainer: jest.fn().mockResolvedValue({ id: 'container-123' }),
      startContainer: jest.fn().mockResolvedValue(),
      waitForReady: jest.fn().mockResolvedValue({
        ports: { '5901/tcp': [{ HostPort: '5901' }] }
      })
    };

    mockSshTunnelService = {
      createTunnel: jest.fn().mockResolvedValue({ id: 'tunnel-123' }),
      closeTunnel: jest.fn().mockResolvedValue()
    };

    mockVncProxyService = {
      createProxyToken: jest.fn().mockReturnValue({ token: 'token-abc', url: '/vnc.html?token=token-abc' }),
      removeProxyToken: jest.fn()
    };

    mockSchedulerService = {
      scheduleSession: jest.fn(),
      cancelSchedule: jest.fn()
    };

    mockCleanupService = {
      cleanupSession: jest.fn().mockResolvedValue({ success: true, errors: [] })
    };

    mockPortAllocator = {
      allocatePort: jest.fn().mockReturnValue(5901),
      releasePort: jest.fn()
    };

    mockSessionModel = {
      create: jest.fn().mockImplementation((data) => ({
        id: 'session-123',
        status: 'PENDING',
        ...data
      })),
      findById: jest.fn().mockResolvedValue({
        id: 'session-123',
        testbedId: 'next-ub',
        userId: 'user-456',
        status: 'PENDING',
        image: 'unionlabs/session:latest'
      }),
      updateStatus: jest.fn().mockResolvedValue()
    };

    mockTestbedModel = {
      findById: jest.fn().mockResolvedValue({
        id: 'next-ub',
        name: 'UB NeXT',
        image: 'unionlabs/session:latest',
        remoteHost: null
      })
    };

    mockIo = {
      emit: jest.fn()
    };

    sessionManager = new SessionManager({
      dockerService: mockDockerService,
      sshTunnelService: mockSshTunnelService,
      vncProxyService: mockVncProxyService,
      schedulerService: mockSchedulerService,
      cleanupService: mockCleanupService,
      portAllocator: mockPortAllocator,
      Session: mockSessionModel,
      Testbed: mockTestbedModel
    });

    sessionManager.setSocketIO(mockIo);
  });

  test('should create session record and start provisioning if scheduled for now', async () => {
    const session = await sessionManager.createSession('next-ub', 'user-456', {
      duration: 60
    });

    expect(mockTestbedModel.findById).toHaveBeenCalledWith('next-ub');
    expect(mockSessionModel.create).toHaveBeenCalled();
    expect(session.id).toBe('session-123');
    expect(session.status).toBe('PENDING');

    expect(mockIo.emit).toHaveBeenCalledWith('session:status', expect.objectContaining({
      sessionId: 'session-123',
      status: 'PENDING'
    }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockDockerService.createContainer).toHaveBeenCalled();
  });

  test('should schedule session for later if startTime is in the future', async () => {
    const futureTime = new Date(Date.now() + 100000);

    await sessionManager.createSession('next-ub', 'user-456', {
      startTime: futureTime,
      duration: 60
    });

    expect(mockSchedulerService.scheduleSession).toHaveBeenCalledWith('session-123', expect.any(Date), expect.any(Date));
    expect(mockDockerService.createContainer).not.toHaveBeenCalled();
  });

  test('should provision session successfully (happy path)', async () => {
    const result = await sessionManager.provisionSession('session-123');

    expect(mockSessionModel.updateStatus).toHaveBeenCalledWith('session-123', 'PROVISIONING');
    expect(mockPortAllocator.allocatePort).toHaveBeenCalled();
    expect(mockDockerService.createContainer).toHaveBeenCalled();
    expect(mockDockerService.startContainer).toHaveBeenCalled();
    expect(mockDockerService.waitForReady).toHaveBeenCalled();
    expect(mockVncProxyService.createProxyToken).toHaveBeenCalled();

    expect(mockSessionModel.updateStatus).toHaveBeenCalledWith('session-123', 'READY', expect.objectContaining({
      containerId: 'container-123',
      vncPort: 5901,
      vncUrl: '/vnc.html?token=token-abc'
    }));
  });

  test('should provision session with SSH tunnel if remote testbed', async () => {
    mockTestbedModel.findById.mockResolvedValue({
      id: 'iot-uou',
      name: 'IoT (UoU)',
      image: 'unionlabs/session:latest',
      remoteHost: 'remote.testbed.org',
      sshPort: 22,
      sshUsername: 'tunneluser'
    });

    await sessionManager.provisionSession('session-123');

    expect(mockSshTunnelService.createTunnel).toHaveBeenCalledWith('session-123', expect.objectContaining({
      host: 'remote.testbed.org',
      localPort: 5901
    }));
  });

  test('should handle provisioning failures by updating status to FAILED and triggering partial cleanup', async () => {
    mockDockerService.createContainer.mockRejectedValue(new Error('Docker engine out of memory'));

    await expect(
      sessionManager.provisionSession('session-123')
    ).rejects.toThrow(ProvisioningError);

    expect(mockSessionModel.updateStatus).toHaveBeenCalledWith('session-123', 'FAILED', expect.any(Object));
    expect(mockPortAllocator.releasePort).toHaveBeenCalled();
    expect(mockVncProxyService.removeProxyToken).toHaveBeenCalled();
  });

  test('should connect to provisioned session and mark status as ACTIVE', async () => {
    mockSessionModel.findById.mockResolvedValue({
      id: 'session-123',
      status: 'READY',
      vncUrl: '/vnc.html?token=token-abc'
    });

    const session = await sessionManager.connectSession('session-123');

    expect(mockSessionModel.updateStatus).toHaveBeenCalledWith('session-123', 'ACTIVE', expect.any(Object));
    expect(mockIo.emit).toHaveBeenCalledWith('session:status', expect.objectContaining({
      sessionId: 'session-123',
      status: 'ACTIVE'
    }));
  });

  test('should stop session and call cleanup service', async () => {
    mockSessionModel.findById.mockResolvedValue({
      id: 'session-123',
      status: 'ACTIVE'
    });

    await sessionManager.stopSession('session-123');

    expect(mockSessionModel.updateStatus).toHaveBeenCalledWith('session-123', 'CLEANING_UP', expect.any(Object));
    expect(mockSchedulerService.cancelSchedule).toHaveBeenCalledWith('session-123');
    expect(mockCleanupService.cleanupSession).toHaveBeenCalledWith('session-123');
  });
});
