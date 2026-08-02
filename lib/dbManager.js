// lib/dbManager.js
// Opens and caches one better-sqlite3 connection per account database file.
// Distinct from lib/masterDb.js, which is the single, always-on database
// holding accounts and sessions — never per-account data.
//
// Schema is applied automatically the moment a connection is opened
// (initializeDatabase() is fully idempotent), so adding a new table to
// db/schema.sql reaches every existing account the next time their
// connection opens — no manual migration step required.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../db/init');

const cache = new Map(); // dbPath -> Database instance

function getDbForPath(dbPath) {
    if (cache.has(dbPath)) return cache.get(dbPath);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeDatabase(db);
    cache.set(dbPath, db);
    return db;
}

module.exports = { getDbForPath };
