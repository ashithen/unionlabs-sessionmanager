'use strict';

const logger = require('../../utils/logger');

const ERROR_STATUS_MAP = {
  SessionNotFoundError: 404,
  TestbedNotFoundError: 404,
  ValidationError: 400,
  ProvisioningError: 500,
  TunnelError: 502,
  PortExhaustedError: 503,
  InvalidSessionStateError: 409,
};

const ERROR_CODE_MAP = {
  SessionNotFoundError: 'SESSION_NOT_FOUND',
  TestbedNotFoundError: 'TESTBED_NOT_FOUND',
  ValidationError: 'VALIDATION_ERROR',
  ProvisioningError: 'PROVISIONING_ERROR',
  TunnelError: 'TUNNEL_ERROR',
  PortExhaustedError: 'PORT_EXHAUSTED',
  InvalidSessionStateError: 'INVALID_SESSION_STATE',
};

const errorHandler = (err, req, res, _next) => {
  const errorName = err.name || err.constructor.name;

  const statusCode = err.statusCode || ERROR_STATUS_MAP[errorName] || 500;
  const errorCode = err.code || ERROR_CODE_MAP[errorName] || 'INTERNAL_ERROR';

  const logMeta = {
    errorCode,
    statusCode,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userId: req.body?.userId || req.query?.userId || 'unknown',
  };

  if (statusCode >= 500) {
    logger.error(`Unhandled error: ${err.message}`, {
      ...logMeta,
      stack: err.stack,
    });
  } else {
    logger.warn(`Client error: ${err.message}`, logMeta);
  }

  const errorResponse = {
    error: {
      code: errorCode,
      message: err.message || 'An unexpected error occurred',
      details: err.details || null,
      timestamp: new Date().toISOString(),
    },
  };

  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler;
