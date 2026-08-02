// lib/auth.js
// Signup, login, logout, and — critically — account provisioning: the
// moment a new account is created, it gets its own directory, its own
// database file, and its own Unity file, fully isolated from every other
// account. Genesis itself still happens through /genesis afterward, same
// as before; this just makes sure there's a fresh, empty, unfounded Seira
// waiting for them the instant they sign up.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const masterDb = require('./masterDb');
const { getDbForPath } = require('./dbManager');
const { ensureUnityFileExists } = require('./unity');

const ACCOUNTS_ROOT = process.env.SEIRA_ACCOUNTS_ROOT
    || path.join(process.env.SEIRA_DB_DIR || path.join(__dirname, '..', 'data'), 'accounts');

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function accountPaths(accountId) {
    const dir = path.join(ACCOUNTS_ROOT, String(accountId));
    return {
        dir,
        dbPath: path.join(dir, 'seira.db'),
        unityPath: path.join(dir, 'unity.json')
    };
}

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function validEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signup({ email, password }) {
    if (!validEmail(email)) throw new Error('Please enter a valid email address.');
    if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');

    const existing = masterDb.prepare(`SELECT id FROM accounts WHERE email = ?`).get(email.toLowerCase());
    if (existing) throw new Error('An account with that email already exists.');

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const result = masterDb.prepare(`
        INSERT INTO accounts (email, password_hash, password_salt) VALUES (?, ?, ?)
    `).run(email.toLowerCase(), hash, salt);
    const accountId = result.lastInsertRowid;

    // Provision this account's own, fully isolated Seira: her own
    // directory, her own database, her own unfounded Unity file. Opening
    // the database via getDbForPath applies the schema automatically.
    const paths = accountPaths(accountId);
    fs.mkdirSync(paths.dir, { recursive: true });
    ensureUnityFileExists(paths.unityPath);
    getDbForPath(paths.dbPath);

    return accountId;
}

function verifyPassword(account, password) {
    const candidateHash = hashPassword(password, account.password_salt);
    const a = Buffer.from(candidateHash, 'hex');
    const b = Buffer.from(account.password_hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function login({ email, password }) {
    const account = masterDb.prepare(`SELECT * FROM accounts WHERE email = ?`).get((email || '').toLowerCase());
    if (!account || !verifyPassword(account, password || '')) {
        throw new Error('Invalid email or password.');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    masterDb.prepare(`
        INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)
    `).run(token, account.id, expiresAt);

    return { token, accountId: account.id };
}

function logout(token) {
    if (!token) return;
    masterDb.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

function getAccountBySessionToken(token) {
    if (!token) return null;
    const session = masterDb.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
        masterDb.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
        return null;
    }
    return masterDb.prepare(`SELECT id, email, created_at FROM accounts WHERE id = ?`).get(session.account_id);
}

module.exports = { signup, login, logout, getAccountBySessionToken, accountPaths, ACCOUNTS_ROOT };
