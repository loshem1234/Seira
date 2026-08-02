// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const { verifyIntegrity } = require('./lib/unity');
const { registerAllJobs } = require('./cron/cron');
const { router: authRouter, requireAuth } = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Public routes — no account context needed yet.
app.use('/', authRouter);

// Everything below this line requires a logged-in account, and runs
// inside that account's own db + Unity context (see routes/auth.js's
// requireAuth). This is what makes every other route, unmodified,
// automatically operate on the correct account's isolated Seira.
app.use(requireAuth);
app.use((req, res, next) => {
    res.locals.account = req.account;
    next();
});

app.use('/', require('./routes/pages'));
app.use('/api/archive', require('./routes/api/archive'));
app.use('/api/genealogy', require('./routes/api/genealogy'));
app.use('/api/proposals', require('./routes/api/proposals'));
app.use('/api/psyche', require('./routes/api/psyche'));
app.use('/api/chat', require('./routes/api/chat'));

app.get('/api/status', (req, res) => {
    const integrity = verifyIntegrity();
    res.json({ ok: integrity.ok, sealed: integrity.sealed, genesisComplete: integrity.genesisComplete, account: req.account.email });
});

app.listen(PORT, () => {
    console.log(`Seira listening on port ${PORT}`);
    registerAllJobs();
});
