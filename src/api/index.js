'use strict';

const { Router } = require('express');
const createSessionsRouter = require('./routes/sessions');
const createTestbedsRouter = require('./routes/testbeds');
const createHealthRouter = require('./routes/health');

module.exports = ({ sessionManager, Testbed, dockerService, Session }) => {
  const router = Router();

  router.use('/sessions', createSessionsRouter(sessionManager));
  router.use('/testbeds', createTestbedsRouter(Testbed));
  router.use('/health', createHealthRouter(dockerService, Session));

  return router;
};
