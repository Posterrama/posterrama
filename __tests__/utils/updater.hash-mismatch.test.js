const path = require('path');
const os = require('os');
const fs = require('fs');
const updater = require('../../utils/updater');

/**
 * Goal: Cover validation failure branch (simulate checksum/hash mismatch) and ensure
 * rollback is attempted after a validation error occurring post-backup & download.
 *
 * Rationale: Existing tests cover rollback after applyUpdate failure, but not the
 * earlier failure window during validateDownload. This exercises the catch block
 * and rollback invocation when validation throws before services stop/apply.
 */

describe('updater validation failure rollback path', () => {
    const origCreateBackup = updater.createBackup;
    const origDownload = updater.downloadUpdate;
    const origValidate = updater.validateDownload;
    const origRollback = updater.rollback;
    const origCheck = updater.checkForUpdates;

    beforeEach(() => {
        updater.updateInProgress = false;
        updater.updateStatus = {
            phase: 'idle',
            progress: 0,
            message: '',
            error: null,
            startTime: null,
            backupPath: null,
        };
    });

    afterAll(() => {
        updater.createBackup = origCreateBackup;
        updater.downloadUpdate = origDownload;
        updater.validateDownload = origValidate;
        updater.rollback = origRollback;
        updater.checkForUpdates = origCheck;
    });

    test('rollback invoked when validateDownload throws (simulated checksum mismatch)', async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'posterrama-updater-validate-'));
        const backupDir = path.join(tmpRoot, 'backup');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'package.json'), '{"name":"x","version":"0.0.0"}');

        updater.createBackup = jest.fn().mockResolvedValue(backupDir);
        updater.downloadUpdate = jest.fn().mockResolvedValue(path.join(tmpRoot, 'fake.zip'));
        updater.validateDownload = jest
            .fn()
            .mockRejectedValue(new Error('checksum mismatch – file hash does not match manifest'));
        updater.rollback = jest.fn().mockResolvedValue();
        updater.checkForUpdates = jest
            .fn()
            .mockResolvedValue({ hasUpdate: true, latestVersion: '0.0.2' });

        await expect(updater.startUpdate()).rejects.toThrow(/checksum mismatch/i);

        expect(updater.createBackup).toHaveBeenCalled();
        expect(updater.downloadUpdate).toHaveBeenCalled();
        expect(updater.validateDownload).toHaveBeenCalled();
        // Because backupPath is set prior to validation, rollback should be attempted
        expect(updater.rollback).toHaveBeenCalled();
        expect(updater.updateStatus.phase).toBe('error');
        expect(updater.updateStatus.error).toMatch(/checksum mismatch/i);
        expect(updater.updateStatus.message).toMatch(/Update failed/i);
    });
});
