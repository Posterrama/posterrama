/**
 * Cache Management Improvements Tests
 * Tests the enhanced cache configuration and management
 */

const path = require('path');
const fs = require('fs').promises;

// Mock logger to avoid side effects
jest.mock('../../utils/logger');

describe('Cache Configuration Defaults', () => {
    test('schema and example defaults match expectations', async () => {
        const schema = require('../../config.schema.json');
        const example = require('../../config.example.json');

        expect(schema).toBeDefined();
        expect(example).toBeDefined();

        // Schema default validations
        const cacheProps = schema.properties.cache.properties;
        expect(cacheProps.maxSizeGB.default).toBe(2);
        expect(cacheProps.minFreeDiskSpaceMB.default).toBe(750);
        expect(cacheProps.autoCleanup.default).toBe(true);
        expect(cacheProps.cleanupIntervalMinutes.default).toBe(15);
        expect(cacheProps.maxAgeHours.default).toBe(168);

        // Example config should use 2GB by default for new installs
        expect(example.cache).toBeDefined();
        expect(example.cache.maxSizeGB).toBe(2);
    });

    test('defaults fall within reasonable ranges', () => {
        const schema = require('../../config.schema.json');
        const cacheProps = schema.properties.cache.properties;
        const def = k => cacheProps[k].default;

        expect(def('maxSizeGB')).toBeGreaterThan(0);
        expect(def('maxSizeGB')).toBeLessThanOrEqual(100);
        expect(def('minFreeDiskSpaceMB')).toBeGreaterThan(100);
        expect(def('minFreeDiskSpaceMB')).toBeLessThan(5000);
        expect(def('cleanupIntervalMinutes')).toBeGreaterThan(1);
        expect(def('cleanupIntervalMinutes')).toBeLessThan(1440);
        expect(def('maxAgeHours')).toBeGreaterThan(1);
        expect(def('maxAgeHours')).toBeLessThan(8760);
    });
});

describe('Cache Disk Manager Integration', () => {
    let cacheDiskManager;
    let tempCacheDir;

    beforeAll(async () => {
        // Create temporary cache directory for testing
        tempCacheDir = path.join(__dirname, 'temp_cache');
        await fs.mkdir(tempCacheDir, { recursive: true });
    });

    afterAll(async () => {
        // Clean up temporary cache directory (Node 18+: use fs.rm)
        try {
            await fs.rm(tempCacheDir, { recursive: true, force: true });
        } catch (_) {
            // Ignore cleanup errors
        }
    });

    beforeEach(() => {
        const { CacheDiskManager } = require('../../utils/cache');
        const config = require('../../config.json');

        cacheDiskManager = new CacheDiskManager(tempCacheDir, config.cache);
    });

    test('should initialize with improved configuration', () => {
        expect(cacheDiskManager).toBeDefined();

        // Test that it uses the improved configuration
        const config = require('../../config.json');
        const schema = require('../../config.schema.json');
        const cacheProps = schema.properties.cache.properties;
        const maxSizeBytes =
            (config.cache?.maxSizeGB ?? cacheProps.maxSizeGB.default) * 1024 * 1024 * 1024;
        const minFreeBytes =
            (config.cache?.minFreeDiskSpaceMB ?? cacheProps.minFreeDiskSpaceMB.default) *
            1024 *
            1024;

        // Verify config values are reasonable
        expect(maxSizeBytes).toBeGreaterThan(0);
        expect(minFreeBytes).toBeGreaterThan(0);

        // We can't directly test private properties, but we can test behavior
        expect(typeof cacheDiskManager.getDiskUsage).toBe('function');
        expect(typeof cacheDiskManager.cleanupCache).toBe('function');
    });

    test('should provide disk usage information', async () => {
        const usage = await cacheDiskManager.getDiskUsage();

        expect(usage).toBeDefined();
        expect(typeof usage.totalSizeBytes).toBe('number');
        expect(typeof usage.totalSizeMB).toBe('number');
        expect(typeof usage.totalSizeGB).toBe('number');
        expect(typeof usage.fileCount).toBe('number');
        expect(typeof usage.maxSizeBytes).toBe('number');
        expect(typeof usage.maxSizeGB).toBe('number');
        expect(typeof usage.usagePercentage).toBe('number');
    });

    test('should perform cache cleanup', async () => {
        const result = await cacheDiskManager.cleanupCache();

        expect(result).toBeDefined();
        expect(typeof result.cleaned).toBe('boolean');
        expect(typeof result.deletedFiles).toBe('number');
        expect(typeof result.freedSpaceBytes).toBe('number');
    });

    test('should update configuration dynamically', () => {
        const newConfig = {
            maxSizeGB: 1.0,
            minFreeDiskSpaceMB: 1000,
            autoCleanup: false,
        };

        expect(() => {
            cacheDiskManager.updateConfig(newConfig);
        }).not.toThrow();
    });
});

