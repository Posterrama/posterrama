const path = require('path');

// Small helper to wait real time without fake timers
const sleep = ms => new Promise(r => setTimeout(r, ms));

describe('utils/deviceStore coverage', () => {
    let tmpStore;
    let deviceStore;
    let mockFs;

    beforeAll(() => {
        // Create a unique temp file per worker to avoid collisions
        const unique = `devices-store-test-${process.pid}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}.json`;
        tmpStore = path.join(require('os').tmpdir(), unique);
    });

    beforeEach(() => {
        // Create a completely isolated in-memory fs mock to prevent interference
        mockFs = {
            data: new Map(),
            existsSync: jest.fn(filePath => mockFs.data.has(filePath)),
            mkdirSync: jest.fn((_dirPath, _options) => {
                // Mock mkdir - just mark the directory as existing
                mockFs.data.set(_dirPath, ''); // Empty string to indicate directory
            }),
            readFileSync: jest.fn((filePath, _encoding) => {
                const content = mockFs.data.get(filePath);
                if (!content)
                    throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
                return content;
            }),
            writeFileSync: jest.fn((filePath, data) => {
                mockFs.data.set(filePath, data);
            }),
            promises: {
                access: jest.fn(async filePath => {
                    if (!mockFs.data.has(filePath)) {
                        throw new Error(`ENOENT: no such file or directory, access '${filePath}'`);
                    }
                }),
                readFile: jest.fn(async (filePath, _encoding) => {
                    const content = mockFs.data.get(filePath);
                    if (!content)
                        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
                    return content;
                }),
                writeFile: jest.fn(async (filePath, data) => {
                    mockFs.data.set(filePath, data);
                }),
                rename: jest.fn(async (oldPath, newPath) => {
                    const content = mockFs.data.get(oldPath);
                    if (content) {
                        mockFs.data.set(newPath, content);
                        mockFs.data.delete(oldPath);
                    }
                }),
            },
        };

        // Fresh module instance with complete isolation
        jest.resetModules();
        jest.isolateModules(() => {
            const prev = process.env.DEVICES_STORE_PATH;
            process.env.DEVICES_STORE_PATH = tmpStore;

            // Mock fs completely to prevent any file system interference
            jest.doMock('fs', () => mockFs);
            jest.doMock('../../utils/logger', () => ({
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            }));

            deviceStore = require('../../utils/deviceStore');

            // Restore env
            if (prev === undefined) delete process.env.DEVICES_STORE_PATH;
            else process.env.DEVICES_STORE_PATH = prev;
        });
    });

    afterAll(() => {
        // Cleanup handled by in-memory mock, no real files to remove
    });

    test('fresh store initializes empty', async () => {
        const all = await deviceStore.getAll();
        expect(Array.isArray(all)).toBe(true);
        expect(all.length).toBe(0);
        expect(mockFs.existsSync(tmpStore)).toBe(true);
    });

    test('registerDevice: by installId rotates secret; by hardwareId prefers existing', async () => {
        // Register by installId
        const { device: d1, secret: s1 } = await deviceStore.registerDevice({
            name: 'Alpha',
            location: 'A',
            installId: 'iid-1',
        });
        expect(d1.id).toBeTruthy();
        expect(await deviceStore.verifyDevice(d1.id, s1)).toBe(true);

        // Re-register same installId -> same id, new secret
        const { device: d1b, secret: s1b } = await deviceStore.registerDevice({
            name: 'Alpha2',
            location: 'A2',
            installId: 'iid-1',
        });
        expect(d1b.id).toBe(d1.id);
        expect(await deviceStore.verifyDevice(d1.id, s1)).toBe(false);
        expect(await deviceStore.verifyDevice(d1.id, s1b)).toBe(true);

        // Register by hardwareId, then re-register preferring hardwareId match
        const { device: d2, secret: s2 } = await deviceStore.registerDevice({
            name: 'Bravo',
            hardwareId: 'hw-1',
        });
        expect(await deviceStore.verifyDevice(d2.id, s2)).toBe(true);
        const { device: d2b, secret: s2b } = await deviceStore.registerDevice({
            name: 'Bravo2',
            installId: 'iid-2',
            hardwareId: 'hw-1',
        });
        expect(d2b.id).toBe(d2.id);
        expect(await deviceStore.verifyDevice(d2.id, s2)).toBe(false);
        expect(await deviceStore.verifyDevice(d2.id, s2b)).toBe(true);
    });

    test('pairing: generate code, token required, expiration enforced', async () => {
        let all = await deviceStore.getAll();
        if (!all.length) {
            const { device } = await deviceStore.registerDevice({
                name: 'Seed',
                installId: 'iid-seed',
            });
            all = [device, ...all];
        }
        const target = all[0];
        const { code, token, expiresAt } = await deviceStore.generatePairingCode(target.id, {
            ttlMs: 200,
        });
        expect(code).toHaveLength(6);
        expect(typeof token).toBe('string');
        expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

        // Wrong token -> null
        const wrong = await deviceStore.claimByPairingCode({ code, token: 'nope', name: 'N1' });
        expect(wrong).toBeNull();

        // Correct token -> rotates secret and updates optional fields
        const result = await deviceStore.claimByPairingCode({
            code,
            token,
            name: 'Claimed',
            location: 'Here',
        });
        expect(result && result.device && result.secret).toBeTruthy();
        expect(result.device.name).toBe('Claimed');
        expect(await deviceStore.verifyDevice(result.device.id, result.secret)).toBe(true);

        // Expiration
        const { code: code2, token: token2 } = await deviceStore.generatePairingCode(target.id, {
            ttlMs: 1,
        });
        await sleep(5);
        const expired = await deviceStore.claimByPairingCode({ code: code2, token: token2 });
        expect(expired).toBeNull();
    });

    test('updateHeartbeat updates status, times, and merges client fields', async () => {
        let all = await deviceStore.getAll();
        if (!all.length) {
            const { device } = await deviceStore.registerDevice({
                name: 'Seed2',
                installId: 'iid-seed2',
            });
            all = [device, ...all];
        }
        const target = all[0];
        const before = await deviceStore.getById(target.id);
        const updated = await deviceStore.updateHeartbeat(target.id, {
            installId: 'iid-keep',
            hardwareId: 'hw-keep',
            clientInfo: { userAgent: 'UA', screen: { width: 100, height: 200, dpr: 2 } },
            currentState: { vol: 1 },
        });
        expect(updated.status).toBe('online');
        expect(Date.parse(updated.lastSeenAt)).toBeGreaterThan(0);
        expect(updated.installId).toBe('iid-keep');
        expect(updated.hardwareId).toBe('hw-keep');
        expect(updated.clientInfo.userAgent).toBe('UA');
        expect(updated.currentState.vol).toBe(1);
        expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt));
    });

    test('queueCommand/popCommands and deleteDevice clears queue', async () => {
        let all = await deviceStore.getAll();
        if (!all.length) {
            const { device } = await deviceStore.registerDevice({
                name: 'Seed3',
                installId: 'iid-seed3',
            });
            all = [device, ...all];
        }
        const id = all[0].id;
        const a = deviceStore.queueCommand(id, { type: 'ping', payload: { n: 1 } });
        const b = deviceStore.queueCommand(id, { type: 'pong', payload: { n: 2 } });
        expect(a && b && a.id !== b.id).toBe(true);
        const popped = deviceStore.popCommands(id);
        expect(popped.map(x => x.type)).toEqual(['ping', 'pong']);
        expect(deviceStore.popCommands(id).length).toBe(0);

        // Queue again then delete device -> queue cleared
        deviceStore.queueCommand(id, { type: 'x' });
        const removed = await deviceStore.deleteDevice(id);
        expect(removed).toBe(true);
        expect(deviceStore.popCommands(id)).toEqual([]);
    });

    test('mergeDevices unions arrays, deep merges overrides, and removes sources', async () => {
        // Create two devices to merge
        const { device: t } = await deviceStore.registerDevice({ name: 'T', installId: 'iid-t' });
        const { device: s } = await deviceStore.registerDevice({ name: 'S', installId: 'iid-s' });
        // Patch fields to set arrays and overrides
        await deviceStore.patchDevice(t.id, {
            tags: ['a'],
            groups: ['g1'],
            settingsOverride: { theme: { color: 'blue', size: 'l' } },
            currentState: { x: 1 },
        });
        await deviceStore.patchDevice(s.id, {
            tags: ['b', 'a'],
            groups: ['g2'],
            settingsOverride: { theme: { color: 'red', density: 'high' } },
            currentState: { y: 2 },
        });

        const res = await deviceStore.mergeDevices(t.id, [s.id]);
        expect(res.ok).toBe(true);
        expect(res.merged).toBe(1);
        const target = res.target;
        expect(target.tags.sort()).toEqual(['a', 'b']);
        expect(target.groups.sort()).toEqual(['g1', 'g2']);
        // target wins on conflict: color remains blue, density from source preserved
        expect(target.settingsOverride.theme.color).toBe('blue');
        expect(target.settingsOverride.theme.density).toBe('high');
        // Source removed
        const missing = await deviceStore.getById(s.id);
        expect(missing).toBeNull();
    });
});
