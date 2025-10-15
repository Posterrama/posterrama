const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Lazy-require server to avoid side effects before tests start
let app;
let originalConfig;
let configPath;

describe('Mode routes', () => {
    beforeAll(() => {
        // Ensure NODE_ENV not set to production to avoid PM2 behaviors
        process.env.NODE_ENV = 'test';
        // Force-enable cinemaMode for this suite so /cinema serves cinema shell
        configPath = path.resolve(__dirname, '../../config.json');
        originalConfig = fs.readFileSync(configPath, 'utf8');
        try {
            const cfg = JSON.parse(originalConfig);
            cfg.cinemaMode = true;
            fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
        } catch (_) {
            // Ignore parse errors; test may fallback to index shell
            void 0; // no-op to satisfy no-empty
        }
        // Clear require cache if previously loaded
        Object.keys(require.cache).forEach(k => {
            if (k.endsWith(path.sep + 'server.js')) delete require.cache[k];
        });
        app = require('../../server');
    });

    afterAll(() => {
        // Restore original config
        try {
            if (originalConfig && configPath) fs.writeFileSync(configPath, originalConfig);
        } catch (_) {
            // ignore restore errors in CI
            void 0; // no-op to satisfy no-empty
        }
    });

    it('GET /cinema returns HTML without legacy orchestrator and with stamped assets', async () => {
        const res = await request(app).get('/cinema');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
        const html = res.text;
        // Stamped core and cinema assets should be referenced
        expect(html).toMatch(/\/core\.js\?v=/);
        expect(html).toMatch(/cinema\/cinema-display\.js\?v=/);
        expect(html).toMatch(/cinema\/cinema-display\.css\?v=/);
        // No legacy orchestrator on cinema page
        expect(html).not.toMatch(/script\.js\?v=/);
        // MODE_HINT should be injected for cinema
        expect(html).toMatch(/window\.MODE_HINT\s*=\s*'cinema'/);
    });

    it('GET /wallart returns HTML', async () => {
        const res = await request(app).get('/wallart');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
        // stamped core + wallart assets should be referenced
        expect(res.text).toMatch(/\/core\.js\?v=/);
        expect(res.text).toMatch(/wallart\/wallart-display\.js\?v=/);
        expect(res.text).toMatch(/wallart\/wallart\.css\?v=/);
        // no legacy orchestrator script on wallart page
        expect(res.text).not.toMatch(/script\.js\?v=/);
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
