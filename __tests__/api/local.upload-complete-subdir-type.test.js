const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const request = require('supertest');
const AdmZip = require('adm-zip');

const LocalDirectorySource = require('../../sources/local');
const { createUploadMiddleware } = require('../../middleware/fileUpload');

const {
    createMockAdminAuth,
    createMockAsyncHandler,
    createMockLogger,
    setupTestApp,
} = require('../test-utils/route-test-helpers');

describe('POST /api/local/upload (complete subfolder + type validation)', () => {
    let tempRoot;
    let app;

    beforeAll(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'posterrama-upload-complete-subdir-'));
        await fs.ensureDir(path.join(tempRoot, 'complete', 'manual'));
        await fs.ensureDir(path.join(tempRoot, 'complete', 'plex-export'));
        await fs.ensureDir(path.join(tempRoot, 'complete', 'romm-export'));

        const createLocalDirectoryRouter = require('../../routes/local-directory');
        const localDirectorySource = new LocalDirectorySource({
            localDirectory: {
                enabled: true,
                rootPath: tempRoot,
            },
        });

        const uploadMiddleware = createUploadMiddleware({
            enabled: true,
            rootPath: tempRoot,
        }).array('files');

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
            isDebug: false,
            localDirectorySource,
            jobQueue: null,
            uploadMiddleware,
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

    function makeZip(metaObj) {
        const zip = new AdmZip();
        if (metaObj !== undefined) {
            zip.addFile('metadata.json', Buffer.from(JSON.stringify(metaObj), 'utf8'));
        }
        // Minimal valid posterpack indicator for backend validation
        zip.addFile('poster.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        return zip.toBuffer();
    }

    test('routes complete uploads into the requested complete subfolder', async () => {
        const buf = makeZip({ itemType: 'movie', title: 'Test Movie' });
        const res = await request(app)
            .post('/api/local/upload')
            .field('targetDirectory', 'complete')
            .field('completeSubdir', 'plex-export')
            .attach('files', buf, {
                filename: 'Movie.zip',
                contentType: 'application/zip',
            });

        expect(res.status).toBe(200);
        expect(res.body).toBeTruthy();
        expect(res.body.targetDirectory).toBe('complete');
        expect(res.body.completeSubdir).toBe('plex-export');

        const savedPath = res.body.uploadedFiles[0].path;
        expect(savedPath).toContain(`${path.sep}complete${path.sep}plex-export${path.sep}`);
        expect(await fs.pathExists(savedPath)).toBe(true);
    });

    test('rejects game posterpacks uploaded into plex-export', async () => {
        const buf = makeZip({ itemType: 'game', title: 'Test Game' });
        const res = await request(app)
            .post('/api/local/upload')
            .field('targetDirectory', 'complete')
            .field('completeSubdir', 'plex-export')
            .attach('files', buf, {
                filename: 'Game.zip',
                contentType: 'application/zip',
            });

        expect(res.status).toBe(400);
        expect(res.body).toBeTruthy();
        expect(res.body.success).toBe(false);
        expect(Array.isArray(res.body.errors)).toBe(true);
        expect(res.body.errors.length).toBeGreaterThan(0);
    });

    test('rejects non-game posterpacks uploaded into romm-export', async () => {
        const buf = makeZip({ itemType: 'movie', title: 'Not a game' });
        const res = await request(app)
            .post('/api/local/upload')
            .field('targetDirectory', 'complete')
            .field('completeSubdir', 'romm-export')
            .attach('files', buf, {
                filename: 'Movie.zip',
                contentType: 'application/zip',
            });

        expect(res.status).toBe(400);
        expect(res.body).toBeTruthy();
        expect(res.body.success).toBe(false);
        expect(Array.isArray(res.body.errors)).toBe(true);
        expect(res.body.errors.length).toBeGreaterThan(0);
    });

    test('rejects missing metadata when uploading into an export folder', async () => {
        const buf = makeZip(undefined);
        const res = await request(app)
            .post('/api/local/upload')
            .field('targetDirectory', 'complete')
            .field('completeSubdir', 'plex-export')
            .attach('files', buf, {
                filename: 'NoMeta.zip',
                contentType: 'application/zip',
            });

        expect(res.status).toBe(400);
        expect(res.body).toBeTruthy();
        expect(res.body.success).toBe(false);
        expect(Array.isArray(res.body.errors)).toBe(true);
        expect(res.body.errors.length).toBeGreaterThan(0);
    });

    test('accepts game posterpacks into romm-export', async () => {
        const buf = makeZip({ itemType: 'game', title: 'Test Game' });
        const res = await request(app)
            .post('/api/local/upload')
            .field('targetDirectory', 'complete')
            .field('completeSubdir', 'romm-export')
            .attach('files', buf, {
                filename: 'GameOk.zip',
                contentType: 'application/zip',
            });

        expect(res.status).toBe(200);
        expect(res.body).toBeTruthy();
        expect(res.body.completeSubdir).toBe('romm-export');
        const savedPath = res.body.uploadedFiles[0].path;
        expect(savedPath).toContain(`${path.sep}complete${path.sep}romm-export${path.sep}`);
        expect(await fs.pathExists(savedPath)).toBe(true);
    });
});
