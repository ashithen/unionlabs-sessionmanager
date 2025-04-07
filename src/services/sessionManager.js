'use strict';

const logger = require('../utils/logger');
const { SessionNotFoundError, ProvisioningError } = require('../utils/errors');

class SessionManager {

  constructor({
    dockerService,
    sshTunnelService,
    vncProxyService,
    schedulerService,
    cleanupService,
    portAllocator,
    Session,
    Testbed,
  }) {
    this.dockerService = dockerService;
    this.sshTunnelService = sshTunnelService;
    this.vncProxyService = vncProxyService;
    this.schedulerService = schedulerService;
    this.cleanupService = cleanupService;
    this.portAllocator = portAllocator;
    this.Session = Session;
    this.Testbed = Testbed;

    this.io = null;

    logger.info('SessionManager initialized');
  }

  setSocketIO(io) {
    this.io = io;
    logger.info('SessionManager: Socket.IO reference set');
  }

  async createSession(testbedId, userId, options = {}) {
    logger.info('Creating new session', { testbedId, userId, options });

    let testbed;
    try {
      testbed = await this.Testbed.findById(testbedId);
    } catch (err) {
      logger.error('Failed to look up testbed', { testbedId, error: err.message });
      throw new ProvisioningError(
        `Failed to look up testbed ${testbedId}: ${err.message}`,
        { testbedId, cause: err }
      );
    }

    if (!testbed) {
      throw new SessionNotFoundError(`Testbed not found: ${testbedId}`);
    }

    const now = new Date();
    const startTime = options.startTime ? new Date(options.startTime) : now;
    let endTime = null;

    if (options.endTime) {
      endTime = new Date(options.endTime);
    } else if (options.duration) {
      endTime = new Date(startTime.getTime() + options.duration * 60 * 1000);
    }

    let session;
    try {
      session = await this.Session.create({
        testbedId,
        userId,
        status: 'PENDING',
        startTime: startTime.toISOString(),
        endTime: endTime ? endTime.toISOString() : null,
        description: options.description || null,
        env: options.env || null,
        volumes: options.volumes || null,
        image: testbed.image,
      });
    } catch (err) {
      logger.error('Failed to create session record', {
        testbedId,
        userId,
        error: err.message,
      });
      throw new ProvisioningError(
        `Failed to create session: ${err.message}`,
        { testbedId, userId, cause: err }
      );
    }

    logger.info('Session created with PENDING status', {
      sessionId: session.id,
      testbedId,
      userId,
    });

    this._emitStatus(session.id, 'PENDING', { testbedId, userId });

    const shouldProvisionNow = startTime <= now;
    if (shouldProvisionNow) {

      logger.info('Provisioning session immediately', { sessionId: session.id });
      this.provisionSession(session.id).catch((err) => {
        logger.error('Background provisioning failed', {
          sessionId: session.id,
          error: err.message,
        });
      });
    } else {

      this.schedulerService.scheduleSession(session.id, startTime, endTime);
    }

    return session;
  }

