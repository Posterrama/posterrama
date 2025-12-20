const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const AdmZip = require('adm-zip');

const {
    createMockAdminAuth,
    createMockAsyncHandler,
    createMockLogger,
    setupTestApp,
} = require('../test-utils/route-test-helpers');

describe('Local directory security regression tests', () => {
    let tempRoot;
    let outsideRoot;
    let app;

    beforeAll(async () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'posterrama-localsec-'));
        outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'posterrama-outside-'));

        fs.writeFileSync(path.join(tempRoot, 'one.txt'), 'hello');
        fs.writeFileSync(path.join(outsideRoot, 'outside.txt'), 'secret');

        // Create a symlink inside tempRoot pointing to a file outside tempRoot
        try {
            fs.symlinkSync(
                path.join(outsideRoot, 'outside.txt'),
                path.join(tempRoot, 'outside-link.txt')
            );
        } catch (_) {
            // Some CI/filesystems may not allow symlinks; tests will skip symlink assertions in that case.
        }

        const createLocalDirectoryRouter = require('../../routes/local-directory');
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
            localDirectorySource: null,
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

    afterAll(() => {
        try {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch (_) {
            // best-effort cleanup
        }
        try {
            fs.rmSync(outsideRoot, { recursive: true, force: true });
        } catch (_) {
            // best-effort cleanup
        }
    });

    test('GET /api/local/download rejects traversal outside base', async () => {
        const res = await request(app).get('/api/local/download').query({ path: '../outside.txt' });

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
            error: 'Invalid path',
        });
    });

    test('GET /api/local/download rejects symlinks (if supported)', async () => {
        const linkPath = path.join(tempRoot, 'outside-link.txt');
        if (!fs.existsSync(linkPath) || !fs.lstatSync(linkPath).isSymbolicLink()) {
            return;
        }

        const res = await request(app)
            .get('/api/local/download')
            .query({ path: 'outside-link.txt' });

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
            error: 'Invalid path',
        });
    });

    test('GET /api/local/download-all skips symlink entries (if supported)', async () => {
        const linkPath = path.join(tempRoot, 'outside-link.txt');
        if (!fs.existsSync(linkPath) || !fs.lstatSync(linkPath).isSymbolicLink()) {
            return;
        }

        const res = await request(app)
            .get('/api/local/download-all')
            .query({ path: '.' })
            .buffer(true)
            .parse((res, cb) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => cb(null, Buffer.concat(chunks)));
            });

        expect(res.status).toBe(200);
        const zip = new AdmZip(res.body);
        const names = zip.getEntries().map(e => e.entryName);
        expect(names.some(n => n.endsWith('/outside-link.txt'))).toBe(false);
    });
});
