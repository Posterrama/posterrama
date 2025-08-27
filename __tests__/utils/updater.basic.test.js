describe('AutoUpdater - Basic Tests', () => {
    let AutoUpdater;

    beforeEach(() => {
        jest.clearAllMocks();
        // Clear require cache to ensure fresh instance
        delete require.cache[require.resolve('../../utils/updater')];
        AutoUpdater = require('../../utils/updater');
    });

    afterEach(() => {
        // Reset update status after each test
        if (AutoUpdater && AutoUpdater.updateInProgress) {
            AutoUpdater.updateInProgress = false;
        }
    });

    describe('Constructor and Basic Methods', () => {
        test('should initialize with correct default values', () => {
            expect(AutoUpdater.updateInProgress).toBe(false);
            expect(AutoUpdater.updateStatus.phase).toBe('idle');
            expect(AutoUpdater.updateStatus.progress).toBe(0);
            expect(AutoUpdater.updateStatus.message).toBe('');
            expect(AutoUpdater.updateStatus.error).toBeNull();
            expect(AutoUpdater.updateStatus.startTime).toBeNull();
            expect(AutoUpdater.updateStatus.backupPath).toBeNull();
        });

        test('should have required static properties', () => {
            expect(AutoUpdater.updateInProgress).toBe(false);
            expect(AutoUpdater.deferStop).toBe(false);
            expect(typeof AutoUpdater.updateStatus).toBe('object');
            expect(typeof AutoUpdater.appRoot).toBe('string');
            expect(typeof AutoUpdater.backupDir).toBe('string');
            expect(typeof AutoUpdater.tempDir).toBe('string');
            expect(typeof AutoUpdater.statusFile).toBe('string');
        });

        test('should return status correctly', () => {
            const status = AutoUpdater.getStatus();
            expect(status).toHaveProperty('phase');
            expect(status).toHaveProperty('progress');
            expect(status).toHaveProperty('message');
            expect(status).toHaveProperty('error');
            expect(status).toHaveProperty('startTime');
            expect(status).toHaveProperty('backupPath');

            // Should return a copy, not the original object
            status.phase = 'test';
            expect(AutoUpdater.updateStatus.phase).not.toBe('test');
        });

        test('should check if update is in progress', () => {
            expect(AutoUpdater.isUpdating()).toBe(false);

            AutoUpdater.updateInProgress = true;
            expect(AutoUpdater.isUpdating()).toBe(true);
        });

        test('should have required methods', () => {
            expect(typeof AutoUpdater.getStatus).toBe('function');
            expect(typeof AutoUpdater.isUpdating).toBe('function');
            expect(typeof AutoUpdater.startUpdate).toBe('function');
            expect(typeof AutoUpdater.checkForUpdates).toBe('function');
            expect(typeof AutoUpdater.rollback).toBe('function');
            expect(typeof AutoUpdater.cleanup).toBe('function');
            expect(typeof AutoUpdater.listBackups).toBe('function');
            expect(typeof AutoUpdater.cleanupOldBackups).toBe('function');
        });
    });

    describe('Error Handling', () => {
        test('should prevent concurrent updates', async () => {
            AutoUpdater.updateInProgress = true;

            await expect(AutoUpdater.startUpdate()).rejects.toThrow('Update already in progress');
        });

        test('should handle checkForUpdates errors gracefully', async () => {
            const githubService = require('../../utils/github');
            jest.spyOn(githubService, 'checkForUpdates').mockRejectedValue(new Error('API Error'));

            await expect(AutoUpdater.checkForUpdates()).rejects.toThrow('API Error');
        });
    });
});
