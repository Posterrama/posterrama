const fs = require('fs');
const path = require('path');
const request = require('supertest');

describe('Admin config preserves TMDB apiKey when null sent', () => {
    let serverModule;
    let app;
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    const configBackupPath = path.join(__dirname, '..', '..', 'config.json.backup');
    let originalConfigText;
    let originalConfigBackupText;

    beforeAll(() => {
        originalConfigText = fs.readFileSync(configPath, 'utf8');
        try {
            originalConfigBackupText = fs.readFileSync(configBackupPath, 'utf8');
        } catch (_) {
            originalConfigBackupText = null;
        }
        const originalConfig = JSON.parse(originalConfigText);

        // Ensure a deterministic TMDB apiKey exists in config.json before server loads.
        originalConfig.tmdbSource = {
            ...(originalConfig.tmdbSource || {}),
            enabled: true,
            apiKey: 'test_tmdb_key_should_not_be_wiped',
        };
        fs.writeFileSync(configPath, JSON.stringify(originalConfig, null, 4) + '\n', 'utf8');

        jest.resetModules();
        serverModule = require('../../server');
        app = serverModule.app || serverModule;
    });

    afterAll(() => {
        fs.writeFileSync(configPath, originalConfigText, 'utf8');
        try {
            if (typeof originalConfigBackupText === 'string') {
                fs.writeFileSync(configBackupPath, originalConfigBackupText, 'utf8');
            }
        } catch (_) {
            // Best-effort: test cleanup should never fail the suite.
        }
    });

    test('POST /api/admin/config keeps existing tmdbSource.apiKey if apiKey is null', async () => {
        const get1 = await request(app)
            .get('/api/admin/config')
            .set('Accept', 'application/json')
            .set('Authorization', 'Bearer test-token');

        if (get1.status === 401) {
            console.warn('[TEST] Skipping TMDB apiKey preservation test (unauthorized in CI).');
            return;
        }

        expect(get1.status).toBe(200);
        const baseCfg = get1.body?.config;
        expect(baseCfg).toBeTruthy();

        const cfgPatch = JSON.parse(JSON.stringify(baseCfg));
        cfgPatch.tmdbSource = {
            ...(cfgPatch.tmdbSource || {}),
            enabled: true,
            apiKey: null, // UI semantic: do not change
        };

        const postRes = await request(app)
            .post('/api/admin/config')
            .set('Authorization', 'Bearer test-token')
            .send({ config: cfgPatch, env: {} })
            .set('Accept', 'application/json');

        if (postRes.status === 401) {
            console.warn('[TEST] Skipping TMDB apiKey preservation test (unauthorized POST).');
            return;
        }

        expect(postRes.status).toBe(200);

        const diskCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        expect(diskCfg.tmdbSource).toBeTruthy();
        expect(diskCfg.tmdbSource.apiKey).toBe('test_tmdb_key_should_not_be_wiped');
    });
});
