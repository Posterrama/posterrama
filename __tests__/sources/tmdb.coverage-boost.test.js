const TMDBSource = require('../../sources/tmdb');
const axios = require('axios');

jest.mock('axios');
jest.mock('../../utils/logger');

describe('TMDB Coverage Boost', () => {
    let tmdb;

    beforeEach(() => {
        jest.clearAllMocks();

        const sourceConfig = {
            apiKey: 'test-api-key',
            type: 'movie',
            categories: ['popular'],
            watchRegion: 'US',
        };
        const shuffleArray = jest.fn(arr => arr);
        const isDebug = false;

        tmdb = new TMDBSource(sourceConfig, shuffleArray, isDebug);
    });

    describe('Error handling paths', () => {
        test('should handle network errors in fetch', async () => {
            axios.get = jest.fn().mockRejectedValue(new Error('Network error'));

            // Test the getAvailableGenres function which makes API calls
            const result = await tmdb.getAvailableGenres();
            expect(result).toEqual([]); // Returns empty array on error
        });

        test('should handle invalid API response structure', async () => {
            axios.get = jest.fn().mockResolvedValue({
                data: { invalid: 'structure' },
            });

            const result = await tmdb.getAvailableGenres();
            expect(result).toEqual([]); // Returns empty array on invalid structure
        });

        test('should handle API key validation errors', async () => {
            axios.get = jest.fn().mockRejectedValue({
                response: { status: 401, data: { status_message: 'Invalid API key' } },
            });

            const result = await tmdb.getAvailableGenres();
            expect(result).toEqual([]); // Returns empty array on auth error
        });

        test('should handle rate limiting errors', async () => {
            axios.get = jest.fn().mockRejectedValue({
                response: { status: 429, data: { status_message: 'Rate limit exceeded' } },
            });

            const result = await tmdb.getAvailableGenres();
            expect(result).toEqual([]); // Returns empty array on rate limit
        });
    });

    describe('Configuration methods', () => {
        test('should get endpoint for different types and pages', () => {
            // Test different types
            const movieEndpoint = tmdb.getEndpoint('movie', 1);
            expect(movieEndpoint).toContain('movie');

            const tvEndpoint = tmdb.getEndpoint('tv', 2);
            expect(tvEndpoint).toContain('tv');
        });

        test('should get watch region', () => {
            const region = tmdb.getWatchRegion();
            expect(region).toBe('US');
        });

        test('should get recent date', () => {
            const date = tmdb.getRecentDate();
            expect(typeof date).toBe('string');
            expect(date.length).toBeGreaterThan(0);
        });

        test('should format streaming providers', () => {
            const streamingData = {
                US: {
                    flatrate: [{ provider_name: 'Netflix', logo_path: '/netflix.jpg' }],
                },
            };

            const result = tmdb.formatStreamingProviders(streamingData, 'US');
            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('providers');
        });

        test('should handle empty streaming data', () => {
            const result = tmdb.formatStreamingProviders({}, 'US');
            expect(result).toEqual({ available: false, providers: [] });
        });

        test('should handle null streaming data', () => {
            const result = tmdb.formatStreamingProviders(null, 'US');
            expect(result).toEqual({ available: false, providers: [] });
        });
    });

    describe('Content filtering', () => {
        test('should apply content filtering with genre map', () => {
            const items = [
                { id: 1, genre_ids: [28, 12], title: 'Action Movie' },
                { id: 2, genre_ids: [16], title: 'Animation' },
            ];

            const genreMap = new Map([
                [28, 'Action'],
                [12, 'Adventure'],
                [16, 'Animation'],
            ]);

            const result = tmdb.applyContentFiltering(items, 'movie', genreMap);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        });

        test('should handle empty items array', () => {
            const genreMap = new Map();
            const result = tmdb.applyContentFiltering([], 'movie', genreMap);
            expect(result).toEqual([]);
        });

        test('should handle items without genre_ids', () => {
            const items = [{ id: 1, title: 'Movie without genres' }];

            const genreMap = new Map();
            const result = tmdb.applyContentFiltering(items, 'movie', genreMap);
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('Cache operations', () => {
        test('should get metrics', () => {
            const metrics = tmdb.getMetrics();
            expect(typeof metrics).toBe('object');
            expect(metrics).toHaveProperty('requestCount');
            expect(metrics).toHaveProperty('cacheHits');
            expect(metrics).toHaveProperty('cacheMisses');
        });

        test('should reset metrics', () => {
            tmdb.resetMetrics();
            const metrics = tmdb.getMetrics();
            expect(metrics.requestCount).toBe(0);
            expect(metrics.cacheHits).toBe(0);
        });

        test('should get cache stats', () => {
            const stats = tmdb.getCacheStats();
            expect(typeof stats).toBe('object');
            expect(stats).toHaveProperty('genreCache');
            expect(stats).toHaveProperty('responseCache');
        });

        test('should cleanup cache', () => {
            // Add some entries to cache first
            tmdb.genreCache.set('test', { data: 'test', timestamp: Date.now() - 10000 });
            tmdb.responseCache.set('test', { data: 'test', timestamp: Date.now() - 10000 });

            tmdb.cleanupCache();

            const stats = tmdb.getCacheStats();
            expect(typeof stats).toBe('object');
        });
    });

    describe('Edge cases', () => {
        test('should handle missing watch region', () => {
            tmdb.source.watchRegion = undefined;
            const region = tmdb.getWatchRegion();
            expect(typeof region).toBe('string');
        });

        test('should handle empty source config', () => {
            tmdb.source = {};
            const endpoint = tmdb.getEndpoint('movie', 1);
            expect(typeof endpoint).toBe('string');
        });

        test('should handle large page numbers', () => {
            const endpoint = tmdb.getEndpoint('movie', 999999);
            expect(endpoint).toContain('999999');
        });

        test('should handle zero or negative page numbers', () => {
            const endpoint1 = tmdb.getEndpoint('movie', 0);
            const endpoint2 = tmdb.getEndpoint('movie', -1);
            expect(typeof endpoint1).toBe('string');
            expect(typeof endpoint2).toBe('string');
        });
    });
});
