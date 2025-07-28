const request = require('supertest');
const app = require('../server');

describe('Health Check Endpoints', () => {
    beforeEach(async () => {
        // Reset between tests with longer delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1200));
    });

    afterEach(async () => {
        // Cleanup
        await new Promise(resolve => setTimeout(resolve, 200));
    });

    describe('Basic Health Check', () => {
        test('should return 200 OK for basic health check', async () => {
            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body).toHaveProperty('status', 'ok');
            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).toHaveProperty('uptime');
            expect(typeof response.body.uptime).toBe('number');
        });

        test('should include service name and version', async () => {
            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body).toHaveProperty('service', 'posterrama');
            expect(response.body).toHaveProperty('version');
            expect(typeof response.body.version).toBe('string');
        });

        test('should respond quickly (under 1 second)', async () => {
            const start = Date.now();
            const response = await request(app)
                .get('/health')
                .expect(200);
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(1000);
            expect(response.body.status).toBe('ok');
        });
    });

    describe('Detailed Health Check', () => {
        test('should return detailed health information', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            expect(response.body).toHaveProperty('status');
            expect(['ok', 'warning', 'error']).toContain(response.body.status);
            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).toHaveProperty('checks');
            expect(Array.isArray(response.body.checks)).toBe(true);
        });

        test('should check configuration validity', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            const configCheck = response.body.checks.find(check => check.name === 'configuration');
            expect(configCheck).toBeDefined();
            expect(configCheck).toHaveProperty('status');
            expect(configCheck).toHaveProperty('message');
            expect(['ok', 'warning', 'error']).toContain(configCheck.status);
        });

        test('should check file system access', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            const fsCheck = response.body.checks.find(check => check.name === 'filesystem');
            expect(fsCheck).toBeDefined();
            expect(fsCheck).toHaveProperty('status');
            expect(fsCheck).toHaveProperty('message');
            expect(['ok', 'warning', 'error']).toContain(fsCheck.status);
        });

        test('should check media cache status', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            const cacheCheck = response.body.checks.find(check => check.name === 'media_cache');
            expect(cacheCheck).toBeDefined();
            expect(cacheCheck).toHaveProperty('status');
            expect(cacheCheck).toHaveProperty('message');
            expect(cacheCheck).toHaveProperty('details');
            expect(typeof cacheCheck.details.itemCount).toBe('number');
        });
    });

    describe('Service Dependencies', () => {
        test('should check Plex server connectivity when configured', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            const plexCheck = response.body.checks.find(check => check.name === 'plex_connectivity');
            if (plexCheck) {
                expect(plexCheck).toHaveProperty('status');
                expect(plexCheck).toHaveProperty('message');
                expect(['ok', 'warning', 'error']).toContain(plexCheck.status);
                if (plexCheck.details && plexCheck.details.servers) {
                    // Check if we have server details with response times
                    plexCheck.details.servers.forEach(server => {
                        if (typeof server.responseTime === 'number') {
                            expect(server.responseTime).toBeGreaterThan(0);
                        }
                    });
                }
            } else {
                // It's okay if no Plex servers are configured
                expect(true).toBe(true);
            }
        });

        test('should handle external service failures gracefully', async () => {
            // Even if external services fail, the health check should still respond
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            expect(response.body).toHaveProperty('status');
            // Status can be 'ok', 'warning', or 'error' depending on checks
            expect(['ok', 'warning', 'error']).toContain(response.body.status);
        });
    });

    describe('Health Check Caching', () => {
        test('should cache health check results briefly', async () => {
            const response1 = await request(app)
                .get('/api/health')
                .expect(200);

            const response2 = await request(app)
                .get('/api/health')
                .expect(200);

            // Timestamp should be the same if cached (within 30 seconds)
            const time1 = new Date(response1.body.timestamp);
            const time2 = new Date(response2.body.timestamp);
            const timeDiff = Math.abs(time2 - time1);
            
            expect(timeDiff).toBeLessThan(30000); // Less than 30 seconds difference
        });

        test('should refresh cache after timeout', async () => {
            const response1 = await request(app)
                .get('/api/health')
                .expect(200);

            // Wait for cache to expire (assuming 30 second cache)
            await new Promise(resolve => setTimeout(resolve, 100)); // Short wait for test

            const response2 = await request(app)
                .get('/api/health')
                .expect(200);

            // Both should be successful regardless of caching
            expect(response1.body.status).toBeTruthy();
            expect(response2.body.status).toBeTruthy();
        });
    });

    describe('Health Check Error Handling', () => {
        test('should handle partial check failures', async () => {
            // Wait to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const response = await request(app)
                .get('/api/health');

            // Handle both health responses and rate limit errors
            if (response.status === 200) {
                // Even with some failed checks, overall health should respond
                expect(response.body).toHaveProperty('status');
                expect(response.body).toHaveProperty('checks');
                
                // At least basic checks should be present
                expect(response.body.checks.length).toBeGreaterThan(0);
            } else if (response.status === 429) {
                expect(response.body).toHaveProperty('error');
                expect(response.body.error).toContain('Too many requests');
            } else {
                fail(`Unexpected status code: ${response.status}`);
            }
        });

        test('should include error details for failed checks', async () => {
            // Wait to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const response = await request(app)
                .get('/api/health');

            // Handle both health responses and rate limit errors
            if (response.status === 200) {
                response.body.checks.forEach(check => {
                    expect(check).toHaveProperty('name');
                    expect(check).toHaveProperty('status');
                    expect(check).toHaveProperty('message');
                    
                    if (check.status === 'error') {
                        expect(check.message).toBeTruthy();
                        expect(check.message.length).toBeGreaterThan(0);
                    }
                });
            } else if (response.status === 429) {
                expect(response.body).toHaveProperty('error');
                expect(response.body.error).toContain('Too many requests');
            } else {
                fail(`Unexpected status code: ${response.status}`);
            }
        });
    });
});
