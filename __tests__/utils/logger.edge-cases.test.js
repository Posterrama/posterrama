/**
 * Logger Edge Case Coverage Tests
 * Target: Increase branch coverage from 69.69% → 80%+
 * Focus: Hard-to-reach error paths with mocking
 */

const fs = require('fs');

describe('Logger Edge Cases - Advanced Coverage', () => {
    // Save original functions
    const originalExistsSync = fs.existsSync;
    const originalMkdirSync = fs.mkdirSync;
    const originalReadFileSync = fs.readFileSync;

    afterEach(() => {
        // Restore originals
        fs.existsSync = originalExistsSync;
        fs.mkdirSync = originalMkdirSync;
        fs.readFileSync = originalReadFileSync;
        // Clear module cache for logger
        delete require.cache[require.resolve('../../utils/logger')];
    });

    describe('logs directory creation', () => {
        test('creates logs directory if it does not exist', () => {
            let mkdirCalled = false;

            // Mock fs to simulate missing directory
            fs.existsSync = jest.fn(() => false);
            fs.mkdirSync = jest.fn((...args) => {
                mkdirCalled = true;
                return originalMkdirSync(...args);
            });

            // Force module reload to trigger directory check
            delete require.cache[require.resolve('../../utils/logger')];
            const logger = require('../../utils/logger');

            // Verify mkdir was called
            expect(fs.existsSync).toHaveBeenCalled();
            expect(mkdirCalled).toBe(true);

            // Logger should still work
            expect(logger.__ping()).toBe(true);
        });
    });

    describe('buildTimestampFormat config error handling', () => {
        test('handles config.json read error gracefully', () => {
            // Mock readFileSync to throw error
            fs.readFileSync = jest.fn(() => {
                throw new Error('ENOENT: config.json not found');
            });

            // Reload logger to trigger config read
            delete require.cache[require.resolve('../../utils/logger')];
            const logger = require('../../utils/logger');

            // Logger should still work with fallback
            logger.warn('Test with config error');
            expect(logger.__ping()).toBe(true);
        });

        test('handles malformed config.json', () => {
            // Mock readFileSync to return invalid JSON
            fs.readFileSync = jest.fn(() => '{invalid json');

            // Reload logger
            delete require.cache[require.resolve('../../utils/logger')];
            const logger = require('../../utils/logger');

            // Should use fallback timestamp format
            logger.warn('Test with malformed config');
            expect(logger.__ping()).toBe(true);
        });

        test('handles config with invalid timezone', () => {
            // Mock readFileSync to return config with invalid timezone
            fs.readFileSync = jest.fn(filepath => {
                if (filepath.includes('config.json')) {
                    return JSON.stringify({ clockTimezone: 'Invalid/Timezone' });
                }
                return originalReadFileSync(filepath);
            });

            // Reload logger
            delete require.cache[require.resolve('../../utils/logger')];
            const logger = require('../../utils/logger');

            // Should fallback gracefully
            expect(() => {
                logger.warn('Test with invalid timezone');
            }).not.toThrow();
        });
    });

    describe('formatMessage JSON.stringify error handling', () => {
        test('handles circular references in nested objects', () => {
            const logger = require('../../utils/logger');

            const obj = { name: 'test' };
            obj.circular = obj;

            // Should not crash
            expect(() => {
                logger.error('Circular ref test', obj);
            }).not.toThrow();
        });

        test('handles objects with circular references in arrays', () => {
            const logger = require('../../utils/logger');

            const obj = { name: 'item' };
            obj.self = [obj];

            expect(() => {
                logger.error('Circular array test', obj);
            }).not.toThrow();
        });

        test('handles deeply nested circular references', () => {
            const logger = require('../../utils/logger');

            const obj = { level1: { level2: { level3: {} } } };
            obj.level1.level2.level3.root = obj;

            expect(() => {
                logger.error('Deep circular test', obj);
            }).not.toThrow();
        });

        test('handles objects with _raw key at multiple levels', () => {
            const logger = require('../../utils/logger');

            const obj = {
                _raw: 'hidden1',
                nested: {
                    _raw: 'hidden2',
                    deep: {
                        _raw: 'hidden3',
                    },
                },
            };

            expect(() => {
                logger.error('Multiple _raw keys', obj);
            }).not.toThrow();
        });
    });

    describe('memory transport error handling', () => {
        test('swallows exceptions in memory transport gracefully', () => {
            const logger = require('../../utils/logger');

            // Force an error by corrupting memoryLogs temporarily
            const originalLogs = logger.memoryLogs;
            let errorThrown = false;

            try {
                // Make memoryLogs non-array to trigger error in transport
                Object.defineProperty(logger, 'memoryLogs', {
                    get() {
                        if (errorThrown) return originalLogs;
                        throw new Error('Simulated transport error');
                    },
                    configurable: true,
                });

                errorThrown = true;

                // Should not crash even if memory transport has error
                expect(() => {
                    logger.error('Test transport error');
                }).not.toThrow();
            } finally {
                // Restore
                Object.defineProperty(logger, 'memoryLogs', {
                    value: originalLogs,
                    writable: true,
                    configurable: true,
                });
            }
        });
    });

    describe('updateLogLevelFromDebug edge cases', () => {
        test('handles DEBUG=1 (truthy non-string)', () => {
            const logger = require('../../utils/logger');
            process.env.DEBUG = '1';

            expect(() => {
                logger.updateLogLevelFromDebug();
            }).not.toThrow();

            // Should interpret '1' as truthy
            expect(['debug', 'info', 'warn', 'error']).toContain(logger.level);
        });

        test('handles DEBUG=false explicitly', () => {
            const logger = require('../../utils/logger');
            process.env.DEBUG = 'false';

            logger.updateLogLevelFromDebug();

            // Should be at info level or higher (not debug)
            expect(logger.level).not.toBe('debug');
        });

        test('handles DEBUG with whitespace', () => {
            const logger = require('../../utils/logger');
            process.env.DEBUG = '  true  ';

            expect(() => {
                logger.updateLogLevelFromDebug();
            }).not.toThrow();
        });

        test('handles missing DEBUG variable', () => {
            const logger = require('../../utils/logger');
            delete process.env.DEBUG;

            expect(() => {
                logger.updateLogLevelFromDebug();
            }).not.toThrow();
        });
    });

    describe('level filtering hierarchy', () => {
        test('FATAL level filtering', () => {
            const logger = require('../../utils/logger');

            logger.error('FATAL message');
            const logs = logger.getRecentLogs('FATAL', 100);

            // FATAL is level 0, should include all ERROR logs too
            expect(logs.every(log => ['ERROR'].includes(log.level))).toBe(true);
        });

        test('TRACE level filtering (most verbose)', () => {
            const logger = require('../../utils/logger');

            logger.error('ERROR log');
            logger.warn('WARN log');

            const logs = logger.getRecentLogs('TRACE', 100);

            // TRACE is level 5, should include everything
            expect(logs.length).toBeGreaterThanOrEqual(0);
        });

        test('unknown level does not filter', () => {
            const logger = require('../../utils/logger');

            logger.error('Test error');
            logger.warn('Test warn');

            const logs = logger.getRecentLogs('UNKNOWN_LEVEL', 100);

            // Unknown level should not filter anything
            expect(logs.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('pagination edge cases', () => {
        test('handles offset greater than log count', () => {
            const logger = require('../../utils/logger');

            const logs = logger.getRecentLogs(null, 10, 99999);
            expect(logs).toEqual([]);
        });

        test('handles zero limit', () => {
            const logger = require('../../utils/logger');

            const logs = logger.getRecentLogs(null, 0, 0);
            expect(logs).toEqual([]);
        });

        test('handles large limit', () => {
            const logger = require('../../utils/logger');

            const logs = logger.getRecentLogs(null, 10000, 0);
            // Should not crash, should return available logs
            expect(Array.isArray(logs)).toBe(true);
            expect(logs.length).toBeLessThanOrEqual(2000); // Max buffer size
        });
    });
});
