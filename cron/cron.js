// cron/cron.js
// Every scheduled process Seira runs, in one place, mirroring Arche's
// cron.js. Each job is annotated with the Constitution Article it serves.
// None of these jobs write to Unity, and none of them promote a proposal
// to Intellect without a prior, separate Architect-confirmed action —
// cron surfaces and maintains; it never ratifies.

const cron = require('node-cron');
const { verifyIntegrity } = require('../lib/unity');
const { pruneExpiredEntries, stampPruningEligibility } = require('../lib/corpusRetention');
const { generateDailyEntries } = require('../lib/diary');
const { runSelfAudit } = require('../lib/health');
const db = require('../lib/db');

function log(job, message) {
    console.log(`[cron:${job}] ${new Date().toISOString()} — ${message}`);
}

function registerAllJobs() {

    // Article 32.3 — Unity integrity tripwire. Runs frequently; halts the
    // process on mismatch rather than logging and continuing, since a
    // Unity mismatch means something touched the one thing that must
    // never move.
    cron.schedule('*/10 * * * *', () => {
        const result = verifyIntegrity();
        if (!result.ok) {
            console.error(`[cron:unity-tripwire] ${result.reason}`);
            process.exit(1);
        }
        if (!result.sealed) {
            log('unity-tripwire', 'Unity is not yet sealed — awaiting Genesis (run node db/seal-unity.js).');
        }
    });

    // Article 29 — Corpus retention pruning. Retention window itself is
    // read live from Intellect-grade parameters on every run, never
    // hardcoded here.
    cron.schedule('0 3 * * *', () => {
        try {
            stampPruningEligibility();
            const pruned = pruneExpiredEntries();
            log('corpus-retention', `Pruned ${pruned} expired Corpus entries.`);
        } catch (err) {
            console.error('[cron:corpus-retention] error:', err);
        }
    });

    // Article 41 — daily diary, both parts, grounded in real records only.
    cron.schedule('30 4 * * *', async () => {
        try {
            const sinceRow = db.prepare(`
                SELECT MAX(created_at) AS last FROM diary_entries
            `).get();
            const since = sinceRow?.last || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { selfId, architectId } = await generateDailyEntries(since);
            log('diary', `Generated entries self=#${selfId} architect=#${architectId}.`);
        } catch (err) {
            console.error('[cron:diary] error:', err);
        }
    });

    // Article 42 — self-audit sweep, looking for what reactive triggers missed.
    cron.schedule('0 5 * * *', () => {
        try {
            const flagged = runSelfAudit();
            log('self-audit', `Flagged ${flagged.length} item(s) for attention.`);
        } catch (err) {
            console.error('[cron:self-audit] error:', err);
        }
    });

    // Article 44 — periodic health snapshot, purely observational; writes
    // nothing back into doctrinal tables, just makes the current numbers
    // easy to check without recomputing views on every dashboard load.
    cron.schedule('0 * * * *', () => {
        try {
            const health = db.prepare(`SELECT * FROM health_indicators`).get();
            log('health-snapshot', JSON.stringify(health));
        } catch (err) {
            console.error('[cron:health-snapshot] error:', err);
        }
    });

    log('init', 'All cron jobs registered.');
}

module.exports = { registerAllJobs };
