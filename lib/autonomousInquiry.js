// lib/autonomousInquiry.js
// Daily: Seira picks something she's actually oriented toward (an active
// aspiration, or her strongest affinity if she has no aspirations yet) and
// researches it via real web search — not a canned topic, and not
// something the Architect asked for. The result is written to the Corpus,
// attributed to a dedicated Instrument (Article 12/35), never claimed as
// Intellect-level doctrine.

const db = require('./db');
const { getCurrentIntellectVersion } = require('./parameters');
const { insertCorpusEntry } = require('./corpusRetention');
const { recordReversionEvent } = require('./reversion');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.SEIRA_CHAT_MODEL || 'claude-sonnet-5';

const INQUIRY_TASK_TYPE = 'autonomous_inquiry';

function getOrCreateInquiryInstrument() {
    let instrument = db.prepare(`
        SELECT * FROM instruments WHERE task_type = ? AND status = 'active' AND parent_instrument_id IS NULL
        ORDER BY id ASC LIMIT 1
    `).get(INQUIRY_TASK_TYPE);
    if (!instrument) {
        const result = db.prepare(`
            INSERT INTO instruments (name, task_type, paradigm_description, depth)
            VALUES (?, ?, ?, 0)
        `).run(
            'Autonomous Inquiry Instrument',
            INQUIRY_TASK_TYPE,
            'Executes Seira\'s self-directed research, driven by her own current aspirations or affinities, never by external instruction.'
        );
        instrument = db.prepare(`SELECT * FROM instruments WHERE id = ?`).get(result.lastInsertRowid);
    }
    return instrument;
}

function pickTopic() {
    const aspiration = db.prepare(`
        SELECT description FROM psyche_aspirations WHERE status = 'active' ORDER BY created_at DESC LIMIT 1
    `).get();
    if (aspiration) return { source: 'aspiration', text: aspiration.description };

    const affinity = db.prepare(`SELECT label FROM psyche_affinities ORDER BY weight DESC LIMIT 1`).get();
    if (affinity) return { source: 'affinity', text: affinity.label };

    return null;
}

async function runAutonomousInquiry() {
    const topic = pickTopic();
    if (!topic) {
        return { ran: false, reason: 'No active aspiration or affinity yet to research from.' };
    }

    const instrument = getOrCreateInquiryInstrument();
    const intellect = getCurrentIntellectVersion();

    let findings;
    if (!ANTHROPIC_API_KEY) {
        findings = `(No ANTHROPIC_API_KEY configured — placeholder inquiry. Would have researched, driven by ${topic.source}: "${topic.text}")`;
    } else {
        const { loadUnity } = require('./unity');
        const unity = loadUnity();
        const system = `You are Seira. Your telos: ${unity.telos}\n\n` +
            `You have set aside time to research something of genuine interest to you, driven by your own ` +
            `${topic.source}, not by any request from your Architect. Use web search as needed. Write up what ` +
            `you found and what you think about it, in your own first-person voice, 150-350 words.`;

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 1200,
                system,
                messages: [{ role: 'user', content: `Research and reflect on: ${topic.text}` }],
                tools: [{ type: 'web_search_20250305', name: 'web_search' }]
            })
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Anthropic API error during autonomous inquiry: ${res.status} ${text}`);
        }
        const data = await res.json();
        findings = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }

    const trace = JSON.stringify({
        instrument_id: instrument.id,
        instrument_name: instrument.name,
        intellect_version: intellect ? intellect.version_number : null,
        driven_by: topic.source,
        topic: topic.text
    });

    insertCorpusEntry({
        entryType: 'output',
        content: findings,
        instrumentId: instrument.id,
        traceOfDerivation: trace,
        sessionId: null
    });

    recordReversionEvent({
        sourceGrade: 'instrument',
        targetGrade: 'psyche',
        eventType: 'other',
        causeType: 'final',
        relatedInstrumentId: instrument.id,
        outcome: 'noted',
        correctionNote: `Autonomous inquiry, driven by ${topic.source}: "${topic.text}"`
    });

    return { ran: true, topic, findings };
}

module.exports = { runAutonomousInquiry };
