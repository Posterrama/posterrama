const request = require('supertest');

describe('Admin Group Command wait=true', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.DEVICE_MGMT_ENABLED = 'true';
        process.env.API_ACCESS_TOKEN = 'test-token';
    });

    test('collects per-device ACKs and queues offline members', async () => {
        let app;
        let wsHub;
        jest.isolateModules(() => {
            jest.mock('../../utils/wsHub', () => {
                const statuses = new Map();
                return {
                    isConnected: id => statuses.get(id) !== 'offline',
                    sendCommand: () => true,
                    sendCommandAwait: id => {
                        const s = statuses.get(id);
                        if (s === 'ok') return Promise.resolve({ status: 'ok' });
                        if (s === 'timeout') return Promise.reject(new Error('ack_timeout'));
                        return Promise.reject(new Error('not_connected'));
                    },
                    __setStatus: (id, status) => statuses.set(id, status),
                };
            });
            app = require('../../server');
            wsHub = require('../../utils/wsHub');
        });

        // Create a group (unique per run to avoid conflicts)
        const gid = `g-wait-${Math.random().toString(36).slice(2, 8)}`;
        await request(app)
            .post('/api/groups')
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send({ id: gid, name: 'G Wait' })
            .expect(201);

        // Register three devices
        const r1 = await request(app)
            .post('/api/devices/register')
            .set('Content-Type', 'application/json')
            .send({ installId: 'iid-g1', hardwareId: 'hw-g1' })
            .expect(200);
        const r2 = await request(app)
            .post('/api/devices/register')
            .set('Content-Type', 'application/json')
            .send({ installId: 'iid-g2', hardwareId: 'hw-g2' })
            .expect(200);
        const r3 = await request(app)
            .post('/api/devices/register')
            .set('Content-Type', 'application/json')
            .send({ installId: 'iid-g3', hardwareId: 'hw-g3' })
            .expect(200);

        // Assign group
        const ids = [r1.body.deviceId, r2.body.deviceId, r3.body.deviceId];
        for (const id of ids) {
            await request(app)
                .patch(`/api/devices/${encodeURIComponent(id)}`)
                .set('Authorization', 'Bearer test-token')
                .set('Content-Type', 'application/json')
                .send({ groups: [gid] })
                .expect(200);
        }

        // Mock per-device statuses
        wsHub.__setStatus(r1.body.deviceId, 'ok');
        wsHub.__setStatus(r2.body.deviceId, 'timeout');
        wsHub.__setStatus(r3.body.deviceId, 'offline');

        const res = await request(app)
            .post(`/api/groups/${encodeURIComponent(gid)}/command?wait=true`)
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send({ type: 'core.mgmt.reload' })
            .expect(200);

        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('total', 3);
        expect(Array.isArray(res.body.results)).toBe(true);
        const map = new Map(res.body.results.map(r => [r.deviceId, r.status]));
        expect(map.get(r1.body.deviceId)).toBe('ok');
        expect(map.get(r2.body.deviceId)).toBe('timeout');
        expect(map.get(r3.body.deviceId)).toBe('queued');
    });
});
