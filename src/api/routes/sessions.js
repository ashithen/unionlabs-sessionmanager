'use strict';

const { Router } = require('express');
const logger = require('../../utils/logger');
const {
  validateCreateSession,
  handleValidationErrors,
} = require('../middleware/validation');

module.exports = (sessionManager) => {
  const router = Router();

  router.post(
    '/',
    validateCreateSession,
    handleValidationErrors,
    async (req, res, next) => {
      try {
        const { testbedId, userId, options } = req.body;

        logger.info('Creating new session', { testbedId, userId });

        const session = await sessionManager.createSession(
          testbedId,
          userId,
          options
        );

        logger.info('Session created successfully', {
          sessionId: session.id,
          testbedId,
          userId,
        });

        res.status(201).json(session);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/', async (req, res, next) => {
    try {
      const { status, testbedId, userId } = req.query;
      const filters = {};

      if (status) filters.status = status;
      if (testbedId) filters.testbedId = testbedId;
      if (userId) filters.userId = userId;

      logger.debug('Listing sessions', { filters });

      const sessions = await sessionManager.getAllSessions(filters);

      res.status(200).json({
        sessions,
        count: sessions.length,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      logger.debug('Fetching session', { sessionId: id });

      const session = await sessionManager.getSession(id);

      res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/start', async (req, res, next) => {
    try {
      const { id } = req.params;

      logger.info('Starting session provisioning', { sessionId: id });

      const session = await sessionManager.provisionSession(id);

      logger.info('Session provisioning initiated', { sessionId: id });

      res.status(200).json({
        message: 'Session provisioning started',
        session,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/stop', async (req, res, next) => {
    try {
      const { id } = req.params;

      logger.info('Stopping session', { sessionId: id });

      const session = await sessionManager.stopSession(id);

      logger.info('Session stop initiated', { sessionId: id });

      res.status(200).json({
        message: 'Session stop initiated',
        session,
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      logger.info('Cancelling session', { sessionId: id });

      await sessionManager.cancelSession(id);

      logger.info('Session cancelled', { sessionId: id });

      res.status(200).json({
        message: `Session ${id} cancelled successfully`,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
