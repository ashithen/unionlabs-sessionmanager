'use strict';

const fs = require('fs');
const { Client } = require('ssh2');
const config = require('../config');
const logger = require('../utils/logger');
const { TunnelError } = require('../utils/errors');

class SSHTunnelService {
  constructor() {

    this.activeTunnels = new Map();

    this.simulationMode = !!(config.ssh && config.ssh.simulationMode);

    if (this.simulationMode) {
      logger.info('SSHTunnelService initialized in SIMULATION mode — SSH calls will be mocked');
    } else {
      logger.info('SSHTunnelService initialized');
    }
  }

  async createTunnel(tunnelId, tunnelConfig) {
    logger.info('Creating SSH tunnel', {
      tunnelId,
      host: tunnelConfig.host,
      remotePort: tunnelConfig.remotePort,
      localPort: tunnelConfig.localPort,
    });

    if (this.activeTunnels.has(tunnelId)) {
      logger.warn('Tunnel already exists, closing existing one first', { tunnelId });
      await this.closeTunnel(tunnelId);
    }

    if (this.simulationMode) {
      return this._createSimulatedTunnel(tunnelId, tunnelConfig);
    }

    return this._createRealTunnel(tunnelId, tunnelConfig);
  }

  async _createRealTunnel(tunnelId, tunnelConfig) {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const connectionTimeout = setTimeout(() => {
        client.end();
        reject(new TunnelError(
          `SSH tunnel connection timed out for tunnel ${tunnelId}`,
          { tunnelId, host: tunnelConfig.host }
        ));
      }, 30000);

      let privateKey;
      try {
        const keyPath = tunnelConfig.privateKeyPath ||
          (config.ssh && config.ssh.defaultKeyPath);
        if (tunnelConfig.privateKey) {
          privateKey = tunnelConfig.privateKey;
        } else if (keyPath) {
          privateKey = fs.readFileSync(keyPath, 'utf8');
        }
      } catch (err) {
        clearTimeout(connectionTimeout);
        throw new TunnelError(
          `Failed to read SSH private key for tunnel ${tunnelId}: ${err.message}`,
          { tunnelId, cause: err }
        );
      }

      const connectConfig = {
        host: tunnelConfig.host,
        port: tunnelConfig.port || 22,
        username: tunnelConfig.username,
        privateKey,
        readyTimeout: 20000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      client.on('ready', () => {
        clearTimeout(connectionTimeout);
        logger.info('SSH connection established', { tunnelId, host: tunnelConfig.host });

        client.forwardIn('0.0.0.0', tunnelConfig.remotePort, (err) => {
          if (err) {
            logger.error('Failed to set up port forwarding', {
              tunnelId,
              error: err.message,
            });
            client.end();
            reject(new TunnelError(
              `Failed to forward port for tunnel ${tunnelId}: ${err.message}`,
              { tunnelId, cause: err }
            ));
            return;
          }

          const tunnelEntry = {
            client,
            config: tunnelConfig,
            createdAt: new Date(),
            status: 'connected',
          };

          this.activeTunnels.set(tunnelId, tunnelEntry);

          logger.info('SSH tunnel established with port forwarding', {
            tunnelId,
            host: tunnelConfig.host,
            remotePort: tunnelConfig.remotePort,
            localPort: tunnelConfig.localPort,
          });

          resolve(this._toTunnelInfo(tunnelId, tunnelEntry));
        });
      });

      client.on('error', (err) => {
        clearTimeout(connectionTimeout);
        logger.error('SSH tunnel connection error', {
          tunnelId,
          error: err.message,
        });

        const existing = this.activeTunnels.get(tunnelId);
        if (existing) {
          existing.status = 'disconnected';
        }

        reject(new TunnelError(
          `SSH tunnel error for tunnel ${tunnelId}: ${err.message}`,
          { tunnelId, cause: err }
        ));
      });

      client.on('close', () => {
        logger.info('SSH tunnel connection closed', { tunnelId });
        const existing = this.activeTunnels.get(tunnelId);
        if (existing) {
          existing.status = 'disconnected';
        }
      });

      client.on('end', () => {
        logger.debug('SSH tunnel stream ended', { tunnelId });
      });

      try {
        client.connect(connectConfig);
      } catch (err) {
        clearTimeout(connectionTimeout);
        reject(new TunnelError(
          `Failed to initiate SSH connection for tunnel ${tunnelId}: ${err.message}`,
          { tunnelId, cause: err }
        ));
      }
    });
  }

  async _createSimulatedTunnel(tunnelId, tunnelConfig) {
    logger.info('[SIMULATION] Creating simulated SSH tunnel', {
      tunnelId,
      host: tunnelConfig.host,
      remotePort: tunnelConfig.remotePort,
      localPort: tunnelConfig.localPort,
    });

    const tunnelEntry = {
      client: null,
      config: tunnelConfig,
      createdAt: new Date(),
      status: 'connected',
    };

    this.activeTunnels.set(tunnelId, tunnelEntry);

    logger.info('[SIMULATION] Simulated SSH tunnel created', { tunnelId });
    return this._toTunnelInfo(tunnelId, tunnelEntry);
  }

  async closeTunnel(tunnelId) {
    logger.info('Closing SSH tunnel', { tunnelId });

    const tunnel = this.activeTunnels.get(tunnelId);
    if (!tunnel) {
      logger.warn('Tunnel not found (already closed?)', { tunnelId });
      return;
    }

    try {
      if (tunnel.client && tunnel.status === 'connected') {

        await new Promise((resolve) => {
          tunnel.client.unforwardIn('0.0.0.0', tunnel.config.remotePort, (err) => {
            if (err) {
              logger.debug('Error cancelling port forwarding (non-fatal)', {
                tunnelId,
                error: err.message,
              });
            }
            resolve();
          });
        });

        tunnel.client.end();
      }

      this.activeTunnels.delete(tunnelId);
      logger.info('SSH tunnel closed successfully', { tunnelId });
    } catch (err) {

      this.activeTunnels.delete(tunnelId);
      logger.error('Error closing SSH tunnel', {
        tunnelId,
        error: err.message,
      });
      throw new TunnelError(
        `Error closing tunnel ${tunnelId}: ${err.message}`,
        { tunnelId, cause: err }
      );
    }
  }

  checkHealth(tunnelId) {
    const tunnel = this.activeTunnels.get(tunnelId);
    if (!tunnel) {
      logger.debug('Health check: tunnel not found', { tunnelId });
      return false;
    }

    if (this.simulationMode) {
      return tunnel.status === 'connected';
    }

    const isAlive = tunnel.client !== null &&
      tunnel.status === 'connected' &&
      tunnel.client._sock &&
      !tunnel.client._sock.destroyed;

    logger.debug('Tunnel health check', { tunnelId, isAlive });
    return isAlive;
  }

  async closeAll() {
    const tunnelIds = Array.from(this.activeTunnels.keys());
    logger.info('Closing all SSH tunnels', { count: tunnelIds.length });

    const results = await Promise.allSettled(
      tunnelIds.map((id) => this.closeTunnel(id))
    );

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      logger.warn('Some tunnels failed to close during shutdown', {
        total: tunnelIds.length,
        failed: failures.length,
      });
    }

    logger.info('All SSH tunnels closed', { total: tunnelIds.length });
  }

  getActiveTunnels() {
    const tunnels = [];
    for (const [id, entry] of this.activeTunnels.entries()) {
      tunnels.push(this._toTunnelInfo(id, entry));
    }
    return tunnels;
  }

  _toTunnelInfo(id, entry) {
    return {
      id,
      host: entry.config.host,
      remotePort: entry.config.remotePort,
      localPort: entry.config.localPort,
      status: entry.status,
      createdAt: entry.createdAt,
    };
  }
}

module.exports = SSHTunnelService;
