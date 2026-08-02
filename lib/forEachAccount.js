// lib/forEachAccount.js
// Cron jobs (cron/cron.js) need to run once per account, each time inside
// that account's own db + unityPath context — otherwise lib/db.js and
// lib/unity.js have nothing to resolve against outside a request. This is
// the cron-side equivalent of what the auth middleware does per HTTP
// request.

const masterDb = require('./masterDb');
const { accountPaths } = require('./auth');
const { getDbForPath } = require('./dbManager');
const dbContext = require('./dbContext');

async function forEachAccount(fn) {
    const accounts = masterDb.prepare(`SELECT id, email FROM accounts`).all();
    const results = [];
    for (const account of accounts) {
        const paths = accountPaths(account.id);
        const db = getDbForPath(paths.dbPath);
        const result = await dbContext.run(
            { db, unityPath: paths.unityPath, accountId: account.id },
            () => fn(account)
        );
        results.push({ accountId: account.id, result });
    }
    return results;
}

module.exports = { forEachAccount };
