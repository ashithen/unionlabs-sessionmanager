const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const logDir = path.dirname(config.logging.filePath);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const svcStr = service ? `[${service}]` : '';
    return `${timestamp} ${level} ${svcStr} ${message}${metaStr}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: config.logging.level,
  defaultMeta: { service: 'session-manager' },
  transports: [

    new winston.transports.Console({
      format: consoleFormat,
    }),

    new winston.transports.File({
      filename: config.logging.filePath,
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),

    new winston.transports.File({
      filename: config.logging.filePath.replace('.log', '-error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

logger.child = (serviceName) => {
  return logger.child({ service: serviceName });
};

module.exports = logger;
