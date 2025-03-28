const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

let db = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS testbeds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    experiments TEXT NOT NULL,
    dockerImage TEXT NOT NULL DEFAULT 'unionlabs/session:latest',
    sshHost TEXT DEFAULT 'localhost',
    sshPort INTEGER DEFAULT 22,
    sshKeyPath TEXT,
    maxSessions INTEGER DEFAULT 3,
    status TEXT DEFAULT 'available' CHECK(status IN ('available', 'maintenance', 'offline')),
    frequency TEXT,
    bandwidth TEXT,
    edgeCloud TEXT,
    softwareRadio TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    testbedId TEXT NOT NULL,
    userId TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN (
      'PENDING', 'PROVISIONING', 'READY', 'ACTIVE',
      'CLEANING_UP', 'COMPLETED', 'FAILED'
    )),
    containerId TEXT,
    containerName TEXT,
    tunnelId TEXT,
    vncPort INTEGER,
    vncToken TEXT,
    vncUrl TEXT,
    dockerImage TEXT,
    startTime TEXT,
    endTime TEXT,
    durationMinutes INTEGER DEFAULT 60,
    errorMessage TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (testbedId) REFERENCES testbeds(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_testbed ON sessions(testbedId);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_sessions_startTime ON sessions(startTime);
`;

function initDatabase(dbPath) {
  const resolvedPath = dbPath || config.database.path;

  const dataDir = path.dirname(resolvedPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    logger.info(`Created data directory: ${dataDir}`, { service: 'database' });
  }

  try {
    db = new Database(resolvedPath);

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(SCHEMA);

    logger.info(`Database initialized at: ${resolvedPath}`, {
      service: 'database',
      tables: ['testbeds', 'sessions'],
    });

    return db;
  } catch (error) {
    logger.error(`Failed to initialize database: ${error.message}`, {
      service: 'database',
      path: resolvedPath,
      error: error.stack,
    });
    throw error;
  }
}

function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed', { service: 'database' });
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
};
