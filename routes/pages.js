const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { loadUnity, isGenesisComplete } = require('../lib/unity');
const { getHealthIndicators } = require('../lib/health');
const instruments = require('../lib/instruments');

router.get('/', (req, res) => {
    const unity = loadUnity();
    const genesisComplete = isGenesisComplete(unity);
    const health = getHealthIndicators();
    const currentIntellect = db.prepare(`SELECT * FROM intellect_versions WHERE status = 'current'`).get();
    const openProposals = db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'open'`).get().n;
    const recentDiary = db.prepare(`SELECT * FROM diary_entries ORDER BY entry_date DESC, part ASC LIMIT 2`).all();

    res.render('dashboard', {
        page: 'dashboard',
        unity, genesisComplete, health, currentIntellect, openProposals, recentDiary
    });
});

router.get('/archive', (req, res) => {
    const events = db.prepare(`SELECT * FROM archive_reversion_log LIMIT 100`).all();
    res.render('archive', { page: 'archive', events });
});

router.get('/genealogy', (req, res) => {
    const tree = instruments.getGenealogyTree();
    res.render('genealogy', { page: 'genealogy', tree });
});

router.get('/diary', (req, res) => {
    const entries = db.prepare(`SELECT * FROM diary_entries ORDER BY entry_date DESC, part ASC LIMIT 60`).all();
    res.render('diary', { page: 'diary', entries });
});

router.get('/ledger', (req, res) => {
    const proposals = db.prepare(`SELECT * FROM proposals ORDER BY created_at DESC LIMIT 100`).all();
    const pairs = db.prepare(`SELECT * FROM contradiction_pairs WHERE resolved = 0`).all();
    const versions = db.prepare(`SELECT * FROM intellect_versions ORDER BY version_number DESC`).all();
    res.render('ledger', { page: 'ledger', proposals, pairs, versions });
});

module.exports = router;
