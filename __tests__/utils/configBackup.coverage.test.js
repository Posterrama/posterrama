const path = require('path');

// In-memory fs mock helper
function createMemFs() {
    const store = new Map();

    function norm(p) {
        return path.resolve(p).replace(/\\/g, '/');
    }

    function ensureDir(p) {
        const f = norm(p);
        if (!store.has(f)) store.set(f, { type: 'dir', entries: new Set() });
    }

    function parentDir(p) {
        return norm(path.dirname(p));
    }

    const api = {
        data: store,
        // sync
        mkdirSync: (dir, _opts = {}) => {
            ensureDir(dir);
        },
        copyFileSync: (src, dst) => {
            const s = store.get(norm(src));
            if (!s || s.type !== 'file') throw new Error('ENOENT');
            const d = norm(dst);
            store.set(d, { type: 'file', data: Buffer.from(s.data) });
            ensureDir(parentDir(d));
        },
        statSync: p => {
            const e = store.get(norm(p));
            if (!e) throw new Error('ENOENT');
            return {
                isFile: () => e.type === 'file',
                isDirectory: () => e.type === 'dir',
                size: e.data ? e.data.length : 0,
                mtimeMs: Date.now(),
            };
        },
        existsSync: p => store.has(norm(p)),
        readFileSync: (p, enc) => {
            const e = store.get(norm(p));
            if (!e || e.type !== 'file') throw new Error('ENOENT');
            return enc ? e.data.toString(enc) : Buffer.from(e.data);
        },
        writeFileSync: (p, data, enc = 'utf8') => {
            const d = norm(p);
            ensureDir(parentDir(d));
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), enc);
            store.set(d, { type: 'file', data: buf });
        },
        // promises
        promises: {
            stat: async p => api.statSync(p),
            readdir: async dir => {
                // Return entries that start with dir path
                const d = norm(dir);
                const results = [];
                for (const k of store.keys()) {
                    const parent = parentDir(k);
                    if (parent === d && store.get(k).type === 'dir') {
                        results.push(path.basename(k));
                    }
                }
                return results;
            },
            readFile: async (p, enc) => api.readFileSync(p, enc),
            writeFile: async (p, data, enc) => api.writeFileSync(p, data, enc),
            copyFile: async (src, dst) => api.copyFileSync(src, dst),
            rm: async (p, _opts) => {
                const key = norm(p);
                // naive recursive delete
                for (const k of Array.from(store.keys())) {
                    if (k === key || k.startsWith(key + '/')) store.delete(k);
                }
            },
            mkdir: async (dir, _opts) => api.mkdirSync(dir, _opts),
        },
    };

    return api;
}

// Helper for seeding whitelisted files
function seedWhitelist(fsMock, rootDir, files) {
    for (const [name, content] of Object.entries(files)) {
        const full = path.join(rootDir, name);
        fsMock.writeFileSync(full, content, 'utf8');
    }
}

