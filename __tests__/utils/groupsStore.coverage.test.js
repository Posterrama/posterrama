const path = require('path');

describe('utils/groupsStore coverage', () => {
    let tmpStore;
    let groupsStore;
    let mockFs;

    beforeAll(() => {
        // Create unique temp file path
        const unique = `groups-store-test-${process.pid}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}.json`;
        tmpStore = path.join(require('os').tmpdir(), unique);
    });

    beforeEach(() => {
        // Create a completely isolated in-memory fs mock to prevent interference
        mockFs = {
            data: new Map(),
            existsSync: jest.fn(filePath => mockFs.data.has(filePath)),
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
            const prev = process.env.GROUPS_STORE_PATH;
            process.env.GROUPS_STORE_PATH = tmpStore;

            // Mock fs completely to prevent any file system interference
            jest.doMock('fs', () => mockFs);
            groupsStore = require('../../utils/groupsStore');

            // Restore env
            if (prev === undefined) delete process.env.GROUPS_STORE_PATH;
            else process.env.GROUPS_STORE_PATH = prev;
        });
    });

    afterAll(() => {
        // Cleanup handled by in-memory mock, no real files to remove
    });

    test('getAll returns [] on fresh store', async () => {
        const all = await groupsStore.getAll();
        expect(Array.isArray(all)).toBe(true);
        expect(all.length).toBe(0);
        // File should be created lazily
        expect(mockFs.existsSync(tmpStore)).toBe(true);
    });

    test('createGroup assigns incremental order and getById works; duplicate id throws', async () => {
        const g1 = await groupsStore.createGroup({ name: 'A' });
        const g2 = await groupsStore.createGroup({ name: 'B' });
        expect(g1.order).toBe(0);
        expect(g2.order).toBe(1);
        const byId = await groupsStore.getById(g1.id);
        expect(byId && byId.id).toBe(g1.id);

        // Duplicate id should throw
        await expect(groupsStore.createGroup({ id: g1.id, name: 'dup' })).rejects.toThrow(
            'group_exists'
        );
    });

    test('patchGroup sanitizes order and updates fields', async () => {
        let list = await groupsStore.getAll();
        if (!list.length) {
            await groupsStore.createGroup({ name: 'Seed' });
            list = await groupsStore.getAll();
        }
        const target = list[0];
        const updated1 = await groupsStore.patchGroup(target.id, {
            name: 'New Name',
            description: 'Desc',
            order: -5, // should clamp to >= 0
        });
        expect(updated1.name).toBe('New Name');
        expect(updated1.description).toBe('Desc');
        expect(updated1.order).toBeGreaterThanOrEqual(0);

        const updated2 = await groupsStore.patchGroup(target.id, {
            order: 1e12, // should clamp to <= 1e9
        });
        expect(updated2.order).toBeLessThanOrEqual(1e9);

        const notFound = await groupsStore.patchGroup('nope', { name: 'x' });
        expect(notFound).toBeNull();
    });

    test('deleteGroup returns true once, then false', async () => {
        let list = await groupsStore.getAll();
        if (!list.length) {
            await groupsStore.createGroup({ name: 'Seed2' });
            list = await groupsStore.getAll();
        }
        const id = list[0]?.id;
        expect(typeof id).toBe('string');
        const ok1 = await groupsStore.deleteGroup(id);
        const ok2 = await groupsStore.deleteGroup(id);
        expect(ok1).toBe(true);
        expect(ok2).toBe(false);
    });

    test('getAll returns empty array when JSON contains an object instead of array', async () => {
        // Simulate corrupt file with object instead of array
        mockFs.data.set(tmpStore, JSON.stringify({ mediaServers: [] }));
        groupsStore.resetCache(); // Clear cache to force re-read

        const all = await groupsStore.getAll();
        expect(Array.isArray(all)).toBe(true);
        expect(all.length).toBe(0);
    });

    test('getAll returns empty array when JSON is invalid', async () => {
        // Simulate corrupt file with invalid JSON
        mockFs.data.set(tmpStore, 'not valid json{]');
        groupsStore.resetCache(); // Clear cache to force re-read

        const all = await groupsStore.getAll();
        expect(Array.isArray(all)).toBe(true);
        expect(all.length).toBe(0);
    });
});
