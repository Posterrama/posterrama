const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const request = require('supertest');
const AdmZip = require('adm-zip');

const LocalDirectorySource = require('../../sources/local');

const {
    createMockAdminAuth,
    createMockAsyncHandler,
    createMockLogger,
    setupTestApp,
} = require('../test-utils/route-test-helpers');

// 1x1 PNG data URL
const DATA_URL_PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PcDq3wAAAABJRU5ErkJggg==';

describe('POST /api/local/generate-motion-posterpack', () => {
    let tempRoot;
    let app;

    beforeAll(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'posterrama-motiongen-'));
        await fs.ensureDir(path.join(tempRoot, 'motion'));

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
            },
            express: require('express'),
            asyncHandler: createMockAsyncHandler,
            isAuthenticated: createMockAdminAuth(true),
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

    test('creates a motion ZIP under motion/ with required entries and motion metadata', async () => {
        const res = await request(app)
            .post('/api/local/generate-motion-posterpack')
            .send({
                key: 'plex-Test-123',
                title: 'Test Motion Movie',
                year: 2024,
                mediaType: 'movie',
                posterUrl: DATA_URL_PNG_1PX,
                options: { overwrite: true, testMode: true },
            });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true });
        expect(typeof res.body.zipPath).toBe('string');

        const zipPath = res.body.zipPath;
        expect(await fs.pathExists(zipPath)).toBe(true);
        expect(zipPath).toContain(`${path.sep}motion${path.sep}`);

        const zip = new AdmZip(await fs.readFile(zipPath));
        const names = zip.getEntries().map(e => e.entryName);

        expect(names).toContain('poster.jpg');
        expect(names).toContain('thumbnail.jpg');
        expect(names).toContain('motion.mp4');
        expect(names).toContain('metadata.json');

        const metadata = JSON.parse(zip.readAsText('metadata.json'));
        expect(metadata).toMatchObject({
            packType: 'motion',
            mediaType: 'movie',
            isMotionPoster: true,
            title: 'Test Motion Movie',
            year: 2024,
        });

        const src = new LocalDirectorySource({
            localDirectory: {
                enabled: true,
                rootPath: tempRoot,
            },
        });
        const items = await src.fetchMedia([''], 'motion', 50);
        expect(items.some(i => i.title === 'Test Motion Movie' && i.isMotionPoster)).toBe(true);
    });
});
