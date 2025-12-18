const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const AdmZip = require('adm-zip');
const LocalDirectorySource = require('../../sources/local');

function tempDir(prefix) {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('LocalDirectorySource motion posterpacks', () => {
    let root;

    beforeAll(async () => {
        root = await tempDir('pr-motionpacks-');
        await fs.ensureDir(path.join(root, 'motion'));
    });

    afterAll(async () => {
        await fs.remove(root);
    });

    it('discovers ZIP-based motion movie posterpacks and returns cinema-only items', async () => {
        const zipName = 'Test Movie (2024).zip';
        const zipPath = path.join(root, 'motion', zipName);

        const zip = new AdmZip();
        zip.addFile('poster.jpg', Buffer.from('jpg'));
        zip.addFile('thumbnail.jpg', Buffer.from('jpg2'));
        zip.addFile('motion.mp4', Buffer.alloc(256, 0x11));
        zip.addFile(
            'metadata.json',
            Buffer.from(
                JSON.stringify(
                    {
                        packType: 'motion',
                        mediaType: 'movie',
                        isMotionPoster: true,
                        title: 'Test Movie',
                        year: 2024,
                        tagline: 'A test tagline',
                        overview: 'A test overview',
                        genres: ['Action'],
                    },
                    null,
                    2
                )
            )
        );
        await fs.writeFile(zipPath, zip.toBuffer());

        const src = new LocalDirectorySource({
            localDirectory: {
                enabled: true,
                rootPath: root,
            },
        });

        const items = await src.fetchMedia([''], 'motion', 50);
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBe(1);

        const item = items[0];
        expect(item.title).toBe('Test Movie');
        expect(item.year).toBe(2024);
        expect(item.isMotionPoster).toBe(true);
        expect(typeof item.motionPosterUrl).toBe('string');
        expect(item.motionPosterUrl).toContain('/local-posterpack');
        expect(item.motionPosterUrl).toContain('entry=motion');
        expect(item.usage).toEqual({ cinema: true, wallart: false, screensaver: false });
    });

    it('ignores non-motion ZIPs (no explicit metadata flag)', async () => {
        const zipName = 'Not Motion (2024).zip';
        const zipPath = path.join(root, 'motion', zipName);

        const zip = new AdmZip();
        zip.addFile('poster.jpg', Buffer.from('jpg'));
        zip.addFile('motion.mp4', Buffer.alloc(16, 0x22));
        zip.addFile(
            'metadata.json',
            Buffer.from(JSON.stringify({ title: 'Not Motion', year: 2024 }))
        );
        await fs.writeFile(zipPath, zip.toBuffer());

        const src = new LocalDirectorySource({
            localDirectory: {
                enabled: true,
                rootPath: root,
            },
        });

        const items = await src.fetchMedia([''], 'motion', 50);
        // Only the explicitly flagged motion ZIP from the previous test should be returned
        expect(items.length).toBe(1);
        expect(items[0].title).toBe('Test Movie');
    });
});
