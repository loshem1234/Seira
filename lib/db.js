// lib/db.js
// Single shared better-sqlite3 connection. SQLite on a persistent volume,
// matching the rest of the Archivum stack (Railway + persistent volumes).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = process.env.SEIRA_DB_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.SEIRA_DB_PATH || path.join(DB_DIR, 'seira.db');

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
