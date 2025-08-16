const fs = require('fs').promises;
const path = require('path');

// Mock filesystem operations
jest.mock('fs', () => ({
    promises: {
        access: jest.fn(),
        mkdir: jest.fn(),
        readdir: jest.fn(),
        stat: jest.fn(),
        readFile: jest.fn(),
        writeFile: jest.fn(),
        unlink: jest.fn(),
        rmdir: jest.fn(),
        copyFile: jest.fn()
    },
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn()
}));

// Mock child_process for exec operations
jest.mock('child_process', () => ({
    exec: jest.fn(),
    spawn: jest.fn()
}));

// Mock logger to prevent fs issues
jest.mock('../../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

describe('AutoUpdater - Filesystem Operations', () => {
    let AutoUpdater;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Setup default fs mocks
        fs.access.mockResolvedValue(); // Directory exists
        fs.mkdir.mockResolvedValue();
        fs.readdir.mockResolvedValue([]);
        fs.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true });
        fs.readFile.mockResolvedValue('{}');
        fs.writeFile.mockResolvedValue();
        fs.unlink.mockResolvedValue();
        fs.rmdir.mockResolvedValue();
        fs.copyFile.mockResolvedValue();
        
        delete require.cache[require.resolve('../../utils/updater')];
        AutoUpdater = require('../../utils/updater');
    });

    afterEach(() => {
        if (AutoUpdater && AutoUpdater.updateInProgress) {
            AutoUpdater.updateInProgress = false;
        }
    });

    describe('createBackup', () => {
        test('should create backup successfully', async () => {
            const mockStats = { isDirectory: () => true };
            fs.stat.mockResolvedValue(mockStats);
            fs.readdir.mockResolvedValue(['file1.js', 'file2.js']);
            
            // Mock copyDirectory method
            jest.spyOn(AutoUpdater, 'copyDirectory').mockResolvedValue();
            
            const backupPath = await AutoUpdater.createBackup();
            
            expect(backupPath).toContain('backup-');
            expect(fs.mkdir).toHaveBeenCalled();
            expect(AutoUpdater.copyDirectory).toHaveBeenCalled();
        });

        test('should handle backup directory creation errors', async () => {
            fs.mkdir.mockRejectedValue(new Error('Permission denied'));
            
            await expect(AutoUpdater.createBackup()).rejects.toThrow('Permission denied');
        });

        test('should create backup directory if it does not exist', async () => {
            fs.access.mockRejectedValueOnce(new Error('ENOENT')); // Backup dir doesn't exist
            fs.access.mockResolvedValueOnce(); // App dir exists
            fs.mkdir.mockResolvedValue();
            jest.spyOn(AutoUpdater, 'copyDirectory').mockResolvedValue();
            
            await AutoUpdater.createBackup();
            
            expect(fs.mkdir).toHaveBeenCalledTimes(1); // Only creates specific backup dir
        });
    });

    describe('cleanup', () => {
        test('should cleanup temp files successfully', async () => {
            await AutoUpdater.cleanup('/tmp/test-download.zip');
            
            expect(fs.unlink).toHaveBeenCalledWith('/tmp/test-download.zip');
        });

        test('should handle cleanup errors gracefully', async () => {
            fs.unlink.mockRejectedValue(new Error('File not found'));
            
            // Should not throw - cleanup is best effort
            await expect(AutoUpdater.cleanup('/tmp/nonexistent.zip')).resolves.toBeUndefined();
        });

        test('should cleanup temp directory', async () => {
            // Mock temp directory exists and cleanup
            fs.access.mockResolvedValueOnce(); // temp dir exists
            fs.rmdir.mockResolvedValue();
            
            await AutoUpdater.cleanup();
            
            // Should attempt to clean temp directory
            expect(fs.access).toHaveBeenCalled();
        });
    });

    describe('listBackups', () => {
        test('should list backups successfully', async () => {
            const mockFiles = [
                'backup-2023-01-01T10-00-00-000Z',
                'backup-2023-01-02T10-00-00-000Z'
            ];
            
            fs.readdir.mockResolvedValue(mockFiles);
            fs.readFile.mockResolvedValue(JSON.stringify({
                version: '1.0.0',
                timestamp: '2023-01-01T10:00:00.000Z'
            }));
            fs.stat.mockResolvedValue({
                isDirectory: () => true,
                birthtime: new Date('2023-01-01'),
                size: 1024
            });
            
            const backups = await AutoUpdater.listBackups();
            
            expect(backups).toHaveLength(2);
            expect(backups[0]).toHaveProperty('name');
            expect(backups[0]).toHaveProperty('path');
            expect(backups[0]).toHaveProperty('version');
            expect(backups[0]).toHaveProperty('timestamp');
        });

        test('should handle empty backup directory', async () => {
            fs.readdir.mockResolvedValue([]);
            
            const backups = await AutoUpdater.listBackups();
            
            expect(backups).toEqual([]);
        });

        test('should handle backup directory not existing', async () => {
            fs.readdir.mockRejectedValue(new Error('ENOENT'));
            
            const backups = await AutoUpdater.listBackups();
            
            expect(backups).toEqual([]);
        });
    });

    describe('cleanupOldBackups', () => {
        test('should cleanup old backups', async () => {
            const mockBackups = Array.from({ length: 8 }, (_, i) => ({
                name: `backup-${i}`,
                path: `/backups/backup-${i}`,
                date: new Date(2023, 0, i + 1)
            }));
            
            jest.spyOn(AutoUpdater, 'listBackups').mockResolvedValue(mockBackups);
            jest.spyOn(fs, 'rmdir').mockImplementation(() => Promise.resolve());
            
            await AutoUpdater.cleanupOldBackups(5);
            
            expect(fs.rmdir).toHaveBeenCalledTimes(3); // Remove 3 oldest backups
        });

        test('should handle rmdir errors gracefully', async () => {
            const mockBackups = [
                { name: 'backup-1', path: '/backups/backup-1', timestamp: '2023-01-01T00:00:00.000Z' }
            ];
            
            jest.spyOn(AutoUpdater, 'listBackups').mockResolvedValue(mockBackups);
            fs.rmdir.mockRejectedValue(new Error('Directory not empty'));
            
            // Should not throw - cleanup is best effort and returns result
            const result = await AutoUpdater.cleanupOldBackups(0);
            expect(result).toHaveProperty('deleted');
            expect(result).toHaveProperty('kept');
        });
    });
});
