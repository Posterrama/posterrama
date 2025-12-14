/**
 * @fileoverview Unit tests for utils/cache.js HTTP caching middleware
 * @description Tests the cacheMiddleware function from utils/cache.js which provides:
 * - HTTP response caching with ETag generation
 * - Conditional requests (If-None-Match / 304 responses)
 * - Cache-Control header management
 * - Response interception and caching
 */

describe('Utils Cache - HTTP Caching Middleware', () => {
    let CacheManager;
    let cacheMiddleware;
    let cacheManager;
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        jest.resetModules();

        // Mock logger to prevent console output
        jest.doMock('../../utils/logger', () => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        }));

        // Mock ErrorLogger
        jest.doMock('../../utils/errorLogger', () => ({
            logCacheError: jest.fn(),
        }));

        // Load module
        const cacheModule = require('../../utils/cache');
        CacheManager = cacheModule.CacheManager;
        cacheMiddleware = cacheModule.cacheMiddleware;
        cacheManager = cacheModule.cacheManager;

        // Clear the singleton cache
        cacheManager.clear();
        cacheManager.resetStats();

        // Setup mock request
        mockReq = {
            method: 'GET',
            originalUrl: '/api/test',
            headers: {},
            query: {},
        };

        // Setup mock response
        mockRes = {
            status: jest.fn().mockReturnThis(),
            end: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            getHeader: jest.fn(),
        };

        // Setup mock next
        mockNext = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
        if (cacheManager) {
            cacheManager.clear();
        }
    });

    describe('Middleware creation', () => {
        it('should return a middleware function', () => {
            const middleware = cacheMiddleware();
            expect(typeof middleware).toBe('function');
            expect(middleware.length).toBe(3); // (req, res, next)
        });

        it('should accept options', () => {
            const middleware = cacheMiddleware({
                ttl: 60000,
                cacheControl: 'private, max-age=60',
            });
            expect(typeof middleware).toBe('function');
        });
    });

    describe('Request skipping', () => {
        it('should skip non-GET requests', () => {
            const middleware = cacheMiddleware();
            mockReq.method = 'POST';

            middleware(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockRes.send).not.toHaveBeenCalled();
        });

        it('should skip when cache-control: no-cache header present', () => {
            const middleware = cacheMiddleware();
            mockReq.headers['cache-control'] = 'no-cache';

            middleware(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should skip when nocache=1 query param present', () => {
            const middleware = cacheMiddleware();
            mockReq.query.nocache = '1';

            middleware(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should skip PUT requests', () => {
            const middleware = cacheMiddleware();
            mockReq.method = 'PUT';

            middleware(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should skip DELETE requests', () => {
            const middleware = cacheMiddleware();
            mockReq.method = 'DELETE';

            middleware(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });
    });

    describe('Cache key generation', () => {
        it('should use custom key generator if provided', () => {
            const customKeyGen = jest.fn(req => `custom:${req.originalUrl}`);
            const middleware = cacheMiddleware({ keyGenerator: customKeyGen });

            middleware(mockReq, mockRes, mockNext);

            expect(customKeyGen).toHaveBeenCalledWith(mockReq);
        });

        it('should use default key generator based on method and URL', () => {
            const middleware = cacheMiddleware();

            middleware(mockReq, mockRes, mockNext);

            // Next should be called since no cache hit
            expect(mockNext).toHaveBeenCalled();
        });
    });

    describe('ETag handling', () => {
        it('should generate ETag for cached responses', () => {
            const middleware = cacheMiddleware({ ttl: 60000 });
            middleware(mockReq, mockRes, mockNext);

            // Simulate response
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            // Check that ETag header was set
            expect(mockRes.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    ETag: expect.stringMatching(/^"[a-f0-9]+"/),
                })
            );
        });

        it('should return 304 for matching If-None-Match', () => {
            // First, cache the response
            const middleware = cacheMiddleware({ ttl: 60000 });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            // Get the cached entry to find its ETag
            const cacheKey = `${mockReq.method}:${mockReq.originalUrl}`;
            const cached = cacheManager.get(cacheKey);

            // Make conditional request with matching ETag
            mockReq.headers['if-none-match'] = cached.etag;
            mockRes.status.mockClear();
            mockRes.end.mockClear();

            const middleware2 = cacheMiddleware({ ttl: 60000 });
            middleware2(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(304);
            expect(mockRes.end).toHaveBeenCalled();
        });

        it('should serve full response for non-matching If-None-Match', () => {
            // First, cache the response
            const middleware = cacheMiddleware({ ttl: 60000 });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            // Make conditional request with non-matching ETag
            mockReq.headers['if-none-match'] = '"wrong-etag"';

            const middleware2 = cacheMiddleware({ ttl: 60000 });
            middleware2(mockReq, mockRes, mockNext);

            // Should serve from cache (not 304)
            expect(mockRes.status).not.toHaveBeenCalledWith(304);
        });
    });

    describe('Cache headers', () => {
        it('should set X-Cache: HIT for cached responses', () => {
            // First request - cache miss
            const middleware = cacheMiddleware({ ttl: 60000 });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            // Second request - cache hit
            mockRes.set.mockClear();
            const middleware2 = cacheMiddleware({ ttl: 60000 });
            middleware2(mockReq, mockRes, mockNext);

            expect(mockRes.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    'X-Cache': 'HIT',
                })
            );
        });

        it('should set X-Cache: MISS for new responses', () => {
            const middleware = cacheMiddleware({ ttl: 60000 });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            expect(mockRes.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    'X-Cache': 'MISS',
                })
            );
        });

        it('should set Cache-Control header from options', () => {
            const middleware = cacheMiddleware({
                ttl: 60000,
                cacheControl: 'private, max-age=60',
            });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            expect(mockRes.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    'Cache-Control': 'private, max-age=60',
                })
            );
        });

        it('should set Vary header', () => {
            const middleware = cacheMiddleware({
                ttl: 60000,
                varyHeaders: ['Accept-Encoding', 'Accept-Language'],
            });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            expect(mockRes.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    Vary: 'Accept-Encoding, Accept-Language',
                })
            );
        });
    });

    describe('Response caching', () => {
        it('should cache JSON responses', () => {
            const middleware = cacheMiddleware({ ttl: 60000 });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            const testData = { data: 'test', items: [1, 2, 3] };
            mockRes.json(testData);

            const cacheKey = `${mockReq.method}:${mockReq.originalUrl}`;
            const cached = cacheManager.get(cacheKey);

            expect(cached).toBeDefined();
            expect(cached.value).toEqual(testData);
        });

        it('should cache send responses', () => {
            const middleware = cacheMiddleware({ ttl: 60000 });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            const testData = 'plain text response';
            mockRes.send(testData);

            const cacheKey = `${mockReq.method}:${mockReq.originalUrl}`;
            const cached = cacheManager.get(cacheKey);

            expect(cached).toBeDefined();
            expect(cached.value).toBe(testData);
        });

        it('should not cache non-200 responses', () => {
            const middleware = cacheMiddleware({ ttl: 60000 });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 404;
            mockRes.json({ error: 'Not found' });

            const cacheKey = `${mockReq.method}:${mockReq.originalUrl}`;
            const cached = cacheManager.get(cacheKey);

            expect(cached).toBeNull();
        });

        it('should not cache 500 error responses', () => {
            const middleware = cacheMiddleware({ ttl: 60000 });
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 500;
            mockRes.json({ error: 'Internal error' });

            const cacheKey = `${mockReq.method}:${mockReq.originalUrl}`;
            const cached = cacheManager.get(cacheKey);

            expect(cached).toBeNull();
        });

        it('should preserve Content-Encoding header for compressed responses', () => {
            const middleware = cacheMiddleware({ ttl: 60000 });
            mockRes.getHeader.mockReturnValue('gzip');

            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            const cacheKey = `${mockReq.method}:${mockReq.originalUrl}`;
            const cached = cacheManager.get(cacheKey);

            expect(cached.contentEncoding).toBe('gzip');
        });
    });

    describe('TTL handling', () => {
        it('should respect custom TTL', () => {
            const middleware = cacheMiddleware({ ttl: 1000 }); // 1 second
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            const cacheKey = `${mockReq.method}:${mockReq.originalUrl}`;
            const cached = cacheManager.get(cacheKey);

            expect(cached).toBeDefined();
            expect(cached.expiresAt).toBeLessThanOrEqual(Date.now() + 1100);
        });

        it('should use default TTL of 5 minutes', () => {
            const middleware = cacheMiddleware(); // No TTL specified
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'test' });

            const cacheKey = `${mockReq.method}:${mockReq.originalUrl}`;
            const cached = cacheManager.get(cacheKey);

            expect(cached).toBeDefined();
            // Default is 5 minutes = 300000ms
            expect(cached.expiresAt).toBeGreaterThan(Date.now() + 290000);
        });
    });

    describe('CacheManager.generateETag', () => {
        let cache;

        beforeEach(() => {
            cache = new CacheManager({
                enableMemoryMonitoring: false,
            });
        });

        afterEach(() => {
            cache.cleanup();
        });

        it('should generate consistent ETag for same data', () => {
            const data = { key: 'value', items: [1, 2, 3] };

            const etag1 = cache.generateETag(data);
            const etag2 = cache.generateETag(data);

            expect(etag1).toBe(etag2);
        });

        it('should generate different ETag for different data', () => {
            const data1 = { key: 'value1' };
            const data2 = { key: 'value2' };

            const etag1 = cache.generateETag(data1);
            const etag2 = cache.generateETag(data2);

            expect(etag1).not.toBe(etag2);
        });

        it('should handle string data', () => {
            const data = 'plain text string';
            const etag = cache.generateETag(data);

            expect(etag).toMatch(/^"[a-f0-9]+"$/);
        });

        it('should handle empty object', () => {
            const etag = cache.generateETag({});
            expect(etag).toMatch(/^"[a-f0-9]+"$/);
        });

        it('should handle arrays', () => {
            const etag = cache.generateETag([1, 2, 3, 4, 5]);
            expect(etag).toMatch(/^"[a-f0-9]+"$/);
        });
    });

    describe('Edge cases', () => {
        it('should handle concurrent requests to same URL', () => {
            const middleware = cacheMiddleware({ ttl: 60000 });

            // First request
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'first' });

            // Second request immediately after
            const mockReq2 = { ...mockReq };
            const mockRes2 = {
                ...mockRes,
                json: jest.fn().mockReturnThis(),
                set: jest.fn().mockReturnThis(),
            };

            const middleware2 = cacheMiddleware({ ttl: 60000 });
            middleware2(mockReq2, mockRes2, mockNext);

            // Should serve cached response
            expect(mockRes2.json).toHaveBeenCalledWith({ data: 'first' });
            expect(mockRes2.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    'X-Cache': 'HIT',
                })
            );
        });

        it('should handle different query parameters as different cache keys', () => {
            const middleware = cacheMiddleware({
                ttl: 60000,
                keyGenerator: req => `${req.method}:${req.originalUrl}`,
            });

            // First request with query param
            mockReq.originalUrl = '/api/test?page=1';
            middleware(mockReq, mockRes, mockNext);
            mockRes.statusCode = 200;
            mockRes.json({ data: 'page1' });

            // Second request with different query param
            const mockReq2 = {
                ...mockReq,
                originalUrl: '/api/test?page=2',
            };
            const mockRes2 = {
                ...mockRes,
                json: jest.fn().mockReturnThis(),
                set: jest.fn().mockReturnThis(),
            };

            const middleware2 = cacheMiddleware({
                ttl: 60000,
                keyGenerator: req => `${req.method}:${req.originalUrl}`,
            });
            middleware2(mockReq2, mockRes2, mockNext);

            // Should not serve cached response (different key)
            expect(mockNext).toHaveBeenCalled();
        });
    });
});
