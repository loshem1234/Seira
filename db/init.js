// db/init.js
//
// Safe to run any number of times, from anywhere: the schema itself is
// written with CREATE TABLE/VIEW/INDEX IF NOT EXISTS, and the Genesis seed
// below is guarded by a row-count check. This means server.js can call
// initializeDatabase() automatically on every boot without ever needing
// a separate manual step or Start Command toggle.
//
// You can still run this standalone if you want to:
//     npm run init-db

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

// Allow standalone use: `npm run init-db` / `node db/init.js`
if (require.main === module) {
    console.log('Initializing Seira schema...');
    const result = initializeDatabase();
    console.log('Schema applied.');
    if (result.genesisSeeded) {
        console.log('Seeded Genesis intellect_versions row (v1) and initial doctrinal parameters.');
    } else {
        console.log('intellect_versions already populated; skipping Genesis seed.');
    }
    console.log('Done.');
}

module.exports = { initializeDatabase };
