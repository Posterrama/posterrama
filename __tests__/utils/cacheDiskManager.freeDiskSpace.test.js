const fs = require('fs');
const os = require('os');
const path = require('path');

const { CacheDiskManager } = require('../../utils/cache');

describe('CacheDiskManager.getFreeDiskSpace (non-blocking + cached)', () => {
    let tempDir;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posterrama-cache-statfs-'));
    });

    afterAll(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {
            // best-effort
        }
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('uses fs.promises.statfs and returns bavail*bsize', async () => {
        const statfsSpy = jest
            .spyOn(fs.promises, 'statfs')
            .mockResolvedValue({ bavail: 10, bsize: 4096 });

        const mgr = new CacheDiskManager(tempDir, {});
        const bytes = await mgr.getFreeDiskSpace();

        expect(statfsSpy).toHaveBeenCalledTimes(1);
        expect(bytes).toBe(10 * 4096);
    });

    test('caches results for a short TTL (no repeated statfs calls)', async () => {
        const statfsSpy = jest
            .spyOn(fs.promises, 'statfs')
            .mockResolvedValue({ bavail: 1, bsize: 1024 });

        const mgr = new CacheDiskManager(tempDir, {});
        const a = await mgr.getFreeDiskSpace();
        const b = await mgr.getFreeDiskSpace();

        expect(a).toBe(1024);
        expect(b).toBe(1024);
        expect(statfsSpy).toHaveBeenCalledTimes(1);
    });

    test('dedupes concurrent in-flight statfs calls', async () => {
        let resolve;
        const statfsSpy = jest.spyOn(fs.promises, 'statfs').mockImplementation(
            () =>
                new Promise(r => {
                    resolve = r;
                })
        );

        const mgr = new CacheDiskManager(tempDir, {});

        const p1 = mgr.getFreeDiskSpace();
        const p2 = mgr.getFreeDiskSpace();

        expect(statfsSpy).toHaveBeenCalledTimes(1);

        resolve({ bavail: 2, bsize: 100 });

        const [v1, v2] = await Promise.all([p1, p2]);
        expect(v1).toBe(200);
        expect(v2).toBe(200);
    });
});
