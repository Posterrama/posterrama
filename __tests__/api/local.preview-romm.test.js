const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const request = require('supertest');

// Mock RommSource to avoid network calls
jest.mock('../../sources/romm', () => {
    return class MockRommSource {
        constructor(_server, _shuffleArray, _isDebug) {
            // no-op
        }
        async getClient() {
            return {
                getRoms: async ({ platform_id, limit, offset }) => {
                    // One-page result; ensure the router exits its paging loop.
                    if (!platform_id) throw new Error('platform_id missing');
                    if (offset && offset > 0) return { items: [], total: 1 };
                    return {
                        items: [
                            {
                                name: 'Test Game',
                                url_cover: 'http://example.invalid/cover.jpg',
                                metadatum: {
                                    first_release_date: 1700000000,
                                },
                            },
                        ],
                        total: 1,
                        limit: limit || 250,
                        offset: offset || 0,
                    };
                },
            };
        }
    };
});

const LocalDirectorySource = require('../../sources/local');

const {
    createMockAdminAuth,
    createMockAsyncHandler,
    createMockLogger,
    setupTestApp,
} = require('../test-utils/route-test-helpers');

describe('POST /api/local/preview-posterpack (romm)', () => {
    let tempRoot;
    let app;

    beforeAll(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'posterrama-preview-romm-'));
        await fs.ensureDir(tempRoot);

        const createLocalDirectoryRouter = require('../../routes/local-directory');
        const localDirectorySource = new LocalDirectorySource({
            localDirectory: {
                enabled: true,
                rootPath: tempRoot,
            },
        });

        const router = createLocalDirectoryRouter({
            logger: createMockLogger(),
            config: {
                localDirectory: {
                    enabled: true,
                    rootPath: tempRoot,
                },
                mediaServers: [
                    {
                        enabled: true,
                        type: 'romm',
                        name: 'Romm',
                        url: 'http://romm.invalid',
                        username: 'u',
                        password: 'p',
                    },
                ],
            },
            express: require('express'),
            asyncHandler: createMockAsyncHandler,
            isAuthenticated: createMockAdminAuth(true),
            isDebug: false,
            localDirectorySource,
            jobQueue: null,
            uploadMiddleware: null,
            cacheManager: null,
            refreshPlaylistCache: async () => {},
            fs,
            path,
            getPlexClient: async () => null,
            getJellyfinClient: async () => null,
        });

        app = setupTestApp(router, '/');
    });

    afterAll(async () => {
        try {
            await fs.remove(tempRoot);
        } catch (_) {
            // best-effort cleanup
        }
    });

    test('returns a preview including exampleItems', async () => {
        const res = await request(app)
            .post('/api/local/preview-posterpack')
            .send({
                sourceType: 'romm',
                platformId: 'nintendo-64',
                options: {
                    yearFilter: '',
                    limit: 100,
                },
            });

        expect(res.status).toBe(200);
        expect(res.body).toBeTruthy();
        expect(res.body.summary?.sourceType).toBe('romm');
        expect(Array.isArray(res.body.exampleItems)).toBe(true);
        expect(res.body.exampleItems.length).toBeGreaterThan(0);
        expect(res.body.exampleItems[0].title).toBe('Test Game');
    });
});
