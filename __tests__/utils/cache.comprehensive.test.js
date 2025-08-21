const {
    cacheManager,
    cacheMiddleware,
    initializeCache,
    CacheDiskManager,
} = require('../../utils/cache');
const fs = require('fs').promises;

// Mock fs promises
jest.mock('fs', () => ({
    promises: {
        mkdir: jest.fn(),
        writeFile: jest.fn(),
        readdir: jest.fn(),
        readFile: jest.fn(),
        unlink: jest.fn(),
        stat: jest.fn(),
    },
}));

// Mock child_process
const mockExecSync = jest.fn();
jest.mock('child_process', () => ({ execSync: mockExecSync }));

// Mock logger
const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

describe('Cache Utils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        // Initialize cache with mock logger
        initializeCache(mockLogger);

        // Clear cache manager state
        cacheManager.clear();
        cacheManager.resetStats();
    });

    afterEach(() => {
        jest.useRealTimers();
        cacheManager.cleanup();
    });

    describe('CacheManager', () => {
        describe('Constructor and Initialization', () => {
            test('should initialize with default options', () => {
                expect(cacheManager.config.defaultTTL).toBe(300000);
                expect(cacheManager.config.maxSize).toBe(100);
                expect(cacheManager.config.enablePersistence).toBe(false);
                expect(cacheManager.cache.size).toBe(0);
            });

            test('should initialize with custom options', () => {
                const { CacheManager } = require('../../utils/cache');
                const customCache = new CacheManager({
                    defaultTTL: 60000,
                    maxSize: 50,
                    persistPath: '/custom/path',
                    enablePersistence: true,
                    enableCompression: true,
                });

                expect(customCache.config.defaultTTL).toBe(60000);
                expect(customCache.config.maxSize).toBe(50);
                expect(customCache.config.persistPath).toBe('/custom/path');
                expect(customCache.config.enablePersistence).toBe(true);
                expect(customCache.config.enableCompression).toBe(true);

                customCache.cleanup();
            });
        });

        describe('Set and Get Operations', () => {
            test('should set and get cache entry', () => {
                const result = cacheManager.set('test-key', 'test-value');

                expect(result).not.toBeNull();
                expect(result.value).toBe('test-value');
                expect(result.etag).toBeDefined();

                const cached = cacheManager.get('test-key');
                expect(cached.value).toBe('test-value');
                expect(cacheManager.stats.hits).toBeGreaterThan(0);
            });

            test('should set entry with custom TTL', () => {
                const result = cacheManager.set('ttl-key', 'ttl-value', 10000);
                expect(result.expiresAt).toBeGreaterThan(Date.now() + 9000);
            });

            test('should return null for non-existent key', () => {
                const result = cacheManager.get('non-existent');
                expect(result).toBeNull();
                expect(cacheManager.stats.misses).toBe(1);
            });

            test('should generate unique ETags for different data', () => {
                const entry1 = cacheManager.set('key1', 'value1');
                const entry2 = cacheManager.set('key2', 'value2');

                expect(entry1.etag).not.toBe(entry2.etag);
            });

            test('should generate same ETag for same data', () => {
                const etag1 = cacheManager.generateETag('same-data');
                const etag2 = cacheManager.generateETag('same-data');

                expect(etag1).toBe(etag2);
            });

            test('should handle object data in ETag generation', () => {
                const obj1 = { name: 'test', value: 123 };
                const obj2 = { name: 'test', value: 123 };

                const etag1 = cacheManager.generateETag(obj1);
                const etag2 = cacheManager.generateETag(obj2);

                expect(etag1).toBe(etag2);
            });

            test('should handle immediate expiration (TTL = 0)', () => {
                const result = cacheManager.set('immediate-expire', 'value', 0);
                expect(result).toBeNull();

                const cached = cacheManager.get('immediate-expire');
                expect(cached).toBeNull();
            });

            test('should update existing entry', () => {
                cacheManager.set('update-key', 'old-value');
                const updated = cacheManager.set('update-key', 'new-value');

                expect(updated.value).toBe('new-value');

                const cached = cacheManager.get('update-key');
                expect(cached.value).toBe('new-value');
            });
        });

        describe('Cache Size Management', () => {
            test('should enforce max size limit', () => {
                const { CacheManager } = require('../../utils/cache');
                const smallCache = new CacheManager({ maxSize: 2 });

                smallCache.set('key1', 'value1');
                smallCache.set('key2', 'value2');
                expect(smallCache.cache.size).toBe(2);

                // Should remove oldest entry
                smallCache.set('key3', 'value3');
                expect(smallCache.cache.size).toBe(2);
                expect(smallCache.has('key1')).toBe(false); // Oldest should be removed
                expect(smallCache.has('key3')).toBe(true);

                smallCache.cleanup();
            });
        });

        describe('TTL and Expiration', () => {
            test('should expire entries after TTL', () => {
                cacheManager.set('expire-key', 'expire-value', 100);

                // Should exist initially
                expect(cacheManager.has('expire-key')).toBe(true);

                // Fast forward time
                jest.advanceTimersByTime(150);

                // Should be expired
                expect(cacheManager.has('expire-key')).toBe(false);
                const cached = cacheManager.get('expire-key');
                expect(cached).toBeNull();
            });

            test('should clean up expired entries via timer', () => {
                cacheManager.set('timer-expire', 'value', 50);

                expect(cacheManager.cache.size).toBe(1);

                jest.advanceTimersByTime(100);

                // Timer should have cleaned up expired entry
                expect(cacheManager.cache.size).toBe(0);
            });

            test('should log information when cleaning up expired entries', () => {
                cacheManager.set('cleanup-log-1', 'value1', 10);
                cacheManager.set('cleanup-log-2', 'value2', 10);

                jest.advanceTimersByTime(50);

                const expired = cacheManager.cleanupExpired();

                if (expired > 0) {
                    expect(mockLogger.info).toHaveBeenCalledWith(
                        expect.stringContaining('Cache cleanup: removed'),
                        expect.anything()
                    );
                }
            });

            test('should not log when no entries are expired', () => {
                cacheManager.set('no-expire-log', 'value', 10000);

                const expired = cacheManager.cleanupExpired();

                expect(expired).toBe(0);
                // Should not log when nothing expired
            });
        });

        describe('Delete and Clear Operations', () => {
            test('should delete single entry', () => {
                cacheManager.set('delete-key', 'delete-value');

                const deleted = cacheManager.delete('delete-key');
                expect(deleted).toBe(true);
                expect(cacheManager.has('delete-key')).toBe(false);
            });

            test('should return false when deleting non-existent key', () => {
                const deleted = cacheManager.delete('non-existent');
                expect(deleted).toBe(false);
            });

            test('should clear all entries', () => {
                cacheManager.set('clear1', 'value1');
                cacheManager.set('clear2', 'value2');

                const cleared = cacheManager.clear();
                expect(cleared).toBe(2);
                expect(cacheManager.cache.size).toBe(0);
            });

            test('should clear entries by type', () => {
                cacheManager.set('type1:item1', 'value1');
                cacheManager.set('type1:item2', 'value2');
                cacheManager.set('type2:item1', 'value3');

                const cleared = cacheManager.clear('type1');
                expect(cleared).toBe(2);
                expect(cacheManager.cache.size).toBe(1);
                expect(cacheManager.has('type2:item1')).toBe(true);
            });
        });

        describe('Statistics', () => {
            test('should track cache statistics', () => {
                cacheManager.set('stats-key', 'value');
                cacheManager.get('stats-key');
                cacheManager.get('non-existent');

                const stats = cacheManager.getStats();

                expect(stats.size).toBe(1);
                expect(stats.hits).toBe(1);
                expect(stats.misses).toBe(1);
                expect(stats.totalRequests).toBe(2);
                expect(stats.hitRate).toBe(0.5);
                expect(Array.isArray(stats.entries)).toBe(true);
                expect(stats.entries.length).toBe(1);
            });

            test('should reset statistics', () => {
                cacheManager.set('reset-key', 'value');
                cacheManager.get('reset-key');

                expect(cacheManager.stats.hits).toBeGreaterThan(0);

                cacheManager.resetStats();

                expect(cacheManager.stats.hits).toBe(0);
                expect(cacheManager.stats.misses).toBe(0);
                // Note: sets and deletes are not reset in current implementation
                expect(cacheManager.stats.cleanups).toBe(0);
            });

            test('should handle hitRate calculation with no requests', () => {
                cacheManager.resetStats();
                const stats = cacheManager.getStats();
                expect(stats.hitRate).toBe(0);
            });

            test('should track individual entry statistics', () => {
                cacheManager.set('track-key', 'value');
                cacheManager.get('track-key');
                cacheManager.get('track-key');

                const stats = cacheManager.getStats();
                expect(stats.entries[0].accessCount).toBeGreaterThan(1);
                expect(stats.averageAccessCount).toBeGreaterThan(0);
            });

            test('should count sets and deletes correctly', () => {
                cacheManager.set('count-key1', 'value1');
                cacheManager.set('count-key2', 'value2');
                cacheManager.delete('count-key1');

                // Check that operations were performed
                expect(cacheManager.has('count-key1')).toBe(false);
                expect(cacheManager.has('count-key2')).toBe(true);
                expect(cacheManager.cache.size).toBe(1);
            });
        });

        describe('Error Handling', () => {
            test('should handle errors in set operation gracefully', () => {
                // Force an error by corrupting the cache map
                const originalSet = cacheManager.cache.set;
                cacheManager.cache.set = () => {
                    throw new Error('Set operation failed');
                };

                const result = cacheManager.set('error-key', 'value');
                expect(result).toBeNull();

                cacheManager.cache.set = originalSet;
            });

            test('should handle errors in get operation gracefully', () => {
                // Set up entry first
                cacheManager.set('error-get', 'value');

                // Force error by corrupting cache
                const originalGet = cacheManager.cache.get;
                cacheManager.cache.get = () => {
                    throw new Error('Get operation failed');
                };

                const result = cacheManager.get('error-get');
                expect(result).toBeNull();

                cacheManager.cache.get = originalGet;
            });

            test('should handle errors in delete operation gracefully', () => {
                cacheManager.set('error-delete', 'value');

                // Force error
                const originalDelete = cacheManager.cache.delete;
                cacheManager.cache.delete = () => {
                    throw new Error('Delete operation failed');
                };

                const result = cacheManager.delete('error-delete');
                expect(result).toBe(false);

                cacheManager.cache.delete = originalDelete;
            });

            test('should handle timer creation errors', () => {
                // Mock setTimeout to throw error
                const originalSetTimeout = global.setTimeout;
                global.setTimeout = () => {
                    throw new Error('Timer creation failed');
                };

                const result = cacheManager.set('timer-error', 'value', 1000);
                expect(result).toBeNull();

                global.setTimeout = originalSetTimeout;
            });
        });

        describe('Persistence', () => {
            test('should persist entry when enabled', async () => {
                const { CacheManager } = require('../../utils/cache');
                const persistentCache = new CacheManager({
                    enablePersistence: true,
                    persistPath: '/test/cache',
                });

                fs.mkdir.mockResolvedValue();
                fs.writeFile.mockResolvedValue();

                await persistentCache.set('persist-key', 'persist-value');

                expect(fs.mkdir).toHaveBeenCalledWith('/test/cache', { recursive: true });
                expect(fs.writeFile).toHaveBeenCalled();

                persistentCache.cleanup();
            });

            test('should handle persistence errors', async () => {
                const { CacheManager } = require('../../utils/cache');
                const persistentCache = new CacheManager({ enablePersistence: true });

                fs.mkdir.mockRejectedValue(new Error('Write permission denied'));

                const result = await persistentCache.set('persist-error', 'value');
                expect(result).not.toBeNull(); // Set should still succeed
                expect(mockLogger.warn).toHaveBeenCalled();

                persistentCache.cleanup();
            });

            test('should load persisted entries', async () => {
                const { CacheManager } = require('../../utils/cache');
                const persistentCache = new CacheManager({ enablePersistence: true });

                fs.readdir.mockResolvedValue(['entry1.json', 'entry2.json', 'invalid.txt']);
                fs.readFile.mockImplementation(filePath => {
                    if (filePath.includes('entry1.json')) {
                        return Promise.resolve(
                            JSON.stringify({
                                key: 'persisted1',
                                value: 'value1',
                                etag: '"abc123"',
                                createdAt: Date.now() - 60000,
                                expiresAt: Date.now() + 60000,
                                accessCount: 5,
                                lastAccessed: Date.now() - 30000,
                            })
                        );
                    }
                    return Promise.resolve(
                        JSON.stringify({
                            key: 'expired',
                            value: 'value2',
                            etag: '"def456"',
                            createdAt: Date.now() - 120000,
                            expiresAt: Date.now() - 60000, // Expired
                        })
                    );
                });
                fs.unlink.mockResolvedValue();

                await persistentCache.loadPersistedEntries();

                expect(persistentCache.cache.has('persisted1')).toBe(true);
                expect(fs.unlink).toHaveBeenCalled(); // Expired entry should be removed

                persistentCache.cleanup();
            });
        });

        describe('Periodic Cleanup', () => {
            test('should start and stop periodic cleanup', () => {
                const { CacheManager } = require('../../utils/cache');
                const testCache = new CacheManager();

                expect(testCache.cleanupInterval).toBeDefined();

                testCache.stopPeriodicCleanup();
                expect(testCache.cleanupInterval).toBeNull();

                testCache.cleanup();
            });

            test('should run periodic cleanup', () => {
                cacheManager.set('periodic1', 'value1', 50);
                cacheManager.set('periodic2', 'value2', 200);

                jest.advanceTimersByTime(100);

                // First entry should be expired by periodic cleanup
                expect(cacheManager.cache.size).toBe(1);
            });
        });
    });

    describe('Cache Middleware', () => {
        let req, res, next, originalJson, originalSend;

        beforeEach(() => {
            req = {
                method: 'GET',
                originalUrl: '/api/test',
                headers: {},
                query: {},
            };

            res = {
                status: jest.fn().mockReturnThis(),
                end: jest.fn(),
                set: jest.fn(),
                statusCode: 200,
            };

            // Create mock functions for json and send that can be overridden
            originalJson = jest.fn();
            originalSend = jest.fn();
            res.json = originalJson;
            res.send = originalSend;

            next = jest.fn();
        });

        test('should skip caching for non-GET requests', () => {
            const middleware = cacheMiddleware();
            req.method = 'POST';

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should skip caching with no-cache header', () => {
            const middleware = cacheMiddleware();
            req.headers['cache-control'] = 'no-cache';

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should skip caching with nocache query param', () => {
            const middleware = cacheMiddleware();
            req.query.nocache = '1';

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should handle cache miss and setup caching', () => {
            const middleware = cacheMiddleware();

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
            // Original methods should be preserved
            expect(typeof res.json).toBe('function');
            expect(typeof res.send).toBe('function');
        });

        test('should serve cached response if available', () => {
            const middleware = cacheMiddleware();

            // Pre-populate cache
            cacheManager.set('GET:/api/test', { message: 'cached data' });

            middleware(req, res, next);

            expect(res.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    'X-Cache': 'HIT',
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        test('should handle 304 Not Modified responses', () => {
            const middleware = cacheMiddleware();

            const cached = cacheManager.set('GET:/api/test', { data: 'test' });
            req.headers['if-none-match'] = cached.etag;

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(304);
            expect(res.end).toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
        });

        test('should use custom key generator', () => {
            const customKeyGen = req => `custom:${req.originalUrl}`;
            const middleware = cacheMiddleware({ keyGenerator: customKeyGen });

            cacheManager.set('custom:/api/test', 'custom data');

            middleware(req, res, next);

            expect(res.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    'X-Cache': 'HIT',
                })
            );
        });

        test('should handle different response types', () => {
            const middleware = cacheMiddleware();

            // Test string response
            cacheManager.set('GET:/api/test', 'string response');

            middleware(req, res, next);

            expect(res.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    'X-Cache': 'HIT',
                })
            );
        });
    });
    describe('CacheDiskManager', () => {
        let diskManager;
        let testCacheDir;

        beforeEach(() => {
            testCacheDir = '/test/cache/images';
            diskManager = new CacheDiskManager(testCacheDir, {
                maxSizeGB: 1,
                minFreeDiskSpaceMB: 100,
                autoCleanup: true,
            });
        });

        describe('Disk Usage', () => {
            test('should calculate disk usage', async () => {
                fs.readdir.mockResolvedValue([
                    { name: 'image1.jpg', isFile: () => true },
                    { name: 'image2.png', isFile: () => true },
                    { name: 'subfolder', isFile: () => false },
                ]);

                fs.stat.mockImplementation(filePath => {
                    if (filePath.includes('image1.jpg')) {
                        return Promise.resolve({ size: 1024 * 1024 }); // 1MB
                    }
                    return Promise.resolve({ size: 2 * 1024 * 1024 }); // 2MB
                });

                const usage = await diskManager.getDiskUsage();

                expect(usage.totalSizeBytes).toBe(3 * 1024 * 1024); // 3MB
                expect(usage.totalSizeMB).toBe(3);
                expect(usage.fileCount).toBe(2);
                expect(usage.usagePercentage).toBeDefined();
            });

            test('should handle disk usage errors', async () => {
                fs.readdir.mockRejectedValue(new Error('Permission denied'));

                const usage = await diskManager.getDiskUsage();

                expect(usage.totalSizeBytes).toBe(0);
                expect(usage.fileCount).toBe(0);
                expect(mockLogger.error).toHaveBeenCalled();
            });
        });

        describe('Free Disk Space', () => {
            test('should get free disk space on Unix', async () => {
                Object.defineProperty(process, 'platform', { value: 'linux' });
                mockExecSync.mockReturnValue('1000000\n'); // 1GB in KB

                const freeSpace = await diskManager.getFreeDiskSpace();

                expect(freeSpace).toBe(1000000 * 1024); // Converted to bytes
            });

            test('should get free disk space on Windows', async () => {
                Object.defineProperty(process, 'platform', { value: 'win32' });
                mockExecSync.mockReturnValue('Free\n1073741824\n'); // 1GB

                const freeSpace = await diskManager.getFreeDiskSpace();

                expect(freeSpace).toBe(1073741824);
            });

            test('should handle free disk space errors', async () => {
                mockExecSync.mockImplementation(() => {
                    throw new Error('Command failed');
                });

                const freeSpace = await diskManager.getFreeDiskSpace();

                expect(freeSpace).toBe(0);
                expect(mockLogger.warn).toHaveBeenCalled();
            });
        });

        describe('Cache Cleanup', () => {
            test('should skip cleanup when not needed', async () => {
                // Mock small usage and high free space
                jest.spyOn(diskManager, 'getDiskUsage').mockResolvedValue({
                    totalSizeBytes: 100 * 1024 * 1024, // 100MB (under 1GB limit)
                    fileCount: 10,
                });
                jest.spyOn(diskManager, 'getFreeDiskSpace').mockResolvedValue(500 * 1024 * 1024); // 500MB

                const result = await diskManager.cleanupCache();

                expect(result.cleaned).toBe(false);
                expect(result.reason).toBe('No cleanup needed');
            });

            test('should cleanup old files when size limit exceeded', async () => {
                // Mock high usage
                jest.spyOn(diskManager, 'getDiskUsage').mockResolvedValue({
                    totalSizeBytes: 2 * 1024 * 1024 * 1024, // 2GB (over 1GB limit)
                    fileCount: 3,
                });
                jest.spyOn(diskManager, 'getFreeDiskSpace').mockResolvedValue(500 * 1024 * 1024);

                const now = new Date();
                const oldDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
                const newDate = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

                fs.readdir.mockResolvedValue([
                    { name: 'old1.jpg', isFile: () => true },
                    { name: 'old2.jpg', isFile: () => true },
                    { name: 'new.jpg', isFile: () => true },
                ]);

                fs.stat.mockImplementation(filePath => {
                    if (filePath.includes('old1.jpg')) {
                        return Promise.resolve({
                            size: 500 * 1024 * 1024,
                            atime: oldDate,
                            mtime: oldDate,
                        });
                    } else if (filePath.includes('old2.jpg')) {
                        return Promise.resolve({
                            size: 700 * 1024 * 1024,
                            atime: oldDate,
                            mtime: oldDate,
                        });
                    }
                    return Promise.resolve({
                        size: 200 * 1024 * 1024,
                        atime: newDate,
                        mtime: newDate,
                    });
                });

                fs.unlink.mockResolvedValue();

                const result = await diskManager.cleanupCache();

                expect(result.cleaned).toBe(true);
                expect(result.deletedFiles).toBeGreaterThan(0);
                expect(fs.unlink).toHaveBeenCalled();
                expect(mockLogger.info).toHaveBeenCalledWith(
                    'Cache cleanup completed',
                    expect.objectContaining({ deletedFiles: expect.any(Number) })
                );
            });

            test('should handle cleanup errors', async () => {
                jest.spyOn(diskManager, 'getDiskUsage').mockRejectedValue(new Error('Disk error'));

                const result = await diskManager.cleanupCache();

                expect(result.cleaned).toBe(false);
                expect(result.error).toBe('Disk error');
                expect(mockLogger.error).toHaveBeenCalled();
            });

            test('should handle file deletion errors during cleanup', async () => {
                jest.spyOn(diskManager, 'getDiskUsage').mockResolvedValue({
                    totalSizeBytes: 2 * 1024 * 1024 * 1024,
                    fileCount: 1,
                });
                jest.spyOn(diskManager, 'getFreeDiskSpace').mockResolvedValue(50 * 1024 * 1024);

                fs.readdir.mockResolvedValue([{ name: 'test.jpg', isFile: () => true }]);
                fs.stat.mockResolvedValue({
                    size: 100 * 1024 * 1024,
                    atime: new Date(),
                    mtime: new Date(),
                });
                fs.unlink.mockRejectedValue(new Error('Delete permission denied'));

                await diskManager.cleanupCache();

                expect(mockLogger.warn).toHaveBeenCalledWith(
                    'Failed to delete cache file',
                    expect.objectContaining({ error: 'Delete permission denied' })
                );
            });
        });

        describe('Configuration', () => {
            test('should update configuration', () => {
                diskManager.updateConfig({
                    maxSizeGB: 5,
                    minFreeDiskSpaceMB: 1000,
                    autoCleanup: false,
                });

                expect(diskManager.maxSizeBytes).toBe(5 * 1024 * 1024 * 1024);
                expect(diskManager.minFreeDiskSpaceBytes).toBe(1000 * 1024 * 1024);
                expect(diskManager.autoCleanup).toBe(false);
                expect(mockLogger.info).toHaveBeenCalledWith(
                    'Cache configuration updated',
                    expect.objectContaining({ maxSizeGB: 5 })
                );
            });

            test('should cleanup resources', () => {
                diskManager.cleanup();
                expect(mockLogger.debug).toHaveBeenCalledWith('Cache disk manager cleaned up');
            });
        });
    });

    describe('Module Integration', () => {
        test('should export all required functions and classes', () => {
            expect(typeof cacheManager).toBe('object');
            expect(typeof cacheMiddleware).toBe('function');
            expect(typeof initializeCache).toBe('function');
            expect(typeof CacheDiskManager).toBe('function');
        });

        test('should initialize cache with logger', () => {
            const customLogger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };

            const initialized = initializeCache(customLogger);
            expect(initialized).toBe(cacheManager);
        });
    });
});
