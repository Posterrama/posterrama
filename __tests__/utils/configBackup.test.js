/**
 * Unit tests for config backup utilities
 *
 * These tests run against an isolated temp root via POSTERRAMA_BACKUP_ROOT
 * to avoid writing to the repo's real config/backups.
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

jest.mock('../../utils/auditLogger', () => ({
    auditLog: jest.fn(),
}));

describe('configBackup utilities', () => {
    /** @type {string} */
    let root;

    beforeEach(async () => {
        jest.resetModules();

        root = await fs.mkdtemp(path.join(os.tmpdir(), 'posterrama-config-backup-'));
        process.env.POSTERRAMA_BACKUP_ROOT = root;

        // Create a few whitelisted files in the temp root
        await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ foo: 'bar' }, null, 2));
        await fs.writeFile(
            path.join(root, 'devices.json'),
            JSON.stringify({ devices: [] }, null, 2)
        );
        await fs.writeFile(path.join(root, '.env'), 'A=1\n');
    });

    afterEach(async () => {
        delete process.env.POSTERRAMA_BACKUP_ROOT;
        if (root) {
            await fs.rm(root, { recursive: true, force: true });
        }
        jest.useRealTimers();
    });

    test('createBackup writes meta + copies whitelisted files', async () => {
        const { createBackup, listBackups } = require('../../utils/configBackup');

        const meta = await createBackup({ label: 'Manual backup test' });

        expect(meta).toHaveProperty('id');
        expect(String(meta.id)).toMatch(/^\d{8}-\d{6}$/);
        expect(meta).toHaveProperty('createdAt');
        expect(Array.isArray(meta.files)).toBe(true);
        expect(meta.files.length).toBe(3);

        const backups = await listBackups();
        expect(backups).toHaveLength(1);
        expect(backups[0].id).toBe(meta.id);
        expect(backups[0].files.map(f => f.name)).toEqual(
            expect.arrayContaining(['config.json', 'devices.json', '.env'])
        );
    });

    test('updateBackupMetadata updates label/note and can remove them', async () => {
        const { createBackup, updateBackupMetadata } = require('../../utils/configBackup');

        const meta = await createBackup();

        const updated = await updateBackupMetadata(meta.id, {
            label: 'My label',
            note: 'My note',
        });
        expect(updated.label).toBe('My label');
        expect(updated.note).toBe('My note');

        const removed = await updateBackupMetadata(meta.id, { label: '', note: null });
        expect(removed.label).toBeUndefined();
        expect(removed.note).toBeUndefined();
    });

    test('cleanupOldBackups deletes old backups by count', async () => {
        jest.useFakeTimers();

        const {
            createBackup,
            listBackups,
            cleanupOldBackups,
        } = require('../../utils/configBackup');

        jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
        const a = await createBackup({ label: 'A' });

        jest.setSystemTime(new Date('2025-01-01T00:00:01Z'));
        const b = await createBackup({ label: 'B' });

        const before = await listBackups();
        expect(before.map(x => x.id)).toEqual(expect.arrayContaining([a.id, b.id]));

        const result = await cleanupOldBackups(1, 0);
        expect(result).toEqual({ deleted: 1, kept: 1 });

        const after = await listBackups();
        expect(after).toHaveLength(1);
    });

    test('readScheduleConfig and writeScheduleConfig round-trip', async () => {
        const { readScheduleConfig, writeScheduleConfig } = require('../../utils/configBackup');

        // Default when backups section missing
        const defaults = await readScheduleConfig();
        expect(defaults).toMatchObject({
            enabled: true,
            time: '02:30',
            retention: 5,
            retentionDays: 0,
        });

        const written = await writeScheduleConfig({
            enabled: true,
            time: '03:15',
            retention: 7,
            retentionDays: 10,
        });
        expect(written).toMatchObject({
            enabled: true,
            time: '03:15',
            retention: 7,
            retentionDays: 10,
        });

        const reread = await readScheduleConfig();
        expect(reread).toMatchObject({
            enabled: true,
            time: '03:15',
            retention: 7,
            retentionDays: 10,
        });
    });
});
