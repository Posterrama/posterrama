const request = require('supertest');
const app = require('../../server');

describe('Admin logs stream auth', () => {
    test('GET /api/admin/logs/stream requires authentication', async () => {
        const res = await request(app).get('/api/admin/logs/stream');

        expect(res.status).toBe(401);
        // Should not be an SSE stream when denied
        expect(String(res.headers['content-type'] || '')).toContain('application/json');
        expect(res.body).toHaveProperty('error');
    });
});
