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

describe('POST /api/local/upload (complete -> complete/manual)', () => {
    let tempRoot;
    let app;

    beforeAll(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'posterrama-upload-complete-'));
        await fs.ensureDir(path.join(tempRoot, 'complete', 'manual'));

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

    test('uploads ZIPs to complete/manual even when targeting complete', async () => {
        const zip = new AdmZip();
        zip.addFile('metadata.json', Buffer.from('{"title":"Test"}', 'utf8'));
        // Minimal valid posterpack indicator
        zip.addFile('poster.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const buf = zip.toBuffer();

        const res = await request(app)
            .post('/api/local/upload')
            .field('targetDirectory', 'complete')
            .attach('files', buf, {
                filename: 'My Pack.zip',
                contentType: 'application/zip',
            });

        expect(res.status).toBe(200);
        expect(res.body).toBeTruthy();
        expect(res.body.targetDirectory).toBe('complete');
        expect(Array.isArray(res.body.uploadedFiles)).toBe(true);
        expect(res.body.uploadedFiles.length).toBe(1);

        const savedPath = res.body.uploadedFiles[0].path;
        expect(savedPath).toContain(`${path.sep}complete${path.sep}manual${path.sep}`);
        expect(await fs.pathExists(savedPath)).toBe(true);
    });

    test('rejects junk ZIPs uploaded to complete/ (no posterpack assets)', async () => {
        const zip = new AdmZip();
        zip.addFile('metadata.json', Buffer.from('{"title":"No Assets"}', 'utf8'));
        const buf = zip.toBuffer();

        const res = await request(app)
            .post('/api/local/upload')
            .field('targetDirectory', 'complete')
            .attach('files', buf, {
                filename: 'Junk.zip',
                contentType: 'application/zip',
            });

        expect(res.status).toBe(400);
        expect(res.body).toBeTruthy();
        expect(res.body.success).toBe(false);
        expect(Array.isArray(res.body.errors)).toBe(true);
        expect(res.body.errors.length).toBeGreaterThan(0);

        const manualDir = path.join(tempRoot, 'complete', 'manual');
        const files = await fs.readdir(manualDir);
        expect(files.filter(f => /junk\.zip/i.test(f)).length).toBe(0);
    });
});
