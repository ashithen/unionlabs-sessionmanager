'use strict';

const { Router } = require('express');
const logger = require('../../utils/logger');
const {
  validateCreateTestbed,
  handleValidationErrors,
} = require('../middleware/validation');

module.exports = (Testbed) => {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      logger.debug('Listing all testbeds');

      const testbeds = Testbed.findAll();

      res.status(200).json({
        testbeds,
        count: testbeds.length,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      logger.debug('Fetching testbed', { testbedId: id });

      const testbed = Testbed.findById(id);

      if (!testbed) {
        const error = new Error(`Testbed with ID '${id}' not found`);
        error.constructor = { name: 'TestbedNotFoundError' };

        Object.defineProperty(error, 'name', { value: 'TestbedNotFoundError' });
        error.statusCode = 404;
        throw error;
      }

      res.status(200).json(testbed);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/',
    validateCreateTestbed,
    handleValidationErrors,
    async (req, res, next) => {
      try {
        const {
          name,
          description,
          experiments,
          dockerImage,
          sshHost,
          sshPort = 22,
          maxSessions = 1,
        } = req.body;

        logger.info('Registering new testbed', { name, dockerImage });

        const testbed = Testbed.create({
          name,
          description,
          experiments,
          dockerImage,
          sshHost,
          sshPort,
          maxSessions,
        });

        logger.info('Testbed registered successfully', {
          testbedId: testbed.id,
          name,
        });

        res.status(201).json(testbed);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
};
