// lib/health.js
// Article 42: scheduled self-audit, looking for undetected drift or
// unescalated contradiction rather than waiting solely for reactive
// triggers. Article 44: standing health indicators, read (not stored) on
// demand from the archive_reversion_log / health_indicators views.

const db = require('./db');
const { recordReversionEvent } = require('./reversion');

/**
 * Article 42: a light sweep. This is intentionally simple in v1 — it looks
 * for instrument_convergence_tracking rows sitting non-converged with no
 * corresponding resolved proposal, and contradiction_pairs open longer than
 * a configurable staleness window, and flags them for Psyche's attention
 * via a 'self_audit_flag' reversion event, rather than silently doing
 * nothing between reactive triggers.
 */
function runSelfAudit() {
    const flagged = [];

    const unresolvedEscalations = db.prepare(`
        SELECT ict.* FROM instrument_convergence_tracking ict
        WHERE ict.converged = 0
          AND ict.escalation_event_id IS NOT NULL
          AND ict.escalation_event_id NOT IN (
              SELECT related_proposal_id FROM proposals WHERE related_proposal_id IS NOT NULL
          )
    `).all();

    for (const row of unresolvedEscalations) {
        const eventId = recordReversionEvent({
            sourceGrade: 'psyche',
            targetGrade: 'psyche',
            eventType: 'self_audit_flag',
            causeType: 'efficient',
            relatedInstrumentId: row.instrument_id,
            outcome: 'noted',
            correctionNote: `Self-audit: convergence escalation for instrument ${row.instrument_id} / task_type "${row.task_type}" has no follow-up proposal on record.`
        });
        flagged.push({ type: 'unresolved_escalation', instrumentId: row.instrument_id, eventId });
    }

    const staleOpenPairs = db.prepare(`
        SELECT * FROM contradiction_pairs
        WHERE resolved = 0 AND created_at <= datetime('now', '-60 days')
    `).all();

    for (const pair of staleOpenPairs) {
        const eventId = recordReversionEvent({
            sourceGrade: 'psyche',
            targetGrade: 'psyche',
            eventType: 'self_audit_flag',
            causeType: 'efficient',
            outcome: 'noted',
            correctionNote: `Self-audit: contradiction pair #${pair.id} has stood open over 60 days.`
        });
        flagged.push({ type: 'long_open_contradiction', pairId: pair.id, eventId });
    }

    return flagged;
}

function getHealthIndicators() {
    return db.prepare(`SELECT * FROM health_indicators`).get();
}

module.exports = { runSelfAudit, getHealthIndicators };
