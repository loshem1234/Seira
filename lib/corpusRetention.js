// lib/corpusRetention.js
// Article 29: the retention window is an Intellect-grade parameter, not an
// ops setting. This module reads that parameter and prunes Corpus entries
// whose window has elapsed. It never hardcodes a retention duration.

const db = require('./db');
const { getParam } = require('./parameters');

function stampPruningEligibility() {
    const retentionDays = getParam('corpus_retention_days', 180);
    // Set eligible_for_pruning_at for any entry that doesn't have it yet.
    db.prepare(`
        UPDATE corpus_entries
        SET eligible_for_pruning_at = datetime(created_at, '+' || ? || ' days')
        WHERE eligible_for_pruning_at IS NULL
    `).run(retentionDays);
}

function pruneExpiredEntries() {
    stampPruningEligibility();
    const result = db.prepare(`
        DELETE FROM corpus_entries
        WHERE eligible_for_pruning_at IS NOT NULL
          AND eligible_for_pruning_at <= datetime('now')
    `).run();
    return result.changes;
}

function insertCorpusEntry({ entryType, content, instrumentId = null, traceOfDerivation, sessionId = null }) {
    const retentionDays = getParam('corpus_retention_days', 180);
    return db.prepare(`
        INSERT INTO corpus_entries
            (entry_type, content, instrument_id, trace_of_derivation, session_id, eligible_for_pruning_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' days'))
    `).run(entryType, content, instrumentId, traceOfDerivation, sessionId, retentionDays).lastInsertRowid;
}

module.exports = { stampPruningEligibility, pruneExpiredEntries, insertCorpusEntry };
