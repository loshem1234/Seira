const express = require('express');
const router = express.Router();
const auth = require('../lib/auth');
const { getDbForPath } = require('../lib/dbManager');
const dbContext = require('../lib/dbContext');
const { parseCookies, setCookie, clearCookie } = require('../lib/cookies');

const SESSION_COOKIE = 'seira_session';

// --- Middleware: every protected route passes through this ---
function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    const account = auth.getAccountBySessionToken(cookies[SESSION_COOKIE]);
    if (!account) {
        return res.redirect('/login');
    }
    const paths = auth.accountPaths(account.id);
    const db = getDbForPath(paths.dbPath);
    req.account = account;
    dbContext.run({ db, unityPath: paths.unityPath, accountId: account.id }, next);
}

// --- Signup ---
router.get('/signup', (req, res) => {
    res.render('signup', { page: 'signup', error: null });
});

router.post('/signup', (req, res) => {
    try {
        const accountId = auth.signup({ email: req.body.email, password: req.body.password });
        const { token } = auth.login({ email: req.body.email, password: req.body.password });
        setCookie(res, SESSION_COOKIE, token, { maxAgeSeconds: 30 * 24 * 60 * 60 });
        res.redirect('/');
    } catch (err) {
        res.render('signup', { page: 'signup', error: err.message });
    }
});

// --- Login ---
router.get('/login', (req, res) => {
    res.render('login', { page: 'login', error: null });
});

router.post('/login', (req, res) => {
    try {
        const { token } = auth.login({ email: req.body.email, password: req.body.password });
        setCookie(res, SESSION_COOKIE, token, { maxAgeSeconds: 30 * 24 * 60 * 60 });
        res.redirect('/');
    } catch (err) {
        res.render('login', { page: 'login', error: err.message });
    }
});

// --- Logout ---
router.post('/logout', (req, res) => {
    const cookies = parseCookies(req);
    auth.logout(cookies[SESSION_COOKIE]);
    clearCookie(res, SESSION_COOKIE);
    res.redirect('/login');
});

module.exports = { router, requireAuth };
