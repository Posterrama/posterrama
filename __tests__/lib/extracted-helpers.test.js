/**
 * Tests for extracted helper functions
 * Issue #84: Extract Helper Functions from server.js
 */

const { calculateDirectoryHash } = require('../../lib/build-helpers');
const { cleanup } = require('../../lib/server-helpers');
const path = require('path');

describe('build-helpers', () => {
    describe('calculateDirectoryHash', () => {
        it('should generate consistent hash for same directory', () => {
            const testDir = path.join(__dirname, '..', 'test-utils');
            const hash1 = calculateDirectoryHash(testDir);
            const hash2 = calculateDirectoryHash(testDir);

            expect(hash1).toBe(hash2);
            expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex string
        });

        it('should skip dist and node_modules directories', () => {
            const testDir = __dirname;
            const hash = calculateDirectoryHash(testDir);

            // Should not throw error even if these directories exist
            expect(hash).toBeTruthy();
            expect(typeof hash).toBe('string');
        });

        it('should return different hashes for different directories', () => {
            const dir1 = path.join(__dirname, '..', 'test-utils');
            const dir2 = path.join(__dirname, '..', 'config');

            const hash1 = calculateDirectoryHash(dir1);
            const hash2 = calculateDirectoryHash(dir2);

            expect(hash1).not.toBe(hash2);
        });
    });
});

describe('server-helpers', () => {
    describe('cleanup', () => {
        let mockLogger, mockCacheManager, mockCacheDiskManager, mockMetricsManager;

        beforeEach(() => {
            mockLogger = {
                info: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
            };
            mockCacheManager = { cleanup: jest.fn() };
            mockCacheDiskManager = { cleanup: jest.fn() };
            mockMetricsManager = { shutdown: jest.fn() };

            // Setup global intervals
            global.memoryCheckInterval = setInterval(() => {}, 1000);
            global.tmdbCacheCleanupInterval = setInterval(() => {}, 1000);
            global.playlistRefreshInterval = setInterval(() => {}, 1000);
            global.cacheCleanupInterval = setInterval(() => {}, 1000);

            // Setup global instances
            global.tmdbSourceInstance = { cleanup: jest.fn() };
            global.apiCacheInstance = { destroy: jest.fn() };
        });

        afterEach(() => {
            // Clean up any remaining intervals
            if (global.memoryCheckInterval) clearInterval(global.memoryCheckInterval);
            if (global.tmdbCacheCleanupInterval) clearInterval(global.tmdbCacheCleanupInterval);
            if (global.playlistRefreshInterval) clearInterval(global.playlistRefreshInterval);
            if (global.cacheCleanupInterval) clearInterval(global.cacheCleanupInterval);

            // Reset globals
            global.memoryCheckInterval = null;
            global.tmdbCacheCleanupInterval = null;
            global.playlistRefreshInterval = null;
            global.cacheCleanupInterval = null;
            global.tmdbSourceInstance = null;
            global.apiCacheInstance = null;
        });

        it('should clear all global intervals', () => {
            cleanup({
                logger: mockLogger,
                cacheManager: mockCacheManager,
                cacheDiskManager: mockCacheDiskManager,
                metricsManager: mockMetricsManager,
            });

            expect(global.memoryCheckInterval).toBeNull();
            expect(global.tmdbCacheCleanupInterval).toBeNull();
            expect(global.playlistRefreshInterval).toBeNull();
            expect(global.cacheCleanupInterval).toBeNull();
        });

        it('should cleanup source instances', () => {
            const cleanupSpy = global.tmdbSourceInstance.cleanup;

            cleanup({
                logger: mockLogger,
                cacheManager: mockCacheManager,
                cacheDiskManager: mockCacheDiskManager,
                metricsManager: mockMetricsManager,
            });

            expect(cleanupSpy).toHaveBeenCalled();
            expect(global.tmdbSourceInstance).toBeNull();
        });

        it('should cleanup API cache instance', () => {
            const destroySpy = global.apiCacheInstance.destroy;

            cleanup({
                logger: mockLogger,
                cacheManager: mockCacheManager,
                cacheDiskManager: mockCacheDiskManager,
                metricsManager: mockMetricsManager,
            });

            expect(destroySpy).toHaveBeenCalled();
            expect(global.apiCacheInstance).toBeNull();
        });

        it('should call cleanup on cache managers', () => {
            cleanup({
                logger: mockLogger,
                cacheManager: mockCacheManager,
                cacheDiskManager: mockCacheDiskManager,
                metricsManager: mockMetricsManager,
            });

            expect(mockCacheManager.cleanup).toHaveBeenCalled();
            expect(mockCacheDiskManager.cleanup).toHaveBeenCalled();
        });

        it('should call shutdown on metrics manager', () => {
            cleanup({
                logger: mockLogger,
                cacheManager: mockCacheManager,
                cacheDiskManager: mockCacheDiskManager,
                metricsManager: mockMetricsManager,
            });

            expect(mockMetricsManager.shutdown).toHaveBeenCalled();
        });

        it('should log cleanup start and completion', () => {
            cleanup({
                logger: mockLogger,
                cacheManager: mockCacheManager,
                cacheDiskManager: mockCacheDiskManager,
                metricsManager: mockMetricsManager,
            });

            expect(mockLogger.info).toHaveBeenCalledWith('Cleaning up server resources...');
            expect(mockLogger.info).toHaveBeenCalledWith('Server cleanup completed');
        });

        it('should handle missing managers gracefully', () => {
            cleanup({
                logger: mockLogger,
                cacheManager: null,
                cacheDiskManager: null,
                metricsManager: null,
            });

            // Should not throw and should still log
            expect(mockLogger.info).toHaveBeenCalledWith('Cleaning up server resources...');
            expect(mockLogger.info).toHaveBeenCalledWith('Server cleanup completed');
        });
    });
});
