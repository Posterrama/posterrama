const { cacheManager, cacheMiddleware, initializeCache } = require('../utils/cache');
const fs = require('fs').promises;
const crypto = require('crypto');

// Mock fs and crypto for some tests
jest.mock('fs', () => ({
    promises: {
        mkdir: jest.fn(),
        writeFile: jest.fn(),
        readdir: jest.fn(),
        readFile: jest.fn(),
        unlink: jest.fn()
    }
}));

describe('Cache Utils - Comprehensive Tests', () => {
    let mockLogger;

    beforeEach(() => {
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };
        
        // Reset cache
        cacheManager.clear();
        jest.clearAllMocks();
        
        // Initialize with mock logger
        initializeCache(mockLogger);
    });

    describe('CacheManager - Basic Operations', () => {
        test('should set and get cache entries', () => {
            const key = 'test-key';
            const value = { data: 'test' };
            
            const entry = cacheManager.set(key, value, 1000);
            
            expect(entry).toBeDefined();
            expect(entry.value).toEqual(value);
            expect(entry.etag).toBeDefined();
            expect(entry.createdAt).toBeDefined();
            expect(entry.expiresAt).toBeDefined();
        });

        test('should return null for non-existent keys', () => {
            const result = cacheManager.get('non-existent');
            expect(result).toBeNull();
        });

        test('should return the actual entry object on get', () => {
            const key = 'test-key';
            const value = 'test-value';
            
            cacheManager.set(key, value);
            const entry = cacheManager.get(key);
            
            expect(entry).toBeDefined();
            expect(entry.value).toEqual(value);
            expect(entry.accessCount).toBeGreaterThan(0);
        });

        test('should track access count', () => {
            const key = 'test-key';
            const value = 'test-value';
            
            cacheManager.set(key, value);
            
            const entry1 = cacheManager.get(key);
            expect(entry1.accessCount).toBe(1);
            
            const entry2 = cacheManager.get(key);
            expect(entry2.accessCount).toBe(2);
        });

        test('should update lastAccessed on get', () => {
            const key = 'test-key';
            const value = 'test-value';
            
            cacheManager.set(key, value);
            const initialTime = Date.now();
            
            // Small delay to ensure different timestamp
            setTimeout(() => {
                const entry = cacheManager.get(key);
                expect(entry.lastAccessed).toBeGreaterThanOrEqual(initialTime);
            }, 10);
        });
    });

    describe('CacheManager - TTL and Expiration', () => {
        test('should expire entries after TTL', (done) => {
            const key = 'expire-test';
            const value = 'will-expire';
            
            cacheManager.set(key, value, 50); // 50ms TTL
            
            // Should exist immediately
            expect(cacheManager.get(key)).toBeDefined();
            
            // Should expire after TTL
            setTimeout(() => {
                expect(cacheManager.get(key)).toBeNull();
                done();
            }, 100);
        });

        test('should use default TTL when not specified', () => {
            const key = 'default-ttl';
            const value = 'test';
            
            const entry = cacheManager.set(key, value);
            const expectedExpiry = Date.now() + 300000; // Default 5 minutes
            
            expect(entry.expiresAt).toBeCloseTo(expectedExpiry, -2);
        });

        test('should handle immediate expiration', () => {
            const key = 'immediate-expire';
            const value = 'test';
            
            cacheManager.set(key, value, 0); // Immediate expiration
            expect(cacheManager.get(key)).toBeNull();
        });

        test('should clear timer when entry is manually deleted', () => {
            const key = 'timer-test';
            const value = 'test';
            
            cacheManager.set(key, value, 1000);
            expect(cacheManager.delete(key)).toBe(true);
            expect(cacheManager.get(key)).toBeNull();
        });
    });

    describe('CacheManager - Cache Size Management', () => {
        test('should respect max cache size', () => {
            // Create cache with small max size for testing
            const testCache = new (require('../utils/cache').cacheManager.constructor)({
                maxSize: 2,
                defaultTTL: 10000
            });
            
            testCache.set('key1', 'value1');
            testCache.set('key2', 'value2');
            testCache.set('key3', 'value3'); // Should evict key1
            
            expect(testCache.has('key1')).toBe(false);
            expect(testCache.has('key2')).toBe(true);
            expect(testCache.has('key3')).toBe(true);
        });

        test('should not evict when updating existing key', () => {
            const testCache = new (require('../utils/cache').cacheManager.constructor)({
                maxSize: 2,
                defaultTTL: 10000
            });
            
            testCache.set('key1', 'value1');
            testCache.set('key2', 'value2');
            testCache.set('key1', 'updated-value1'); // Update existing
            
            expect(testCache.has('key1')).toBe(true);
            expect(testCache.has('key2')).toBe(true);
            expect(testCache.get('key1').value).toBe('updated-value1');
        });
    });

    describe('CacheManager - ETag Generation', () => {
        test('should generate consistent ETags for same data', () => {
            const data = { test: 'data' };
            const etag1 = cacheManager.generateETag(data);
            const etag2 = cacheManager.generateETag(data);
            
            expect(etag1).toBe(etag2);
        });

        test('should generate different ETags for different data', () => {
            const data1 = { test: 'data1' };
            const data2 = { test: 'data2' };
            
            const etag1 = cacheManager.generateETag(data1);
            const etag2 = cacheManager.generateETag(data2);
            
            expect(etag1).not.toBe(etag2);
        });

        test('should handle string data for ETag generation', () => {
            const etag = cacheManager.generateETag('test string');
            expect(etag).toMatch(/^"[a-f0-9]{32}"$/);
        });
    });

    describe('CacheManager - Statistics', () => {
        test('should provide accurate cache statistics', () => {
            cacheManager.set('key1', 'value1');
            cacheManager.set('key2', 'value2');
            cacheManager.get('key1'); // Access key1
            cacheManager.get('key1'); // Access key1 again
            cacheManager.get('key2'); // Access key2
            
            const stats = cacheManager.getStats();
            
            expect(stats.size).toBe(2);
            expect(stats.totalAccess).toBe(3);
            expect(stats.entries).toHaveLength(2);
            expect(stats.hitRate).toBeGreaterThan(0);
        });

        test('should handle empty cache statistics', () => {
            const stats = cacheManager.getStats();
            
            expect(stats.size).toBe(0);
            expect(stats.totalAccess).toBe(0);
            expect(stats.entries).toHaveLength(0);
            expect(stats.hitRate).toBe(0);
        });
    });

    describe('CacheManager - Clear Operations', () => {
        test('should clear all cache entries', () => {
            cacheManager.set('key1', 'value1');
            cacheManager.set('key2', 'value2');
            
            const cleared = cacheManager.clear();
            
            expect(cleared).toBe(2);
            expect(cacheManager.getStats().size).toBe(0);
        });

        test('should clear entries by type', () => {
            cacheManager.set('config:app', 'app-config');
            cacheManager.set('config:user', 'user-config');
            cacheManager.set('data:users', 'users-data');
            
            const cleared = cacheManager.clear('config');
            
            expect(cleared).toBe(2);
            expect(cacheManager.has('config:app')).toBe(false);
            expect(cacheManager.has('config:user')).toBe(false);
            expect(cacheManager.has('data:users')).toBe(true);
        });

        test('should return 0 when clearing non-existent type', () => {
            cacheManager.set('key1', 'value1');
            
            const cleared = cacheManager.clear('nonexistent');
            
            expect(cleared).toBe(0);
            expect(cacheManager.has('key1')).toBe(true);
        });
    });

    describe('CacheManager - Error Handling', () => {
        test('should handle errors gracefully in set operation', () => {
            // Mock timer creation to throw error
            const originalSetTimeout = global.setTimeout;
            global.setTimeout = jest.fn(() => {
                throw new Error('Timer error');
            });
            
            const result = cacheManager.set('error-key', 'value');
            
            expect(result).toBeNull();
            expect(mockLogger.error).toHaveBeenCalled();
            
            // Restore original setTimeout
            global.setTimeout = originalSetTimeout;
        });

        test('should handle errors gracefully in get operation', () => {
            // Set a valid entry first
            cacheManager.set('test-key', 'value');
            
            // Mock Map.get to throw error
            const originalGet = Map.prototype.get;
            Map.prototype.get = jest.fn(() => {
                throw new Error('Get error');
            });
            
            const result = cacheManager.get('test-key');
            
            expect(result).toBeNull();
            expect(mockLogger.error).toHaveBeenCalled();
            
            // Restore original get
            Map.prototype.get = originalGet;
        });

        test('should handle errors gracefully in delete operation', () => {
            cacheManager.set('test-key', 'value');
            
            // Mock Map.delete to throw error
            const originalDelete = Map.prototype.delete;
            Map.prototype.delete = jest.fn(() => {
                throw new Error('Delete error');
            });
            
            const result = cacheManager.delete('test-key');
            
            expect(result).toBe(false);
            expect(mockLogger.error).toHaveBeenCalled();
            
            // Restore original delete
            Map.prototype.delete = originalDelete;
        });

        test('should handle errors gracefully in clear operation', () => {
            cacheManager.set('test-key', 'value');
            
            // Mock Map.clear to throw error
            const originalClear = Map.prototype.clear;
            Map.prototype.clear = jest.fn(() => {
                throw new Error('Clear error');
            });
            
            const result = cacheManager.clear();
            
            expect(result).toBe(0);
            expect(mockLogger.error).toHaveBeenCalled();
            
            // Restore original clear
            Map.prototype.clear = originalClear;
        });
    });

    describe('CacheManager - Persistence', () => {
        test('should skip persistence when disabled', async () => {
            const entry = cacheManager.set('test-key', 'value');
            
            // Wait for any async operations
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(fs.writeFile).not.toHaveBeenCalled();
        });

        test('should persist entries when enabled', async () => {
            const persistentCache = new (require('../utils/cache').cacheManager.constructor)({
                enablePersistence: true,
                persistPath: '/tmp/cache-test'
            });
            
            initializeCache(mockLogger);
            
            fs.mkdir.mockResolvedValue();
            fs.writeFile.mockResolvedValue();
            
            persistentCache.set('test-key', 'value');
            
            // Wait for async persistence
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(fs.mkdir).toHaveBeenCalledWith('/tmp/cache-test', { recursive: true });
            expect(fs.writeFile).toHaveBeenCalled();
        });

        test('should handle persistence errors gracefully', async () => {
            const persistentCache = new (require('../utils/cache').cacheManager.constructor)({
                enablePersistence: true
            });
            
            initializeCache(mockLogger);
            
            fs.mkdir.mockRejectedValue(new Error('Write error'));
            
            persistentCache.set('test-key', 'value');
            
            // Wait for async persistence
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        test('should load persisted entries', async () => {
            const persistentCache = new (require('../utils/cache').cacheManager.constructor)({
                enablePersistence: true
            });
            
            initializeCache(mockLogger);
            
            const mockData = {
                key: 'persisted-key',
                value: 'persisted-value',
                etag: '"test-etag"',
                createdAt: Date.now() - 1000,
                expiresAt: Date.now() + 10000,
                accessCount: 0,
                lastAccessed: Date.now() - 1000
            };
            
            fs.readdir.mockResolvedValue(['test.json', 'not-json.txt']);
            fs.readFile.mockResolvedValue(JSON.stringify(mockData));
            
            await persistentCache.loadPersistedEntries();
            
            expect(persistentCache.has('persisted-key')).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith('Loaded persisted cache entries', { loaded: 1 });
        });

        test('should remove expired persisted entries', async () => {
            const persistentCache = new (require('../utils/cache').cacheManager.constructor)({
                enablePersistence: true
            });
            
            initializeCache(mockLogger);
            
            const expiredData = {
                key: 'expired-key',
                value: 'expired-value',
                etag: '"test-etag"',
                createdAt: Date.now() - 10000,
                expiresAt: Date.now() - 1000, // Already expired
                accessCount: 0,
                lastAccessed: Date.now() - 10000
            };
            
            fs.readdir.mockResolvedValue(['expired.json']);
            fs.readFile.mockResolvedValue(JSON.stringify(expiredData));
            fs.unlink.mockResolvedValue();
            
            await persistentCache.loadPersistedEntries();
            
            expect(fs.unlink).toHaveBeenCalled();
            expect(persistentCache.has('expired-key')).toBe(false);
        });

        test('should handle corrupted persisted entries', async () => {
            const persistentCache = new (require('../utils/cache').cacheManager.constructor)({
                enablePersistence: true
            });
            
            initializeCache(mockLogger);
            
            fs.readdir.mockResolvedValue(['corrupted.json']);
            fs.readFile.mockResolvedValue('invalid json');
            
            await persistentCache.loadPersistedEntries();
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Failed to load persisted cache entry',
                expect.objectContaining({ file: 'corrupted.json' })
            );
        });
    });
});

