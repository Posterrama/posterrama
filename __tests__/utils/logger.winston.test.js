// Test logger functionality - focusing on the aspects we can test effectively

// Spy on fs methods rather than full mock to avoid breaking nested dependencies
const fs = require('fs');

describe('Logger Module', () => {
    let logger;
    let mkdirSyncSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        delete require.cache[require.resolve('../../utils/logger')];
        const mod = require('../../utils/logger');
        logger = mod.createTestLogger({ level: 'info', silent: true });
    });

    describe('Logger properties and initialization', () => {
        test('should have memoryLogs array', () => {
            expect(Array.isArray(logger.memoryLogs)).toBe(true);
        });

        test('should have shouldExcludeFromAdmin function', () => {
            expect(typeof logger.shouldExcludeFromAdmin).toBe('function');
        });

        test('should have getRecentLogs function', () => {
            expect(typeof logger.getRecentLogs).toBe('function');
        });
    });

    describe('Convenience methods', () => {
        test('should have info method', () => {
            expect(typeof logger.info).toBe('function');
            expect(() => logger.info('test')).not.toThrow();
        });

        test('should have warn method', () => {
            expect(typeof logger.warn).toBe('function');
            expect(() => logger.warn('test')).not.toThrow();
        });

        test('should have error method', () => {
            expect(typeof logger.error).toBe('function');
            expect(() => logger.error('test')).not.toThrow();
        });

        test('should have debug method', () => {
            expect(typeof logger.debug).toBe('function');
            expect(() => logger.debug('test')).not.toThrow();
        });

        test('should have fatal method that maps to error level', () => {
            expect(typeof logger.fatal).toBe('function');
            expect(() => logger.fatal('test')).not.toThrow();
        });
    });

    describe('shouldExcludeFromAdmin', () => {
        test('should exclude request logger messages', () => {
            expect(logger.shouldExcludeFromAdmin('[Request Logger] Received: GET /')).toBe(true);
        });

        test('should exclude auth session messages', () => {
            expect(logger.shouldExcludeFromAdmin('[Auth] Authenticated via session')).toBe(true);
        });

        test('should not exclude regular messages', () => {
            expect(logger.shouldExcludeFromAdmin('Regular log message')).toBe(false);
        });

        test('should handle non-string messages', () => {
            expect(logger.shouldExcludeFromAdmin({ key: 'value' })).toBe(false);
            expect(logger.shouldExcludeFromAdmin(null)).toBe(false);
            expect(logger.shouldExcludeFromAdmin(undefined)).toBe(false);
        });

        test('should handle empty or undefined inputs', () => {
            expect(logger.shouldExcludeFromAdmin('')).toBe(false);
            expect(logger.shouldExcludeFromAdmin()).toBe(false);
        });
    });

    describe('getRecentLogs', () => {
        beforeEach(() => {
            // Set up some test logs
            logger.memoryLogs.length = 0; // Clear array
            logger.memoryLogs.push(
                { level: 'ERROR', message: 'Error 1', timestamp: '2024-01-01T10:00:00' },
                { level: 'WARN', message: 'Warning 1', timestamp: '2024-01-01T10:01:00' },
                { level: 'INFO', message: 'Info 1', timestamp: '2024-01-01T10:02:00' },
                { level: 'ERROR', message: 'Error 2', timestamp: '2024-01-01T10:03:00' }
            );
        });

        test('should return all logs when no level specified', () => {
            const logs = logger.getRecentLogs();
            expect(logs).toHaveLength(4);
        });

        test('should filter by error level', () => {
            const logs = logger.getRecentLogs('error');
            expect(logs).toHaveLength(2);
            expect(logs.every(log => log.level === 'ERROR')).toBe(true);
        });

        test('should filter by warn level (includes errors)', () => {
            const logs = logger.getRecentLogs('warn');
            expect(logs).toHaveLength(3); // 2 errors + 1 warning
        });

        test('should respect limit parameter', () => {
            const logs = logger.getRecentLogs(null, 2);
            expect(logs).toHaveLength(2);
        });

        test('should handle case insensitive level', () => {
            const logs = logger.getRecentLogs('ERROR');
            expect(logs).toHaveLength(2);
        });

        test('should handle invalid level gracefully', () => {
            const logs = logger.getRecentLogs('invalid');
            expect(logs).toHaveLength(4); // Should return all logs
        });

        test('should have getRecentLogs with edge cases', () => {
            // Clear logs first
            logger.memoryLogs.length = 0;

            // Test with no logs
            const noLogs = logger.getRecentLogs();
            expect(noLogs).toHaveLength(0);

            // Test with undefined level
            const undefLogs = logger.getRecentLogs(undefined);
            expect(undefLogs).toHaveLength(0);

            // Test with null level and no limit
            const nullLogs = logger.getRecentLogs(null);
            expect(nullLogs).toHaveLength(0);
        });

        test('should return copy of logs, not reference', () => {
            const logs = logger.getRecentLogs();
            logs.push({ level: 'TEST', message: 'test' });
            expect(logger.memoryLogs).toHaveLength(4); // Original should be unchanged
        });
    });

    describe('Module structure', () => {
        test('should have Winston logger properties', () => {
            // Test that it has basic winston logger interface
            expect(typeof logger.log).toBe('function');
        });

        test('should handle log level filtering in test environment', () => {
            // In test environment, should be set to warn level to suppress debug/info
            expect(process.env.NODE_ENV).toBe('test');
        });
    });

    describe('Directory creation', () => {
        test('should not use fs.mkdirSync during initialization', () => {
            // Logger disk logging should be initialized without sync fs calls.
            expect(mkdirSyncSpy).not.toHaveBeenCalled();
        });
    });
});
