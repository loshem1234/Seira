// lib/masterDb.js
// The one database that is NOT per-account: the list of accounts
// themselves, and their sessions. This is a plain, always-open singleton —
// unlike lib/db.js, it never needs to switch based on who's logged in,
// since its whole job is figuring out who's logged in.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MASTER_DB_PATH = process.env.SEIRA_MASTER_DB_PATH
    || path.join(process.env.SEIRA_DB_DIR || path.join(__dirname, '..', 'data'), 'accounts.db');

const dir = path.dirname(MASTER_DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const masterDb = new Database(MASTER_DB_PATH);
masterDb.pragma('journal_mode = WAL');
masterDb.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'master-schema.sql'), 'utf8');
masterDb.exec(schema);

module.exports = masterDb;