  async provisionSession(sessionId) {
    logger.info('Starting session provisioning', { sessionId });

    const session = await this._getSessionOrThrow(sessionId);

    let allocatedPort = null;
    let containerId = null;

    try {

      await this.Session.updateStatus(sessionId, 'PROVISIONING');
      this._emitStatus(sessionId, 'PROVISIONING', { step: 'started' });

      const testbed = await this.Testbed.findById(session.testbedId);
      if (!testbed) {
        throw new ProvisioningError(
          `Testbed ${session.testbedId} not found during provisioning`,
          { sessionId, testbedId: session.testbedId }
        );
      }

      const image = session.image || testbed.image;
      logger.info('Provisioning with testbed config', {
        sessionId,
        testbedId: testbed.id,
        image,
      });

      this._emitStatus(sessionId, 'PROVISIONING', { step: 'pulling_image', image });
      try {
        await this.dockerService.pullImage(image);
      } catch (err) {

        logger.warn('Image pull failed (may already exist locally)', {
          sessionId,
          image,
          error: err.message,
        });
      }

      this._emitStatus(sessionId, 'PROVISIONING', { step: 'allocating_port' });
      allocatedPort = this.portAllocator.allocatePort();
      logger.info('VNC port allocated', { sessionId, port: allocatedPort });

      this._emitStatus(sessionId, 'PROVISIONING', { step: 'creating_container' });
      const containerConfig = {
        env: session.env ? (typeof session.env === 'string' ? JSON.parse(session.env) : session.env) : {},
        volumes: session.volumes ? (typeof session.volumes === 'string' ? JSON.parse(session.volumes) : session.volumes) : {},
      };
      const containerInfo = await this.dockerService.createContainer(
        sessionId,
        image,
        containerConfig
      );
      containerId = containerInfo.id;

      this._emitStatus(sessionId, 'PROVISIONING', { step: 'starting_container' });
      await this.dockerService.startContainer(containerId);

      this._emitStatus(sessionId, 'PROVISIONING', { step: 'waiting_for_ready' });
      const readyStatus = await this.dockerService.waitForReady(containerId, 30000);

      let vncHostPort = allocatedPort;
      const vncMapping = readyStatus.ports['5901/tcp'];
      if (vncMapping && vncMapping.length > 0) {
        vncHostPort = parseInt(vncMapping[0].HostPort, 10);
      }

      let tunnelInfo = null;
      if (testbed.remoteHost) {
        this._emitStatus(sessionId, 'PROVISIONING', { step: 'creating_tunnel' });
        tunnelInfo = await this.sshTunnelService.createTunnel(sessionId, {
          host: testbed.remoteHost,
          port: testbed.sshPort || 22,
          username: testbed.sshUsername || 'root',
          privateKeyPath: testbed.sshKeyPath,
          remotePort: 5901,
          localPort: vncHostPort,
        });
        logger.info('SSH tunnel created', { sessionId, tunnelInfo });
      }

      this._emitStatus(sessionId, 'PROVISIONING', { step: 'creating_proxy' });
      const proxyToken = this.vncProxyService.createProxyToken(sessionId, vncHostPort);

      const connectionInfo = {
        containerId,
        vncPort: vncHostPort,
        allocatedPort,
        proxyToken: proxyToken.token,
        vncUrl: proxyToken.url,
        tunnelId: tunnelInfo ? tunnelInfo.id : null,
      };

      await this.Session.updateStatus(sessionId, 'READY', connectionInfo);
      this._emitStatus(sessionId, 'READY', connectionInfo);

      logger.info('Session provisioned successfully', {
        sessionId,
        containerId,
        vncPort: vncHostPort,
        vncUrl: proxyToken.url,
      });

      return await this.Session.findById(sessionId);
    } catch (err) {
      logger.error('Session provisioning failed', {
        sessionId,
        error: err.message,
        stack: err.stack,
      });

      try {
        await this.Session.updateStatus(sessionId, 'FAILED', {
          error: err.message,
          failedAt: new Date().toISOString(),
        });
      } catch (updateErr) {
        logger.error('Failed to update session status to FAILED', {
          sessionId,
          error: updateErr.message,
        });
      }

      this._emitStatus(sessionId, 'FAILED', { error: err.message });

      await this._partialCleanup(sessionId, { allocatedPort, containerId });

      throw new ProvisioningError(
        `Session provisioning failed for ${sessionId}: ${err.message}`,
        { sessionId, cause: err }
      );
    }
  }

  async connectSession(sessionId) {
    logger.info('Connecting to session', { sessionId });

    const session = await this._getSessionOrThrow(sessionId);

    if (session.status !== 'READY' && session.status !== 'ACTIVE') {
      throw new ProvisioningError(
        `Cannot connect to session ${sessionId}: status is ${session.status} (expected READY or ACTIVE)`,
        { sessionId, currentStatus: session.status }
      );
    }

    if (session.status === 'READY') {
      await this.Session.updateStatus(sessionId, 'ACTIVE', {
        connectedAt: new Date().toISOString(),
      });
      this._emitStatus(sessionId, 'ACTIVE', { sessionId });
    }

    const updatedSession = await this.Session.findById(sessionId);

    logger.info('Session connected', {
      sessionId,
      vncUrl: updatedSession.vncUrl,
    });

    return updatedSession;
  }

