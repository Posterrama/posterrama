const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const request = require('supertest');

process.env.NODE_ENV = 'test';

describe('GET /get-media - Games Mode includes local RomM posterpacks', () => {
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    let originalConfig;
    let tmpRoot;

    beforeAll(() => {
        originalConfig = fs.readFileSync(configPath, 'utf-8');
        const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        tmpRoot = path.join('/tmp', `posterrama-games-${unique}`);
        fs.mkdirSync(tmpRoot, { recursive: true });

        const cfg = JSON.parse(originalConfig);
        cfg.localDirectory = cfg.localDirectory || {};
        cfg.localDirectory.enabled = true;
        cfg.localDirectory.rootPath = tmpRoot;

        cfg.wallartMode = cfg.wallartMode || {};
        cfg.wallartMode.gamesOnly = true;

        cfg.mediaServers = Array.isArray(cfg.mediaServers) ? cfg.mediaServers : [];
        // Ensure a RomM server entry exists; it will be mocked.
        const idx = cfg.mediaServers.findIndex(s => s && s.type === 'romm');
        const rommServer = {
            type: 'romm',
            enabled: true,
            name: 'S',
            selectedPlatforms: ['ps1'],
            url: 'http://romm.invalid',
            username: 'u',
            password: 'p',
        };
        if (idx >= 0) cfg.mediaServers[idx] = { ...cfg.mediaServers[idx], ...rommServer };
        else cfg.mediaServers.push(rommServer);

        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

        // Create a local posterpack ZIP under complete/romm-export
        const outDir = path.join(tmpRoot, 'complete', 'romm-export');
        fs.mkdirSync(outDir, { recursive: true });

        const zip = new AdmZip();
        zip.addFile('poster.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        zip.addFile(
            'metadata.json',
            Buffer.from(
                JSON.stringify(
                    {
                        schemaVersion: 2,
                        itemType: 'game',
                        title: 'Local Game',
                        year: 2000,
                        platform: 'PlayStation',
                        source: 'romm',
                        sourceId: 'romm_S_1',
                    },
                    null,
                    2
                ),
                'utf-8'
            )
        );
        zip.writeZip(path.join(outDir, 'Local Game (2000).zip'));
    });

    afterAll(() => {
        fs.writeFileSync(configPath, originalConfig);
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch (_) {
            // ignore
        }
        jest.resetModules();
    });

    beforeEach(() => {
        jest.resetModules();
    });

    test('prefers local posterpack asset when key collides', async () => {
        jest.doMock('../../sources/romm', () => {
            return function RommSourceMock() {
                this.fetchMedia = async () => [
                    {
                        key: 'romm_S_1',
                        id: 'romm_S_1',
                        sourceId: 'romm_S_1',
                        title: 'Remote Game',
                        type: 'game',
                        source: 'romm',
                        posterUrl: 'https://example.invalid/poster.jpg',
                        poster: 'https://example.invalid/poster.jpg',
                    },
                ];
            };
        });

        const app = require('../../server');
        const res = await request(app).get('/get-media?gamesOnly=1&count=50').expect(200);
        expect(Array.isArray(res.body)).toBe(true);

        const byKey = new Map(res.body.map(it => [it.key, it]));
        const it = byKey.get('romm_S_1');
        expect(it).toBeTruthy();
        expect(String(it.source)).toBe('local');
        expect(String(it.posterUrl)).toContain('/local-posterpack?zip=');
    });
});
