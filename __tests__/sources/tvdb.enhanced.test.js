const TVDBSource = require('../../sources/tvdb');
const axios = require('axios');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

function queueAuth(tokens) {
    axios.post.mockReset();
    tokens.forEach(t => {
        if (t instanceof Error) {
            axios.post.mockRejectedValueOnce(t);
        } else {
            axios.post.mockResolvedValueOnce({ data: { data: { token: t } } });
        }
    });
}

describe('TVDBSource Enhanced Coverage', () => {
    const baseCfg = {
        enabled: true,
        showCount: 3,
        movieCount: 3,
        category: 'popular',
        minRating: 0,
    };
    let src;

    beforeEach(() => {
        jest.clearAllMocks();
        src = new TVDBSource(baseCfg);
    });

    describe('Movie Processing Edge Cases', () => {
        test('should handle movie processing with various categories', async () => {
            // Test different categories that affect params
            src.category = 'trending';
            queueAuth(['token']);

            const mockMovies = [
                {
                    id: 1,
                    name: 'Test Movie 1',
                    releaseDate: '2024-01-01',
                    averageRating: 7.5,
                    genres: [],
                    overview: 'Test overview',
                    image: '/movie1.jpg',
                    fanart: '/fanart1.jpg',
                },
                {
                    id: 2,
                    name: 'Test Movie 2',
                    releaseDate: '2023-06-15',
                    averageRating: 8.2,
                    genres: [1, 2],
                    overview: 'Another test movie',
                    image: '/movie2.jpg',
                },
            ];

            axios.get.mockResolvedValueOnce({ data: { data: mockMovies } });

            // Mock getArtwork to return different values for different calls
            src.getArtwork = jest
                .fn()
                .mockResolvedValueOnce({
                    fanart: 'https://artworks.thetvdb.com/fanart1.jpg',
                    poster: 'https://artworks.thetvdb.com/poster1.jpg',
                })
                .mockResolvedValueOnce({
                    fanart: null,
                    poster: 'https://artworks.thetvdb.com/poster2.jpg',
                });

            const movies = await src.getMovies();

            expect(movies).toHaveLength(2);
            expect(movies[0].title).toBe('Test Movie 1');
            expect(movies[1].title).toBe('Test Movie 2');

            // Verify artwork was fetched for first 5 items (both in this case)
            expect(src.getArtwork).toHaveBeenCalledTimes(2);
        });

        test('should handle movie processing with rating filter', async () => {
            src.minRating = 8.0;
            queueAuth(['token']);

            const mockMovies = [
                {
                    id: 1,
                    name: 'High Rated Movie',
                    releaseDate: '2024-01-01',
                    averageRating: 8.5,
                    genres: [],
                    overview: 'Great movie',
                    image: '/high.jpg',
                },
                {
                    id: 2,
                    name: 'Low Rated Movie',
                    releaseDate: '2024-01-01',
                    averageRating: 7.0, // Below minRating
                    genres: [],
                    overview: 'Not so good',
                    image: '/low.jpg',
                },
                {
                    id: 3,
                    name: 'No Rating Movie',
                    releaseDate: '2024-01-01',
                    averageRating: null, // No rating
                    genres: [],
                    overview: 'No rating',
                    image: '/norating.jpg',
                },
            ];

            axios.get.mockResolvedValueOnce({ data: { data: mockMovies } });
            src.getArtwork = jest.fn().mockResolvedValue({
                fanart: 'https://artworks.thetvdb.com/fanart.jpg',
                poster: 'https://artworks.thetvdb.com/poster.jpg',
            });

            const movies = await src.getMovies();

            // Only the high rated movie should be included
            expect(movies).toHaveLength(1);
            expect(movies[0].title).toBe('High Rated Movie');
        });

        test('should handle movie processing with filters (year and genre)', async () => {
            src.yearFilter = 2024;
            src.genreFilter = 'action';
            queueAuth(['token']);

            const mockResponse = { data: [] };
            axios.get.mockResolvedValueOnce({ data: mockResponse });

            await src.getMovies();

            // Should call with year and genre filters
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/movies'),
                expect.objectContaining({
                    headers: expect.any(Object),
                    params: expect.objectContaining({
                        year: 2024,
                        genre: 'action',
                    }),
                })
            );
        });

        test('should handle different category parameters', async () => {
            const categories = [
                'recently_added',
                'newest',
                'popular',
                'top_rated',
                'trending',
                'alphabetical',
                'oldest',
                'unknown',
            ];

            for (const category of categories) {
                jest.clearAllMocks();
                src.category = category;
                queueAuth(['token']);

                axios.get.mockResolvedValueOnce({ data: { data: [] } });

                await src.getMovies();

                const call = axios.get.mock.calls[0];
                const params = call[1].params;

                if (category === 'recently_added') {
                    expect(params.sort).toBe('createdAt');
                } else if (category === 'newest') {
                    expect(params.sort).toBe('releaseDate');
                } else if (category === 'popular') {
                    expect(params.sort).toBe('score');
                } else if (category === 'top_rated') {
                    expect(params.sort).toBe('averageRating');
                } else if (category === 'trending') {
                    expect(params.sort).toBe('lastUpdated');
                } else if (category === 'alphabetical') {
                    expect(params.sort).toBe('name');
                } else if (category === 'oldest') {
                    expect(params.sort).toBe('releaseDate');
                } else {
                    // Unknown category should use default
                    expect(params.sort).toBe('score');
                }
            }
        });

        test('should handle movie processing errors gracefully', async () => {
            queueAuth(['token']);
            src.getArtwork = jest.fn().mockRejectedValue(new Error('Artwork fetch failed'));

            const mockMovies = [
                {
                    id: 1,
                    name: 'Error Movie',
                    releaseDate: '2024-01-01',
                    averageRating: 7.5,
                    genres: [],
                    overview: 'Test movie',
                    image: '/movie.jpg',
                },
            ];

            axios.get.mockResolvedValueOnce({ data: { data: mockMovies } });

            const movies = await src.getMovies();

            // Should still process the movie despite artwork error
            expect(movies).toHaveLength(1);
            expect(movies[0].title).toBe('Error Movie');
        });
    });

    describe('Show Processing Edge Cases', () => {
        test('should handle show processing errors in individual items', async () => {
            queueAuth(['token']);
            src.genresLoaded = true;

            const mockShows = [
                {
                    id: 1,
                    name: 'Good Show',
                    firstAired: '2024-01-01',
                    averageRating: 8.0,
                    genres: [],
                    overview: 'Good show',
                    image: '/good.jpg',
                },
                // This will cause an error in processing
                null,
                {
                    id: 3,
                    name: 'Another Good Show',
                    firstAired: '2024-01-01',
                    averageRating: 7.5,
                    genres: [],
                    overview: 'Another good show',
                    image: '/another.jpg',
                },
            ];

            axios.get.mockResolvedValueOnce({ data: { data: mockShows } });
            src.getArtwork = jest.fn().mockResolvedValue({
                fanart: 'https://artworks.thetvdb.com/fanart.jpg',
                poster: 'https://artworks.thetvdb.com/poster.jpg',
            });

            const shows = await src.getShows();

            // Should process valid shows and skip the null one
            expect(shows).toHaveLength(2);
            expect(shows[0].title).toBe('Good Show');
            expect(shows[1].title).toBe('Another Good Show');
        });

        test('should respect showCount limit during processing', async () => {
            src.showCount = 2; // Limit to 2 shows
            queueAuth(['token']);
            src.genresLoaded = true;

            const mockShows = Array.from({ length: 5 }, (_, i) => ({
                id: i + 1,
                name: `Show ${i + 1}`,
                firstAired: '2024-01-01',
                averageRating: 8.0,
                genres: [],
                overview: `Show ${i + 1} overview`,
                image: `/show${i + 1}.jpg`,
            }));

            axios.get.mockResolvedValueOnce({ data: { data: mockShows } });
            src.getArtwork = jest.fn().mockResolvedValue({
                fanart: 'https://artworks.thetvdb.com/fanart.jpg',
                poster: 'https://artworks.thetvdb.com/poster.jpg',
            });

            const shows = await src.getShows();

            // Should only return 2 shows due to showCount limit
            expect(shows).toHaveLength(2);
            expect(shows[0].title).toBe('Show 1');
            expect(shows[1].title).toBe('Show 2');
        });
    });

    describe('Error Handling', () => {
        test('should handle getMovies API errors', async () => {
            queueAuth(['token']);
            axios.get.mockRejectedValueOnce(new Error('API request failed'));

            const movies = await src.getMovies();

            expect(movies).toEqual([]);
            expect(require('../../utils/logger').error).toHaveBeenCalledWith(
                'Failed to fetch TVDB movies:',
                'API request failed'
            );
        });

        test('should handle authentication failure in getMovies', async () => {
            queueAuth([new Error('Auth failed')]);

            const movies = await src.getMovies();

            expect(movies).toEqual([]);
        });
    });

    describe('Cache and Performance', () => {
        test('should track metrics correctly', () => {
            // Reset metrics first
            src.resetMetrics();

            // Simulate some cache operations
            src.setCachedData('test1', { data: 'value1' });
            src.setCachedData('test2', { data: 'value2' });

            // Simulate cache hits and misses
            src.metrics.cacheHits = 5;
            src.metrics.cacheMisses = 3;
            src.metrics.requestCount = 8;

            const metrics = src.getMetrics();

            expect(metrics.cacheHits).toBe(5);
            expect(metrics.cacheMisses).toBe(3);
            expect(metrics.requestCount).toBe(8);
            expect(metrics.cacheHitRate).toBe(5 / 8);
            expect(metrics.cacheSize).toBeGreaterThan(0);
        });

        test('should reset metrics properly', () => {
            // Set some metrics
            src.metrics.requestCount = 10;
            src.metrics.cacheHits = 5;
            src.metrics.errorCount = 2;

            src.resetMetrics();

            const metrics = src.getMetrics();
            expect(metrics.requestCount).toBe(0);
            expect(metrics.cacheHits).toBe(0);
            expect(metrics.errorCount).toBe(0);
            expect(metrics.authCount).toBe(0);
        });

        test('should provide cache statistics', () => {
            // Add some cache entries
            src.setCachedData('entry1', { data: 'test1' });
            src.setCachedData('entry2', { data: 'test2' });

            const stats = src.getCacheStats();

            expect(stats.totalEntries).toBeGreaterThanOrEqual(2);
            expect(Array.isArray(stats.entries)).toBe(true);
            expect(stats.entries.length).toBeGreaterThanOrEqual(2);

            // Check that entries have the expected structure
            expect(stats.entries[0]).toHaveProperty('key');
            expect(stats.entries[0]).toHaveProperty('age');
        });
    });

    describe('Utility Functions', () => {
        test('should handle various date formats in extractYear', () => {
            expect(src.extractYear('2024-12-25')).toBe(2024);
            expect(src.extractYear('1999-01-01')).toBe(1999);
            expect(src.extractYear('not-a-date')).toBeNull();
            expect(src.extractYear('')).toBeNull();
            expect(src.extractYear(null)).toBeNull();
            expect(src.extractYear(undefined)).toBeNull();
        });

        test('should handle different image URL formats', () => {
            expect(src.getImageUrl('/path/image.jpg')).toMatch(/artworks\.thetvdb\.com/);
            expect(src.getImageUrl('http://full.url/image.jpg')).toBe('http://full.url/image.jpg');
            expect(src.getImageUrl('https://secure.url/image.jpg')).toBe(
                'https://secure.url/image.jpg'
            );
            expect(src.getImageUrl(null)).toBeNull();
            expect(src.getImageUrl('')).toBeNull();
            expect(src.getImageUrl(undefined)).toBeNull();
        });
    });

    describe('Integration Scenarios', () => {
        test('should handle complete movie workflow with high-quality artwork for top items', async () => {
            src.movieCount = 6; // More than 5 to test the first-5 artwork logic
            queueAuth(['token']);

            const mockMovies = Array.from({ length: 8 }, (_, i) => ({
                id: i + 1,
                name: `Movie ${i + 1}`,
                releaseDate: '2024-01-01',
                averageRating: 8.0 + i * 0.1,
                genres: [1],
                overview: `Movie ${i + 1} overview`,
                image: `/movie${i + 1}.jpg`,
                fanart: `/fanart${i + 1}.jpg`,
            }));

            axios.get.mockResolvedValueOnce({ data: { data: mockMovies } });

            // Mock getArtwork to be called for first 5 items only
            src.getArtwork = jest.fn().mockResolvedValue({
                fanart: 'https://artworks.thetvdb.com/high-quality-fanart.jpg',
                poster: 'https://artworks.thetvdb.com/high-quality-poster.jpg',
            });

            const movies = await src.getMovies();

            expect(movies).toHaveLength(6); // Limited by movieCount
            expect(src.getArtwork).toHaveBeenCalledTimes(5); // Only first 5 get high-quality artwork

            // Verify the first movie has high-quality artwork
            expect(movies[0].backgroundUrl).toBe(
                'https://artworks.thetvdb.com/high-quality-fanart.jpg'
            );
            expect(movies[0].posterUrl).toBe(
                'https://artworks.thetvdb.com/high-quality-poster.jpg'
            );
        });

        test('should handle testConnection with invalid response format', async () => {
            queueAuth(['token']);
            // Mock a response without data property
            axios.get.mockResolvedValueOnce({});

            const result = await src.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid response from TVDB API');
        });

        test('should handle show category parameters', async () => {
            // Test for shows endpoint (similar to movies but different endpoint)
            src.category = 'alphabetical';
            queueAuth(['token']);
            src.genresLoaded = true;

            axios.get.mockResolvedValueOnce({ data: { data: [] } });

            await src.getShows();

            const call = axios.get.mock.calls[0];
            expect(call[0]).toContain('/series');
            expect(call[1].params.sort).toBe('name');
        });

        test('should handle shows with various categories', async () => {
            const categories = ['oldest', 'recently_updated'];

            for (const category of categories) {
                jest.clearAllMocks();
                src.category = category;
                queueAuth(['token']);
                src.genresLoaded = true;

                axios.get.mockResolvedValueOnce({ data: { data: [] } });

                await src.getShows();

                const call = axios.get.mock.calls[0];
                const params = call[1].params;

                if (category === 'oldest') {
                    expect(params.sort).toBe('firstAired');
                } else if (category === 'recently_updated') {
                    expect(params.sort).toBe('lastUpdated');
                }
            }
        });
    });
});
