const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const Local = require('../../sources/local');

describe('LocalDirectorySource.cleanupDirectory - delete-contents', () => {
    const tmpBase = path.join(os.tmpdir(), `pr-local-del-contents-${Date.now()}`);

    beforeAll(async () => {
        await fs.ensureDir(tmpBase);
        await fs.outputFile(path.join(tmpBase, 'a.txt'), 'A');
        await fs.ensureDir(path.join(tmpBase, 'sub'));
        await fs.outputFile(path.join(tmpBase, 'sub', 'b.txt'), 'B');
    });

    afterAll(async () => {
        await fs.remove(tmpBase);
    });

    test('removes entries inside directory and keeps the directory itself', async () => {
        const src = new Local({ localDirectory: { enabled: true, rootPath: tmpBase } });
        const existsBefore = await fs.pathExists(tmpBase);
        expect(existsBefore).toBe(true);

        // Dry run should report would_delete_contents without changing filesystem
        const dry = await src.cleanupDirectory([{ type: 'delete-contents', path: tmpBase }], true);
        expect(dry.success).toBe(true);
        expect(Array.isArray(dry.operations)).toBe(true);
        const opDry = dry.operations.find(o => o.type === 'delete-contents');
        expect(opDry).toBeTruthy();
        const listBefore = await fs.readdir(tmpBase);
        expect(listBefore.length).toBeGreaterThan(0);

        // Actual delete of contents
        const res = await src.cleanupDirectory([{ type: 'delete-contents', path: tmpBase }], false);
        expect(res.success).toBe(true);
        const op = res.operations.find(o => o.type === 'delete-contents');
        expect(op).toBeTruthy();
        const listAfter = await fs.readdir(tmpBase);
        expect(listAfter).toHaveLength(0);
        const existsAfter = await fs.pathExists(tmpBase);
        expect(existsAfter).toBe(true);
    });
});
