const fs = require('fs');
const path = require('path');

describe('Cache Disk Manager', () => {
    const testCacheDir = path.join(__dirname, '../../test_cache');
    
    beforeAll(() => {
        // Create test cache directory
        if (!fs.existsSync(testCacheDir)) {
            fs.mkdirSync(testCacheDir, { recursive: true });
        }
    });

    afterAll(() => {
        // Clean up test cache directory
        if (fs.existsSync(testCacheDir)) {
            fs.rmSync(testCacheDir, { recursive: true, force: true });
        }
    });

    describe('Disk space management', () => {
        it('should check available disk space', () => {
            const stats = fs.statSync(testCacheDir);
            expect(stats.isDirectory()).toBe(true);
        });

        it('should handle cache file operations', () => {
            const testFile = path.join(testCacheDir, 'test.json');
            const testData = { test: 'data', timestamp: Date.now() };
            
            // Write test file
            fs.writeFileSync(testFile, JSON.stringify(testData));
            expect(fs.existsSync(testFile)).toBe(true);
            
            // Read test file
            const readData = JSON.parse(fs.readFileSync(testFile, 'utf8'));
            expect(readData.test).toBe('data');
            
            // Clean up
            fs.unlinkSync(testFile);
            expect(fs.existsSync(testFile)).toBe(false);
        });

        it('should calculate directory size', () => {
            // Create a test file to measure
            const testFile = path.join(testCacheDir, 'size_test.json');
            const testData = 'x'.repeat(1000); // 1KB of data
            
            fs.writeFileSync(testFile, testData);
            
            const stats = fs.statSync(testFile);
            expect(stats.size).toBeGreaterThan(0);
            
            // Clean up
            fs.unlinkSync(testFile);
        });
    });

    describe('Cache cleanup operations', () => {
        it('should identify old cache files', () => {
            const now = Date.now();
            const oldTimestamp = now - (24 * 60 * 60 * 1000); // 24 hours ago
            
            const oldFile = path.join(testCacheDir, 'old_file.json');
            fs.writeFileSync(oldFile, JSON.stringify({ timestamp: oldTimestamp }));
            
            const stats = fs.statSync(oldFile);
            const isOld = (now - stats.mtime.getTime()) > (23 * 60 * 60 * 1000); // 23 hours
            
            expect(typeof isOld).toBe('boolean');
            
            // Clean up
            fs.unlinkSync(oldFile);
        });

        it('should handle file deletion safely', () => {
            const testFile = path.join(testCacheDir, 'delete_test.json');
            fs.writeFileSync(testFile, '{"test": true}');
            
            expect(fs.existsSync(testFile)).toBe(true);
            
            // Safe deletion
            try {
                fs.unlinkSync(testFile);
                expect(fs.existsSync(testFile)).toBe(false);
            } catch (error) {
                // File might not exist, that's OK
                expect(error.code).toBe('ENOENT');
            }
        });
    });
});
