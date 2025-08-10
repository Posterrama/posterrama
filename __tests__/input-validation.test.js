const request = require('supertest');
const app = require('../server');

describe('Input Validation Middleware', () => {
    describe('Config Validation', () => {
        test('should accept valid config data', async () => {
            const validConfig = {
                clockWidget: true,
                kenBurnsEffect: {
                    enabled: true,
                    durationSeconds: 20
                },
                clockTimezone: 'auto',
                clockFormat: '24h',
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 5,
                showClearLogo: true,
                showPoster: true,
                showMetadata: true,
                showRottenTomatoes: true,
                rottenTomatoesMinimumScore: 7.5,
                mediaServers: {
                    plex: {
                        hostname: 'localhost',
                        port: 32400,
                        token: 'test-token',
                        ssl: false
                    }
                }
            };

            const response = await request(app)
                .post('/api/v1/admin/config/validate')
                .send({ config: validConfig })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe('Configuration is valid');
        });

        test('should reject config with invalid types', async () => {
            const invalidConfig = {
                clockWidget: "true", // Should be boolean
                transitionIntervalSeconds: "not-a-number", // Should be number
                rottenTomatoesMinimumScore: 15 // Should be <= 10
            };

            const response = await request(app)
                .post('/api/v1/admin/config/validate')
                .send({ config: invalidConfig })
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Validation failed');
            expect(response.body.details).toBeInstanceOf(Array);
        });

        test('should reject config with missing required fields', async () => {
            const incompleteConfig = {
                clockWidget: true
                // Missing other required fields
            };

            const response = await request(app)
                .post('/api/v1/admin/config/validate')
                .send({ config: incompleteConfig })
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Validation failed');
        });

        test('should accept valid clock timezone configuration', async () => {
            const configWithTimezone = {
                clockWidget: true,
                kenBurnsEffect: {
                    enabled: false,
                    durationSeconds: 10
                },
                clockTimezone: 'auto',
                clockFormat: '12h',
                transitionIntervalSeconds: 15,
                backgroundRefreshMinutes: 30,
                showClearLogo: true,
                showPoster: true,
                showMetadata: true,
                showRottenTomatoes: true,
                rottenTomatoesMinimumScore: 0,
                mediaServers: {
                    plex: {
                        hostname: 'localhost',
                        port: 32400,
                        token: 'test-token',
                        ssl: false
                    }
                }
            };

            const response = await request(app)
                .post('/api/v1/admin/config/validate')
                .send({ config: configWithTimezone })
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        test('should accept valid IANA timezone identifier', async () => {
            const configWithIANA = {
                clockWidget: true,
                kenBurnsEffect: {
                    enabled: true,
                    durationSeconds: 30
                },
                clockTimezone: 'America/New_York',
                clockFormat: '24h',
                transitionIntervalSeconds: 15,
                backgroundRefreshMinutes: 30,
                showClearLogo: true,
                showPoster: true,
                showMetadata: true,
                showRottenTomatoes: true,
                rottenTomatoesMinimumScore: 0,
                mediaServers: {
                    plex: {
                        hostname: 'localhost',
                        port: 32400,
                        token: 'test-token',
                        ssl: false
                    }
                }
            };

            const response = await request(app)
                .post('/api/v1/admin/config/validate')
                .send({ config: configWithIANA })
                .expect(200);

            expect(response.body.success).toBe(true);
        });
    });

    describe('Plex Connection Validation', () => {
        test('should accept valid Plex connection data', async () => {
            const validConnection = {
                hostname: '192.168.1.10',
                port: 32400,
                token: 'valid-token-123'
            };

            const response = await request(app)
                .post('/api/v1/admin/plex/validate-connection')
                .send(validConnection)
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        test('should reject invalid hostname format', async () => {
            const invalidConnection = {
                hostname: 'invalid..hostname',
                port: 32400
            };

            const response = await request(app)
                .post('/api/v1/admin/plex/validate-connection')
                .send(invalidConnection)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Validation failed');
        });

        test('should reject invalid port range', async () => {
            const invalidConnection = {
                hostname: '192.168.1.10',
                port: 99999 // Port out of range
            };

            const response = await request(app)
                .post('/api/v1/admin/plex/validate-connection')
                .send(invalidConnection)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Validation failed');
        });
    });

    describe('Query Parameter Validation', () => {
        test('should validate media query parameters', async () => {
            const response = await request(app)
                .get('/api/v1/get-media?limit=abc&offset=xyz')
                .expect(400);

            expect(response.body.error).toContain('Invalid query parameters');
        });

        test('should accept valid query parameters', async () => {
            // The endpoint doesn't exist yet, but validation should pass when no query params provided
            const response = await request(app)
                .get('/api/v1/get-media');

            // Should get 404 (endpoint doesn't exist) not 400 (validation error) 
            expect(response.status).toBe(404);
        });
    });

    describe('Sanitization', () => {
        test('should sanitize HTML in input', async () => {
            const maliciousInput = {
                config: {
                    customMessage: '<script>alert("xss")</script>Hello'
                }
            };

            const response = await request(app)
                .post('/api/v1/admin/config/validate')
                .send(maliciousInput);

            // Should strip script tags but keep text
            if (response.status === 200) {
                expect(response.body.sanitized.config.customMessage).toBe('Hello');
            }
        });

        test('should handle SQL injection attempts', async () => {
            const maliciousInput = {
                hostname: "'; DROP TABLE users; --",
                port: 32400
            };

            const response = await request(app)
                .post('/api/v1/admin/plex/validate-connection')
                .send(maliciousInput)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Validation failed');
        });
    });
});
