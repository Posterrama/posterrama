/**
 * TMDB Missing Coverage Tests
 * Target: Increase coverage from 76.64% statements / 56.59% branches → 70%+ branches
 * Focus: Uncovered lines 63-74,234,245-250,334,357-363,406-410,429-440,470,474-478,483-495,
 *        506-543,553-557,562-576,586,809-828,903-916,941-949,999,1005
 *
 * Key gaps:
 * 1. Streaming endpoints (lines 406-543) - various streaming providers
 * 2. formatStreamingProviders (lines 553-576) - flatrate, buy, rent providers
 * 3. Year filter ranges (lines 809-916) - string parsing, range validation
 * 4. Error handling edge cases (lines 63-74, 234, 245-250)
 */

const TMDBSource = require('../../sources/tmdb');

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

describe('TMDB Missing Coverage - Streaming Endpoints', () => {
    let source;
    const mockConfig = {
        name: 'StreamingTest',
        apiKey: 'TEST_KEY',
        category: 'streaming_netflix',
        watchRegion: 'US',
    };

    beforeEach(() => {
        source = new TMDBSource(mockConfig, arr => arr, false);
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Movie streaming endpoints', () => {
        test('getEndpoint for streaming_netflix (movies)', () => {
            source.source.category = 'streaming_netflix';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('/discover/movie');
            expect(endpoint).toContain('with_watch_providers=8');
            expect(endpoint).toContain('watch_region=US');
        });

        test('getEndpoint for streaming_disney (movies)', () => {
            source.source.category = 'streaming_disney';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('with_watch_providers=337');
        });

        test('getEndpoint for streaming_prime (movies)', () => {
            source.source.category = 'streaming_prime';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('with_watch_providers=119');
        });

        test('getEndpoint for streaming_hbo (movies)', () => {
            source.source.category = 'streaming_hbo';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('with_watch_providers=1899');
        });

        test('getEndpoint for streaming_hulu (movies)', () => {
            source.source.category = 'streaming_hulu';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('with_watch_providers=15');
        });

        test('getEndpoint for streaming_apple (movies)', () => {
            source.source.category = 'streaming_apple';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('with_watch_providers=350');
        });

        test('getEndpoint for streaming_paramount (movies)', () => {
            source.source.category = 'streaming_paramount';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('with_watch_providers=531');
        });

        test('getEndpoint for streaming_crunchyroll (movies)', () => {
            source.source.category = 'streaming_crunchyroll';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('with_watch_providers=283');
        });

        test('getEndpoint for streaming_new_releases with default providers', () => {
            source.source.category = 'streaming_new_releases';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('with_watch_providers=8|337|119|1899|15|350|531|283');
            expect(endpoint).toContain('sort_by=release_date.desc');
            expect(endpoint).toContain('primary_release_date.gte=');
        });

        test('getEndpoint for streaming_new_releases with custom providers', () => {
            source.source.withWatchProviders = [8, 337];
            source.source.category = 'streaming_new_releases';
            const endpoint = source.getEndpoint('movie', 1);
            expect(endpoint).toContain('with_watch_providers=8|337');
        });
    });

    describe('TV streaming endpoints', () => {
        test('getEndpoint for tv_streaming_netflix', () => {
            source.source.category = 'tv_streaming_netflix';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('/discover/tv');
            expect(endpoint).toContain('with_watch_providers=8');
        });

        test('getEndpoint for tv_streaming_disney', () => {
            source.source.category = 'tv_streaming_disney';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('with_watch_providers=337');
        });

        test('getEndpoint for tv_streaming_prime', () => {
            source.source.category = 'tv_streaming_prime';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('with_watch_providers=119');
        });

        test('getEndpoint for tv_streaming_hbo', () => {
            source.source.category = 'tv_streaming_hbo';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('with_watch_providers=1899');
        });

        test('getEndpoint for tv_streaming_hulu', () => {
            source.source.category = 'tv_streaming_hulu';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('with_watch_providers=15');
        });

        test('getEndpoint for tv_streaming_apple', () => {
            source.source.category = 'tv_streaming_apple';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('with_watch_providers=350');
        });

        test('getEndpoint for tv_streaming_paramount', () => {
            source.source.category = 'tv_streaming_paramount';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('with_watch_providers=531');
        });

        test('getEndpoint for tv_streaming_crunchyroll', () => {
            source.source.category = 'tv_streaming_crunchyroll';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('with_watch_providers=283');
        });

        test('getEndpoint for tv_streaming_new_releases', () => {
            source.source.category = 'tv_streaming_new_releases';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('sort_by=release_date.desc');
            expect(endpoint).toContain('first_air_date.gte=');
        });

        test('getEndpoint falls back to tv/popular for unknown category with type=tv', () => {
            source.source.category = 'unknown_category';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('/tv/popular');
        });

        test('getEndpoint for streaming_netflix without tv_ prefix but type=tv', () => {
            source.source.category = 'streaming_netflix';
            const endpoint = source.getEndpoint('tv', 1);
            expect(endpoint).toContain('/discover/tv');
            expect(endpoint).toContain('with_watch_providers=8');
        });
    });

    describe('getWatchRegion and getRecentDate', () => {
        test('getWatchRegion returns configured region', () => {
            source.source.watchRegion = 'NL';
            expect(source.getWatchRegion()).toBe('NL');
        });

        test('getWatchRegion defaults to US', () => {
            source.source.watchRegion = undefined;
            expect(source.getWatchRegion()).toBe('US');
        });

        test('getRecentDate returns date 3 months ago', () => {
            const recentDate = source.getRecentDate();
            expect(recentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

            const date = new Date(recentDate);
            const now = new Date();
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

            expect(date.getTime()).toBeGreaterThan(threeMonthsAgo.getTime() - 86400000); // Within 1 day
            expect(date.getTime()).toBeLessThan(now.getTime());
        });
    });
});

describe('TMDB Missing Coverage - Streaming Providers', () => {
    let source;
    const mockConfig = {
        name: 'StreamingTest',
        apiKey: 'TEST_KEY',
        category: 'popular',
        watchRegion: 'US',
    };

    beforeEach(() => {
        source = new TMDBSource(mockConfig, arr => arr, false);
        source.minRequestInterval = 0;
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('fetchStreamingProviders with cached data', async () => {
        const mockData = {
            results: {
                US: {
                    flatrate: [
                        { provider_id: 8, provider_name: 'Netflix', logo_path: '/logo.jpg' },
                    ],
                },
            },
        };

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockData,
        });

        const result1 = await source.fetchStreamingProviders('movie', 123);
        expect(result1).toEqual(mockData);
        expect(global.fetch).toHaveBeenCalledTimes(1);

        // Second call should use cache
        const result2 = await source.fetchStreamingProviders('movie', 123);
        expect(result2).toEqual(mockData);
        expect(global.fetch).toHaveBeenCalledTimes(1); // Still 1, used cache
    });

    test('fetchStreamingProviders handles 404 gracefully', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
        });

        const result = await source.fetchStreamingProviders('movie', 999);
        expect(result).toBeNull();
    });

    test('fetchStreamingProviders handles network error', async () => {
        global.fetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await source.fetchStreamingProviders('movie', 123);
        expect(result).toBeNull();
    });

    test('formatStreamingProviders with flatrate providers', () => {
        const streamingData = {
            results: {
                US: {
                    flatrate: [
                        { provider_name: 'Netflix', logo_path: '/netflix.jpg' },
                        { provider_name: 'Disney+', logo_path: '/disney.jpg' },
                    ],
                },
            },
        };

        const formatted = source.formatStreamingProviders(streamingData, 'US');
        expect(formatted.available).toBe(true);
        expect(formatted.providers).toHaveLength(2);
        expect(formatted.providers[0].type).toBe('subscription');
        expect(formatted.providers[0].name).toBe('Netflix');
        expect(formatted.providers[0].logo).toContain('netflix.jpg');
    });

    test('formatStreamingProviders with buy providers', () => {
        const streamingData = {
            results: {
                US: {
                    buy: [{ provider_name: 'iTunes', logo_path: '/itunes.jpg' }],
                },
            },
        };

        const formatted = source.formatStreamingProviders(streamingData, 'US');
        expect(formatted.available).toBe(true);
        expect(formatted.providers).toHaveLength(1);
        expect(formatted.providers[0].type).toBe('buy');
    });

    test('formatStreamingProviders with rent providers', () => {
        const streamingData = {
            results: {
                US: {
                    rent: [{ provider_name: 'Amazon', logo_path: '/amazon.jpg' }],
                },
            },
        };

        const formatted = source.formatStreamingProviders(streamingData, 'US');
        expect(formatted.available).toBe(true);
        expect(formatted.providers).toHaveLength(1);
        expect(formatted.providers[0].type).toBe('rent');
    });

    test('formatStreamingProviders with mixed providers', () => {
        const streamingData = {
            results: {
                US: {
                    flatrate: [{ provider_name: 'Netflix', logo_path: '/netflix.jpg' }],
                    buy: [{ provider_name: 'iTunes', logo_path: '/itunes.jpg' }],
                    rent: [{ provider_name: 'Amazon', logo_path: '/amazon.jpg' }],
                    link: 'https://www.themoviedb.org/movie/123/watch',
                },
            },
        };

        const formatted = source.formatStreamingProviders(streamingData, 'US');
        expect(formatted.available).toBe(true);
        expect(formatted.providers).toHaveLength(3);
        expect(formatted.link).toBe('https://www.themoviedb.org/movie/123/watch');
    });

    test('formatStreamingProviders with no data', () => {
        const formatted = source.formatStreamingProviders(null);
        expect(formatted.available).toBe(false);
        expect(formatted.providers).toEqual([]);
    });

    test('formatStreamingProviders with missing region', () => {
        const streamingData = {
            results: {
                GB: {
                    flatrate: [{ provider_name: 'BBC iPlayer', logo_path: '/bbc.jpg' }],
                },
            },
        };

        const formatted = source.formatStreamingProviders(streamingData, 'US');
        expect(formatted.available).toBe(false);
        expect(formatted.providers).toEqual([]);
    });

    test('formatStreamingProviders uses default watch region', () => {
        source.source.watchRegion = 'NL';
        const streamingData = {
            results: {
                NL: {
                    flatrate: [{ provider_name: 'NPO', logo_path: '/npo.jpg' }],
                },
            },
        };

        const formatted = source.formatStreamingProviders(streamingData);
        expect(formatted.available).toBe(true);
        expect(formatted.region).toBe('NL');
    });

    test('formatStreamingProviders handles providers without logo_path', () => {
        const streamingData = {
            results: {
                US: {
                    flatrate: [{ provider_name: 'Unknown', logo_path: null }],
                },
            },
        };

        const formatted = source.formatStreamingProviders(streamingData, 'US');
        expect(formatted.providers[0].logo).toBeNull();
    });
});

