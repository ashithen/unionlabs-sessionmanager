'use strict';

const logger = require('../utils/logger');

class CleanupService {

  constructor({ dockerService, sshTunnelService, vncProxyService, portAllocator, Session }) {
    this.dockerService = dockerService;
    this.sshTunnelService = sshTunnelService;
    this.vncProxyService = vncProxyService;
    this.portAllocator = portAllocator;
    this.Session = Session;

    logger.info('CleanupService initialized');
  }

  async cleanupSession(sessionId) {
    logger.info('Starting session cleanup', { sessionId });
    const errors = [];

    let session;
    try {
      session = await this.Session.findById(sessionId);
    } catch (err) {
      logger.error('Failed to fetch session for cleanup', {
        sessionId,
        error: err.message,
      });
      errors.push(`Failed to fetch session: ${err.message}`);
      return { success: false, errors };
    }

    if (!session) {
      logger.warn('Session not found for cleanup', { sessionId });
      errors.push('Session not found');
      return { success: false, errors };
    }

    try {
      logger.debug('Cleanup step 1: Closing SSH tunnel', { sessionId });
      await this.sshTunnelService.closeTunnel(sessionId);
      logger.debug('SSH tunnel closed', { sessionId });
    } catch (err) {
      logger.error('Cleanup: failed to close SSH tunnel', {
        sessionId,
        error: err.message,
      });
      errors.push(`SSH tunnel close failed: ${err.message}`);
    }

    try {
      logger.debug('Cleanup step 2: Removing VNC proxy token', { sessionId });
      this.vncProxyService.removeProxyToken(sessionId);
      logger.debug('VNC proxy token removed', { sessionId });
    } catch (err) {
      logger.error('Cleanup: failed to remove VNC proxy token', {
        sessionId,
        error: err.message,
      });
      errors.push(`VNC proxy token removal failed: ${err.message}`);
    }

    const containerId = session.containerId;
    if (containerId) {
      try {
        logger.debug('Cleanup step 3: Stopping Docker container', {
          sessionId,
          containerId,
        });
        await this.dockerService.stopContainer(containerId);
        logger.debug('Docker container stopped', { sessionId, containerId });
      } catch (err) {
        logger.error('Cleanup: failed to stop Docker container', {
          sessionId,
          containerId,
          error: err.message,
        });
        errors.push(`Container stop failed: ${err.message}`);
      }

      try {
        logger.debug('Cleanup step 4: Removing Docker container', {
          sessionId,
          containerId,
        });
        await this.dockerService.removeContainer(containerId, true);
        logger.debug('Docker container removed', { sessionId, containerId });
      } catch (err) {
        logger.error('Cleanup: failed to remove Docker container', {
          sessionId,
          containerId,
          error: err.message,
        });
        errors.push(`Container removal failed: ${err.message}`);
      }
    } else {
      logger.debug('No container to clean up', { sessionId });
    }

    const allocatedPort = session.vncPort || session.allocatedPort;
    if (allocatedPort) {
      try {
        logger.debug('Cleanup step 5: Releasing port', {
          sessionId,
          port: allocatedPort,
        });
        this.portAllocator.releasePort(allocatedPort);
        logger.debug('Port released', { sessionId, port: allocatedPort });
      } catch (err) {
        logger.error('Cleanup: failed to release port', {
          sessionId,
          port: allocatedPort,
          error: err.message,
        });
        errors.push(`Port release failed: ${err.message}`);
      }
    } else {
      logger.debug('No port to release', { sessionId });
    }

    try {
      logger.debug('Cleanup step 6: Updating session status to COMPLETED', { sessionId });
      await this.Session.updateStatus(sessionId, 'COMPLETED', {
        vncPort: null,
        vncToken: null,
        vncUrl: null,
        containerId: null,
        tunnelId: null,
        errorMessage: errors.length > 0 ? errors.join('; ') : null,
      });
      logger.debug('Session status updated to COMPLETED', { sessionId });
    } catch (err) {
      logger.error('Cleanup: failed to update session status', {
        sessionId,
        error: err.message,
      });
      errors.push(`Status update failed: ${err.message}`);
    }

    const success = errors.length === 0;
    if (success) {
      logger.info('Session cleanup completed successfully', { sessionId });
    } else {
      logger.warn('Session cleanup completed with errors', {
        sessionId,
        errorCount: errors.length,
        errors,
      });
    }

    return { success, errors };
  }

