// lib/proposals.js
// Articles 24-28: two proposal kinds (correction/expansion), the
// falsification bar, five legitimate terminal states, and ratification
// into a new, versioned Intellect entry.

const db = require('./db');
const { recordReversionEvent, setOutcome } = require('./reversion');
const { getCurrentIntellectVersion } = require('./parameters');

function createProposal({ proposalType, content, contestedIntellectVersionId = null, evidence = null, originatingReversionEventId = null }) {
    if (!['correction', 'expansion'].includes(proposalType)) {
        throw new Error(`Invalid proposal_type: ${proposalType}`);
    }
    if (proposalType === 'correction' && !contestedIntellectVersionId) {
        throw new Error('Article 24: a correction proposal requires contestedIntellectVersionId.');
    }
    if (proposalType === 'expansion' && contestedIntellectVersionId) {
        throw new Error('Article 24: an expansion proposal must not reference contested content.');
    }

    const stmt = db.prepare(`
        INSERT INTO proposals
            (proposal_type, content, contested_intellect_version_id, evidence, originating_reversion_event_id)
        VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(proposalType, content, contestedIntellectVersionId, evidence, originatingReversionEventId);
    const proposalId = result.lastInsertRowid;

    recordReversionEvent({
        sourceGrade: 'psyche',
        targetGrade: 'intellect',
        eventType: 'proposal_created',
        causeType: proposalType === 'correction' ? 'final' : 'paradigmatic',
        relatedProposalId: proposalId,
        outcome: 'pending'
    });

    return proposalId;
}

/**
 * Article 25 condition 2: a deliberate attempt to break the hypothesis,
 * required to run in the private rehearsal space (Article 39) before any
 * promotion is possible.
 */
function recordFalsificationAttempt({ proposalId, method, result, notes = null, runInRehearsalSpace = true }) {
    if (!['survived', 'falsified', 'inconclusive'].includes(result)) {
        throw new Error(`Invalid falsification result: ${result}`);
    }
    const stmt = db.prepare(`
        INSERT INTO falsification_attempts (proposal_id, method, run_in_rehearsal_space, result, notes)
        VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(proposalId, method, runInRehearsalSpace ? 1 : 0, result, notes).lastInsertRowid;
}

function hasSurvivedFalsification(proposalId) {
    const attempts = db.prepare(`
        SELECT * FROM falsification_attempts WHERE proposal_id = ? ORDER BY created_at DESC
    `).all(proposalId);
    if (attempts.length === 0) return false;
    // Article 25.2: at least one deliberate attempt, and it must have survived.
    // A proposal with any 'falsified' result among genuine attempts and no
    // later survival is not eligible.
    const anyFalsified = attempts.some(a => a.result === 'falsified');
    const anySurvived = attempts.some(a => a.result === 'survived');
    return anySurvived && !anyFalsified;
}

/** Reject a proposal outright — falsification failed. */
function rejectProposal(proposalId) {
    db.prepare(`UPDATE proposals SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?`).run(proposalId);
    _logResolution(proposalId, 'rejected');
}

/** Mark a proposal withdrawn — Psyche sets it aside voluntarily. */
function withdrawProposal(proposalId) {
    db.prepare(`UPDATE proposals SET status = 'withdrawn', resolved_at = datetime('now') WHERE id = ?`).run(proposalId);
    _logResolution(proposalId, 'withdrawn');
}

/** Mark an expansion proposal stale — evidence stopped arriving before falsification completed. */
function markStale(proposalId) {
    const p = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(proposalId);
    if (!p) throw new Error('Proposal not found');
    if (p.proposal_type !== 'expansion') {
        throw new Error('Article 25: only expansion proposals may be marked stale.');
    }
    db.prepare(`UPDATE proposals SET status = 'stale', resolved_at = datetime('now') WHERE id = ?`).run(proposalId);
    _logResolution(proposalId, 'noted');
}

/**
 * Suspend a pair of mutually-surviving, contradicting proposals (Article 25).
 * Both must have independently survived falsification; neither is promoted
 * or rejected; the tension is recorded honestly rather than forced closed.
 */
function suspendAsContradictionPair(proposalAId, proposalBId, note = null) {
    if (proposalAId === proposalBId) throw new Error('A proposal cannot contradict itself.');
    const a = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(proposalAId);
    const b = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(proposalBId);
    if (!hasSurvivedFalsification(proposalAId) || !hasSurvivedFalsification(proposalBId)) {
        throw new Error('Article 25: both proposals must have survived falsification to be suspended as a pair.');
    }
    const pairId = db.prepare(`
        INSERT INTO contradiction_pairs (proposal_a_id, proposal_b_id, resolution_note)
        VALUES (?, ?, ?)
    `).run(proposalAId, proposalBId, note).lastInsertRowid;

    db.prepare(`UPDATE proposals SET status = 'suspended' WHERE id IN (?, ?)`).run(proposalAId, proposalBId);
    _logResolution(proposalAId, 'noted');
    _logResolution(proposalBId, 'noted');
    return pairId;
}

function resolveContradictionPair(pairId, resolutionNote) {
    db.prepare(`
        UPDATE contradiction_pairs SET resolved = 1, resolution_note = ?, resolved_at = datetime('now')
        WHERE id = ?
    `).run(resolutionNote, pairId);
}

/**
 * Article 27/28: promote a proposal into a new, versioned Intellect entry.
 * Requires explicit Architect ratification — this function should only be
 * called from a code path gated behind that human confirmation, never
 * automatically from a cron job or an Instrument.
 */
function ratifyAndPromote(proposalId, { architectConfirmed }) {
    if (!architectConfirmed) {
        throw new Error('Article 27: promotion requires explicit Architect ratification.');
    }
    const proposal = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(proposalId);
    if (!proposal) throw new Error('Proposal not found');
    if (!hasSurvivedFalsification(proposalId)) {
        throw new Error('Article 25: proposal has not survived falsification and cannot be promoted.');
    }

    const current = getCurrentIntellectVersion();
    const nextVersionNumber = current ? current.version_number + 1 : 1;

    const tx = db.transaction(() => {
        if (current) {
            db.prepare(`UPDATE intellect_versions SET status = 'superseded' WHERE id = ?`).run(current.id);
        }
        const newVersionId = db.prepare(`
            INSERT INTO intellect_versions
                (version_number, content, status, origin_type, origin_proposal_id, ratified_at)
            VALUES (?, ?, 'current', ?, ?, datetime('now'))
        `).run(
            nextVersionNumber,
            proposal.content,
            proposal.proposal_type, // 'correction' | 'expansion'
            proposalId
        ).lastInsertRowid;

        // carry forward existing doctrinal parameters to the new version
        if (current) {
            const params = db.prepare(`SELECT param_key, param_value FROM intellect_parameters WHERE intellect_version_id = ?`).all(current.id);
            const insertParam = db.prepare(`INSERT INTO intellect_parameters (intellect_version_id, param_key, param_value) VALUES (?, ?, ?)`);
            for (const p of params) insertParam.run(newVersionId, p.param_key, p.param_value);
        }

        db.prepare(`
            UPDATE proposals SET status = 'promoted', ratified_at = datetime('now'), resolved_at = datetime('now')
            WHERE id = ?
        `).run(proposalId);

        return newVersionId;
    });

    const newVersionId = tx();
    _logResolution(proposalId, 'promoted');
    return newVersionId;
}

/**
 * Article 28: restore a prior Intellect version. This creates a NEW
 * version whose content matches the restored one — it never deletes or
 * resurrects the intervening, mistaken version.
 */
function restorePriorVersion(versionIdToRestore, { architectConfirmed }) {
    if (!architectConfirmed) {
        throw new Error('Article 28: restoration requires explicit Architect ratification.');
    }
    const toRestore = db.prepare(`SELECT * FROM intellect_versions WHERE id = ?`).get(versionIdToRestore);
    if (!toRestore) throw new Error('Version not found');
    const current = getCurrentIntellectVersion();
    const nextVersionNumber = current ? current.version_number + 1 : 1;

    const tx = db.transaction(() => {
        if (current) {
            db.prepare(`UPDATE intellect_versions SET status = 'superseded' WHERE id = ?`).run(current.id);
        }
        return db.prepare(`
            INSERT INTO intellect_versions
                (version_number, content, status, origin_type, restored_from_version, ratified_at)
            VALUES (?, ?, 'current', 'restoration', ?, datetime('now'))
        `).run(nextVersionNumber, toRestore.content, toRestore.version_number).lastInsertRowid;
    });

    return tx();
}

function _logResolution(proposalId, outcome) {
    recordReversionEvent({
        sourceGrade: 'psyche',
        targetGrade: 'intellect',
        eventType: 'proposal_resolved',
        causeType: 'efficient',
        relatedProposalId: proposalId,
        outcome
    });
}

module.exports = {
    createProposal,
    recordFalsificationAttempt,
    hasSurvivedFalsification,
    rejectProposal,
    withdrawProposal,
    markStale,
    suspendAsContradictionPair,
    resolveContradictionPair,
    ratifyAndPromote,
    restorePriorVersion
};
