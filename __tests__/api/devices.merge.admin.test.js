const request = require('supertest');

let app;

describe('Admin Devices Merge API', () => {
    beforeAll(() => {
        process.env.NODE_ENV = 'test';
        // Provide an API token for adminAuth
        process.env.API_ACCESS_TOKEN = 'test-token';
        jest.resetModules();
        app = require('../../server');
    });

    test('POST /api/devices/:id/merge requires auth', async () => {
        const res = await request(app)
            .post('/api/devices/some-id/merge')
            .send({ sourceIds: ['a', 'b'] });
        expect(res.status).toBe(401);
    });

    test('merge two newly registered devices into one (200)', async () => {
        // Register two devices
        const r1 = await request(app)
            .post('/api/devices/register')
            .send({ installId: 'iid-a', hardwareId: 'hw-a' })
            .expect(200);
        const r2 = await request(app)
            .post('/api/devices/register')
            .send({ installId: 'iid-b', hardwareId: 'hw-b' })
            .expect(200);

        const targetId = r1.body.deviceId;
        const sourceId = r2.body.deviceId;

        const res = await request(app)
            .post(`/api/devices/${encodeURIComponent(targetId)}/merge`)
            .set('Authorization', 'Bearer test-token')
            .send({ sourceIds: [sourceId] });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('merged');

        // Target still exists
        const t = await request(app)
            .get(`/api/devices/${encodeURIComponent(targetId)}`)
            .set('Authorization', 'Bearer test-token')
            .expect(200);
        expect(t.body).toHaveProperty('id', targetId);

        // Source should be gone
        const s = await request(app)
            .get(`/api/devices/${encodeURIComponent(sourceId)}`)
            .set('Authorization', 'Bearer test-token');
        expect(s.status).toBe(404);
    });
});
