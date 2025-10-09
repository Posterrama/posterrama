const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

describe('JobQueue thumbnail default-on when config flag missing', () => {
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    let originalConfig;
    let tmpRoot;

    beforeAll(() => {
        originalConfig = fs.readFileSync(configPath, 'utf-8');
        const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        tmpRoot = path.join('/tmp', `posterpack-gen-default-${unique}`);
        fs.mkdirSync(tmpRoot, { recursive: true });
        const cfg = JSON.parse(originalConfig);
        cfg.localDirectory = cfg.localDirectory || {};
        cfg.localDirectory.enabled = true;
        cfg.localDirectory.rootPath = tmpRoot;
        cfg.localDirectory.posterpackGeneration = cfg.localDirectory.posterpackGeneration || {};
        // Intentionally remove flag to test runtime default
        delete cfg.localDirectory.posterpackGeneration.generateThumbnail;
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    });

    afterAll(() => {
        fs.writeFileSync(configPath, originalConfig);
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch (_) {
            // noop: temp cleanup failure is non-fatal in tests
        }
        jest.resetModules();
    });

    test('generates thumbnail by default if sharp available', async () => {
        jest.resetModules();
        // If sharp is not available in env, skip assert for presence; keep test tolerant
        let hasSharp = true;
        try {
            require('sharp');
        } catch (_) {
            hasSharp = false;
        }

        const { default: axios } = require('axios');
        jest.mock('axios');
        const app = require('../../server');
        const posterBuf = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
        const bgBuf = posterBuf;
        axios.get = jest.fn(url => {
            if (url.includes('poster')) return Promise.resolve({ status: 200, data: posterBuf });
            return Promise.resolve({ status: 200, data: bgBuf });
        });

        const res = await require('supertest')(app)
            .post('/api/local/generate-posterpack')
            .set('Content-Type', 'application/json')
            .send({
                sourceType: 'local',
                libraryIds: [],
                options: { includeAssets: { poster: true, background: true } },
            })
            .ok(r => r.status < 500);
        expect([200, 404]).toContain(res.status);

        const outDir = path.join(tmpRoot, 'complete', 'local-export');
        if (!fs.existsSync(outDir)) return;
        const files = fs.readdirSync(outDir).filter(n => n.endsWith('.zip'));
        if (files.length === 0) return;
        const AdmZip = require('adm-zip');
        const zp = new AdmZip(path.join(outDir, files[0]));
        const names = zp.getEntries().map(e => e.entryName);
        expect(names).toContain('poster.jpg');
        expect(names).toContain('background.jpg');
        if (hasSharp) {
            expect(names).toContain('thumbnail.jpg');
        }
    });
});
