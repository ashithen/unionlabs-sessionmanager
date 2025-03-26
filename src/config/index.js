const path = require('path');

const config = {

  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
    isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
  },

  database: {
    path: process.env.DB_PATH || path.join(__dirname, '../../data/unionlabs.db'),
  },

  docker: {
    socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    defaultImage: process.env.DEFAULT_SESSION_IMAGE || 'unionlabs/session:latest',
    containerMemoryLimit: 2 * 1024 * 1024 * 1024,
    containerCpuQuota: 100000,
    stopTimeoutSeconds: 10,
  },

  ssh: {
    simulationMode: process.env.SSH_SIMULATION_MODE === 'true',
    defaultKeyPath: process.env.SSH_DEFAULT_KEY_PATH || '~/.ssh/id_rsa',
    defaultPort: parseInt(process.env.SSH_DEFAULT_PORT, 10) || 22,
    connectionTimeout: parseInt(process.env.SSH_CONNECTION_TIMEOUT, 10) || 10000,
  },

  session: {
    maxDurationMinutes: parseInt(process.env.SESSION_MAX_DURATION_MINUTES, 10) || 480,
    defaultDurationMinutes: parseInt(process.env.SESSION_DEFAULT_DURATION_MINUTES, 10) || 60,
    cleanupIntervalMinutes: parseInt(process.env.SESSION_CLEANUP_INTERVAL_MINUTES, 10) || 5,
    staleThresholdMinutes: 10,
  },

  ports: {
    rangeStart: parseInt(process.env.PORT_RANGE_START, 10) || 5900,
    rangeEnd: parseInt(process.env.PORT_RANGE_END, 10) || 5999,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    filePath: process.env.LOG_FILE || path.join(__dirname, '../../logs/session-manager.log'),
  },
};

module.exports = config;
