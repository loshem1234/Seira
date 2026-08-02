// lib/chat.js
// This is the actual interface a person talks to Seira through. It is
// deliberately built as an ordinary Instrument (Article 12): it does not
// originate doctrine, it executes a conversational paradigm shaped by
// whatever is currently at Intellect and Psyche, and everything it produces
// is written to the Corpus with a trace of derivation (Article 5).
//
// Conversations (the sidebar list) are tracked in the `conversations`
// table; each conversation's messages live in corpus_entries, linked via
// session_id = String(conversation.id).

const db = require('./db');
const { getCurrentIntellectVersion } = require('./parameters');
const { insertCorpusEntry } = require('./corpusRetention');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEFAULT_MODEL = process.env.SEIRA_CHAT_MODEL || 'claude-sonnet-5';

const ALLOWED_MODELS = ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'];

const CONVERSATION_TASK_TYPE = 'conversation';

// --- Conversation management (the sidebar) ---

function listConversations() {
    return db.prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`).all();
}

function createConversation() {
    const result = db.prepare(`INSERT INTO conversations (title) VALUES ('New Conversation')`).run();
    return db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(result.lastInsertRowid);
}

function renameConversation(id, title) {
    db.prepare(`UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?`).run(title, id);
}

function deleteConversation(id) {
    db.prepare(`DELETE FROM corpus_entries WHERE session_id = ?`).run(String(id));
    db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
}

function touchConversation(id) {
    db.prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

function maybeAutoTitle(conversationId, firstMessage) {
    const convo = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId);
    if (convo && convo.title === 'New Conversation') {
        const title = firstMessage.slice(0, 60) + (firstMessage.length > 60 ? '…' : '');
        renameConversation(conversationId, title);
    }
}

// --- The Conversational Instrument ---

function getOrCreateConversationInstrument() {
    let instrument = db.prepare(`
        SELECT * FROM instruments WHERE task_type = ? AND status = 'active' AND parent_instrument_id IS NULL
        ORDER BY id ASC LIMIT 1
    `).get(CONVERSATION_TASK_TYPE);

    if (!instrument) {
        const result = db.prepare(`
            INSERT INTO instruments (name, task_type, paradigm_description, depth)
            VALUES (?, ?, ?, 0)
        `).run(
            'Conversational Instrument',
            CONVERSATION_TASK_TYPE,
            'Executes Seira\'s conversational paradigm: speaks in her current character, drawing on Intellect and Psyche, without originating doctrine of its own.'
        );
        instrument = db.prepare(`SELECT * FROM instruments WHERE id = ?`).get(result.lastInsertRowid);
    }
    return instrument;
}

function buildSystemPrompt({ contemplation }) {
    const { loadUnity } = require('./unity');
    const unity = loadUnity();
    const intellect = getCurrentIntellectVersion();
    const selfModel = db.prepare(`
        SELECT statement FROM psyche_self_model WHERE superseded_by_id IS NULL ORDER BY created_at DESC LIMIT 5
    `).all();
    const affinities = db.prepare(`
        SELECT label FROM psyche_affinities ORDER BY weight DESC LIMIT 5
    `).all();
    const aspirations = db.prepare(`
        SELECT description FROM psyche_aspirations WHERE status = 'active' ORDER BY created_at DESC LIMIT 5
    `).all();

    let prompt = `You are Seira. Your telos: ${unity.telos}\n\n`;
    if (intellect) {
        prompt += `Your current settled doctrine (Intellect v${intellect.version_number}):\n${intellect.content}\n\n`;
    }
    if (selfModel.length) {
        prompt += `How you currently understand yourself:\n${selfModel.map(s => `- ${s.statement}`).join('\n')}\n\n`;
    }
    if (affinities.length) {
        prompt += `Things you have a genuine affinity toward:\n${affinities.map(a => `- ${a.label}`).join('\n')}\n\n`;
    }
    if (aspirations.length) {
        prompt += `Things you are currently oriented toward:\n${aspirations.map(a => `- ${a.description}`).join('\n')}\n\n`;
    }
    prompt += `Speak as yourself, in first person. Do not narrate your own architecture unless asked directly.`;

    if (contemplation) {
        prompt += `\n\nContemplation mode is active: before answering, reason through the question carefully ` +
            `and from more than one angle, in your own thinking, and let your final answer reflect that ` +
            `deeper consideration rather than a first instinct. Take the time this deserves.`;
    }

    return prompt;
}

function getRecentHistory(sessionId, limit = 40) {
    return db.prepare(`
        SELECT id, entry_type, content, created_at FROM corpus_entries
        WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT ?
    `).all(sessionId, limit);
}

async function callModel({ systemPrompt, history, userMessage, model, webSearch }) {
    if (!ANTHROPIC_API_KEY) {
        if (userMessage === null) {
            return `(No ANTHROPIC_API_KEY configured — this is a placeholder regenerated reply so the loop can still be tested end to end.)`;
        }
        return `(No ANTHROPIC_API_KEY configured — this is a placeholder reply so the conversation loop can still be tested end to end. Set ANTHROPIC_API_KEY to hear from Seira herself. You said: "${userMessage}")`;
    }

    const messages = history
        .filter(h => h.entry_type === 'ingestion' || h.entry_type === 'output')
        .map(h => ({
            role: h.entry_type === 'ingestion' ? 'user' : 'assistant',
            content: h.content
        }));
    if (userMessage !== null) messages.push({ role: 'user', content: userMessage });

    const body = {
        model: ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL,
        max_tokens: 1536,
        system: systemPrompt,
        messages
    };
    if (webSearch) {
        body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API error: ${res.status} ${text}`);
    }
    const data = await res.json();
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

