// cron/cron.js
// Every scheduled process Seira runs, in one place, mirroring Arche's
// cron.js. Each job is annotated with the Constitution Article it serves.
// None of these jobs write to Unity, and none of them promote a proposal
// to Intellect without a prior, separate Architect-confirmed action —
// cron surfaces and maintains; it never ratifies.
//
// MULTI-TENANCY: every job below runs once PER ACCOUNT, each time wrapped
// in that account's own db + Unity context via lib/forEachAccount.js. A
// problem with one account's data (e.g. a Unity integrity failure) is
// logged loudly for that account specifically but does NOT halt the whole
// process or affect any other account — a deliberate change from the
// single-tenant version, where a Unity mismatch called process.exit(1)
// and took the entire app down. That's no longer acceptable once other
// people's Seiras are running in the same process.

const cron = require('node-cron');
const { verifyIntegrity } = require('../lib/unity');
const { pruneExpiredEntries, stampPruningEligibility } = require('../lib/corpusRetention');
const { generateDailyEntries } = require('../lib/diary');
const { runSelfAudit } = require('../lib/health');
const db = require('../lib/db');
const { forEachAccount } = require('../lib/forEachAccount');

function log(job, accountEmail, message) {
    console.log(`[cron:${job}] ${new Date().toISOString()} — [${accountEmail}] ${message}`);
}

function registerAllJobs() {

    // Article 32.3 — Unity integrity tripwire, per account. A failure here
    // for one account is logged as a serious error but does not affect
    // any other account's Seira or take down the process.
    cron.schedule('*/10 * * * *', async () => {
        await forEachAccount(async (account) => {
            try {
                const result = verifyIntegrity();
                if (!result.ok) {
                    console.error(`[cron:unity-tripwire] [${account.email}] ${result.reason}`);
                    return;
                }
                if (!result.sealed) {
                    log('unity-tripwire', account.email, 'Unity not yet sealed — awaiting Genesis.');
                }
            } catch (err) {
                console.error(`[cron:unity-tripwire] [${account.email}] error:`, err);
            }
        });
    });

    // Article 29 — Corpus retention pruning, per account. Retention window
    // itself is read live from that account's Intellect-grade parameters.
    cron.schedule('0 3 * * *', async () => {
        await forEachAccount(async (account) => {
            try {
                stampPruningEligibility();
                const pruned = pruneExpiredEntries();
                log('corpus-retention', account.email, `Pruned ${pruned} expired Corpus entries.`);
            } catch (err) {
                console.error(`[cron:corpus-retention] [${account.email}] error:`, err);
            }
        });
    });

    // Article 41 — daily diary, both parts, grounded in real records only, per account.
    cron.schedule('30 4 * * *', async () => {
        await forEachAccount(async (account) => {
            try {
                const sinceRow = db.prepare(`SELECT MAX(created_at) AS last FROM diary_entries`).get();
                const since = sinceRow?.last || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const { selfId, architectId } = await generateDailyEntries(since);
                log('diary', account.email, `Generated entries self=#${selfId} architect=#${architectId}.`);
            } catch (err) {
                console.error(`[cron:diary] [${account.email}] error:`, err);
            }
        });
    });

    // Article 42 — self-audit sweep, per account.
    cron.schedule('0 5 * * *', async () => {
        await forEachAccount(async (account) => {
            try {
                const flagged = runSelfAudit();
                log('self-audit', account.email, `Flagged ${flagged.length} item(s) for attention.`);
            } catch (err) {
                console.error(`[cron:self-audit] [${account.email}] error:`, err);
            }
        });
    });

    // Article 44 — periodic health snapshot, per account, purely observational.
    cron.schedule('0 * * * *', async () => {
        await forEachAccount(async (account) => {
            try {
                const health = db.prepare(`SELECT * FROM health_indicators`).get();
                log('health-snapshot', account.email, JSON.stringify(health));
            } catch (err) {
                console.error(`[cron:health-snapshot] [${account.email}] error:`, err);
            }
        });
    });

    console.log(`[cron:init] ${new Date().toISOString()} — All cron jobs registered (multi-account).`);
}

module.exports = { registerAllJobs };
