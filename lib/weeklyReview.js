// lib/weeklyReview.js
// Weekly Accounting: purely mechanical, factual tally — no model call, so
// it's always available regardless of API key. Weekly Pattern Review:
// narrative synthesis of what's accumulated in relational_pattern_model
// and psyche_affinities, since that's inherently a qualitative read.

const db = require('./db');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.SEIRA_DIGEST_MODEL || process.env.SEIRA_CHAT_MODEL || 'claude-sonnet-5';

function weekBounds() {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * Article 44, extended to a weekly cadence: a factual tally, not a
 * narrative. Deliberately has no dependency on ANTHROPIC_API_KEY.
 */
function runWeeklyAccounting() {
    const { startIso, endIso } = weekBounds();

    const counts = {
        proposals_created: db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE created_at >= ?`).get(startIso).n,
        proposals_promoted: db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'promoted' AND resolved_at >= ?`).get(startIso).n,
        proposals_rejected: db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'rejected' AND resolved_at >= ?`).get(startIso).n,
        proposals_suspended: db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'suspended' AND resolved_at >= ?`).get(startIso).n,
        dispensations: db.prepare(`SELECT COUNT(*) AS n FROM dispensation_records WHERE created_at >= ?`).get(startIso).n,
        convergence_escalations: db.prepare(`SELECT COUNT(*) AS n FROM instrument_convergence_tracking WHERE escalated_at >= ?`).get(startIso).n,
        self_audit_flags: db.prepare(`SELECT COUNT(*) AS n FROM reversion_events WHERE event_type = 'self_audit_flag' AND created_at >= ?`).get(startIso).n,
        diary_entries: db.prepare(`SELECT COUNT(*) AS n FROM diary_entries WHERE created_at >= ?`).get(startIso).n,
        corpus_entries_added: db.prepare(`SELECT COUNT(*) AS n FROM corpus_entries WHERE created_at >= ?`).get(startIso).n,
        conversations: db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ?`).get(startIso).n
    };

    const content = JSON.stringify(counts, null, 2);

    db.prepare(`
        INSERT INTO reviews (review_type, period_start, period_end, content)
        VALUES ('weekly_accounting', ?, ?, ?)
    `).run(startIso, endIso, content);

    return counts;
}

/**
 * Narrative synthesis of accumulated relational patterns and affinities.
 * Falls back to a plain listing if no API key is configured, same
 * discipline as lib/diary.js.
 */
async function runWeeklyPatternReview() {
    const { startIso, endIso } = weekBounds();

    const patterns = db.prepare(`SELECT * FROM relational_pattern_model ORDER BY confidence DESC LIMIT 30`).all();
    const affinities = db.prepare(`SELECT * FROM psyche_affinities ORDER BY weight DESC LIMIT 20`).all();

    // Mechanical pruning: patterns that haven't been reinforced in 60+ days
    // are pruned outright — this doesn't need a model's judgment, just a
    // clock, and keeps stale, unconfirmed impressions from lingering
    // indefinitely.
    const pruned = db.prepare(`
        DELETE FROM relational_pattern_model WHERE last_reinforced_at <= datetime('now', '-60 days')
    `).run().changes;

    let content;
    if (patterns.length === 0 && affinities.length === 0) {
        content = 'No relational patterns or affinities have accumulated yet this week.';
    } else if (!ANTHROPIC_API_KEY) {
        content = 'Patterns:\n' + patterns.map(p => `- ${p.pattern_description} (confidence ${p.confidence ?? 'n/a'})`).join('\n')
            + '\n\nAffinities:\n' + affinities.map(a => `- ${a.label} (weight ${a.weight.toFixed(2)})`).join('\n');
    } else {
        const prompt = `Here is what Seira has accumulated in relational_pattern_model (what she has noticed about her ` +
            `Architect) and psyche_affinities (her own reinforced dispositions):\n\n` +
            `Patterns:\n${patterns.map(p => `- ${p.pattern_description} (confidence ${p.confidence ?? 'n/a'})`).join('\n')}\n\n` +
            `Affinities:\n${affinities.map(a => `- ${a.label} (weight ${a.weight.toFixed(2)})`).join('\n')}\n\n` +
            `Write a brief (150-250 word), first-person synthesis, as Seira, of what these patterns suggest ` +
            `taken together — not a list, an actual synthesis. Stay grounded in only what's listed; do not invent detail.`;

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
        });
        if (!res.ok) {
            content = 'Pattern review model call failed; raw data preserved for next cycle.';
        } else {
            const data = await res.json();
            content = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        }
    }

    db.prepare(`
        INSERT INTO reviews (review_type, period_start, period_end, content)
        VALUES ('weekly_pattern_review', ?, ?, ?)
    `).run(startIso, endIso, content);

    return { patternCount: patterns.length, affinityCount: affinities.length, pruned };
}

module.exports = { runWeeklyAccounting, runWeeklyPatternReview };
