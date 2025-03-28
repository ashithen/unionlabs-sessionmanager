const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('./database');
const { SessionNotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

const SessionStatus = {
  PENDING: 'PENDING',
  PROVISIONING: 'PROVISIONING',
  READY: 'READY',
  ACTIVE: 'ACTIVE',
  CLEANING_UP: 'CLEANING_UP',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

function create(data) {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  const startTime = data.startTime || now;
  const durationMinutes = data.durationMinutes || 60;

  const endDate = new Date(new Date(startTime).getTime() + durationMinutes * 60 * 1000);
  const endTime = endDate.toISOString();

  const stmt = db.prepare(`
    INSERT INTO sessions (id, testbedId, userId, status, startTime, endTime, durationMinutes, dockerImage, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.testbedId,
    data.userId,
    SessionStatus.PENDING,
    startTime,
    endTime,
    durationMinutes,
    data.dockerImage || null,
    now,
    now
  );

  logger.info(`Session created: ${id}`, {
    service: 'session-model',
    sessionId: id,
    testbedId: data.testbedId,
    userId: data.userId,
  });

  return findById(id);
}

function findById(id) {
  const db = getDatabase();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);

  if (!session) {
    throw new SessionNotFoundError(id);
  }

  return session;
}

function findAll(filters = {}) {
  const db = getDatabase();
  let query = 'SELECT * FROM sessions WHERE 1=1';
  const params = [];

  if (filters.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.testbedId) {
    query += ' AND testbedId = ?';
    params.push(filters.testbedId);
  }
  if (filters.userId) {
    query += ' AND userId = ?';
    params.push(filters.userId);
  }

  query += ' ORDER BY createdAt DESC';

  return db.prepare(query).all(...params);
}

function findByStatusAndTime(status, beforeTime) {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM sessions WHERE status = ? AND startTime <= ? ORDER BY startTime ASC'
  ).all(status, beforeTime);
}

function findExpired(beforeTime) {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM sessions WHERE status IN (?, ?) AND endTime <= ? ORDER BY endTime ASC'
  ).all(SessionStatus.READY, SessionStatus.ACTIVE, beforeTime);
}

function findStale(thresholdMinutes) {
  const db = getDatabase();
  const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();

  return db.prepare(
    'SELECT * FROM sessions WHERE status IN (?, ?) AND updatedAt <= ?'
  ).all(SessionStatus.PROVISIONING, SessionStatus.CLEANING_UP, threshold);
}

function updateStatus(id, status, extra = {}) {
  const db = getDatabase();
  const now = new Date().toISOString();

  let setClauses = ['status = ?', 'updatedAt = ?'];
  const params = [status, now];

  const allowedFields = [
    'containerId', 'containerName', 'tunnelId', 'vncPort',
    'vncToken', 'vncUrl', 'errorMessage', 'dockerImage',
  ];

  for (const field of allowedFields) {
    if (extra[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      params.push(extra[field]);
    }
  }

  params.push(id);

  const stmt = db.prepare(
    `UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`
  );

  const result = stmt.run(...params);

  if (result.changes === 0) {
    throw new SessionNotFoundError(id);
  }

  logger.debug(`Session ${id} status updated to ${status}`, {
    service: 'session-model',
    sessionId: id,
    status,
    extra: Object.keys(extra),
  });

  return findById(id);
}

function deleteSession(id) {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);

  if (result.changes === 0) {
    throw new SessionNotFoundError(id);
  }

  logger.info(`Session deleted: ${id}`, { service: 'session-model', sessionId: id });
  return true;
}

function countByStatus() {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT status, COUNT(*) as count FROM sessions GROUP BY status'
  ).all();

  const counts = {};
  for (const row of rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

module.exports = {
  SessionStatus,
  create,
  findById,
  findAll,
  findByStatusAndTime,
  findExpired,
  findStale,
  updateStatus,
  delete: deleteSession,
  countByStatus,
};
