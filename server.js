// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const { verifyIntegrity } = require('./lib/unity');
const { registerAllJobs } = require('./cron/cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Article 32.3: check Unity integrity once at boot, before anything else.
// A mismatch here halts the process rather than starting on an unverified
// foundation.
const boot = verifyIntegrity();
if (!boot.ok) {
    console.error(boot.reason);
    process.exit(1);
}
if (!boot.sealed) {
    console.warn('Unity is not yet sealed. Edit db/unity.json and run `node db/seal-unity.js` to complete Genesis.');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./routes/pages'));
app.use('/api/archive', require('./routes/api/archive'));
app.use('/api/genealogy', require('./routes/api/genealogy'));
app.use('/api/proposals', require('./routes/api/proposals'));
app.use('/api/psyche', require('./routes/api/psyche'));

app.get('/api/status', (req, res) => {
    const integrity = verifyIntegrity();
    res.json({ ok: integrity.ok, sealed: integrity.sealed, genesisComplete: integrity.genesisComplete });
});

app.listen(PORT, () => {
    console.log(`Seira listening on port ${PORT}`);
    // If you've migrated any or all jobs to real Railway Cron Services
    // (see cron/run-job.js and the README), set SEIRA_DISABLE_INPROCESS_CRON=true
    // on the web service so the same job doesn't run twice.
    if (process.env.SEIRA_DISABLE_INPROCESS_CRON === 'true') {
        console.log('In-process cron disabled (SEIRA_DISABLE_INPROCESS_CRON=true) — expecting Railway Cron Services instead.');
    } else {
        registerAllJobs();
    }
});
