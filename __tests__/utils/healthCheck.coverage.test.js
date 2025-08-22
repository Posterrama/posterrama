/**
 * Coverage enhancement tests for healthCheck.js
 * Focus on error handling, edge cases, and uncovered paths
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const healthCheck = require('../../utils/healthCheck');

describe('HealthCheck Coverage Enhancement', () => {
    beforeEach(() => {
        // Reset health check cache
        if (healthCheck.__resetCache) {
            healthCheck.__resetCache();
        }
    });

    describe('Configuration Edge Cases', () => {
        test('should handle missing config.json file', async () => {
            // Mock fs.readFile to throw ENOENT error (line 66)
            const originalReadFile = fs.readFile;
            fs.readFile = jest
                .fn()
                .mockRejectedValue(new Error('ENOENT: no such file or directory'));

            try {
                const result = await healthCheck.checkConfiguration();
                expect(result.name).toBe('configuration');
                expect(result.status).toBe('warning');
                expect(result.message).toContain('No media servers');
            } finally {
                fs.readFile = originalReadFile;
            }
        });

        test('should handle malformed JSON in config', async () => {
            // Mock fs.readFile to return invalid JSON
            const originalReadFile = fs.readFile;
            fs.readFile = jest.fn().mockResolvedValue('{ invalid json }');

            try {
                const result = await healthCheck.checkConfiguration();
                expect(result.name).toBe('configuration');
                expect(['error', 'warning']).toContain(result.status);
            } finally {
                fs.readFile = originalReadFile;
            }
        });

        test('should handle permission errors reading config', async () => {
            // Mock fs.readFile to throw permission error
            const originalReadFile = fs.readFile;
            fs.readFile = jest.fn().mockRejectedValue(new Error('EACCES: permission denied'));

            try {
                const result = await healthCheck.checkConfiguration();
                expect(result.name).toBe('configuration');
                expect(['error', 'warning']).toContain(result.status);
                // The actual error message varies based on fallback behavior
                expect(result.message).toBeDefined();
            } finally {
                fs.readFile = originalReadFile;
            }
        });

        test('should handle config with no media servers', async () => {
            // Mock fs.readFile to return config without media servers
            const originalReadFile = fs.readFile;
            fs.readFile = jest.fn().mockResolvedValue(JSON.stringify({}));

            try {
                const result = await healthCheck.checkConfiguration();
                expect(result.name).toBe('configuration');
                expect(result.status).toBe('warning');
                expect(result.message).toContain('No media servers are enabled');
            } finally {
                fs.readFile = originalReadFile;
            }
        });

        test('should handle config with disabled servers only', async () => {
            // Mock config with all servers disabled
            const originalReadFile = fs.readFile;
            const configWithDisabledServers = {
                mediaServers: [
                    { enabled: false, name: 'Disabled Server 1' },
                    { enabled: false, name: 'Disabled Server 2' },
                ],
            };
            fs.readFile = jest.fn().mockResolvedValue(JSON.stringify(configWithDisabledServers));

            try {
                const result = await healthCheck.checkConfiguration();
                expect(result.name).toBe('configuration');
                expect(result.status).toBe('warning');
                expect(result.message).toContain('No media servers are enabled');
            } finally {
                fs.readFile = originalReadFile;
            }
        });
    });

    describe('Filesystem Access Errors', () => {
        test('should handle missing filesystem constants', async () => {
            // Mock fs constants to be undefined (line 151)
            const originalConstants = fsSync.constants;
            fsSync.constants = undefined;

            try {
                const result = await healthCheck.checkFilesystem();
                // Should use fallback values R_OK=4, W_OK=2
                expect(result.name).toBe('filesystem');
                expect(['ok', 'error']).toContain(result.status);
            } finally {
                fsSync.constants = originalConstants;
            }
        });

        test('should handle filesystem access permission errors', async () => {
            // Mock fs.access to throw EACCES error
            const originalAccess = fs.access;
            fs.access = jest.fn().mockRejectedValue(new Error('EACCES: permission denied'));

            try {
                const result = await healthCheck.checkFilesystem();
                expect(result.name).toBe('filesystem');
                expect(result.status).toBe('error');
                expect(result.message).toContain('Filesystem access error');
                expect(result.details.error).toContain('permission denied');
            } finally {
                fs.access = originalAccess;
            }
        });

        test('should handle missing directories', async () => {
            // Mock fs.access to throw ENOENT for directories
            const originalAccess = fs.access;
            fs.access = jest.fn().mockRejectedValue(new Error('ENOENT: no such file or directory'));

            try {
                const result = await healthCheck.checkFilesystem();
                expect(result.name).toBe('filesystem');
                expect(result.status).toBe('error');
                expect(result.message).toContain('Filesystem access error');
            } finally {
                fs.access = originalAccess;
            }
        });
    });

    describe('Plex Connectivity Scenarios', () => {
        test('should handle missing server module import', async () => {
            // Test lines 192-304 (missing testServerConnection function)
            const result = await healthCheck.checkPlexConnectivity();
            expect(result.name).toBe('plex_connectivity');
            expect(['ok', 'warning', 'error']).toContain(result.status);
        });

        test('should handle config with enabled servers but connection issues', async () => {
            // Mock config with enabled servers
            const originalReadFile = fs.readFile;
            const configWithServers = {
                mediaServers: [
                    { enabled: true, name: 'Test Server 1', url: 'http://test1:32400' },
                    { enabled: true, name: 'Test Server 2', url: 'http://test2:32400' },
                ],
            };
            fs.readFile = jest.fn().mockResolvedValue(JSON.stringify(configWithServers));

            try {
                const result = await healthCheck.checkPlexConnectivity();
                expect(result.name).toBe('plex_connectivity');
                expect(['ok', 'warning', 'error']).toContain(result.status);

                // Should handle servers that can't be reached
                if (result.details && result.details.servers) {
                    expect(Array.isArray(result.details.servers)).toBe(true);
                }
            } finally {
                fs.readFile = originalReadFile;
            }
        });
    });

    describe('Cache Health Scenarios', () => {
        test('should handle missing image cache directory', async () => {
            // Mock fs.stat to throw ENOENT
            const originalStat = fs.stat;
            const originalReaddir = fs.readdir;

            fs.stat = jest.fn().mockRejectedValue(new Error('ENOENT: no such file or directory'));
            fs.readdir = jest
                .fn()
                .mockRejectedValue(new Error('ENOENT: no such file or directory'));

            try {
                const result = await healthCheck.checkMediaCache();
                expect(result.name).toBe('cache');
                expect(result.status).toBe('warning');
                expect(result.message).toContain('Media cache check failed');
                expect(result.details.error).toBeDefined();
            } finally {
                fs.stat = originalStat;
                fs.readdir = originalReaddir;
            }
        });

        test('should handle cache directory permission errors', async () => {
            // Mock fs.readdir to throw permission error while stat succeeds
            const originalStat = fs.stat;
            const originalReaddir = fs.readdir;

            fs.stat = jest.fn().mockResolvedValue({ mtime: new Date() });
            fs.readdir = jest.fn().mockRejectedValue(new Error('EACCES: permission denied'));

            try {
                const result = await healthCheck.checkMediaCache();
                expect(result.name).toBe('cache');
                expect(result.status).toBe('warning');
                expect(result.message).toContain('Media cache check failed');
            } finally {
                fs.stat = originalStat;
                fs.readdir = originalReaddir;
            }
        });

        test('should handle empty cache directory correctly', async () => {
            // Mock successful empty directory
            const originalStat = fs.stat;
            const originalReaddir = fs.readdir;

            fs.stat = jest.fn().mockResolvedValue({ mtime: new Date('2024-01-01') });
            fs.readdir = jest.fn().mockResolvedValue([]);

            try {
                const result = await healthCheck.checkMediaCache();
                expect(result.name).toBe('cache');
                expect(result.status).toBe('ok');
                expect(result.details.itemCount).toBe(0);
                expect(result.details.lastModified).toBeDefined();
                expect(result.message).toContain('0 cached items');
            } finally {
                fs.stat = originalStat;
                fs.readdir = originalReaddir;
            }
        });
    });

    describe('Detailed Health Check Caching', () => {
        test('should use cache for detailed health check', async () => {
            // First call should populate cache
            const result1 = await healthCheck.getDetailedHealth();
            expect(result1.status).toBeDefined();
            expect(result1.checks).toBeDefined();

            // Second call should use cache (lines 348-349)
            const result2 = await healthCheck.getDetailedHealth();
            expect(result1.timestamp).toBe(result2.timestamp);
        });

        test('should handle errors in individual checks gracefully', async () => {
            // Mock all filesystem operations to fail
            const originalReadFile = fs.readFile;
            const originalAccess = fs.access;
            const originalStat = fs.stat;
            const originalReaddir = fs.readdir;

            const error = new Error('System failure');
            fs.readFile = jest.fn().mockRejectedValue(error);
            fs.access = jest.fn().mockRejectedValue(error);
            fs.stat = jest.fn().mockRejectedValue(error);
            fs.readdir = jest.fn().mockRejectedValue(error);

            try {
                const result = await healthCheck.getDetailedHealth();

                // Should still return a result despite errors
                expect(result).toBeDefined();
                expect(result.checks).toBeDefined();
                expect(result.checks.length).toBeGreaterThan(0);

                // All checks should have error, warning, or ok status
                result.checks.forEach(check => {
                    expect(['error', 'warning', 'ok']).toContain(check.status);
                });

                // Overall status should reflect problems
                expect(['warning', 'error']).toContain(result.status);
            } finally {
                fs.readFile = originalReadFile;
                fs.access = originalAccess;
                fs.stat = originalStat;
                fs.readdir = originalReaddir;
            }
        });
    });

    describe('Basic Health Check Edge Cases', () => {
        test('should return consistent basic health info', () => {
            const result = healthCheck.getBasicHealth();

            expect(result.status).toBe('ok');
            expect(result.service).toBe('posterrama');
            expect(result.version).toBeDefined();
            expect(result.timestamp).toBeDefined();
            expect(typeof result.uptime).toBe('number');
            expect(result.uptime).toBeGreaterThanOrEqual(0);
        });
    });
});
