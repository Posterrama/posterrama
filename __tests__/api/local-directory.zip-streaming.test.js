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

describe('Local directory ZIP endpoints (streaming + limits)', () => {
    let tempRoot;
    let app;

    beforeAll(async () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'posterrama-localzip-'));

        // Create fixture files
        fs.writeFileSync(path.join(tempRoot, 'one.txt'), 'hello');
        fs.mkdirSync(path.join(tempRoot, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(tempRoot, 'sub', 'two.txt'), 'world');

        // Skipped entries
        fs.writeFileSync(path.join(tempRoot, 'sub', 'skip.poster.json'), '{"x":1}');
        fs.mkdirSync(path.join(tempRoot, '.posterrama'), { recursive: true });
        fs.writeFileSync(path.join(tempRoot, '.posterrama', 'secret.txt'), 'nope');

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
    });

    test('GET /api/local/download-all streams a zip and excludes internal entries', async () => {
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
        expect(res.headers['content-type']).toContain('application/zip');
        expect(Buffer.isBuffer(res.body)).toBe(true);
        expect(res.body.slice(0, 2).toString('utf8')).toBe('PK');

        const zip = new AdmZip(res.body);
        const names = zip.getEntries().map(e => e.entryName);

        // Should include real files
        expect(names.some(n => n.endsWith('/one.txt'))).toBe(true);
        expect(names.some(n => n.endsWith('/sub/two.txt'))).toBe(true);

        // Should exclude internal folder and generated metadata
        expect(names.some(n => n.includes('/.posterrama/'))).toBe(false);
        expect(names.some(n => n.endsWith('/skip.poster.json'))).toBe(false);
    });

    test('GET /api/local/download-all returns 413 when file-count limit exceeded', async () => {
        const prev = process.env.LOCAL_ZIP_MAX_FILES;
        process.env.LOCAL_ZIP_MAX_FILES = '1';

        const res = await request(app).get('/api/local/download-all').query({ path: '.' });

        if (prev === undefined) delete process.env.LOCAL_ZIP_MAX_FILES;
        else process.env.LOCAL_ZIP_MAX_FILES = prev;

        expect(res.status).toBe(413);
        expect(res.body).toMatchObject({
            error: 'zip_limits_exceeded',
            reason: 'max_files',
        });
    });

    test('POST /api/local/bulk-download streams a zip (no in-memory buffer)', async () => {
        const res = await request(app)
            .post('/api/local/bulk-download')
            .send({ paths: ['one.txt'] })
            .buffer(true)
            .parse((res, cb) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => cb(null, Buffer.concat(chunks)));
            });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/zip');
        expect(res.body.slice(0, 2).toString('utf8')).toBe('PK');

        // Streaming path should not set Content-Length
        expect(res.headers['content-length']).toBeUndefined();

        const zip = new AdmZip(res.body);
        const names = zip.getEntries().map(e => e.entryName);
        expect(names).toContain('one.txt');
    });

    test('GET /api/local/posterpacks/download-all returns 404 when none exist', async () => {
        const res = await request(app)
            .get('/api/local/posterpacks/download-all')
            .query({ source: 'local' });

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: 'No posterpacks found' });
    });
});
