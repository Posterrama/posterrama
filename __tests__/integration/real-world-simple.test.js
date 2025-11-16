/**
 * Real World Integration Tests - Focused Version
 *
 * Tests use REAL credentials and REAL authentication (no bypass).
 * Focused on API endpoints that work reliably in test environment.
 */

const request = require('supertest');
const credentials = require('../../private/test-credentials.json');

describe('Real World Integration - API Tests', () => {
    let app;

    beforeAll(() => {
        // Set real credentials from private config
        process.env.API_ACCESS_TOKEN = credentials.api.accessToken;
        process.env.ADMIN_USERNAME = credentials.admin.username;
        process.env.ADMIN_PASSWORD_HASH = credentials.admin.passwordHash;
        process.env.SESSION_SECRET = credentials.session.secret;

        // Load server
        app = require('../../server');
    });

    describe('API Authentication', () => {
        it('should reject API calls without authentication', async () => {
            const response = await request(app).get('/api/v1/media');

            expect(response.status).toBe(401);
            expect(response.body.error).toMatch(/authentication|api key/i);
        });

        it('should reject API calls with invalid key', async () => {
            const response = await request(app)
                .get('/api/v1/media')
                .set('x-api-key', 'invalid-key-12345');

            expect(response.status).toBe(401);
        });

        it('should accept API calls with valid key', async () => {
            const response = await request(app)
                .get('/api/v1/media')
                .set('x-api-key', credentials.api.accessToken);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });
    });

    describe('Media API Endpoints', () => {
        it('GET /api/media returns media list', async () => {
            const response = await request(app)
                .get('/api/v1/media')
                .set('x-api-key', credentials.api.accessToken);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });

        it('GET /api/media supports pagination', async () => {
            const response = await request(app)
                .get('/api/media?limit=5&offset=0')
                .set('x-api-key', credentials.api.accessToken);

            expect(response.status).toBe(200);
            expect(response.body.length).toBeLessThanOrEqual(5);
        });

        it('GET /api/media supports source filtering', async () => {
            const response = await request(app)
                .get('/api/media?source=plex')
                .set('x-api-key', credentials.api.accessToken);

            expect(response.status).toBe(200);
            if (response.body.length > 0) {
                expect(response.body.every(item => item.source === 'plex')).toBe(true);
            }
        });

        it('GET /api/genres returns genre list', async () => {
            const response = await request(app)
                .get('/api/v1/genres')
                .set('x-api-key', credentials.api.accessToken);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });

        it('GET /api/media/:id returns 404 for invalid ID', async () => {
            const response = await request(app)
                .get('/api/media/invalid-id-xyz')
                .set('x-api-key', credentials.api.accessToken);

            expect(response.status).toBe(404);
        });
    });

    describe('Device Management API', () => {
        it('GET /api/devices returns device list', async () => {
            const response = await request(app)
                .get('/api/v1/devices')
                .set('x-api-key', credentials.api.accessToken);

            expect(response.status).toBe(200);
            expect(typeof response.body === 'object' || Array.isArray(response.body)).toBe(true);
        });

        it('POST /api/devices/register creates new device', async () => {
            const deviceData = {
                deviceId: `integration-test-${Date.now()}`,
                name: 'Integration Test Device',
                type: 'browser',
            };

            const response = await request(app)
                .post('/api/devices/register')
                .set('x-api-key', credentials.api.accessToken)
                .send(deviceData);

            expect([200, 201]).toContain(response.status);
            expect(response.body.deviceId || response.body.id).toBeDefined();
        });
    });

    describe('Health & Metrics', () => {
        it('GET /health returns health status (no auth required)', async () => {
            const response = await request(app).get('/api/health');

            expect(response.status).toBe(200);
            expect(response.body.status).toBeDefined();
        });

        it('GET /api/metrics returns metrics with auth', async () => {
            const response = await request(app)
                .get('/api/v1/metrics')
                .set('x-api-key', credentials.api.accessToken);

            expect(response.status).toBe(200);
            expect(typeof response.body).toBe('object');
        });
    });

    describe('Public Routes (No Auth)', () => {
        it('GET / serves homepage', async () => {
            const response = await request(app).get('/');

            expect(response.status).toBe(200);
            expect(response.type).toMatch(/html/);
        });

        it('GET /screensaver serves screensaver page', async () => {
            const response = await request(app).get('/screensaver');

            expect(response.status).toBe(200);
            expect(response.type).toMatch(/html/);
        });

        it('GET /wallart serves wallart page', async () => {
            const response = await request(app).get('/wallart');

            expect(response.status).toBe(200);
            expect(response.type).toMatch(/html/);
        });
    });

    describe('Error Handling', () => {
        it('returns 404 for non-existent routes', async () => {
            const response = await request(app).get('/nonexistent-route-xyz');

            expect(response.status).toBe(404);
        });

        it('handles malformed JSON gracefully', async () => {
            const response = await request(app)
                .post('/api/devices/register')
                .set('x-api-key', credentials.api.accessToken)
                .set('Content-Type', 'application/json')
                .send('invalid json{{{');

            expect(response.status).toBe(400);
        });
    });

    describe('Security', () => {
        it('includes security headers', async () => {
            const response = await request(app).get('/');

            expect(response.headers['x-content-type-options']).toBeDefined();
        });

        it('does not expose server version', async () => {
            const response = await request(app).get('/');

            expect(response.headers['x-powered-by']).toBeUndefined();
        });
    });
});
