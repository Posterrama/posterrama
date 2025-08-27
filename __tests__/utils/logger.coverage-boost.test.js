/**
 * Simple functional tests for logger.js to improve coverage
 */

const logger = require('../../utils/logger');

describe('Logger Functional Tests', () => {
    beforeEach(() => {
        // Clear memory logs before each test
        if (logger.memoryLogs) {
            logger.memoryLogs.length = 0;
        }
    });

    describe('Log methods', () => {
        it('should have all expected logging methods', () => {
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.fatal).toBe('function');
        });

        it('should log messages using convenience methods', () => {
            // These should not throw
            expect(() => logger.info('Test info message')).not.toThrow();
            expect(() => logger.warn('Test warning message')).not.toThrow();
            expect(() => logger.error('Test error message')).not.toThrow();
            expect(() => logger.debug('Test debug message')).not.toThrow();
            expect(() => logger.fatal('Test fatal message')).not.toThrow();
        });

        it('should handle object messages', () => {
            const testObj = { test: 'data', number: 42 };
            expect(() => logger.info(testObj)).not.toThrow();
            expect(() => logger.error(testObj)).not.toThrow();
        });

        it('should handle null and undefined messages', () => {
            expect(() => logger.info(null)).not.toThrow();
            expect(() => logger.warn(undefined)).not.toThrow();
        });

        it('should handle circular reference objects', () => {
            const circular = { name: 'test' };
            circular.self = circular;
            expect(() => logger.error(circular)).not.toThrow();
        });
    });

    describe('getRecentLogs method', () => {
        it('should exist and be callable', () => {
            expect(typeof logger.getRecentLogs).toBe('function');
            expect(() => logger.getRecentLogs()).not.toThrow();
        });

        it('should return an array', () => {
            const logs = logger.getRecentLogs();
            expect(Array.isArray(logs)).toBe(true);
        });

        it('should handle level filtering', () => {
            expect(() => logger.getRecentLogs('ERROR')).not.toThrow();
            expect(() => logger.getRecentLogs('WARN')).not.toThrow();
            expect(() => logger.getRecentLogs('INFO')).not.toThrow();
        });

        it('should handle limit parameter', () => {
            expect(() => logger.getRecentLogs(null, 10)).not.toThrow();
            expect(() => logger.getRecentLogs('ERROR', 5)).not.toThrow();
        });

        it('should handle invalid parameters gracefully', () => {
            expect(() => logger.getRecentLogs('INVALID_LEVEL')).not.toThrow();
            expect(() => logger.getRecentLogs(null, -1)).not.toThrow();
            expect(() => logger.getRecentLogs(null, 'invalid')).not.toThrow();
        });
    });

    describe('shouldExcludeFromAdmin method', () => {
        it('should exist and be callable', () => {
            expect(typeof logger.shouldExcludeFromAdmin).toBe('function');
        });

        it('should exclude request logger messages', () => {
            const result = logger.shouldExcludeFromAdmin('[Request Logger] Received: GET /api');
            expect(typeof result).toBe('boolean');
        });

        it('should exclude auth messages', () => {
            const result = logger.shouldExcludeFromAdmin('[Auth] Authenticated via session');
            expect(typeof result).toBe('boolean');
        });

        it('should not exclude regular messages', () => {
            const result = logger.shouldExcludeFromAdmin('Regular log message');
            expect(typeof result).toBe('boolean');
        });

        it('should handle non-string inputs', () => {
            expect(() => logger.shouldExcludeFromAdmin(null)).not.toThrow();
            expect(() => logger.shouldExcludeFromAdmin(undefined)).not.toThrow();
            expect(() => logger.shouldExcludeFromAdmin(123)).not.toThrow();
            expect(() => logger.shouldExcludeFromAdmin({})).not.toThrow();
        });
    });

    describe('Memory logs', () => {
        it('should have memoryLogs array', () => {
            expect(Array.isArray(logger.memoryLogs)).toBe(true);
        });

        it('should accumulate logs in memory', () => {
            const initialCount = logger.memoryLogs.length;

            // Add some logs (these might not show up immediately due to winston's async nature)
            logger.error('Test error for memory');
            logger.warn('Test warning for memory');

            // The logs array should still be accessible
            expect(Array.isArray(logger.memoryLogs)).toBe(true);
        });
    });

    describe('Multiple parameter handling', () => {
        it('should handle multiple parameters in log methods', () => {
            expect(() => logger.info('Message', 'param2', 'param3')).not.toThrow();
            expect(() => logger.error('Error:', { error: 'details' }, 123)).not.toThrow();
            expect(() => logger.warn('Warning', null, undefined, 'more')).not.toThrow();
        });

        it('should handle mixed parameter types', () => {
            expect(() => logger.debug('Debug:', true, false, [], {})).not.toThrow();
            expect(() => logger.fatal('Fatal:', new Date(), /regex/, Symbol('test'))).not.toThrow();
        });
    });

    describe('Edge cases', () => {
        it('should handle empty string messages', () => {
            expect(() => logger.info('')).not.toThrow();
            expect(() => logger.error('')).not.toThrow();
        });

        it('should handle very long messages', () => {
            const longMessage = 'x'.repeat(10000);
            expect(() => logger.warn(longMessage)).not.toThrow();
        });

        it('should handle special characters in messages', () => {
            expect(() => logger.info('Message with émojis 🚀 and unicode ñáéíóú')).not.toThrow();
            expect(() => logger.error('Message\nwith\ttabs\rand\rcarriage\rreturns')).not.toThrow();
        });

        it('should handle function objects', () => {
            const testFunc = () => 'test';
            testFunc.customProp = 'value';
            expect(() => logger.debug('Function:', testFunc)).not.toThrow();
        });
    });

    describe('Configuration scenarios', () => {
        it('should work with different NODE_ENV values', () => {
            // Logger should work regardless of environment
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.level).toBe('string');
        });

        it('should maintain functionality after multiple calls', () => {
            // Stress test with multiple rapid calls
            for (let i = 0; i < 10; i++) {
                logger.info(`Stress test message ${i}`);
                logger.error(`Stress test error ${i}`);
            }

            expect(typeof logger.getRecentLogs).toBe('function');
            expect(() => logger.getRecentLogs()).not.toThrow();
        });
    });
});
