'use strict';

const { Router } = require('express');
const logger = require('../../utils/logger');

module.exports = (dockerService, Session) => {
  const router = Router();

  router.get('/', async (req, res) => {
    let databaseHealthy = false;
    let dockerHealthy = false;
    let activeSessions = 0;

    try {
      const sessions = Session.findAll();
      databaseHealthy = true;
      activeSessions = sessions.filter(
        (s) =>
          s.status === 'PROVISIONING' ||
          s.status === 'READY' ||
          s.status === 'ACTIVE'
      ).length;
    } catch (err) {
      logger.error('Database health check failed', { error: err.message });
    }

    try {

      await dockerService.docker.ping();
      dockerHealthy = true;
    } catch (err) {
      logger.error('Docker health check failed', { error: err.message });
    }

    const overallStatus =
      databaseHealthy && dockerHealthy ? 'ok' : 'degraded';

    const healthReport = {
      status: overallStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        database: databaseHealthy,
        docker: dockerHealthy,
      },
      activeSessions,
    };

    res.status(200).json(healthReport);
  });

  return router;
};
