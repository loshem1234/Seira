const express = require('express');
const router = express.Router();
const db = require('../../lib/db');
const instruments = require('../../lib/instruments');

router.get('/tree', (req, res) => {
    res.json(instruments.getGenealogyTree());
});

router.post('/spawn', (req, res) => {
    // Article 35: this route represents Psyche's own act of authorization.
    // In a real deployment this should sit behind whatever auth
    // distinguishes "Psyche-tier process or Architect" from an
    // Instrument's own automated code path.
    try {
        const id = instruments.spawnInstrument(req.body);
        res.json({ id });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/request-spawn', (req, res) => {
    const eventId = instruments.requestSpawn({
        requestingInstrumentId: req.params.id,
        proposedName: req.body.proposedName,
        proposedTaskType: req.body.proposedTaskType,
        reason: req.body.reason
    });
    res.json({ reversionEventId: eventId });
});

router.post('/:id/retire', (req, res) => {
    instruments.retireInstrument(req.params.id);
    res.json({ ok: true });
});

router.post('/:id/local-feedback', (req, res) => {
    const result = instruments.recordLocalFeedback({
        instrumentId: req.params.id,
        taskType: req.body.taskType
    });
    res.json(result);
});

router.post('/:id/clean-run', (req, res) => {
    instruments.recordCleanRun({ instrumentId: req.params.id, taskType: req.body.taskType });
    res.json({ ok: true });
});

router.get('/:id/skills', (req, res) => {
    const rows = db.prepare(`
        SELECT s.* FROM skills s
        JOIN instrument_skills iskill ON iskill.skill_id = s.id
        WHERE iskill.instrument_id = ? AND s.status = 'current'
    `).all(req.params.id);
    res.json(rows);
});

module.exports = router;
