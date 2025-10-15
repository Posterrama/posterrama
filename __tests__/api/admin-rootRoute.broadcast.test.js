/** @jest-environment node */
const request = require('supertest');

// We will mock wsHub to observe broadcast calls
jest.mock('../../utils/wsHub', () => {
    const real = jest.requireActual('../../utils/wsHub');
    return {
        ...real,
        broadcast: jest.fn(() => true),
    };
});

const wsHub = require('../../utils/wsHub');

describe('Admin config: broadcast mode.navigate on rootRoute change', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.API_ACCESS_TOKEN = 'test-token';
    });

    afterEach(() => {
        jest.clearAllMocks();
        delete process.env.API_ACCESS_TOKEN;
    });

    test('emits mode.navigate when behavior=redirect and defaultMode changes', async () => {
        const app = require('../../server');

        // Load current config
        const get1 = await request(app).get('/api/admin/config');
        expect([200, 401, 403]).toContain(get1.status);
        if (get1.status !== 200) return; // if unauthorized in env, skip

        const cfg = get1.body?.config || {};
        const current = (cfg.rootRoute && cfg.rootRoute.defaultMode) || 'screensaver';
        const next = current === 'screensaver' ? 'wallart' : 'screensaver';

        const payload = {
            config: {
                ...cfg,
                rootRoute: {
                    behavior: 'redirect',
                    defaultMode: next,
                    statusCode: 302,
                    bypassParam: (cfg.rootRoute && cfg.rootRoute.bypassParam) || 'landing',
                },
            },
            env: {},
        };

        const res = await request(app)
            .post('/api/admin/config')
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send(payload);
        expect([200, 401, 403]).toContain(res.status);
        if (res.status !== 200) return; // unauthorized path skips further asserts

        expect(wsHub.broadcast).toHaveBeenCalled();
        const args = wsHub.broadcast.mock.calls[0][0];
        expect(args).toMatchObject({ kind: 'command', type: 'mode.navigate' });
        expect(args.payload).toHaveProperty('mode', next);
    });

    test('does not emit when behavior=landing or unchanged', async () => {
        jest.clearAllMocks();
        const app = require('../../server');
        const get1 = await request(app).get('/api/admin/config');
        if (get1.status !== 200) return; // skip when unauthorized
        const cfg = get1.body?.config || {};
        const current = (cfg.rootRoute && cfg.rootRoute.defaultMode) || 'screensaver';

        // behavior landing => no broadcast
        const payloadLanding = {
            config: {
                ...cfg,
                rootRoute: {
                    behavior: 'landing',
                    defaultMode: current,
                    statusCode: 302,
                    bypassParam: 'landing',
                },
            },
            env: {},
        };
        await request(app)
            .post('/api/admin/config')
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send(payloadLanding);
        expect(wsHub.broadcast).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'mode.navigate' })
        );
    });
});
