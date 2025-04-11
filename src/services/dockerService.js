'use strict';

const Docker = require('dockerode');
const config = require('../config');
const logger = require('../utils/logger');
const { ProvisioningError } = require('../utils/errors');

class DockerService {

  constructor() {
    const dockerOpts = {};

    if (config.docker && config.docker.socketPath) {
      dockerOpts.socketPath = config.docker.socketPath;
    } else if (config.docker && config.docker.host) {
      dockerOpts.host = config.docker.host;
      dockerOpts.port = config.docker.port || 2376;
      if (config.docker.ca) {
        dockerOpts.ca = config.docker.ca;
      }
      if (config.docker.cert) {
        dockerOpts.cert = config.docker.cert;
      }
      if (config.docker.key) {
        dockerOpts.key = config.docker.key;
      }
    }

    this.docker = new Docker(dockerOpts);
    logger.info('DockerService initialized', {
      socketPath: dockerOpts.socketPath || 'tcp',
    });
  }

  async createContainer(sessionId, image, containerConfig = {}) {
    const containerName = `unionlabs-session-${sessionId}`;
    logger.info('Creating Docker container', { sessionId, image, containerName });

    try {

      const envVars = [
        'VNC_PW=unionlabs',
        'DISPLAY=:1',
      ];
      if (containerConfig.env) {
        for (const [key, value] of Object.entries(containerConfig.env)) {
          envVars.push(`${key}=${value}`);
        }
      }

      const binds = [];
      if (containerConfig.volumes) {
        for (const [hostPath, containerPath] of Object.entries(containerConfig.volumes)) {
          binds.push(`${hostPath}:${containerPath}`);
        }
      }

      const exposedPorts = { '5901/tcp': {} };
      const portBindings = {
        '5901/tcp': [{ HostPort: '' }],
      };

      if (containerConfig.extraPorts) {
        for (const port of containerConfig.extraPorts) {
          const portKey = port.includes('/') ? port : `${port}/tcp`;
          exposedPorts[portKey] = {};
          portBindings[portKey] = [{ HostPort: '' }];
        }
      }

      const memoryLimit = containerConfig.memoryLimit || 2 * 1024 * 1024 * 1024;
      const cpuQuota = containerConfig.cpuQuota || 100000;

      const createOptions = {
        Image: image,
        name: containerName,
        Env: envVars,
        ExposedPorts: exposedPorts,
        Labels: {
          'unionlabs.session.id': sessionId,
          'unionlabs.managed': 'true',
        },
        HostConfig: {
          PortBindings: portBindings,
          Binds: binds.length > 0 ? binds : undefined,
          Memory: memoryLimit,
          MemorySwap: memoryLimit * 2,
          CpuQuota: cpuQuota,
          CpuPeriod: 100000,
          RestartPolicy: { Name: 'unless-stopped' },
          SecurityOpt: ['no-new-privileges'],
        },
      };

      const container = await this.docker.createContainer(createOptions);

      const info = await container.inspect();
      const result = {
        id: container.id,
        name: containerName,
        ports: info.HostConfig.PortBindings,
        image,
      };

      logger.info('Docker container created successfully', {
        sessionId,
        containerId: container.id,
        containerName,
      });

      return result;
    } catch (err) {
      logger.error('Failed to create Docker container', {
        sessionId,
        image,
        error: err.message,
      });
      throw new ProvisioningError(
        `Failed to create container for session ${sessionId}: ${err.message}`,
        { sessionId, image, cause: err }
      );
    }
  }

  async startContainer(containerId) {
    logger.info('Starting Docker container', { containerId });

    try {
      const container = this.docker.getContainer(containerId);
      await container.start();

      logger.info('Docker container started successfully', { containerId });
    } catch (err) {

      if (err.statusCode === 304) {
        logger.warn('Container already running', { containerId });
        return;
      }

      logger.error('Failed to start Docker container', {
        containerId,
        error: err.message,
      });
      throw new ProvisioningError(
        `Failed to start container ${containerId}: ${err.message}`,
        { containerId, cause: err }
      );
    }
  }

