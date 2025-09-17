const fs = require('fs');
const path = require('path');
const updater = require('../../utils/updater');

/**
 * Targets rollback branch (error during update and rollback attempt).
 * We simulate failure by monkeypatching internal methods.
 */

describe('updater rollback path', () => {
    const origCreateBackup = updater.createBackup;
    const origDownload = updater.downloadUpdate;
    const origValidate = updater.validateDownload;
    const origStop = updater.stopServices;
    const origApply = updater.applyUpdate;
    const origUpdateDeps = updater.updateDependencies;

    beforeEach(() => {
        // reset status
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
        updater.stopServices = origStop;
        updater.applyUpdate = origApply;
        updater.updateDependencies = origUpdateDeps;
    });

    test('rollback triggered when applyUpdate throws', async () => {
        // Minimal mock chain
        updater.createBackup = jest.fn().mockResolvedValue(path.join(__dirname, 'fake-backup'));
        // Ensure fake backup directory exists for restore attempt
        const bdir = path.join(__dirname, 'fake-backup');
        if (!fs.existsSync(bdir)) fs.mkdirSync(bdir, { recursive: true });
        fs.writeFileSync(path.join(bdir, 'package.json'), '{"name":"x","version":"0.0.0"}');

        updater.downloadUpdate = jest.fn().mockResolvedValue(path.join(__dirname, 'fake.zip'));
        updater.validateDownload = jest.fn().mockResolvedValue();
        updater.stopServices = jest.fn().mockResolvedValue();
        updater.applyUpdate = jest.fn().mockRejectedValue(new Error('apply failed'));
        updater.updateDependencies = jest.fn().mockResolvedValue();
        updater.rollback = jest.fn().mockResolvedValue();
        // Force update path by faking checkForUpdates
        updater.checkForUpdates = jest
            .fn()
            .mockResolvedValue({ hasUpdate: true, latestVersion: '0.0.1' });

        await expect(updater.startUpdate()).rejects.toThrow('apply failed');
        expect(updater.rollback).toHaveBeenCalled();
        expect(updater.updateStatus.phase).toBe('error');
        expect(updater.updateStatus.message).toMatch(/Update failed/);
    });
});