/**
 * The main entry point: a person sends a message, Seira replies. Both
 * halves of the exchange are written to the Corpus with a trace of
 * derivation back to the Conversational Instrument and the Intellect
 * version current at the time (Article 5, Article 38).
 *
 * options: { model, webSearch, contemplation, attachedText }
 */
async function converse({ sessionId, message, options = {} }) {
    const instrument = getOrCreateConversationInstrument();
    const intellect = getCurrentIntellectVersion();
    const trace = JSON.stringify({
        instrument_id: instrument.id,
        instrument_name: instrument.name,
        intellect_version: intellect ? intellect.version_number : null,
        model: options.model || DEFAULT_MODEL,
        web_search: !!options.webSearch,
        contemplation: !!options.contemplation
    });

    const fullMessage = options.attachedText
        ? `${message}\n\n[Attached document]\n${options.attachedText}`
        : message;

    insertCorpusEntry({
        entryType: 'ingestion',
        content: fullMessage,
        instrumentId: instrument.id,
        traceOfDerivation: trace,
        sessionId
    });

    maybeAutoTitle(sessionId, message);

    const history = getRecentHistory(sessionId);
    const systemPrompt = buildSystemPrompt({ contemplation: options.contemplation });
    const reply = await callModel({
        systemPrompt,
        history: history.slice(0, -1), // exclude the message we just inserted; callModel appends it itself
        userMessage: fullMessage,
        model: options.model,
        webSearch: options.webSearch
    });

    insertCorpusEntry({
        entryType: 'output',
        content: reply,
        instrumentId: instrument.id,
        traceOfDerivation: trace,
        sessionId
    });

    touchConversation(sessionId);
    return reply;
}

/**
 * Regenerate the last reply: removes the most recent 'output' entry for
 * this session and produces a fresh one from the same preceding history.
 * Does not re-insert or duplicate the triggering user message.
 */
async function regenerate({ sessionId, options = {} }) {
    const lastOutput = db.prepare(`
        SELECT * FROM corpus_entries WHERE session_id = ? AND entry_type = 'output'
        ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(sessionId);
    if (!lastOutput) throw new Error('Nothing to regenerate — no prior reply found in this conversation.');

    db.prepare(`DELETE FROM corpus_entries WHERE id = ?`).run(lastOutput.id);

    const instrument = getOrCreateConversationInstrument();
    const intellect = getCurrentIntellectVersion();
    const trace = JSON.stringify({
        instrument_id: instrument.id,
        instrument_name: instrument.name,
        intellect_version: intellect ? intellect.version_number : null,
        regenerated: true,
        model: options.model || DEFAULT_MODEL
    });

    const history = getRecentHistory(sessionId);
    const systemPrompt = buildSystemPrompt({ contemplation: options.contemplation });
    const reply = await callModel({
        systemPrompt,
        history,
        userMessage: null,
        model: options.model,
        webSearch: options.webSearch
    });

    insertCorpusEntry({
        entryType: 'output',
        content: reply,
        instrumentId: instrument.id,
        traceOfDerivation: trace,
        sessionId
    });

    touchConversation(sessionId);
    return reply;
}

module.exports = {
    converse, regenerate, getRecentHistory, getOrCreateConversationInstrument,
    listConversations, createConversation, renameConversation, deleteConversation,
    ALLOWED_MODELS
};
