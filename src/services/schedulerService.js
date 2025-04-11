'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');

class SchedulerService {
  constructor() {

    this.cronJob = null;

    this.sessionManager = null;

    this.scheduledSessions = new Map();

    this.isRunning = false;

    this._processingTick = false;

    logger.info('SchedulerService initialized');
  }

  setSessionManager(mgr) {
    this.sessionManager = mgr;
    logger.info('SchedulerService: sessionManager reference set');
  }

  start() {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    if (!this.sessionManager) {
      throw new Error('Cannot start scheduler: sessionManager not set. Call setSessionManager() first.');
    }

    logger.info('Starting scheduler cron job (every minute)');

    this.cronJob = cron.schedule('* * * * *', async () => {
      await this._tick();
    });

    this.isRunning = true;
    logger.info('Scheduler started');
  }

  stop() {
    if (!this.isRunning || !this.cronJob) {
      logger.warn('Scheduler is not running');
      return;
    }

    logger.info('Stopping scheduler cron job');
    this.cronJob.stop();
    this.cronJob = null;
    this.isRunning = false;
    logger.info('Scheduler stopped');
  }

  scheduleSession(sessionId, startTime, endTime) {
    const parsedStart = startTime instanceof Date ? startTime : new Date(startTime);
    const parsedEnd = endTime ? (endTime instanceof Date ? endTime : new Date(endTime)) : null;

    logger.info('Scheduling session', {
      sessionId,
      startTime: parsedStart.toISOString(),
      endTime: parsedEnd ? parsedEnd.toISOString() : 'none',
    });

    const schedule = {
      sessionId,
      startTime: parsedStart,
      endTime: parsedEnd,
      status: 'scheduled',
      createdAt: new Date(),
    };

    this.scheduledSessions.set(sessionId, schedule);

    logger.info('Session scheduled', { sessionId });
    return schedule;
  }

  cancelSchedule(sessionId) {
    logger.info('Cancelling scheduled session', { sessionId });

    const schedule = this.scheduledSessions.get(sessionId);
    if (!schedule) {
      logger.debug('No schedule found for session', { sessionId });
      return false;
    }

    schedule.status = 'cancelled';
    this.scheduledSessions.delete(sessionId);

    logger.info('Session schedule cancelled', { sessionId });
    return true;
  }

  getScheduledSessions() {
    return Array.from(this.scheduledSessions.values());
  }

  async _tick() {

    if (this._processingTick) {
      logger.debug('Scheduler tick skipped — previous tick still processing');
      return;
    }

    this._processingTick = true;

    try {
      const now = new Date();
      logger.debug('Scheduler tick', { time: now.toISOString() });

      await this._processStartTimes(now);
      await this._processEndTimes(now);
    } catch (err) {
      logger.error('Scheduler tick error', { error: err.message });
    } finally {
      this._processingTick = false;
    }
  }

  async _processStartTimes(now) {
    const pendingSessions = [];

    for (const [sessionId, schedule] of this.scheduledSessions.entries()) {
      if (schedule.status === 'scheduled' && schedule.startTime <= now) {
        pendingSessions.push(sessionId);
      }
    }

    if (pendingSessions.length === 0) {
      return;
    }

    logger.info('Processing sessions due for provisioning', {
      count: pendingSessions.length,
    });

    for (const sessionId of pendingSessions) {
      try {
        const schedule = this.scheduledSessions.get(sessionId);
        if (schedule) {
          schedule.status = 'triggered';
        }

        logger.info('Triggering provisioning for scheduled session', { sessionId });
        await this.sessionManager.provisionSession(sessionId);

        this.scheduledSessions.delete(sessionId);
      } catch (err) {
        logger.error('Failed to provision scheduled session', {
          sessionId,
          error: err.message,
        });

        const schedule = this.scheduledSessions.get(sessionId);
        if (schedule) {
          schedule.status = 'scheduled';
        }
      }
    }
  }

  async _processEndTimes(now) {
    const expiredSessions = [];

    for (const [sessionId, schedule] of this.scheduledSessions.entries()) {
      if (schedule.endTime && schedule.endTime <= now && schedule.status === 'triggered') {
        expiredSessions.push(sessionId);
      }
    }

    if (this.sessionManager) {
      try {
        const allSessions = await this.sessionManager.getAllSessions({ status: 'ACTIVE' });
        for (const session of allSessions) {
          if (session.endTime && new Date(session.endTime) <= now) {
            if (!expiredSessions.includes(session.id)) {
              expiredSessions.push(session.id);
            }
          }
        }
      } catch (err) {
        logger.error('Failed to query active sessions for expiry check', {
          error: err.message,
        });
      }
    }

    if (expiredSessions.length === 0) {
      return;
    }

    logger.info('Processing expired sessions', { count: expiredSessions.length });

    for (const sessionId of expiredSessions) {
      try {
        logger.info('Stopping expired session', { sessionId });
        await this.sessionManager.stopSession(sessionId);
        this.scheduledSessions.delete(sessionId);
      } catch (err) {
        logger.error('Failed to stop expired session', {
          sessionId,
          error: err.message,
        });
      }
    }
  }
}

module.exports = SchedulerService;
