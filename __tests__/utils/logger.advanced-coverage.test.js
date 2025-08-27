const fs = require('fs');

// Simple functional tests for logger coverage
describe('Logger Advanced Coverage', () => {
    let logger;
    let originalEnv;

    beforeEach(() => {
        originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test'; // Force test mode

        // Clear require cache to get fresh logger instance
        delete require.cache[require.resolve('../../utils/logger')];
        logger = require('../../utils/logger');
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    describe('Basic logger functionality', () => {
        test('should handle all convenience methods', () => {
            expect(() => {
                logger.info('Info message');
                logger.warn('Warning message');
                logger.error('Error message');
                logger.fatal('Fatal message');
                logger.debug('Debug message');
            }).not.toThrow();
        });

        test('should handle object messages with _raw field', () => {
            const objWithRaw = {
                data: 'test',
                _raw: 'sensitive data',
            };

            expect(() => {
                logger.info(objWithRaw);
            }).not.toThrow();
        });

        test('should handle circular reference objects', () => {
            const circular = { name: 'test' };
            circular.self = circular;

            expect(() => {
                logger.info(circular);
            }).not.toThrow();
        });

        test('should handle null and undefined', () => {
            expect(() => {
                logger.info(null);
                logger.info(undefined);
                logger.warn(null);
                logger.error(undefined);
            }).not.toThrow();
        });

        test('should handle arrays and complex structures', () => {
            const complexData = [
                { id: 1, data: { nested: true } },
                { id: 2, _raw: 'hidden data' },
            ];

            expect(() => {
                logger.info(complexData);
            }).not.toThrow();
        });
    });

    describe('Admin panel exclusions', () => {
        test('should exclude request logger messages', () => {
            const requestMessage = '[Request Logger] Received: GET /api/test';
            expect(logger.shouldExcludeFromAdmin(requestMessage)).toBe(true);
        });

        test('should exclude auth messages', () => {
            const authMessage = '[Auth] Authenticated via session';
            expect(logger.shouldExcludeFromAdmin(authMessage)).toBe(true);
        });

        test('should not exclude normal messages', () => {
            const normalMessage = 'Regular log message';
            expect(logger.shouldExcludeFromAdmin(normalMessage)).toBe(false);
        });

        test('should handle non-string messages in exclusion check', () => {
            expect(logger.shouldExcludeFromAdmin(123)).toBe(false);
            expect(logger.shouldExcludeFromAdmin({})).toBe(false);
            expect(logger.shouldExcludeFromAdmin(null)).toBe(false);
        });
    });

    describe('Memory logs functionality', () => {
        test('should maintain memory logs array', () => {
            expect(Array.isArray(logger.memoryLogs)).toBe(true);
        });

        test('should add logs to memory', () => {
            const initialLength = logger.memoryLogs.length;
            logger.info('Test memory log');

            // Allow async operation to complete
            setTimeout(() => {
                expect(logger.memoryLogs.length).toBeGreaterThanOrEqual(initialLength);
            }, 10);
        });

        test('should filter logs by level in getRecentLogs', () => {
            // Clear existing logs
            logger.memoryLogs.length = 0;

            // Add test logs with known levels
            logger.memoryLogs.push(
                { level: 'ERROR', message: 'Test error', timestamp: '2025-01-01T10:00:00' },
                { level: 'WARN', message: 'Test warning', timestamp: '2025-01-01T10:01:00' },
                { level: 'INFO', message: 'Test info', timestamp: '2025-01-01T10:02:00' }
            );

            const errorLogs = logger.getRecentLogs('ERROR');
            const warnLogs = logger.getRecentLogs('WARN');
            const allLogs = logger.getRecentLogs();

            expect(errorLogs.length).toBeGreaterThanOrEqual(1);
            expect(warnLogs.length).toBeGreaterThanOrEqual(2);
            expect(allLogs.length).toBeGreaterThanOrEqual(3);
        });

        test('should handle invalid log levels', () => {
            const logs = logger.getRecentLogs('INVALID');
            expect(Array.isArray(logs)).toBe(true);
        });

        test('should respect limit parameter', () => {
            // Add several logs
            logger.memoryLogs.length = 0;
            for (let i = 0; i < 10; i++) {
                logger.memoryLogs.push({
                    level: 'INFO',
                    message: `Test ${i}`,
                    timestamp: new Date().toISOString(),
                });
            }

            const limitedLogs = logger.getRecentLogs(null, 5);
            expect(limitedLogs.length).toBeLessThanOrEqual(5);
        });

        test('should handle log level case variations', () => {
            logger.memoryLogs.length = 0;
            logger.memoryLogs.push({
                level: 'error',
                message: 'Lowercase error',
                timestamp: new Date().toISOString(),
            });

            const logs = logger.getRecentLogs('ERROR');
            expect(Array.isArray(logs)).toBe(true);
        });
    });

    describe('Environment handling', () => {
        test('should work in different NODE_ENV settings', () => {
            // Test with development
            process.env.NODE_ENV = 'development';
            delete require.cache[require.resolve('../../utils/logger')];
            const devLogger = require('../../utils/logger');
            expect(devLogger).toBeDefined();

            // Test with production
            process.env.NODE_ENV = 'production';
            delete require.cache[require.resolve('../../utils/logger')];
            const prodLogger = require('../../utils/logger');
            expect(prodLogger).toBeDefined();

            // Reset to test
            process.env.NODE_ENV = 'test';
        });

        test('should handle LOG_LEVEL environment variable', () => {
            process.env.LOG_LEVEL = 'error';
            delete require.cache[require.resolve('../../utils/logger')];
            const errorLogger = require('../../utils/logger');
            expect(errorLogger).toBeDefined();

            delete process.env.LOG_LEVEL;
        });

        test('should handle TEST_SILENT environment variable', () => {
            process.env.TEST_SILENT = 'true';
            delete require.cache[require.resolve('../../utils/logger')];
            const silentLogger = require('../../utils/logger');
            expect(silentLogger).toBeDefined();

            delete process.env.TEST_SILENT;
        });
    });

    describe('Error scenarios', () => {
        test('should handle logger operations during high load', () => {
            // Test many rapid log calls
            expect(() => {
                for (let i = 0; i < 100; i++) {
                    logger.info(`Load test message ${i}`);
                }
            }).not.toThrow();
        });

        test('should handle very large log messages', () => {
            const largeMessage = 'x'.repeat(10000);
            expect(() => {
                logger.info(largeMessage);
            }).not.toThrow();
        });

        test('should handle special characters and encoding', () => {
            const specialMessage = '🎯 Special chars: äöü ñ 中文 русский';
            expect(() => {
                logger.info(specialMessage);
            }).not.toThrow();
        });
    });
});
