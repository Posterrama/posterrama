const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const LocalDirectorySource = require('../../sources/local');

function tempDir(prefix) {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('LocalDirectorySource with multiple roots (watchDirectories)', () => {
    let rootA, rootB;

    beforeAll(async () => {
        rootA = await tempDir('pr-local-a-');
        rootB = await tempDir('pr-local-b-');
        // create expected subfolders
        for (const base of [rootA, rootB]) {
            await fs.ensureDir(path.join(base, 'posters'));
        }
        // place a file in each root
        await fs.writeFile(path.join(rootA, 'posters', 'MovieA (2021).jpg'), 'x');
        await fs.writeFile(path.join(rootB, 'posters', 'MovieB (2022).jpg'), 'x');
    });

    afterAll(async () => {
        await fs.remove(rootA);
        await fs.remove(rootB);
    });

    it('scans across rootPath and watchDirectories and returns items from both', async () => {
        const source = new LocalDirectorySource({
            localDirectory: {
                enabled: true,
                rootPath: rootA,
                watchDirectories: [rootB],
                supportedFormats: ['jpg'],
                maxFileSize: 1048576,
            },
        });

        const items = await source.fetchMedia([], 'poster', 10);
        // We expect at least two entries (MovieA and MovieB)
        expect(items.length).toBeGreaterThanOrEqual(2);
        // Ensure URLs are built relative to one of the roots
        items.forEach(i => expect(i.poster.startsWith('/local-media/')).toBe(true));
    });
});
