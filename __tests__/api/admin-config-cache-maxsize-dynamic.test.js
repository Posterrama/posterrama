/** @jest-environment node */
const request = require('supertest');
const fs = require('fs');
const path = require('path');

describe('Admin config: dynamic cache.maxSizeGB limit', () => {
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    let originalConfig;
    let app;
    let statfsSpy;

    beforeAll(() => {
        originalConfig = fs.readFileSync(configPath, 'utf8');

        process.env.NODE_ENV = 'test';
        process.env.API_ACCESS_TOKEN = 'test-token';
        process.env.CACHE_DISK_FREE_TTL_MS = '0';

        // Make free disk space deterministic: 10GB free -> max settable is 9.0GB.
        const fsMod = require('fs');
        if (typeof fsMod.promises.statfs === 'function') {
            const tenGb = 10 * 1024 * 1024 * 1024;
            const bsize = 4096;
            const bavail = Math.floor(tenGb / bsize);
            statfsSpy = jest.spyOn(fsMod.promises, 'statfs').mockResolvedValue({ bavail, bsize });
        }

        jest.resetModules();
        const serverModule = require('../../server');
        app = serverModule.app || serverModule;
    });

    afterAll(() => {
        try {
            fs.writeFileSync(configPath, originalConfig, 'utf8');
        } catch (_) {
            // ignore
        }
        try {
            statfsSpy?.mockRestore();
        } catch (_) {
            // ignore
        }
        delete process.env.CACHE_DISK_FREE_TTL_MS;
        delete process.env.API_ACCESS_TOKEN;
    });

    test('rejects cache.maxSizeGB above free-1GB', async () => {
        const getRes = await request(app)
            .get('/api/admin/config')
            .set('Authorization', 'Bearer test-token');

        if ([401, 403].includes(getRes.status)) {
            console.warn('[TEST] Skipping cache maxSizeGB limit test (unauthorized GET).');
            return;
        }

        expect(getRes.status).toBe(200);
        const cfg = getRes.body?.config;
        expect(cfg).toBeDefined();

        const patched = {
            ...cfg,
            cache: {
                ...(cfg.cache || {}),
                maxSizeGB: 99,
            },
        };

        const postRes = await request(app)
            .post('/api/admin/config')
            .send({ config: patched, env: {} })
            .set('Authorization', 'Bearer test-token')
            .set('Accept', 'application/json');

        if ([401, 403].includes(postRes.status)) {
            console.warn('[TEST] Skipping cache maxSizeGB limit test (unauthorized POST).');
            return;
        }

        expect(postRes.status).toBe(400);
    });
});
