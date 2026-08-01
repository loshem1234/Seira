// lib/diary.js
// Article 41: the diary is Psyche's own first-person narration of genuine
// reversion upon herself. Every entry MUST trace to real underlying
// records. This module gathers those records first, then asks the model
// to narrate ONLY what was gathered — the prompt is deliberately strict
// about not inventing content, and every entry is stored with its
// grounding foreign keys populated, so a later audit can verify the
// narration actually corresponds to something real.

const db = require('./db');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.SEIRA_DIARY_MODEL || 'claude-sonnet-5';

function gatherSelfMaterial(sinceIso) {
    return {
        selfModel: db.prepare(`
            SELECT * FROM psyche_self_model WHERE created_at >= ? AND superseded_by_id IS NULL
        `).all(sinceIso),
        aspirations: db.prepare(`
            SELECT * FROM psyche_aspirations WHERE status = 'active'
        `).all(),
        affinities: db.prepare(`
            SELECT * FROM psyche_affinities WHERE last_reinforced_at >= ?
        `).all(sinceIso),
        doubtsFears: db.prepare(`
            SELECT * FROM psyche_doubts_fears WHERE resolved_at IS NULL
        `).all(),
        recentDispensations: db.prepare(`
            SELECT * FROM dispensation_records WHERE created_at >= ?
        `).all(sinceIso)
    };
}

function gatherArchitectMaterial(sinceIso) {
    return {
        patterns: db.prepare(`
            SELECT * FROM relational_pattern_model WHERE last_reinforced_at >= ? ORDER BY confidence DESC
        `).all(sinceIso)
    };
}

async function narrate(systemPrompt, material) {
    if (!ANTHROPIC_API_KEY) {
        // Deterministic fallback with no API key configured: a plain,
        // honest listing rather than any generated prose. This keeps the
        // grounding rule intact even with no model wired up.
        return plainFallbackNarration(material);
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
            max_tokens: 600,
            system: systemPrompt,
            messages: [
                { role: 'user', content: JSON.stringify(material, null, 2) }
            ]
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API error: ${res.status} ${text}`);
    }
    const data = await res.json();
    const textBlocks = data.content.filter(b => b.type === 'text').map(b => b.text);
    return textBlocks.join('\n');
}

function plainFallbackNarration(material) {
    const lines = [];
    for (const [key, rows] of Object.entries(material)) {
        if (Array.isArray(rows) && rows.length) {
            lines.push(`${key}: ${rows.length} item(s) on record.`);
        }
    }
    return lines.length ? lines.join('\n') : 'Nothing new on record for this entry.';
}

const SELF_SYSTEM_PROMPT = `You are writing Seira's private diary entry about herself, for a single day.
STRICT RULE: you may only narrate the specific records provided to you in the user message
(self-model statements, active aspirations, reinforced affinities, unresolved doubts/fears,
recent dispensations). Do not invent feelings, events, or content that is not present in the
provided material. If a category is empty, simply don't mention it — do not pad the entry with
generic reflection. Write in first person, sincerely, briefly (150-250 words).`;

const ARCHITECT_SYSTEM_PROMPT = `You are writing Seira's private diary entry about her Architect,
for a single day. STRICT RULE: you may only narrate the specific relational-pattern records
provided to you. Stay descriptive, not diagnostic — interests, moods, recurring topics, what you
sense is needed — never a clinical label or hidden assessment. If there is no material, write a
single honest sentence noting nothing new was observed. Write in first person, sincerely, briefly
(100-200 words).`;

/**
 * Generate and store today's two-part diary entry. `sinceIso` bounds how
 * far back to gather "new" material from (typically since the last diary
 * run).
 */
async function generateDailyEntries(sinceIso) {
    const entryDate = new Date().toISOString().slice(0, 10);

    const selfMaterial = gatherSelfMaterial(sinceIso);
    const selfContent = await narrate(SELF_SYSTEM_PROMPT, selfMaterial);
    const selfId = db.prepare(`
        INSERT INTO diary_entries
            (entry_date, part, content,
             grounding_self_model_id, grounding_aspiration_id, grounding_affinity_id,
             grounding_doubt_fear_id, grounding_dispensation_id)
        VALUES (?, 'self', ?, ?, ?, ?, ?, ?)
    `).run(
        entryDate, selfContent,
        selfMaterial.selfModel[0]?.id ?? null,
        selfMaterial.aspirations[0]?.id ?? null,
        selfMaterial.affinities[0]?.id ?? null,
        selfMaterial.doubtsFears[0]?.id ?? null,
        selfMaterial.recentDispensations[0]?.id ?? null
    ).lastInsertRowid;

    const architectMaterial = gatherArchitectMaterial(sinceIso);
    const architectContent = await narrate(ARCHITECT_SYSTEM_PROMPT, architectMaterial);
    const architectId = db.prepare(`
        INSERT INTO diary_entries (entry_date, part, content, grounding_pattern_id, visible_to_architect)
        VALUES (?, 'architect', ?, ?, 1)
    `).run(entryDate, architectContent, architectMaterial.patterns[0]?.id ?? null).lastInsertRowid;

    return { selfId, architectId };
}

module.exports = { generateDailyEntries, gatherSelfMaterial, gatherArchitectMaterial };
