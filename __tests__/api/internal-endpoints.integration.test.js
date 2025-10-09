/**
 * Integration test ensuring internal test endpoints are mounted when
 * EXPOSE_INTERNAL_ENDPOINTS=true and accessible through full server.
 */

const request = require('supertest');

describe('Internal endpoints (integration)', () => {
    let app;
    beforeAll(() => {
        process.env.EXPOSE_INTERNAL_ENDPOINTS = 'true';
        // Ensure we start with a clean module state
        const srvPath = require.resolve('../../server.js');
        delete require.cache[srvPath];

        app = require('../../server.js');
    });
    afterAll(() => {
        delete process.env.EXPOSE_INTERNAL_ENDPOINTS;
    });

    test('generate-logs endpoint responds with success', async () => {
        const res = await request(app).get('/api/test/generate-logs?count=2');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.count).toBe(2);
    });

    test('clear-logs endpoint responds with success', async () => {
        const res = await request(app).get('/api/test/clear-logs');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.afterCount).toBe(0);
    });
});
