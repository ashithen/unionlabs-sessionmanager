'use strict';

const logger = require('../utils/logger');

function setupWebSocket(io) {
  io.on('connection', (socket) => {
    logger.info('WebSocket client connected', {
      socketId: socket.id,
      address: socket.handshake.address,
    });

    socket.on('session:subscribe', ({ sessionId }) => {
      if (!sessionId) {
        logger.warn('Session subscribe received without sessionId', {
          socketId: socket.id,
        });
        socket.emit('error', { message: 'sessionId is required' });
        return;
      }

      const room = `session:${sessionId}`;
      socket.join(room);

      logger.info('Client subscribed to session updates', {
        socketId: socket.id,
        sessionId,
        room,
      });

      socket.emit('session:subscribed', { sessionId, room });
    });

    socket.on('session:unsubscribe', ({ sessionId }) => {
      if (!sessionId) {
        logger.warn('Session unsubscribe received without sessionId', {
          socketId: socket.id,
        });
        return;
      }

      const room = `session:${sessionId}`;
      socket.leave(room);

      logger.info('Client unsubscribed from session updates', {
        socketId: socket.id,
        sessionId,
        room,
      });

      socket.emit('session:unsubscribed', { sessionId, room });
    });

    socket.on('disconnect', (reason) => {
      logger.info('WebSocket client disconnected', {
        socketId: socket.id,
        reason,
      });
    });
  });

  logger.info('WebSocket handlers initialized');
}

function emitSessionStatus(io, sessionId, status, data = {}) {
  const room = `session:${sessionId}`;

  const payload = {
    sessionId,
    status,
    data,
    timestamp: new Date().toISOString(),
  };

  io.to(room).emit('session:status', payload);

  logger.debug('Emitted session status update', {
    sessionId,
    status,
    room,
  });
}

module.exports = {
  setupWebSocket,
  emitSessionStatus,
};
