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

function buildValidMotionZipBuffer() {
    const zip = new AdmZip();
    zip.addFile(
        'metadata.json',
        Buffer.from(
            JSON.stringify(
                {
                    title: 'Test Movie',
                    year: 2024,
                    mediaType: 'movie',
                    packType: 'motion',
                    isMotionPoster: true,
                },
                null,
                2
            ),
            'utf8'
        )
    );
    zip.addFile('poster.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    zip.addFile('thumbnail.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    zip.addFile('motion.mp4', Buffer.from('not-a-real-mp4-but-ok'));
    return zip.toBuffer();
}

function buildInvalidMotionZipBuffer_NoMetadata() {
    const zip = new AdmZip();
    zip.addFile('poster.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    zip.addFile('motion.mp4', Buffer.from('no-metadata'));
    return zip.toBuffer();
}

describe('POST /api/local/upload (motion ZIP posterpacks)', () => {
    let tempRoot;
    let app;

    beforeAll(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'posterrama-upload-motion-'));
        await fs.ensureDir(path.join(tempRoot, 'motion'));

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

    test('accepts a valid motion posterpack ZIP uploaded to motion/', async () => {
        const buf = buildValidMotionZipBuffer();
        const res = await request(app)
            .post('/api/local/upload')
            .field('targetDirectory', 'motion')
            .attach('files', buf, {
                filename: 'Test Movie (2024).zip',
                contentType: 'application/zip',
            });

        expect(res.status).toBe(200);
        expect(res.body).toBeTruthy();
        expect(res.body.success).toBe(true);
        expect(res.body.targetDirectory).toBe('motion');
        expect(Array.isArray(res.body.uploadedFiles)).toBe(true);
        expect(res.body.uploadedFiles.length).toBe(1);

        const savedPath = res.body.uploadedFiles[0].path;
        expect(await fs.pathExists(savedPath)).toBe(true);
        expect(savedPath).toContain(`${path.sep}motion${path.sep}`);
    });

    test('rejects an invalid motion ZIP (missing metadata.json) and deletes it', async () => {
        const buf = buildInvalidMotionZipBuffer_NoMetadata();
        const res = await request(app)
            .post('/api/local/upload')
            .field('targetDirectory', 'motion')
            .attach('files', buf, {
                filename: 'Bad Pack.zip',
                contentType: 'application/zip',
            });

        expect(res.status).toBe(400);
        expect(res.body).toBeTruthy();
        expect(res.body.success).toBe(false);
        expect(Array.isArray(res.body.errors)).toBe(true);
        expect(res.body.errors.length).toBeGreaterThan(0);

        // Ensure nothing remains in motion/
        const motionDir = path.join(tempRoot, 'motion');
        const files = await fs.readdir(motionDir);
        expect(files.filter(f => /bad pack\.zip/i.test(f)).length).toBe(0);
    });
});
