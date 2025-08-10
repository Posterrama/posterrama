const healthCheck = require('../utils/healthCheck');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../logger');

// Mock dependencies
jest.mock('fs', () => ({
    promises: {
        access: jest.fn(),
        stat: jest.fn(),
        readdir: jest.fn()
    },
    constants: {
        R_OK: 4,
        W_OK: 2
    },
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn()
}));

jest.mock('../config');
jest.mock('../logger');
jest.mock('../sources/plex');

describe('HealthCheck - Comprehensive Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Reset health check cache
        healthCheck.__resetCache && healthCheck.__resetCache();
        
        // Setup default mocks
        config.mediaServers = [
            { name: 'Test Plex', type: 'plex', enabled: true, url: 'http://localhost:32400' },
            { name: 'Test Plex 2', type: 'plex', enabled: false, url: 'http://localhost:32401' }
        ];
    });

    describe('Basic Health Check', () => {
        test('should return basic health information', () => {
            const health = healthCheck.getBasicHealth();
            
            expect(health).toHaveProperty('status', 'ok');
            expect(health).toHaveProperty('service', 'posterrama');
            expect(health).toHaveProperty('version');
            expect(health).toHaveProperty('timestamp');
            expect(health).toHaveProperty('uptime');
            expect(typeof health.uptime).toBe('number');
        });

        test('should include valid timestamp', () => {
            const health = healthCheck.getBasicHealth();
            const timestamp = new Date(health.timestamp);
            
            expect(timestamp).toBeInstanceOf(Date);
            expect(timestamp.getTime()).not.toBeNaN();
        });
    });

    describe('Configuration Check', () => {
        test('should pass with enabled media servers', async () => {
            const result = await healthCheck.checkConfiguration();
            
            expect(result.name).toBe('configuration');
            expect(result.status).toBe('ok');
            expect(result.message).toContain('1 media server(s) are enabled');
            expect(result.details.enabledServers).toBe(1);
            expect(result.details.totalServers).toBe(2);
        });

        test('should warn when no media servers are enabled', async () => {
            config.mediaServers = [
                { name: 'Disabled Server', enabled: false }
            ];
            
            const result = await healthCheck.checkConfiguration();
            
            expect(result.status).toBe('warning');
            expect(result.message).toContain('No media servers are enabled');
        });

        test('should warn when mediaServers is empty array', async () => {
            config.mediaServers = [];
            
            const result = await healthCheck.checkConfiguration();
            
            expect(result.status).toBe('warning');
            expect(result.message).toContain('No media servers are enabled');
        });

        test('should warn when mediaServers is undefined', async () => {
            config.mediaServers = undefined;
            
            const result = await healthCheck.checkConfiguration();
            
            expect(result.status).toBe('warning');
            expect(result.message).toContain('No media servers are enabled');
        });

        test('should handle configuration errors', async () => {
            // Mock config access to throw error
            const originalMediaServers = config.mediaServers;
            Object.defineProperty(config, 'mediaServers', {
                get: () => { throw new Error('Config access error'); }
            });
            
            const result = await healthCheck.checkConfiguration();
            
            expect(result.status).toBe('error');
            expect(result.message).toContain('Configuration error');
            expect(result.details.error).toContain('Config access error');
            
            // Restore
            Object.defineProperty(config, 'mediaServers', {
                value: originalMediaServers,
                writable: true
            });
        });
    });

    describe('Filesystem Check', () => {
        test('should pass when all directories are accessible', async () => {
            fs.access.mockResolvedValue();
            
            const result = await healthCheck.checkFilesystem();
            
            expect(result.name).toBe('filesystem');
            expect(result.status).toBe('ok');
            expect(result.message).toContain('All required filesystem paths are accessible');
            expect(result.details.directories).toEqual(['sessions', 'image_cache', 'logs']);
            
            // Verify all directories were checked
            expect(fs.access).toHaveBeenCalledTimes(3);
            expect(fs.access).toHaveBeenCalledWith(
                expect.stringContaining('sessions'),
                fs.constants.R_OK | fs.constants.W_OK
            );
            expect(fs.access).toHaveBeenCalledWith(
                expect.stringContaining('image_cache'),
                fs.constants.R_OK | fs.constants.W_OK
            );
            expect(fs.access).toHaveBeenCalledWith(
                expect.stringContaining('logs'),
                fs.constants.R_OK | fs.constants.W_OK
            );
        });

        test('should fail when directory access fails', async () => {
            fs.access.mockRejectedValue(new Error('Permission denied'));
            
            const result = await healthCheck.checkFilesystem();
            
            expect(result.status).toBe('error');
            expect(result.message).toContain('Filesystem access error');
            expect(result.details.error).toContain('Permission denied');
        });

        test('should handle ENOENT errors', async () => {
            const enoentError = new Error('ENOENT: no such file or directory');
            enoentError.code = 'ENOENT';
            fs.access.mockRejectedValue(enoentError);
            
            const result = await healthCheck.checkFilesystem();
            
            expect(result.status).toBe('error');
            expect(result.message).toContain('Filesystem access error');
        });
    });

    describe('Media Cache Check', () => {
        test('should pass when cache directory is accessible', async () => {
            const mockStats = {
                mtime: new Date('2023-01-01T00:00:00Z')
            };
            const mockFiles = ['poster1.jpg', 'poster2.jpg', 'banner1.jpg'];
            
            fs.stat.mockResolvedValue(mockStats);
            fs.readdir.mockResolvedValue(mockFiles);
            
            const result = await healthCheck.checkMediaCache();
            
            expect(result.name).toBe('cache');
            expect(result.status).toBe('ok');
            expect(result.message).toContain('3 cached items');
            expect(result.details.itemCount).toBe(3);
            expect(result.details.lastModified).toBe(mockStats.mtime);
        });

        test('should handle empty cache directory', async () => {
            const mockStats = { mtime: new Date() };
            fs.stat.mockResolvedValue(mockStats);
            fs.readdir.mockResolvedValue([]);
            
            const result = await healthCheck.checkMediaCache();
            
            expect(result.status).toBe('ok');
            expect(result.message).toContain('0 cached items');
            expect(result.details.itemCount).toBe(0);
        });

        test('should warn when cache check fails', async () => {
            fs.stat.mockRejectedValue(new Error('Directory not found'));
            
            const result = await healthCheck.checkMediaCache();
            
            expect(result.status).toBe('warning');
            expect(result.message).toContain('Media cache check failed');
            expect(result.details.error).toContain('Directory not found');
        });
    });

    describe('Plex Connectivity Check', () => {
        let mockTestServerConnection;

        beforeEach(() => {
            mockTestServerConnection = jest.fn();
            jest.doMock('../sources/plex', () => ({
                testServerConnection: mockTestServerConnection
            }));
        });

        test('should return null when no Plex servers are enabled', async () => {
            config.mediaServers = [
                { name: 'Other Server', type: 'other', enabled: true }
            ];
            
            const result = await healthCheck.checkPlexConnectivity();
            
            expect(result).toBeNull();
        });

        test('should return null when no servers are configured', async () => {
            config.mediaServers = [];
            
            const result = await healthCheck.checkPlexConnectivity();
            
            expect(result).toBeNull();
        });

        test('should check enabled Plex servers', async () => {
            const { testServerConnection } = require('../sources/plex');
            testServerConnection.mockResolvedValue({
                status: 'ok',
                message: 'Server is reachable'
            });
            
            const result = await healthCheck.checkPlexConnectivity();
            
            expect(result.name).toBe('plex_connectivity');
            expect(result.status).toBe('ok');
            expect(result.message).toContain('Checked 1 Plex server(s)');
            expect(result.details.servers).toHaveLength(1);
            expect(result.details.servers[0].server).toBe('Test Plex');
            expect(result.details.servers[0].status).toBe('ok');
            expect(result.details.servers[0]).toHaveProperty('responseTime');
        });

        test('should handle server errors and set overall status to error', async () => {
            const { testServerConnection } = require('../sources/plex');
            testServerConnection.mockResolvedValue({
                status: 'error',
                message: 'Connection failed'
            });
            
            const result = await healthCheck.checkPlexConnectivity();
            
            expect(result.status).toBe('error');
            expect(result.details.servers[0].status).toBe('error');
            expect(result.details.servers[0].message).toBe('Connection failed');
        });

        test('should handle server warnings and set overall status to warning', async () => {
            const { testServerConnection } = require('../sources/plex');
            testServerConnection.mockResolvedValue({
                status: 'warning',
                message: 'Slow response'
            });
            
            const result = await healthCheck.checkPlexConnectivity();
            
            expect(result.status).toBe('warning');
            expect(result.details.servers[0].status).toBe('warning');
        });

        test('should handle multiple servers with mixed results', async () => {
            config.mediaServers = [
                { name: 'Good Server', type: 'plex', enabled: true },
                { name: 'Bad Server', type: 'plex', enabled: true }
            ];
            
            const { testServerConnection } = require('../sources/plex');
            testServerConnection
                .mockResolvedValueOnce({ status: 'ok', message: 'Good' })
                .mockResolvedValueOnce({ status: 'error', message: 'Bad' });
            
            const result = await healthCheck.checkPlexConnectivity();
            
            expect(result.status).toBe('error'); // Error takes precedence
            expect(result.details.servers).toHaveLength(2);
        });

        test('should handle connectivity check errors', async () => {
            const { testServerConnection } = require('../sources/plex');
            testServerConnection.mockRejectedValue(new Error('Network error'));
            
            const result = await healthCheck.checkPlexConnectivity();
            
            expect(result.status).toBe('error');
            expect(result.message).toContain('Plex connectivity check failed');
            expect(result.details.error).toContain('Network error');
        });

        test('should measure response time', async () => {
            const { testServerConnection } = require('../sources/plex');
            testServerConnection.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return { status: 'ok', message: 'Success' };
            });
            
            const result = await healthCheck.checkPlexConnectivity();
            
            expect(result.details.servers[0].responseTime).toBeGreaterThanOrEqual(100);
        });
    });

    describe('Detailed Health Check', () => {
        beforeEach(() => {
            // Mock all filesystem operations
            fs.access.mockResolvedValue();
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue(['file1', 'file2']);
            
            // Mock Plex connectivity
            const { testServerConnection } = require('../sources/plex');
            testServerConnection.mockResolvedValue({
                status: 'ok',
                message: 'Server reachable'
            });
        });

        test('should perform all health checks and return overall status', async () => {
            const result = await healthCheck.getDetailedHealth();
            
            expect(result).toHaveProperty('status');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('checks');
            expect(Array.isArray(result.checks)).toBe(true);
            expect(result.checks.length).toBeGreaterThanOrEqual(3);
        });

        test('should return ok status when all checks pass', async () => {
            const result = await healthCheck.getDetailedHealth();
            
            expect(result.status).toBe('ok');
        });

        test('should return warning status when any check has warning', async () => {
            config.mediaServers = []; // This will cause a warning
            
            const result = await healthCheck.getDetailedHealth();
            
            expect(result.status).toBe('warning');
        });

        test('should return error status when any check has error', async () => {
            fs.access.mockRejectedValue(new Error('Filesystem error'));
            
            const result = await healthCheck.getDetailedHealth();
            
            expect(result.status).toBe('error');
        });

        test('should include Plex check when Plex servers are configured', async () => {
            const result = await healthCheck.getDetailedHealth();
            
            const plexCheck = result.checks.find(check => check.name === 'plex_connectivity');
            expect(plexCheck).toBeDefined();
        });

        test('should not include Plex check when no Plex servers', async () => {
            config.mediaServers = [
                { name: 'Other Server', type: 'other', enabled: true }
            ];
            
            const result = await healthCheck.getDetailedHealth();
            
            const plexCheck = result.checks.find(check => check.name === 'plex_connectivity');
            expect(plexCheck).toBeUndefined();
        });

        test('should handle system errors gracefully', async () => {
            // Mock a system-level failure
            jest.spyOn(healthCheck, 'checkConfiguration').mockRejectedValue(new Error('System failure'));
            
            const result = await healthCheck.getDetailedHealth();
            
            expect(result.status).toBe('error');
            expect(result.checks).toHaveLength(1);
            expect(result.checks[0].name).toBe('system');
            expect(result.checks[0].message).toContain('Health check system failure');
        });

        test('should log errors when health check fails', async () => {
            jest.spyOn(healthCheck, 'checkConfiguration').mockRejectedValue(new Error('Test error'));
            
            await healthCheck.getDetailedHealth();
            
            expect(logger.error).toHaveBeenCalledWith('Health check failed:', expect.any(Error));
        });
    });

    describe('Health Check Caching', () => {
        beforeEach(() => {
            fs.access.mockResolvedValue();
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue([]);
        });

        test('should cache health check results', async () => {
            const checkConfigSpy = jest.spyOn(healthCheck, 'checkConfiguration');
            
            // First call
            await healthCheck.getDetailedHealth();
            expect(checkConfigSpy).toHaveBeenCalledTimes(1);
            
            // Second call should use cache
            await healthCheck.getDetailedHealth();
            expect(checkConfigSpy).toHaveBeenCalledTimes(1);
        });

        test('should expire cache after 30 seconds', async () => {
            const checkConfigSpy = jest.spyOn(healthCheck, 'checkConfiguration');
            
            // Mock Date.now to control time
            const originalNow = Date.now;
            let mockTime = 1000000000;
            Date.now = jest.fn(() => mockTime);
            
            try {
                // First call
                await healthCheck.getDetailedHealth();
                expect(checkConfigSpy).toHaveBeenCalledTimes(1);
                
                // Advance time by 31 seconds
                mockTime += 31000;
                
                // Second call should not use cache
                await healthCheck.getDetailedHealth();
                expect(checkConfigSpy).toHaveBeenCalledTimes(2);
            } finally {
                Date.now = originalNow;
            }
        });

        test('should return same cached result within cache duration', async () => {
            const result1 = await healthCheck.getDetailedHealth();
            const result2 = await healthCheck.getDetailedHealth();
            
            expect(result1.timestamp).toBe(result2.timestamp);
        });
    });

    describe('Error Handling', () => {
        test('should handle Promise.all failures gracefully', async () => {
            fs.access.mockRejectedValue(new Error('FS Error'));
            
            const result = await healthCheck.getDetailedHealth();
            
            expect(result.status).toBe('error');
            expect(result.checks.some(check => check.status === 'error')).toBe(true);
        });

        test('should continue with other checks if one fails', async () => {
            fs.access.mockRejectedValue(new Error('FS Error'));
            fs.stat.mockResolvedValue({ mtime: new Date() });
            fs.readdir.mockResolvedValue([]);
            
            const result = await healthCheck.getDetailedHealth();
            
            // Should have at least config check and cache check
            expect(result.checks.length).toBeGreaterThanOrEqual(2);
        });
    });
});
