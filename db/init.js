// db/init.js
//
// Applies the schema to whichever account's database is current in
// lib/dbContext.js's context. In multi-tenant Seira, this is called
// exactly once per account, automatically, at signup (see lib/auth.js) —
// never run standalone, since it has no meaning without an account
// context to apply the schema to. Safe to call more than once regardless:
// every CREATE in schema.sql is IF NOT EXISTS, and the Genesis-parameter
// seed is guarded by a row-count check.

const fs = require('fs');
const path = require('path');

function initializeDatabase() {
    const db = require('../lib/db');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    db.exec(schema);

    const existing = db.prepare(`SELECT COUNT(*) AS n FROM intellect_versions`).get();
    if (existing.n === 0) {
        const insert = db.prepare(`
            INSERT INTO intellect_versions (version_number, content, status, origin_type, ratified_at)
            VALUES (1, ?, 'current', 'genesis', datetime('now'))
        `);
        insert.run(JSON.stringify({
            note: 'Genesis Intellect content. Replace with the founding doctrine at setup time. ' +
                  'Exempt from falsification per Article 22 — this row is asserted, not earned.'
        }));

        const versionRow = db.prepare(`SELECT id FROM intellect_versions WHERE version_number = 1`).get();
        const insertParam = db.prepare(`
            INSERT INTO intellect_parameters (intellect_version_id, param_key, param_value)
            VALUES (?, ?, ?)
        `);
        insertParam.run(versionRow.id, 'corpus_retention_days', JSON.stringify(180));
        insertParam.run(versionRow.id, 'instrument_tree_max_depth', JSON.stringify(4));
        insertParam.run(versionRow.id, 'dispensation_trigger_conditions', JSON.stringify([
            {
                key: 'imminent_high_confidence_harm',
                description: 'Placeholder condition set at Genesis. Replace/refine through Article 30 amendment, never edited ad hoc.'
            }
        ]));
        insertParam.run(versionRow.id, 'convergence_window_days', JSON.stringify(14));
        insertParam.run(versionRow.id, 'convergence_failure_threshold', JSON.stringify(3));

        return { schemaApplied: true, genesisSeeded: true };
    }

    return { schemaApplied: true, genesisSeeded: false };
}

module.exports = { initializeDatabase };