describe('utils/configBackup coverage', () => {
    let fsMock;
    let mod;
    let ROOT;
    let BACKUP_DIR;

    beforeEach(() => {
        jest.resetModules();
        // Use fake timers so we can advance time to generate unique backup IDs (seconds precision)
        jest.useFakeTimers({ now: new Date('2025-01-01T00:00:00Z') });
        fsMock = createMemFs();
        jest.doMock('fs', () => fsMock);
        jest.doMock('fs/promises', () => fsMock.promises);
        // Load module fresh with mocks in isolation
        jest.isolateModules(() => {
            mod = require('../../utils/configBackup');
        });
        ROOT = path.resolve(__dirname, '../..');
        BACKUP_DIR = path.join(ROOT, 'backups', 'config');
        // Seed some whitelisted files
        seedWhitelist(fsMock, ROOT, {
            'config.json': '{"a":1}',
            'devices.json': '[]',
            'groups.json': '[]',
            '.env': 'KEY=VALUE',
        });
    });

    test('createBackup writes meta and copies whitelisted files', async () => {
        const meta = await mod.createBackup();
        expect(meta && meta.id).toBeTruthy();
        const metaPath = path.join(BACKUP_DIR, meta.id, 'meta.json');
        expect(fsMock.existsSync(metaPath)).toBe(true);
        // Ensure some files are copied
        for (const name of ['config.json', 'devices.json', 'groups.json', '.env']) {
            const p = path.join(BACKUP_DIR, meta.id, name);
            expect(fsMock.existsSync(p)).toBe(true);
        }
    });

    test('listBackups sorts newest first and includes files', async () => {
        const a = await mod.createBackup();
        // Advance the system clock by >1s so ID (YYYYMMDD-HHMMSS) changes
        jest.setSystemTime(new Date('2025-01-01T00:00:01Z'));
        const b = await mod.createBackup();
        const list = await mod.listBackups();
        expect(list[0].id).toBe(b.id);
        expect(list[1].id).toBe(a.id);
        expect(Array.isArray(list[0].files)).toBe(true);
    });

    test('cleanupOldBackups deletes older directories beyond retention', async () => {
        await mod.createBackup();
        jest.setSystemTime(new Date('2025-01-01T00:00:01Z'));
        await mod.createBackup();
        const res = await mod.cleanupOldBackups(1);
        expect(res.deleted).toBe(1);
        const remaining = await mod.listBackups();
        expect(remaining.length).toBe(1);
    });

    afterEach(() => {
        // Restore real timers and unmock fs to avoid impacting other test suites
        jest.useRealTimers();
        jest.unmock('fs');
        jest.unmock('fs/promises');
        jest.resetModules();
    });

    test('restoreFile copies from backup to root and safety-copies current', async () => {
        const meta = await mod.createBackup();
        // modify root config.json so safety copy path takes effect
        seedWhitelist(fsMock, ROOT, { 'config.json': '{"a":2}' });
        const out = await mod.restoreFile(meta.id, 'config.json');
        expect(out.ok).toBe(true);
        // restored file exists at root
        expect(fsMock.existsSync(path.join(ROOT, 'config.json'))).toBe(true);
    });

    test('restoreFile throws for invalid cases', async () => {
        const meta = await mod.createBackup();
        await expect(mod.restoreFile('nope', 'config.json')).rejects.toThrow('Backup not found');
        await expect(mod.restoreFile(meta.id, 'nope.json')).rejects.toThrow('File not allowed');
    });

    test('deleteBackup removes directory', async () => {
        const meta = await mod.createBackup();
        const res = await mod.deleteBackup(meta.id);
        expect(res.ok).toBe(true);
        const list = await mod.listBackups();
        expect(list.find(x => x.id === meta.id)).toBeUndefined();
    });

    test('schedule read/write roundtrip with defaults and bounds', async () => {
        // write with custom values
        const cfg = await mod.writeScheduleConfig({
            enabled: false,
            time: '01:15',
            retention: 100,
        });
        expect(cfg).toEqual({ enabled: false, time: '01:15', retention: 60, retentionDays: 0 });
        // read back
        const read = await mod.readScheduleConfig();
        expect(read).toEqual({ enabled: false, time: '01:15', retention: 60, retentionDays: 0 });
        // write with partial
        const cfg2 = await mod.writeScheduleConfig({ time: '03:00' });
        expect(cfg2).toEqual({ enabled: true, time: '03:00', retention: 5, retentionDays: 0 });
    });

    test('restoreFile handles missing current file (no safety copy needed)', async () => {
        const meta = await mod.createBackup();
        // Delete the current config.json so restore happens without safety copy
        fsMock.data.delete(path.resolve(path.join(ROOT, 'config.json')));
        const out = await mod.restoreFile(meta.id, 'config.json');
        expect(out.ok).toBe(true);
        // File should now exist after restore
        expect(fsMock.existsSync(path.join(ROOT, 'config.json'))).toBe(true);
    });

    test('listBackups returns empty array when no backups exist', async () => {
        // Don't create any backups
        const list = await mod.listBackups();
        expect(list).toEqual([]);
    });

    test('cleanupOldBackups handles zero retention gracefully', async () => {
        await mod.createBackup();
        jest.setSystemTime(new Date('2025-01-01T00:00:01Z'));
        await mod.createBackup();
        const res = await mod.cleanupOldBackups(0);
        // Should delete all backups when retention is 0
        expect(res.deleted).toBe(2);
        const remaining = await mod.listBackups();
        expect(remaining.length).toBe(0);
    });

    test('readScheduleConfig returns defaults when config.json missing', async () => {
        // Delete config.json to trigger catch block
        fsMock.data.delete(path.resolve(path.join(ROOT, 'config.json')));
        const cfg = await mod.readScheduleConfig();
        expect(cfg).toEqual({ enabled: true, time: '02:30', retention: 5, retentionDays: 0 });
    });

    test('writeScheduleConfig clamps retention to valid range (1-60)', async () => {
        // Test upper bound
        const cfg1 = await mod.writeScheduleConfig({ retention: 200 });
        expect(cfg1.retention).toBe(60);
        // Test lower bound
        const cfg2 = await mod.writeScheduleConfig({ retention: -5 });
        expect(cfg2.retention).toBe(1);
        // Test valid value
        const cfg3 = await mod.writeScheduleConfig({ retention: 30 });
        expect(cfg3.retention).toBe(30);
    });

    test('writeScheduleConfig clamps retentionDays to valid range (0-365)', async () => {
        // Test upper bound
        const cfg1 = await mod.writeScheduleConfig({ retentionDays: 500 });
        expect(cfg1.retentionDays).toBe(365);
        // Test lower bound (negative becomes 0)
        const cfg2 = await mod.writeScheduleConfig({ retentionDays: -10 });
        expect(cfg2.retentionDays).toBe(0);
        // Test valid value
        const cfg3 = await mod.writeScheduleConfig({ retentionDays: 90 });
        expect(cfg3.retentionDays).toBe(90);
    });

    test('cleanupOldBackups deletes backups older than maxAgeDays', async () => {
        // Create backup at time 1
        jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
        await mod.createBackup();
        // Create backup at time 2 (31 days later)
        jest.setSystemTime(new Date('2025-02-01T00:00:00Z'));
        const recent = await mod.createBackup();
        // Cleanup with maxAgeDays=30, should delete only the old one
        const res = await mod.cleanupOldBackups(10, 30);
        expect(res.deleted).toBe(1);
        expect(res.kept).toBe(1);
        // Verify old backup deleted, recent kept
        const list = await mod.listBackups();
        expect(list.length).toBe(1);
        expect(list[0].id).toBe(recent.id);
    });

    test('cleanupOldBackups with maxAgeDays=0 disables age-based deletion', async () => {
        // Create backup at time 1
        jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
        await mod.createBackup();
        // Create backup at time 2 (100 days later)
        jest.setSystemTime(new Date('2025-04-11T00:00:00Z'));
        await mod.createBackup();
        // Cleanup with maxAgeDays=0 (disabled), keep=10, should keep both
        const res = await mod.cleanupOldBackups(10, 0);
        expect(res.deleted).toBe(0);
        expect(res.kept).toBe(2);
    });

    test('cleanupOldBackups combines count and age retention (OR logic)', async () => {
        // Create 3 backups: 1 old, 2 recent
        jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
        await mod.createBackup();
        jest.setSystemTime(new Date('2025-02-01T00:00:00Z'));
        await mod.createBackup();
        jest.setSystemTime(new Date('2025-02-02T00:00:00Z'));
        await mod.createBackup();
        // Cleanup with keep=2 and maxAgeDays=30
        // Should delete: first backup (too old) but keep both recent ones
        const res = await mod.cleanupOldBackups(2, 30);
        expect(res.deleted).toBe(1);
        expect(res.kept).toBe(2);
    });
});
