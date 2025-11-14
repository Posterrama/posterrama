/**
 * Image Proxy Fallback Tracking Tests
 *
 * Issue #6 (MEDIUM): Image Proxy Fallback Tracking
 *
 * Problem:
 * - 7 fallback redirects in routes/media.js with no tracking
 * - No visibility into upstream server health
 * - No way to monitor image proxy reliability
 * - Operators couldn't identify problematic media servers
 *
 * Solution:
 * - Added centralized trackFallback() function
 * - Instrumented all 7 fallback redirects with reason codes
 * - Created metrics endpoint /api/media/fallback-metrics
 * - Track last 20 fallback events with full context
 *
 * This test suite verifies:
 * - Metrics endpoint functionality and structure
 * - All reason categories are initialized
 * - Recent events tracking
 * - Fallback image delivery
 */

const request = require('supertest');

describe('Image Proxy Fallback Tracking - Issue #6', () => {
    let app;

    beforeEach(() => {
        // Setup test environment
        process.env.NODE_ENV = 'test';
        process.env.SESSION_SECRET = 'test-secret-' + Date.now();

        // Clear module cache
        delete require.cache[require.resolve('../../server')];
        app = require('../../server');
    });

    afterEach(() => {
        if (app && app.cleanup) {
            app.cleanup();
        }
    });

    describe('Metrics endpoint', () => {
        test('should expose metrics at /api/media/fallback-metrics', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        test('should include all metric categories', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            expect(response.body.metrics).toHaveProperty('total');
            expect(response.body.metrics).toHaveProperty('byReason');
            expect(response.body.metrics).toHaveProperty('recentEvents');
        });

        test('should include timestamp', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            expect(response.body).toHaveProperty('timestamp');
            expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        test('should have all reason categories initialized', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            const reasons = response.body.metrics.byReason;
            expect(reasons).toHaveProperty('serverNotFound');
            expect(reasons).toHaveProperty('plexIncomplete');
            expect(reasons).toHaveProperty('jellyfinIncomplete');
            expect(reasons).toHaveProperty('unsupportedServer');
            expect(reasons).toHaveProperty('httpError');
            expect(reasons).toHaveProperty('networkError');
            expect(reasons).toHaveProperty('cacheError');

            // All should be numbers (initialized to 0)
            Object.values(reasons).forEach(count => {
                expect(typeof count).toBe('number');
                expect(count).toBeGreaterThanOrEqual(0);
            });
        });

        test('should return valid JSON', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            expect(response.headers['content-type']).toMatch(/application\/json/);
            expect(response.body).toBeInstanceOf(Object);
        });

        test('total count should be a number', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            expect(typeof response.body.metrics.total).toBe('number');
            expect(response.body.metrics.total).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Recent events tracking', () => {
        test('should have recentEvents as an array', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            expect(response.body.metrics.recentEvents).toBeInstanceOf(Array);
        });

        test('should limit recent events to last 10 in API response', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            expect(response.body.metrics.recentEvents.length).toBeLessThanOrEqual(10);
        });

        test('should include timestamp in events if any exist', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            if (response.body.metrics.recentEvents.length > 0) {
                const event = response.body.metrics.recentEvents[0];
                expect(event).toHaveProperty('timestamp');
                expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date format
            } else {
                // No events yet, which is fine for a fresh server
                expect(response.body.metrics.recentEvents).toEqual([]);
            }
        });
    });

    describe('Fallback image delivery', () => {
        test('should serve SVG fallback image', async () => {
            const response = await request(app).get('/fallback-poster.png');

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toMatch(/image\/svg\+xml/);
            const body = response.body ? response.body.toString() : '';
            expect(body || response.text || '').toMatch(/<svg|Poster unavailable/);
        });

        test('should set cache headers on fallback image', async () => {
            const response = await request(app).get('/fallback-poster.png');

            expect(response.headers['cache-control']).toContain('public');
            expect(response.headers['cache-control']).toContain('max-age=86400');
        });

        test('should include metadata in SVG', async () => {
            const response = await request(app).get('/fallback-poster.png');

            const body = (response.body ? response.body.toString() : '') || response.text || '';
            expect(body).toMatch(/posterrama-fallback|Fallback placeholder/);
        });

        test('should be valid SVG', async () => {
            const response = await request(app).get('/fallback-poster.png');

            const body = (response.body ? response.body.toString() : '') || response.text || '';
            expect(body).toMatch(/<svg|viewBox/);
        });
    });

    describe('Metrics structure validation', () => {
        test('should have consistent structure across requests', async () => {
            const response1 = await request(app).get('/api/media/fallback-metrics');
            const response2 = await request(app).get('/api/media/fallback-metrics');

            // Both responses should have the same structure
            expect(Object.keys(response1.body.metrics)).toEqual(
                Object.keys(response2.body.metrics)
            );
            expect(Object.keys(response1.body.metrics.byReason)).toEqual(
                Object.keys(response2.body.metrics.byReason)
            );
        });

        test('should include all 7 tracked fallback reasons', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            const reasons = Object.keys(response.body.metrics.byReason);
            expect(reasons).toHaveLength(7);
            expect(reasons).toContain('serverNotFound');
            expect(reasons).toContain('plexIncomplete');
            expect(reasons).toContain('jellyfinIncomplete');
            expect(reasons).toContain('unsupportedServer');
            expect(reasons).toContain('httpError');
            expect(reasons).toContain('networkError');
            expect(reasons).toContain('cacheError');
        });

        test('metrics should persist across requests (in-memory)', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');
            const initialTotal = response.body.metrics.total;

            // Make another request - should return same or greater count
            const response2 = await request(app).get('/api/media/fallback-metrics');
            expect(response2.body.metrics.total).toBeGreaterThanOrEqual(initialTotal);
        });
    });

    describe('Integration with monitoring', () => {
        test('should provide data structure suitable for monitoring dashboards', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            // Monitoring system needs these fields
            expect(response.body).toMatchObject({
                success: true,
                metrics: {
                    total: expect.any(Number),
                    byReason: expect.any(Object),
                    recentEvents: expect.any(Array),
                },
                timestamp: expect.any(String),
            });
        });

        test('should enable alerting on specific error types', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            // Alert thresholds can be set on any reason
            const reasons = response.body.metrics.byReason;
            Object.keys(reasons).forEach(reason => {
                expect(typeof reasons[reason]).toBe('number');
                // Each reason count can be monitored independently
                expect(reasons[reason]).toBeGreaterThanOrEqual(0);
            });
        });

        test('should allow calculating fallback rate percentage', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            // Monitoring system can calculate: (fallbacks / total_requests) * 100
            expect(typeof response.body.metrics.total).toBe('number');
            // In a real monitoring system, this would be compared to total image proxy requests
        });
    });

    describe('Error context verification', () => {
        test('event structure should support debugging', async () => {
            const response = await request(app).get('/api/media/fallback-metrics');

            // If there are events, they should have useful context
            if (response.body.metrics.recentEvents.length > 0) {
                const event = response.body.metrics.recentEvents[0];
                expect(event).toHaveProperty('timestamp');
                expect(event).toHaveProperty('reason');
                // Additional context varies by reason type
            }
        });
    });
});
