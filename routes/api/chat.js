const express = require('express');
const router = express.Router();
const chat = require('../../lib/chat');
const pdfParse = require('pdf-parse');

// --- Document extraction (Article: Instrument executing, not originating -
// this is pure mechanical extraction, no interpretation) ---

router.post('/extract-pdf', async (req, res) => {
    const { fileBase64 } = req.body;
    if (!fileBase64) return res.status(400).json({ error: 'fileBase64 is required' });
    try {
        const buffer = Buffer.from(fileBase64, 'base64');
        const data = await pdfParse(buffer);
        res.json({ text: data.text, pages: data.numpages });
    } catch (err) {
        res.status(400).json({ error: 'Could not extract text from that PDF: ' + err.message });
    }
});

// --- Conversations (sidebar) ---

router.get('/conversations', (req, res) => {
    res.json(chat.listConversations());
});

router.post('/conversations', (req, res) => {
    res.json(chat.createConversation());
});

router.post('/conversations/:id/rename', (req, res) => {
    const { title } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
    chat.renameConversation(req.params.id, title.trim());
    res.json({ ok: true });
});

router.delete('/conversations/:id', (req, res) => {
    chat.deleteConversation(req.params.id);
    res.json({ ok: true });
});

// --- Messaging ---

router.post('/', async (req, res) => {
    const { sessionId, message, model, webSearch, contemplation, attachedText } = req.body;
    if (!sessionId || !message) {
        return res.status(400).json({ error: 'sessionId and message are required' });
    }
    try {
        const reply = await chat.converse({
            sessionId,
            message,
            options: { model, webSearch: !!webSearch, contemplation: !!contemplation, attachedText }
        });
        res.json({ reply });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:sessionId/regenerate', async (req, res) => {
    const { model, webSearch, contemplation } = req.body;
    try {
        const reply = await chat.regenerate({ sessionId: req.params.sessionId, options: { model, webSearch: !!webSearch, contemplation: !!contemplation } });
        res.json({ reply });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/:sessionId/history', (req, res) => {
    res.json(chat.getRecentHistory(req.params.sessionId, 500));
});

router.get('/models', (req, res) => {
    res.json(chat.ALLOWED_MODELS);
});

module.exports = router;
