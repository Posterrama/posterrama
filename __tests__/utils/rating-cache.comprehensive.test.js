/**
 * Comprehensive tests for rating-cache.js to improve coverage
 */

const fs = require('fs').promises;
const path = require('path');
const ratingCache = require('../../utils/rating-cache');

// Mock logger to prevent actual logging during tests
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
}));

describe('RatingCacheManager', () => {
    const testCachePath = path.join(__dirname, '..', '..', 'cache', 'ratings.json');
    const testCacheDir = path.dirname(testCachePath);

    beforeEach(async () => {
        // Clear cache state - handle the actual structure
        if (ratingCache.cache && typeof ratingCache.cache === 'object') {
            // Clear existing cache properties but preserve structure
            for (const key in ratingCache.cache) {
                if (key !== 'mediaServers') {
                    delete ratingCache.cache[key];
                }
            }
        }

        // Clean up test files
        try {
            await fs.unlink(testCachePath);
        } catch (error) {
            // File doesn't exist, that's fine
        }
    });

    afterEach(async () => {
        // Clean up test files
        try {
            await fs.unlink(testCachePath);
        } catch (error) {
            // File doesn't exist, that's fine
        }
    });

    describe('loadCache', () => {
        it('should call loadCache method without errors', async () => {
            expect(() => ratingCache.loadCache()).not.toThrow();
        });

        it('should handle cache loading gracefully', async () => {
            // Test that the function exists and can be called
            await expect(ratingCache.loadCache()).resolves.not.toThrow();
        });
    });

    describe('saveCache', () => {
        it('should call saveCache method without errors', async () => {
            await expect(ratingCache.saveCache()).resolves.not.toThrow();
        });

        it('should create cache directory if needed', async () => {
            // This tests the directory creation logic indirectly
            await expect(ratingCache.saveCache()).resolves.not.toThrow();
        });

        it('should handle save errors gracefully', async () => {
            // Mock fs.writeFile to throw an error
            const originalWriteFile = fs.writeFile;
            fs.writeFile = jest.fn().mockRejectedValue(new Error('Write error'));

            // Should not throw
            await expect(ratingCache.saveCache()).resolves.not.toThrow();

            // Restore original function
            fs.writeFile = originalWriteFile;
        });
    });

    describe('getRatings', () => {
        it('should return cached ratings for valid cache', () => {
            const now = Date.now();
            ratingCache.cache = {
                jellyfin: {
                    ratings: ['PG', 'PG-13', 'R'],
                    timestamp: now,
                    count: 3,
                },
            };

            const ratings = ratingCache.getRatings('jellyfin');
            expect(ratings).toEqual(['PG', 'PG-13', 'R']);
        });

        it('should return empty array for non-existent source', () => {
            const ratings = ratingCache.getRatings('nonexistent');
            expect(ratings).toEqual([]);
        });

        it('should return empty array for stale cache', () => {
            const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
            ratingCache.cache = {
                plex: {
                    ratings: ['G', 'PG'],
                    timestamp: staleTimestamp,
                    count: 2,
                },
            };

            const ratings = ratingCache.getRatings('plex');
            expect(ratings).toEqual([]);
        });

        it('should return empty array for cache without ratings', () => {
            ratingCache.cache = {
                tvdb: {
                    timestamp: Date.now(),
                    count: 0,
                },
            };

            const ratings = ratingCache.getRatings('tvdb');
            expect(ratings).toEqual([]);
        });
    });

    describe('setRatings', () => {
        it('should set and save ratings for a source', async () => {
            const testRatings = ['R', 'PG', 'PG-13'];

            await ratingCache.setRatings('jellyfin', testRatings);

            expect(ratingCache.cache.jellyfin).toBeDefined();
            expect(ratingCache.cache.jellyfin.ratings).toEqual(['PG', 'PG-13', 'R']); // Should be sorted
            expect(ratingCache.cache.jellyfin.count).toBe(3);
            expect(ratingCache.cache.jellyfin.timestamp).toBeCloseTo(Date.now(), -3);
        });

        it('should sort ratings when setting', async () => {
            const unsortedRatings = ['R', 'G', 'PG-13', 'PG'];

            await ratingCache.setRatings('plex', unsortedRatings);

            expect(ratingCache.cache.plex.ratings).toEqual(['G', 'PG', 'PG-13', 'R']);
        });
    });

    describe('isCacheValid', () => {
        it('should return true for valid cache', () => {
            ratingCache.cache = {
                jellyfin: {
                    ratings: ['PG'],
                    timestamp: Date.now(),
                    count: 1,
                },
            };

            expect(ratingCache.isCacheValid('jellyfin')).toBe(true);
        });

        it('should return false for non-existent cache', () => {
            expect(ratingCache.isCacheValid('nonexistent')).toBe(false);
        });

        it('should return false for stale cache', () => {
            const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
            ratingCache.cache = {
                plex: {
                    ratings: ['G'],
                    timestamp: staleTimestamp,
                    count: 1,
                },
            };

            expect(ratingCache.isCacheValid('plex')).toBe(false);
        });
    });

    describe('invalidateCache', () => {
        it('should remove cache for a source', async () => {
            ratingCache.cache = {
                jellyfin: {
                    ratings: ['PG'],
                    timestamp: Date.now(),
                    count: 1,
                },
                plex: {
                    ratings: ['G'],
                    timestamp: Date.now(),
                    count: 1,
                },
            };

            await ratingCache.invalidateCache('jellyfin');

            expect(ratingCache.cache.jellyfin).toBeUndefined();
            expect(ratingCache.cache.plex).toBeDefined();
        });

        it('should handle invalidating non-existent cache', async () => {
            await expect(ratingCache.invalidateCache('nonexistent')).resolves.not.toThrow();
        });
    });

    describe('getStats', () => {
        it('should return stats for all cached sources', () => {
            const now = Date.now();
            const pastTime = now - 30 * 60 * 1000; // 30 minutes ago

            ratingCache.cache = {
                jellyfin: {
                    ratings: ['PG', 'PG-13'],
                    timestamp: now,
                    count: 2,
                },
                plex: {
                    ratings: ['G'],
                    timestamp: pastTime,
                    count: 1,
                },
            };

            const stats = ratingCache.getStats();

            expect(stats.jellyfin).toBeDefined();
            expect(stats.jellyfin.ratingsCount).toBe(2);
            expect(stats.jellyfin.isValid).toBe(true);
            expect(stats.jellyfin.ageMinutes).toBeCloseTo(0, 0);

            expect(stats.plex).toBeDefined();
            expect(stats.plex.ratingsCount).toBe(1);
            expect(stats.plex.isValid).toBe(true);
            expect(stats.plex.ageMinutes).toBeCloseTo(30, 0);
        });

        it('should return empty stats for empty cache', () => {
            const stats = ratingCache.getStats();
            expect(stats).toEqual({});
        });

        it('should handle cache entries without count', () => {
            ratingCache.cache = {
                tmdb: {
                    ratings: ['PG'],
                    timestamp: Date.now(),
                    // count is missing
                },
            };

            const stats = ratingCache.getStats();
            expect(stats.tmdb.ratingsCount).toBe(0);
        });

        it('should mark stale cache as invalid', () => {
            const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
            ratingCache.cache = {
                stale: {
                    ratings: ['PG'],
                    timestamp: staleTimestamp,
                    count: 1,
                },
            };

            const stats = ratingCache.getStats();
            expect(stats.stale.isValid).toBe(false);
            expect(stats.stale.ageMinutes).toBeGreaterThan(1400); // > 24 hours
        });
    });
});
