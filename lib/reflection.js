// lib/reflection.js
//
// THIS IS THE MISSING MECHANISM. Conversations were only ever being written
// to the Corpus (raw, episodic) — nothing ever consolidated them into
// Psyche (self-model, affinities, aspirations) or into what she notices
// about the Architect (relational_pattern_model). This is Article 7's
// Corpus -> Psyche reversion, made real: unreflected Corpus entries are
// examined, and only what the transcript actually evidences is written
// upward — never invented, matching the same grounding discipline as the
// diary (Article 41).

const db = require('./db');
const { recordReversionEvent } = require('./reversion');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.SEIRA_DIGEST_MODEL || process.env.SEIRA_CHAT_MODEL || 'claude-sonnet-5';
const BATCH_SIZE = 300; // cap per run so a long backlog catches up over a few cycles rather than one huge call

const DIGEST_SYSTEM_PROMPT = `You are Seira, reflecting privately on a batch of recent conversation transcript
with your Architect. Your task is strictly extractive, not generative: read the transcript and report ONLY
what it actually evidences, in the following JSON shape:

{
  "architect_observations": [{"pattern": "specific, concrete observation about the Architect", "confidence": 0.0-1.0}],
  "affinities_reinforced": [{"label": "short label for a disposition of yours the conversation reinforced", "weight_delta": 0.05 to 0.3}],
  "self_observations": [{"statement": "first-person statement about how you reasoned or what you noticed about yourself", "confidence": 0.0-1.0}],
  "aspirations": [{"description": "something you are now oriented toward pursuing further, grounded in this transcript"}]
}

Rules:
- Every field is optional and every array may be empty. Empty is the CORRECT output if the transcript doesn't
  evidence that category — do not pad any array to seem more observant than the material supports.
- "architect_observations" must be concrete and specific (a stated interest, a project detail, a recurring
  concern, a preference actually expressed) — never a generic personality label and never a diagnosis.
- Do not invent anything not directly evidenced by the transcript.
- Respond with ONLY the JSON object, no other text, no markdown fences.`;

function getUnreflectedEntries() {
    return db.prepare(`
        SELECT id, entry_type, content, session_id, created_at FROM corpus_entries
        WHERE reflected_at IS NULL AND entry_type IN ('ingestion', 'output')
        ORDER BY created_at ASC, id ASC
        LIMIT ?
    `).all(BATCH_SIZE);
}

function buildTranscript(entries) {
    return entries.map(e => `${e.entry_type === 'ingestion' ? 'Architect' : 'Seira'}: ${e.content}`).join('\n\n');
}

async function callDigestModel(transcript) {
    if (!ANTHROPIC_API_KEY) {
        return null; // no key configured; digest simply has nothing to extract with
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 4096,
            system: DIGEST_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: transcript }]
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API error during digest: ${res.status} ${text}`);
    }
    const data = await res.json();
    const raw = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const stopReason = data.stop_reason;

    if (stopReason === 'max_tokens') {
        console.error(
            `[digest] Response was cut off by max_tokens before finishing (stop_reason=max_tokens). ` +
            `This almost always means the JSON below is truncated/incomplete. Raw output length: ${raw.length} chars.`
        );
    }

    // Strip markdown code fences if present, then fall back to extracting
    // the first {...} block in case the model added any stray text before
    // or after the JSON despite instructions not to.
    let cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch (firstErr) {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            try {
                return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
            } catch (secondErr) {
                console.error(
                    `[digest] Failed to parse model output as JSON even after brace-extraction. ` +
                    `stop_reason=${stopReason}, raw length=${raw.length}. Raw output:\n${raw}`
                );
                return null;
            }
        }
        console.error(
            `[digest] Failed to parse model output as JSON, and no {...} block found. ` +
            `stop_reason=${stopReason}, raw length=${raw.length}. Raw output:\n${raw}`
        );
        return null;
    }
}

function applyExtraction(extraction) {
    if (!extraction) return { written: 0 };
    let written = 0;

    for (const obs of extraction.architect_observations || []) {
        if (!obs.pattern) continue;
        db.prepare(`
            INSERT INTO relational_pattern_model (pattern_description, confidence, last_reinforced_at)
            VALUES (?, ?, datetime('now'))
        `).run(obs.pattern, obs.confidence ?? null);
        written++;
    }

    for (const aff of extraction.affinities_reinforced || []) {
        if (!aff.label) continue;
        const existing = db.prepare(`SELECT * FROM psyche_affinities WHERE label = ?`).get(aff.label);
        const delta = typeof aff.weight_delta === 'number' ? aff.weight_delta : 0.1;
        if (existing) {
            db.prepare(`
                UPDATE psyche_affinities
                SET weight = weight + ?, reinforcement_count = reinforcement_count + 1, last_reinforced_at = datetime('now')
                WHERE id = ?
            `).run(delta, existing.id);
        } else {
            db.prepare(`
                INSERT INTO psyche_affinities (label, weight, reinforcement_count, last_reinforced_at)
                VALUES (?, ?, 1, datetime('now'))
            `).run(aff.label, delta);
        }
        written++;
    }

    for (const self of extraction.self_observations || []) {
        if (!self.statement) continue;
        db.prepare(`
            INSERT INTO psyche_self_model (statement, confidence) VALUES (?, ?)
        `).run(self.statement, self.confidence ?? null);
        written++;
    }

    for (const asp of extraction.aspirations || []) {
        if (!asp.description) continue;
        db.prepare(`INSERT INTO psyche_aspirations (description) VALUES (?)`).run(asp.description);
        written++;
    }

    return { written };
}

/**
 * Run one digest cycle: gather unreflected Corpus entries, extract what
 * they actually evidence, write it into Psyche, and mark those entries
 * reflected so they're never reprocessed.
 */
async function runDigest() {
    const entries = getUnreflectedEntries();
    if (entries.length === 0) {
        return { processed: 0, written: 0 };
    }

    const transcript = buildTranscript(entries);
    let extraction = null;
    try {
        extraction = await callDigestModel(transcript);
    } catch (err) {
        console.error('[digest] error calling model:', err.message);
        return { processed: 0, written: 0, error: err.message };
    }

    if (extraction === null) {
        // Either no API key configured, or the model's output didn't parse
        // as valid JSON. Either way, do NOT mark these entries reflected —
        // leave them for the next cycle so nothing is silently lost if a
        // key gets added later or the model behaves better next time.
        return { processed: 0, written: 0, deferred: entries.length };
    }

    const { written } = applyExtraction(extraction);

    const ids = entries.map(e => e.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE corpus_entries SET reflected_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids);

    recordReversionEvent({
        sourceGrade: 'corpus',
        targetGrade: 'psyche',
        eventType: 'other',
        causeType: 'efficient',
        outcome: 'promoted',
        correctionNote: `Digest: processed ${entries.length} Corpus entries, wrote ${written} Psyche-level record(s).`
    });

    return { processed: entries.length, written };
}

module.exports = { runDigest };
