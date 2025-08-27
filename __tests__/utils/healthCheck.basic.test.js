describe('HealthCheck - Basic Tests', () => {
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

        // Clear require cache
        delete require.cache[require.resolve('../../utils/healthCheck')];
        delete require.cache[require.resolve('../../utils/logger')];
        delete require.cache[require.resolve('../../package.json')];

        // Mock modules
        jest.doMock('../../logger', () => mockLogger);
        jest.doMock('../../package.json', () => mockPackageJson);

        healthCheck = require('../../utils/healthCheck');
    });

    afterEach(() => {
        jest.dontMock('../../logger');
        jest.dontMock('../../package.json');

        // Reset cache
        if (healthCheck.__resetCache) {
            healthCheck.__resetCache();
        }
    });

    describe('getBasicHealth', () => {
        test('should return basic health information', () => {
            const originalUptime = process.uptime;
            process.uptime = jest.fn().mockReturnValue(123.45);

            const health = healthCheck.getBasicHealth();

            expect(health).toHaveProperty('status', 'ok');
            expect(health).toHaveProperty('service', 'posterrama');
            expect(health).toHaveProperty('version', '1.5.0');
            expect(health).toHaveProperty('timestamp');
            expect(health).toHaveProperty('uptime', 123.45);
            expect(health.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);

            process.uptime = originalUptime;
        });

        test('should always return ok status', () => {
            const health = healthCheck.getBasicHealth();
            expect(health.status).toBe('ok');
        });
    });

    describe('Module exports', () => {
        test('should export all required functions', () => {
            expect(typeof healthCheck.getBasicHealth).toBe('function');
            expect(typeof healthCheck.getDetailedHealth).toBe('function');
            expect(typeof healthCheck.checkConfiguration).toBe('function');
            expect(typeof healthCheck.checkFilesystem).toBe('function');
            expect(typeof healthCheck.checkMediaCache).toBe('function');
            expect(typeof healthCheck.checkPlexConnectivity).toBe('function');
            expect(typeof healthCheck.__resetCache).toBe('function');
        });
    });
});
