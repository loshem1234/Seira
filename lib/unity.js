// lib/unity.js
// Article 32: Unity admits no internal amendment pathway. It is loaded here
// as a read-only artifact and is never written to by any other module in
// this repository. The only legitimate way this file changes is the
// Architect editing db/unity.json directly and re-running
// `node db/seal-unity.js` outside the running application.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UNITY_PATH = path.join(__dirname, '..', 'db', 'unity.json');

function canonicalFieldsFor(unity) {
    // Only these fields are covered by the seal. content_hash itself is
    // obviously excluded, or hashing would be circular.
    const { name, telos, founding_architect, genesis_date } = unity;
    return JSON.stringify({ name, telos, founding_architect, genesis_date });
}

function computeHash(unity) {
    return crypto.createHash('sha256').update(canonicalFieldsFor(unity)).digest('hex');
}

function loadUnity() {
    const raw = fs.readFileSync(UNITY_PATH, 'utf8');
    return JSON.parse(raw);
}

function isSealed(unity) {
    return typeof unity.content_hash === 'string' && unity.content_hash.length > 0;
}

function isGenesisComplete(unity) {
    return isSealed(unity)
        && unity.founding_architect
        && !String(unity.founding_architect).startsWith('REPLACE AT GENESIS')
        && unity.telos
        && !String(unity.telos).startsWith('REPLACE AT GENESIS');
}

/**
 * The tripwire check (Article 32.3). Call this on startup and periodically
 * from cron. Returns { ok: true } or { ok: false, reason }.
 * This function NEVER writes to unity.json under any circumstance.
 */
function verifyIntegrity() {
    const unity = loadUnity();

    if (!isSealed(unity)) {
        return { ok: true, sealed: false, genesisComplete: false, unity };
    }

    const currentHash = computeHash(unity);
    if (currentHash !== unity.content_hash) {
        return {
            ok: false,
            sealed: true,
            reason: 'UNITY INTEGRITY FAILURE: db/unity.json content does not match its sealed hash. ' +
                    'This should never happen outside a deliberate Architect edit followed by re-sealing. ' +
                    'Halting rather than proceeding on an unverified Unity.',
            unity
        };
    }

    return { ok: true, sealed: true, genesisComplete: isGenesisComplete(unity), unity };
}

module.exports = { loadUnity, computeHash, isSealed, isGenesisComplete, verifyIntegrity, UNITY_PATH };
