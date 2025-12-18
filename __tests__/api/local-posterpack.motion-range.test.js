/**
 * @file __tests__/api/local-posterpack.motion-range.test.js
 * Integration tests for ZIP-based motion posterpacks streamed via /local-posterpack.
 */

const os = require('os');
const path = require('path');
const fsp = require('fs/promises');
const AdmZip = require('adm-zip');
const request = require('supertest');

describe('GET /local-posterpack (motion ZIP posterpacks)', () => {
    let tempRoot;
    let app;

    beforeAll(async () => {
        tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'posterrama-localdir-'));

        await fsp.mkdir(path.join(tempRoot, 'motion'), { recursive: true });

        const zip = new AdmZip();
        zip.addFile('poster.jpg', Buffer.from('jpg'));
        zip.addFile('motion.mp4', Buffer.alloc(1024, 0x11));
        zip.addFile(
            'metadata.json',
            Buffer.from(
                JSON.stringify(
                    {
                        packType: 'motion',
                        mediaType: 'movie',
                        isMotionPoster: true,
                        title: 'My Movie',
                        year: 2024,
                    },
                    null,
                    2
                )
            )
        );

        const zipPath = path.join(tempRoot, 'motion', 'My Movie (2024).zip');
        await fsp.writeFile(zipPath, zip.toBuffer());

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

    test('supports HTTP Range for motion video inside ZIP', async () => {
        const res = await request(app)
            .get('/local-posterpack')
            .query({ zip: 'motion/My Movie (2024).zip', entry: 'motion' })
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
            .get('/local-posterpack')
            .query({ zip: 'motion/My Movie (2024).zip', entry: 'motion' })
            .set('Range', 'bytes=2048-4096')
            .expect(416);
    });
});
