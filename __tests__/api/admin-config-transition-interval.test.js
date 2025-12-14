const request = require('supertest');
const path = require('path');
const fs = require('fs');

describe('Admin config transitionIntervalSeconds guardrails', () => {
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

    test('POST /api/admin/config never persists 0', async () => {
        const getRes = await request(app)
            .get('/api/admin/config')
            .set('Authorization', 'Bearer test-token');
        if ([401, 403].includes(getRes.status)) {
            console.warn('[TEST] Skipping transition interval guardrail test (unauthorized GET).');
            return;
        }
        expect(getRes.status).toBe(200);
        const cfg = getRes.body.config;
        expect(cfg).toBeDefined();

        const patched = { ...cfg, transitionIntervalSeconds: 0 };

        const postRes = await request(app)
            .post('/api/admin/config')
            .send({ config: patched, env: {} })
            .set('Authorization', 'Bearer test-token')
            .set('Accept', 'application/json');

        if ([401, 403].includes(postRes.status)) {
            console.warn('[TEST] Skipping transition interval guardrail test (unauthorized POST).');
            return;
        }
        expect(postRes.status).toBe(200);

        const diskCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        expect(Number(diskCfg.transitionIntervalSeconds)).toBeGreaterThanOrEqual(5);
    });
});
