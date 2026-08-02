// lib/unity.js
// Article 32: Unity admits no internal amendment pathway. It is loaded here
// as a read-only artifact and is never written to by any other module in
// this repository except the guarded, one-time performGenesis() below.
//
// MULTI-TENANCY: each account has its OWN Unity file, at its own path,
// provisioned at signup (lib/auth.js). Every function below resolves
// "which Unity file" from the current request/job context (lib/dbContext.js)
// rather than a single global path — the same pattern lib/db.js uses for
// the database itself. db/unity.json in the repo is only ever the TEMPLATE
// copied to seed a brand new account's Unity file at signup; it is never
// read directly once an account exists.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getStore } = require('./dbContext');

const TEMPLATE_PATH = path.join(__dirname, '..', 'db', 'unity.json');

function currentUnityPath() {
    const store = getStore();
    if (!store || !store.unityPath) {
        throw new Error(
            'lib/unity.js was accessed with no account context set. Every request must pass ' +
            'through the auth middleware, which sets the current account\'s unityPath.'
        );
    }
    return store.unityPath;
}

/**
 * Seed a brand new account's Unity file from the repo template. Called
 * once, explicitly, at signup (lib/auth.js) — takes an explicit path
 * rather than relying on context, since this runs during provisioning,
 * before any request context necessarily exists for that account yet.
 * Does nothing if a file already exists at targetPath.
 */
function ensureUnityFileExists(targetPath) {
    if (fs.existsSync(targetPath)) return;
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(TEMPLATE_PATH, targetPath);
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
    const raw = fs.readFileSync(currentUnityPath(), 'utf8');
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
 * The tripwire check (Article 32.3), scoped to whichever account is
 * current in context. Returns { ok: true } or { ok: false, reason }.
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
            reason: 'UNITY INTEGRITY FAILURE: this account\'s Unity file content does not match its sealed hash. ' +
                    'This should never happen outside a deliberate Architect edit followed by re-sealing.',
            unity
        };
    }

    return { ok: true, sealed: true, genesisComplete: isGenesisComplete(unity), unity };
}

/**
 * Article 22 (Genesis): the one narrow, explicitly-acknowledged exception to
 * "nothing writes to Unity." Scoped to whichever account is current in
 * context. Guarded so it can only ever fire once per account: if that
 * account's Unity is already sealed, it refuses outright.
 */
function performGenesis({ name, telos, foundingArchitect }) {
    const current = loadUnity();
    if (isSealed(current)) {
        throw new Error('Article 22/26: Unity is already sealed for this account. Genesis cannot be performed twice.');
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

    fs.writeFileSync(currentUnityPath(), JSON.stringify(unity, null, 2) + '\n');
    return unity;
}

module.exports = { loadUnity, computeHash, isSealed, isGenesisComplete, verifyIntegrity, performGenesis, ensureUnityFileExists, TEMPLATE_PATH };
