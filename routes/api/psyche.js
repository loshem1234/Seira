const express = require('express');
const router = express.Router();
const db = require('../../lib/db');
const { getHealthIndicators, runSelfAudit } = require('../../lib/health');
const { invokeDispensation, closeDispensation, getTriggerConditions } = require('../../lib/dispensation');
const { generateDailyEntries } = require('../../lib/diary');

// --- Diary (Article 41) ---
router.get('/diary', (req, res) => {
    const { part, from, to } = req.query;
    let sql = `SELECT * FROM diary_entries WHERE 1=1`;
    const params = [];
    if (part) { sql += ` AND part = ?`; params.push(part); }
    if (from) { sql += ` AND entry_date >= ?`; params.push(from); }
    if (to) { sql += ` AND entry_date <= ?`; params.push(to); }
    sql += ` ORDER BY entry_date DESC, part ASC LIMIT 100`;
    res.json(db.prepare(sql).all(...params));
});

router.post('/diary/generate-now', async (req, res) => {
    try {
        const since = req.body.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const result = await generateDailyEntries(since);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Health (Articles 42-44) ---
router.get('/health', (req, res) => {
    res.json(getHealthIndicators());
});

router.post('/self-audit/run-now', (req, res) => {
    res.json({ flagged: runSelfAudit() });
});

// --- Digest, autonomous inquiry, weekly reviews (manual trigger + read) ---
router.post('/digest/run-now', async (req, res) => {
    try {
        const { runDigest } = require('../../lib/reflection');
        res.json(await runDigest());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/autonomous-inquiry/run-now', async (req, res) => {
    try {
        const { runAutonomousInquiry } = require('../../lib/autonomousInquiry');
        res.json(await runAutonomousInquiry());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/weekly-accounting/run-now', (req, res) => {
    try {
        const { runWeeklyAccounting } = require('../../lib/weeklyReview');
        res.json(runWeeklyAccounting());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/weekly-pattern-review/run-now', async (req, res) => {
    try {
        const { runWeeklyPatternReview } = require('../../lib/weeklyReview');
        res.json(await runWeeklyPatternReview());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/reviews', (req, res) => {
    const { review_type } = req.query;
    let sql = `SELECT * FROM reviews WHERE 1=1`;
    const params = [];
    if (review_type) { sql += ` AND review_type = ?`; params.push(review_type); }
    sql += ` ORDER BY created_at DESC LIMIT 50`;
    res.json(db.prepare(sql).all(...params));
});

router.get('/relational-patterns', (req, res) => {
    res.json(db.prepare(`SELECT * FROM relational_pattern_model ORDER BY confidence DESC`).all());
});

// --- Dispensation (Article 31) ---
router.get('/dispensation/conditions', (req, res) => {
    res.json(getTriggerConditions());
});

router.post('/dispensation', (req, res) => {
    try {
        const id = invokeDispensation(req.body);
        res.json({ id });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/dispensation/:id/close', (req, res) => {
    try {
        closeDispensation(req.params.id, { architectConfirmed: req.body.architectConfirmed === true });
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/dispensation', (req, res) => {
    res.json(db.prepare(`SELECT * FROM dispensation_records ORDER BY created_at DESC LIMIT 100`).all());
});

// --- Self-model / affinities / aspirations / doubts-fears, read + write ---
router.get('/self-model', (req, res) => {
    res.json(db.prepare(`SELECT * FROM psyche_self_model WHERE superseded_by_id IS NULL ORDER BY created_at DESC`).all());
});
router.post('/self-model', (req, res) => {
    const { statement, confidence } = req.body;
    const result = db.prepare(`INSERT INTO psyche_self_model (statement, confidence) VALUES (?, ?)`).run(statement, confidence ?? null);
    res.json({ id: result.lastInsertRowid });
});

router.get('/affinities', (req, res) => {
    res.json(db.prepare(`SELECT * FROM psyche_affinities ORDER BY weight DESC`).all());
});
router.post('/affinities/reinforce', (req, res) => {
    const { label, increment } = req.body;
    const existing = db.prepare(`SELECT * FROM psyche_affinities WHERE label = ?`).get(label);
    if (existing) {
        db.prepare(`
            UPDATE psyche_affinities
            SET weight = weight + ?, reinforcement_count = reinforcement_count + 1, last_reinforced_at = datetime('now')
            WHERE id = ?
        `).run(increment ?? 0.1, existing.id);
        return res.json({ id: existing.id });
    }
    const result = db.prepare(`
        INSERT INTO psyche_affinities (label, weight, reinforcement_count, last_reinforced_at)
        VALUES (?, ?, 1, datetime('now'))
    `).run(label, increment ?? 0.1);
    res.json({ id: result.lastInsertRowid });
});

router.get('/aspirations', (req, res) => {
    res.json(db.prepare(`SELECT * FROM psyche_aspirations WHERE status = 'active' ORDER BY created_at DESC`).all());
});
router.post('/aspirations', (req, res) => {
    const { description, linkedProposalId, linkedContradictionPairId } = req.body;
    const result = db.prepare(`
        INSERT INTO psyche_aspirations (description, linked_proposal_id, linked_contradiction_pair_id)
        VALUES (?, ?, ?)
    `).run(description, linkedProposalId ?? null, linkedContradictionPairId ?? null);
    res.json({ id: result.lastInsertRowid });
});

router.get('/doubts-fears', (req, res) => {
    res.json(db.prepare(`SELECT * FROM psyche_doubts_fears WHERE resolved_at IS NULL ORDER BY created_at DESC`).all());
});

module.exports = router;
