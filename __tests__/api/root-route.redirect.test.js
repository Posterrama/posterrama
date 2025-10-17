const fs = require('fs');
const path = require('path');
const request = require('supertest');

const cfgPath = path.join(__dirname, '..', '..', 'config.json');
const originalConfig = fs.readFileSync(cfgPath, 'utf8');

function withTempConfig(patch) {
    const base = JSON.parse(originalConfig);
    const next = { ...base, ...(patch || {}) };
    fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2));
}

describe('Root route redirect behavior', () => {
    beforeAll(() => {
        process.env.NODE_ENV = 'test';
    });

    afterAll(() => {
        // Restore original config
        fs.writeFileSync(cfgPath, originalConfig);
        jest.resetModules();
    });

    test('defaults to landing (no redirect)', async () => {
        // Temporarily set config to landing behavior
        withTempConfig({
            rootRoute: { behavior: 'landing' },
        });
        jest.resetModules();
        // Clear server cache
        Object.keys(require.cache).forEach(k => {
            if (k.endsWith(path.sep + 'server.js')) delete require.cache[k];
            if (k.endsWith(path.sep + 'config.json')) delete require.cache[k];
        });
        const app = require('../../server');
        const res = await request(app).get('/');
        expect([200, 304]).toContain(res.status); // allow 304 in some CI caches
        expect(res.headers['content-type']).toMatch(/html/);
        expect(res.headers['location']).toBeUndefined();
    });

    test('redirects to configured mode when behavior=redirect', async () => {
        withTempConfig({
            rootRoute: { behavior: 'redirect', defaultMode: 'cinema', statusCode: 302 },
        });
        jest.resetModules();
        Object.keys(require.cache).forEach(k => {
            if (k.endsWith(path.sep + 'server.js')) delete require.cache[k];
            if (k.endsWith(path.sep + 'config.json')) delete require.cache[k];
        });
        const app = require('../../server');
        const res = await request(app).get('/');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/cinema');
    });

    test('bypassParam present prevents redirect', async () => {
        withTempConfig({
            rootRoute: {
                behavior: 'redirect',
                defaultMode: 'screensaver',
                statusCode: 307,
                bypassParam: 'landing',
            },
        });
        jest.resetModules();
        Object.keys(require.cache).forEach(k => {
            if (k.endsWith(path.sep + 'server.js')) delete require.cache[k];
            if (k.endsWith(path.sep + 'config.json')) delete require.cache[k];
        });
        const app = require('../../server');
        const res = await request(app).get('/?landing');
        expect([200, 304]).toContain(res.status);
        expect(res.headers.location).toBeUndefined();
        expect(res.headers['content-type']).toMatch(/html/);
    });

    test('honors X-Forwarded-Prefix for subpath-safe redirect', async () => {
        withTempConfig({
            rootRoute: { behavior: 'redirect', defaultMode: 'wallart', statusCode: 307 },
        });
        jest.resetModules();
        Object.keys(require.cache).forEach(k => {
            if (k.endsWith(path.sep + 'server.js')) delete require.cache[k];
            if (k.endsWith(path.sep + 'config.json')) delete require.cache[k];
        });
        const app = require('../../server');
        const res = await request(app).get('/').set('X-Forwarded-Prefix', '/some/base');
        expect(res.status).toBe(307);
        expect(res.headers.location).toBe('/some/base/wallart');
        // cache guards present on redirect
        expect(res.headers['cache-control']).toMatch(/no-store/);
    });
});
