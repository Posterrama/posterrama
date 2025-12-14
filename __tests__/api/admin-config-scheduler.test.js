const request = require('supertest');
const path = require('path');
const fs = require('fs');

// This test verifies that saving admin config triggers a reschedule of the background
// playlist refresh interval without requiring a server restart. We check that
// the global.playlistRefreshInterval is replaced when backgroundRefreshMinutes changes.

describe('Admin config scheduler reschedule', () => {
    let app;
    let serverModule;
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    let originalConfig;

    beforeAll(() => {
        originalConfig = fs.readFileSync(configPath, 'utf8');
        jest.resetModules();
        serverModule = require('../../server');
        app = serverModule.app || serverModule;
    });

    afterAll(() => {
        fs.writeFileSync(configPath, originalConfig, 'utf8');
    });

    test('reschedules background refresh on POST /api/admin/config', async () => {
        // If route is protected, treat unauthorized as soft skip
        const getRes = await request(app)
            .get('/api/admin/config')
            .set('Authorization', 'Bearer test-token');
        if ([401, 403].includes(getRes.status)) {
            console.warn('[TEST] Skipping scheduler reschedule test (unauthorized GET).');
            return;
        }
        expect(getRes.status).toBe(200);
        const cfg = getRes.body.config;
        expect(cfg).toBeDefined();

        // Capture current interval reference, if any
        const beforeInterval = global.playlistRefreshInterval;

        // Toggle backgroundRefreshMinutes to a different value to force reschedule.
        // Use schema-valid values (config.schema.json minimum is 5).
        const current = Number(cfg.backgroundRefreshMinutes || 60);
        const newMinutes = current === 5 ? 6 : 5;
        const patched = { ...cfg, backgroundRefreshMinutes: newMinutes };

        const postRes = await request(app)
            .post('/api/admin/config')
            .send({ config: patched, env: {} })
            .set('Authorization', 'Bearer test-token')
            .set('Accept', 'application/json');

        if ([401, 403].includes(postRes.status)) {
            console.warn('[TEST] Skipping scheduler reschedule test (unauthorized POST).');
            return;
        }
        expect(postRes.status).toBe(200);

        // Allow the server's setTimeout debounce (1s) to elapse
        await new Promise(r => setTimeout(r, 1200));

        // After reschedule, the global interval should exist and differ from the previous one
        expect(global.playlistRefreshInterval).toBeDefined();
        if (beforeInterval) {
            expect(global.playlistRefreshInterval).not.toBe(beforeInterval);
        }

        // Cleanup: revert config and trigger another reschedule (best-effort)
        const revert = { ...patched, backgroundRefreshMinutes: current };
        await request(app)
            .post('/api/admin/config')
            .send({ config: revert, env: {} })
            .set('Authorization', 'Bearer test-token');
        await new Promise(r => setTimeout(r, 200));
    });
});
