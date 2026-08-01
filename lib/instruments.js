// lib/instruments.js
// Articles 12, 26, 34-37: the Instrument tree, local feedback vs. genuine
// reversion, the convergence-failure escalation trigger, spawning rights
// (Psyche only), retirement, and skills.

const db = require('./db');
const { recordReversionEvent } = require('./reversion');
const { getParam } = require('./parameters');

function getDepth(parentInstrumentId) {
    if (!parentInstrumentId) return 0;
    const parent = db.prepare(`SELECT depth FROM instruments WHERE id = ?`).get(parentInstrumentId);
    if (!parent) throw new Error('Parent instrument not found');
    return parent.depth + 1;
}

/**
 * Article 35: spawning is an efficient-cause act of Psyche alone. This
 * function represents Psyche's own act of authorization — it should never
 * be called directly from an Instrument's own code path without having
 * first gone through a spawn-request reversion event.
 */
function spawnInstrument({ name, taskType, paradigmDescription, parentInstrumentId = null, spawnedViaReversionEventId = null }) {
    const depth = getDepth(parentInstrumentId);
    const maxDepth = getParam('instrument_tree_max_depth', 4);
    if (depth > maxDepth) {
        throw new Error(`Article 34: instrument tree depth limit (${maxDepth}) exceeded at depth ${depth}.`);
    }

    const result = db.prepare(`
        INSERT INTO instruments (parent_instrument_id, name, task_type, paradigm_description, depth, spawned_via_reversion_event_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(parentInstrumentId, name, taskType, paradigmDescription, depth, spawnedViaReversionEventId);

    return result.lastInsertRowid;
}

function requestSpawn({ requestingInstrumentId, proposedName, proposedTaskType, reason }) {
    // Article 35: the requesting Instrument may only SURFACE the need.
    // It logs a reversion event; Psyche (a human operator or a Psyche-tier
    // process reviewing this queue) must call spawnInstrument() explicitly
    // to actually authorize it. This function never creates an Instrument.
    const eventId = recordReversionEvent({
        sourceGrade: 'instrument',
        targetGrade: 'psyche',
        eventType: 'spawn_request',
        causeType: 'instrumental',
        relatedInstrumentId: requestingInstrumentId,
        outcome: 'pending',
        correctionNote: JSON.stringify({ proposedName, proposedTaskType, reason })
    });
    return eventId;
}

function retireInstrument(instrumentId) {
    db.prepare(`
        UPDATE instruments SET status = 'retired', retired_at = datetime('now') WHERE id = ?
    `).run(instrumentId);
}

/**
 * Article 15/26: record a local feedback event (retry/reformulation within
 * bounds) for a given instrument+task_type. This does NOT itself constitute
 * reversion. It increments the rolling-window counter and checks the
 * failure-to-converge trigger.
 *
 * Returns { escalated: boolean, reversionEventId?: number }
 */
function recordLocalFeedback({ instrumentId, taskType }) {
    const windowDays = getParam('convergence_window_days', 14);
    const threshold = getParam('convergence_failure_threshold', 3);

    let tracking = db.prepare(`
        SELECT * FROM instrument_convergence_tracking
        WHERE instrument_id = ? AND task_type = ?
        ORDER BY id DESC LIMIT 1
    `).get(instrumentId, taskType);

    const now = new Date();
    const windowExpired = tracking &&
        (now - new Date(tracking.window_started_at)) > windowDays * 24 * 60 * 60 * 1000;

    if (!tracking || windowExpired || !tracking.converged) {
        // start a fresh tracking window if none exists, the old one expired,
        // or the prior window already escalated and this is a new episode
        if (!tracking || windowExpired) {
            const result = db.prepare(`
                INSERT INTO instrument_convergence_tracking (instrument_id, task_type, local_feedback_count, converged)
                VALUES (?, ?, 1, 1)
            `).run(instrumentId, taskType);
            tracking = db.prepare(`SELECT * FROM instrument_convergence_tracking WHERE id = ?`).get(result.lastInsertRowid);
        } else {
            db.prepare(`
                UPDATE instrument_convergence_tracking SET local_feedback_count = local_feedback_count + 1
                WHERE id = ?
            `).run(tracking.id);
            tracking = db.prepare(`SELECT * FROM instrument_convergence_tracking WHERE id = ?`).get(tracking.id);
        }
    } else {
        db.prepare(`
            UPDATE instrument_convergence_tracking SET local_feedback_count = local_feedback_count + 1
            WHERE id = ?
        `).run(tracking.id);
        tracking = db.prepare(`SELECT * FROM instrument_convergence_tracking WHERE id = ?`).get(tracking.id);
    }

    if (tracking.local_feedback_count >= threshold && tracking.converged) {
        // Article 26: failure to converge -> automatic reversion event,
        // tagged as instrument-initiated.
        const eventId = recordReversionEvent({
            sourceGrade: 'instrument',
            targetGrade: 'psyche',
            eventType: 'convergence_escalation',
            causeType: 'instrumental',
            relatedInstrumentId: instrumentId,
            outcome: 'pending',
            correctionNote: `Non-convergence: task_type="${taskType}" reached ${tracking.local_feedback_count} local-feedback invocations within the configured window without a clean run.`
        });
        db.prepare(`
            UPDATE instrument_convergence_tracking
            SET converged = 0, escalated_at = datetime('now'), escalation_event_id = ?
            WHERE id = ?
        `).run(eventId, tracking.id);
        return { escalated: true, reversionEventId: eventId };
    }

    return { escalated: false };
}

/** Mark a clean run, which resets the local-feedback counter for that window. */
function recordCleanRun({ instrumentId, taskType }) {
    const tracking = db.prepare(`
        SELECT * FROM instrument_convergence_tracking
        WHERE instrument_id = ? AND task_type = ? ORDER BY id DESC LIMIT 1
    `).get(instrumentId, taskType);
    if (tracking) {
        db.prepare(`
            UPDATE instrument_convergence_tracking
            SET last_clean_run_at = datetime('now'), local_feedback_count = 0, converged = 1
            WHERE id = ?
        `).run(tracking.id);
    }
}

function getGenealogyTree() {
    const all = db.prepare(`SELECT * FROM instruments ORDER BY depth ASC, id ASC`).all();
    const byId = {};
    all.forEach(i => { byId[i.id] = { ...i, children: [] }; });
    const roots = [];
    all.forEach(i => {
        if (i.parent_instrument_id && byId[i.parent_instrument_id]) {
            byId[i.parent_instrument_id].children.push(byId[i.id]);
        } else {
            roots.push(byId[i.id]);
        }
    });
    return roots;
}

// ---- Skills (Article 37) ----

function authorizeSkill({ name, procedureContent, authorizedByReversionEventId }) {
    return db.prepare(`
        INSERT INTO skills (name, procedure_content, authorized_by_reversion_event_id)
        VALUES (?, ?, ?)
    `).run(name, procedureContent, authorizedByReversionEventId).lastInsertRowid;
}

function reviseSkill(existingSkillId, { procedureContent, authorizedByReversionEventId }) {
    const existing = db.prepare(`SELECT * FROM skills WHERE id = ?`).get(existingSkillId);
    if (!existing) throw new Error('Skill not found');
    const tx = db.transaction(() => {
        db.prepare(`UPDATE skills SET status = 'superseded' WHERE id = ?`).run(existingSkillId);
        const newId = db.prepare(`
            INSERT INTO skills (name, version_number, procedure_content, authorized_by_reversion_event_id)
            VALUES (?, ?, ?, ?)
        `).run(existing.name, existing.version_number + 1, procedureContent, authorizedByReversionEventId).lastInsertRowid;
        db.prepare(`UPDATE skills SET superseded_by_skill_id = ? WHERE id = ?`).run(newId, existingSkillId);
        return newId;
    });
    return tx();
}

function grantSkillToInstrument(instrumentId, skillId) {
    db.prepare(`INSERT OR IGNORE INTO instrument_skills (instrument_id, skill_id) VALUES (?, ?)`).run(instrumentId, skillId);
}

module.exports = {
    spawnInstrument, requestSpawn, retireInstrument,
    recordLocalFeedback, recordCleanRun,
    getGenealogyTree,
    authorizeSkill, reviseSkill, grantSkillToInstrument
};