describe('TMDB Missing Coverage - Year Filter', () => {
    let source;
    const mockConfig = {
        name: 'YearFilterTest',
        apiKey: 'TEST_KEY',
        category: 'popular',
    };

    beforeEach(() => {
        source = new TMDBSource(mockConfig, arr => arr, false);
    });

    test('yearFilter as number (minimum year)', () => {
        source.source.yearFilter = 2010;
        const items = [
            { id: 1, release_date: '2015-01-01' },
            { id: 2, release_date: '2005-01-01' }, // Filtered out
            { id: 3, release_date: '2010-01-01' },
        ];

        const filtered = source.applyContentFiltering(items, 'movie', new Map());
        expect(filtered).toHaveLength(2);
        expect(filtered.map(i => i.id)).toEqual([1, 3]);
    });

    test('yearFilter as string with single year', () => {
        source.source.yearFilter = '2020';
        const items = [
            { id: 1, release_date: '2020-05-15' },
            { id: 2, release_date: '2019-01-01' }, // Filtered out
        ];

        const filtered = source.applyContentFiltering(items, 'movie', new Map());
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe(1);
    });

    test('yearFilter as string with range', () => {
        source.source.yearFilter = '2010-2020';
        const items = [
            { id: 1, release_date: '2015-01-01' }, // In range
            { id: 2, release_date: '2005-01-01' }, // Out of range
            { id: 3, release_date: '2022-01-01' }, // Out of range
            { id: 4, release_date: '2010-01-01' }, // In range
            { id: 5, release_date: '2020-12-31' }, // In range
        ];

        const filtered = source.applyContentFiltering(items, 'movie', new Map());
        expect(filtered).toHaveLength(3);
        expect(filtered.map(i => i.id)).toEqual([1, 4, 5]);
    });

    test('yearFilter with multiple ranges', () => {
        source.source.yearFilter = '1980-1990, 2015-2020';
        const items = [
            { id: 1, release_date: '1985-01-01' }, // First range
            { id: 2, release_date: '2017-01-01' }, // Second range
            { id: 3, release_date: '2000-01-01' }, // Neither range
            { id: 4, release_date: '1995-01-01' }, // Neither range
        ];

        const filtered = source.applyContentFiltering(items, 'movie', new Map());
        expect(filtered).toHaveLength(2);
        expect(filtered.map(i => i.id)).toEqual([1, 2]);
    });

    test('yearFilter with multiple single years', () => {
        source.source.yearFilter = '2010, 2015, 2020';
        const items = [
            { id: 1, release_date: '2010-01-01' },
            { id: 2, release_date: '2015-01-01' },
            { id: 3, release_date: '2012-01-01' }, // Filtered out
            { id: 4, release_date: '2020-01-01' },
        ];

        const filtered = source.applyContentFiltering(items, 'movie', new Map());
        expect(filtered).toHaveLength(3);
        expect(filtered.map(i => i.id)).toEqual([1, 2, 4]);
    });

    test('yearFilter filters out items without release_date', () => {
        source.source.yearFilter = 2020;
        const items = [
            { id: 1, release_date: '2020-01-01' },
            { id: 2, release_date: null }, // Filtered out
            { id: 3 }, // No release_date field, filtered out
        ];

        const filtered = source.applyContentFiltering(items, 'movie', new Map());
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe(1);
    });

    test('yearFilter works with TV shows using first_air_date', () => {
        source.source.yearFilter = '2019-2021';
        const items = [
            { id: 1, first_air_date: '2020-01-01' },
            { id: 2, first_air_date: '2018-01-01' }, // Filtered out
        ];

        const filtered = source.applyContentFiltering(items, 'tv', new Map());
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe(1);
    });

    test('yearFilter ignores invalid year formats', () => {
        source.source.yearFilter = 'invalid, 2020, 1800-1850'; // 1800-1850 ignored (< 1900)
        const items = [
            { id: 1, release_date: '2020-01-01' },
            { id: 2, release_date: '1830-01-01' }, // Would be in range but year < 1900
        ];

        const filtered = source.applyContentFiltering(items, 'movie', new Map());
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe(1);
    });
});

