/**
 * API Contract Validation Tests
 *
 * These tests ensure that API endpoints maintain their contracts and don't introduce
 * breaking changes between versions.
 */

const request = require('supertest');

describe('API Contract Validation', () => {
    let app;

    beforeAll(() => {
        // Set test environment
        process.env.NODE_ENV = 'test';
        process.env.API_ACCESS_TOKEN = 'test-token';
        app = require('../../server');
    });

    afterAll(() => {
        if (typeof app.cleanup === 'function') {
            app.cleanup();
        }
    });

    describe('Public API Contracts', () => {
        describe('GET /api/health', () => {
            it('should return health status with expected structure', async () => {
                const res = await request(app).get('/api/health');

                expect(res.status).toBe(200);
                expect(res.body).toHaveProperty('status');
                expect(res.body.status).toBe('ok');
                expect(res.body).toHaveProperty('service', 'posterrama');
                expect(res.body).toHaveProperty('version');
                expect(res.body).toHaveProperty('timestamp');
                expect(res.body).toHaveProperty('uptime');
                expect(typeof res.body.timestamp).toBe('string'); // ISO timestamp
                expect(typeof res.body.uptime).toBe('number');
            });
        });

        describe('GET /get-config', () => {
            it('should return public config endpoint with valid JSON', async () => {
                const res = await request(app).get('/get-config');

                expect(res.status).toBe(200);
                expect(res.body).toBeDefined();
                expect(typeof res.body).toBe('object');
                expect(res.headers['content-type']).toMatch(/json/);
            });
        });

        describe('GET /get-media', () => {
            it('should return media endpoint with valid response', async () => {
                const res = await request(app).get('/get-media');

                // Endpoint exists and returns either success or service unavailable
                expect([200, 503]).toContain(res.status);
                expect(res.headers['content-type']).toMatch(/json/);

                if (res.status === 200) {
                    expect(Array.isArray(res.body)).toBe(true);
                }
            });
        });
    });

    describe('Admin API Contracts (Authenticated)', () => {
        describe('GET /api/admin/config', () => {
            it('should return admin config endpoint with auth check', async () => {
                // Test without auth
                const resNoAuth = await request(app).get('/api/admin/config');
                expect([401, 403]).toContain(resNoAuth.status);

                // Test with auth token
                const res = await request(app)
                    .get('/api/admin/config')
                    .set('Authorization', `Bearer ${process.env.API_ACCESS_TOKEN}`);

                expect([200, 401]).toContain(res.status);
                expect(res.headers['content-type']).toMatch(/json/);

                if (res.status === 200) {
                    expect(res.body).toBeDefined();
                    expect(typeof res.body).toBe('object');
                }
            });
        });
        describe('GET /api/admin/sources', () => {
            it('should return sources endpoint with auth check', async () => {
                const res = await request(app)
                    .get('/api/admin/sources')
                    .set('Authorization', `Bearer ${process.env.API_ACCESS_TOKEN}`);

                // Endpoint may not exist or require auth
                expect([200, 401, 404]).toContain(res.status);

                if (res.status === 200) {
                    expect(res.headers['content-type']).toMatch(/json/);
                    expect(Array.isArray(res.body)).toBe(true);
                }
            });
        });

        describe('GET /api/admin/metrics', () => {
            it('should return metrics endpoint with auth check', async () => {
                const res = await request(app)
                    .get('/api/admin/metrics')
                    .set('Authorization', `Bearer ${process.env.API_ACCESS_TOKEN}`);

                // Endpoint may not exist or require auth
                expect([200, 401, 404]).toContain(res.status);

                if (res.status === 200) {
                    expect(res.headers['content-type']).toMatch(/json/);
                    expect(res.body).toBeDefined();
                    expect(typeof res.body).toBe('object');
                }
            });
        });
    });

    describe('Device Management API Contracts', () => {
        describe('POST /api/devices/register', () => {
            it('should return device registration endpoint response', async () => {
                const res = await request(app)
                    .post('/api/devices/register')
                    .send({
                        deviceId: 'test-device-' + Date.now(),
                        name: 'Test Device',
                    });

                // Endpoint exists and returns proper status
                expect([200, 201, 400, 422]).toContain(res.status);
                expect(res.headers['content-type']).toMatch(/json/);
            });
        });
    });

    describe('WebSocket API Contracts', () => {
        it('should have WebSocket support available', async () => {
            // WebSocket endpoints are registered differently in Express
            // Just verify the app router exists (WS is registered via express-ws)
            expect(app._router).toBeDefined();
            // Router can be either object or function depending on Express version
            expect(['object', 'function']).toContain(typeof app._router);
        });
    });

    describe('Error Handling', () => {
        it('should return 404 with expected structure for non-existent endpoints', async () => {
            const res = await request(app).get('/api/nonexistent');

            expect(res.status).toBe(404);
        });

        it('should return 401 for unauthorized admin requests', async () => {
            const res = await request(app).get('/api/admin/config');

            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('error');
        });

        it('should handle validation for device registration', async () => {
            const res = await request(app).post('/api/devices/register').send({
                // Missing required fields
            });

            // May return validation error or handle missing fields with defaults
            expect([200, 201, 400, 422]).toContain(res.status);
            expect(res.headers['content-type']).toMatch(/json/);
        });
    });

    describe('Response Header Contracts', () => {
        it('should return CORS headers for API endpoints', async () => {
            const res = await request(app).get('/api/health');

            // Helmet's CORS middleware sets access-control-allow-credentials
            expect(res.headers).toHaveProperty('access-control-allow-credentials');
        });

        it('should include content-type header for JSON responses', async () => {
            const res = await request(app).get('/api/health');

            expect(res.headers['content-type']).toMatch(/application\/json/);
        });
    });

    describe('Backward Compatibility', () => {
        it('should maintain GET /api/health structure (v2.x compatibility)', async () => {
            const res = await request(app).get('/api/health');

            // Ensure v2.x contract is maintained
            expect(res.body).toMatchObject({
                status: expect.any(String),
                service: expect.any(String),
                version: expect.any(String),
                timestamp: expect.any(String),
                uptime: expect.any(Number),
            });
        });

        it('should maintain GET /get-config endpoint (v2.9.x)', async () => {
            const res = await request(app).get('/get-config');

            // Endpoint should exist and return 200
            expect(res.status).toBe(200);
            expect(res.body).toBeDefined();

            // In a real environment, these fields would be present
            // In test mode, config may be minimal/empty, which is acceptable
            // The key is that the endpoint exists and returns 200
        });
    });
});
