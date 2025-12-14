/**
 * @file __tests__/api/media-lookup.test.js
 * Tests for public media lookup endpoint used by Cinema pinning.
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

function createTestApp({ playlistItems }) {
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
        isAuthenticated: (req, res, next) => next(),
        getPlexClient: jest.fn(),
        processPlexItem: jest.fn(),
        getPlexLibraries: jest.fn(),
        shuffleArray: items => items,
        getPlaylistCache: () => ({ cache: playlistItems }),
        isPlaylistRefreshing: () => false,
        readConfig: jest.fn(),
        cacheDiskManager: {},
        validateGetMediaQuery: (req, res, next) => next(),
        validateMediaKeyParam: (req, res, next) => next(),
        validateImageQuery: (req, res, next) => next(),
        apiCacheMiddleware: { media: (req, res, next) => next() },
    });

    app.use('/', router);

    // Minimal error handler for ApiError/NotFoundError
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

describe('GET /api/media/lookup', () => {
    it('returns null for missing key', async () => {
        const app = createTestApp({ playlistItems: [] });
        const res = await request(app).get('/api/media/lookup').expect(200);
        expect(res.body).toEqual({ result: null });
    });

    it('returns null when not found', async () => {
        const app = createTestApp({ playlistItems: [{ key: 'plex-1', title: 'Test' }] });
        const res = await request(app)
            .get('/api/media/lookup')
            .query({ key: 'plex-999' })
            .expect(200);
        expect(res.body).toEqual({ result: null });
    });

    it('returns a minimal media object when found', async () => {
        const app = createTestApp({
            playlistItems: [
                {
                    key: 'plex-123',
                    title: 'Inception',
                    year: 2010,
                    type: 'movie',
                    source: 'plex',
                    posterUrl: '/poster.jpg',
                    backdropUrl: '/backdrop.jpg',
                },
            ],
        });

        const res = await request(app)
            .get('/api/media/lookup')
            .query({ key: 'plex-123' })
            .expect(200);

        expect(res.body).toEqual({
            result: {
                key: 'plex-123',
                title: 'Inception',
                year: 2010,
                type: 'movie',
                source: 'plex',
                posterUrl: '/poster.jpg',
                backdropUrl: '/backdrop.jpg',
            },
        });
    });

    it('rejects excessively long keys', async () => {
        const app = createTestApp({ playlistItems: [] });
        const longKey = 'x'.repeat(513);
        const res = await request(app).get('/api/media/lookup').query({ key: longKey }).expect(400);
        expect(res.body).toMatchObject({ statusCode: 400 });
    });
});