describe('TMDB Missing Coverage - Edge Cases', () => {
    let source;
    const mockConfig = {
        name: 'EdgeCaseTest',
        apiKey: 'TEST_KEY',
        category: 'latest',
    };

    beforeEach(() => {
        source = new TMDBSource(mockConfig, arr => arr, true);
        source.minRequestInterval = 0;
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('fetchMedia with count=0 returns empty array', async () => {
        const result = await source.fetchMedia('movie', 0);
        expect(result).toEqual([]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('fetchMedia handles latest endpoint returning single object', async () => {
        const mockGenres = { genres: [{ id: 1, name: 'Action' }] };
        const mockLatest = { id: 123, title: 'Latest Movie', genre_ids: [1] };

        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => mockGenres })
            .mockResolvedValueOnce({ ok: true, json: async () => mockLatest });

        const result = await source.fetchMedia('movie', 1);
        expect(result).toHaveLength(1);
    });

    test('fetchMedia handles tv_latest category', async () => {
        source.source.category = 'tv_latest';
        const mockGenres = { genres: [{ id: 1, name: 'Drama' }] };
        const mockLatest = { id: 456, name: 'Latest Show', genre_ids: [1] };

        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => mockGenres })
            .mockResolvedValueOnce({ ok: true, json: async () => mockLatest });

        const result = await source.fetchMedia('tv', 1);
        expect(result).toHaveLength(1);
    });

    test('fetchMedia continues on page error', async () => {
        source.source.category = 'popular';
        const mockGenres = { genres: [] };

        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => mockGenres })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ id: 1 }] }) })
            .mockRejectedValueOnce(new Error('Page 2 failed'))
            .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ id: 3 }] }) });

        const result = await source.fetchMedia('movie', 50);
        // Should continue fetching despite page 2 error
        expect(result.length).toBeGreaterThan(0);
    });

    test('fetchMedia filters by media_type for trending_all', async () => {
        source.source.category = 'trending_all_week';
        const mockGenres = { genres: [] };
        const mockResults = {
            results: [
                { id: 1, title: 'Movie', media_type: 'movie' },
                { id: 2, name: 'TV Show', media_type: 'tv' },
                { id: 3, name: 'Person', media_type: 'person' },
            ],
        };

        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => mockGenres })
            .mockResolvedValueOnce({ ok: true, json: async () => mockResults });

        const movieResult = await source.fetchMedia('movie', 10);
        expect(movieResult.length).toBe(1);
    });

    test('fetchMedia filters by media_type for discover', async () => {
        source.source.category = 'discover_movie';
        const mockGenres = { genres: [] };
        const mockResults = {
            results: [
                { id: 1, title: 'Movie 1' },
                { id: 2, title: 'Movie 2', media_type: 'movie' },
            ],
        };

        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => mockGenres })
            .mockResolvedValueOnce({ ok: true, json: async () => mockResults });

        const result = await source.fetchMedia('movie', 10);
        expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test('processTMDBItem with includeStreaming=true fetches streaming data', async () => {
        const item = {
            id: 123,
            title: 'Test Movie',
            backdrop_path: '/backdrop.jpg',
            poster_path: '/poster.jpg',
            genre_ids: [28],
            vote_average: 7.5,
            release_date: '2020-01-01',
            overview: 'Test overview',
        };

        const genreMap = new Map([[28, 'Action']]);
        const mockStreamingData = {
            results: {
                US: {
                    flatrate: [{ provider_name: 'Netflix', logo_path: '/netflix.jpg' }],
                },
            },
        };

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockStreamingData,
        });

        const processed = await source.processTMDBItem(item, 'movie', genreMap, true);
        expect(processed.streaming).toBeDefined();
        expect(processed.streaming.available).toBe(true);
    });

    test('processTMDBItem handles streaming fetch error gracefully', async () => {
        source.isDebug = true;
        const item = {
            id: 123,
            title: 'Test Movie',
            genre_ids: [],
            release_date: '2020-01-01',
        };

        global.fetch.mockRejectedValueOnce(new Error('Network error'));

        const processed = await source.processTMDBItem(item, 'movie', new Map(), true);
        // Should handle error gracefully with proper structure
        expect(processed.streaming).toBeDefined();
        expect(processed.streaming.providers).toBeDefined();
        expect(Array.isArray(processed.streaming.providers)).toBe(true);
    });
});
