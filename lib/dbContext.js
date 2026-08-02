// lib/dbContext.js
//
// This is the mechanism that makes multi-tenancy possible without having to
// thread an accountId parameter through every function in the codebase.
// Everything under lib/*.js that does `const db = require('./db')` keeps
// working completely unchanged — lib/db.js resolves to whichever account's
// connection is currently active in this AsyncLocalStorage context, at the
// moment each query actually runs, not at require time.
//
// Every HTTP request must be wrapped in run() by the auth middleware before
// reaching any route handler. Every cron job must be wrapped in run() once
// per account by lib/forEachAccount.js. Code that runs outside both of
// those will find no context and lib/db.js will throw a clear error rather
// than silently touching the wrong account's data or a stale connection.

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function run(store, fn) {
    return als.run(store, fn);
}

function getStore() {
    return als.getStore();
}

module.exports = { run, getStore };
