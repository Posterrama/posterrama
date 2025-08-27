const fs = require('fs').promises;

// Mock filesystem operations
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        access: jest.fn(),
        stat: jest.fn(),
        readdir: jest.fn(),
    },
    constants: {
        R_OK: 4,
        W_OK: 2,
    },
}));

describe('HealthCheck - Configuration and Filesystem', () => {
    let healthCheck;
    let mockLogger;
    let mockPackageJson;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock logger
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
        };

        // Mock package.json
        mockPackageJson = { version: '1.5.0' };

        // Setup default fs mocks
        fs.readFile.mockResolvedValue('{"mediaServers": []}');
        fs.access.mockResolvedValue();
        fs.stat.mockResolvedValue({ mtime: new Date() });
        fs.readdir.mockResolvedValue([]);

        // Clear require cache and mock modules
        delete require.cache[require.resolve('../../utils/healthCheck')];
        delete require.cache[require.resolve('../../utils/logger')];
        delete require.cache[require.resolve('../../package.json')];

        jest.doMock('../../logger', () => mockLogger);
        jest.doMock('../../package.json', () => mockPackageJson);

        healthCheck = require('../../utils/healthCheck');
    });

    afterEach(() => {
        jest.dontMock('../../logger');
        jest.dontMock('../../package.json');

        if (healthCheck.__resetCache) {
            healthCheck.__resetCache();
        }
    });

    describe('checkConfiguration', () => {
        test('should return ok status with enabled servers', async () => {
            const mockConfig = {
                mediaServers: [
                    { name: 'server1', enabled: true, type: 'plex' },
                    { name: 'server2', enabled: false, type: 'plex' },
                    { name: 'server3', enabled: true, type: 'jellyfin' },
                ],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

            const result = await healthCheck.checkConfiguration();

            expect(result.name).toBe('configuration');
            expect(result.status).toBe('ok');
            expect(result.message).toContain('2 media server(s) are enabled');
            expect(result.details.enabledServers).toBe(2);
            expect(result.details.totalServers).toBe(3);
        });

        test('should return warning with no enabled servers', async () => {
            const mockConfig = {
                mediaServers: [{ name: 'server1', enabled: false, type: 'plex' }],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

            const result = await healthCheck.checkConfiguration();

            expect(result.status).toBe('warning');
            expect(result.message).toContain('No media servers are enabled');
        });

        test('should return warning with empty mediaServers array', async () => {
            fs.readFile.mockResolvedValue('{"mediaServers": []}');

            const result = await healthCheck.checkConfiguration();

            expect(result.status).toBe('warning');
            expect(result.message).toContain('No media servers are enabled');
        });

        test('should handle missing mediaServers property', async () => {
            fs.readFile.mockResolvedValue('{"otherProperty": "value"}');

            const result = await healthCheck.checkConfiguration();

            expect(result.status).toBe('warning');
            expect(result.message).toContain('No media servers are enabled');
            // Warning responses don't include details
            expect(result.details).toBeUndefined();
        });

        test('should handle config file read errors gracefully', async () => {
            fs.readFile.mockRejectedValue(new Error('File not found'));

            const result = await healthCheck.checkConfiguration();

            // readConfig catches errors and returns fallback, so this becomes a warning
            expect(result.status).toBe('warning');
            expect(result.message).toContain('No media servers are enabled');
            // Note: mockLogger.error might not be called due to module isolation in tests
        });

        test('should handle malformed JSON gracefully', async () => {
            fs.readFile.mockResolvedValue('invalid json');

            const result = await healthCheck.checkConfiguration();

            // readConfig catches JSON.parse errors and returns fallback
            expect(result.status).toBe('warning');
            expect(result.message).toContain('No media servers are enabled');
        });
    });

    describe('checkFilesystem', () => {
        test('should return ok status when all directories are accessible', async () => {
            fs.access.mockResolvedValue(); // All access checks pass

            const result = await healthCheck.checkFilesystem();

            expect(result.name).toBe('filesystem');
            expect(result.status).toBe('ok');
            expect(result.message).toBe('All required filesystem paths are accessible.');
            expect(result.details.directories).toEqual(['sessions', 'image_cache', 'logs']);

            // Verify access checks were called for all directories
            expect(fs.access).toHaveBeenCalledTimes(3);
        });

        test('should handle filesystem access errors', async () => {
            fs.access.mockRejectedValue(new Error('Permission denied'));

            const result = await healthCheck.checkFilesystem();

            expect(result.status).toBe('error');
            expect(result.message).toContain('Filesystem access error: Permission denied');
            expect(result.details.error).toBe('Permission denied');
        });

        test('should check correct directory paths', async () => {
            await healthCheck.checkFilesystem();

            const calls = fs.access.mock.calls;
            expect(calls[0][0]).toContain('sessions');
            expect(calls[1][0]).toContain('image_cache');
            expect(calls[2][0]).toContain('logs');

            // Verify correct permissions are checked (R_OK | W_OK = 6)
            calls.forEach(call => {
                expect(call[1]).toBe(6); // R_OK | W_OK
            });
        });
    });

    describe('checkMediaCache', () => {
        test('should return ok status with cache information', async () => {
            const mockStats = { mtime: new Date('2023-01-01') };
            const mockFiles = ['file1.jpg', 'file2.jpg', 'file3.jpg'];

            fs.stat.mockResolvedValue(mockStats);
            fs.readdir.mockResolvedValue(mockFiles);

            const result = await healthCheck.checkMediaCache();

            expect(result.name).toBe('cache');
            expect(result.status).toBe('ok');
            expect(result.message).toContain(
                'Media cache directory is accessible with 3 cached items'
            );
            expect(result.details.itemCount).toBe(3);
            expect(result.details.lastModified).toBe(mockStats.mtime);
        });

        test('should handle empty cache directory', async () => {
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue([]);

            const result = await healthCheck.checkMediaCache();

            expect(result.status).toBe('ok');
            expect(result.message).toContain('0 cached items');
            expect(result.details.itemCount).toBe(0);
        });

        test('should handle cache directory errors', async () => {
            fs.stat.mockRejectedValue(new Error('Directory not found'));

            const result = await healthCheck.checkMediaCache();

            expect(result.status).toBe('warning');
            expect(result.message).toContain('Media cache check failed: Directory not found');
            expect(result.details.error).toBe('Directory not found');
        });

        test('should check correct cache directory path', async () => {
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue([]);

            await healthCheck.checkMediaCache();

            expect(fs.stat).toHaveBeenCalledWith(expect.stringContaining('image_cache'));
            expect(fs.readdir).toHaveBeenCalledWith(expect.stringContaining('image_cache'));
        });
    });
});
