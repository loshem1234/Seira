// lib/dbManager.js
// Opens and caches one better-sqlite3 connection per account database file.
// Distinct from lib/masterDb.js, which is the single, always-on database
// holding accounts and sessions — never per-account data.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const cache = new Map(); // dbPath -> Database instance

function getDbForPath(dbPath) {
    if (cache.has(dbPath)) return cache.get(dbPath);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    cache.set(dbPath, db);
    return db;
}

module.exports = { getDbForPath };
