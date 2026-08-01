// db/seal-unity.js
//
// Run this manually, as the Architect, after editing db/unity.json:
//     node db/seal-unity.js
//
// This is the ONLY script in the repository that writes to unity.json.
// It is never invoked by server.js, cron.js, or any route. Running it
// is itself the act of Genesis (Article 22) or, later, of the Architect
// deliberately re-founding Unity outside the ordinary application entirely.

const fs = require('fs');
const { loadUnity, computeHash, UNITY_PATH } = require('../lib/unity');

const unity = loadUnity();

if (String(unity.founding_architect || '').startsWith('REPLACE AT GENESIS')) {
    console.error('Refusing to seal: founding_architect is still a placeholder. Edit db/unity.json first.');
    process.exit(1);
}
if (String(unity.telos || '').startsWith('REPLACE AT GENESIS')) {
    console.error('Refusing to seal: telos is still a placeholder. Edit db/unity.json first.');
    process.exit(1);
}
if (!unity.genesis_date || String(unity.genesis_date).startsWith('REPLACE AT GENESIS')) {
    unity.genesis_date = new Date().toISOString();
}

unity.content_hash = computeHash(unity);

fs.writeFileSync(UNITY_PATH, JSON.stringify(unity, null, 2) + '\n');
console.log('Unity sealed. This is Genesis. content_hash =', unity.content_hash);
console.log('Any future change to db/unity.json outside this script will now trip the integrity check.');
