const path = require('path');
const fs = require('fs');

// We'll load deviceStore lazily inside each test with isolated module registry
let deviceStore;

/**
 * Targets uncovered branches in pruneLikelyDuplicates:
 * - same installId pruning
 * - UA + screen heuristic
 */

describe('deviceStore pruneLikelyDuplicates', () => {
    beforeEach(async () => {
        // Point store path to unique temp file BEFORE requiring module
        const tmpStore = path.join(__dirname, `devices.prune.${Date.now()}.${Math.random()}.json`);
        process.env.DEVICES_STORE_PATH = path.relative(path.join(__dirname, '..', '..'), tmpStore);
        // Ensure no leftover file
        if (fs.existsSync(tmpStore)) fs.unlinkSync(tmpStore);
        jest.isolateModules(() => {
            deviceStore = require('../../utils/deviceStore');
        });
        const { device: keep } = await deviceStore.registerDevice({
            name: 'Primary',
            installId: 'iid-1',
        });
        await deviceStore.updateHeartbeat(keep.id, {
            clientInfo: { userAgent: 'UA', screen: { w: 1920, h: 1080, dpr: 1 } },
        });
        for (let i = 0; i < 3; i++) {
            await deviceStore.registerDevice({ name: 'Dup' + i, installId: 'iid-1' });
        }
        for (let i = 0; i < 2; i++) {
            const { device } = await deviceStore.registerDevice({ name: 'Anon' + i });
            await deviceStore.updateHeartbeat(device.id, {
                clientInfo: { userAgent: 'UA', screen: { width: 1920, height: 1080, scale: 1 } },
            });
        }
    });

    test('prunes some duplicates for keep device', async () => {
        const allBefore = await deviceStore.getAll();
        let keep = allBefore.find(d => d.name === 'Primary');
        if (!keep) {
            const created = await deviceStore.registerDevice({
                name: 'Primary',
                installId: 'iid-1',
            });
            keep = created.device;
            await deviceStore.updateHeartbeat(keep.id, {
                clientInfo: { userAgent: 'UA', screen: { w: 1920, h: 1080, dpr: 1 } },
            });
            // add a quick duplicate
            await deviceStore.registerDevice({ name: 'DupX', installId: 'iid-1' });
        }
        expect(keep).toBeTruthy();
        const res = await deviceStore.pruneLikelyDuplicates({
            keepId: keep.id,
            userAgent: 'UA',
            screen: { w: 1920, h: 1080, dpr: 1 },
        });
        expect(res.deleted).toBeGreaterThan(0);
    });
});
