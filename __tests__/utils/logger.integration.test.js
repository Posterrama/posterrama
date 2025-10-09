// Simple integration test for logger.js without deep mocking
const logger = require('../../utils/logger.js');

describe('Logger Module - Integration Test', () => {
    describe('Logger instance properties', () => {
        test('should have expected logger methods', () => {
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.fatal).toBe('function');
        });

        test('should have memory logs array', () => {
            expect(Array.isArray(logger.memoryLogs)).toBe(true);
        });

        test('should have shouldExcludeFromAdmin method', () => {
            expect(typeof logger.shouldExcludeFromAdmin).toBe('function');
        });

        test('should have getRecentLogs method', () => {
            expect(typeof logger.getRecentLogs).toBe('function');
        });
    });

    describe('shouldExcludeFromAdmin functionality', () => {
        test('should exclude request logger messages', () => {
            const result = logger.shouldExcludeFromAdmin(
                '[Request Logger] Received: GET /api/test'
            );
            expect(result).toBe(true);
        });

        test('should exclude auth session messages', () => {
            const result = logger.shouldExcludeFromAdmin(
                '[Auth] Authenticated via session for user test'
            );
            expect(result).toBe(true);
        });

        test('should not exclude regular messages', () => {
            const result = logger.shouldExcludeFromAdmin('Regular log message');
            expect(result).toBe(false);
        });

        test('should handle null/undefined gracefully', () => {
            expect(logger.shouldExcludeFromAdmin(null)).toBe(false);
            expect(logger.shouldExcludeFromAdmin(undefined)).toBe(false);
            expect(logger.shouldExcludeFromAdmin(123)).toBe(false);
            expect(logger.shouldExcludeFromAdmin({})).toBe(false);
        });

        test('should handle partial matches', () => {
            const result1 = logger.shouldExcludeFromAdmin(
                'Some [Request Logger] Received: message'
            );
            const result2 = logger.shouldExcludeFromAdmin('[Auth] Authenticated via session test');

            expect(result1).toBe(true);
            expect(result2).toBe(true);
        });
    });

    describe('getRecentLogs functionality', () => {
        beforeEach(() => {
            // Setup test logs
            logger.memoryLogs = [
                { level: 'ERROR', message: 'Test error 1', timestamp: '2023-01-01T10:00:00' },
                { level: 'WARN', message: 'Test warning 1', timestamp: '2023-01-01T10:01:00' },
                { level: 'INFO', message: 'Test info 1', timestamp: '2023-01-01T10:02:00' },
                { level: 'ERROR', message: 'Test error 2', timestamp: '2023-01-01T10:03:00' },
                { level: 'INFO', message: 'Test info 2', timestamp: '2023-01-01T10:04:00' },
            ];
        });

        afterEach(() => {
            // Clean up
            logger.memoryLogs = [];
        });

        test('should return all logs when no level specified', () => {
            const result = logger.getRecentLogs();
            expect(result).toHaveLength(5);
        });

        test('should filter by ERROR level only', () => {
            const result = logger.getRecentLogs('ERROR');
            expect(result).toHaveLength(2);
            expect(result.every(log => log.level === 'ERROR')).toBe(true);
        });

        test('should filter by WARN level (includes ERROR)', () => {
            const result = logger.getRecentLogs('WARN');
            expect(result).toHaveLength(3); // 2 ERROR + 1 WARN
            expect(result.every(log => ['ERROR', 'WARN'].includes(log.level))).toBe(true);
        });

        test('should filter by INFO level (includes all)', () => {
            const result = logger.getRecentLogs('INFO');
            expect(result).toHaveLength(5); // All logs
        });

        test('should respect limit parameter', () => {
            const result = logger.getRecentLogs(null, 3);
            expect(result).toHaveLength(3);
        });

        test('should return most recent logs (slice from end)', () => {
            const result = logger.getRecentLogs(null, 2);
            expect(result).toHaveLength(2);
            // Should get the last 2 entries
            expect(result[0].message).toBe('Test error 2');
            expect(result[1].message).toBe('Test info 2');
        });

        test('should handle case insensitive level', () => {
            const result1 = logger.getRecentLogs('error');
            const result2 = logger.getRecentLogs('ERROR');
            expect(result1).toEqual(result2);
        });

        test('should handle invalid log level', () => {
            const result = logger.getRecentLogs('INVALID');
            expect(result).toHaveLength(5); // Should return all logs
        });

        test('should handle empty memory logs', () => {
            logger.memoryLogs = [];
            const result = logger.getRecentLogs();
            expect(result).toHaveLength(0);
        });

        test('should handle limit larger than available logs', () => {
            const result = logger.getRecentLogs(null, 100);
            expect(result).toHaveLength(5); // Should return all available
        });
    });

    describe('Logging method integration', () => {
        beforeEach(() => {
            // Clear memory logs for clean test
            logger.memoryLogs = [];
            // Mock log method to capture calls
            logger._originalLog = logger.log;
            logger.log = jest.fn();
        });

        afterEach(() => {
            // Restore original log method
            if (logger._originalLog) {
                logger.log = logger._originalLog;
                delete logger._originalLog;
            }
            logger.memoryLogs = [];
        });

        test('info method should call log with correct level', () => {
            logger.info('test info message');
            expect(logger.log).toHaveBeenCalledWith('info', 'test info message');
        });

        test('warn method should call log with correct level', () => {
            logger.warn('test warning message');
            expect(logger.log).toHaveBeenCalledWith('warn', 'test warning message');
        });

        test('error method should call log with correct level', () => {
            logger.error('test error message');
            expect(logger.log).toHaveBeenCalledWith('error', 'test error message');
        });

        test('debug method should call log with correct level', () => {
            logger.debug('test debug message');
            expect(logger.log).toHaveBeenCalledWith('debug', 'test debug message');
        });

        test('fatal method should map to error level', () => {
            logger.fatal('test fatal message');
            expect(logger.log).toHaveBeenCalledWith('error', 'test fatal message');
        });

        test('should handle multiple arguments', () => {
            logger.info('message', { data: 'test' }, 123, null);
            expect(logger.log).toHaveBeenCalledWith('info', 'message', { data: 'test' }, 123, null);
        });

        test('should handle no arguments', () => {
            logger.info();
            expect(logger.log).toHaveBeenCalledWith('info');
        });
    });

    describe('Module structure validation', () => {
        test('should be winston logger instance', () => {
            expect(logger).toBeDefined();
            expect(typeof logger).toBe('object');
        });

        test('should have winston properties', () => {
            expect(logger.level).toBeDefined();
            expect(logger.levels).toBeDefined();
        });

        test('should have custom properties', () => {
            expect(Array.isArray(logger.memoryLogs)).toBe(true);
            expect(typeof logger.shouldExcludeFromAdmin).toBe('function');
            expect(typeof logger.getRecentLogs).toBe('function');
        });
    });

    describe('Environment-specific behavior', () => {
        const originalNodeEnv = process.env.NODE_ENV;

        afterEach(() => {
            process.env.NODE_ENV = originalNodeEnv;
        });

        test('should adapt to test environment', () => {
            process.env.NODE_ENV = 'test';
            // Logger should be configured for test environment
            expect(logger.level).toBeDefined();
        });

        test('should work in production environment', () => {
            process.env.NODE_ENV = 'production';
            expect(logger).toBeDefined();
        });
    });
});
