/**
 * @file __tests__/api/admin-preview-media.test.js
 * Tests for authenticated admin preview media endpoint.
 */

const express = require('express');
const request = require('supertest');

const PlexSource = require('../../sources/plex');

jest.mock('../../sources/plex');

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

function createTestApp({ isAuthenticatedImpl, readConfigImpl }) {
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
        fetch: () => {
            throw new Error('fetch not stubbed');
        },
        ApiError,
        NotFoundError,
        asyncHandler,
        isAuthenticated: isAuthenticatedImpl,
        getPlexClient: jest.fn(),
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

describe('POST /api/admin/media/preview', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns music albums when enabled via preview body', async () => {
        const mockAlbums = [
            {
                key: 'plex-album-1',
                type: 'music',
                title: 'Abbey Road',
                artist: 'The Beatles',
                posterUrl: '/library/metadata/1/thumb',
                source: 'plex',
            },
        ];

        PlexSource.prototype.fetchMusic = jest.fn().mockResolvedValue(mockAlbums);

        const app = createTestApp({
            isAuthenticatedImpl: (req, res, next) => next(),
            readConfigImpl: jest.fn().mockResolvedValue({
                rottenTomatoesMinimumScore: 0,
                mediaServers: [
                    {
                        type: 'plex',
                        enabled: true,
                        name: 'Test Plex',
                        musicLibraryNames: ['Music'],
                        musicFilters: { genres: ['Rock'] },
                    },
                ],
                wallartMode: {
                    musicMode: { enabled: false },
                },
            }),
        });

        const res = await request(app)
            .post('/api/admin/media/preview')
            .send({
                count: 50,
                musicMode: '1',
                wallartMode: {
                    musicMode: { enabled: true },
                },
            })
            .expect(200);

        expect(res.body).toEqual(mockAlbums);
        expect(PlexSource.prototype.fetchMusic).toHaveBeenCalledWith(
            ['Music'],
            50,
            expect.objectContaining({ genres: ['Rock'] })
        );
    });

    it('returns 401 when auth denies', async () => {
        const app = createTestApp({
            isAuthenticatedImpl: (req, res) => res.status(401).json({ error: 'unauthorized' }),
            readConfigImpl: jest.fn().mockResolvedValue({ mediaServers: [] }),
        });

        await request(app)
            .post('/api/admin/media/preview')
            .send({
                musicMode: '1',
                wallartMode: { musicMode: { enabled: true } },
            })
            .expect(401);
    });
});
