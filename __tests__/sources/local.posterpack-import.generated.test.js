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

describe('LocalDirectorySource posterpack importer (generated exports)', () => {
    let root;
    beforeAll(async () => {
        root = await tempDir('pr-import-gen-');
        await fs.ensureDir(path.join(root, 'complete', 'plex-export'));
        await fs.ensureDir(path.join(root, 'complete', 'jellyfin-export'));
    });

    afterAll(async () => {
        await fs.remove(root);
    });

    it('copies from plex-export into complete/manual when includeGenerated=true', async () => {
        const src = new LocalDirectorySource({
            localDirectory: {
                enabled: true,
                rootPath: root,
            },
        });

        const buf = makePosterpackZip({
            'poster.jpg': 'P',
            'background.jpg': 'B',
            'metadata.json': JSON.stringify({ title: 'Gen Movie', year: 2023 }),
        });
        const zipPath = path.join(root, 'complete', 'plex-export', 'Gen Movie (2023).zip');
        await fs.writeFile(zipPath, buf);

        // Should copy when includeGenerated option is passed
        const count = await src.importPosterpacks({ includeGenerated: true });
        expect(count).toBeGreaterThanOrEqual(1);

        // Verify the ZIP was copied to complete/manual and no extraction occurred
        const copiedZip = path.join(root, 'complete', 'manual', 'Gen Movie (2023).zip');
        expect(await fs.pathExists(copiedZip)).toBe(true);
        const posterPath = path.join(root, 'posters', 'Gen Movie (2023).jpg');
        const bgPath = path.join(root, 'backgrounds', 'Gen Movie (2023).jpg');
        expect(await fs.pathExists(posterPath)).toBe(false);
        expect(await fs.pathExists(bgPath)).toBe(false);
    });
});
