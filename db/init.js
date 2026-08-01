// db/init.js
// Run with: npm run init-db
// Idempotent-ish: uses CREATE TABLE without IF NOT EXISTS in schema.sql by
// design (so a genuine re-run against an existing DB fails loudly rather
// than silently no-op'ing over a schema drift). For a fresh deploy, this
// runs against an empty database file.

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

console.log('Initializing Seira schema...');
db.exec(schema);
console.log('Schema applied.');

// Seed a single 'current' Genesis Intellect version if none exists yet,
// so the rest of the application always has a current row to reference.
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

    // Seed the doctrinal parameters this Constitution requires to exist
    // from the start (Articles 27, 29, 30, 34).
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

    console.log('Seeded Genesis intellect_versions row (v1) and initial doctrinal parameters.');
} else {
    console.log('intellect_versions already populated; skipping Genesis seed.');
}

console.log('Done.');
