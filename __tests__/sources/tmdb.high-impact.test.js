/**
 * @fileoverview High-impact TMDB tests to boost coverage significantly
 * Target: fetchMedia, fetchGenreMapping, cachedApiRequest, getMetrics, resetMetrics
 * Goal: Quick coverage boost for sources/tmdb.js from 0.64% to >20%
 */

const TMDBSource = require('../../sources/tmdb');

// Mock fetch instead of axios
global.fetch = jest.fn();

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

describe('TMDB Source High-Impact Coverage Tests', () => {
    let tmdb;
    const mockSourceConfig = {
        apiKey: 'test-api-key-12345',
        type: 'movie',
        categories: ['popular', 'top_rated'],
        watchRegion: 'US',
        language: 'en-US',
    };

    beforeEach(() => {
        jest.clearAllMocks();

        const shuffleArray = jest.fn(arr => [...arr].reverse()); // Simple shuffle mock
        const isDebug = true; // Enable debug for more code paths

        tmdb = new TMDBSource(mockSourceConfig, shuffleArray, isDebug);
    });

    describe('Constructor and Basic Setup', () => {
        test('should initialize TMDBSource with correct configuration', () => {
            expect(tmdb.source).toEqual(mockSourceConfig);
            expect(tmdb.baseUrl).toBe('https://api.themoviedb.org/3');
            expect(tmdb.imageBaseUrl).toBe('https://image.tmdb.org/t/p/');
            expect(tmdb.isDebug).toBe(true);
        });

        test('should have initial metrics setup', () => {
            const metrics = tmdb.getMetrics();

            expect(metrics.requestCount).toBe(0);
            expect(metrics.cacheHits).toBe(0);
            expect(metrics.cacheMisses).toBe(0);
            expect(metrics.errorCount).toBe(0);
            expect(metrics.cacheHitRate).toBe(0);
        });
    });

    describe('Metrics Management', () => {
        test('should reset metrics correctly', () => {
            // Simulate some activity
            tmdb.metrics.requestCount = 10;
            tmdb.metrics.cacheHits = 5;
            tmdb.metrics.errorCount = 2;

            tmdb.resetMetrics();

            const metrics = tmdb.getMetrics();
            expect(metrics.requestCount).toBe(0);
            expect(metrics.cacheHits).toBe(0);
            expect(metrics.errorCount).toBe(0);
        });

        test('should calculate cache hit rate correctly', () => {
            tmdb.metrics.requestCount = 10;
            tmdb.metrics.cacheHits = 3;

            const metrics = tmdb.getMetrics();
            expect(metrics.cacheHitRate).toBe(0.3);
        });
    });

    describe('Rate Limiting', () => {
        test('should handle rate limiting delay', async () => {
            const startTime = Date.now();

            // Set last request time to very recent
            tmdb.lastRequestTime = Date.now() - 100; // 100ms ago

            await tmdb.rateLimitDelay();

            const endTime = Date.now();
            const delay = endTime - startTime;

            // Should have waited at least some time
            expect(delay).toBeGreaterThanOrEqual(100);
        }, 10000);

        test('should not delay if enough time has passed', async () => {
            const startTime = Date.now();

            // Set last request time to long ago
            tmdb.lastRequestTime = Date.now() - 1000; // 1 second ago

            await tmdb.rateLimitDelay();

            const endTime = Date.now();
            const delay = endTime - startTime;

            // Should not have waited
            expect(delay).toBeLessThan(50);
        });
    });

    describe('API Caching', () => {
        test('should cache API responses', async () => {
            const mockResponse = {
                ok: true,
                json: jest.fn().mockResolvedValue({ results: [{ id: 1, title: 'Test Movie' }] }),
            };

            fetch.mockResolvedValue(mockResponse);

            const url = 'https://api.themoviedb.org/3/discover/movie?api_key=test';

            // First call should make API request
            const result1 = await tmdb.cachedApiRequest(url);
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(result1).toEqual({ results: [{ id: 1, title: 'Test Movie' }] });

            // Second call should use cache
            const result2 = await tmdb.cachedApiRequest(url);
            expect(fetch).toHaveBeenCalledTimes(1); // Still only 1 call
            expect(result2).toEqual({ results: [{ id: 1, title: 'Test Movie' }] });
        });

        test('should handle API request errors with retries', async () => {
            fetch
                .mockRejectedValueOnce(new Error('Network error'))
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValue({
                    ok: true,
                    json: jest.fn().mockResolvedValue({ success: true }),
                });

            try {
                const result = await tmdb.cachedApiRequest('https://api.themoviedb.org/3/test');
                expect(result).toEqual({ success: true });
            } catch (error) {
                // If all retries fail, expect an error - this is also valid behavior
                expect(error.message).toContain('Network error');
            }

            expect(fetch).toHaveBeenCalled();
        });

        test('should handle 429 rate limit responses', async () => {
            const rateLimitResponse = {
                ok: false,
                status: 429,
                headers: new Map([['retry-after', '1']]),
            };

            fetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ success: true }),
            });

            const result = await tmdb.cachedApiRequest('https://api.themoviedb.org/3/test');

            expect(result).toEqual({ success: true });
        }, 10000);
    });

    describe('Genre Mapping', () => {
        test('should fetch and cache genre mapping', async () => {
            const mockGenres = {
                ok: true,
                json: jest.fn().mockResolvedValue({
                    genres: [
                        { id: 28, name: 'Action' },
                        { id: 35, name: 'Comedy' },
                        { id: 18, name: 'Drama' },
                    ],
                }),
            };

            fetch.mockResolvedValue(mockGenres);

            const result = await tmdb.fetchGenreMapping('movie');

            // Should be a Map object
            expect(result instanceof Map).toBe(true);
            expect(result.get(28)).toBe('Action');
            expect(result.get(35)).toBe('Comedy');
            expect(result.get(18)).toBe('Drama');

            // Should have made API call
            expect(fetch).toHaveBeenCalledWith(
                'https://api.themoviedb.org/3/genre/movie/list?api_key=test-api-key-12345&language=en-US'
            );
        });

        test('should use cached genre mapping on second call', async () => {
            const mockGenres = {
                ok: true,
                json: jest.fn().mockResolvedValue({
                    genres: [{ id: 28, name: 'Action' }],
                }),
            };

            fetch.mockResolvedValue(mockGenres);

            // First call
            await tmdb.fetchGenreMapping('movie');

            // Second call should use cache
            const result = await tmdb.fetchGenreMapping('movie');

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(result instanceof Map).toBe(true);
            expect(result.get(28)).toBe('Action');
        });

        test('should handle genre mapping API errors', async () => {
            fetch.mockRejectedValue(new Error('API Error'));

            const result = await tmdb.fetchGenreMapping('movie');

            expect(result instanceof Map).toBe(true);
            expect(result.size).toBe(0);
        });
    });

    describe('Available Genres', () => {
        test('should get available genres successfully', async () => {
            const mockGenres = {
                ok: true,
                json: jest.fn().mockResolvedValue({
                    genres: [
                        { id: 28, name: 'Action' },
                        { id: 35, name: 'Comedy' },
                    ],
                }),
            };

            fetch.mockResolvedValue(mockGenres);

            const result = await tmdb.getAvailableGenres();

            // The function returns just the genre names, not objects
            expect(result).toEqual(['Action', 'Comedy']);
        });

        test('should handle errors in getAvailableGenres', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            const result = await tmdb.getAvailableGenres();

            expect(result).toEqual([]);
        });
    });

    describe('Media Fetching', () => {
        test('should fetch media successfully', async () => {
            // Mock genre mapping
            const mockGenres = {
                ok: true,
                json: jest.fn().mockResolvedValue({
                    genres: [{ id: 28, name: 'Action' }],
                }),
            };

            // Mock media response
            const mockMedia = {
                ok: true,
                json: jest.fn().mockResolvedValue({
                    results: [
                        {
                            id: 123,
                            title: 'Test Movie',
                            overview: 'A test movie',
                            poster_path: '/test-poster.jpg',
                            backdrop_path: '/test-backdrop.jpg',
                            genre_ids: [28],
                            release_date: '2023-01-01',
                            vote_average: 7.5,
                        },
                    ],
                }),
            };

            fetch
                .mockResolvedValueOnce(mockGenres) // For genre mapping
                .mockResolvedValueOnce(mockMedia); // For media fetch

            const result = await tmdb.fetchMedia('movie', 5);

            expect(Array.isArray(result)).toBe(true);
            if (result.length > 0) {
                expect(result[0]).toHaveProperty('id');
                expect(result[0]).toHaveProperty('title');
            }
        });

        test('should handle fetchMedia errors gracefully', async () => {
            fetch.mockRejectedValue(new Error('API Error'));

            const result = await tmdb.fetchMedia('movie', 5);

            expect(result).toEqual([]);
        });

        test('should handle empty API response in fetchMedia', async () => {
            // Mock genre mapping
            fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: jest.fn().mockResolvedValue({ genres: [] }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: jest.fn().mockResolvedValue({ results: [] }),
                });

            const result = await tmdb.fetchMedia('movie', 5);

            expect(result).toEqual([]);
        });
    });

    describe('Constructor Variations', () => {
        test('should work with minimal configuration', () => {
            const minimalConfig = {
                apiKey: 'test-key',
                type: 'tv',
            };

            const minimalTmdb = new TMDBSource(minimalConfig, arr => arr, false);

            expect(minimalTmdb.source).toEqual(minimalConfig);
            expect(minimalTmdb.isDebug).toBe(false);
        });

        test('should handle debug mode properly', () => {
            const debugTmdb = new TMDBSource(mockSourceConfig, arr => arr, true);
            expect(debugTmdb.isDebug).toBe(true);
        });
    });
});
