'use strict';

const { body, validationResult } = require('express-validator');

const validateCreateSession = [
  body('testbedId')
    .exists({ checkFalsy: true })
    .withMessage('testbedId is required')
    .isString()
    .withMessage('testbedId must be a string')
    .trim()
    .notEmpty()
    .withMessage('testbedId must not be empty'),

  body('userId')
    .exists({ checkFalsy: true })
    .withMessage('userId is required')
    .isString()
    .withMessage('userId must be a string')
    .trim()
    .notEmpty()
    .withMessage('userId must not be empty'),

  body('options')
    .optional()
    .isObject()
    .withMessage('options must be an object'),

  body('options.startTime')
    .optional()
    .isISO8601()
    .withMessage('options.startTime must be a valid ISO 8601 date string')
    .default(new Date().toISOString()),

  body('options.duration')
    .optional()
    .isInt({ min: 1, max: 480 })
    .withMessage('options.duration must be an integer between 1 and 480 minutes')
    .toInt()
    .default(60),

  body('options.dockerImage')
    .optional()
    .isString()
    .withMessage('options.dockerImage must be a string')
    .trim()
    .notEmpty()
    .withMessage('options.dockerImage must not be empty when provided'),
];

const validateCreateTestbed = [
  body('name')
    .exists({ checkFalsy: true })
    .withMessage('name is required')
    .isString()
    .withMessage('name must be a string')
    .trim()
    .notEmpty()
    .withMessage('name must not be empty'),

  body('description')
    .exists({ checkFalsy: true })
    .withMessage('description is required')
    .isString()
    .withMessage('description must be a string')
    .trim()
    .notEmpty()
    .withMessage('description must not be empty'),

  body('experiments')
    .exists({ checkFalsy: true })
    .withMessage('experiments is required')
    .isString()
    .withMessage('experiments must be a string')
    .trim()
    .notEmpty()
    .withMessage('experiments must not be empty'),

  body('dockerImage')
    .exists({ checkFalsy: true })
    .withMessage('dockerImage is required')
    .isString()
    .withMessage('dockerImage must be a string')
    .trim()
    .notEmpty()
    .withMessage('dockerImage must not be empty'),

  body('sshHost')
    .optional()
    .isString()
    .withMessage('sshHost must be a string')
    .trim()
    .notEmpty()
    .withMessage('sshHost must not be empty when provided'),

  body('sshPort')
    .optional()
    .isInt({ min: 1, max: 65535 })
    .withMessage('sshPort must be a valid port number (1-65535)')
    .toInt()
    .default(22),

  body('maxSessions')
    .optional()
    .isInt({ min: 1 })
    .withMessage('maxSessions must be a positive integer')
    .toInt()
    .default(1),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((err) => ({
      field: err.type === 'field' ? err.path : err.type,
      message: err.msg,
      value: err.value,
    }));

    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: formattedErrors,
        timestamp: new Date().toISOString(),
      },
    });
  }

  next();
};

module.exports = {
  validateCreateSession,
  validateCreateTestbed,
  handleValidationErrors,
};
