const request = require('supertest');
const path = require('path');

let app;

describe('Preview routes (isolated modes)', () => {
    beforeAll(() => {
        process.env.NODE_ENV = 'test';
        // Ensure a fresh server instance for this suite
        Object.keys(require.cache).forEach(k => {
            if (k.endsWith(path.sep + 'server.js')) delete require.cache[k];
        });
        app = require('../../server');
    });

    test('GET /preview-wallart is stamped and isolated', async () => {
        const res = await request(app).get('/preview-wallart');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);

        const html = res.text;
        // Shared/core assets
        expect(html).toMatch(/\/core\.js\?v=/);
        expect(html).toMatch(/\/client-logger\.js\?v=/);
        expect(html).toMatch(/\/manifest\.json\?v=/);
        expect(html).toMatch(/\/sw\.js\?v=/);
        // Wallart specific + preview shell
        expect(html).toMatch(/wallart\/wallart-display\.js\?v=/);
        expect(html).toMatch(/wallart\/wallart\.css\?v=/);
        expect(html).toMatch(/\/preview-wallart\.js\?v=/);
        expect(html).toMatch(/\/preview-wallart\.css\?v=/);
        // Should not include cinema assets
        expect(html).not.toMatch(/cinema\/cinema-display\.js\?v=/);
        expect(html).not.toMatch(/cinema\/cinema-display\.css\?v=/);
        // Must not include legacy orchestrator
        expect(html).not.toMatch(/script\.js\?v=/);
    });

    test('GET /preview-wallart.html works (alias)', async () => {
        const res = await request(app).get('/preview-wallart.html');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
        expect(res.text).toMatch(/\/preview-wallart\.js\?v=/);
        expect(res.text).toMatch(/\/preview-wallart\.css\?v=/);
    });

    test('GET /preview-screensaver is stamped and isolated', async () => {
        const res = await request(app).get('/preview-screensaver');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);

        const html = res.text;
        // Shared/core assets
        expect(html).toMatch(/\/core\.js\?v=/);
        expect(html).toMatch(/\/client-logger\.js\?v=/);
        expect(html).toMatch(/\/manifest\.json\?v=/);
        expect(html).toMatch(/\/sw\.js\?v=/);
        // Screensaver specific + preview shell
        expect(html).toMatch(/screensaver\/screensaver\.js\?v=/);
        expect(html).toMatch(/screensaver\/screensaver\.css\?v=/);
        expect(html).toMatch(/\/preview-screensaver\.js\?v=/);
        expect(html).toMatch(/\/preview-screensaver\.css\?v=/);
        // Should not include cinema assets
        expect(html).not.toMatch(/cinema\/cinema-display\.js\?v=/);
        expect(html).not.toMatch(/cinema\/cinema-display\.css\?v=/);
        // Must not include legacy orchestrator
        expect(html).not.toMatch(/script\.js\?v=/);
    });

    test('GET /preview-screensaver.html works (alias)', async () => {
        const res = await request(app).get('/preview-screensaver.html');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
        expect(res.text).toMatch(/\/preview-screensaver\.js\?v=/);
        expect(res.text).toMatch(/\/preview-screensaver\.css\?v=/);
    });
});
