// lib/reversion.js
// Article 7: reversion is the specific act by which a lower grade turns
// back upon the higher grade that produced it. Every transition of any
// kind, anywhere in Seira, gets exactly one row here. This is the table
// the Archive's derivation and causal-register views (Article 38) are
// built from.

const db = require('./db');

const VALID_SOURCE = ['corpus', 'instrument', 'psyche', 'intellect'];
const VALID_TARGET = ['instrument', 'psyche', 'intellect'];
const VALID_EVENT_TYPE = [
    'convergence_escalation', 'self_audit_flag', 'proposal_created',
    'proposal_resolved', 'dispensation', 'spawn_request', 'other'
];
const VALID_CAUSE = ['paradigmatic', 'final', 'efficient', 'instrumental', 'formal', 'material'];

function recordReversionEvent({
    sourceGrade, targetGrade, eventType, causeType,
    relatedProposalId = null, relatedInstrumentId = null,
    outcome = 'pending', correctionNote = null
}) {
    if (!VALID_SOURCE.includes(sourceGrade)) throw new Error(`Invalid source_grade: ${sourceGrade}`);
    if (!VALID_TARGET.includes(targetGrade)) throw new Error(`Invalid target_grade: ${targetGrade}`);
    if (!VALID_EVENT_TYPE.includes(eventType)) throw new Error(`Invalid event_type: ${eventType}`);
    if (!VALID_CAUSE.includes(causeType)) throw new Error(`Invalid cause_type: ${causeType}`);

    const stmt = db.prepare(`
        INSERT INTO reversion_events
            (source_grade, target_grade, event_type, cause_type,
             related_proposal_id, related_instrument_id, outcome, correction_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        sourceGrade, targetGrade, eventType, causeType,
        relatedProposalId, relatedInstrumentId, outcome, correctionNote
    );
    return result.lastInsertRowid;
}

function setOutcome(reversionEventId, outcome, correctionNote = null) {
    db.prepare(`
        UPDATE reversion_events SET outcome = ?, correction_note = ? WHERE id = ?
    `).run(outcome, correctionNote, reversionEventId);
}

module.exports = { recordReversionEvent, setOutcome, VALID_CAUSE, VALID_EVENT_TYPE };
