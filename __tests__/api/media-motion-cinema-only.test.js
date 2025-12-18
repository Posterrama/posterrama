/**
 * @file __tests__/api/media-motion-cinema-only.test.js
 * Ensures motion posterpacks are cinema-only via /get-media?mode=cinema.
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

describe('GET /get-media - motion posterpacks cinema-only', () => {
    test('filters out motion posterpacks by default', async () => {
        const playlistItems = [
            { key: 'plex-1', type: 'movie', title: 'Normal Movie', posterUrl: '/p.jpg' },
            {
                key: 'local-motion-1',
                type: 'motion',
                title: 'My Movie',
                motionPosterUrl: '/local-folderpack?dir=motion/My%20Movie%20(2024)&entry=motion',
                isMotionPoster: true,
            },
            {
                key: 'local-motion-2',
                type: 'movie',
                title: 'Weird Motion',
                isMotionPoster: true,
            },
        ];

        const app = createTestApp({ playlistItems });
        const res = await request(app).get('/get-media').expect(200);

        expect(res.body).toEqual([
            { key: 'plex-1', type: 'movie', title: 'Normal Movie', posterUrl: '/p.jpg' },
        ]);
    });

    test('returns motion posterpacks when mode=cinema', async () => {
        const playlistItems = [
            { key: 'plex-1', type: 'movie', title: 'Normal Movie', posterUrl: '/p.jpg' },
            {
                key: 'local-motion-1',
                type: 'motion',
                title: 'My Movie',
                motionPosterUrl: '/local-folderpack?dir=motion/My%20Movie%20(2024)&entry=motion',
                isMotionPoster: true,
            },
        ];

        const app = createTestApp({ playlistItems });
        const res = await request(app).get('/get-media?mode=cinema').expect(200);

        expect(res.body).toEqual(playlistItems);
    });
});
