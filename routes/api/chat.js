// lib/chat.js
// This is the actual interface a person talks to Seira through. It is
// deliberately built as an ordinary Instrument (Article 12): it does not
// originate doctrine, it executes a conversational paradigm shaped by
// whatever is currently at Intellect and Psyche, and everything it produces
// is written to the Corpus with a trace of derivation (Article 5).

const db = require('./db');
const { getCurrentIntellectVersion } = require('./parameters');
const { insertCorpusEntry } = require('./corpusRetention');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.SEIRA_CHAT_MODEL || 'claude-sonnet-5';

const CONVERSATION_TASK_TYPE = 'conversation';

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

function buildSystemPrompt() {
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
    return prompt;
}

function getRecentHistory(sessionId, limit = 20) {
    return db.prepare(`
        SELECT entry_type, content, created_at FROM corpus_entries
        WHERE session_id = ? ORDER BY created_at ASC LIMIT ?
    `).all(sessionId, limit);
}

async function callModel(systemPrompt, history, userMessage) {
    if (!ANTHROPIC_API_KEY) {
        return `(No ANTHROPIC_API_KEY configured — this is a placeholder reply so the conversation loop can still be tested end to end. Set ANTHROPIC_API_KEY to hear from Seira herself. You said: "${userMessage}")`;
    }

    const messages = history
        .filter(h => h.entry_type === 'ingestion' || h.entry_type === 'output')
        .map(h => ({
            role: h.entry_type === 'ingestion' ? 'user' : 'assistant',
            content: h.content
        }));
    messages.push({ role: 'user', content: userMessage });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 1024,
            system: systemPrompt,
            messages
        })
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
 */
async function converse({ sessionId, message }) {
    const instrument = getOrCreateConversationInstrument();
    const intellect = getCurrentIntellectVersion();
    const trace = JSON.stringify({
        instrument_id: instrument.id,
        instrument_name: instrument.name,
        intellect_version: intellect ? intellect.version_number : null
    });

    insertCorpusEntry({
        entryType: 'ingestion',
        content: message,
        instrumentId: instrument.id,
        traceOfDerivation: trace,
        sessionId
    });

    const history = getRecentHistory(sessionId);
    const systemPrompt = buildSystemPrompt();
    const reply = await callModel(systemPrompt, history, message);

    insertCorpusEntry({
        entryType: 'output',
        content: reply,
        instrumentId: instrument.id,
        traceOfDerivation: trace,
        sessionId
    });

    return reply;
}

module.exports = { converse, getRecentHistory, getOrCreateConversationInstrument };
