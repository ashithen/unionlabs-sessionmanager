'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

class VNCProxyService {
  constructor() {

    this.tokenMap = new Map();

    this.sessionTokenMap = new Map();

    logger.info('VNCProxyService initialized');
  }

  createProxyToken(sessionId, targetPort) {
    logger.info('Creating VNC proxy token', { sessionId, targetPort });

    if (this.sessionTokenMap.has(sessionId)) {
      logger.debug('Removing existing token for session', { sessionId });
      this.removeProxyToken(sessionId);
    }

    const token = crypto.randomBytes(24).toString('hex');
    const target = `localhost:${targetPort}`;
    const createdAt = new Date();

    this.tokenMap.set(token, {
      sessionId,
      target,
      createdAt,
    });
    this.sessionTokenMap.set(sessionId, token);

    const url = `/vnc.html?token=${token}`;

    logger.info('VNC proxy token created', {
      sessionId,
      target,
      url,
      tokenPrefix: token.substring(0, 8) + '...',
    });

    return {
      token,
      sessionId,
      target,
      url,
      createdAt,
    };
  }

  removeProxyToken(sessionId) {
    logger.info('Removing VNC proxy token', { sessionId });

    const token = this.sessionTokenMap.get(sessionId);
    if (!token) {
      logger.debug('No proxy token found for session', { sessionId });
      return false;
    }

    this.tokenMap.delete(token);
    this.sessionTokenMap.delete(sessionId);

    logger.info('VNC proxy token removed', { sessionId });
    return true;
  }

  getTarget(token) {
    const entry = this.tokenMap.get(token);
    if (!entry) {
      logger.debug('Proxy token not found', {
        tokenPrefix: token ? token.substring(0, 8) + '...' : 'null',
      });
      return null;
    }

    logger.debug('Proxy token resolved', {
      sessionId: entry.sessionId,
      target: entry.target,
    });

    return entry.target;
  }

  getActiveTokens() {
    const tokens = [];
    for (const [token, entry] of this.tokenMap.entries()) {
      tokens.push({
        token,
        sessionId: entry.sessionId,
        target: entry.target,
        url: `/vnc.html?token=${token}`,
        createdAt: entry.createdAt,
      });
    }
    return tokens;
  }

  cleanup() {
    const count = this.tokenMap.size;
    logger.info('Cleaning up all VNC proxy tokens', { count });

    this.tokenMap.clear();
    this.sessionTokenMap.clear();

    logger.info('All VNC proxy tokens removed', { count });
    return count;
  }
}

module.exports = VNCProxyService;
