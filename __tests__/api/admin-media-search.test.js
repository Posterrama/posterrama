/**
 * @file __tests__/api/admin-media-search.test.js
 * Tests for authenticated admin media search and lookup fallbacks.
 */

const express = require('express');
const request = require('supertest');

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

class ApiError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

class NotFoundError extends Error {
    constructor(message) {
        super(message || 'Not found');
        this.statusCode = 404;
    }
}

function createTestApp({
    isAuthenticatedImpl,
    readConfigImpl,
    getPlaylistCacheImpl,
    getPlexClientImpl,
    processPlexItemImpl,
    fetchImpl,
}) {
    const app = express();
    app.use(express.json());

    const createMediaRouter = require('../../routes/media');

    const router = createMediaRouter({
        config: { mediaServers: [] },
        logger: {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
        },
        isDebug: false,
        fsp: {},
        fetch:
            fetchImpl ||
            (() => {
                throw new Error('fetch not stubbed');
            }),
        ApiError,
        NotFoundError,
        asyncHandler,
        isAuthenticated: isAuthenticatedImpl,
        getPlexClient: getPlexClientImpl,
        processPlexItem: processPlexItemImpl,
        getPlexLibraries: jest.fn(),
        shuffleArray: items => items,
        getPlaylistCache: getPlaylistCacheImpl,
        isPlaylistRefreshing: () => false,
        readConfig: readConfigImpl,
        cacheDiskManager: {},
        validateGetMediaQuery: (req, res, next) => next(),
        validateMediaKeyParam: (req, res, next) => next(),
        validateImageQuery: (req, res, next) => next(),
        apiCacheMiddleware: { media: (req, res, next) => next() },
    });

    app.use('/', router);

    // Minimal error handler
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        const status = err?.statusCode || err?.status || 500;
        res.status(status).json({
            error: err?.name || 'Error',
            message: err?.message || 'Internal server error',
            statusCode: status,
        });
    });

    return app;
}

