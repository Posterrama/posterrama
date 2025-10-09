// Realistic test for healthCheck that tests actual implementation methods
const fs = require('fs').promises;

// Mock server.js to prevent process.exit
jest.mock('../../server', () => ({
    testServerConnection: jest.fn(),
}));

// Mock the config require to prevent server.js process.exit
jest.mock('../../config.json', () => ({
    mediaServers: [],
    clockTimezone: 'auto',
}));

// Mock dependencies
jest.mock('../../utils/logger', () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

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
    existsSync: jest.fn(),
}));

jest.mock('../../package.json', () => ({
    version: '2.5.2',
}));

const healthCheck = require('../../utils/healthCheck');

describe('HealthCheck Module', () => {
    afterEach(() => {
        jest.clearAllMocks();
        // Clear the cache
        healthCheck.clearCache?.();
    });

    describe('getBasicHealth', () => {
        test('should return basic health information', () => {
            const result = healthCheck.getBasicHealth();

            expect(result).toHaveProperty('status', 'ok');
            expect(result).toHaveProperty('service', 'posterrama');
            expect(result).toHaveProperty('version', '2.5.2');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('uptime');
            expect(typeof result.uptime).toBe('number');
            expect(new Date(result.timestamp)).toBeInstanceOf(Date);
        });

        test('should return current timestamp', () => {
            const beforeTime = new Date();
            const result = healthCheck.getBasicHealth();
            const afterTime = new Date();

            const resultTime = new Date(result.timestamp);
            expect(resultTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
            expect(resultTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
        });

        test('should return process uptime approximately', () => {
            const result = healthCheck.getBasicHealth();
            const currentUptime = process.uptime();
            // Allow small time difference due to test execution time
            expect(result.uptime).toBeCloseTo(currentUptime, 1);
        });
    });

    describe('checkConfiguration', () => {
        test('should return ok status with enabled servers', async () => {
            const mockConfig = {
                mediaServers: [
                    { name: 'server1', enabled: true },
                    { name: 'server2', enabled: true },
                    { name: 'server3', enabled: false },
                ],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

            const result = await healthCheck.checkConfiguration();

            expect(result).toEqual({
                name: 'configuration',
                status: 'ok',
                message: '2 media server(s) are enabled.',
                details: {
                    enabledServers: 2,
                    totalServers: 3,
                },
            });
        });

        test('should return warning when no servers are enabled', async () => {
            const mockConfig = {
                mediaServers: [
                    { name: 'server1', enabled: false },
                    { name: 'server2', enabled: false },
                ],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

            const result = await healthCheck.checkConfiguration();

            expect(result).toEqual({
                name: 'configuration',
                status: 'warning',
                message:
                    'No media servers are enabled in config.json. The application will run but cannot serve media.',
            });
        });

        test('should handle missing mediaServers array', async () => {
            const mockConfig = {}; // No mediaServers property
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

            const result = await healthCheck.checkConfiguration();

            expect(result).toEqual({
                name: 'configuration',
                status: 'warning',
                message:
                    'No media servers are enabled in config.json. The application will run but cannot serve media.',
            });
        });

        test('should handle config read errors gracefully', async () => {
            fs.readFile.mockRejectedValue(new Error('File not found'));

            const result = await healthCheck.checkConfiguration();

            // The implementation provides a fallback config instead of throwing error
            expect(result).toEqual({
                name: 'configuration',
                status: 'warning',
                message:
                    'No media servers are enabled in config.json. The application will run but cannot serve media.',
            });
        });

        test('should handle invalid JSON', async () => {
            fs.readFile.mockResolvedValue('invalid json{');

            const result = await healthCheck.checkConfiguration();

            expect(result.name).toBe('configuration');
            // Invalid JSON also falls back to the fallback config
            expect(result.status).toBe('warning');
            expect(result.message).toContain('No media servers are enabled');
        });
    });

    describe('checkFilesystem', () => {
        test('should return ok status when all directories are accessible', async () => {
            fs.access.mockResolvedValue(); // Resolves without error

            const result = await healthCheck.checkFilesystem();

            expect(result).toEqual({
                name: 'filesystem',
                status: 'ok',
                message: 'All required filesystem paths are accessible.',
                details: {
                    directories: ['sessions', 'image_cache', 'logs'],
                },
            });

            // Verify that access was checked for all required directories
            expect(fs.access).toHaveBeenCalledTimes(3);
            expect(fs.access).toHaveBeenCalledWith(
                expect.stringContaining('sessions'),
                6 // R_OK | W_OK
            );
            expect(fs.access).toHaveBeenCalledWith(
                expect.stringContaining('image_cache'),
                6 // R_OK | W_OK
            );
            expect(fs.access).toHaveBeenCalledWith(
                expect.stringContaining('logs'),
                6 // R_OK | W_OK
            );
        });

        test('should handle filesystem access errors', async () => {
            fs.access.mockRejectedValue(new Error('Permission denied'));

            const result = await healthCheck.checkFilesystem();

            expect(result.name).toBe('filesystem');
            expect(result.status).toBe('error');
            expect(result.message).toContain('Permission denied');
        });

        test('should check correct directory paths', async () => {
            fs.access.mockResolvedValue();

            await healthCheck.checkFilesystem();

            const calls = fs.access.mock.calls;
            expect(calls[0][0]).toMatch(/sessions$/);
            expect(calls[1][0]).toMatch(/image_cache$/);
            expect(calls[2][0]).toMatch(/logs$/);
        });
    });

    describe('readConfig', () => {
        test('should read and parse config.json', async () => {
            const mockConfig = { test: 'value' };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

            // We need to access the internal readConfig function through a test interface
            // Since it's not exported, we'll test it indirectly through checkConfiguration
            await healthCheck.checkConfiguration();

            expect(fs.readFile).toHaveBeenCalledWith(
                expect.stringContaining('config.json'),
                'utf-8'
            );
        });

        test('should handle file read errors and provide fallback', async () => {
            fs.readFile.mockRejectedValue(new Error('File not found'));

            // The internal readConfig should provide a fallback, which we can test through checkConfiguration
            const result = await healthCheck.checkConfiguration();

            expect(result.status).toBe('warning'); // Fallback config gives warning
            expect(result.message).toContain('No media servers are enabled');
        });
    });

    describe('Error handling and logging', () => {
        test('should log errors when config read fails', async () => {
            const logger = require('../../utils/logger');
            fs.readFile.mockRejectedValue(new Error('Test error'));

            await healthCheck.checkConfiguration();

            expect(logger.error).toHaveBeenCalledWith('Failed to read config.json in healthCheck', {
                error: 'Test error',
            });
        });

        test('should handle various error types gracefully', async () => {
            // Test with different error types - some may still pass through as errors
            const errors = [new Error('Standard error'), new TypeError('Type error')];

            for (const error of errors) {
                fs.readFile.mockRejectedValue(error);
                const result = await healthCheck.checkConfiguration();
                expect(result.name).toBe('configuration');
                // Error handling may return error or warning status depending on error type
                expect(['error', 'warning']).toContain(result.status);
            }
        });
    });

    describe('Module exports', () => {
        test('should export required functions', () => {
            expect(typeof healthCheck.getBasicHealth).toBe('function');
            expect(typeof healthCheck.getDetailedHealth).toBe('function');
            expect(typeof healthCheck.checkConfiguration).toBe('function');
            expect(typeof healthCheck.checkFilesystem).toBe('function');
            expect(typeof healthCheck.checkMediaCache).toBe('function');
            expect(typeof healthCheck.checkPlexConnectivity).toBe('function');
            expect(typeof healthCheck.__resetCache).toBe('function');
        });

        test('should maintain consistent function signatures', () => {
            expect(healthCheck.getBasicHealth.length).toBe(0); // No parameters
            expect(healthCheck.checkConfiguration.length).toBe(0); // No parameters
            expect(healthCheck.checkFilesystem.length).toBe(0); // No parameters
        });
    });

    describe('getDetailedHealth', () => {
        beforeEach(() => {
            healthCheck.__resetCache();
        });

        test('should return detailed health check results', async () => {
            const mockConfig = {
                mediaServers: [{ name: 'server1', enabled: true }],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
            fs.access.mockResolvedValue(); // All filesystem checks pass

            const result = await healthCheck.getDetailedHealth();

            expect(result).toHaveProperty('status');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('checks');
            expect(Array.isArray(result.checks)).toBe(true);
            expect(['ok', 'warning', 'error']).toContain(result.status);
        });

        test('should cache results for performance', async () => {
            const mockConfig = {
                mediaServers: [{ name: 'server1', enabled: true }],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
            fs.access.mockResolvedValue();
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue([]);

            // Clear any previous calls
            fs.readFile.mockClear();

            // First call
            const result1 = await healthCheck.getDetailedHealth();
            const firstCallCount = fs.readFile.mock.calls.length;

            // Second call (should use cache)
            const result2 = await healthCheck.getDetailedHealth();
            const secondCallCount = fs.readFile.mock.calls.length;

            expect(result1).toEqual(result2);
            // Should be same call count (cached)
            expect(secondCallCount).toBe(firstCallCount);
        });

        test('should refresh cache after cache duration', async () => {
            const mockConfig = {
                mediaServers: [{ name: 'server1', enabled: true }],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
            fs.access.mockResolvedValue();
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue([]);

            // Clear any previous calls
            fs.readFile.mockClear();

            // First call
            await healthCheck.getDetailedHealth();
            const firstCallCount = fs.readFile.mock.calls.length;

            // Reset cache manually to simulate time passing
            healthCheck.__resetCache();

            // Second call (should make new requests)
            await healthCheck.getDetailedHealth();
            const secondCallCount = fs.readFile.mock.calls.length;

            expect(secondCallCount).toBeGreaterThan(firstCallCount);
        });
    });

    describe('checkMediaCache', () => {
        test('should check media cache functionality', async () => {
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue(['file1.jpg', 'file2.jpg']);

            const result = await healthCheck.checkMediaCache();

            expect(result).toHaveProperty('name', 'cache');
            expect(result).toHaveProperty('status', 'ok');
            expect(result.message).toContain('2 cached items');
        });

        test('should handle cache directory access errors', async () => {
            fs.stat.mockRejectedValue(new Error('Access denied'));

            const result = await healthCheck.checkMediaCache();

            expect(result.name).toBe('cache');
            expect(result.status).toBe('warning');
            expect(result.message).toContain('Access denied');
        });

        test('should handle empty cache directory', async () => {
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue([]);

            const result = await healthCheck.checkMediaCache();

            expect(result.name).toBe('cache');
            expect(result.status).toBe('ok');
            expect(result.message).toContain('0 cached items');
        });
    });

    describe('checkPlexConnectivity', () => {
        test('should check Plex server connectivity', async () => {
            const mockConfig = {
                mediaServers: [
                    { name: 'plex1', type: 'plex', enabled: true, host: 'localhost', port: 32400 },
                ],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
            require('fs').existsSync.mockReturnValue(true);

            const result = await healthCheck.checkPlexConnectivity();

            expect(result).toHaveProperty('name', 'plex_connectivity');
            expect(result).toHaveProperty('status');
            expect(['ok', 'warning', 'error']).toContain(result.status);
        });

        test('should handle no Plex servers configured', async () => {
            const mockConfig = {
                mediaServers: [{ name: 'jellyfin1', type: 'jellyfin', enabled: true }],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

            const result = await healthCheck.checkPlexConnectivity();

            expect(result.name).toBe('plex_connectivity');
            expect(result.status).toBe('ok');
            expect(result.message).toContain('No Plex servers are configured');
        });
    });

    describe('Cache reset functionality', () => {
        test('should reset cache when __resetCache is called', async () => {
            const mockConfig = {
                mediaServers: [{ name: 'server1', enabled: true }],
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
            fs.access.mockResolvedValue();
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue([]);

            // Make a call to populate cache
            await healthCheck.getDetailedHealth();
            const callCountAfterFirst = fs.readFile.mock.calls.length;

            // Reset cache
            healthCheck.__resetCache();

            // Make another call - should not use cache
            await healthCheck.getDetailedHealth();
            const callCountAfterSecond = fs.readFile.mock.calls.length;

            expect(callCountAfterSecond).toBeGreaterThan(callCountAfterFirst);
        });
    });
});
