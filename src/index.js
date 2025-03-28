'use strict';
require('dotenv').config();
const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');

const app = express();
app.use(express.json());

const port = config.server.port || 3000;
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
