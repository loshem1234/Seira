// lib/cookies.js
// One cookie, hand-rolled, to avoid pulling in a dependency for it.

function parseCookies(req) {
    const header = req.headers.cookie;
    const out = {};
    if (!header) return out;
    header.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        out[k] = decodeURIComponent(v);
    });
    return out;
}

function setCookie(res, name, value, { maxAgeSeconds } = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (maxAgeSeconds) parts.push(`Max-Age=${maxAgeSeconds}`);
    if (process.env.NODE_ENV === 'production') parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
    res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; Max-Age=0`);
}

module.exports = { parseCookies, setCookie, clearCookie };
