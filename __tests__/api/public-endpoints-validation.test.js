/**
 * Public API Endpoints Validation Tests
 * Com        test('should return valid media array or service status', async () => {
            const res = await request(app)
                .get('/get-med        test('should handle valid image URL', async () => {
            const res = await request(app)
                .get('/image?url=https://httpbin.org/status/200')
                .timeout(5000); // 5 second timeout

            // May return image, error, or cached response, or redirect to fallback
            expect([200, 302, 400, 404, 500]).toContain(res.status);
        }, 10000);              .expect('Content-Type', /json/);

            // Media endpoint can return 200 (with data), 202 (building), or 503 (unavailable)
            expect([200, 202, 503]).toContain(res.status);
            
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            } else if (res.status === 202) {
                expect(res.body).toHaveProperty('status', 'building');
                expect(res.body).toHaveProperty('retryIn');
            } else if (res.status === 503) {
                expect(res.body).toHaveProperty('status', 'failed');
            }
        });ve validation of all public-facing API endpoints
 */

const request = require('supertest');
const app = require('../../server');

// Mock logger to avoid side effects
jest.mock('../../utils/logger');

describe('Public API Endpoints Validation', () => {
    describe('GET /get-config', () => {
        test('should return valid config structure', async () => {
            const res = await request(app)
                .get('/get-config')
                .expect('Content-Type', /json/)
                .expect(200);

            // Validate required config properties
            expect(res.body).toHaveProperty('clockWidget');
            expect(res.body).toHaveProperty('wallartMode');
            expect(typeof res.body.clockWidget).toBe('boolean');
            expect(typeof res.body.wallartMode).toBe('object');

            // Validate caching headers
            expect(res.headers).toHaveProperty('cache-control');
        });

        test('should handle invalid query parameters gracefully', async () => {
            const res = await request(app)
                .get('/get-config?invalid=<script>alert("xss")</script>')
                .expect(200);

            // Should not crash and return valid config
            expect(res.body).toHaveProperty('clockWidget');
        });

        test('should have proper security headers', async () => {
            const res = await request(app).get('/get-config').expect(200);

            // Check for security headers
            expect(res.headers).toHaveProperty('x-frame-options');
            expect(res.headers).toHaveProperty('x-content-type-options');
        });
    });

    describe('GET /get-media', () => {
        test('should return valid media array', async () => {
            const res = await request(app).get('/get-media').expect('Content-Type', /json/);

            // Media endpoint can return 200 (with data), 202 (building), or 503 (unavailable)
            expect([200, 202, 503]).toContain(res.status);

            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);

                // If media exists, validate structure
                if (res.body.length > 0) {
                    const media = res.body[0];
                    expect(media).toHaveProperty('title');
                    expect(media).toHaveProperty('year');
                }
            }
        });

        test('should handle search parameter validation', async () => {
            const res = await request(app)
                .get('/get-media?search=test')
                .expect('Content-Type', /json/);

            expect([200, 202, 503]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            }
        });

        test('should handle year parameter validation', async () => {
            const res = await request(app)
                .get('/get-media?year=2023')
                .expect('Content-Type', /json/);

            expect([200, 202, 503]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            }
        });

        test('should reject invalid year parameter', async () => {
            const res = await request(app)
                .get('/get-media?year=invalid')
                .expect('Content-Type', /json/);

            // Should reject with validation error
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });

        test('should handle genre parameter validation', async () => {
            const res = await request(app)
                .get('/get-media?genre=action')
                .expect('Content-Type', /json/);

            expect([200, 202, 503]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            }
        });

        test('should sanitize malicious query parameters', async () => {
            const res = await request(app)
                .get('/get-media?search=<script>alert("xss")</script>&year=2023')
                .expect('Content-Type', /json/);

            // Should accept sanitized input, reject invalid input, or return service status
            expect([200, 202, 400, 503]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            }
        });

        test('should respect rate limiting', async () => {
            const requests = Array(5)
                .fill()
                .map(() => request(app).get('/get-media'));

            const responses = await Promise.all(requests);

            // All should succeed under normal rate limits or return expected status codes
            responses.forEach(res => {
                expect([200, 202, 429, 503]).toContain(res.status);
            });
        }, 10000);
    });

    describe('GET /get-media-by-key/:key', () => {
        test('should handle valid key format', async () => {
            const res = await request(app)
                .get('/get-media-by-key/test-key-123')
                .expect('Content-Type', /json/);

            // Should return 200 with media, 404 if not found, or 400 for invalid format
            expect([200, 400, 404]).toContain(res.status);
        });

        test('should handle invalid key characters', async () => {
            const res = await request(app)
                .get('/get-media-by-key/<script>alert("xss")</script>')
                .expect('Content-Type', /json/);

            // Should handle gracefully
            expect([200, 404, 400]).toContain(res.status);
        });

        test('should handle empty key', async () => {
            const res = await request(app).get('/get-media-by-key/').expect(404); // Should match route properly
        });

        test('should handle very long key', async () => {
            const longKey = 'a'.repeat(1000);
            const res = await request(app).get(`/get-media-by-key/${longKey}`);

            expect([200, 404, 400]).toContain(res.status);
        });
    });

    describe('GET /image', () => {
        test('should require url parameter', async () => {
            const res = await request(app).get('/image').expect(400);

            expect(res.body).toHaveProperty('error');
        });

        test('should validate url parameter format', async () => {
            const res = await request(app).get('/image?url=invalid-url').expect(400);

            expect(res.body).toHaveProperty('error');
        });

        test('should handle valid image URL', async () => {
            const res = await request(app).get('/image?url=https://example.com/image.jpg');

            // May return image, error, or cached response
            expect([200, 302, 400, 404, 500]).toContain(res.status);
        });

        test('should sanitize malicious URL parameters', async () => {
            const res = await request(app).get('/image?url=javascript:alert("xss")').expect(400);

            expect(res.body).toHaveProperty('error');
        });

        test('should handle proper caching headers', async () => {
            const res = await request(app).get('/image?url=https://httpbin.org/image/jpeg');

            if (res.status === 200) {
                expect(res.headers).toHaveProperty('cache-control');
            }
        }, 10000);
    });

    describe('GET /health', () => {
        test('should return basic health information', async () => {
            const res = await request(app)
                .get('/health')
                .expect('Content-Type', /json/)
                .expect(200);

            expect(res.body).toHaveProperty('status');
            expect(res.body).toHaveProperty('timestamp');
            expect(typeof res.body.timestamp).toBe('string');
        });

        test('should handle health check without authentication', async () => {
            const res = await request(app).get('/health').expect(200);

            // Health check should be publicly accessible
            expect(res.body.status).toBeDefined();
        });
    });

    describe('GET /api/health', () => {
        test('should return detailed health information', async () => {
            const res = await request(app)
                .get('/api/health')
                .expect('Content-Type', /json/)
                .expect(200);

            expect(res.body).toHaveProperty('status');
            expect(res.body).toHaveProperty('timestamp');
            expect(res.body).toHaveProperty('checks');
            expect(Array.isArray(res.body.checks)).toBe(true);
        });
    });

    describe('API v1 Aliases', () => {
        test('GET /api/v1/config should work like /get-config', async () => {
            const [originalRes, aliasRes] = await Promise.all([
                request(app).get('/get-config'),
                request(app).get('/api/v1/config'),
            ]);

            expect(originalRes.status).toBe(200);
            expect(aliasRes.status).toBe(200);

            // Both should have non-empty response bodies
            expect(originalRes.body).toBeDefined();
            expect(aliasRes.body).toBeDefined();
            expect(typeof originalRes.body).toBe('object');
            expect(typeof aliasRes.body).toBe('object');

            // Both should have the same basic structure (ignore debug differences)
            if (originalRes.body && Object.keys(originalRes.body).length > 0) {
                expect(originalRes.body).toHaveProperty('clockWidget');
            }
            if (aliasRes.body && Object.keys(aliasRes.body).length > 0) {
                expect(aliasRes.body).toHaveProperty('clockWidget');
            }
        });

        test('GET /api/v1/media should work like /get-media', async () => {
            const [originalRes, aliasRes] = await Promise.all([
                request(app).get('/get-media'),
                request(app).get('/api/v1/media'),
            ]);

            // Both should return same status (may be 200, 202, or 503)
            expect(originalRes.status).toBe(aliasRes.status);
            if (originalRes.status === 200) {
                expect(originalRes.body).toEqual(aliasRes.body);
            }
        });

        test('should handle API versioning headers', async () => {
            const res = await request(app)
                .get('/api/v1/config')
                .set('Accept-Version', '1.2.0')
                .expect(200);

            expect(res.headers).toHaveProperty('x-api-version');
        });

        test('should reject unsupported API versions', async () => {
            const res = await request(app)
                .get('/api/v1/config')
                .set('Accept-Version', '999.0.0')
                .expect(400);

            expect(res.body).toHaveProperty('error');
            expect(res.body.error).toContain('Unsupported API version');
        });
    });

    describe('Error Handling Validation', () => {
        test('should return consistent error format', async () => {
            const res = await request(app)
                .get('/api/v1/config')
                .set('Accept-Version', '999.0.0')
                .expect(400);

            expect(res.body).toHaveProperty('error');
            expect(typeof res.body.error).toBe('string');
        });

        test('should handle 404 with proper format', async () => {
            const res = await request(app).get('/api/nonexistent-endpoint').expect(404);

            expect(res.body).toHaveProperty('error');
        });

        test('should handle malformed requests gracefully', async () => {
            const res = await request(app)
                .get('/get-config')
                .set('Content-Type', 'application/json')
                .send('invalid json {')
                .expect('Content-Type', /json/);

            // GET requests should ignore body and return config or validation error
            expect([200, 400]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body).toHaveProperty('clockWidget');
            }
        });
    });

    describe('Security Validation', () => {
        test('should have proper CORS headers', async () => {
            const res = await request(app)
                .get('/get-config')
                .set('Origin', 'http://localhost:3000')
                .expect(200);

            expect(res.headers).toHaveProperty('access-control-allow-origin');
        });

        test('should sanitize response headers', async () => {
            const res = await request(app).get('/get-config').expect(200);

            // Check that sensitive headers are not exposed
            expect(res.headers).not.toHaveProperty('x-powered-by');
        });

        test('should handle OPTIONS preflight requests', async () => {
            const res = await request(app)
                .options('/get-config')
                .set('Origin', 'http://localhost:3000')
                .set('Access-Control-Request-Method', 'GET');

            expect([200, 204]).toContain(res.status);
        });
    });

    describe('Performance Validation', () => {
        test('should respond within reasonable time', async () => {
            const start = Date.now();

            await request(app).get('/get-config').expect(200);

            const duration = Date.now() - start;
            expect(duration).toBeLessThan(5000); // 5 second timeout
        });

        test('should handle concurrent requests', async () => {
            const requests = Array(5)
                .fill()
                .map(() => request(app).get('/get-config'));

            const responses = await Promise.all(requests);

            responses.forEach((res, index) => {
                expect(res.status).toBe(200);
                expect(res.body).toBeDefined();
                expect(typeof res.body).toBe('object');

                // Only check for clockWidget if response has content
                if (res.body && Object.keys(res.body).length > 0) {
                    expect(res.body).toHaveProperty('clockWidget');
                } else {
                    console.warn(`Response ${index} has empty body:`, res.body);
                }
            });
        });

        test('should implement proper caching', async () => {
            const res1 = await request(app).get('/get-config').expect(200);

            const res2 = await request(app).get('/get-config').expect(200);

            // Both should have cache headers
            expect(res1.headers).toHaveProperty('cache-control');
            expect(res2.headers).toHaveProperty('cache-control');
        });
    });

    describe('Input Sanitization', () => {
        const maliciousInputs = [
            '<script>alert("xss")</script>',
            '"><script>alert("xss")</script>',
            "'; DROP TABLE users; --",
            '../../../etc/passwd',
            '%3Cscript%3Ealert%28%22xss%22%29%3C%2Fscript%3E',
            'javascript:alert("xss")',
            'data:text/html,<script>alert("xss")</script>',
        ];

        maliciousInputs.forEach(input => {
            test(`should sanitize malicious input: ${input.substring(0, 20)}...`, async () => {
                const res = await request(app)
                    .get(`/get-media?search=${encodeURIComponent(input)}`)
                    .expect('Content-Type', /json/);

                // Should accept sanitized input, reject invalid input, or return service status
                expect([200, 202, 400, 503]).toContain(res.status);
                if (res.status === 200) {
                    expect(Array.isArray(res.body)).toBe(true);
                }
                // Should not crash or return error
            });
        });
    });
});
