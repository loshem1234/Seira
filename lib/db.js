// lib/db.js
//
// THIS NO LONGER OPENS A CONNECTION ITSELF. It exports a Proxy that, on
// every property access (db.prepare(...), db.exec(...), db.transaction(...),
// etc.), resolves to whichever account's real better-sqlite3 connection is
// currently active in lib/dbContext.js's AsyncLocalStorage — at the moment
// the call happens, not at require time. This is what allows every other
// file in lib/ and routes/ to keep doing `const db = require('./db')`
// completely unchanged while still being fully account-isolated.
//
// If this is accessed with no context set (i.e. outside an authenticated
// request or a cron job wrapped via lib/forEachAccount.js), it throws
// immediately rather than silently doing nothing or touching stale data.

const { getStore } = require('./dbContext');

const handler = {
    get(_target, prop) {
        const store = getStore();
        if (!store || !store.db) {
            throw new Error(
                'lib/db.js was accessed with no account context set. Every request must pass ' +
                'through the auth middleware, and every cron job must run inside ' +
                'lib/forEachAccount.js — see those files.'
            );
        }
        const real = store.db;
        const val = real[prop];
        return typeof val === 'function' ? val.bind(real) : val;
    }
};

module.exports = new Proxy({}, handler);
