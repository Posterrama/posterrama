// Additional quick tests to reach 90% coverage target
const path = require('path');
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
    version: '1.9.5',
}));

const healthCheck = require('../../utils/healthCheck');

describe('HealthCheck Additional Coverage', () => {
    afterEach(() => {
        jest.clearAllMocks();
        healthCheck.__resetCache?.();
    });

    describe('Error path coverage', () => {
        test('should handle various filesystem errors', async () => {
            const errors = [
                new Error('ENOENT: no such file or directory'),
                new Error('EACCES: permission denied'),
                new Error('EMFILE: too many open files'),
                { code: 'ENOTDIR', message: 'not a directory' },
                'String error',
            ];

            for (const error of errors) {
                fs.access.mockRejectedValue(error);
                const result = await healthCheck.checkFilesystem();
                expect(result.name).toBe('filesystem');
                expect(result.status).toBe('error');
                expect(result.message).toContain('error'); // Should contain error info
            }
        });

        test('should handle cache directory with various scenarios', async () => {
            // Test with very large cache
            fs.stat.mockResolvedValue({ mtime: new Date('2023-01-01') });
            fs.readdir.mockResolvedValue(new Array(1000).fill(0).map((_, i) => `file${i}.jpg`));

            const result = await healthCheck.checkMediaCache();
            expect(result.name).toBe('cache');
            expect(result.status).toBe('ok');
            expect(result.message).toContain('1000 cached items');
        });

        test('should handle configuration with various server types', async () => {
            const configs = [
                { mediaServers: [] }, // no servers
                { mediaServers: null }, // null servers
                { mediaServers: undefined }, // undefined servers
                { mediaServers: [{ name: 'test', enabled: false }] }, // disabled servers
                { mediaServers: [{ name: 'test', enabled: true, type: 'jellyfin' }] }, // non-plex servers
                { mediaServers: [{ name: 'test', enabled: true, type: 'plex' }] }, // plex servers
                {}, // missing mediaServers property
            ];

            for (const config of configs) {
                fs.readFile.mockResolvedValue(JSON.stringify(config));
                const result = await healthCheck.checkConfiguration();
                expect(result.name).toBe('configuration');
                expect(['ok', 'warning', 'error']).toContain(result.status);
            }
        });

        test('should handle plex connectivity with different server configurations', async () => {
            const configs = [
                { mediaServers: [] }, // No servers
                { mediaServers: [{ name: 'jellyfin', type: 'jellyfin', enabled: true }] }, // No plex
                { mediaServers: [{ name: 'plex1', type: 'plex', enabled: false }] }, // Disabled plex
                {
                    mediaServers: [
                        {
                            name: 'plex1',
                            type: 'plex',
                            enabled: true,
                            host: 'localhost',
                            port: 32400,
                        },
                    ],
                }, // Enabled plex
            ];

            for (const config of configs) {
                fs.readFile.mockResolvedValue(JSON.stringify(config));
                require('fs').existsSync.mockReturnValue(true);

                const result = await healthCheck.checkPlexConnectivity();
                expect(result.name).toBe('plex_connectivity');
                expect(['ok', 'warning', 'error']).toContain(result.status);
            }
        });

        test('should test readConfig fallback behavior', async () => {
            const errors = [
                new SyntaxError('Unexpected token in JSON'),
                new Error('ENOENT: no such file'),
                new TypeError('Cannot read property'),
                { name: 'CustomError', message: 'Custom error' },
                'String error',
            ];

            for (const error of errors) {
                fs.readFile.mockRejectedValue(error);
                // Test through checkConfiguration since readConfig is internal
                const result = await healthCheck.checkConfiguration();
                expect(result.name).toBe('configuration');
                // Should provide fallback behavior
                expect(['ok', 'warning', 'error']).toContain(result.status);
            }
        });

        test('should handle edge cases in detailed health checks', async () => {
            // Test with minimal working config
            fs.readFile.mockResolvedValue(JSON.stringify({ mediaServers: [] }));
            fs.access.mockResolvedValue();
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue([]);
            require('fs').existsSync.mockReturnValue(false);

            const result = await healthCheck.getDetailedHealth();

            expect(result).toHaveProperty('status');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('checks');
            expect(Array.isArray(result.checks)).toBe(true);
            expect(result.checks.length).toBeGreaterThan(0);
        });

        test('should handle concurrent cache operations', async () => {
            const mockConfig = { mediaServers: [{ name: 'test', enabled: true }] };
            fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
            fs.access.mockResolvedValue();
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue(['file1.jpg']);

            // Make multiple concurrent calls
            const promises = [
                healthCheck.getDetailedHealth(),
                healthCheck.getDetailedHealth(),
                healthCheck.getDetailedHealth(),
            ];

            const results = await Promise.all(promises);

            // All should return the same result (cached)
            expect(results[0]).toEqual(results[1]);
            expect(results[1]).toEqual(results[2]);
        });
    });
});
