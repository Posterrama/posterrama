/**
 * @file __tests__/api/admin-media-details.test.js
 * Tests for authenticated admin media details endpoint.
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
    getPlexClientImpl,
    fetchImpl,
    jellyfinClientImpl,
}) {
    const app = express();
    app.use(express.json());

    if (jellyfinClientImpl) {
        jest.doMock('../../lib/jellyfin-helpers', () => {
            return {
                getJellyfinClient: async () => jellyfinClientImpl,
                processJellyfinItem: jest.fn(),
            };
        });
    }

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
        getPlexClient: getPlexClientImpl || jest.fn(),
        processPlexItem: jest.fn(),
        getPlexLibraries: jest.fn(),
        shuffleArray: items => items,
        getPlaylistCache: () => ({ cache: [] }),
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

describe('Admin media details', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('GET /api/admin/media/details returns cast/director for TMDB movie keys', async () => {
        const fetchImpl = jest.fn(async () => {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    credits: {
                        cast: [{ name: 'Actor A' }, { name: 'Actor B' }, { name: 'Actor C' }],
                        crew: [{ job: 'Director', name: 'Director X' }],
                    },
                }),
            };
        });

        const app = createTestApp({
            isAuthenticatedImpl: (req, res, next) => next(),
            readConfigImpl: jest.fn().mockResolvedValue({
                tmdbSource: { apiKey: 'abc', enabled: true },
                mediaServers: [],
            }),
            fetchImpl,
        });

        const res = await request(app)
            .get('/api/admin/media/details')
            .query({ key: 'tmdb_movie_123' })
            .expect(200);

        expect(res.body.details).toMatchObject({
            key: 'tmdb_movie_123',
            cast: ['Actor A', 'Actor B', 'Actor C'],
            director: 'Director X',
        });
        expect(fetchImpl).toHaveBeenCalled();
    });

    it('GET /api/admin/media/details returns cast/director for Plex keys', async () => {
        const plexQuery = jest.fn().mockResolvedValue({
            MediaContainer: {
                Metadata: [
                    {
                        Role: [{ tag: 'Star 1' }, { tag: 'Star 2' }, { tag: 'Star 3' }],
                        Director: [{ tag: 'Boss Director' }],
                    },
                ],
            },
        });

        const app = createTestApp({
            isAuthenticatedImpl: (req, res, next) => next(),
            readConfigImpl: jest.fn().mockResolvedValue({
                mediaServers: [{ type: 'plex', enabled: true, name: 'My Plex' }],
            }),
            getPlexClientImpl: jest.fn().mockResolvedValue({ query: plexQuery }),
        });

        const res = await request(app)
            .get('/api/admin/media/details')
            .query({ key: 'plex-My Plex-222' })
            .expect(200);

        expect(res.body.details).toMatchObject({
            key: 'plex-My Plex-222',
            cast: ['Star 1', 'Star 2', 'Star 3'],
            director: 'Boss Director',
        });
    });

    it('GET /api/admin/media/details returns cast/director for Jellyfin keys', async () => {
        const jellyfinClientImpl = {
            http: {
                get: jest.fn().mockResolvedValue({
                    data: {
                        Items: [
                            {
                                People: [
                                    { Type: 'Actor', Name: 'Actor J1' },
                                    { Type: 'Actor', Name: 'Actor J2' },
                                    { Type: 'Director', Name: 'Director J' },
                                ],
                            },
                        ],
                    },
                }),
            },
        };

        const app = createTestApp({
            isAuthenticatedImpl: (req, res, next) => next(),
            readConfigImpl: jest.fn().mockResolvedValue({
                mediaServers: [{ type: 'jellyfin', enabled: true, name: 'JFSrv' }],
            }),
            jellyfinClientImpl,
        });

        const res = await request(app)
            .get('/api/admin/media/details')
            .query({ key: 'jellyfin_JFSrv_abc123' })
            .expect(200);

        expect(res.body.details).toMatchObject({
            key: 'jellyfin_JFSrv_abc123',
            cast: ['Actor J1', 'Actor J2'],
            director: 'Director J',
        });

        expect(jellyfinClientImpl.http.get).toHaveBeenCalled();
    });
});
