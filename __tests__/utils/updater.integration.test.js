const fs = require('fs').promises;

// Mock logger
jest.mock('../../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

// Mock fs
jest.mock('fs', () => ({
    promises: {
        mkdir: jest.fn(),
        readdir: jest.fn(),
        stat: jest.fn(),
        readFile: jest.fn(),
        writeFile: jest.fn(),
        copyFile: jest.fn(),
        access: jest.fn(),
        rmdir: jest.fn(),
        unlink: jest.fn(),
    },
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
}));

describe('AutoUpdater - Full Workflow & Edge Cases', () => {
    let AutoUpdater;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup fs mocks
        fs.mkdir.mockResolvedValue();
        fs.readdir.mockResolvedValue([]);
        fs.stat.mockResolvedValue({
            isDirectory: () => false,
            size: 1024,
            birthtime: new Date(),
        });
        fs.readFile.mockResolvedValue(JSON.stringify({ version: '1.0.0' }));
        fs.writeFile.mockResolvedValue();
        fs.copyFile.mockResolvedValue();
        fs.access.mockResolvedValue();
        fs.rmdir.mockResolvedValue();
        fs.unlink.mockResolvedValue();

        delete require.cache[require.resolve('../../utils/updater')];
        delete require.cache[require.resolve('../../utils/github')];

        AutoUpdater = require('../../utils/updater');
        require('../../utils/github');
    });

    afterEach(() => {
        if (AutoUpdater && AutoUpdater.updateInProgress) {
            AutoUpdater.updateInProgress = false;
        }
    });

    describe('Full Update Workflow', () => {
        test('should handle forced update with target version', async () => {
            // Mock all the individual methods
            jest.spyOn(AutoUpdater, 'checkForUpdates').mockResolvedValue({
                hasUpdate: true,
                currentVersion: '1.0.0',
                latestVersion: '2.0.0',
            });
            jest.spyOn(AutoUpdater, 'createBackup').mockResolvedValue('backups/backup-test');
            jest.spyOn(AutoUpdater, 'downloadUpdate').mockResolvedValue('/tmp/update.zip');
            jest.spyOn(AutoUpdater, 'validateDownload').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'stopServices').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'applyUpdate').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'updateDependencies').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'startServices').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'verifyUpdate').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'cleanup').mockResolvedValue();

            const result = await AutoUpdater.startUpdate('2.0.0');

            expect(result.success).toBe(true);
            expect(result.version).toBe('2.0.0');
            expect(AutoUpdater.updateStatus.phase).toBe('completed');
            expect(AutoUpdater.updateStatus.progress).toBe(100);
            expect(AutoUpdater.updateInProgress).toBe(false);
        });

        test('should handle update failure and attempt rollback', async () => {
            jest.spyOn(AutoUpdater, 'checkForUpdates').mockResolvedValue({
                hasUpdate: true,
                currentVersion: '1.0.0',
                latestVersion: '2.0.0',
            });
            jest.spyOn(AutoUpdater, 'createBackup').mockResolvedValue('backups/backup-test');
            jest.spyOn(AutoUpdater, 'downloadUpdate').mockResolvedValue('/tmp/update.zip');
            jest.spyOn(AutoUpdater, 'validateDownload').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'stopServices').mockResolvedValue();
            // Make applyUpdate fail
            jest.spyOn(AutoUpdater, 'applyUpdate').mockRejectedValue(new Error('Apply failed'));
            jest.spyOn(AutoUpdater, 'rollback').mockResolvedValue();

            await expect(AutoUpdater.startUpdate('2.0.0')).rejects.toThrow('Apply failed');

            expect(AutoUpdater.updateStatus.phase).toBe('error');
            expect(AutoUpdater.updateStatus.error).toBe('Apply failed');
            expect(AutoUpdater.updateInProgress).toBe(false);
            expect(AutoUpdater.rollback).toHaveBeenCalled();
        });
    });

    describe('copyDirectory functionality', () => {
        test('should copy directory recursively', async () => {
            fs.readdir.mockResolvedValueOnce(['file1.js', 'subdir']);
            fs.stat.mockImplementation(filePath => {
                if (filePath.includes('subdir')) {
                    return Promise.resolve({ isDirectory: () => true });
                }
                return Promise.resolve({ isDirectory: () => false });
            });
            fs.readdir.mockResolvedValueOnce(['file2.js']); // subdir contents

            await AutoUpdater.copyDirectory('/source', '/dest');

            expect(fs.mkdir).toHaveBeenCalledWith('/dest', { recursive: true });
            expect(fs.copyFile).toHaveBeenCalledWith('/source/file1.js', '/dest/file1.js');
        });

        test('should exclude specified items during copy', async () => {
            fs.readdir.mockResolvedValue(['file1.js', 'node_modules', 'file2.js']);
            fs.stat.mockResolvedValue({ isDirectory: () => false });

            await AutoUpdater.copyDirectory('/source', '/dest', ['node_modules']);

            expect(fs.copyFile).toHaveBeenCalledWith('/source/file1.js', '/dest/file1.js');
            expect(fs.copyFile).toHaveBeenCalledWith('/source/file2.js', '/dest/file2.js');
            expect(fs.copyFile).not.toHaveBeenCalledWith(
                '/source/node_modules',
                expect.any(String)
            );
        });
    });

    describe('Memory preservation utilities', () => {
        test('should copy directory to memory', async () => {
            // First call - main directory
            fs.readdir.mockResolvedValueOnce(['config.json', 'subdir']);

            // Mock stats for each item
            let callCount = 0;
            fs.stat.mockImplementation(filePath => {
                callCount++;
                if (filePath.includes('subdir') && callCount <= 2) {
                    return Promise.resolve({ isDirectory: () => true });
                }
                return Promise.resolve({ isDirectory: () => false });
            });

            // Second call - subdirectory
            fs.readdir.mockResolvedValueOnce(['nested.json']);

            // Mock readFile calls in order
            fs.readFile.mockResolvedValueOnce(Buffer.from('{"key":"value"}')); // config.json
            fs.readFile.mockResolvedValueOnce(Buffer.from('{"nested":"data"}')); // nested.json

            const result = await AutoUpdater.copyDirectoryToMemory('/test/dir');

            expect(result['config.json']).toEqual({
                type: 'file',
                content: Buffer.from('{"key":"value"}'),
            });
            expect(result['subdir']).toHaveProperty('type', 'directory');
            expect(result['subdir']).toHaveProperty('content');
        });

        test('should restore directory from memory', async () => {
            const memoryData = {
                'config.json': { type: 'file', content: '{"key":"value"}' },
                subdir: {
                    type: 'directory',
                    content: {
                        'nested.json': { type: 'file', content: '{"nested":"data"}' },
                    },
                },
            };

            await AutoUpdater.restoreDirectoryFromMemory('/restore/path', memoryData);

            expect(fs.mkdir).toHaveBeenCalledWith('/restore/path', { recursive: true });
            expect(fs.writeFile).toHaveBeenCalledWith(
                '/restore/path/config.json',
                '{"key":"value"}'
            );
            expect(fs.mkdir).toHaveBeenCalledWith('/restore/path/subdir', { recursive: true });
            expect(fs.writeFile).toHaveBeenCalledWith(
                '/restore/path/subdir/nested.json',
                '{"nested":"data"}'
            );
        });
    });

    describe('Error handling and edge cases', () => {
        test('should handle invalid backup manifests gracefully', async () => {
            fs.access.mockResolvedValue(); // backup dir exists
            fs.readdir.mockResolvedValue(['backup-1', 'backup-2', 'invalid-backup']);
            fs.readFile.mockImplementation(filePath => {
                if (filePath.includes('invalid-backup')) {
                    return Promise.reject(new Error('Invalid JSON'));
                }
                return Promise.resolve(
                    JSON.stringify({
                        version: '1.0.0',
                        timestamp: '2023-01-01T00:00:00.000Z',
                    })
                );
            });
            fs.stat.mockResolvedValue({
                size: 1024,
                birthtime: new Date('2023-01-01'),
            });

            const backups = await AutoUpdater.listBackups();

            // Should only include valid backups
            expect(backups).toHaveLength(2);
        });

        test('should handle paths and directory resolution correctly', () => {
            expect(AutoUpdater.appRoot).toContain('posterrama');
            expect(AutoUpdater.backupDir).toContain('backups');
            expect(AutoUpdater.tempDir).toContain('temp');
        });

        test('should handle cleanup with missing temp directory', async () => {
            fs.access.mockRejectedValue(new Error('ENOENT')); // temp dir doesn't exist

            await expect(AutoUpdater.cleanup()).resolves.toBeUndefined();
            expect(fs.rmdir).not.toHaveBeenCalled();
        });

        test('should handle backup creation with existing backup directory', async () => {
            fs.access.mockResolvedValue(); // backup dir already exists
            jest.spyOn(AutoUpdater, 'copyDirectory').mockResolvedValue();

            const backupPath = await AutoUpdater.createBackup();

            expect(backupPath).toBeTruthy();
            expect(AutoUpdater.copyDirectory).toHaveBeenCalled();
        });
    });

    describe('Status management', () => {
        test('should update status during different phases', async () => {
            const statuses = [];

            // Mock methods to capture status changes
            AutoUpdater.createBackup = jest.fn().mockImplementation(async () => {
                statuses.push(AutoUpdater.updateStatus.phase);
                return '/backup/path';
            });

            jest.spyOn(AutoUpdater, 'checkForUpdates').mockResolvedValue({
                hasUpdate: true,
                latestVersion: '1.1.0',
            });
            jest.spyOn(AutoUpdater, 'downloadUpdate').mockResolvedValue('/tmp/update.zip');
            jest.spyOn(AutoUpdater, 'validateDownload').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'stopServices').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'applyUpdate').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'updateDependencies').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'startServices').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'verifyUpdate').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'cleanup').mockResolvedValue();

            await AutoUpdater.startUpdate();

            expect(statuses).toContain('backup');
            expect(AutoUpdater.updateStatus.startTime).toBeInstanceOf(Date);
        });
    });
});
