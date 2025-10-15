const request = require('supertest');
const path = require('path');

// Lazy-require server to avoid side effects before tests start
let app;

describe('Mode routes', () => {
    beforeAll(() => {
        // Ensure NODE_ENV not set to production to avoid PM2 behaviors
        process.env.NODE_ENV = 'test';
        // Clear require cache if previously loaded
        Object.keys(require.cache).forEach(k => {
            if (k.endsWith(path.sep + 'server.js')) delete require.cache[k];
        });
        app = require('../../server');
    });

    it('GET /cinema returns HTML', async () => {
        const res = await request(app).get('/cinema');
        expect(res.status).toBeLessThan(500);
        expect(res.headers['content-type']).toMatch(/html/);
    });

    it('GET /wallart returns HTML', async () => {
        const res = await request(app).get('/wallart');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
        // stamped core + wallart assets should be referenced
        expect(res.text).toMatch(/\/core\.js\?v=/);
        expect(res.text).toMatch(/wallart\/wallart-display\.js\?v=/);
        expect(res.text).toMatch(/wallart\/wallart\.css\?v=/);
        // service worker registration should be stamped in HTML
        expect(res.text).toMatch(/\/sw\.js\?v=/);
    });

    it('GET /screensaver returns HTML', async () => {
        const res = await request(app).get('/screensaver');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
        // stamped core + screensaver assets should be referenced
        expect(res.text).toMatch(/\/core\.js\?v=/);
        expect(res.text).toMatch(/screensaver\/screensaver\.js\?v=/);
        expect(res.text).toMatch(/screensaver\/screensaver\.css\?v=/);
        // no legacy orchestrator script on screensaver page
        expect(res.text).not.toMatch(/script\.js\?v=/);
        // service worker registration should be stamped in HTML
        expect(res.text).toMatch(/\/sw\.js\?v=/);
    });
});
