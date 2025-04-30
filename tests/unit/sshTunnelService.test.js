const SSHTunnelService = require('../../src/services/sshTunnelService');
const { TunnelError } = require('../../src/utils/errors');
const config = require('../../src/config');
const fs = require('fs');

jest.mock('ssh2');
const { Client } = require('ssh2');

jest.mock('fs');

describe('SSHTunnelService', () => {
  let sshTunnelService;
  let mockClientInstance;
  let tunnelConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    tunnelConfig = {
      host: 'testbed-node.local',
      port: 22,
      username: 'tunneluser',
      privateKeyPath: '/dummy/key',
      remotePort: 5901,
      localPort: 5902
    };

    mockClientInstance = {
      connect: jest.fn(),
      end: jest.fn(),
      forwardIn: jest.fn(),
      unforwardIn: jest.fn(),
      on: jest.fn()
    };

    Client.mockImplementation(() => mockClientInstance);
  });

  describe('Simulation Mode', () => {
    beforeEach(() => {
      config.ssh.simulationMode = true;
      sshTunnelService = new SSHTunnelService();
    });

    test('should create simulated tunnel', async () => {
      const result = await sshTunnelService.createTunnel('tunnel-123', tunnelConfig);

      expect(result.id).toBe('tunnel-123');
      expect(result.host).toBe(tunnelConfig.host);
      expect(result.status).toBe('connected');
      expect(sshTunnelService.checkHealth('tunnel-123')).toBe(true);
    });

    test('should close simulated tunnel', async () => {
      await sshTunnelService.createTunnel('tunnel-123', tunnelConfig);
      await sshTunnelService.closeTunnel('tunnel-123');

      expect(sshTunnelService.checkHealth('tunnel-123')).toBe(false);
      expect(sshTunnelService.getActiveTunnels()).toHaveLength(0);
    });

    test('should list active simulated tunnels', async () => {
      await sshTunnelService.createTunnel('tunnel-123', tunnelConfig);
      const list = sshTunnelService.getActiveTunnels();

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('tunnel-123');
    });
  });

  describe('Real Connection Mode (Mocked)', () => {
    beforeEach(() => {
      config.ssh.simulationMode = false;
      sshTunnelService = new SSHTunnelService();
      fs.readFileSync.mockReturnValue('dummy-key-content');
    });

    test('should set up event handlers and resolve on successful port forwarding', async () => {

      mockClientInstance.on.mockImplementation((event, handler) => {
        if (event === 'ready') {

          process.nextTick(handler);
        }
        return mockClientInstance;
      });

      mockClientInstance.forwardIn.mockImplementation((bindAddr, port, callback) => {
        process.nextTick(() => callback(null));
      });

      const tunnelPromise = sshTunnelService.createTunnel('real-tunnel', tunnelConfig);

      const result = await tunnelPromise;

      expect(fs.readFileSync).toHaveBeenCalledWith(tunnelConfig.privateKeyPath, 'utf8');
      expect(mockClientInstance.connect).toHaveBeenCalled();
      expect(mockClientInstance.forwardIn).toHaveBeenCalledWith('0.0.0.0', tunnelConfig.remotePort, expect.any(Function));
      expect(result.status).toBe('connected');
    });

    test('should reject on connection error', async () => {
      const err = new Error('SSH connection failed');
      mockClientInstance.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          process.nextTick(() => handler(err));
        }
        return mockClientInstance;
      });

      await expect(
        sshTunnelService.createTunnel('real-tunnel', tunnelConfig)
      ).rejects.toThrow(TunnelError);
    });
  });
});
