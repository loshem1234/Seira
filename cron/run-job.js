// cron/run-job.js
//
// This is the entry point for Railway's actual Cron Service feature, as
// distinct from the in-process node-cron scheduling in cron/cron.js.
// Railway Cron Services run a service's start command ONCE at the scheduled
// time and require the process to exit cleanly afterward — they are not
// long-running schedulers. This script does exactly one job, named by
// argv[2], then closes the database connection and exits.
//
// Usage (as a Railway service's Start Command):
//   node cron/run-job.js unity-tripwire
//   node cron/run-job.js corpus-retention
//   node cron/run-job.js diary
//   node cron/run-job.js self-audit
//   node cron/run-job.js health-snapshot

require('dotenv').config();

const jobName = process.argv[2];
const db = require('../lib/db');

function done(exitCode) {
    // better-sqlite3 is synchronous; closing here ensures no dangling
    // handle keeps the process alive past its work, which matters because
    // Railway will skip the next scheduled run if this one never exits.
    db.close();
    process.exit(exitCode);
}

async function run() {
    switch (jobName) {

        case 'unity-tripwire': {
            const { verifyIntegrity } = require('../lib/unity');
            const result = verifyIntegrity();
            if (!result.ok) {
                console.error(`[unity-tripwire] ${result.reason}`);
                return done(1);
            }
            console.log(`[unity-tripwire] ok. sealed=${result.sealed} genesisComplete=${result.genesisComplete}`);
            return done(0);
        }

        case 'corpus-retention': {
            const { stampPruningEligibility, pruneExpiredEntries } = require('../lib/corpusRetention');
            stampPruningEligibility();
            const pruned = pruneExpiredEntries();
            console.log(`[corpus-retention] pruned ${pruned} expired Corpus entries.`);
            return done(0);
        }

        case 'diary': {
            const { generateDailyEntries } = require('../lib/diary');
            const sinceRow = db.prepare(`SELECT MAX(created_at) AS last FROM diary_entries`).get();
            const since = sinceRow?.last || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { selfId, architectId } = await generateDailyEntries(since);
            console.log(`[diary] generated entries self=#${selfId} architect=#${architectId}.`);
            return done(0);
        }

        case 'self-audit': {
            const { runSelfAudit } = require('../lib/health');
            const flagged = runSelfAudit();
            console.log(`[self-audit] flagged ${flagged.length} item(s).`);
            return done(0);
        }

        case 'health-snapshot': {
            const health = db.prepare(`SELECT * FROM health_indicators`).get();
            console.log(`[health-snapshot] ${JSON.stringify(health)}`);
            return done(0);
        }

        default:
            console.error(`Unknown job "${jobName}". Valid jobs: unity-tripwire, corpus-retention, diary, self-audit, health-snapshot`);
            return done(1);
    }
}

run().catch(err => {
    console.error(`[${jobName}] uncaught error:`, err);
    done(1);
});
