const fs = require('fs');
const path = require('path');

describe('utils/groupsStore coverage', () => {
    let tmpStore;
    let groupsStore;

    beforeAll(() => {
        // Create unique temp file path
        const unique = `groups-store-test-${process.pid}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}.json`;
        tmpStore = path.join(__dirname, '..', '..', 'sessions', unique);
        const dir = path.dirname(tmpStore);
        fs.mkdirSync(dir, { recursive: true });
        // Ensure clean slate
        try {
            fs.unlinkSync(tmpStore);
        } catch (_) {}
        // Pre-create with valid empty array to avoid type surprises
        try {
            fs.writeFileSync(tmpStore, '[]', 'utf8');
        } catch (_) {}
    });

    beforeEach(() => {
        // Fresh module instance each test to avoid cache/mocking interference
        jest.resetModules();
        // Ensure the file is a clean array before loading the module
        try {
            fs.mkdirSync(path.dirname(tmpStore), { recursive: true });
            fs.writeFileSync(tmpStore, '[]', 'utf8');
        } catch (_) {}
        jest.isolateModules(() => {
            const prev = process.env.GROUPS_STORE_PATH;
            process.env.GROUPS_STORE_PATH = tmpStore;
            jest.doMock('fs', () => jest.requireActual('fs'));
            groupsStore = require('../../utils/groupsStore');
            if (prev === undefined) delete process.env.GROUPS_STORE_PATH;
            else process.env.GROUPS_STORE_PATH = prev;
        });
    });

    afterAll(() => {
        // Cleanup file and env
        try {
            fs.unlinkSync(tmpStore);
        } catch (_) {}
        // No env var cleanup needed; we restore within isolateModules
    });

    test('getAll returns [] on fresh store', async () => {
        const all = await groupsStore.getAll();
        expect(Array.isArray(all)).toBe(true);
        expect(all.length).toBe(0);
        // File should be created lazily
        expect(fs.existsSync(tmpStore)).toBe(true);
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
});
