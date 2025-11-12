/**
 * Tests for tiered caching functionality in utils/cache.js
 * Targets uncovered lines: 163-256 (tier management), 381-392 (tiered get), 406-409, 438-440, 463, 514-515
 */

const { CacheManager } = require('../../utils/cache');

describe('CacheManager - Tiered Caching', () => {
    let cache;

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        if (cache) {
            cache.stopPeriodicCleanup();
            cache.stopTierManagement();
        }
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    describe('Tier Management Initialization', () => {
        test('should start tier management when enableTiering is true', () => {
            cache = new CacheManager({
                enableTiering: true,
                l1MaxSize: 2,
                l2MaxSize: 3,
                l3MaxSize: 5,
            });

            expect(cache.tierInterval).toBeDefined();
            expect(cache.config.enableTiering).toBe(true);
        });

        test('should not start tier management when enableTiering is false', () => {
            cache = new CacheManager({ enableTiering: false });

            expect(cache.tierInterval).toBeUndefined();
        });

        test('should stop tier management', () => {
            cache = new CacheManager({ enableTiering: true });
            const interval = cache.tierInterval;

            cache.stopTierManagement();

            expect(cache.tierInterval).toBeNull();
            expect(interval).toBeDefined();
        });
    });

    describe('L1/L2/L3 Cache Tiers', () => {
        beforeEach(() => {
            cache = new CacheManager({
                enableTiering: true,
                l1MaxSize: 2, // Hot tier: 2 entries
                l2MaxSize: 3, // Warm tier: 3 entries
                l3MaxSize: 5, // Cold tier: 5 entries
                promotionThreshold: 3, // Promote after 3 accesses
                demotionAge: 1000, // Demote after 1 second
            });
        });

        test('should store entries in L1 by default', () => {
            cache.set('key1', 'value1');

            expect(cache.l1Cache.has('key1')).toBe(true);
            expect(cache.l1Cache.size).toBe(1);
        });

        test('should retrieve from L1 tier', () => {
            cache.set('hot-key', 'hot-value');

            const result = cache.get('hot-key');

            expect(result.value).toBe('hot-value');
            expect(cache.stats.l1Hits).toBe(1);
        });

        test('should retrieve from L2 tier', () => {
            // Manually place in L2
            const entry = {
                value: 'warm-value',
                createdAt: Date.now(),
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 1,
            };
            cache.l2Cache.set('warm-key', entry);

            const result = cache.get('warm-key');

            expect(result.value).toBe('warm-value');
            expect(cache.stats.l2Hits).toBe(1);
        });

        test('should retrieve from L3 tier', () => {
            // Manually place in L3
            const entry = {
                value: 'cold-value',
                createdAt: Date.now(),
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 0,
            };
            cache.l3Cache.set('cold-key', entry);

            const result = cache.get('cold-key');

            expect(result.value).toBe('cold-value');
            expect(cache.stats.l3Hits).toBe(1);
        });

        test('should promote L2 → L1 when access threshold is met', () => {
            // Place entry in L2 with high access count
            const entry = {
                value: 'promote-me',
                createdAt: Date.now(),
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 3, // Meets promotion threshold
            };
            cache.l2Cache.set('hot-entry', entry);

            cache.manageTiers();

            expect(cache.l1Cache.has('hot-entry')).toBe(true);
            expect(cache.l2Cache.has('hot-entry')).toBe(false);
            expect(cache.stats.promotions).toBeGreaterThan(0);
        });

        test('should promote L3 → L2 when access threshold is met', () => {
            // Place entry in L3 with sufficient access count
            const entry = {
                value: 'warming-up',
                createdAt: Date.now(),
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 3, // Meets promotion threshold
            };
            cache.l3Cache.set('warm-entry', entry);

            cache.manageTiers();

            expect(cache.l2Cache.has('warm-entry')).toBe(true);
            expect(cache.l3Cache.has('warm-entry')).toBe(false);
            expect(cache.stats.promotions).toBeGreaterThan(0);
        });

        describe('L1/L2/L3 Cache Tiers - Demotion (Real Timers)', () => {
            beforeEach(() => {
                jest.useRealTimers(); // Use real timers for demotion tests
                // Ensure clean cache for each test
                if (cache) {
                    cache.stopPeriodicCleanup();
                    cache.stopTierManagement();
                }
                cache = null;
            });

            afterEach(() => {
                if (cache) {
                    cache.stopPeriodicCleanup();
                    cache.stopTierManagement();
                }
            });

            test('should demote L1 → L2 when entry is old and rarely accessed', async () => {
                cache = new CacheManager({
                    enableTiering: true,
                    l1MaxSize: 2,
                    l2MaxSize: 3,
                    l3MaxSize: 5,
                    promotionThreshold: 3,
                    demotionAge: 50, // 50ms for faster test
                });

                // Place entry in L1 with low access count and moderately old timestamp
                // Use 60ms old to ensure it's demoted once but not twice in same manageTiers call
                const oldTimestamp = Date.now() - 60;
                const entry = {
                    value: 'cooling-down',
                    createdAt: oldTimestamp,
                    expiresAt: Date.now() + 10000,
                    lastAccessed: oldTimestamp,
                    accessCount: 1, // Below promotion threshold
                };
                cache.l1Cache.set('cold-entry', entry);

                cache.manageTiers();

                // Entry will be demoted from L1, should be in L2 or L3 (may cascade demote if very old)
                expect(cache.l1Cache.has('cold-entry')).toBe(false);
                const inL2 = cache.l2Cache.has('cold-entry');
                const inL3 = cache.l3Cache.has('cold-entry');
                expect(inL2 || inL3).toBe(true); // Should be in L2 or L3
                expect(cache.stats.demotions).toBeGreaterThan(0);
            });

            test('should demote L2 → L3 when entry is old and rarely accessed', async () => {
                cache = new CacheManager({
                    enableTiering: true,
                    l1MaxSize: 2,
                    l2MaxSize: 3,
                    l3MaxSize: 5,
                    promotionThreshold: 3,
                    demotionAge: 50, // 50ms
                });

                // Place entry in L2 with low access count and old timestamp
                const oldTimestamp = Date.now() - 100;
                const entry = {
                    value: 'going-cold',
                    createdAt: oldTimestamp,
                    expiresAt: Date.now() + 10000,
                    lastAccessed: oldTimestamp,
                    accessCount: 1, // Below promotion threshold
                };
                cache.l2Cache.set('very-cold-entry', entry);

                cache.manageTiers();

                expect(cache.l2Cache.has('very-cold-entry')).toBe(false);
                expect(cache.l3Cache.has('very-cold-entry')).toBe(true);
                expect(cache.stats.demotions).toBeGreaterThan(0);
            });

            test('should reset access count on demotion', async () => {
                cache = new CacheManager({
                    enableTiering: true,
                    l1MaxSize: 2,
                    l2MaxSize: 3,
                    l3MaxSize: 5,
                    promotionThreshold: 3,
                    demotionAge: 50, // 50ms for faster test
                });

                const oldTimestamp = Date.now() - 60;
                const entry = {
                    value: 'reset-test',
                    createdAt: oldTimestamp,
                    expiresAt: Date.now() + 10000,
                    lastAccessed: oldTimestamp,
                    accessCount: 2, // Will be reset on demotion
                };
                cache.l1Cache.set('reset-entry', entry);

                cache.manageTiers();

                // Entry should be demoted to L2 or L3 with reset access count
                const inL2 = cache.l2Cache.has('reset-entry');
                const inL3 = cache.l3Cache.has('reset-entry');
                expect(inL2 || inL3).toBe(true);

                const demotedEntry = inL2
                    ? cache.l2Cache.get('reset-entry')
                    : cache.l3Cache.get('reset-entry');
                expect(demotedEntry.accessCount).toBe(0);
            });
        });

        test('should not promote if target tier is full', () => {
            // Fill L1 to capacity
            cache.l1Cache.set('l1-1', {
                value: 'v1',
                accessCount: 5,
                expiresAt: Date.now() + 10000,
            });
            cache.l1Cache.set('l1-2', {
                value: 'v2',
                accessCount: 5,
                expiresAt: Date.now() + 10000,
            });

            // Add entry to L2 that should be promoted
            const entry = {
                value: 'blocked-promotion',
                createdAt: Date.now(),
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 5, // High enough to promote
            };
            cache.l2Cache.set('blocked-entry', entry);

            cache.manageTiers();

            // Should not promote because L1 is full
            expect(cache.l2Cache.has('blocked-entry')).toBe(true);
            expect(cache.l1Cache.has('blocked-entry')).toBe(false);
        });

        test('should not demote if target tier is full', () => {
            // Fill L2 to capacity
            cache.l2Cache.set('l2-1', {
                value: 'v1',
                accessCount: 0,
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
            });
            cache.l2Cache.set('l2-2', {
                value: 'v2',
                accessCount: 0,
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
            });
            cache.l2Cache.set('l2-3', {
                value: 'v3',
                accessCount: 0,
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
            });

            // Add old entry to L1 that should be demoted
            const oldTime = Date.now() - 2000;
            const entry = {
                value: 'blocked-demotion',
                createdAt: oldTime,
                expiresAt: Date.now() + 10000,
                lastAccessed: oldTime,
                accessCount: 0,
            };
            cache.l1Cache.set('blocked-entry', entry);

            cache.manageTiers();

            // Should not demote because L2 is full
            expect(cache.l1Cache.has('blocked-entry')).toBe(true);
            expect(cache.l2Cache.has('blocked-entry')).toBe(false);
        });

        test('should not manage tiers if tiering is disabled', () => {
            cache = new CacheManager({ enableTiering: false });
            cache.l1Cache.set('test', { value: 'value', accessCount: 10 });

            const beforePromotions = cache.stats.promotions;
            const beforeDemotions = cache.stats.demotions;

            cache.manageTiers();

            expect(cache.stats.promotions).toBe(beforePromotions);
            expect(cache.stats.demotions).toBe(beforeDemotions);
        });
    });

    describe('Tier Statistics', () => {
        beforeEach(() => {
            cache = new CacheManager({
                enableTiering: true,
                l1MaxSize: 5,
                l2MaxSize: 5,
                l3MaxSize: 5,
            });
        });

        test('should track L1 hits', () => {
            cache.set('l1-key', 'value');
            cache.get('l1-key');

            expect(cache.stats.l1Hits).toBe(1);
        });

        test('should track L2 hits', () => {
            cache.l2Cache.set('l2-key', {
                value: 'value',
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 0,
                createdAt: Date.now(),
            });
            cache.get('l2-key');

            expect(cache.stats.l2Hits).toBe(1);
        });

        test('should track L3 hits', () => {
            cache.l3Cache.set('l3-key', {
                value: 'value',
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 0,
                createdAt: Date.now(),
            });
            cache.get('l3-key');

            expect(cache.stats.l3Hits).toBe(1);
        });

        test('should include tier stats in getStats()', () => {
            cache.set('test', 'value');
            cache.get('test');

            const stats = cache.getStats();

            // Tier stats are nested in 'tiering' property
            expect(stats).toHaveProperty('tiering');
            expect(stats.tiering).toHaveProperty('l1Hits');
            expect(stats.tiering).toHaveProperty('l2Hits');
            expect(stats.tiering).toHaveProperty('l3Hits');
            expect(stats.tiering).toHaveProperty('promotions');
            expect(stats.tiering).toHaveProperty('demotions');
        });
    });

    describe('Tier Management with Periodic Execution', () => {
        test('should run manageTiers periodically', () => {
            cache = new CacheManager({
                enableTiering: true,
                promotionThreshold: 2,
            });

            const manageTiersSpy = jest.spyOn(cache, 'manageTiers');

            // Fast-forward 2 minutes
            jest.advanceTimersByTime(2 * 60 * 1000);

            expect(manageTiersSpy).toHaveBeenCalled();
        });
    });

    describe('has() with Tiered Caching', () => {
        beforeEach(() => {
            cache = new CacheManager({
                enableTiering: true,
                l1MaxSize: 2,
                l2MaxSize: 2,
                l3MaxSize: 2,
            });
        });

        test('should check L1 cache when tiering enabled', () => {
            cache.l1Cache.set('l1-key', {
                value: 'value',
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 0,
                createdAt: Date.now(),
            });

            expect(cache.has('l1-key')).toBe(true);
        });

        test('should check L2 cache when tiering enabled', () => {
            cache.l2Cache.set('l2-key', {
                value: 'value',
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 0,
                createdAt: Date.now(),
            });

            expect(cache.has('l2-key')).toBe(true);
        });

        test('should check L3 cache when tiering enabled', () => {
            cache.l3Cache.set('l3-key', {
                value: 'value',
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 0,
                createdAt: Date.now(),
            });

            expect(cache.has('l3-key')).toBe(true);
        });

        test('should return false for non-existent key in all tiers', () => {
            expect(cache.has('non-existent')).toBe(false);
        });
    });

    describe('delete() with Tiered Caching', () => {
        beforeEach(() => {
            cache = new CacheManager({
                enableTiering: true,
                l1MaxSize: 2,
                l2MaxSize: 2,
                l3MaxSize: 2,
            });
        });

        test('should delete from L1', () => {
            cache.l1Cache.set('l1-key', {
                value: 'value',
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 0,
                createdAt: Date.now(),
            });

            const result = cache.delete('l1-key');

            expect(result).toBe(true);
            expect(cache.l1Cache.has('l1-key')).toBe(false);
        });

        test('should delete from L2', () => {
            cache.l2Cache.set('l2-key', {
                value: 'value',
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 0,
                createdAt: Date.now(),
            });

            const result = cache.delete('l2-key');

            expect(result).toBe(true);
            expect(cache.l2Cache.has('l2-key')).toBe(false);
        });

        test('should delete from L3', () => {
            cache.l3Cache.set('l3-key', {
                value: 'value',
                expiresAt: Date.now() + 10000,
                lastAccessed: Date.now(),
                accessCount: 0,
                createdAt: Date.now(),
            });

            const result = cache.delete('l3-key');

            expect(result).toBe(true);
            expect(cache.l3Cache.has('l3-key')).toBe(false);
        });

        test('should return false for non-existent key', () => {
            const result = cache.delete('non-existent');

            expect(result).toBe(false);
        });
    });

    describe('clear() with Tiered Caching', () => {
        beforeEach(() => {
            cache = new CacheManager({
                enableTiering: true,
                l1MaxSize: 5,
                l2MaxSize: 5,
                l3MaxSize: 5,
            });
        });

        test('should clear entries by type prefix', () => {
            cache.set('media:key1', 'value1');
            cache.set('config:key2', 'value2');

            const cleared = cache.clear('media');

            expect(cleared).toBeGreaterThanOrEqual(1);
            expect(cache.has('media:key1')).toBe(false);
            expect(cache.has('config:key2')).toBe(true);
        });

        test('should clear all caches when type=null (only L1 in legacy mode)', () => {
            // In tiering mode, clear() only affects L1 (the "cache" reference)
            cache.set('key1', 'v1'); // Goes to L1
            const initialSize = cache.cache.size;

            const cleared = cache.clear();

            expect(cleared).toBe(initialSize);
            expect(cache.cache.size).toBe(0);
        });

        test('should handle clear with no matching entries', () => {
            cache.set('media:key1', 'value1');

            const cleared = cache.clear('config');

            expect(cleared).toBe(0);
        });
    });
});
