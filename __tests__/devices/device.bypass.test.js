/**
 * Tests for device management bypass (IP allow list)
 */
let app;
let server;
let baseUrl;

async function startServer(customConfig) {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.DEVICE_MGMT_ENABLED = 'true';

    // Write temporary config with bypass list
    const fs = require('fs');
    const path = require('path');
    const cfgPath = path.join(__dirname, '..', '..', 'config.json');
    const original = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const merged = {
        ...original,
        deviceMgmt: {
            ...(original.deviceMgmt || {}),
            bypass: { ipAllowList: ['127.0.0.1', '10.255.0.0/16'] },
        },
        ...(customConfig || {}),
    };
    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2));

    const uniquePort = 11000 + Math.floor(Math.random() * 2000);
    process.env.SERVER_PORT = String(uniquePort);

    Object.keys(require.cache).forEach(key => {
        if (key.includes('/server.js')) delete require.cache[key];
    });
    app = require('../../server');
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('startup timeout')), 5000);
        server = app.listen(uniquePort, '127.0.0.1', () => {
            clearTimeout(t);
            resolve();
        });
    });
    baseUrl = `http://127.0.0.1:${uniquePort}`;
}

async function stopServer() {
    try {
        if (server && server.close) {
            await new Promise(resolve => server.close(resolve));
        }
    } catch (_) {
        /* noop */
    }
    delete process.env.SERVER_PORT;
}

async function api(pathname, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch(baseUrl + pathname, { ...opts, headers });
    let data = null;
    try {
        data = await res.json();
    } catch (_) {
        /* non-json */
    }
    return { res, data };
}

describe('Device bypass', () => {
    beforeAll(async () => {
        await startServer();
    }, 15000);
    afterAll(async () => {
        await stopServer();
    });

    test('bypass-check returns bypass=true for allowed IP', async () => {
        const r = await api('/api/devices/bypass-check');
        expect(r.res.status).toBe(200);
        expect(r.data).toHaveProperty('bypass');
        expect(r.data.bypass).toBe(true);
    });

    test('get-config surfaces bypassActive flag', async () => {
        const r = await api('/get-config');
        expect(r.res.status).toBe(200);
        expect(r.data.deviceMgmt?.bypassActive).toBe(true);
    });
});
