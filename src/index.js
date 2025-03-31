'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const logger = require('./utils/logger');
const errorHandler = require('./api/middleware/errorHandler');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(errorHandler);

const port = config.server.port || 3000;
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
