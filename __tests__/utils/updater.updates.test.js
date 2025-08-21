const fs = require('fs').promises;

describe('AutoUpdater - Update Checking', () => {
    let AutoUpdater;
    let githubService;
    let mockPackageJson;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock fs.readFile for package.json
        mockPackageJson = { version: '1.0.0' };
        jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockPackageJson));

        // Clear require cache
        delete require.cache[require.resolve('../../utils/updater')];
        delete require.cache[require.resolve('../../utils/github')];

        AutoUpdater = require('../../utils/updater');
        githubService = require('../../utils/github');
    });

    afterEach(() => {
        if (AutoUpdater && AutoUpdater.updateInProgress) {
            AutoUpdater.updateInProgress = false;
        }
    });

    describe('checkForUpdates', () => {
        test('should check for updates successfully', async () => {
            const mockUpdateInfo = {
                hasUpdate: true,
                currentVersion: '1.0.0',
                latestVersion: '1.1.0',
                downloadUrl: 'https://github.com/test/test/archive/v1.1.0.zip',
            };

            jest.spyOn(githubService, 'checkForUpdates').mockResolvedValue(mockUpdateInfo);

            const result = await AutoUpdater.checkForUpdates();

            expect(result).toEqual(mockUpdateInfo);
            expect(githubService.checkForUpdates).toHaveBeenCalledWith('1.0.0');
        });

        test('should handle no updates available', async () => {
            const mockUpdateInfo = {
                hasUpdate: false,
                currentVersion: '1.0.0',
                latestVersion: '1.0.0',
            };

            jest.spyOn(githubService, 'checkForUpdates').mockResolvedValue(mockUpdateInfo);

            const result = await AutoUpdater.checkForUpdates();

            expect(result.hasUpdate).toBe(false);
            expect(result.currentVersion).toBe('1.0.0');
        });

        test('should use target version when provided', async () => {
            // Spy on GitHub service
            jest.spyOn(githubService, 'checkForUpdates').mockResolvedValue({});

            const result = await AutoUpdater.checkForUpdates('2.0.0');

            expect(result.hasUpdate).toBe(true);
            expect(result.currentVersion).toBe('1.0.0');
            expect(result.latestVersion).toBe('2.0.0');
            expect(result.updateType).toBe('major');

            // Should not call GitHub service when target version provided
            expect(githubService.checkForUpdates).not.toHaveBeenCalled();
        });

        test('should handle target version with no update needed', async () => {
            const result = await AutoUpdater.checkForUpdates('0.9.0');

            expect(result.hasUpdate).toBe(false);
            expect(result.currentVersion).toBe('1.0.0');
            expect(result.latestVersion).toBe('0.9.0');
            expect(result.updateType).toBe('major');
        });

        test('should handle GitHub API errors', async () => {
            jest.spyOn(githubService, 'checkForUpdates').mockRejectedValue(
                new Error('GitHub API Error')
            );

            await expect(AutoUpdater.checkForUpdates()).rejects.toThrow('GitHub API Error');
        });

        test('should handle package.json read errors', async () => {
            fs.readFile.mockRejectedValue(new Error('File not found'));

            await expect(AutoUpdater.checkForUpdates()).rejects.toThrow('File not found');
        });

        test('should handle malformed package.json', async () => {
            fs.readFile.mockResolvedValue('invalid json');

            await expect(AutoUpdater.checkForUpdates()).rejects.toThrow();
        });
    });

    describe('startUpdate - Early Phases', () => {
        test('should handle no updates available gracefully', async () => {
            const mockUpdateInfo = {
                hasUpdate: false,
                currentVersion: '1.0.0',
                latestVersion: '1.0.0',
            };

            jest.spyOn(githubService, 'checkForUpdates').mockResolvedValue(mockUpdateInfo);

            const result = await AutoUpdater.startUpdate();

            expect(result.success).toBe(true);
            expect(result.message).toBe('No updates available');
            expect(AutoUpdater.updateInProgress).toBe(false);
            expect(AutoUpdater.updateStatus.phase).toBe('completed');
        });

        test('should proceed with update when update is available', async () => {
            const mockUpdateInfo = {
                hasUpdate: true,
                currentVersion: '1.0.0',
                latestVersion: '1.1.0',
                downloadUrl: 'https://github.com/test/test/archive/v1.1.0.zip',
            };

            jest.spyOn(githubService, 'checkForUpdates').mockResolvedValue(mockUpdateInfo);

            // Mock createBackup to fail early so we don't proceed through entire update
            jest.spyOn(AutoUpdater, 'createBackup').mockRejectedValue(new Error('Backup failed'));

            await expect(AutoUpdater.startUpdate()).rejects.toThrow('Backup failed');

            expect(AutoUpdater.updateStatus.phase).toBe('error');
            expect(AutoUpdater.updateInProgress).toBe(false);
        });

        test('should set update status correctly during phases', async () => {
            const mockUpdateInfo = {
                hasUpdate: true,
                currentVersion: '1.0.0',
                latestVersion: '1.1.0',
            };

            jest.spyOn(githubService, 'checkForUpdates').mockResolvedValue(mockUpdateInfo);
            jest.spyOn(AutoUpdater, 'createBackup').mockRejectedValue(new Error('Test stop'));

            try {
                await AutoUpdater.startUpdate();
            } catch (error) {
                // Expected to fail
            }

            expect(AutoUpdater.updateStatus.startTime).toBeInstanceOf(Date);
            expect(AutoUpdater.updateStatus.phase).toBe('error');
        });
    });
});
