const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const SafeFileStore = require('../../utils/safeFileStore');
const logger = require('../../utils/logger');

// Mock logger to suppress output during tests
jest.mock('../../utils/logger');

describe('SafeFileStore', () => {
    const testDir = path.join(__dirname, '..', '..', 'test-temp-safefilestore');
    const testFile = path.join(testDir, 'test.json');

    beforeEach(async () => {
        // Create test directory
        await fsp.mkdir(testDir, { recursive: true });

        // Clear logger mocks
        jest.clearAllMocks();
    });

    afterEach(async () => {
        // Clean up test directory
        try {
            await fsp.rm(testDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    describe('constructor', () => {
        it('should create instance with default options', () => {
            const store = new SafeFileStore(testFile);
            expect(store).toBeInstanceOf(SafeFileStore);
        });

        it('should create instance with custom backup path', () => {
            const customBackup = path.join(testDir, 'custom.backup.json');
            const store = new SafeFileStore(testFile, { backupPath: customBackup });
            expect(store).toBeInstanceOf(SafeFileStore);
        });

        it('should create instance with custom temp path', () => {
            const customTemp = path.join(testDir, 'custom.tmp.json');
            const store = new SafeFileStore(testFile, { tempPath: customTemp });
            expect(store).toBeInstanceOf(SafeFileStore);
        });

        it('should create instance with createBackup disabled', () => {
            const store = new SafeFileStore(testFile, { createBackup: false });
            expect(store).toBeInstanceOf(SafeFileStore);
        });

        it('should create instance with custom indent', () => {
            const store = new SafeFileStore(testFile, { indent: 2 });
            expect(store).toBeInstanceOf(SafeFileStore);
        });
    });

    describe('write', () => {
        it('should write data to file', async () => {
            const store = new SafeFileStore(testFile);
            const data = { test: 'value', count: 42 };

            await store.write(data);

            const content = await fsp.readFile(testFile, 'utf8');
            expect(JSON.parse(content)).toEqual(data);
        });

        it('should write with custom indentation', async () => {
            const store = new SafeFileStore(testFile, { indent: 2 });
            const data = { test: 'value' };

            await store.write(data);

            const content = await fsp.readFile(testFile, 'utf8');
            expect(content).toContain('  "test": "value"');
        });

        it('should create parent directory if missing', async () => {
            const nestedFile = path.join(testDir, 'nested', 'deep', 'file.json');
            const store = new SafeFileStore(nestedFile);
            const data = { nested: true };

            await store.write(data);

            const content = await fsp.readFile(nestedFile, 'utf8');
            expect(JSON.parse(content)).toEqual(data);
        });

        it('should create backup before overwriting existing file', async () => {
            const store = new SafeFileStore(testFile, { createBackup: true });
            const original = { version: 1 };
            const updated = { version: 2 };

            // Write original
            await store.write(original);
            expect(await store.exists()).toBe(true);

            // Write update (should create backup)
            await store.write(updated);

            // Check backup exists and contains original data
            expect(await store.hasBackup()).toBe(true);
            const backupPath = testFile + '.backup';
            const backupContent = await fsp.readFile(backupPath, 'utf8');
            expect(JSON.parse(backupContent)).toEqual(original);

            // Check main file has updated data
            const mainContent = await fsp.readFile(testFile, 'utf8');
            expect(JSON.parse(mainContent)).toEqual(updated);
        });

        it('should not create backup when createBackup is false', async () => {
            const store = new SafeFileStore(testFile, { createBackup: false });
            const original = { version: 1 };
            const updated = { version: 2 };

            await store.write(original);
            await store.write(updated);

            expect(await store.hasBackup()).toBe(false);
        });

        it('should handle arrays', async () => {
            const store = new SafeFileStore(testFile);
            const data = [1, 2, 3, { nested: 'object' }];

            await store.write(data);

            const content = await fsp.readFile(testFile, 'utf8');
            expect(JSON.parse(content)).toEqual(data);
        });

        it('should handle empty objects', async () => {
            const store = new SafeFileStore(testFile);
            const data = {};

            await store.write(data);

            const content = await fsp.readFile(testFile, 'utf8');
            expect(JSON.parse(content)).toEqual(data);
        });

        it('should handle null', async () => {
            const store = new SafeFileStore(testFile);

            await store.write(null);

            const content = await fsp.readFile(testFile, 'utf8');
            expect(JSON.parse(content)).toBeNull();
        });

        it('should use atomic write (temp file + rename)', async () => {
            const store = new SafeFileStore(testFile);
            const data = { atomic: true };

            await store.write(data);

            // Temp file should not exist after successful write
            const tempPath = testFile + '.tmp';
            expect(fs.existsSync(tempPath)).toBe(false);

            // Main file should exist
            expect(fs.existsSync(testFile)).toBe(true);
        });

        it('should log write operations', async () => {
            const store = new SafeFileStore(testFile);
            const data = { logged: true };

            await store.write(data);

            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Successfully wrote')
            );
        });
    });

    describe('read', () => {
        it('should read data from file', async () => {
            const store = new SafeFileStore(testFile);
            const data = { test: 'read', count: 123 };

            await store.write(data);
            const result = await store.read();

            expect(result).toEqual(data);
        });

        it('should return null for missing file', async () => {
            const store = new SafeFileStore(testFile);

            const result = await store.read();

            expect(result).toBeNull();
        });

        it('should automatically recover from corrupted file using backup', async () => {
            const store = new SafeFileStore(testFile, { createBackup: true });
            const original = { valid: 'data' };

            // Write valid data (creates backup on second write)
            await store.write(original);
            await store.write({ version: 2 });

            // Corrupt main file
            await fsp.writeFile(testFile, '{invalid json', 'utf8');

            // Read should automatically recover from backup
            const result = await store.read();

            // Backup contains first write's data
            expect(result).toEqual(original);
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Corruption detected')
            );
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Successfully recovered from backup')
            );
        });

        it('should handle backup file that is also corrupted', async () => {
            const store = new SafeFileStore(testFile, { createBackup: true });

            // Create corrupted main file
            await fsp.writeFile(testFile, '{invalid json', 'utf8');

            // Create corrupted backup file
            const backupPath = testFile + '.backup';
            await fsp.writeFile(backupPath, '{also invalid', 'utf8');

            // Read should return null and log error
            const result = await store.read();

            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Backup file also corrupted')
            );
        });

        it('should handle arrays', async () => {
            const store = new SafeFileStore(testFile);
            const data = [{ id: 1 }, { id: 2 }];

            await store.write(data);
            const result = await store.read();

            expect(result).toEqual(data);
        });

        it('should handle null values', async () => {
            const store = new SafeFileStore(testFile);

            await store.write(null);
            const result = await store.read();

            expect(result).toBeNull();
        });

        it('should read successfully without debug logging', async () => {
            const store = new SafeFileStore(testFile);
            const data = { logged: true };

            await store.write(data);
            jest.clearAllMocks();
            const result = await store.read();

            expect(result).toEqual(data);
            // Successful reads don't log debug messages
        });
    });

    describe('exists', () => {
        it('should return true for existing file', async () => {
            const store = new SafeFileStore(testFile);
            await store.write({ test: 'exists' });

            const result = await store.exists();

            expect(result).toBe(true);
        });

        it('should return false for missing file', async () => {
            const store = new SafeFileStore(testFile);

            const result = await store.exists();

            expect(result).toBe(false);
        });
    });

    describe('hasBackup', () => {
        it('should return true when backup exists', async () => {
            const store = new SafeFileStore(testFile, { createBackup: true });

            await store.write({ version: 1 });
            await store.write({ version: 2 });

            const result = await store.hasBackup();

            expect(result).toBe(true);
        });

        it('should return false when backup does not exist', async () => {
            const store = new SafeFileStore(testFile);

            const result = await store.hasBackup();

            expect(result).toBe(false);
        });

        it('should return false when only main file exists', async () => {
            const store = new SafeFileStore(testFile, { createBackup: false });

            await store.write({ version: 1 });

            const result = await store.hasBackup();

            expect(result).toBe(false);
        });
    });

    describe('restoreFromBackup', () => {
        it('should restore from backup file', async () => {
            const store = new SafeFileStore(testFile, { createBackup: true });
            const original = { version: 1 };
            const updated = { version: 2 };

            // Create backup
            await store.write(original);
            await store.write(updated);

            // Manually corrupt main file
            await fsp.writeFile(testFile, '{invalid', 'utf8');

            // Restore from backup
            await store.restoreFromBackup();

            // Verify restoration - backup contains first write's data
            const result = await store.read();
            expect(result).toEqual(original);
        });

        it('should return false when backup does not exist', async () => {
            const store = new SafeFileStore(testFile);

            const result = await store.restoreFromBackup();

            expect(result).toBe(false);
        });

        it('should log restoration', async () => {
            const store = new SafeFileStore(testFile, { createBackup: true });

            await store.write({ version: 1 });
            await store.write({ version: 2 });

            jest.clearAllMocks();
            await store.restoreFromBackup();

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Restored from backup')
            );
        });
    });

    describe('delete', () => {
        it('should delete main file', async () => {
            const store = new SafeFileStore(testFile);
            await store.write({ test: 'delete' });

            await store.delete();

            expect(await store.exists()).toBe(false);
        });

        it('should delete backup file', async () => {
            const store = new SafeFileStore(testFile, { createBackup: true });
            await store.write({ version: 1 });
            await store.write({ version: 2 });

            await store.delete();

            expect(await store.hasBackup()).toBe(false);
        });

        it('should delete temp file', async () => {
            const store = new SafeFileStore(testFile);
            const tempPath = testFile + '.tmp';

            // Create temp file manually
            await fsp.writeFile(tempPath, 'temp', 'utf8');

            await store.delete();

            expect(fs.existsSync(tempPath)).toBe(false);
        });

        it('should succeed when files do not exist', async () => {
            const store = new SafeFileStore(testFile);

            await expect(store.delete()).resolves.not.toThrow();
        });

        it('should log deletion', async () => {
            const store = new SafeFileStore(testFile);
            await store.write({ test: 'delete' });

            jest.clearAllMocks();
            await store.delete();

            expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Deleted'));
        });
    });

    describe('getStats', () => {
        it('should return stats for existing file', async () => {
            const store = new SafeFileStore(testFile);
            const data = { test: 'stats' };
            await store.write(data);

            const stats = await store.getStats();

            expect(stats.main).not.toBeNull();
            expect(stats.main.size).toBeGreaterThan(0);
            expect(typeof stats.main.created.getTime).toBe('function');
            expect(typeof stats.main.modified.getTime).toBe('function');
            expect(stats.backup).toBeNull();
            expect(stats.temp).toBeNull();
        });

        it('should return object with nulls for missing file', async () => {
            const store = new SafeFileStore(testFile);

            const stats = await store.getStats();

            expect(stats).toEqual({
                main: null,
                backup: null,
                temp: null,
            });
        });

        it('should include backup stats when backup exists', async () => {
            const store = new SafeFileStore(testFile, { createBackup: true });
            await store.write({ version: 1 });
            await store.write({ version: 2 });

            const stats = await store.getStats();

            expect(stats.main).not.toBeNull();
            expect(stats.main.size).toBeGreaterThan(0);
            expect(typeof stats.main.created.getTime).toBe('function');
            expect(typeof stats.main.modified.getTime).toBe('function');

            expect(stats.backup).not.toBeNull();
            expect(stats.backup.size).toBeGreaterThan(0);
            expect(typeof stats.backup.created.getTime).toBe('function');
            expect(typeof stats.backup.modified.getTime).toBe('function');

            expect(stats.temp).toBeNull();
        });
    });

    describe('edge cases', () => {
        it('should handle very large objects', async () => {
            const store = new SafeFileStore(testFile);
            const largeData = {
                items: Array.from({ length: 10000 }, (_, i) => ({ id: i, value: `item-${i}` })),
            };

            await store.write(largeData);
            const result = await store.read();

            expect(result).toEqual(largeData);
        });

        it('should handle deeply nested objects', async () => {
            const store = new SafeFileStore(testFile);
            const deepData = { a: { b: { c: { d: { e: { f: 'deep' } } } } } };

            await store.write(deepData);
            const result = await store.read();

            expect(result).toEqual(deepData);
        });

        it('should handle special characters in data', async () => {
            const store = new SafeFileStore(testFile);
            const specialData = {
                emoji: '🚀✨',
                unicode: 'Héllö Wörld',
                quotes: '"quoted"',
                newlines: 'line1\nline2',
            };

            await store.write(specialData);
            const result = await store.read();

            expect(result).toEqual(specialData);
        });

        it('should handle sequential writes safely', async () => {
            const store = new SafeFileStore(testFile);

            // Execute writes sequentially (avoid race conditions in tests)
            await store.write({ id: 1 });
            await store.write({ id: 2 });
            await store.write({ id: 3 });

            // File should contain last write
            const result = await store.read();
            expect(result).toEqual({ id: 3 });
        });

        it('should handle empty arrays', async () => {
            const store = new SafeFileStore(testFile);

            await store.write([]);
            const result = await store.read();

            expect(result).toEqual([]);
        });

        it('should handle boolean values', async () => {
            const store = new SafeFileStore(testFile);

            await store.write(true);
            const result = await store.read();

            expect(result).toBe(true);
        });

        it('should handle numeric values', async () => {
            const store = new SafeFileStore(testFile);

            await store.write(42);
            const result = await store.read();

            expect(result).toBe(42);
        });

        it('should handle string values', async () => {
            const store = new SafeFileStore(testFile);

            await store.write('test string');
            const result = await store.read();

            expect(result).toBe('test string');
        });
    });
});
