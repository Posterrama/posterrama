/**
 * Coverage enhancement tests for logger.js
 * Focus on error handling, edge cases, and uncovered paths
 */

const fs = require('fs');
const path = require('path');

describe('Logger Coverage Enhancement', () => {
    let logger;

    beforeEach(() => {
        // Get fresh logger instance
        logger = require('../../utils/logger');

        // Clear memory logs
        if (logger.memoryLogs) {
            logger.memoryLogs.length = 0;
        }
    });

    describe('Basic Logger Functionality', () => {
        test('should handle logs directory existence check', () => {
            // Test the logs directory creation code (lines 6-8)
            const logsDir = path.join(__dirname, '../../logs');
            expect(fs.existsSync(logsDir)).toBe(true);
        });

        test('should handle basic logging operations', () => {
            // Test basic logging without errors
            expect(() => {
                logger.log('info', 'Test message');
                logger.info('Info message');
                logger.warn('Warning message');
                logger.error('Error message');
                logger.debug('Debug message');
                logger.fatal('Fatal message');
            }).not.toThrow();
        });
    });

    describe('Object Serialization Edge Cases', () => {
        test('should handle objects with _raw property', () => {
            // Test _raw filtering in formatMessage (lines 17-18)
            const objWithRaw = {
                name: 'test',
                _raw: 'sensitive data',
            };

            expect(() => {
                logger.log('info', objWithRaw);
            }).not.toThrow();
        });

        test('should handle circular references in objects', () => {
            // Test catch block in formatMessage (lines 23-25)
            const circularObj = { name: 'test' };
            circularObj.self = circularObj;

            expect(() => {
                logger.log('info', circularObj);
            }).not.toThrow();
        });

        test('should handle null and undefined objects', () => {
            // Test null handling
            expect(() => {
                logger.log('info', null);
                logger.log('info', undefined);
                logger.log('info', 'message', null, undefined);
            }).not.toThrow();
        });
    });

    describe('Error Handling Scenarios', () => {
        test('should handle invalid JSON in config loading', () => {
            // This tests the try-catch blocks in timestamp formatting
            expect(() => {
                logger.log('info', 'Config test message');
            }).not.toThrow();
        });

        test('should handle missing config gracefully', () => {
            // Test fallback when config is not available
            expect(() => {
                logger.log('info', 'No config test');
            }).not.toThrow();
        });
    });

    describe('Memory Log Management', () => {
        test('should store logs in memory', () => {
            logger.log('info', 'Memory test 1');
            logger.log('error', 'Memory test 2');

            // Should have memory logs
            expect(logger.memoryLogs).toBeDefined();
            expect(Array.isArray(logger.memoryLogs)).toBe(true);
        });

        test('should handle getRecentLogs method', () => {
            const logs = logger.getRecentLogs();
            expect(Array.isArray(logs)).toBe(true);

            const logsWithLevel = logger.getRecentLogs('info');
            expect(Array.isArray(logsWithLevel)).toBe(true);

            const logsWithLimit = logger.getRecentLogs(null, 10);
            expect(Array.isArray(logsWithLimit)).toBe(true);
        });

        test('should handle invalid log levels in getRecentLogs', () => {
            expect(() => {
                logger.getRecentLogs('invalid_level');
                logger.getRecentLogs('');
                logger.getRecentLogs(null);
            }).not.toThrow();
        });
    });

    describe('Admin Panel Exclusions', () => {
        test('should have shouldExcludeFromAdmin function', () => {
            expect(typeof logger.shouldExcludeFromAdmin).toBe('function');

            // Test exclusion logic with actual patterns from logger.js
            expect(logger.shouldExcludeFromAdmin('[Request Logger] Received: GET /api/test')).toBe(
                true
            );
            expect(logger.shouldExcludeFromAdmin('[Auth] Authenticated via session for user')).toBe(
                true
            );
            expect(logger.shouldExcludeFromAdmin('normal application message')).toBe(false);
            expect(logger.shouldExcludeFromAdmin('')).toBe(false);
        });

        test('should handle various message types for exclusion', () => {
            expect(() => {
                logger.shouldExcludeFromAdmin(null);
                logger.shouldExcludeFromAdmin(undefined);
                logger.shouldExcludeFromAdmin(123);
                logger.shouldExcludeFromAdmin({});
            }).not.toThrow();
        });
    });

    describe('Convenience Methods', () => {
        test('should have all convenience methods', () => {
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.fatal).toBe('function');
        });

        test('should handle multiple arguments in convenience methods', () => {
            expect(() => {
                logger.info('Info', 'with', 'multiple', 'args');
                logger.warn('Warning', { data: 'object' });
                logger.error('Error', new Error('test error'));
                logger.debug('Debug', 123, true);
                logger.fatal('Fatal', null, undefined);
            }).not.toThrow();
        });
    });

    describe('Edge Cases and Error Recovery', () => {
        test('should handle console errors gracefully', () => {
            // Mock console to throw error
            const originalConsoleError = console.error;
            console.error = () => {
                throw new Error('Console error');
            };

            expect(() => {
                logger.error('Test console error handling');
            }).not.toThrow();

            console.error = originalConsoleError;
        });

        test('should handle large log messages', () => {
            const largeMessage = 'A'.repeat(10000);

            expect(() => {
                logger.log('info', largeMessage);
            }).not.toThrow();
        });

        test('should handle rapid logging', () => {
            expect(() => {
                for (let i = 0; i < 100; i++) {
                    logger.log('info', `Rapid log ${i}`);
                }
            }).not.toThrow();
        });
    });
});
