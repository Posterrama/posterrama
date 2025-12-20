const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.NODE_ENV = 'test';

describe('JobQueue game posterpack metadata + assets', () => {
    test('writes game-focused metadata.json and does not create background.jpg when missing', async () => {
        const JobQueue = require('../../utils/job-queue');

        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'posterrama-game-pack-'));
        const outDir = path.join(tmpRoot, 'complete', 'romm-export');
        fs.mkdirSync(outDir, { recursive: true });

        const jq = new JobQueue({
            localDirectory: {
                enabled: true,
                rootPath: tmpRoot,
                posterpackGeneration: { concurrentJobs: 1 },
            },
        });

        // Tiny-but-valid JPEG
        const jpgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);

        // Mock downloads: poster returns JPEG, background returns a non-image body (should be ignored)
        jq.downloadAsset = jest.fn(async url => {
            if (String(url).includes('poster')) return jpgBuf;
            if (String(url).includes('background')) return Buffer.from('Not Found', 'utf8');
            return null;
        });

        const item = {
            id: 'romm_RomM_1776',
            type: 'game',
            itemType: 'game',
            title: 'Mario Kart 64',
            // Simulate a bad upstream year (e.g. epoch ms treated as seconds -> year 49291)
            year: 49291,
            // Provide a sane releaseDate so metadata can derive the correct calendar year
            releaseDate: 820454400000, // 1996-01-01T00:00:00.000Z
            poster: 'https://example.invalid/poster.jpg',
            background: 'https://example.invalid/background.jpg',
            overview: 'Test overview',
            genres: ['Racing'],
            rating: 81.8,
            platform: 'Nintendo 64',
            providerIds: { igdb: 2342 },
            slug: 'mario-kart-64',
            guids: ['romm://RomM/1776', 'igdb://2342'],
        };

        const res = await jq.generatePosterpackForItem(
            item,
            'romm',
            {
                outputPath: outDir,
                includeAssets: { poster: true, background: true, thumbnail: false },
                overwrite: true,
                compression: 'fast',
            },
            null
        );

        expect(res && res.outputPath).toBeTruthy();
        expect(fs.existsSync(res.outputPath)).toBe(true);

        const AdmZip = require('adm-zip');
        const zip = new AdmZip(res.outputPath);
        const names = zip.getEntries().map(e => e.entryName);

        expect(names).toContain('poster.jpg');
        expect(names).toContain('metadata.json');
        expect(names).not.toContain('background.jpg');

        const meta = JSON.parse(zip.readAsText('metadata.json'));

        expect(meta).toMatchObject({
            schemaVersion: 2,
            itemType: 'game',
            title: 'Mario Kart 64',
            year: 1996,
            source: 'romm',
            sourceId: 'romm_RomM_1776',
        });

        // Should not contain movie/series specific fields
        expect(meta.cast).toBeUndefined();
        expect(meta.directors).toBeUndefined();
        expect(meta.tmdbId).toBeUndefined();
        expect(meta.runtimeMs).toBeUndefined();

        // Assets/images should correctly reflect missing background
        expect(meta.assets && meta.assets.poster).toBe(true);
        expect(meta.assets && meta.assets.background).toBe(false);
        expect(meta.images && meta.images.poster).toBe(true);
        expect(meta.images && meta.images.background).toBe(false);

        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch (_) {
            // noop
        }
    });
});
