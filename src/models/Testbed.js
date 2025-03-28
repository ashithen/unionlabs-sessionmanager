const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('./database');
const { TestbedNotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

function create(data) {
  const db = getDatabase();
  const id = data.id || uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO testbeds (
      id, name, description, experiments, dockerImage,
      sshHost, sshPort, sshKeyPath, maxSessions, status,
      frequency, bandwidth, edgeCloud, softwareRadio,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.name,
    data.description,
    data.experiments,
    data.dockerImage || 'unionlabs/session:latest',
    data.sshHost || 'localhost',
    data.sshPort || 22,
    data.sshKeyPath || null,
    data.maxSessions || 3,
    'available',
    data.frequency || null,
    data.bandwidth || null,
    data.edgeCloud || null,
    data.softwareRadio || null,
    now,
    now
  );

  logger.info(`Testbed registered: ${data.name} (${id})`, {
    service: 'testbed-model',
    testbedId: id,
  });

  return findById(id);
}

function findById(id) {
  const db = getDatabase();
  const testbed = db.prepare('SELECT * FROM testbeds WHERE id = ?').get(id);

  if (!testbed) {
    throw new TestbedNotFoundError(id);
  }

  return testbed;
}

function findAll(filters = {}) {
  const db = getDatabase();
  let query = 'SELECT * FROM testbeds WHERE 1=1';
  const params = [];

  if (filters.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }

  query += ' ORDER BY name ASC';

  return db.prepare(query).all(...params);
}

function updateStatus(id, status) {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = db.prepare(
    'UPDATE testbeds SET status = ?, updatedAt = ? WHERE id = ?'
  ).run(status, now, id);

  if (result.changes === 0) {
    throw new TestbedNotFoundError(id);
  }

  logger.debug(`Testbed ${id} status updated to ${status}`, {
    service: 'testbed-model',
    testbedId: id,
    status,
  });

  return findById(id);
}

function update(id, data) {
  const db = getDatabase();
  const now = new Date().toISOString();

  const allowedFields = [
    'name', 'description', 'experiments', 'dockerImage',
    'sshHost', 'sshPort', 'sshKeyPath', 'maxSessions',
    'status', 'frequency', 'bandwidth', 'edgeCloud', 'softwareRadio',
  ];

  const setClauses = ['updatedAt = ?'];
  const params = [now];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      params.push(data[field]);
    }
  }

  params.push(id);

  const result = db.prepare(
    `UPDATE testbeds SET ${setClauses.join(', ')} WHERE id = ?`
  ).run(...params);

  if (result.changes === 0) {
    throw new TestbedNotFoundError(id);
  }

  return findById(id);
}

function count() {
  const db = getDatabase();
  const row = db.prepare('SELECT COUNT(*) as count FROM testbeds').get();
  return row.count;
}

module.exports = {
  create,
  findById,
  findAll,
  updateStatus,
  update,
  count,
};
