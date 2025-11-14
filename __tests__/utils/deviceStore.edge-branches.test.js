/**
 * Intent: Cover edge branches in deviceStore (updateHeartbeat pruning, pruneLikelyDuplicates paths, metrics hook)
 * Determinism: In-memory fs mock, manual control of timestamps.
 */
const path = require('path');

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

// In-memory fs mock
function createFsMock() {
    const store = new Map();
    return {
        data: store,
        existsSync: jest.fn(p => store.has(p)),
        mkdirSync: jest.fn(p => {
            store.set(p, '__DIR__');
        }),
        readFileSync: jest.fn(p => {
            const v = store.get(p);
            if (!v) throw new Error('ENOENT');
            return v;
        }),
        writeFileSync: jest.fn((p, d) => store.set(p, d)),
        promises: {
            access: jest.fn(async p => {
                if (!store.has(p)) {
                    const error = new Error('ENOENT');
                    error.code = 'ENOENT';
                    throw error;
                }
            }),
            readFile: jest.fn(async p => {
                const v = store.get(p);
                if (!v) {
                    const error = new Error('ENOENT');
                    error.code = 'ENOENT';
                    throw error;
                }
                return v;
            }),
            writeFile: jest.fn(async (p, d) => {
                store.set(p, d);
            }),
            rename: jest.fn(async (o, n) => {
                const v = store.get(o);
                if (v) {
                    store.set(n, v);
                    store.delete(o);
                }
            }),
            mkdir: jest.fn(async p => {
                store.set(p, '__DIR__');
            }),
            copyFile: jest.fn(async (src, dest) => {
                const v = store.get(src);
                if (!v) {
                    const error = new Error('ENOENT');
                    error.code = 'ENOENT';
                    throw error;
                }
                store.set(dest, v);
            }),
            unlink: jest.fn(async p => {
                if (!store.has(p)) {
                    const error = new Error('ENOENT');
                    error.code = 'ENOENT';
                    throw error;
                }
                store.delete(p);
            }),
            stat: jest.fn(async p => {
                if (!store.has(p)) {
                    const error = new Error('ENOENT');
                    error.code = 'ENOENT';
                    throw error;
                }
                const v = store.get(p);
                return {
                    size: v ? v.length : 0,
                    mtime: new Date(),
                    birthtime: new Date(),
                };
            }),
        },
    };
}

describe('deviceStore edge branches', () => {
    let deviceStore;
    let fsMock;
    let storePath;

    function loadFresh() {
        jest.resetModules();
        fsMock = createFsMock();
        const unique = `edge-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
        storePath = path.join(require('os').tmpdir(), unique);
        process.env.DEVICES_STORE_PATH = storePath;
        jest.doMock('fs', () => fsMock);
        deviceStore = require('../../utils/deviceStore');
        delete process.env.DEVICES_STORE_PATH;
    }

    beforeEach(() => {
        loadFresh();
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
        // Force internal error by mocking readAll via fs to throw unreadable JSON
        loadFresh();
        // Overwrite underlying fs read to throw
        fsMock.promises.readFile.mockRejectedValue(new Error('boom'));
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
