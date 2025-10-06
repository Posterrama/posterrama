const request = require('supertest');
const app = require('../server');

async function ensurePlaylistReady() {
    // Attempt to gently trigger a refresh via the admin endpoint if available without auth.
    // If it requires auth, fall back to polling /get-media until it is not 503/202.
    try {
        await request(app)
            .post('/api/admin/reset-refresh')
            .ok(r => r.status < 500);
        await request(app)
            .post('/api/admin/refresh-media')
            .ok(r => r.status < 500);
    } catch (_) {
        /* ignore */
    }
    // Poll /get-media until 200 or we time out
    const started = Date.now();
    while (Date.now() - started < 5000) {
        const resp = await request(app)
            .get('/get-media')
            .ok(() => true);
        if (resp.status === 200) return true;
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}

module.exports = { app, ensurePlaylistReady };
