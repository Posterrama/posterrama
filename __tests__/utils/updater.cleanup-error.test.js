/**
 * Exercise updater.cleanup error branch by passing a bogus download path
 * to trigger fs.unlink failure (ENOENT) and ensure it does not throw.
 */
const updater = require('../../utils/updater');

describe('updater.cleanup error resilience', () => {
    test('cleanup handles missing download path gracefully', async () => {
        const before = Date.now();
        await updater.cleanup('/nonexistent/path/to/file.tmp');
        expect(Date.now()).toBeGreaterThanOrEqual(before); // trivial assertion just to mark test ran
    });
});
