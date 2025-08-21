// Formerly tmdb-source.test.js (renamed to tmdb.comprehensive.test.js)
const TMDBSource = require('../../sources/tmdb');

// We'll mock global fetch
const originalFetch = global.fetch;

function createFetchMock(sequence) {
    let call = 0;
    return jest.fn(async () => {
        const current = sequence[Math.min(call, sequence.length - 1)];
        call++;
        if (current.error) throw current.error;
        return {
            ok: current.ok !== false,
            status: current.status || 200,
            statusText: current.statusText || 'OK',
            json: async () => current.json,
        };
    });
}

describe('TMDBSource', () => {
    const baseConfig = {
        name: 'tmdb1',
        apiKey: 'TEST_KEY',
        category: 'popular',
        minRating: 0,
        watchRegion: 'US',
    };

    const shuffleIdentity = arr => arr; // deterministic for tests
    let source;

    beforeEach(() => {
        // Use real timers; minimize internal delays for fast retry logic
        global.fetch = originalFetch; // reset
        source = new TMDBSource(baseConfig, shuffleIdentity, true);
        // Speed up tests
        source.minRequestInterval = 0;
        source.retryDelay = 1; // 1ms backoff base
    });

    describe('fetchGenreMapping', () => {
        test('caches genre mapping and reuses within TTL', async () => {
            global.fetch = createFetchMock([{ json: { genres: [{ id: 1, name: 'Action' }] } }]);

            const first = await source.fetchGenreMapping('movie');
            expect(first.get(1)).toBe('Action');
            expect(global.fetch).toHaveBeenCalledTimes(1);

            const second = await source.fetchGenreMapping('movie');
            expect(second.get(1)).toBe('Action');
            expect(global.fetch).toHaveBeenCalledTimes(1); // cached
        });

        test('handles API error by returning empty map', async () => {
            global.fetch = createFetchMock([
                { ok: false, status: 500, statusText: 'Server Error' },
            ]);
            const genres = await source.fetchGenreMapping('tv');
            expect(genres.size).toBe(0);
        });
    });

    describe('cachedApiRequest', () => {
        test('returns cached response within TTL', async () => {
            const url = 'https://api.themoviedb.org/3/movie/popular?page=1&api_key=TEST_KEY';
            global.fetch = createFetchMock([{ json: { results: [1] } }]);
            const first = await source.cachedApiRequest(url);
            const second = await source.cachedApiRequest(url);
            expect(first).toEqual({ results: [1] });
            expect(second).toEqual({ results: [1] });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        test('retries on 500 then succeeds', async () => {
            const url = 'https://api.themoviedb.org/3/movie/popular?page=1&api_key=TEST_KEY';
            global.fetch = createFetchMock([
                { ok: false, status: 500, statusText: 'Err' },
                { json: { results: [2] } },
            ]);
            const data = await source.cachedApiRequest(url);
            expect(data.results).toEqual([2]);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        test('max retries on 429 triggers error', async () => {
            const url = 'https://api.themoviedb.org/3/movie/popular?page=1&api_key=TEST_KEY';
            global.fetch = createFetchMock([
                { ok: false, status: 429, statusText: 'Rate' },
                { ok: false, status: 429, statusText: 'Rate' },
                { ok: false, status: 429, statusText: 'Rate' },
                { ok: false, status: 429, statusText: 'Rate' },
            ]);
            await expect(source.cachedApiRequest(url)).rejects.toThrow('rate limit');
            expect(global.fetch).toHaveBeenCalledTimes(4);
        });

        test('handles 401 invalid key', async () => {
            const url = 'https://api.themoviedb.org/3/movie/popular?page=1&api_key=TEST_KEY';
            global.fetch = createFetchMock([
                { ok: false, status: 401, statusText: 'Unauthorized' },
            ]);
            await expect(source.cachedApiRequest(url)).rejects.toThrow('Invalid TMDB API key');
        });

        test('network error retries then fails', async () => {
            const url = 'https://api.themoviedb.org/3/movie/popular?page=1&api_key=TEST_KEY';
            global.fetch = createFetchMock([
                { error: new TypeError('fetch failed 1') },
                { error: new TypeError('fetch failed 2') },
                { error: new TypeError('fetch failed 3') },
                { error: new TypeError('fetch failed 4') },
            ]);
            await expect(source.cachedApiRequest(url)).rejects.toThrow('fetch failed');
            expect(global.fetch).toHaveBeenCalledTimes(4);
        });
    });

    describe('getEndpoint', () => {
        test('handles movie popular default', () => {
            expect(source.getEndpoint('movie', 1)).toBe('/movie/popular?page=1');
        });
        test('handles tv categories', () => {
            source.source.category = 'tv_top_rated';
            expect(source.getEndpoint('tv', 2)).toBe('/tv/top_rated?page=2');
        });
        test('handles streaming netflix tv', () => {
            source.source.category = 'tv_streaming_netflix';
            expect(source.getEndpoint('tv', 1)).toContain('with_watch_providers=8');
        });
        test('handles discover movie', () => {
            source.source.category = 'discover_movie';
            expect(source.getEndpoint('movie', 3)).toBe(
                '/discover/movie?page=3&sort_by=popularity.desc'
            );
        });
        test('handles trending all week', () => {
            source.source.category = 'trending_all_week';
            expect(source.getEndpoint('movie', 1)).toBe('/trending/all/week?page=1');
        });
    });

    describe('formatStreamingProviders', () => {
        test('returns unavailable when no data', () => {
            expect(source.formatStreamingProviders(null)).toEqual({
                available: false,
                providers: [],
            });
        });
        test('formats providers with logos and types', () => {
            const result = source.formatStreamingProviders({
                results: {
                    US: {
                        flatrate: [{ provider_name: 'Netflix', logo_path: '/n.png' }],
                        buy: [{ provider_name: 'iTunes', logo_path: '/i.png' }],
                        rent: [{ provider_name: 'Amazon', logo_path: '/a.png' }],
                        link: 'https://example.com',
                    },
                },
            });
            expect(result.available).toBe(true);
            expect(result.providers).toHaveLength(3);
            expect(result.providers[0].logo).toContain('w92');
            expect(result.link).toBe('https://example.com');
        });
    });

    describe('applyContentFiltering', () => {
        test('filters by rating, genre, and year', () => {
            source.source.minRating = 7;
            source.source.genreFilter = 'Action';
            source.source.yearFilter = 2020;
            const genreMap = new Map([[1, 'Action']]);
            const items = [
                { id: 1, vote_average: 8, genre_ids: [1], release_date: '2023-01-01' },
                { id: 2, vote_average: 6, genre_ids: [1], release_date: '2023-01-01' },
                { id: 3, vote_average: 9, genre_ids: [2], release_date: '2019-01-01' },
            ];
            const filtered = source.applyContentFiltering(items, 'movie', genreMap);
            expect(filtered.map(i => i.id)).toEqual([1]);
        });
    });

    describe('processTMDBItem', () => {
        test('processes movie item without streaming', async () => {
            const genreMap = new Map([[1, 'Action']]);
            const item = {
                id: 10,
                title: 'Test',
                backdrop_path: '/b.jpg',
                poster_path: '/p.jpg',
                overview: 'Desc',
                vote_average: 5,
                release_date: '2024-05-05',
                genre_ids: [1],
            };
            const processed = await source.processTMDBItem(item, 'movie', genreMap, false);
            expect(processed.key).toBe('tmdb-10');
            expect(processed.genres).toEqual(['Action']);
            expect(processed.streaming).toBeUndefined();
        });

        test('adds streaming data when requested', async () => {
            global.fetch = createFetchMock([
                {
                    json: {
                        results: {
                            US: { flatrate: [{ provider_name: 'Netflix', logo_path: '/n.png' }] },
                        },
                    },
                },
            ]);
            const genreMap = new Map();
            const item = { id: 11, name: 'Show', first_air_date: '2024-06-01', genre_ids: [] };
            const processed = await source.processTMDBItem(item, 'tv', genreMap, true);
            expect(processed.streaming.available).toBe(true);
        });
    });

    describe('getAvailableGenres', () => {
        test('combines movie and tv genres', async () => {
            global.fetch = createFetchMock([
                { json: { genres: [{ id: 1, name: 'Action' }] } },
                { json: { genres: [{ id: 2, name: 'Drama' }] } },
            ]);
            const genres = await source.getAvailableGenres();
            expect(genres).toEqual(['Action', 'Drama']);
        });

        test('returns [] on error', async () => {
            global.fetch = createFetchMock([{ error: new Error('fail') }]);
            const genres = await source.getAvailableGenres();
            expect(genres).toEqual([]);
        });
    });

    describe('cleanupCache & getCacheStats', () => {
        test('removes expired entries', async () => {
            // Seed caches
            source.genreCache.set('genres_movie', {
                data: new Map(),
                timestamp: Date.now() - source.cacheTTL - 1000,
            });
            source.responseCache.set('url1', {
                data: { a: 1 },
                timestamp: Date.now() - source.cacheTTL - 1000,
            });
            source.genreCache.set('genres_tv', { data: new Map(), timestamp: Date.now() });
            source.responseCache.set('url2', { data: { b: 2 }, timestamp: Date.now() });

            source.cleanupCache();

            const stats = source.getCacheStats();
            expect(stats.genreCache.total).toBe(1); // 1 remaining
            expect(stats.genreCache.expired).toBe(0); // expired removed
            expect(stats.responseCache.total).toBe(1);
        });
    });

    describe('fetchMedia integration (simplified)', () => {
        test('fetches popular movies with filtering and processing', async () => {
            // Mock genre mapping
            global.fetch = createFetchMock([
                { json: { genres: [{ id: 1, name: 'Action' }] } }, // genre
                {
                    json: {
                        results: [
                            {
                                id: 1,
                                title: 'A',
                                vote_average: 8,
                                release_date: '2024-01-01',
                                genre_ids: [1],
                            },
                            {
                                id: 2,
                                title: 'B',
                                vote_average: 7,
                                release_date: '2024-01-01',
                                genre_ids: [1],
                            },
                        ],
                    },
                },
            ]);
            source.source.minRating = 7.5;
            const items = await source.fetchMedia('movie', 1);
            expect(items).toHaveLength(1);
            expect(items[0].title).toBe('A');
        });

        test('handles latest category single object', async () => {
            // reset filters that may have been set by previous tests
            source.source.genreFilter = '';
            source.source.yearFilter = undefined;
            source.source.category = 'latest';
            source.source.minRating = 0; // ensure no filtering removes item
            global.fetch = createFetchMock([
                { json: { genres: [{ id: 1, name: 'Action' }] } }, // genre
                {
                    json: {
                        id: 99,
                        title: 'Latest Movie',
                        vote_average: 5,
                        release_date: '2024-02-02',
                        genre_ids: [1],
                    },
                },
            ]);
            const items = await source.fetchMedia('movie', 5);
            expect(items[0].tmdbId).toBe(99);
        });

        test('continues on page fetch errors', async () => {
            source.source.genreFilter = '';
            source.source.yearFilter = undefined;
            source.source.category = 'popular';
            source.source.minRating = 0; // disable filtering to keep successful item
            global.fetch = createFetchMock([
                { json: { genres: [] } }, // genre
                { error: new Error('network fail') }, // page 1 fail
                {
                    json: {
                        results: [
                            {
                                id: 1,
                                title: 'X',
                                vote_average: 9,
                                release_date: '2024-01-01',
                                genre_ids: [],
                            },
                        ],
                    },
                }, // page 2 success
            ]);
            const items = await source.fetchMedia('movie', 21); // force 2 pages
            expect(items.length).toBeGreaterThan(0);
        });
    });
});

// Merged former tmdb-source-extra.test.js edge cases
describe('TMDBSource edge cases (merged)', () => {
    const base = {
        name: 'tmdb1',
        apiKey: 'K',
        category: 'streaming_new_releases',
        watchRegion: 'NL',
        minRating: 0,
    };
    const identity = a => a;
    let source;
    const realFetch = global.fetch;
    function buildFetch(sequence) {
        let i = 0;
        return jest.fn(async () => {
            const def = sequence[Math.min(i, sequence.length - 1)];
            i++;
            if (def.error) throw def.error;
            return {
                ok: def.ok !== false,
                status: def.status || 200,
                statusText: def.statusText || 'OK',
                json: async () => def.json || {},
            };
        });
    }
    afterAll(() => {
        global.fetch = realFetch;
    });
    beforeEach(() => {
        source = new (require('../../sources/tmdb'))({ ...base }, identity, true);
        source.minRequestInterval = 0;
        source.retryDelay = 1;
    });

    test('fetchStreamingProviders caches and handles missing region data', async () => {
        global.fetch = buildFetch([
            {
                json: {
                    results: {
                        US: {
                            flatrate: [{ provider_name: 'Prov', logo_path: '/p.png' }],
                            link: 'x',
                        },
                    },
                },
            },
            {
                json: {
                    results: {
                        US: { flatrate: [{ provider_name: 'Prov2', logo_path: '/p2.png' }] },
                    },
                },
            },
        ]);
        const d1 = await source.fetchStreamingProviders('movie', 1);
        expect(d1.results.US.flatrate.length).toBe(1);
        await source.fetchStreamingProviders('movie', 1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const formatted = source.formatStreamingProviders({ results: { XX: {} } }, 'NL');
        expect(formatted.available).toBe(false);
    });

    test('fetchStreamingProviders handles non-ok response and errors', async () => {
        global.fetch = buildFetch([
            { ok: false, status: 500, statusText: 'Err' },
            { error: new Error('boom') },
        ]);
        const bad = await source.fetchStreamingProviders('tv', 7);
        expect(bad).toBeNull();
        const err = await source.fetchStreamingProviders('tv', 8);
        expect(err).toBeNull();
    });

    test('applyContentFiltering returns empty when genre_ids missing for genre filter', () => {
        source.source.genreFilter = 'Action';
        const genreMap = new Map([[1, 'Action']]);
        const items = [
            { id: 1, vote_average: 9 },
            { id: 2, vote_average: 8, genre_ids: [2] },
        ];
        const filtered = source.applyContentFiltering(items, 'movie', genreMap);
        expect(filtered).toHaveLength(0);
    });

    test('getEndpoint streaming_new_releases movie & tv', () => {
        const epMovie = source.getEndpoint('movie', 1);
        expect(epMovie).toContain('with_watch_providers');
        source.source.category = 'tv_streaming_new_releases';
        const epTv = source.getEndpoint('tv', 2);
        expect(epTv).toContain('first_air_date.gte');
    });

    test('cleanupCache removes expired streaming provider cache entries', () => {
        const key = 'streaming_movie_99';
        source.responseCache.set(key, {
            data: { a: 1 },
            timestamp: Date.now() - source.cacheTTL - 10,
        });
        source.cleanupCache();
        expect(source.responseCache.has(key)).toBe(false);
    });

    test('getMetrics and resetMetrics work correctly', () => {
        const metrics = source.getMetrics();
        expect(metrics).toHaveProperty('requestCount');
        expect(metrics).toHaveProperty('cacheHits');
        expect(metrics).toHaveProperty('cacheMisses');
        expect(metrics).toHaveProperty('cacheHitRate');
        expect(metrics).toHaveProperty('cacheSizes');
        expect(typeof metrics.cacheHitRate).toBe('number');

        // Test metrics reset
        source.resetMetrics();
        const resetMetrics = source.getMetrics();
        expect(resetMetrics.requestCount).toBe(0);
        expect(resetMetrics.cacheHits).toBe(0);
        expect(resetMetrics.cacheMisses).toBe(0);
    });
});
