const request = require('supertest');
const app = require('../server');

describe('API Versioning', () => {
    describe('Version Headers', () => {
        test('should return API version in response headers', async () => {
            const response = await request(app).get('/api/health');
            expect(response.headers).toHaveProperty('x-api-version');
            expect(response.headers['x-api-version']).toMatch(/^\d+\.\d+\.\d+$/);
        });

        test('should accept version in request headers', async () => {
            const response = await request(app)
                .get('/api/health')
                .set('Accept-Version', '1.2.0');
            // Accept both 200 and 503 as the health check might fail due to missing Plex server
            expect([200, 503]).toContain(response.statusCode);
            expect(response.headers).toHaveProperty('x-api-version');
        });

        test('should reject unsupported API versions', async () => {
            const response = await request(app)
                .get('/api/health')
                .set('Accept-Version', '2.0.0');
            expect(response.statusCode).toBe(400);
            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toContain('Unsupported API version');
        });
    });

    describe('Version-specific endpoints', () => {
        test('should handle /v1/config endpoint', async () => {
            const response = await request(app).get('/api/v1/config');
            expect(response.statusCode).toBe(200);
            expect(response.body).toHaveProperty('clockWidget');
        });

        test('should handle /v1/media endpoint', async () => {
            const response = await request(app).get('/api/v1/media');
            expect([200, 202, 503]).toContain(response.statusCode);
        });
    });
});