describe('Admin media search + lookup fallbacks', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('GET /api/admin/media/search deep-searches Plex when cache results are insufficient', async () => {
        const plexQuery = jest.fn().mockResolvedValue({
            MediaContainer: {
                Hub: [
                    {
                        Metadata: [
                            {
                                type: 'movie',
                                title: 'Terminator 2: Judgment Day',
                                ratingKey: '222',
                                year: 1991,
                                thumb: '/library/metadata/222/thumb',
                                art: '/library/metadata/222/art',
                            },
                            {
                                type: 'movie',
                                title: 'Terminator 3: Rise of the Machines',
                                key: '/library/metadata/333',
                                year: 2003,
                            },
                        ],
                    },
                ],
            },
        });

        const app = createTestApp({
            isAuthenticatedImpl: (req, res, next) => next(),
            readConfigImpl: jest.fn().mockResolvedValue({
                mediaServers: [{ type: 'plex', enabled: true, name: 'TestServer' }],
            }),
            getPlaylistCacheImpl: () => ({
                cache: [
                    {
                        key: 'plex-TestServer-111',
                        title: 'The Terminator',
                        year: 1984,
                        type: 'movie',
                        source: 'plex',
                        posterUrl: '/image?server=TestServer&path=%2Fthumb',
                    },
                ],
            }),
            getPlexClientImpl: jest.fn().mockResolvedValue({ query: plexQuery }),
            processPlexItemImpl: jest.fn(),
        });

        const res = await request(app)
            .get('/api/admin/media/search')
            .query({ q: 'terminator', type: 'all', source: 'any', limit: 10 })
            .expect(200);

        expect(Array.isArray(res.body.results)).toBe(true);
        expect(res.body.results.length).toBeGreaterThanOrEqual(3);

        const keys = res.body.results.map(r => r.key);
        expect(keys).toContain('plex-TestServer-111');
        expect(keys).toContain('plex-TestServer-222');
        expect(keys).toContain('plex-TestServer-333');

        expect(plexQuery).toHaveBeenCalled();
    });

    it('GET /api/admin/media/search supports TMDB when source=tmdb (no Plex dependency)', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    {
                        media_type: 'movie',
                        id: 123,
                        title: 'Alien',
                        release_date: '1979-05-25',
                        poster_path: '/p.jpg',
                        backdrop_path: '/b.jpg',
                    },
                    {
                        media_type: 'tv',
                        id: 456,
                        name: 'Alien Nation',
                        first_air_date: '1989-09-18',
                        poster_path: '/p2.jpg',
                        backdrop_path: null,
                    },
                    // filtered out
                    { media_type: 'person', id: 999, name: 'Sigourney Weaver' },
                ],
            }),
        });

        const app = createTestApp({
            isAuthenticatedImpl: (req, res, next) => next(),
            readConfigImpl: jest.fn().mockResolvedValue({
                mediaServers: [],
                tmdbSource: { enabled: true, apiKey: 'KEY' },
            }),
            getPlaylistCacheImpl: () => ({ cache: [] }),
            getPlexClientImpl: jest.fn(),
            processPlexItemImpl: jest.fn(),
            fetchImpl,
        });

        const res = await request(app)
            .get('/api/admin/media/search')
            .query({ q: 'alien', type: 'all', source: 'tmdb', limit: 10 })
            .expect(200);

        expect(Array.isArray(res.body.results)).toBe(true);
        const keys = res.body.results.map(r => r.key);
        expect(keys).toContain('tmdb_movie_123');
        expect(keys).toContain('tmdb_tv_456');

        const sources = res.body.results.map(r => r.source);
        expect(sources.every(s => s === 'tmdb')).toBe(true);

        expect(fetchImpl).toHaveBeenCalled();
    });

    it('GET /api/admin/media/search supports RomM when source=romm (paged {items} response)', async () => {
        jest.doMock('../../sources/romm', () => {
            return jest.fn().mockImplementation(() => {
                return {
                    getClient: async () => ({
                        getRoms: jest.fn().mockResolvedValue({
                            items: [
                                {
                                    id: 42,
                                    name: 'Super Mario World',
                                    url_cover: 'https://example.invalid/cover.jpg',
                                    // RomM may return epoch milliseconds; ensure we normalize correctly.
                                    metadatum: { first_release_date: 725846400000 },
                                    platform_name: 'Super Nintendo Entertainment System',
                                },
                            ],
                            total: 1,
                            limit: 50,
                            offset: 0,
                            char_index: {},
                        }),
                    }),
                };
            });
        });

        const app = createTestApp({
            isAuthenticatedImpl: (req, res, next) => next(),
            readConfigImpl: jest.fn().mockResolvedValue({
                mediaServers: [
                    {
                        type: 'romm',
                        enabled: true,
                        name: 'Romm1',
                        selectedPlatforms: [1],
                    },
                ],
            }),
            getPlaylistCacheImpl: () => ({ cache: [] }),
            getPlexClientImpl: jest.fn(),
            processPlexItemImpl: jest.fn(),
        });

        const res = await request(app)
            .get('/api/admin/media/search')
            .query({ q: 'mario', type: 'all', source: 'romm', limit: 10 })
            .expect(200);

        expect(Array.isArray(res.body.results)).toBe(true);
        const keys = res.body.results.map(r => r.key);
        expect(keys).toContain('romm_Romm1_42');

        const entry = res.body.results.find(r => r.key === 'romm_Romm1_42');
        expect(entry && entry.year).toBe(1993);
        expect(entry && entry.platform).toBe('Super Nintendo Entertainment System');

        const sources = res.body.results.map(r => r.source);
        expect(sources.every(s => s === 'romm')).toBe(true);
    });

    it('GET /api/media/lookup can resolve Plex keys not present in playlist cache', async () => {
        const plexQuery = jest.fn().mockResolvedValue({
            MediaContainer: {
                Metadata: [
                    {
                        ratingKey: '333',
                        title: 'Terminator 3: Rise of the Machines',
                        type: 'movie',
                    },
                ],
            },
        });

        const processPlexItem = jest.fn().mockResolvedValue({
            key: 'plex-TestServer-333',
            title: 'Terminator 3: Rise of the Machines',
            year: 2003,
            posterUrl: '/image?server=TestServer&path=%2Fthumb',
            source: 'plex',
        });

        const app = createTestApp({
            isAuthenticatedImpl: (req, res, next) => next(),
            readConfigImpl: jest.fn().mockResolvedValue({
                mediaServers: [{ type: 'plex', enabled: true, name: 'TestServer' }],
            }),
            getPlaylistCacheImpl: () => ({ cache: [] }),
            getPlexClientImpl: jest.fn().mockResolvedValue({ query: plexQuery }),
            processPlexItemImpl: processPlexItem,
        });

        const requestedKey = 'plex-TestServer-333';
        const res = await request(app)
            .get('/api/media/lookup')
            .query({ key: requestedKey })
            .expect(200);

        expect(res.body.result).toBeTruthy();
        expect(res.body.result.key).toBe(requestedKey);
        expect(res.body.result.title).toContain('Terminator 3');

        expect(plexQuery).toHaveBeenCalled();
        expect(processPlexItem).toHaveBeenCalled();
    });
});
