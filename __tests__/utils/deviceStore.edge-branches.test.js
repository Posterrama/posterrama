/**
 * Intent: Cover edge branches in deviceStore (updateHeartbeat pruning, pruneLikelyDuplicates paths, metrics hook)
 * Determinism: Real temp file with cleanup between tests.
 */
const path = require('path');
const fs = require('fs');

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

// Capture metrics recording (must be inside factory to avoid out-of-scope reference error)
jest.mock('../../utils/metrics', () => {
    const fn = jest.fn();
    return {
        __esModule: true,
        recordRequest: (...args) => fn(...args),
        _recordFn: fn, // expose for test access via require
    };
});

describe('deviceStore edge branches', () => {
    let deviceStore;
    let storePath;

    beforeAll(() => {
        const unique = `edge-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
        storePath = path.join(require('os').tmpdir(), unique);
    });

    beforeEach(() => {
        // Clean up any existing store file
        try {
            if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
            const lockFile = `${storePath}.lock`;
            if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
        } catch (_) {
            /* ignore cleanup errors */
        }

        // Load fresh deviceStore with real file
        jest.resetModules();
        process.env.DEVICES_STORE_PATH = storePath;
        deviceStore = require('../../utils/deviceStore');
        delete process.env.DEVICES_STORE_PATH;

        // Reset metrics mock
        try {
            const metrics = require('../../utils/metrics');
            if (metrics && metrics._recordFn && metrics._recordFn.mockReset) {
                metrics._recordFn.mockReset();
            }
        } catch (_) {
            /* ignore */
        }
    });

    afterAll(() => {
        // Final cleanup
        try {
            if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
            const lockFile = `${storePath}.lock`;
            if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
        } catch (_) {
            /* ignore */
        }
    });

    test('updateHeartbeat prunes duplicates for installId and hardwareId', async () => {
        const { device: a } = await deviceStore.registerDevice({
            name: 'A',
            installId: 'iid',
            hardwareId: null,
        });
        await deviceStore.registerDevice({ name: 'B', installId: 'iid', hardwareId: null });
        const { device: c } = await deviceStore.registerDevice({
            name: 'C',
            installId: null,
            hardwareId: 'hw',
        });
        await deviceStore.registerDevice({ name: 'D', installId: null, hardwareId: 'hw' });

        // Update heartbeat for first installId device with same installId -> should remove other with same installId
        await deviceStore.updateHeartbeat(a.id, { installId: 'iid' });
        const all1 = await deviceStore.getAll();
        expect(all1.filter(x => x.installId === 'iid').length).toBe(1);

        // Update heartbeat for hardware device 'c' with hardwareId 'hw' -> should prune 'd'
        await deviceStore.updateHeartbeat(c.id, { hardwareId: 'hw' });
        const all2 = await deviceStore.getAll();
        expect(all2.filter(x => x.hardwareId === 'hw').length).toBe(1);
    });

    test('pruneLikelyDuplicates deletes candidates by hardwareId and UA+screen and records metrics', async () => {
        const { device: keep } = await deviceStore.registerDevice({
            name: 'Keep',
            installId: 'iidK',
            hardwareId: 'hwK',
        });
        // hardwareId duplicate
        await deviceStore.registerDevice({ name: 'Dup1', installId: 'iidX', hardwareId: 'hwK' });
        // UA + screen duplicates (missing installId) => create by patching
        const { device: ua1 } = await deviceStore.registerDevice({ name: 'UA1', installId: null });
        const { device: ua2 } = await deviceStore.registerDevice({ name: 'UA2', installId: null });
        await deviceStore.patchDevice(ua1.id, {
            clientInfo: { userAgent: 'UA', screen: { width: 100, height: 200, dpr: 1 } },
        });
        await deviceStore.patchDevice(ua2.id, {
            clientInfo: { userAgent: 'UA', screen: { width: 100, height: 200, dpr: 1 } },
        });
        await deviceStore.patchDevice(keep.id, {
            clientInfo: { userAgent: 'UA', screen: { width: 100, height: 200, dpr: 1 } },
        });

        const res = await deviceStore.pruneLikelyDuplicates({ keepId: keep.id, hardwareId: 'hwK' });
        expect(res.deleted).toBeGreaterThan(0);
        const metrics = require('../../utils/metrics');
        expect(metrics._recordFn).toHaveBeenCalled();
    });

    test('pruneLikelyDuplicates returns {deleted:0} on error path', async () => {
        // Force internal error by writing invalid JSON to the store file
        fs.writeFileSync(storePath, 'invalid{json}', 'utf8');

        // Reload deviceStore to pick up corrupted file
        jest.resetModules();
        process.env.DEVICES_STORE_PATH = storePath;
        deviceStore = require('../../utils/deviceStore');
        delete process.env.DEVICES_STORE_PATH;

        const res = await deviceStore.pruneLikelyDuplicates({ keepId: 'nope' });
        expect(res).toEqual({ deleted: 0 });
    });

    test('getActivePairings sorts by expiry ascending', async () => {
        const { device: d1 } = await deviceStore.registerDevice({ name: 'P1' });
        const { device: d2 } = await deviceStore.registerDevice({ name: 'P2' });
        // generate codes with different TTL
        await deviceStore.generatePairingCode(d1.id, { ttlMs: 50 });
        await deviceStore.generatePairingCode(d2.id, { ttlMs: 200 });
        const list = await deviceStore.getActivePairings();
        expect(list.length).toBe(2);
        expect(Date.parse(list[0].expiresAt)).toBeLessThan(Date.parse(list[1].expiresAt));
        expect(list.map(x => x.deviceId).sort()).toEqual([d1.id, d2.id].sort());
        expect(list[0].expiresInMs).toBeLessThanOrEqual(list[1].expiresInMs);
    });
});
