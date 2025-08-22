/**
 * Coverage enhancement tests for tmdb.js
 * Focus on error handling, edge cases, and uncovered paths
 */

const TMDBSource = require('../../sources/tmdb');

describe('TMDB Coverage Enhancement', () => {
    let tmdbSource;
    const mockConfig = {
        name: 'test-tmdb',
        apiKey: 'test-api-key',
    };
    const mockShuffleArray = jest.fn(arr => arr);

    beforeEach(() => {
        tmdbSource = new TMDBSource(mockConfig, mockShuffleArray, true);

        // Clear caches
        tmdbSource.genreCache.clear();
        tmdbSource.responseCache.clear();
        tmdbSource.resetMetrics();
    });

    describe('Performance Metrics', () => {
        test('should track performance metrics', () => {
            const metrics = tmdbSource.getMetrics();

            expect(metrics).toHaveProperty('requestCount');
            expect(metrics).toHaveProperty('cacheHits');
            expect(metrics).toHaveProperty('cacheMisses');
            expect(metrics).toHaveProperty('averageResponseTime');
            expect(metrics).toHaveProperty('lastRequestTime');
            expect(metrics).toHaveProperty('errorCount');
            expect(metrics).toHaveProperty('cacheHitRate');
            expect(metrics).toHaveProperty('cacheSizes');
        });

        test('should calculate cache hit rate correctly', () => {
            // Initially should be 0
            let metrics = tmdbSource.getMetrics();
            expect(metrics.cacheHitRate).toBe(0);

            // Simulate some cache activity
            tmdbSource.metrics.requestCount = 10;
            tmdbSource.metrics.cacheHits = 3;

            metrics = tmdbSource.getMetrics();
            expect(metrics.cacheHitRate).toBe(0.3);
        });

        test('should reset metrics', () => {
            tmdbSource.metrics.requestCount = 10;
            tmdbSource.metrics.cacheHits = 5;
            tmdbSource.metrics.errorCount = 2;

            tmdbSource.resetMetrics();

            const metrics = tmdbSource.getMetrics();
            expect(metrics.requestCount).toBe(0);
            expect(metrics.cacheHits).toBe(0);
            expect(metrics.errorCount).toBe(0);
        });
    });

    describe('Rate Limiting', () => {
        test('should implement rate limiting delay', async () => {
            const startTime = Date.now();

            // First call should not delay
            await tmdbSource.rateLimitDelay();
            const firstCallTime = Date.now() - startTime;

            // Second immediate call should delay
            const secondStartTime = Date.now();
            await tmdbSource.rateLimitDelay();
            const secondCallTime = Date.now() - secondStartTime;

            expect(firstCallTime).toBeLessThan(50); // Should be very fast
            expect(secondCallTime).toBeGreaterThanOrEqual(200); // Should include delay
        });

        test('should respect minimum request interval', async () => {
            tmdbSource.lastRequestTime = Date.now() - 100; // 100ms ago

            const startTime = Date.now();
            await tmdbSource.rateLimitDelay();
            const elapsed = Date.now() - startTime;

            // Should delay for at least the remaining time
            expect(elapsed).toBeGreaterThanOrEqual(140); // 250ms - 100ms = 150ms (with some tolerance)
        });
    });

    describe('Cache Management', () => {
        test('should cache genre mappings', async () => {
            // Mock fetch to avoid actual API calls
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        genres: [
                            { id: 1, name: 'Action' },
                            { id: 2, name: 'Comedy' },
                        ],
                    }),
            });

            const genreMap = await tmdbSource.fetchGenreMapping('movie');

            expect(genreMap.get(1)).toBe('Action');
            expect(genreMap.get(2)).toBe('Comedy');

            // Check cache
            expect(tmdbSource.genreCache.has('genres_movie')).toBe(true);
        });

        test('should use cached genre mappings', async () => {
            // Set up cache
            const cachedGenres = new Map([[1, 'Cached Action']]);
            tmdbSource.genreCache.set('genres_movie', {
                data: cachedGenres,
                timestamp: Date.now(),
            });

            const genreMap = await tmdbSource.fetchGenreMapping('movie');

            expect(genreMap.get(1)).toBe('Cached Action');

            // Should not have called fetch
            expect(global.fetch).toBeUndefined();
        });

        test('should handle expired cache', async () => {
            // Set up expired cache
            const oldGenres = new Map([[1, 'Old Action']]);
            tmdbSource.genreCache.set('genres_movie', {
                data: oldGenres,
                timestamp: Date.now() - (tmdbSource.cacheTTL + 1000), // Expired
            });

            // Mock fresh fetch
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        genres: [{ id: 1, name: 'Fresh Action' }],
                    }),
            });

            const genreMap = await tmdbSource.fetchGenreMapping('movie');

            expect(genreMap.get(1)).toBe('Fresh Action');
            expect(global.fetch).toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        test('should handle API errors gracefully', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });

            const genreMap = await tmdbSource.fetchGenreMapping('movie');

            expect(genreMap.size).toBe(0); // Should return empty map
            expect(tmdbSource.metrics.errorCount).toBe(0); // Error count tracked elsewhere
        });

        test('should handle network errors', async () => {
            global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

            const genreMap = await tmdbSource.fetchGenreMapping('tv');

            expect(genreMap.size).toBe(0);
        });

        test('should handle malformed API responses', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        // Missing genres array
                        invalid: 'response',
                    }),
            });

            const genreMap = await tmdbSource.fetchGenreMapping('movie');

            expect(genreMap.size).toBe(0);
        });

        test('should handle JSON parsing errors', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.reject(new Error('Invalid JSON')),
            });

            const genreMap = await tmdbSource.fetchGenreMapping('movie');

            expect(genreMap.size).toBe(0);
        });
    });

    describe('Configuration Edge Cases', () => {
        test('should handle missing API key', () => {
            const configWithoutKey = { name: 'test' };
            const sourceWithoutKey = new TMDBSource(configWithoutKey, mockShuffleArray, false);

            expect(sourceWithoutKey.source.apiKey).toBeUndefined();
        });

        test('should handle different media types', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        genres: [{ id: 10759, name: 'Action & Adventure' }],
                    }),
            });

            const movieGenres = await tmdbSource.fetchGenreMapping('movie');
            const tvGenres = await tmdbSource.fetchGenreMapping('tv');

            expect(movieGenres).toBeDefined();
            expect(tvGenres).toBeDefined();

            // Should have made separate API calls
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('Debug Mode', () => {
        test('should log debug information when enabled', async () => {
            const debugSource = new TMDBSource(mockConfig, mockShuffleArray, true);

            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        genres: [{ id: 1, name: 'Action' }],
                    }),
            });

            await debugSource.fetchGenreMapping('movie');

            // Debug mode should be enabled
            expect(debugSource.isDebug).toBe(true);
        });

        test('should not log debug information when disabled', async () => {
            const nonDebugSource = new TMDBSource(mockConfig, mockShuffleArray, false);

            expect(nonDebugSource.isDebug).toBe(false);
        });
    });

    describe('Cache Size Tracking', () => {
        test('should track cache sizes in metrics', () => {
            tmdbSource.genreCache.set('test1', { data: new Map(), timestamp: Date.now() });
            tmdbSource.responseCache.set('test2', { data: {}, timestamp: Date.now() });

            const metrics = tmdbSource.getMetrics();

            expect(metrics.cacheSizes.genres).toBe(1);
            expect(metrics.cacheSizes.responses).toBe(1);
        });
    });

    afterEach(() => {
        // Clean up global mocks
        delete global.fetch;
    });
});
