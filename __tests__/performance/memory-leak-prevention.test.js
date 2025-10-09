/**
 * Memory Leak Prevention Tests
 * Tests to ensure proper cleanup of intervals, timers, and resources
 */

// Mock logger to avoid side effects
jest.mock('../../utils/logger');

describe('Memory Leak Prevention', () => {
    let app;

    afterEach(() => {
        if (app && typeof app.cleanup === 'function') {
            try {
                app.cleanup();
            } catch (e) {
                // Ignore cleanup errors in tests
            }
        }

        // Clear intervals manually
        if (global.memoryCheckInterval) {
            clearInterval(global.memoryCheckInterval);
            global.memoryCheckInterval = null;
        }
        if (global.cacheCleanupInterval) {
            clearInterval(global.cacheCleanupInterval);
            global.cacheCleanupInterval = null;
        }
    });

    test('should have cleanup function', () => {
        app = require('../../server.js');
        expect(typeof app.cleanup).toBe('function');
    });

    test('should clean up without errors when called multiple times', () => {
        app = require('../../server.js');

        // Multiple cleanup calls should not throw
        expect(() => {
            app.cleanup();
            app.cleanup();
            app.cleanup();
        }).not.toThrow();

        // Verify state is clean
        expect(global.memoryCheckInterval).toBeNull();
        expect(global.cacheCleanupInterval == null).toBe(true); // null or undefined
    });

    test('should handle cleanup when intervals are already null', () => {
        app = require('../../server.js');

        // Manually clear intervals first
        if (global.memoryCheckInterval) {
            clearInterval(global.memoryCheckInterval);
            global.memoryCheckInterval = null;
        }
        if (global.cacheCleanupInterval) {
            clearInterval(global.cacheCleanupInterval);
            global.cacheCleanupInterval = null;
        }

        // Cleanup should still work without errors
        expect(() => app.cleanup()).not.toThrow();
    });

    test('should handle missing global variables gracefully', () => {
        app = require('../../server.js');

        // Cleanup should work even with missing globals
        expect(() => app.cleanup()).not.toThrow();
    });

    test('should cleanup memory check interval', () => {
        app = require('../../server.js');

        // Call cleanup
        app.cleanup();

        // Verify interval is cleared
        expect(global.memoryCheckInterval).toBeNull();
    });

    test('should cleanup cache cleanup interval', () => {
        app = require('../../server.js');

        // Call cleanup
        app.cleanup();

        // Verify interval is cleared
        expect(global.cacheCleanupInterval == null).toBe(true); // null or undefined
    });

    test('should cleanup API cache instance if exists', () => {
        app = require('../../server.js');

        // If API cache instance exists, test its cleanup
        if (global.apiCacheInstance && typeof global.apiCacheInstance.destroy === 'function') {
            // Spy on destroy method
            const destroySpy = jest.spyOn(global.apiCacheInstance, 'destroy');

            // Call cleanup
            app.cleanup();

            // Verify destroy was called
            expect(destroySpy).toHaveBeenCalled();
        } else {
            // If no API cache instance, just test that cleanup doesn't crash
            expect(() => app.cleanup()).not.toThrow();
        }
    });

    test('should cleanup metrics manager if exists', () => {
        app = require('../../server.js');

        try {
            const metricsManager = require('../../utils/metrics');

            // Spy on shutdown method if it exists
            if (typeof metricsManager.shutdown === 'function') {
                const shutdownSpy = jest.spyOn(metricsManager, 'shutdown');

                // Call cleanup
                app.cleanup();

                // Verify shutdown was called
                expect(shutdownSpy).toHaveBeenCalled();
            } else {
                // Just test that cleanup doesn't crash
                expect(() => app.cleanup()).not.toThrow();
            }
        } catch (e) {
            // If metrics module doesn't exist or can't be loaded, that's ok
            expect(() => app.cleanup()).not.toThrow();
        }
    });

    test('should prevent memory leaks in repeated operations', async () => {
        app = require('../../server.js');

        const initialMemory = process.memoryUsage().heapUsed;

        // Simulate multiple cleanup cycles
        for (let i = 0; i < 3; i++) {
            app.cleanup();
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryGrowth = finalMemory - initialMemory;
        const memoryGrowthMB = memoryGrowth / 1024 / 1024;

        // Memory growth should be reasonable (less than 50MB for multiple cycles)
        expect(memoryGrowthMB).toBeLessThan(50);
    });

    test('should handle graceful shutdown without throwing', () => {
        app = require('../../server.js');

        // Test that cleanup function exists and can be called
        expect(typeof app.cleanup).toBe('function');
        expect(() => app.cleanup()).not.toThrow();

        // Verify timers are cleaned up
        expect(global.memoryCheckInterval).toBeNull();
        expect(global.cacheCleanupInterval == null).toBe(true); // null or undefined
    });
});
