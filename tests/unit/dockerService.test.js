const DockerService = require('../../src/services/dockerService');
const { ProvisioningError } = require('../../src/utils/errors');

jest.mock('dockerode');
const Docker = require('dockerode');

describe('DockerService', () => {
  let dockerService;
  let mockContainer;
  let mockDockerInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContainer = {
      id: 'mock-container-id',
      start: jest.fn().mockResolvedValue(),
      stop: jest.fn().mockResolvedValue(),
      remove: jest.fn().mockResolvedValue(),
      inspect: jest.fn().mockResolvedValue({
        Id: 'mock-container-id',
        State: { Status: 'running', Running: true },
        HostConfig: {
          PortBindings: { '5901/tcp': [{ HostPort: '32768' }] }
        },
        NetworkSettings: {
          Ports: { '5901/tcp': [{ HostPort: '32768' }] }
        }
      })
    };

    mockDockerInstance = {
      createContainer: jest.fn().mockResolvedValue(mockContainer),
      getContainer: jest.fn().mockReturnValue(mockContainer),
      pull: jest.fn().mockResolvedValue({}),
      modem: {
        followProgress: jest.fn().mockImplementation((stream, onFinished, onProgress) => {
          onFinished(null, []);
        })
      }
    };

    Docker.mockImplementation(() => mockDockerInstance);
    dockerService = new DockerService();
  });

  test('should create container with correct options', async () => {
    const sessionId = 'session-123';
    const image = 'unionlabs/session:latest';

    const result = await dockerService.createContainer(sessionId, image, {
      env: { CUSTOM_VAR: 'value' },
      volumes: { '/host/path': '/container/path' }
    });

    expect(mockDockerInstance.createContainer).toHaveBeenCalled();
    const createArgs = mockDockerInstance.createContainer.mock.calls[0][0];
    expect(createArgs.Image).toBe(image);
    expect(createArgs.name).toBe(`unionlabs-session-${sessionId}`);
    expect(createArgs.Env).toContain('VNC_PW=unionlabs');
    expect(createArgs.Env).toContain('CUSTOM_VAR=value');
    expect(createArgs.HostConfig.Binds).toContain('/host/path:/container/path');
    expect(result.id).toBe('mock-container-id');
  });

  test('should wrap create container errors in ProvisioningError', async () => {
    mockDockerInstance.createContainer.mockRejectedValue(new Error('Docker daemon error'));

    await expect(
      dockerService.createContainer('session-123', 'image')
    ).rejects.toThrow(ProvisioningError);
  });

  test('should start container successfully', async () => {
    const containerId = 'mock-container-id';
    await dockerService.startContainer(containerId);

    expect(mockDockerInstance.getContainer).toHaveBeenCalledWith(containerId);
    expect(mockContainer.start).toHaveBeenCalled();
  });

  test('should handle already-running containers gracefully when starting', async () => {
    const err = new Error('Already running');
    err.statusCode = 304;
    mockContainer.start.mockRejectedValue(err);

    await expect(dockerService.startContainer('mock-container-id')).resolves.not.toThrow();
  });

  test('should stop container successfully', async () => {
    const containerId = 'mock-container-id';
    await dockerService.stopContainer(containerId);

    expect(mockDockerInstance.getContainer).toHaveBeenCalledWith(containerId);
    expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
  });

  test('should remove container successfully', async () => {
    const containerId = 'mock-container-id';
    await dockerService.removeContainer(containerId, true);

    expect(mockDockerInstance.getContainer).toHaveBeenCalledWith(containerId);
    expect(mockContainer.remove).toHaveBeenCalledWith({ v: true, force: true });
  });

  test('should get container status', async () => {
    const status = await dockerService.getContainerStatus('mock-container-id');

    expect(status.running).toBe(true);
    expect(status.state).toBe('running');
    expect(status.ports['5901/tcp']).toBeDefined();
  });

  test('should pull image and wait for progress', async () => {
    const imageName = 'unionlabs/session:latest';
    await dockerService.pullImage(imageName);

    expect(mockDockerInstance.pull).toHaveBeenCalledWith(imageName);
    expect(mockDockerInstance.modem.followProgress).toHaveBeenCalled();
  });
});
