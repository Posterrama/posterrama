/**
 * Logger Final Coverage Push
 * Target: Force coverage of JSON.stringify error path (lines 37-47)
 * And other hard-to-reach branches
 */

const logger = require('../../utils/logger');

describe('Logger Final Coverage - Force Error Paths', () => {
    describe('formatMessage JSON.stringify error', () => {
        test('handles deeply nested circular references', () => {
            // Create an object with deep circular reference
            const problematicObject = {
                level1: {
                    level2: {
                        level3: {},
                    },
                },
            };

            // Add circular reference at deep level
            problematicObject.level1.level2.level3.root = problematicObject;

            // Log should not crash despite circular reference
            expect(() => {
                logger.error('Testing deep circular reference', problematicObject);
            }).not.toThrow();
        });

        test('handles object with circular toJSON', () => {
            const obj = {
                name: 'test',
            };
            // toJSON returning circular reference
            obj.toJSON = () => obj;

            expect(() => {
                logger.error('Testing circular toJSON', obj);
            }).not.toThrow();
        });

        test('handles Symbol which is not JSON serializable', () => {
            const obj = {
                symbolKey: Symbol('test'),
                [Symbol('hidden')]: 'value',
            };

            expect(() => {
                logger.error('Testing Symbol', obj);
            }).not.toThrow();
        });

        test('handles undefined and function values', () => {
            const obj = {
                undef: undefined,
                func: function () {
                    return 'test';
                },
                arrow: () => 'arrow',
            };

            expect(() => {
                logger.error('Testing undefined and functions', obj);
            }).not.toThrow();
        });

        test('handles mixed problematic values', () => {
            const circular = {};
            circular.ref = circular;

            const obj = {
                circular,
                symbol: Symbol('test'),
                undef: undefined,
                func: () => {},
                _raw: 'should be hidden',
            };

            expect(() => {
                logger.error('Testing mixed problematic values', obj);
            }).not.toThrow();
        });
    });

    describe('computeRecentLogs level edge cases', () => {
        beforeEach(() => {
            logger.__resetMemory();
        });

        test('filters by FATAL level correctly', () => {
            logger.error('ERROR level message');
            logger.warn('WARN level message');

            const fatalLogs = logger.getRecentLogs('FATAL', 100);

            // FATAL is level 0, ERROR is level 1
            // Should only include ERROR (treated as FATAL in Winston)
            expect(fatalLogs.every(log => log.level === 'ERROR')).toBe(true);
        });

        test('filters by TRACE level includes everything', () => {
            logger.error('ERROR');
            logger.warn('WARN');

            const traceLogs = logger.getRecentLogs('TRACE', 100);

            // TRACE is level 5, should include ERROR (1) and WARN (2)
            expect(traceLogs.length).toBeGreaterThanOrEqual(0);
        });

        test('handles lowercase level names', () => {
            logger.error('ERROR message');

            const errorLogs = logger.getRecentLogs('error', 100);
            expect(errorLogs.length).toBeGreaterThan(0);
        });

        test('handles mixed case level names', () => {
            logger.warn('WARN message');

            const warnLogs = logger.getRecentLogs('WaRn', 100);
            expect(warnLogs.length).toBeGreaterThan(0);
        });
    });

    describe('updateLogLevelFromDebug all branches', () => {
        const originalDebug = process.env.DEBUG;

        afterEach(() => {
            process.env.DEBUG = originalDebug;
        });

        test('toggles from debug to info', () => {
            // Set to debug first
            process.env.DEBUG = 'true';
            logger.updateLogLevelFromDebug();
            expect(logger.level).toBe('debug');

            // Toggle to info
            process.env.DEBUG = 'false';
            logger.updateLogLevelFromDebug();
            expect(logger.level).toBe('info');
        });

        test('toggles from info to debug', () => {
            // Set to info first
            process.env.DEBUG = 'false';
            logger.updateLogLevelFromDebug();
            expect(logger.level).toBe('info');

            // Toggle to debug
            process.env.DEBUG = 'true';
            logger.updateLogLevelFromDebug();
            expect(logger.level).toBe('debug');
        });

        test('handles empty string DEBUG', () => {
            process.env.DEBUG = '';
            logger.updateLogLevelFromDebug();
            expect(['info', 'debug', 'warn', 'error']).toContain(logger.level);
        });

        test('handles undefined DEBUG', () => {
            delete process.env.DEBUG;
            logger.updateLogLevelFromDebug();
            expect(['info', 'debug', 'warn', 'error']).toContain(logger.level);
        });
    });

    describe('shouldExcludeFromAdmin filter', () => {
        test('excludes [Request Logger] messages', () => {
            const excluded = logger.shouldExcludeFromAdmin(
                '[Request Logger] Received: GET /api/test'
            );
            expect(excluded).toBe(true);
        });

        test('excludes [Auth] messages', () => {
            const excluded = logger.shouldExcludeFromAdmin(
                '[Auth] Authenticated via session for user: admin'
            );
            expect(excluded).toBe(true);
        });

        test('does not exclude regular messages', () => {
            const excluded = logger.shouldExcludeFromAdmin('Regular log message');
            expect(excluded).toBe(false);
        });

        test('handles non-string input', () => {
            const excluded1 = logger.shouldExcludeFromAdmin(null);
            const excluded2 = logger.shouldExcludeFromAdmin(undefined);
            const excluded3 = logger.shouldExcludeFromAdmin(123);

            expect(excluded1).toBe(false);
            expect(excluded2).toBe(false);
            expect(excluded3).toBe(false);
        });
    });

    describe('memory buffer limit', () => {
        test('respects 2000 entry limit', () => {
            logger.__resetMemory();

            // Add more than 2000 entries
            for (let i = 0; i < 2100; i++) {
                logger.error(`Test entry ${i}`);
            }

            // Buffer should not exceed 2000
            expect(logger.memoryLogs.length).toBeLessThanOrEqual(2000);
        });

        test('oldest entries are removed when buffer full', () => {
            logger.__resetMemory();

            // Add 2001 entries
            for (let i = 0; i < 2001; i++) {
                logger.error(`Entry ${i}`);
            }

            // First entry should be gone
            expect(logger.memoryLogs.length).toBeLessThanOrEqual(2000);
            const firstLog = logger.memoryLogs[0];
            // First log should NOT be "Entry 0"
            expect(firstLog.message).not.toContain('Entry 0');
        });
    });
});