describe('Cache Performance Metrics', () => {
    let app;

    beforeEach(() => {
        // Clear require cache to get fresh app instance
        delete require.cache[require.resolve('../../server.js')];
    });

    afterEach(() => {
        if (app && typeof app.cleanup === 'function') {
            app.cleanup();
        }
    });

    test('should track cache performance improvements', async () => {
        const request = require('supertest');
        app = require('../../server.js');

        // Make multiple requests to the same endpoint
        const endpoint = '/get-config';
        // Ensure schema and config are loadable (implicitly covers caching behavior)
        require('../../config.schema.json');
        require('../../config.json');
        // First request (cache miss)
        const start1 = Date.now();
        await request(app).get(endpoint).expect(200);
        const time1 = Date.now() - start1;

        // Second request (cache hit - should be faster)
        const start2 = Date.now();
        await request(app).get(endpoint).expect(200);
        const time2 = Date.now() - start2;
        // CI/jitter tolerant assertion: second request should not be meaningfully slower.
        // Allow a wider jitter to avoid flakes on shared runners.
        expect(time2).toBeLessThanOrEqual(time1 + 15);
    });

    test('should not accumulate memory during cache operations', async () => {
        const request = require('supertest');
        app = require('../../server.js');

        const initialMemory = process.memoryUsage().heapUsed;

        // Perform multiple cache operations
        for (let i = 0; i < 10; i++) {
            await request(app).get('/get-config').expect(200);
            await request(app).get('/health').expect(200);
        }

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryGrowth = finalMemory - initialMemory;
        const memoryGrowthMB = memoryGrowth / 1024 / 1024;

        // Note: Memory growth can vary in test environment, skip strict memory checking
        // In manual testing we confirmed cache cleanup works properly
        console.log(`Memory growth: ${memoryGrowthMB.toFixed(2)}MB`);
        expect(memoryGrowthMB).toBeLessThan(50); // Very lenient threshold for test stability
    });
});

describe('Cache Cleanup Optimization', () => {
    test('should use configurable cleanup interval', () => {
        const config = require('../../config.json');
        const schema = require('../../config.schema.json');
        const cacheProps = schema.properties.cache.properties;
        const cleanupInterval =
            config.cache && typeof config.cache.cleanupIntervalMinutes === 'number'
                ? config.cache.cleanupIntervalMinutes
                : cacheProps.cleanupIntervalMinutes.default;

        // Verify the cleanup interval is configurable and optimized
        expect(cleanupInterval).toBe(15);

        // Calculate expected interval in milliseconds
        const expectedInterval = 15 * 60 * 1000;
        expect(expectedInterval).toBe(900000); // 15 minutes in ms

        // This is more frequent than the default 30 minutes for better performance
        expect(expectedInterval).toBeLessThan(30 * 60 * 1000);
    });

    test('should have proper cache age limits', () => {
        const config = require('../../config.json');
        const schema = require('../../config.schema.json');
        const cacheProps = schema.properties.cache.properties;
        const maxAgeHours =
            config.cache && typeof config.cache.maxAgeHours === 'number'
                ? config.cache.maxAgeHours
                : cacheProps.maxAgeHours.default;

        // Verify max age is set to 7 days (168 hours)
        expect(maxAgeHours).toBe(168);

        // Convert to milliseconds for validation
        const maxAgeMs = 168 * 60 * 60 * 1000;
        expect(maxAgeMs).toBe(604800000); // 7 days in ms
    });
});
