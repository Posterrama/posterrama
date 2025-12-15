const request = require('supertest');

// Note: server.js exports the Express app (does not listen in Jest mode)
const app = require('../../server');

describe('Prometheus /metrics endpoint auth', () => {
    beforeEach(() => {
        process.env.API_ACCESS_TOKEN = 'test-metrics-token';
    });

    afterEach(() => {
        delete process.env.API_ACCESS_TOKEN;
    });

    test('denies access without auth', async () => {
        const res = await request(app).get('/metrics');
        expect(res.status).toBe(401);
        expect(String(res.text || '')).toContain('Unauthorized');
    });

    test('allows access with Authorization header', async () => {
        const res = await request(app)
            .get('/metrics')
            .set('Authorization', 'Bearer test-metrics-token');

        expect(res.status).toBe(200);
        expect(String(res.headers['content-type'] || '')).toContain('text/plain');
        expect(String(res.text || '')).toContain('#');
    });

    test('allows access with X-API-Key header', async () => {
        const res = await request(app).get('/metrics').set('X-API-Key', 'test-metrics-token');

        expect(res.status).toBe(200);
        expect(String(res.headers['content-type'] || '')).toContain('text/plain');
    });
});
