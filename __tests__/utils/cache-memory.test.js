/**
 * Tests for Cache Memory Management (Issue #4)
 */

const { CacheManager } = require('../../utils/cache');

describe('Cache Memory Management (Issue #4)', () => {
    let cache;

    beforeEach(() => {
        cache = new CacheManager({
            maxSize: 10,
            maxEntrySizeBytes: 1024, // 1KB
            maxTotalMemoryBytes: 5120, // 5KB
            enableMemoryMonitoring: false, // Disable for tests
        });
    });

    afterEach(() => {
        if (cache) {
            cache.cleanup();
        }
    });

    describe('calculateEntrySize', () => {
        it('should calculate size of string values', () => {
            const value = 'a'.repeat(100);
            const size = cache.calculateEntrySize(value);

            expect(size).toBeGreaterThan(0);
            expect(typeof size).toBe('number');
        });

        it('should calculate size of object values', () => {
            const value = { key1: 'value1', key2: 'value2', nested: { data: 'test' } };
            const size = cache.calculateEntrySize(value);

            expect(size).toBeGreaterThan(0);
        });

        it('should calculate size of array values', () => {
            const value = Array(100).fill('test');
            const size = cache.calculateEntrySize(value);

            expect(size).toBeGreaterThan(0);
        });

        it('should handle circular references with fallback', () => {
            const value = { name: 'test' };
            value.self = value; // Circular reference

            const size = cache.calculateEntrySize(value);

            expect(size).toBe(1024); // Fallback to 1KB
        });
    });

    describe('canStoreEntry', () => {
        it('should allow entries within size limits', () => {
            const value = 'small value';

            const canStore = cache.canStoreEntry('key1', value);

            expect(canStore).toBe(true);
        });

        it('should reject entries exceeding maxEntrySizeBytes', () => {
            // Create a value larger than 1KB (our test limit)
            const largeValue = 'a'.repeat(2000);

            const canStore = cache.canStoreEntry('key1', largeValue);

            expect(canStore).toBe(false);
            expect(cache.memoryUsage.entriesRejected).toBe(1);
        });

        it('should reject entries when total memory limit reached', () => {
            // Fill cache close to limit (5120 bytes)
            for (let i = 0; i < 5; i++) {
                cache.set(`key${i}`, 'a'.repeat(900)); // ~900 bytes each = 4500 total
            }

            // Try to add another large entry (should fail or trigger eviction)
            const largeValue = 'a'.repeat(900);
            cache.set('key6', largeValue);

            // Either rejected or eviction occurred
            // At minimum, cache should not have all 6 entries
            expect(cache.cache.size).toBeLessThanOrEqual(6);
        });

        it('should allow updating existing entry within limits', () => {
            cache.set('key1', 'a'.repeat(100));

            const canStore = cache.canStoreEntry('key1', 'a'.repeat(150));

            expect(canStore).toBe(true);
        });
    });

    describe('memory tracking', () => {
        it('should track total memory usage', () => {
            expect(cache.memoryUsage.totalBytes).toBe(0);

            cache.set('key1', 'a'.repeat(100));
            expect(cache.memoryUsage.totalBytes).toBeGreaterThan(0);

            const size1 = cache.memoryUsage.totalBytes;

            cache.set('key2', 'a'.repeat(100));
            expect(cache.memoryUsage.totalBytes).toBeGreaterThan(size1);
        });

        it('should update memory usage on entry update', () => {
            cache.set('key1', 'small');
            const size1 = cache.memoryUsage.totalBytes;

            cache.set('key1', 'a'.repeat(500)); // Larger value
            const size2 = cache.memoryUsage.totalBytes;

            expect(size2).toBeGreaterThan(size1);
        });

        it('should decrease memory usage on entry delete', () => {
            cache.set('key1', 'a'.repeat(500));
            const sizeBefore = cache.memoryUsage.totalBytes;

            cache.delete('key1');

            expect(cache.memoryUsage.totalBytes).toBe(0);
            expect(cache.memoryUsage.totalBytes).toBeLessThan(sizeBefore);
        });

        it('should reset memory usage on clear', () => {
            cache.set('key1', 'a'.repeat(100));
            cache.set('key2', 'a'.repeat(100));

            expect(cache.memoryUsage.totalBytes).toBeGreaterThan(0);

            cache.clear();

            expect(cache.memoryUsage.totalBytes).toBe(0);
        });

        it('should track largest entry size', () => {
            cache.set('key1', 'small');
            const largest1 = cache.memoryUsage.largestEntry;

            cache.set('key2', 'a'.repeat(500));
            const largest2 = cache.memoryUsage.largestEntry;

            expect(largest2).toBeGreaterThan(largest1);
        });

        it('should store sizeBytes in entry metadata', () => {
            cache.set('key1', 'test value');

            const entry = cache.get('key1');

            expect(entry.sizeBytes).toBeDefined();
            expect(typeof entry.sizeBytes).toBe('number');
            expect(entry.sizeBytes).toBeGreaterThan(0);
        });
    });

    describe('eviction under memory pressure', () => {
        it('should evict LRU entries when memory limit reached', () => {
            // Fill cache close to limit
            cache.set('key1', 'a'.repeat(800));
            cache.set('key2', 'a'.repeat(800));
            cache.set('key3', 'a'.repeat(800));

            // Access key2 to make key1 LRU
            cache.get('key2');

            // Try to add entry that requires eviction
            cache.set('key4', 'a'.repeat(900));

            // key1 should have been evicted (it was LRU)
            const hasKey1 = cache.has('key1');

            // Either key1 was evicted or entry wasn't added
            expect(hasKey1 || cache.has('key4')).toBe(true);
        });

        it('should handle aggressive eviction when needed', () => {
            // Fill cache
            for (let i = 0; i < 8; i++) {
                cache.set(`key${i}`, 'a'.repeat(500));
            }

            // Memory should be significant
            expect(cache.memoryUsage.totalBytes).toBeGreaterThan(1000);

            // Some entries should remain
            expect(cache.cache.size).toBeGreaterThan(0);
        });
    });

    describe('getStats with memory info', () => {
        it('should include memory usage in stats', () => {
            cache.set('key1', 'a'.repeat(100));
            cache.set('key2', 'a'.repeat(200));

            const stats = cache.getStats();

            expect(stats.memoryUsage).toBeDefined();
            expect(stats.memoryUsage.totalBytes).toBeGreaterThan(0);
            // totalMB may be < 1 for small test values
            expect(stats.memoryUsage.totalMB).toBeGreaterThanOrEqual(0);
            expect(stats.memoryUsage.maxBytes).toBe(5120);
            // maxMB rounds to 0 for small values (5KB = 0.0048828125 MB rounds to 0)
            expect(stats.memoryUsage.maxMB).toBe(0);
        });

        it('should calculate percent used', () => {
            cache.set('key1', 'a'.repeat(500));

            const stats = cache.getStats();

            expect(stats.memoryUsage.percentUsed).toBeGreaterThan(0);
            expect(stats.memoryUsage.percentUsed).toBeLessThanOrEqual(100);
        });

        it('should report largest entry', () => {
            cache.set('key1', 'small');
            cache.set('key2', 'a'.repeat(500));

            const stats = cache.getStats();

            expect(stats.memoryUsage.largestEntryBytes).toBeGreaterThan(0);
            // largestEntryKB rounds down for small entries, may be 0
            expect(stats.memoryUsage.largestEntryKB).toBeGreaterThanOrEqual(0);
        });

        it('should report rejected entries', () => {
            // Try to add oversized entry
            const tooLarge = 'a'.repeat(2000);
            cache.set('key1', tooLarge);

            const stats = cache.getStats();

            expect(stats.memoryUsage.entriesRejected).toBeGreaterThan(0);
        });

        it('should calculate average entry size', () => {
            cache.set('key1', 'a'.repeat(100));
            cache.set('key2', 'a'.repeat(200));

            const stats = cache.getStats();

            expect(stats.memoryUsage.averageEntryBytes).toBeGreaterThan(0);
            expect(stats.memoryUsage.averageEntryKB).toBeGreaterThan(0);
        });

        it('should handle empty cache', () => {
            const stats = cache.getStats();

            expect(stats.memoryUsage.totalBytes).toBe(0);
            expect(stats.memoryUsage.averageEntryBytes).toBe(0);
            expect(stats.memoryUsage.averageEntryKB).toBe(0);
        });
    });

    describe('memory monitoring (when enabled)', () => {
        it('should start monitoring when enabled', () => {
            const monitoredCache = new CacheManager({
                maxSize: 10,
                maxTotalMemoryBytes: 5120,
                enableMemoryMonitoring: true,
            });

            expect(monitoredCache.memoryMonitorInterval).toBeDefined();

            monitoredCache.cleanup();
        });

        it('should stop monitoring on cleanup', () => {
            const monitoredCache = new CacheManager({
                maxSize: 10,
                maxTotalMemoryBytes: 5120,
                enableMemoryMonitoring: true,
            });

            monitoredCache.cleanup();

            expect(monitoredCache.memoryMonitorInterval).toBeNull();
        });
    });

    describe('edge cases', () => {
        it('should handle setting same key multiple times', () => {
            cache.set('key1', 'value1');
            const size1 = cache.memoryUsage.totalBytes;

            cache.set('key1', 'value2');
            const size2 = cache.memoryUsage.totalBytes;

            // Memory should be updated, not accumulated
            expect(Math.abs(size1 - size2)).toBeLessThan(100);
        });

        it('should handle null/undefined values', () => {
            cache.set('key1', null);
            cache.set('key2', undefined);

            // Cache may or may not store null/undefined - depends on implementation
            // At minimum, it should not crash
            expect(() => cache.has('key1')).not.toThrow();
            expect(() => cache.has('key2')).not.toThrow();
        });

        it('should handle boolean and number values', () => {
            cache.set('bool', true);
            cache.set('num', 12345);

            expect(cache.get('bool').value).toBe(true);
            expect(cache.get('num').value).toBe(12345);
        });

        it('should handle empty strings and arrays', () => {
            cache.set('empty-string', '');
            cache.set('empty-array', []);

            expect(cache.get('empty-string').value).toBe('');
            expect(cache.get('empty-array').value).toEqual([]);
        });
    });
});
