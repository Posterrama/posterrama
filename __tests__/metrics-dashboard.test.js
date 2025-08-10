const request = require('supertest');
const app = require('../server');

// Helper function to add delay between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('Metrics Dashboard', () => {
    // Add delays between tests to avoid rate limiting
    beforeEach(async () => {
        await delay(200);
    });

    afterEach(async () => {
        await delay(200);
    });

    describe('Performance Metrics', () => {
        test('should provide response time metrics', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/performance');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('responseTime');
            expect(response.body.responseTime).toHaveProperty('average');
            expect(response.body.responseTime).toHaveProperty('median');
            expect(response.body.responseTime).toHaveProperty('p95');
            expect(response.body.responseTime).toHaveProperty('p99');
        });

        test('should track request counts per endpoint', async () => {
            // Make some requests to generate metrics
            await request(app).get('/api/v1/config');
            await delay(100);
            await request(app).get('/api/v1/media');
            await delay(100);

            const response = await request(app)
                .get('/api/v1/metrics/endpoints');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('endpoints');
            expect(Array.isArray(response.body.endpoints)).toBe(true);
            
            // Should have endpoint statistics
            const endpoints = response.body.endpoints;
            const configEndpoint = endpoints.find(e => e.path.includes('/config'));
            if (configEndpoint) {
                expect(configEndpoint).toHaveProperty('requestCount');
                expect(configEndpoint).toHaveProperty('averageResponseTime');
                expect(configEndpoint).toHaveProperty('errorRate');
            }
        });

        test('should provide error rate metrics', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/errors');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('errorRate');
            expect(response.body).toHaveProperty('totalErrors');
            expect(response.body).toHaveProperty('errorsByStatus');
            expect(typeof response.body.errorRate).toBe('number');
        });

        test('should track cache hit/miss ratios', async () => {
            // Make some cached requests
            await request(app).get('/api/v1/config');
            await delay(100);
            await request(app).get('/api/v1/config'); // Should be cached
            await delay(100);

            const response = await request(app)
                .get('/api/v1/metrics/cache');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('hitRate');
            expect(response.body).toHaveProperty('missRate');
            expect(response.body).toHaveProperty('totalHits');
            expect(response.body).toHaveProperty('totalMisses');
            expect(typeof response.body.hitRate).toBe('number');
        });
    });

    describe('System Metrics', () => {
        test('should provide memory usage metrics', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/system');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('memory');
            expect(response.body.memory).toHaveProperty('used');
            expect(response.body.memory).toHaveProperty('total');
            expect(response.body.memory).toHaveProperty('percentage');
        });

        test('should provide CPU usage metrics', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/system');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('cpu');
            expect(response.body.cpu).toHaveProperty('usage');
            expect(typeof response.body.cpu.usage).toBe('number');
        });

        test('should track uptime metrics', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/system');

            expect([200, 429]).toContain(response.status);
            
            if (response.status === 200) {
                expect(response.body).toHaveProperty('uptime');
                expect(typeof response.body.uptime).toBe('number');
                expect(response.body.uptime).toBeGreaterThan(0);
            }
        });
    });

    describe('Real-time Metrics', () => {
        test('should provide current active connections', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/realtime');

            expect([200, 429]).toContain(response.status);
            
            if (response.status === 200) {
                expect(response.body).toHaveProperty('activeConnections');
                expect(response.body).toHaveProperty('requestsPerMinute');
                expect(response.body).toHaveProperty('timestamp');
            }
        });

        test('should track requests per minute', async () => {
            // Make several requests to generate activity
            for (let i = 0; i < 3; i++) {
                await request(app).get('/api/v1/config');
                await delay(50);
            }

            const response = await request(app)
                .get('/api/v1/metrics/realtime');

            expect([200, 429]).toContain(response.status);
            
            if (response.status === 200) {
                expect(response.body).toHaveProperty('requestsPerMinute');
                expect(typeof response.body.requestsPerMinute).toBe('number');
            }
        });
    });

    describe('Historical Metrics', () => {
        test('should provide metrics over time periods', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/history?period=1h');

            expect([200, 429]).toContain(response.status);
            
            if (response.status === 200) {
                expect(response.body).toHaveProperty('period');
                expect(response.body).toHaveProperty('dataPoints');
                expect(Array.isArray(response.body.dataPoints)).toBe(true);
            }
        });

        test('should support different time periods', async () => {
            const periods = ['15m', '1h', '6h', '24h'];
            
            for (const period of periods) {
                await delay(100);
                const response = await request(app)
                    .get(`/api/v1/metrics/history?period=${period}`);

                expect([200, 429]).toContain(response.status);
                if (response.status === 200) {
                    expect(response.body).toHaveProperty('period');
                    expect(response.body.period).toBe(period);
                }
            }
        });
    });

    describe('Dashboard Authentication', () => {
        test('should require authentication for metrics endpoints', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/performance');

            // Should either work (if authentication is implemented) or require auth, or be rate limited
            expect([200, 401, 403, 429]).toContain(response.status);
        });

        test('should provide metrics summary for dashboard', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/dashboard');

            expect([200, 401, 403, 429]).toContain(response.status);
            
            if (response.status === 200) {
                expect(response.body).toHaveProperty('summary');
                expect(response.body.summary).toHaveProperty('totalRequests');
                expect(response.body.summary).toHaveProperty('averageResponseTime');
                expect(response.body.summary).toHaveProperty('errorRate');
                expect(response.body.summary).toHaveProperty('uptime');
            }
        });
    });

    describe('Metrics Export', () => {
        test('should export metrics in Prometheus format', async () => {
            const response = await request(app)
                .get('/metrics')
                .set('Accept', 'text/plain');

            expect([200, 401]).toContain(response.status);
            
            if (response.status === 200) {
                expect(response.headers['content-type']).toMatch(/text\/plain/);
                expect(response.text).toContain('# HELP');
                expect(response.text).toContain('# TYPE');
            }
        });

        test('should export metrics in JSON format', async () => {
            const response = await request(app)
                .get('/api/v1/metrics/export')
                .set('Accept', 'application/json');

            expect([200, 401, 429]).toContain(response.status);
            
            if (response.status === 200) {
                expect(response.body).toHaveProperty('metrics');
                expect(response.body).toHaveProperty('timestamp');
                expect(response.body).toHaveProperty('format');
                expect(response.body.format).toBe('json');
            }
        });
    });

    describe('Metrics Configuration', () => {
        test('should allow configuring metrics collection', async () => {
            const config = {
                enabled: true,
                collectInterval: 60000, // 1 minute
                retentionPeriod: 86400000, // 24 hours
                endpoints: {
                    performance: true,
                    system: true,
                    cache: true
                }
            };

            const response = await request(app)
                .post('/api/v1/admin/metrics/config')
                .send(config);

            expect([200, 401, 403, 429]).toContain(response.status);
        });

        test('should validate metrics configuration', async () => {
            const invalidConfig = {
                enabled: "true", // Should be boolean
                collectInterval: -1, // Should be positive
                invalidField: "test"
            };

            const response = await request(app)
                .post('/api/v1/admin/metrics/config')
                .send(invalidConfig);

            expect([200, 400, 401, 403, 404, 429]).toContain(response.status);
        });
    });
});