describe('Cache Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            method: 'GET',
            originalUrl: '/test',
            headers: {},
            query: {}
        };
        res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
            json: jest.fn(),
            set: jest.fn(),
            end: jest.fn(),
            statusCode: 200
        };
        next = jest.fn();
        
        cacheManager.clear();
    });

    describe('Basic Caching', () => {
        test('should cache GET responses', () => {
            const middleware = cacheMiddleware();
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalled();
            
            // Simulate response
            res.send('test response');
            
            expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
                'X-Cache': 'MISS'
            }));
        });

        test('should serve cached responses', () => {
            const middleware = cacheMiddleware();
            
            // First request - cache miss
            middleware(req, res, next);
            res.send('cached response');
            
            // Reset mocks
            jest.clearAllMocks();
            
            // Second request - cache hit
            middleware(req, res, next);
            
            expect(next).not.toHaveBeenCalled();
            expect(res.send).toHaveBeenCalledWith('cached response');
            expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
                'X-Cache': 'HIT'
            }));
        });

        test('should handle JSON responses', () => {
            const middleware = cacheMiddleware();
            const jsonData = { message: 'test' };
            
            middleware(req, res, next);
            res.json(jsonData);
            
            // Reset and make second request
            jest.clearAllMocks();
            middleware(req, res, next);
            
            expect(res.json).toHaveBeenCalledWith(jsonData);
        });
    });

    describe('Cache Control', () => {
        test('should skip caching for non-GET requests', () => {
            req.method = 'POST';
            const middleware = cacheMiddleware();
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should skip caching when no-cache header present', () => {
            req.headers['cache-control'] = 'no-cache';
            const middleware = cacheMiddleware();
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should skip caching when nocache query param present', () => {
            req.query.nocache = '1';
            const middleware = cacheMiddleware();
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should handle conditional requests with ETag', () => {
            const middleware = cacheMiddleware();
            
            // First request to establish cache
            middleware(req, res, next);
            res.send('test response');
            
            // Get the ETag from cache
            const cached = cacheManager.get('GET:/test');
            
            // Second request with If-None-Match header
            req.headers['if-none-match'] = cached.etag;
            jest.clearAllMocks();
            
            middleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(304);
            expect(res.end).toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('Configuration Options', () => {
        test('should use custom TTL', () => {
            const customTTL = 60000; // 1 minute
            const middleware = cacheMiddleware({ ttl: customTTL });
            
            middleware(req, res, next);
            res.send('test response');
            
            const cached = cacheManager.get('GET:/test');
            expect(cached.expiresAt - cached.createdAt).toBeCloseTo(customTTL, -2);
        });

        test('should use custom key generator', () => {
            const keyGenerator = (req) => `custom:${req.originalUrl}`;
            const middleware = cacheMiddleware({ keyGenerator });
            
            middleware(req, res, next);
            res.send('test response');
            
            expect(cacheManager.has('custom:/test')).toBe(true);
        });

        test('should set custom cache control headers', () => {
            const cacheControl = 'public, max-age=600';
            const middleware = cacheMiddleware({ cacheControl });
            
            middleware(req, res, next);
            res.send('test response');
            
            expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
                'Cache-Control': cacheControl
            }));
        });

        test('should set custom vary headers', () => {
            const varyHeaders = ['Accept', 'User-Agent', 'Accept-Language'];
            const middleware = cacheMiddleware({ varyHeaders });
            
            middleware(req, res, next);
            res.send('test response');
            
            expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
                'Vary': 'Accept, User-Agent, Accept-Language'
            }));
        });
    });

    describe('Error Conditions', () => {
        test('should handle caching errors gracefully', () => {
            // Mock cacheManager.set to return null (error condition)
            const originalSet = cacheManager.set;
            cacheManager.set = jest.fn().mockReturnValue(null);
            
            const middleware = cacheMiddleware();
            
            middleware(req, res, next);
            res.send('test response');
            
            // Should not crash and should not set cache headers
            expect(res.set).not.toHaveBeenCalledWith(expect.objectContaining({
                'ETag': expect.any(String)
            }));
            
            // Restore original method
            cacheManager.set = originalSet;
        });

        test('should only cache successful responses', () => {
            const middleware = cacheMiddleware();
            res.statusCode = 500; // Error status
            
            middleware(req, res, next);
            res.send('error response');
            
            expect(cacheManager.has('GET:/test')).toBe(false);
        });
    });
});
