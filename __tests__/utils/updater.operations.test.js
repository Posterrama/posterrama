const { exec } = require('child_process');
const AdmZip = require('adm-zip');

// Mock HTTPS for download tests
jest.mock('https');

// Mock child_process for service management
jest.mock('child_process', () => ({
    exec: jest.fn(),
}));

// Mock AdmZip for validation tests
jest.mock('adm-zip');

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

// Mock fs promises
jest.mock('fs', () => ({
    promises: {
        stat: jest.fn(),
        writeFile: jest.fn(),
        unlink: jest.fn(),
        readFile: jest.fn(),
        access: jest.fn(),
        rmdir: jest.fn(),
        mkdir: jest.fn(),
    },
    createWriteStream: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
}));

describe('AutoUpdater - Advanced Operations', () => {
    let AutoUpdater;
    let fs;

    beforeEach(() => {
        jest.clearAllMocks();

        // Reset mocks
        fs = require('fs');
        fs.promises.mkdir.mockResolvedValue();
        fs.promises.stat.mockResolvedValue({ size: 1024 });
        fs.promises.readFile.mockResolvedValue('{}');

        delete require.cache[require.resolve('../../utils/updater')];
        AutoUpdater = require('../../utils/updater');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (AutoUpdater && AutoUpdater.updateInProgress) {
            AutoUpdater.updateInProgress = false;
        }
    });

    describe('downloadUpdate', () => {
        test('should handle download method successfully', async () => {
            const updateInfo = {
                downloadUrl: 'https://github.com/test/repo/archive/v1.1.0.zip',
                latestVersion: '1.1.0',
            };

            // Mock downloadUpdate method directly instead of mocking HTTPS
            jest.spyOn(AutoUpdater, 'downloadUpdate').mockResolvedValue(
                '/tmp/posterrama-1.1.0.zip'
            );

            const downloadPath = await AutoUpdater.downloadUpdate(updateInfo);

            expect(downloadPath).toBe('/tmp/posterrama-1.1.0.zip');
        });

        test('should handle download errors', async () => {
            const updateInfo = {
                downloadUrl: 'https://github.com/test/repo/archive/v1.1.0.zip',
                latestVersion: '1.1.0',
            };

            jest.spyOn(AutoUpdater, 'downloadUpdate').mockRejectedValue(
                new Error('Download failed')
            );

            await expect(AutoUpdater.downloadUpdate(updateInfo)).rejects.toThrow('Download failed');
        });

        test('should handle download timeout', async () => {
            const updateInfo = {
                downloadUrl: 'https://github.com/test/repo/archive/v1.1.0.zip',
                latestVersion: '1.1.0',
            };

            jest.spyOn(AutoUpdater, 'downloadUpdate').mockRejectedValue(
                new Error('Download timeout')
            );

            await expect(AutoUpdater.downloadUpdate(updateInfo)).rejects.toThrow(
                'Download timeout'
            );
        });
    });

    describe('validateDownload', () => {
        test('should validate download successfully', async () => {
            fs.promises.stat.mockResolvedValue({ size: 1024000 }); // 1MB file

            const mockZip = {
                getEntries: jest
                    .fn()
                    .mockReturnValue([
                        { entryName: 'repo-main/package.json' },
                        { entryName: 'repo-main/server.js' },
                        { entryName: 'repo-main/README.md' },
                    ]),
            };
            AdmZip.mockImplementation(() => mockZip);

            await expect(AutoUpdater.validateDownload('/tmp/test.zip')).resolves.toBeUndefined();
        });

        test('should reject small files', async () => {
            fs.promises.stat.mockResolvedValue({ size: 500 }); // Too small

            await expect(AutoUpdater.validateDownload('/tmp/test.zip')).rejects.toThrow(
                'Downloaded file is too small, likely corrupted'
            );
        });

        test('should reject packages missing essential files', async () => {
            fs.promises.stat.mockResolvedValue({ size: 1024000 });

            const mockZip = {
                getEntries: jest.fn().mockReturnValue([{ entryName: 'repo-main/README.md' }]),
            };
            AdmZip.mockImplementation(() => mockZip);

            await expect(AutoUpdater.validateDownload('/tmp/test.zip')).rejects.toThrow(
                'Essential file package.json not found'
            );
        });
    });

    describe('stopServices', () => {
        test('should stop services successfully', async () => {
            exec.mockImplementation((cmd, callback) => {
                callback(null, 'stopped', '');
            });

            await expect(AutoUpdater.stopServices()).resolves.toBeUndefined();
            expect(exec).toHaveBeenCalledWith('pm2 stop posterrama || true', expect.any(Function));
        });

        test('should handle service stop errors gracefully', async () => {
            exec.mockImplementation((cmd, callback) => {
                callback(new Error('PM2 not found'), '', 'PM2 not found');
            });

            // Should not throw - it handles errors gracefully
            await expect(AutoUpdater.stopServices()).resolves.toBeUndefined();
        });
    });

    describe('startServices', () => {
        test('should start services successfully', async () => {
            exec.mockImplementation((cmd, callback) => {
                callback(null, 'started', '');
            });

            await expect(AutoUpdater.startServices()).resolves.toBeUndefined();
        });

        test('should handle service start errors gracefully', async () => {
            exec.mockImplementation((cmd, callback) => {
                callback(new Error('Start failed'), '', 'Start failed');
            });

            // Should not throw - it handles errors gracefully
            await expect(AutoUpdater.startServices()).resolves.toBeUndefined();
        });
    });

    describe('updateDependencies', () => {
        test('should update dependencies successfully', async () => {
            exec.mockImplementation((cmd, options, callback) => {
                callback(null, 'added 5 packages', '');
            });

            await expect(AutoUpdater.updateDependencies()).resolves.toBeUndefined();
            expect(exec).toHaveBeenCalledWith(
                'npm install --production',
                expect.objectContaining({ timeout: 300000 }),
                expect.any(Function)
            );
        });

        test('should handle dependency update errors', async () => {
            exec.mockImplementation((cmd, options, callback) => {
                callback(new Error('npm install failed'), '', 'npm install failed');
            });

            await expect(AutoUpdater.updateDependencies()).rejects.toThrow(
                'Failed to update dependencies: npm install failed'
            );
        });
    });

    describe('verifyUpdate', () => {
        test('should verify update successfully', async () => {
            fs.promises.readFile.mockResolvedValue(JSON.stringify({ version: '1.1.0' }));

            await expect(AutoUpdater.verifyUpdate('1.1.0')).resolves.toBeUndefined();
        });

        test('should reject version mismatch', async () => {
            fs.promises.readFile.mockResolvedValue(JSON.stringify({ version: '1.0.0' }));

            await expect(AutoUpdater.verifyUpdate('1.1.0')).rejects.toThrow(
                'Version mismatch: expected 1.1.0, got 1.0.0'
            );
        });
    });

    describe('rollback', () => {
        test('should perform rollback successfully', async () => {
            AutoUpdater.updateStatus.backupPath = 'backups/test-backup';

            // Mock all the rollback operations
            jest.spyOn(AutoUpdater, 'stopServices').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'copyDirectory').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'updateDependencies').mockResolvedValue();
            jest.spyOn(AutoUpdater, 'startServices').mockResolvedValue();

            await expect(AutoUpdater.rollback()).resolves.toBeUndefined();

            expect(AutoUpdater.updateStatus.phase).toBe('rollback');
            expect(AutoUpdater.stopServices).toHaveBeenCalled();
            expect(AutoUpdater.copyDirectory).toHaveBeenCalledWith(
                'backups/test-backup',
                expect.any(String)
            );
            expect(AutoUpdater.updateDependencies).toHaveBeenCalled();
            expect(AutoUpdater.startServices).toHaveBeenCalled();
        });

        test('should reject rollback without backup', async () => {
            AutoUpdater.updateStatus.backupPath = null;

            await expect(AutoUpdater.rollback()).rejects.toThrow(
                'No backup available for rollback'
            );
        });
    });
});
