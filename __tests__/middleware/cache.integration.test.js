const {
    ApiCache,
    apiCache,
    createCacheMiddleware,
    cacheMiddleware,
} = require('../../middleware/cache.js');

// Mock logger
jest.mock('../../logger', () => ({
    info: jest.fn(),
}));
const logger = require('../../logger');

describe('Middleware Cache Tests', () => {
    let testCache;

    beforeEach(() => {
        jest.clearAllMocks();
        testCache = new ApiCache(1000); // 1 second TTL for testing
    });

    afterEach(() => {
        if (testCache) {
            testCache.destroy();
        }
    });

    describe('ApiCache Constructor', () => {
        test('should initialize with default TTL', () => {
            const cache = new ApiCache();
            expect(cache.defaultTTL).toBe(5 * 60 * 1000); // 5 minutes
            expect(cache.cache).toBeInstanceOf(Map);
            expect(cache.stats).toEqual({
                hits: 0,
                misses: 0,
                sets: 0,
                deletes: 0,
            });
            cache.destroy();
        });

        test('should initialize with custom TTL', () => {
            const customTTL = 10000;
            const cache = new ApiCache(customTTL);
            expect(cache.defaultTTL).toBe(customTTL);
            cache.destroy();
        });
    });

    describe('Basic Cache Operations', () => {
        test('should store and retrieve data', () => {
            const key = 'test-key';
            const data = { message: 'test data' };

            testCache.set(key, data);
            const retrieved = testCache.get(key);

            expect(retrieved).toEqual(data);
            expect(testCache.stats.sets).toBe(1);
            expect(testCache.stats.hits).toBe(1);
        });

        test('should return null for non-existent key', () => {
            const result = testCache.get('non-existent');

            expect(result).toBeNull();
            expect(testCache.stats.misses).toBe(1);
        });

        test('should expire data after TTL', async () => {
            const key = 'expire-test';
            const data = 'test data';

            testCache.set(key, data, 50); // 50ms TTL
            expect(testCache.get(key)).toBe(data);

            // Wait for expiry
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(testCache.get(key)).toBeNull();
        });
    });

    describe('Key Generation', () => {
        test('should generate consistent keys', () => {
            const req1 = { method: 'GET', url: '/api/test', query: { a: 1, b: 2 } };
            const req2 = { method: 'GET', url: '/api/test', query: { a: 1, b: 2 } };

            const key1 = testCache.generateKey(req1);
            const key2 = testCache.generateKey(req2);

            expect(key1).toBe(key2);
        });

        test('should sort query parameters', () => {
            const req1 = { method: 'GET', url: '/api/test', query: { b: 2, a: 1 } };
            const req2 = { method: 'GET', url: '/api/test', query: { a: 1, b: 2 } };

            const key1 = testCache.generateKey(req1);
            const key2 = testCache.generateKey(req2);

            expect(key1).toBe(key2);
        });
    });

    describe('Cache Management', () => {
        test('should delete entries', () => {
            const key = 'delete-test';
            testCache.set(key, 'data');

            const result = testCache.delete(key);

            expect(result).toBe(true);
            expect(testCache.get(key)).toBeNull();
            expect(testCache.stats.deletes).toBe(1);
        });

        test('should clear all entries', () => {
            testCache.set('key1', 'data1');
            testCache.set('key2', 'data2');

            testCache.clear();

            expect(testCache.cache.size).toBe(0);
            expect(testCache.stats.deletes).toBe(2);
            expect(logger.info).toHaveBeenCalledWith('API cache cleared', { deletedEntries: 2 });
        });

        test('should cleanup expired entries', async () => {
            testCache.set('key1', 'data1', 50); // 50ms TTL
            testCache.set('key2', 'data2', 10000); // 10s TTL

            await new Promise(resolve => setTimeout(resolve, 100));
            testCache.cleanup();

            expect(testCache.cache.has('key1')).toBe(false);
            expect(testCache.cache.has('key2')).toBe(true);
        });
    });

    describe('Statistics', () => {
        test('should track statistics correctly', () => {
            testCache.set('key1', 'data1');
            testCache.get('key1'); // Hit
            testCache.get('key2'); // Miss
            testCache.delete('key1');

            const stats = testCache.getStats();

            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(1);
            expect(stats.sets).toBe(1);
            expect(stats.deletes).toBe(1);
            expect(stats.hitRate).toBe(0.5);
        });

        test('should reset statistics', () => {
            testCache.set('key1', 'data1');
            testCache.get('key1');

            testCache.resetStats();

            expect(testCache.stats).toEqual({
                hits: 0,
                misses: 0,
                sets: 0,
                deletes: 0,
            });
        });
    });

    describe('Middleware Factory', () => {
        let req, res, next;

        beforeEach(() => {
            req = {
                method: 'GET',
                url: '/api/test',
                query: {},
                body: {},
            };
            res = {
                statusCode: 200,
                json: jest.fn(),
                set: jest.fn(),
            };
            next = jest.fn();
        });

        test('should create middleware function', () => {
            const middleware = createCacheMiddleware();
            expect(typeof middleware).toBe('function');
        });

        test('should skip non-GET requests by default', () => {
            const middleware = createCacheMiddleware();
            req.method = 'POST';

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should override res.json for caching', () => {
            const middleware = createCacheMiddleware();
            const originalJson = res.json;

            middleware(req, res, next);

            expect(res.json).not.toBe(originalJson);
            expect(next).toHaveBeenCalled();
        });

        test('should set cache headers on response', () => {
            const middleware = createCacheMiddleware();
            const responseData = { message: 'test' };

            middleware(req, res, next);
            res.json(responseData);

            expect(res.set).toHaveBeenCalledWith('X-Cache', 'MISS');
            expect(res.set).toHaveBeenCalledWith('X-Cache-Key', expect.stringContaining('...'));
        });
    });

    describe('Cache Presets', () => {
        test('should have predefined cache middleware', () => {
            expect(typeof cacheMiddleware.short).toBe('function');
            expect(typeof cacheMiddleware.medium).toBe('function');
            expect(typeof cacheMiddleware.long).toBe('function');
            expect(typeof cacheMiddleware.media).toBe('function');
            expect(typeof cacheMiddleware.config).toBe('function');
        });

        test('media middleware should skip when nocache=true', () => {
            const req = {
                method: 'GET',
                url: '/api/media',
                query: { nocache: 'true' },
            };
            const res = { json: jest.fn(), set: jest.fn() };
            const next = jest.fn();

            cacheMiddleware.media(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('Global Cache Instance', () => {
        test('should expose global apiCache instance', () => {
            expect(apiCache).toBeInstanceOf(ApiCache);
            expect(apiCache.defaultTTL).toBe(5 * 60 * 1000);
        });
    });

    describe('Utility Methods', () => {
        test('should sort objects consistently', () => {
            const input = { c: 3, a: 1, b: 2 };
            const result = testCache.sortObject(input);
            const keys = Object.keys(result);
            expect(keys).toEqual(['a', 'b', 'c']);
        });

        test('should handle non-objects in sortObject', () => {
            expect(testCache.sortObject(null)).toBeNull();
            expect(testCache.sortObject(undefined)).toBeUndefined();
            expect(testCache.sortObject('string')).toBe('string');
        });

        test('should handle destroy method', () => {
            const cache = new ApiCache();
            cache.set('test', 'data');

            cache.destroy();

            expect(cache.cleanupInterval).toBeNull();
            expect(cache.cache.size).toBe(0);
        });
    });
});
