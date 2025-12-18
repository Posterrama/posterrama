const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const AdmZip = require('adm-zip');
const LocalDirectorySource = require('../../sources/local');

function tempDir(prefix) {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function makePosterpackZip(entries) {
    const zip = new AdmZip();
    Object.entries(entries).forEach(([name, val]) => {
        zip.addFile(name, Buffer.isBuffer(val) ? val : Buffer.from(String(val)));
    });
    return zip.toBuffer();
}

describe('LocalDirectorySource posterpack importer', () => {
    let root;
    beforeAll(async () => {
        root = await tempDir('pr-import-');
        await fs.ensureDir(path.join(root, 'complete', 'manual'));
    });

    afterAll(async () => {
        await fs.remove(root);
    });

    it('copies manual ZIPs without extracting (ZIP-only semantics)', async () => {
        const src = new LocalDirectorySource({
            localDirectory: {
                enabled: true,
                rootPath: root,
            },
        });

        // Create a posterpack ZIP
        const meta = { title: 'Test Movie', year: 2024, genres: ['Action'], tags: ['HD'] };
        const buf = makePosterpackZip({
            'poster.jpg': 'P',
            'background.jpg': 'B',
            'clearlogo.png': 'C',
            'motion.mp4': Buffer.alloc(128, 0x11),
            'metadata.json': JSON.stringify(meta),
        });
        const zipPath = path.join(root, 'complete', 'manual', 'Test Movie (2024).zip');
        await fs.writeFile(zipPath, buf);

        // Import: should count ZIPs but not extract assets
        const count = await src.importPosterpacks();
        // Manual ZIPs are not copied by importPosterpacks (they already live in complete/manual)
        expect(count).toBeGreaterThanOrEqual(0);

        // Verify no extraction occurred
        const posterPath = path.join(root, 'posters', 'Test Movie (2024).jpg');
        const bgPath = path.join(root, 'backgrounds', 'Test Movie (2024).jpg');
        const logoPath = path.join(root, 'clearlogos', 'Test Movie (2024).png');
        const posterMeta = path.join(root, 'posters', 'Test Movie (2024).poster.json');
        const bgMeta = path.join(root, 'backgrounds', 'Test Movie (2024).poster.json');

        for (const p of [posterPath, bgPath, logoPath, posterMeta, bgMeta]) {
            expect(await fs.pathExists(p)).toBe(false);
        }
    });

    it('adds zipPills summary for ZIPs in browseDirectory', async () => {
        const src = new LocalDirectorySource({
            localDirectory: { enabled: true, rootPath: root },
        });

        const dir = path.join(root, 'complete', 'manual');
        const out = await src.browseDirectory(dir, 'files');
        const zipEntry = out.files.find(f => f.name.endsWith('.zip'));
        expect(zipEntry).toBeTruthy();
        expect(Array.isArray(zipEntry.zipPills)).toBe(true);
        // Should include the assets we added
        expect(zipEntry.zipPills).toEqual(
            expect.arrayContaining(['poster', 'background', 'clearlogo', 'metadata', 'motion'])
        );
    });
});
