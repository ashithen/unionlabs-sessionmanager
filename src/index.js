'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const config = require('./config');
const logger = require('./utils/logger');
const { initDatabase, closeDatabase } = require('./models/database');
const Session = require('./models/Session');
const Testbed = require('./models/Testbed');
const portAllocator = require('./utils/portAllocator');
const DockerService = require('./services/dockerService');
const SSHTunnelService = require('./services/sshTunnelService');
const VNCProxyService = require('./services/vncProxyService');
const createApiRouter = require('./api');
const { setupWebSocket } = require('./websocket/statusUpdates');
const errorHandler = require('./api/middleware/errorHandler');

async function main() {
  try {

    logger.info('Initializing database...');
    initDatabase();
    logger.info('Database initialized successfully');

    const app = express();

    app.use(
      helmet({
        contentSecurityPolicy: false,
      })
    );

    app.use(
      cors({
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
      })
    );

    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true }));

    const publicDir = path.join(__dirname, '..', 'public');
    app.use(express.static(publicDir));

    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.http(`${req.method} ${req.originalUrl}`, {
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          duration: `${duration}ms`,
          ip: req.ip,
        });
      });
      next();
    });

    const server = http.createServer(app);

    const io = new SocketIOServer(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    logger.info('Initializing services...');

    const dockerService = new DockerService();
    const sshTunnelService = new SSHTunnelService();
    const vncProxyService = new VNCProxyService();

    let cleanupService = null;
    let schedulerService = null;
    let sessionManager = null;

    try {
      const CleanupService = require('./services/CleanupService');
      cleanupService = new CleanupService({
        dockerService,
        sshTunnelService,
        vncProxyService,
        portAllocator,
        Session,
      });
      logger.info('CleanupService initialized');
    } catch (err) {
      logger.warn('CleanupService not available — skipping', {
        reason: err.message,
      });
    }

    try {
      const SchedulerService = require('./services/SchedulerService');
      schedulerService = new SchedulerService();
      logger.info('SchedulerService initialized');
    } catch (err) {
      logger.warn('SchedulerService not available — skipping', {
        reason: err.message,
      });
    }

    try {
      const SessionManager = require('./services/SessionManager');
      sessionManager = new SessionManager({
        dockerService,
        sshTunnelService,
        vncProxyService,
        portAllocator,
        cleanupService,
        schedulerService,
        Session,
        Testbed,
      });

      if (schedulerService && typeof schedulerService.setSessionManager === 'function') {
        schedulerService.setSessionManager(sessionManager);
      }
      if (typeof sessionManager.setSocketIO === 'function') {
        sessionManager.setSocketIO(io);
      }

      logger.info('SessionManager initialized');
    } catch (err) {
      logger.warn('SessionManager not available — skipping', {
        reason: err.message,
      });
    }

    logger.info('Service initialization complete');

    const apiRouter = createApiRouter({
      sessionManager,
      Testbed,
      dockerService,
      Session,
    });

    app.use('/api', apiRouter);

    setupWebSocket(io);

    app.use(errorHandler);

    const port = config.server.port;

    server.listen(port, () => {
      logger.info('═══════════════════════════════════════════════');
      logger.info('  UnionLabs Testbed Session Manager');
      logger.info(`  Server running on port ${port}`);
      logger.info(`  Environment: ${config.server.env}`);
      logger.info(`  API endpoint: http://localhost:${port}/api`);
      logger.info(`  Health check: http://localhost:${port}/api/health`);
      logger.info('═══════════════════════════════════════════════');
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      try {

        if (schedulerService && typeof schedulerService.stop === 'function') {
          logger.info('Stopping scheduler service...');
          schedulerService.stop();
        }

        if (cleanupService && typeof cleanupService.cleanupAllSessions === 'function') {
          logger.info('Cleaning up all active sessions...');
          await cleanupService.cleanupAllSessions();
        } else {

          logger.info('Cleaning up services individually...');
          await sshTunnelService.closeAll();
          vncProxyService.cleanup();
          portAllocator.releaseAll();
        }

        logger.info('Closing WebSocket connections...');
        io.close();

        logger.info('Closing HTTP server...');
        await new Promise((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        logger.info('Closing database connection...');
        closeDatabase();

        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (err) {
        logger.error('Error during graceful shutdown', {
          error: err.message,
          stack: err.stack,
        });
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', {
        error: err.message,
        stack: err.stack,
      });
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', {
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    });
  } catch (err) {
    logger.error('Failed to start application', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
}

main();