  async stopContainer(containerId) {
    logger.info('Stopping Docker container', { containerId });

    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 });

      logger.info('Docker container stopped successfully', { containerId });
    } catch (err) {

      if (err.statusCode === 304) {
        logger.warn('Container already stopped', { containerId });
        return;
      }

      if (err.statusCode === 404) {
        logger.warn('Container not found (already removed?)', { containerId });
        return;
      }

      logger.error('Failed to stop Docker container', {
        containerId,
        error: err.message,
      });
      throw new ProvisioningError(
        `Failed to stop container ${containerId}: ${err.message}`,
        { containerId, cause: err }
      );
    }
  }

  async removeContainer(containerId, removeVolumes = false) {
    logger.info('Removing Docker container', { containerId, removeVolumes });

    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ v: removeVolumes, force: true });

      logger.info('Docker container removed successfully', { containerId });
    } catch (err) {

      if (err.statusCode === 404) {
        logger.warn('Container not found (already removed?)', { containerId });
        return;
      }

      logger.error('Failed to remove Docker container', {
        containerId,
        error: err.message,
      });
      throw new ProvisioningError(
        `Failed to remove container ${containerId}: ${err.message}`,
        { containerId, cause: err }
      );
    }
  }

  async getContainerStatus(containerId) {
    logger.debug('Getting container status', { containerId });

    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();

      const status = {
        id: info.Id,
        state: info.State.Status,
        running: info.State.Running,
        ports: info.NetworkSettings.Ports || {},
      };

      logger.debug('Container status retrieved', { containerId, state: status.state });
      return status;
    } catch (err) {
      if (err.statusCode === 404) {
        logger.warn('Container not found', { containerId });
        return { id: containerId, state: 'removed', running: false, ports: {} };
      }

      logger.error('Failed to get container status', {
        containerId,
        error: err.message,
      });
      throw new ProvisioningError(
        `Failed to get status for container ${containerId}: ${err.message}`,
        { containerId, cause: err }
      );
    }
  }

  async waitForReady(containerId, timeoutMs = 30000) {
    logger.info('Waiting for container to be ready', { containerId, timeoutMs });

    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const container = this.docker.getContainer(containerId);
        const info = await container.inspect();

        if (!info.State.Running) {
          logger.debug('Container not yet running, waiting...', { containerId });
          await this._sleep(pollInterval);
          continue;
        }

        const ports = info.NetworkSettings.Ports || {};
        const vncPort = ports['5901/tcp'];

        if (vncPort && vncPort.length > 0) {
          logger.info('Container is ready — VNC port is mapped', {
            containerId,
            vncHostPort: vncPort[0].HostPort,
            elapsedMs: Date.now() - startTime,
          });

          return {
            id: info.Id,
            state: info.State.Status,
            running: true,
            ports,
          };
        }

        logger.debug('VNC port not yet available, polling...', { containerId });
      } catch (err) {
        logger.debug('Health check poll error (retrying)', {
          containerId,
          error: err.message,
        });
      }

      await this._sleep(pollInterval);
    }

    logger.error('Container readiness timeout exceeded', {
      containerId,
      timeoutMs,
    });
    throw new ProvisioningError(
      `Container ${containerId} did not become ready within ${timeoutMs}ms`,
      { containerId, timeoutMs }
    );
  }

  async pullImage(imageName) {
    logger.info('Pulling Docker image', { imageName });

    try {
      const stream = await this.docker.pull(imageName);

      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(
          stream,
          (err, output) => {
            if (err) {
              reject(err);
            } else {
              resolve(output);
            }
          },
          (event) => {
            if (event.status) {
              logger.debug('Image pull progress', {
                imageName,
                status: event.status,
                progress: event.progress || '',
              });
            }
          }
        );
      });

      logger.info('Docker image pulled successfully', { imageName });
    } catch (err) {
      logger.error('Failed to pull Docker image', {
        imageName,
        error: err.message,
      });
      throw new ProvisioningError(
        `Failed to pull image ${imageName}: ${err.message}`,
        { imageName, cause: err }
      );
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = DockerService;
