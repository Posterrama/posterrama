/**
 * @file __tests__/api/local-folderpack.motion-streaming.test.js
 * Integration tests for the /local-folderpack endpoint used by motion posterpacks.
 */

const os = require('os');
const path = require('path');
const fsp = require('fs/promises');
const request = require('supertest');

describe('GET /local-folderpack (motion posterpacks)', () => {
    let tempRoot;
    let app;

    beforeAll(async () => {
        tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'posterrama-localdir-'));

        const packDir = path.join(tempRoot, 'motion', 'My Movie (2024)');
        await fsp.mkdir(packDir, { recursive: true });

        // A small dummy MP4 file is enough for Range tests (the server does not validate container).
        await fsp.writeFile(path.join(packDir, 'motion.mp4'), Buffer.alloc(1024, 0x11));
        await fsp.writeFile(
            path.join(packDir, 'metadata.json'),
            JSON.stringify({ title: 'My Movie', year: 2024 }, null, 2)
        );

        // Ensure a fresh module graph so our config mock applies.
        jest.resetModules();

        const actualConfig = jest.requireActual('../../config.json');
        jest.doMock('../../config.json', () => ({
            ...actualConfig,
            mediaServers: [],
            localDirectory: {
                ...(actualConfig.localDirectory || {}),
                enabled: true,
                rootPath: tempRoot,
                watchDirectories: [],
            },
        }));

        app = require('../../server');
    });

    afterAll(async () => {
        if (tempRoot) {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    test('rejects non-motion pack directories', async () => {
        await request(app)
            .get('/local-folderpack')
            .query({ dir: 'posters/My Movie (2024)', entry: 'motion' })
            .expect(400);
    });

    test('returns metadata.json when present', async () => {
        const res = await request(app)
            .get('/local-folderpack')
            .query({ dir: 'motion/My Movie (2024)', entry: 'metadata' })
            .expect(200);

        expect(res.headers['content-type']).toMatch(/application\/json|text\/plain/);
        expect(String(res.text)).toContain('My Movie');
    });

    test('supports HTTP Range for motion video', async () => {
        const res = await request(app)
            .get('/local-folderpack')
            .query({ dir: 'motion/My Movie (2024)', entry: 'motion' })
            .set('Range', 'bytes=0-99')
            .buffer(true)
            .parse((res, cb) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => cb(null, Buffer.concat(chunks)));
            })
            .expect(206);

        expect(res.headers['accept-ranges']).toBe('bytes');
        expect(res.headers['content-range']).toBe('bytes 0-99/1024');
        expect(Number(res.headers['content-length'])).toBe(100);
        expect(Buffer.isBuffer(res.body)).toBe(true);
        expect(res.body.length).toBe(100);
    });

    test('returns 416 for unsatisfiable ranges', async () => {
        await request(app)
            .get('/local-folderpack')
            .query({ dir: 'motion/My Movie (2024)', entry: 'motion' })
            .set('Range', 'bytes=2048-4096')
            .expect(416);
    });
});
