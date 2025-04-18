#!/usr/bin/env node

'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH
  || path.join(__dirname, '..', 'data', 'unionlabs.db');

const testbeds = [
  {
    id: crypto.randomUUID(),
    name: 'NeXT (UB)',
    description:
      'Ad hoc in-air networking testbed at the University at Buffalo. ' +
      'Supports mobile ad hoc network experiments with UAV-based aerial nodes ' +
      'and ground-based software-defined radios for advanced wireless research.',
    experiments: JSON.stringify([
      'Ad hoc networking',
      'UAV communications',
      'Mobile relay optimization',
      'Spectrum sharing',
    ]),
    dockerImage: 'unionlabs/session:latest',
    sshHost: 'localhost',
    sshPort: 22,
    maxSessions: 3,
    status: 'available',
    frequency: '1.2-6 GHz',
    bandwidth: 'Up to 56 MHz',
    edgeCloud: 'Dell PowerEdge R740 Server',
    softwareRadio: 'USRP N210',
  },
  {
    id: crypto.randomUUID(),
    name: 'UWCT (UB)',
    description:
      'Underwater wireless communications testbed at the University at Buffalo. ' +
      'Enables experiments in acoustic and electromagnetic underwater channels ' +
      'for applications including ocean monitoring and submarine communications.',
    experiments: JSON.stringify([
      'Underwater acoustic communications',
      'EM underwater propagation',
      'Ocean monitoring networks',
      'Underwater channel modeling',
    ]),
    dockerImage: 'unionlabs/session:latest',
    sshHost: 'localhost',
    sshPort: 22,
    maxSessions: 3,
    status: 'available',
    frequency: '0-30 MHz',
    bandwidth: 'Up to 25 MHz',
    edgeCloud: 'Dell PowerEdge R740 Server',
    softwareRadio: 'USRP N210',
  },
  {
    id: crypto.randomUUID(),
    name: 'UGCT (UB)',
    description:
      'Underground communications testbed at the University at Buffalo. ' +
      'Supports research in wireless propagation through soil and rock for ' +
      'applications in mining, agriculture, and underground infrastructure.',
    experiments: JSON.stringify([
      'Underground channel characterization',
      'Soil propagation modeling',
      'Mine safety communications',
      'Smart agriculture sensing',
    ]),
    dockerImage: 'unionlabs/session:latest',
    sshHost: 'localhost',
    sshPort: 22,
    maxSessions: 3,
    status: 'available',
    frequency: '0-30 MHz',
    bandwidth: 'Up to 25 MHz',
    edgeCloud: 'Dell PowerEdge R740 Server',
    softwareRadio: 'USRP N210',
  },
  {
    id: crypto.randomUUID(),
    name: 'MilliNet (UB)',
    description:
      'Millimeter-wave networking testbed at the University at Buffalo. ' +
      'Designed for beamforming, RADAR, and 60 GHz experiments using ' +
      'programmable phased-array M-Cube platform and USRP B210 radios.',
    experiments: JSON.stringify([
      'mmWave beamforming',
      'Joint radar-communications',
      '60 GHz channel sounding',
      'Phased array calibration',
    ]),
    dockerImage: 'unionlabs/session:latest',
    sshHost: 'localhost',
    sshPort: 22,
    maxSessions: 3,
    status: 'available',
    frequency: '60 GHz',
    bandwidth: 'Up to 2 GHz',
    edgeCloud: 'NVIDIA Jetson AGX Xavier',
    softwareRadio: 'M-Cube / USRP B210',
  },
  {
    id: crypto.randomUUID(),
    name: 'O-RAN (UB)',
    description:
      'Open Radio Access Network testbed at the University at Buffalo. ' +
      'Supports O-RAN compliant network slicing, xAPP development, and ' +
      'RAN Intelligent Controller experiments with near-real-time control loops.',
    experiments: JSON.stringify([
      'Network slicing',
      'xAPP development',
      'RAN intelligent control',
      'O-RAN compliance testing',
      'Near-RT RIC experiments',
    ]),
    dockerImage: 'unionlabs/session:latest',
    sshHost: 'localhost',
    sshPort: 22,
    maxSessions: 3,
    status: 'available',
    frequency: '1.2-6 GHz',
    bandwidth: 'Up to 100 MHz',
    edgeCloud: 'Dell PowerEdge R740 Server',
    softwareRadio: 'USRP X310 / USRP B210',
  },
  {
    id: crypto.randomUUID(),
    name: 'IoT (UoU)',
    description:
      'Long-range IoT testbed at the University of Utah. ' +
      'Focuses on LoRa-based long-range, low-power IoT networking research ' +
      'for smart city, precision agriculture, and environmental monitoring.',
    experiments: JSON.stringify([
      'LoRa range testing',
      'LPWAN protocol design',
      'Smart city sensing',
      'Energy harvesting IoT',
    ]),
    dockerImage: 'unionlabs/session:latest',
    sshHost: 'localhost',
    sshPort: 22,
    maxSessions: 3,
    status: 'available',
    frequency: '868/915 MHz',
    bandwidth: 'Up to 500 kHz',
    edgeCloud: 'Raspberry Pi 4 Cluster',
    softwareRadio: 'Adafruit RFM95W LoRa',
  },
];

