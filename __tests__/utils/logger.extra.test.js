// Quick additional tests to push coverage over 90%
const logger = require('../../utils/logger');

describe('Logger Additional Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should handle edge cases in log filtering', () => {
        // Clear logs first
        logger.memoryLogs.length = 0;

        // Add some test logs directly to memory
        logger.memoryLogs.push(
            { level: 'ERROR', message: 'Test error 1', timestamp: '2024-01-01T10:00:00' },
            { level: 'WARN', message: 'Test warning 1', timestamp: '2024-01-01T10:01:00' },
            { level: 'INFO', message: 'Test info 1', timestamp: '2024-01-01T10:02:00' },
            { level: 'DEBUG', message: 'Test debug 1', timestamp: '2024-01-01T10:03:00' }
        );

        // Test various level filters
        expect(logger.getRecentLogs('error')).toHaveLength(1);
        expect(logger.getRecentLogs('warn')).toHaveLength(2); // error + warn
        expect(logger.getRecentLogs('info')).toHaveLength(3); // error + warn + info
        expect(logger.getRecentLogs('debug')).toHaveLength(4); // all levels

        // Test with different casing
        expect(logger.getRecentLogs('ERROR')).toHaveLength(1);
        expect(logger.getRecentLogs('WARN')).toHaveLength(2);

        // Test with limit
        expect(logger.getRecentLogs(null, 2)).toHaveLength(2);
        expect(logger.getRecentLogs('warn', 1)).toHaveLength(1);

        // Test with invalid level
        expect(logger.getRecentLogs('invalid')).toHaveLength(4); // should return all

        // Test with empty string level
        expect(logger.getRecentLogs('')).toHaveLength(4);
    });

    test('should handle shouldExcludeFromAdmin edge cases', () => {
        // Test all exclusion patterns
        expect(logger.shouldExcludeFromAdmin('[Request Logger] Received: POST /api')).toBe(true);
        expect(logger.shouldExcludeFromAdmin('[Auth] Authenticated via session token')).toBe(true);

        // Test partial matches
        expect(logger.shouldExcludeFromAdmin('Some [Request Logger] Received: in middle')).toBe(
            true
        );
        expect(
            logger.shouldExcludeFromAdmin('Contains [Auth] Authenticated via session here')
        ).toBe(true);

        // Test case sensitivity
        expect(logger.shouldExcludeFromAdmin('[request logger] received:')).toBe(false);
        expect(logger.shouldExcludeFromAdmin('[auth] authenticated via session')).toBe(false);

        // Test edge cases
        expect(logger.shouldExcludeFromAdmin('')).toBe(false);
        expect(logger.shouldExcludeFromAdmin(' ')).toBe(false);
        expect(logger.shouldExcludeFromAdmin(123)).toBe(false);
        expect(logger.shouldExcludeFromAdmin([])).toBe(false);
        expect(logger.shouldExcludeFromAdmin({})).toBe(false);
        expect(logger.shouldExcludeFromAdmin(true)).toBe(false);
        expect(logger.shouldExcludeFromAdmin(false)).toBe(false);
    });

    test('should test winston logger functions exist', () => {
        // Test that winston methods are available
        expect(typeof logger.log).toBe('function');
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.fatal).toBe('function');

        // Test that they don't throw when called
        expect(() => logger.info('test info message')).not.toThrow();
        expect(() => logger.warn('test warn message')).not.toThrow();
        expect(() => logger.error('test error message')).not.toThrow();
        expect(() => logger.debug('test debug message')).not.toThrow();
        expect(() => logger.fatal('test fatal message')).not.toThrow();

        // Test with various parameter types
        expect(() => logger.info('string', 123, true, null, undefined)).not.toThrow();
        expect(() => logger.error('object test', { key: 'value' })).not.toThrow();
        expect(() => logger.warn('array test', [1, 2, 3])).not.toThrow();
    });

    test('should handle memory logs array operations', () => {
        const originalLength = logger.memoryLogs.length;

        // Test that memoryLogs is an array
        expect(Array.isArray(logger.memoryLogs)).toBe(true);

        // Test that we can manipulate it (though real usage would be through winston)
        logger.memoryLogs.push({
            level: 'TEST',
            message: 'test',
            timestamp: new Date().toISOString(),
        });
        expect(logger.memoryLogs.length).toBe(originalLength + 1);

        // Test that getRecentLogs returns a copy
        const logs1 = logger.getRecentLogs();
        const logs2 = logger.getRecentLogs();
        expect(logs1).not.toBe(logs2); // Different array instances
        expect(logs1).toEqual(logs2); // Same content

        // Modifying returned array should not affect original
        logs1.push({ level: 'FAKE', message: 'fake' });
        expect(logger.memoryLogs.length).toBe(originalLength + 1); // Still same length
    });
});
