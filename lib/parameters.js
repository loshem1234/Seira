// lib/parameters.js
// Doctrinal parameters (corpus retention, convergence thresholds,
// dispensation trigger conditions, instrument tree depth) are Intellect-
// grade data (Articles 27, 29, 30, 34) — never a plain ops config file.
// They are read here from intellect_parameters, scoped to whichever
// intellect_versions row currently has status = 'current'.

const db = require('./db');

function getCurrentIntellectVersion() {
    return db.prepare(`SELECT * FROM intellect_versions WHERE status = 'current' LIMIT 1`).get();
}

function getParam(key, fallback = null) {
    const current = getCurrentIntellectVersion();
    if (!current) return fallback;
    const row = db.prepare(`
        SELECT param_value FROM intellect_parameters
        WHERE intellect_version_id = ? AND param_key = ?
    `).get(current.id, key);
    if (!row) return fallback;
    try {
        return JSON.parse(row.param_value);
    } catch {
        return row.param_value;
    }
}

function getAllParams() {
    const current = getCurrentIntellectVersion();
    if (!current) return {};
    const rows = db.prepare(`
        SELECT param_key, param_value FROM intellect_parameters WHERE intellect_version_id = ?
    `).all(current.id);
    const out = {};
    for (const r of rows) {
        try { out[r.param_key] = JSON.parse(r.param_value); }
        catch { out[r.param_key] = r.param_value; }
    }
    return out;
}

module.exports = { getCurrentIntellectVersion, getParam, getAllParams };