function seed() {
  const fs = require('fs');
  const dataDir = path.dirname(DB_PATH);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`📁 Created data directory: ${dataDir}`);
  }

  const db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS testbeds (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      description   TEXT NOT NULL,
      experiments   TEXT NOT NULL DEFAULT '[]',
      dockerImage   TEXT NOT NULL,
      sshHost       TEXT NOT NULL DEFAULT 'localhost',
      sshPort       INTEGER NOT NULL DEFAULT 22,
      maxSessions   INTEGER NOT NULL DEFAULT 3,
      status        TEXT NOT NULL DEFAULT 'available',
      frequency     TEXT,
      bandwidth     TEXT,
      edgeCloud     TEXT,
      softwareRadio TEXT,
      createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      testbedId     TEXT NOT NULL,
      userId        TEXT,
      status        TEXT NOT NULL DEFAULT 'PENDING',
      containerId   TEXT,
      vncPort       INTEGER,
      wsPort        INTEGER,
      sshTunnelId   TEXT,
      startedAt     TEXT,
      completedAt   TEXT,
      errorMessage  TEXT,
      createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt     TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (testbedId) REFERENCES testbeds(id)
    );
  `);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO testbeds
      (id, name, description, experiments, dockerImage, sshHost, sshPort,
       maxSessions, status, frequency, bandwidth, edgeCloud, softwareRadio,
       createdAt, updatedAt)
    VALUES
      (@id, @name, @description, @experiments, @dockerImage, @sshHost, @sshPort,
       @maxSessions, @status, @frequency, @bandwidth, @edgeCloud, @softwareRadio,
       datetime('now'), datetime('now'))
  `);

  const insertAll = db.transaction((items) => {
    for (const item of items) {
      insertStmt.run(item);
    }
  });

  insertAll(testbeds);

  const count = db.prepare('SELECT COUNT(*) AS count FROM testbeds').get();

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║        UnionLabs Testbed Seeding Complete                 ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Database : ${DB_PATH.padEnd(45)}║`);
  console.log(`║  Testbeds : ${String(count.count).padEnd(45)}║`);
  console.log('╠═══════════════════════════════════════════════════════════╣');

  const rows = db.prepare('SELECT name, frequency, softwareRadio FROM testbeds ORDER BY name').all();
  for (const row of rows) {
    const line = `  ${row.name.padEnd(18)} ${row.frequency.padEnd(14)} ${row.softwareRadio}`;
    console.log(`║${line.padEnd(59)}║`);
  }

  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('✅ Seed completed successfully.');

  db.close();
}

try {
  seed();
} catch (err) {
  console.error('❌ Seeding failed:', err.message);
  process.exit(1);
}
