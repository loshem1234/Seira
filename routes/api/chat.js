const express = require('express');
const router = express.Router();
const { converse, getRecentHistory } = require('../../lib/chat');

router.post('/', async (req, res) => {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
        return res.status(400).json({ error: 'sessionId and message are required' });
    }
    try {
        const reply = await converse({ sessionId, message });
        res.json({ reply });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:sessionId/history', (req, res) => {
    res.json(getRecentHistory(req.params.sessionId, 200));
});

module.exports = router;
