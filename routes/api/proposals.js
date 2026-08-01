const express = require('express');
const router = express.Router();
const db = require('../../lib/db');
const proposals = require('../../lib/proposals');

router.get('/', (req, res) => {
    const { status, proposal_type } = req.query;
    let sql = `SELECT * FROM proposals WHERE 1=1`;
    const params = [];
    if (status) { sql += ` AND status = ?`; params.push(status); }
    if (proposal_type) { sql += ` AND proposal_type = ?`; params.push(proposal_type); }
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
    try {
        const id = proposals.createProposal(req.body);
        res.json({ id });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/falsify', (req, res) => {
    try {
        const id = proposals.recordFalsificationAttempt({ proposalId: req.params.id, ...req.body });
        res.json({ id });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/reject', (req, res) => {
    proposals.rejectProposal(req.params.id);
    res.json({ ok: true });
});

router.post('/:id/withdraw', (req, res) => {
    proposals.withdrawProposal(req.params.id);
    res.json({ ok: true });
});

router.post('/:id/mark-stale', (req, res) => {
    try {
        proposals.markStale(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/suspend-pair', (req, res) => {
    try {
        const pairId = proposals.suspendAsContradictionPair(req.body.proposalAId, req.body.proposalBId, req.body.note);
        res.json({ pairId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Article 27: promotion requires an explicit, human-confirmed action.
// architectConfirmed must be sent true from a UI step that actually made
// the Architect confirm — this endpoint does not itself constitute that
// confirmation.
router.post('/:id/ratify', (req, res) => {
    try {
        const newVersionId = proposals.ratifyAndPromote(req.params.id, { architectConfirmed: req.body.architectConfirmed === true });
        res.json({ newVersionId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/restore-version/:versionId', (req, res) => {
    try {
        const newVersionId = proposals.restorePriorVersion(req.params.versionId, { architectConfirmed: req.body.architectConfirmed === true });
        res.json({ newVersionId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
