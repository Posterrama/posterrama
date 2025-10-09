const request = require('supertest');

describe('Admin broadcast to all devices', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.DEVICE_MGMT_ENABLED = 'true';
        process.env.API_ACCESS_TOKEN = 'test-token';

        // Isolated device store per test run
        const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        process.env.DEVICES_STORE_PATH = `devices.broadcast.${unique}.json`;
    });

    afterEach(() => {
        delete process.env.API_ACCESS_TOKEN;
        delete process.env.DEVICE_MGMT_ENABLED;
        delete process.env.DEVICES_STORE_PATH;
    });

    test('POST /api/devices/command queues for offline devices (no-wait)', async () => {
        const app = require('../../server');

        // Register a couple of devices (no WS connection in test)
        const reg1 = await request(app)
            .post('/api/devices/register')
            .set('Content-Type', 'application/json')
            .send({ installId: 'iid-b1', hardwareId: 'hw-b1' })
            .expect(200);
        const reg2 = await request(app)
            .post('/api/devices/register')
            .set('Content-Type', 'application/json')
            .send({ installId: 'iid-b2', hardwareId: 'hw-b2' })
            .expect(200);

        expect(reg1.body).toHaveProperty('deviceId');
        expect(reg2.body).toHaveProperty('deviceId');

        const res = await request(app)
            .post('/api/devices/command')
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send({ type: 'core.mgmt.reload' })
            .expect(200);

        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('total', 2);
        expect(typeof res.body.live).toBe('number');
        expect(typeof res.body.queued).toBe('number');
        // In this test, no sockets are connected, so all should be queued
        expect(res.body.live).toBe(0);
        expect(res.body.queued).toBe(2);
    });

    test('POST /api/devices/clear-reload responds with counts', async () => {
        const app = require('../../server');

        // Register devices
        await request(app)
            .post('/api/devices/register')
            .set('Content-Type', 'application/json')
            .send({ installId: 'iid-cr1', hardwareId: 'hw-cr1' })
            .expect(200);
        await request(app)
            .post('/api/devices/register')
            .set('Content-Type', 'application/json')
            .send({ installId: 'iid-cr2', hardwareId: 'hw-cr2' })
            .expect(200);

        const res = await request(app)
            .post('/api/devices/clear-reload')
            .set('Authorization', 'Bearer test-token')
            .expect(200);

        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('total');
        expect(res.body.total).toBeGreaterThanOrEqual(2);
        expect(typeof res.body.live).toBe('number');
        expect(typeof res.body.queued).toBe('number');
    });
});
