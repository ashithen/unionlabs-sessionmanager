const express = require('express');
const healthRoutes = require('./routes/health');
const sessionRoutes = require('./routes/sessions');
const testbedRoutes = require('./routes/testbeds');

module.exports = (deps) => {
  const router = express.Router();
  router.use('/health', healthRoutes(deps));
  router.use('/sessions', sessionRoutes(deps));
  router.use('/testbeds', testbedRoutes(deps));
  return router;
};