  async stopSession(sessionId) {
    logger.info('Stopping session', { sessionId });

    const session = await this._getSessionOrThrow(sessionId);

    if (session.status === 'COMPLETED' || session.status === 'CLEANING_UP') {
      logger.warn('Session already stopping or completed', {
        sessionId,
        status: session.status,
      });
      return { success: true, errors: [] };
    }

    await this.Session.updateStatus(sessionId, 'CLEANING_UP', {
      stoppedAt: new Date().toISOString(),
    });
    this._emitStatus(sessionId, 'CLEANING_UP', { sessionId });

    this.schedulerService.cancelSchedule(sessionId);

    const result = await this.cleanupService.cleanupSession(sessionId);

    this._emitStatus(sessionId, 'COMPLETED', {
      sessionId,
      cleanupErrors: result.errors,
    });

    logger.info('Session stopped', {
      sessionId,
      success: result.success,
      errorCount: result.errors.length,
    });

    return result;
  }

  async getSession(sessionId) {
    logger.debug('Getting session', { sessionId });
    return this._getSessionOrThrow(sessionId);
  }

  async getAllSessions(filters = {}) {
    logger.debug('Getting all sessions', { filters });

    try {
      const sessions = await this.Session.findAll(filters);
      return sessions;
    } catch (err) {
      logger.error('Failed to retrieve sessions', {
        filters,
        error: err.message,
      });
      throw err;
    }
  }

  _emitStatus(sessionId, status, data = {}) {
    if (!this.io) {
      logger.debug('Socket.IO not available — skipping status emit', {
        sessionId,
        status,
      });
      return;
    }

    const event = {
      sessionId,
      status,
      timestamp: new Date().toISOString(),
      ...data,
    };

    try {
      this.io.emit('session:status', event);
      logger.debug('Emitted session status event', { sessionId, status });
    } catch (err) {
      logger.error('Failed to emit Socket.IO event', {
        sessionId,
        status,
        error: err.message,
      });
    }
  }

  async _getSessionOrThrow(sessionId) {
    const session = await this.Session.findById(sessionId);
    if (!session) {
      throw new SessionNotFoundError(`Session not found: ${sessionId}`);
    }
    return session;
  }

  async _partialCleanup(sessionId, { allocatedPort, containerId }) {
    logger.info('Attempting partial cleanup after provisioning failure', {
      sessionId,
      allocatedPort,
      containerId,
    });

    if (allocatedPort) {
      try {
        this.portAllocator.releasePort(allocatedPort);
        logger.debug('Partial cleanup: port released', { sessionId, port: allocatedPort });
      } catch (err) {
        logger.error('Partial cleanup: failed to release port', {
          sessionId,
          port: allocatedPort,
          error: err.message,
        });
      }
    }

    if (containerId) {
      try {
        await this.dockerService.stopContainer(containerId);
      } catch (err) {
        logger.debug('Partial cleanup: stop container error (non-fatal)', {
          sessionId,
          error: err.message,
        });
      }
      try {
        await this.dockerService.removeContainer(containerId, true);
        logger.debug('Partial cleanup: container removed', { sessionId, containerId });
      } catch (err) {
        logger.error('Partial cleanup: failed to remove container', {
          sessionId,
          containerId,
          error: err.message,
        });
      }
    }

    try {
      await this.sshTunnelService.closeTunnel(sessionId);
    } catch (err) {
      logger.debug('Partial cleanup: tunnel close error (non-fatal)', {
        sessionId,
        error: err.message,
      });
    }

    try {
      this.vncProxyService.removeProxyToken(sessionId);
    } catch (err) {
      logger.debug('Partial cleanup: proxy token removal error (non-fatal)', {
        sessionId,
        error: err.message,
      });
    }
  }
}

module.exports = SessionManager;
