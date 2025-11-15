/**
 * @file __tests__/routes/admin-cache.test.js
 * @description Tests for cache monitoring and management admin endpoints (Issue #19)
 */

const request = require('supertest');
const express = require('express');
const { CacheManager } = require('../../utils/cache');
const asyncHandler = require('../../middleware/asyncHandler');

describe('Admin Cache Routes', () => {
    let app;
    let cacheManager;
    let apiCache;
    let adminCacheRouter;
    let mockIsAuthenticated;

    beforeEach(() => {
        // Create fresh cache instances
        cacheManager = new CacheManager({
            maxSize: 100,
            ttl: 60000,
            memoryLimit: 50 * 1024 * 1024, // 50MB
        });

        apiCache = new CacheManager({
            maxSize: 50,
            ttl: 30000,
            memoryLimit: 25 * 1024 * 1024, // 25MB
        });

        // Mock authentication middleware
        mockIsAuthenticated = jest.fn((req, res, next) => next());

        // Create Express app
        app = express();
        app.use(express.json());

        // Load and initialize router
        const createAdminCacheRouter = require('../../routes/admin-cache');
        adminCacheRouter = createAdminCacheRouter({
            logger: {
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            },
            asyncHandler,
            adminAuth: mockIsAuthenticated,
        });

        app.use('/', adminCacheRouter);
        adminCacheRouter.initCacheReferences(cacheManager, apiCache);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/admin/cache/metrics', () => {
        it('should return detailed cache metrics for both caches', async () => {
            // Populate caches with some data
            cacheManager.set('key1', { data: 'test1' }, 60000);
            cacheManager.set('key2', { data: 'test2' }, 60000);
            cacheManager.get('key1'); // Hit
            cacheManager.get('missing'); // Miss

            apiCache.set('apiKey1', { result: 'data' }, 30000);
            apiCache.get('apiKey1'); // Hit

            const response = await request(app).get('/api/admin/cache/metrics');

            expect(response.status).toBe(200);
            expect(response.body.metrics).toHaveProperty('memory');
            expect(response.body.metrics).toHaveProperty('api');
            expect(response.body.metrics).toHaveProperty('combined');

            // Check memory cache stats
            expect(response.body.metrics.memory).toMatchObject({
                hits: expect.any(Number),
                misses: expect.any(Number),
                hitRatio: expect.any(Object),
                totalRequests: expect.any(Number),
            });

            // Check API cache stats
            expect(response.body.metrics.api).toMatchObject({
                hits: expect.any(Number),
                misses: expect.any(Number),
                hitRatio: expect.any(Object),
                totalRequests: expect.any(Number),
            });

            // Check combined stats
            expect(response.body.metrics.combined).toMatchObject({
                totalRequests: expect.any(Number),
                combinedHitRatio: expect.any(Number),
                totalMemoryMB: expect.any(Number),
            });

            expect(mockIsAuthenticated).toHaveBeenCalledTimes(1);
        });

        it('should handle cache with zero requests', async () => {
            const response = await request(app).get('/api/admin/cache/metrics');

            expect(response.status).toBe(200);
            expect(response.body.metrics.memory.totalRequests).toBe(0);
            expect(response.body.metrics.api.totalRequests).toBe(0);
            expect(response.body.metrics.combined.totalRequests).toBe(0);
            expect(response.body.metrics.combined.combinedHitRatio).toBe(0);
        });

        it('should return 503 if cache not initialized', async () => {
            // Create new router without cache initialization
            const uninitializedRouter = require('../../routes/admin-cache')({
                logger: {
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn(),
                },
                asyncHandler,
                adminAuth: mockIsAuthenticated,
            });

            const testApp = express();
            testApp.use(express.json());
            testApp.use('/', uninitializedRouter);

            const response = await request(testApp).get('/api/admin/cache/metrics');

            expect(response.status).toBe(503);
            expect(response.body.error).toContain('not initialized');
        });

        it('should handle high hit ratios correctly', async () => {
            // Create scenario with high hit ratio
            for (let i = 0; i < 10; i++) {
                cacheManager.set(`key${i}`, { data: i }, 60000);
            }
            for (let i = 0; i < 50; i++) {
                cacheManager.get(`key${i % 10}`); // Many hits
            }
            cacheManager.get('missing1'); // Few misses
            cacheManager.get('missing2');

            const response = await request(app).get('/api/admin/cache/metrics');

            expect(response.status).toBe(200);
            expect(response.body.metrics.memory.hitRatio.percentage).toBeGreaterThan(85);
        });

        it('should handle low hit ratios correctly', async () => {
            // Create scenario with low hit ratio (many misses)
            for (let i = 0; i < 20; i++) {
                cacheManager.get(`missing${i}`); // All misses
            }

            const response = await request(app).get('/api/admin/cache/metrics');

            expect(response.status).toBe(200);
            expect(response.body.metrics.memory.hitRatio.percentage).toBe(0);
        });
    });

    describe('GET /api/admin/cache/metrics/summary', () => {
        it('should return simplified cache metrics', async () => {
            cacheManager.set('key1', { data: 'test' }, 60000);
            cacheManager.get('key1'); // Hit
            cacheManager.get('missing'); // Miss

            const response = await request(app).get('/api/admin/cache/metrics/summary');

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                totalRequests: expect.any(Number),
                combinedHitRatio: expect.any(Number),
                totalMemoryMB: expect.any(Number),
                memoryHitRatio: expect.any(Number),
                apiHitRatio: expect.any(Number),
            });

            expect(response.body.totalRequests).toBe(2); // 1 hit + 1 miss
            expect(response.body.memoryHitRatio).toBe(50); // 1 hit / 2 total
        });

        it('should handle zero requests gracefully', async () => {
            const response = await request(app).get('/api/admin/cache/metrics/summary');

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                totalRequests: 0,
                combinedHitRatio: 0,
                memoryHitRatio: 0,
                apiHitRatio: 0,
            });
        });

        it('should return 503 if cache not initialized', async () => {
            const uninitializedRouter = require('../../routes/admin-cache')({
                logger: {
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn(),
                },
                asyncHandler,
                adminAuth: mockIsAuthenticated,
            });

            const testApp = express();
            testApp.use(express.json());
            testApp.use('/', uninitializedRouter);

            const response = await request(testApp).get('/api/admin/cache/metrics/summary');

            expect(response.status).toBe(503);
            expect(response.body.error).toContain('not initialized');
        });
    });

    describe('GET /api/admin/cache/recommendations', () => {
        it('should return recommendations for low hit ratio', async () => {
            // Create low hit ratio scenario
            for (let i = 0; i < 30; i++) {
                cacheManager.get(`missing${i}`); // All misses
            }

            const response = await request(app).get('/api/admin/cache/recommendations');

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.recommendations)).toBe(true);

            // Should include low hit ratio warning (category: performance)
            const hitRatioRec = response.body.recommendations.find(
                r => r.category === 'performance'
            );
            expect(hitRatioRec).toBeDefined();
            expect(hitRatioRec.severity).toBe('high');
        });

        it('should return recommendations sorted by severity', async () => {
            // Create scenario with multiple issues
            for (let i = 0; i < 20; i++) {
                cacheManager.get(`missing${i}`); // Low hit ratio
            }

            const response = await request(app).get('/api/admin/cache/recommendations');

            expect(response.status).toBe(200);

            // Verify sorting: high > medium > info
            let lastSeverityValue = 3; // high=3, medium=2, info=1
            const severityMap = { high: 3, medium: 2, info: 1 };

            response.body.recommendations.forEach(rec => {
                const currentValue = severityMap[rec.severity] || 0;
                expect(currentValue).toBeLessThanOrEqual(lastSeverityValue);
                lastSeverityValue = currentValue;
            });
        });

        it('should return empty array when cache is healthy', async () => {
            // Create healthy cache scenario
            for (let i = 0; i < 10; i++) {
                cacheManager.set(`key${i}`, { data: i }, 60000);
            }
            for (let i = 0; i < 50; i++) {
                cacheManager.get(`key${i % 10}`); // High hit ratio
            }

            const response = await request(app).get('/api/admin/cache/recommendations');

            expect(response.status).toBe(200);
            // Should have no or minimal recommendations
            expect(response.body.recommendations.length).toBeLessThan(3);
        });

        it('should return 503 if cache not initialized', async () => {
            const uninitializedRouter = require('../../routes/admin-cache')({
                logger: {
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn(),
                },
                asyncHandler,
                adminAuth: mockIsAuthenticated,
            });

            const testApp = express();
            testApp.use(express.json());
            testApp.use('/', uninitializedRouter);

            const response = await request(testApp).get('/api/admin/cache/recommendations');

            expect(response.status).toBe(503);
            expect(response.body.error).toContain('not initialized');
        });
    });

    describe('POST /api/admin/cache/reset', () => {
        it('should reset cache statistics without clearing data', async () => {
            // Populate cache and generate stats
            cacheManager.set('key1', { data: 'test' }, 60000);
            cacheManager.get('key1'); // Hit
            cacheManager.get('missing'); // Miss

            // Verify stats exist
            let stats = cacheManager.getStats();
            expect(stats.hits).toBeGreaterThan(0);
            expect(stats.misses).toBeGreaterThan(0);

            // Reset stats
            const response = await request(app).post('/api/admin/cache/reset');

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                success: true,
                message: expect.stringContaining('reset'),
            });

            // Verify stats are reset but data remains
            stats = cacheManager.getStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(cacheManager.get('key1').value).toEqual({ data: 'test' });

            expect(mockIsAuthenticated).toHaveBeenCalledTimes(1);
        });

        it('should return 503 if cache not initialized', async () => {
            const uninitializedRouter = require('../../routes/admin-cache')({
                logger: {
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn(),
                },
                asyncHandler,
                adminAuth: mockIsAuthenticated,
            });

            const testApp = express();
            testApp.use(express.json());
            testApp.use('/', uninitializedRouter);

            const response = await request(testApp).post('/api/admin/cache/reset');

            expect(response.status).toBe(503);
            expect(response.body.error).toContain('not initialized');
        });
    });

    describe('POST /api/admin/cache/clear', () => {
        it('should clear all cached data from both caches', async () => {
            // Populate both caches
            cacheManager.set('key1', { data: 'test1' }, 60000);
            cacheManager.set('key2', { data: 'test2' }, 60000);
            apiCache.set('apiKey1', { result: 'data' }, 30000);

            // Verify data exists
            expect(cacheManager.get('key1').value).toEqual({ data: 'test1' });
            expect(apiCache.get('apiKey1').value).toEqual({ result: 'data' });

            // Clear caches
            const response = await request(app).post('/api/admin/cache/clear');

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                success: true,
                message: expect.stringContaining('cleared'),
                cleared: {
                    total: expect.any(Number),
                },
            });

            // Verify data is cleared
            expect(cacheManager.get('key1')).toBeNull();
            expect(cacheManager.get('key2')).toBeNull();
            expect(apiCache.get('apiKey1')).toBeNull();

            expect(mockIsAuthenticated).toHaveBeenCalledTimes(1);
        });

        it('should handle empty caches', async () => {
            const response = await request(app).post('/api/admin/cache/clear');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.cleared.total).toBe(0);
        });

        it('should return 503 if cache not initialized', async () => {
            const uninitializedRouter = require('../../routes/admin-cache')({
                logger: {
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn(),
                },
                asyncHandler,
                adminAuth: mockIsAuthenticated,
            });

            const testApp = express();
            testApp.use(express.json());
            testApp.use('/', uninitializedRouter);

            const response = await request(testApp).post('/api/admin/cache/clear');

            expect(response.status).toBe(503);
            expect(response.body.error).toContain('not initialized');
        });
    });

    describe('Authentication', () => {
        it('should require authentication for all endpoints', async () => {
            // Create router with failing auth
            const failingAuth = jest.fn((req, res, _next) => {
                res.status(401).json({ error: 'Unauthorized' });
            });

            const authRouter = require('../../routes/admin-cache')({
                logger: {
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn(),
                },
                asyncHandler,
                adminAuth: failingAuth,
            });

            const authApp = express();
            authApp.use(express.json());
            authApp.use('/', authRouter);
            authRouter.initCacheReferences(cacheManager, apiCache);

            // Test all endpoints
            const endpoints = [
                { method: 'get', path: '/api/admin/cache/metrics' },
                { method: 'get', path: '/api/admin/cache/metrics/summary' },
                { method: 'get', path: '/api/admin/cache/recommendations' },
                { method: 'post', path: '/api/admin/cache/reset' },
                { method: 'post', path: '/api/admin/cache/clear' },
            ];

            for (const endpoint of endpoints) {
                const response = await request(authApp)[endpoint.method](endpoint.path);
                expect(response.status).toBe(401);
                expect(response.body.error).toBe('Unauthorized');
            }
        });
    });

    describe('Cache Metrics Details', () => {
        it('should track hit ratio percentage correctly', async () => {
            // 70% hit ratio: 7 hits, 3 misses
            for (let i = 0; i < 3; i++) {
                cacheManager.set(`key${i}`, { data: i }, 60000);
            }
            for (let i = 0; i < 7; i++) {
                cacheManager.get(`key${i % 3}`); // Hits
            }
            for (let i = 0; i < 3; i++) {
                cacheManager.get(`missing${i}`); // Misses
            }

            const response = await request(app).get('/api/admin/cache/metrics');

            expect(response.status).toBe(200);
            expect(response.body.metrics.memory.hitRatio.percentage).toBe(70);
            expect(response.body.metrics.memory.hitRatio.formatted).toContain('70%');
        });

        it('should include uptime in metrics', async () => {
            const response = await request(app).get('/api/admin/cache/metrics');

            expect(response.status).toBe(200);
            expect(response.body.metrics.memory).toHaveProperty('uptime');
            expect(response.body.metrics.api).toHaveProperty('uptime');
            expect(typeof response.body.metrics.memory.uptime).toBe('object');
            expect(typeof response.body.metrics.memory.uptime.formatted).toBe('string');
        });

        it('should include memory usage details', async () => {
            cacheManager.set('key1', { data: 'test' }, 60000);

            const response = await request(app).get('/api/admin/cache/metrics');

            expect(response.status).toBe(200);
            expect(response.body.metrics.memory.memoryUsage).toMatchObject({
                totalMB: expect.any(Number),
                maxMB: expect.any(Number),
                percentUsed: expect.any(Number),
            });
        });
    });

    describe('Combined Metrics Calculation', () => {
        it('should correctly combine metrics from both caches', async () => {
            // Memory cache: 3 hits, 1 miss
            cacheManager.set('key1', { data: 'test' }, 60000);
            cacheManager.get('key1');
            cacheManager.get('key1');
            cacheManager.get('key1');
            cacheManager.get('missing');

            // API cache: 2 hits, 0 misses
            apiCache.set('apiKey1', { result: 'data' }, 30000);
            apiCache.get('apiKey1');
            apiCache.get('apiKey1');

            const response = await request(app).get('/api/admin/cache/metrics');

            expect(response.status).toBe(200);

            // Combined: 5 hits, 1 miss = 83.33% hit ratio
            expect(response.body.metrics.combined.totalRequests).toBe(6);
            expect(response.body.metrics.combined.combinedHitRatio).toBeCloseTo(83.33, 1);
        });
    });
});
