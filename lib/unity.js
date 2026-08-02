// lib/unity.js
// Article 32: Unity admits no internal amendment pathway. It is loaded here
// as a read-only artifact and is never written to by any other module in
// this repository except the guarded, one-time performGenesis() below.
//
// IMPORTANT — persistence: Unity's actual file location is configurable via
// SEIRA_UNITY_PATH so it can live on a mounted persistent volume, the same
// one the database lives on. Without this, Unity (and any Genesis you
// perform) lives inside the container's ephemeral filesystem and is wiped
// on every redeploy or restart. db/unity.json in the repo is only ever the
// TEMPLATE used to seed a fresh volume the first time; once a real
// SEIRA_UNITY_PATH is set and populated, the repo copy is never read again.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMPLATE_PATH = path.join(__dirname, '..', 'db', 'unity.json');
const UNITY_PATH = process.env.SEIRA_UNITY_PATH || TEMPLATE_PATH;

/**
 * Call once at boot, before anything else touches Unity. If UNITY_PATH
 * points somewhere other than the repo template (i.e. a mounted volume)
 * and nothing exists there yet, seed it from the template so the /genesis
 * form has something to work with. If a file already exists at UNITY_PATH,
 * this does nothing — that's the whole point: a founded Seira's file
 * survives untouched across redeploys.
 */
function ensureUnityFileExists() {
    if (UNITY_PATH === TEMPLATE_PATH) return; // no volume configured; using repo copy directly
    if (fs.existsSync(UNITY_PATH)) return; // already there — do not overwrite a founded Seira
    const dir = path.dirname(UNITY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(TEMPLATE_PATH, UNITY_PATH);
}

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

/**
 * Article 22 (Genesis): the one narrow, explicitly-acknowledged exception to
 * "nothing writes to Unity." This function performs the founding act itself
 * — not an amendment, but the act Article 22 describes as prior to any
 * amendment mechanism existing at all. It is guarded so it can only ever
 * fire once: if Unity is already sealed, it refuses outright, exactly as
 * db/seal-unity.js does. Unlike editing the file by hand, this computes
 * genesis_date itself and hashes over the exact object it writes — so there
 * is no possibility of the file and its hash ever disagreeing, the way a
 * manual two-step edit could produce.
 */
function performGenesis({ name, telos, foundingArchitect }) {
    const current = loadUnity();
    if (isSealed(current)) {
        throw new Error('Article 22/26: Unity is already sealed. Genesis cannot be performed twice.');
    }
    if (!name || !telos || !foundingArchitect) {
        throw new Error('Genesis requires name, telos, and foundingArchitect.');
    }

    const unity = {
        _comment: current._comment,
        name,
        telos,
        founding_architect: foundingArchitect,
        genesis_date: new Date().toISOString(),
        content_hash: null
    };
    unity.content_hash = computeHash(unity);

    fs.writeFileSync(UNITY_PATH, JSON.stringify(unity, null, 2) + '\n');
    return unity;
}

module.exports = { loadUnity, computeHash, isSealed, isGenesisComplete, verifyIntegrity, performGenesis, ensureUnityFileExists, UNITY_PATH };
