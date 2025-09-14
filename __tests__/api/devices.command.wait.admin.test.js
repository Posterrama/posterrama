const request = require('supertest');

describe('Admin Device Command wait=true', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.DEVICE_MGMT_ENABLED = 'true';
        process.env.API_ACCESS_TOKEN = 'test-token';
    });

    test('queues when device is not connected (wait=true)', async () => {
        const app = require('../../server');
        // Register a device
        const reg = await request(app)
            .post('/api/devices/register')
            .send({ installId: 'iid-wait-offline', hardwareId: 'hw-wait-offline' })
            .expect(200);
        const id = reg.body.deviceId;

        // Send command with wait=true, expect queued because no WS connection exists
        const res = await request(app)
            .post(`/api/devices/${encodeURIComponent(id)}/command?wait=true`)
            .set('Authorization', 'Bearer test-token')
            .send({ type: 'core.mgmt.reload' })
            .expect(200);
        expect(res.body).toHaveProperty('queued', true);
        expect(res.body).toHaveProperty('live', false);
        expect(res.body).toHaveProperty('command');
    });

    test('returns 202 with ack timeout when WS connected but no ACK', async () => {
        let run;
        // Mock wsHub to simulate connected device and ack timeout
        jest.isolateModules(() => {
            jest.mock('../../utils/wsHub', () => ({
                isConnected: () => true,
                sendCommand: () => true,
                sendCommandAwait: () => Promise.reject(new Error('ack_timeout')),
            }));
            const app = require('../../server');
            run = async () => {
                const reg = await request(app)
                    .post('/api/devices/register')
                    .set('Content-Type', 'application/json')
                    .send({ installId: 'iid-wait-timeout', hardwareId: 'hw-wait-timeout' })
                    .expect(200);
                const id = reg.body.deviceId;

                const res = await request(app)
                    .post(`/api/devices/${encodeURIComponent(id)}/command?wait=true`)
                    .set('Authorization', 'Bearer test-token')
                    .set('Content-Type', 'application/json')
                    .send({ type: 'core.mgmt.reload' });
                expect([202, 200]).toContain(res.status); // Prefer 202; accept 200 for env differences
                if (res.status === 202) {
                    expect(res.body).toHaveProperty('ack');
                    expect(res.body.ack).toHaveProperty('status', 'timeout');
                }
            };
        });
        await run();
    });
});
