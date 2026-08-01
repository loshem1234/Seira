const express = require('express');
const router = express.Router();
const db = require('../../lib/db');

// GET /api/archive/log?grade=&event_type=&cause_type=
router.get('/log', (req, res) => {
    const { grade, event_type, cause_type } = req.query;
    let sql = `SELECT * FROM archive_reversion_log WHERE 1=1`;
    const params = [];
    if (grade) { sql += ` AND (source_grade = ? OR target_grade = ?)`; params.push(grade, grade); }
    if (event_type) { sql += ` AND event_type = ?`; params.push(event_type); }
    if (cause_type) { sql += ` AND cause_type = ?`; params.push(cause_type); }
    sql += ` LIMIT 200`;
    res.json(db.prepare(sql).all(...params));
});

// GET /api/archive/derivation/:corpusEntryId
router.get('/derivation/:corpusEntryId', (req, res) => {
    const row = db.prepare(`SELECT * FROM archive_derivation WHERE corpus_entry_id = ?`).get(req.params.corpusEntryId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
});

// POST /api/archive/annotate  { targetTable, targetId, annotation }
router.post('/annotate', (req, res) => {
    const { targetTable, targetId, annotation } = req.body;
    if (!targetTable || !targetId || !annotation) {
        return res.status(400).json({ error: 'targetTable, targetId, and annotation are required' });
    }
    const result = db.prepare(`
        INSERT INTO archive_annotations (target_table, target_id, annotation) VALUES (?, ?, ?)
    `).run(targetTable, targetId, annotation);
    res.json({ id: result.lastInsertRowid });
});

router.get('/annotations/:targetTable/:targetId', (req, res) => {
    const rows = db.prepare(`
        SELECT * FROM archive_annotations WHERE target_table = ? AND target_id = ? ORDER BY created_at ASC
    `).all(req.params.targetTable, req.params.targetId);
    res.json(rows);
});

module.exports = router;