  async cleanupStaleSessions() {
    logger.info('Checking for stale sessions');

    const staleThresholdMs = 10 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;
    let failed = 0;
    const allErrors = [];

    try {

      const provisioningSessions = await this.Session.findAll({ status: 'PROVISIONING' });
      const cleaningUpSessions = await this.Session.findAll({ status: 'CLEANING_UP' });
      const staleCandidates = [...provisioningSessions, ...cleaningUpSessions];

      if (staleCandidates.length === 0) {
        logger.debug('No stale session candidates found');
        return { cleaned: 0, failed: 0, errors: [] };
      }

      logger.info('Found stale session candidates', { count: staleCandidates.length });

      for (const session of staleCandidates) {
        const updatedAt = session.updatedAt
          ? new Date(session.updatedAt).getTime()
          : new Date(session.createdAt).getTime();

        if (now - updatedAt < staleThresholdMs) {
          logger.debug('Session not yet stale (within threshold)', {
            sessionId: session.id,
            status: session.status,
            ageMs: now - updatedAt,
          });
          continue;
        }

        logger.warn('Found stale session — initiating cleanup', {
          sessionId: session.id,
          status: session.status,
          ageMs: now - updatedAt,
        });

        try {
          const result = await this.cleanupSession(session.id);
          if (result.success) {
            cleaned++;
          } else {
            failed++;
            allErrors.push({
              sessionId: session.id,
              errors: result.errors,
            });
          }
        } catch (err) {
          failed++;
          allErrors.push({
            sessionId: session.id,
            errors: [err.message],
          });
          logger.error('Failed to clean up stale session', {
            sessionId: session.id,
            error: err.message,
          });
        }
      }
    } catch (err) {
      logger.error('Error querying for stale sessions', { error: err.message });
      allErrors.push({ sessionId: 'query', errors: [err.message] });
    }

    logger.info('Stale session cleanup complete', { cleaned, failed });
    return { cleaned, failed, errors: allErrors };
  }

  async cleanupAll() {
    logger.info('Cleaning up all active sessions (shutdown)');

    const activeStatuses = ['PROVISIONING', 'READY', 'ACTIVE', 'CLEANING_UP'];
    let cleaned = 0;
    let failed = 0;
    const allErrors = [];

    for (const status of activeStatuses) {
      try {
        const sessions = await this.Session.findAll({ status });

        for (const session of sessions) {
          try {
            logger.info('Shutdown cleanup: cleaning up session', {
              sessionId: session.id,
              status: session.status,
            });

            const result = await this.cleanupSession(session.id);
            if (result.success) {
              cleaned++;
            } else {
              failed++;
              allErrors.push({
                sessionId: session.id,
                errors: result.errors,
              });
            }
          } catch (err) {
            failed++;
            allErrors.push({
              sessionId: session.id,
              errors: [err.message],
            });
            logger.error('Shutdown cleanup: failed to clean up session', {
              sessionId: session.id,
              error: err.message,
            });
          }
        }
      } catch (err) {
        logger.error('Shutdown cleanup: failed to query sessions', {
          status,
          error: err.message,
        });
        allErrors.push({ sessionId: `query-${status}`, errors: [err.message] });
      }
    }

    logger.info('Shutdown cleanup complete', { cleaned, failed, total: cleaned + failed });
    return { cleaned, failed, errors: allErrors };
  }
}

module.exports = CleanupService;
