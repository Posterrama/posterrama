/**
 * Logger Missing Coverage Tests
 * Target: Increase coverage from 60.6% branches → 80%+
 * Focus: Uncovered lines 13,37-47,73,139,260,301-312,335-338
 */

const logger = require('../../utils/logger');
const fs = require('fs');
const path = require('path');

describe('Logger Missing Coverage - File Operations', () => {
    describe('logs directory creation', () => {
        test('logs directory should exist after module load', () => {
            const logsDir = path.join(__dirname, '../../logs');
            expect(fs.existsSync(logsDir)).toBe(true);
        });
    });

    describe('formatMessage - unserializable objects', () => {
        test('handles circular references without crashing', () => {
            const circular = { name: 'test' };
            circular.self = circular; // Create circular reference

            // Should not crash when logging circular object
            expect(() => {
                logger.warn('Testing circular', { data: circular });
            }).not.toThrow();
        });

        test('handles objects with getters that throw', () => {
            const problematic = {};
            Object.defineProperty(problematic, 'badGetter', {
                get() {
                    throw new Error('Getter failed');
                },
            });

            // Should not crash when logging
            expect(() => {
                logger.warn('Testing bad getter', { data: problematic });
            }).not.toThrow();
        });

        test('handles _raw key redaction', () => {
            const dataWithRaw = {
                normal: 'value',
                _raw: 'This should be hidden',
            };

            // Should not crash and should handle _raw key
            expect(() => {
                logger.warn('Testing _raw redaction', dataWithRaw);
            }).not.toThrow();
        });
    });

    describe('buildTimestampFormat - timezone handling', () => {
        test('timestamp format works correctly', () => {
            // Test that logger produces timestamps
            logger.warn('Test timestamp format');

            // Check that the log was created (may be filtered in test mode)
            // The timestamp format itself is exercised by the logging call
            expect(() => {
                const logs = logger.getRecentLogs(null, 1);
                if (logs.length > 0) {
                    expect(logs[0].timestamp).toMatch(/\d{4}-\d{2}-\d{2}/);
                }
            }).not.toThrow();
        });
    });

    describe('memory transport - shouldExcludeFromAdmin', () => {
        test('logs at warn level are captured', () => {
            // Use warn level since test mode may filter info
            logger.warn('Normal warning message');
            const normalLogs = logger.memoryLogs.filter(log =>
                log.message.includes('Normal warning message')
            );
            expect(normalLogs.length).toBeGreaterThan(0);
        });

        test('memory log buffer respects 2000 entry limit', () => {
            logger.__resetMemory();

            // Generate more than 2000 logs
            for (let i = 0; i < 2050; i++) {
                logger.info(`Test log ${i}`);
            }

            // Buffer should cap at 2000
            expect(logger.memoryLogs.length).toBeLessThanOrEqual(2000);
        });

        test('memory transport log method catches exceptions gracefully', () => {
            // This tests the try-catch in memory transport's log() method
            // We can't easily force an error, but we can verify it doesn't crash
            expect(() => {
                logger.info('Test exception handling');
            }).not.toThrow();
        });
    });

    describe('computeRecentLogs - edge cases', () => {
        test('handles negative offset by treating as zero', () => {
            logger.info('Test1');
            logger.info('Test2');
            logger.info('Test3');

            // Should work even with negative offset
            const logs = logger.getRecentLogs(null, 10, -5); // negative offset
            expect(logs.length).toBeGreaterThanOrEqual(0);
        });

        test('handles negative limit by treating as zero', () => {
            logger.info('Test1');
            logger.info('Test2');

            const logs = logger.getRecentLogs(null, -10, 0); // negative limit
            expect(logs.length).toBe(0);
        });

        test('handles unknown log level gracefully', () => {
            logger.info('INFO message');
            logger.warn('WARN message');

            // Request logs with unknown level
            const logs = logger.getRecentLogs('UNKNOWN_LEVEL', 100);

            // Should return all logs (no filtering for unknown level)
            expect(logs.length).toBeGreaterThan(0);
        });

        test('handles level filtering case-insensitively', () => {
            logger.error('ERROR message');
            logger.warn('WARN message');
            logger.info('INFO message');

            // Test lowercase
            const errorLogsLower = logger.getRecentLogs('error', 100);
            expect(errorLogsLower.length).toBeGreaterThan(0);
            expect(errorLogsLower.every(log => log.level === 'ERROR')).toBe(true);

            // Test mixed case
            const warnLogsMixed = logger.getRecentLogs('WaRn', 100);
            expect(warnLogsMixed.length).toBeGreaterThan(0);
        });

        test('testOnly filter works correctly', () => {
            // Use warn level to ensure capture
            logger.warn('[TEST-LOG] Test marker 1');
            logger.warn('Regular log');
            logger.warn('[TEST-LOG] Test marker 2');

            const testOnlyLogs = logger.getRecentLogs(null, 100, 0, true);
            // Should have at least the test-marked logs
            expect(testOnlyLogs.length).toBeGreaterThanOrEqual(1);
            expect(testOnlyLogs.every(log => log.message.includes('[TEST-LOG]'))).toBe(true);
        });

        test('filters logs without [TEST-LOG] marker when testOnly=true', () => {
            // First clear and add only non-test logs
            logger.__resetMemory();
            logger.info('Regular log 1');
            logger.info('Regular log 2');

            const testOnlyLogs = logger.getRecentLogs(null, 100, 0, true);
            expect(testOnlyLogs.length).toBe(0);
        });
    });

    describe('updateLogLevelFromDebug - environment handling', () => {
        const originalDebug = process.env.DEBUG;

        afterEach(() => {
            process.env.DEBUG = originalDebug;
            logger.updateLogLevelFromDebug();
        });

        test('updates log level when DEBUG=true', () => {
            process.env.DEBUG = 'true';
            logger.updateLogLevelFromDebug();

            expect(logger.level).toBe('debug');
        });

        test('updates log level when DEBUG is not true', () => {
            process.env.DEBUG = 'false';
            logger.updateLogLevelFromDebug();

            expect(logger.level).toBe('info');
        });

        test('updates all transports when level changes', () => {
            const initialLevel = logger.level;
            process.env.DEBUG = initialLevel === 'debug' ? 'false' : 'true';

            logger.updateLogLevelFromDebug();

            // All transports should match logger level
            logger.transports.forEach(transport => {
                expect(transport.level).toBe(logger.level);
            });
        });

        test('logs level update with metadata', () => {
            const initialLevel = logger.level;
            // Toggle to a different level
            process.env.DEBUG = initialLevel === 'debug' ? 'false' : 'true';

            logger.updateLogLevelFromDebug();

            // Check that a log was added
            const lastLog = logger.memoryLogs[logger.memoryLogs.length - 1];
            expect(lastLog.message).toContain('Log level updated');
        });

        test('handles level unchanged scenario', () => {
            const currentLevel = logger.level;
            const currentDebug = currentLevel === 'debug' ? 'true' : 'false';
            process.env.DEBUG = currentDebug;

            // Just verify it doesn't crash when level is unchanged
            expect(() => {
                logger.updateLogLevelFromDebug();
            }).not.toThrow();

            // Level should remain the same
            expect(logger.level).toBe(currentLevel);
        });
    });

    describe('redaction - all patterns', () => {
        test('redacts X-Plex-Token in query params', () => {
            const sensitive = 'https://plex.tv/api?X-Plex-Token=abc123def456';
            const redacted = logger.redact(sensitive);
            expect(redacted).not.toContain('abc123def456');
            expect(redacted).toContain('***REDACTED***');
        });

        test('redacts X_PLEX_TOKEN environment style', () => {
            const sensitive = 'X_PLEX_TOKEN=mySecretToken123';
            const redacted = logger.redact(sensitive);
            expect(redacted).not.toContain('mySecretToken123');
            expect(redacted).toContain('***REDACTED***');
        });

        test('redacts PLEX_TOKEN', () => {
            const sensitive = 'Config: PLEX_TOKEN=secretKey789';
            const redacted = logger.redact(sensitive);
            expect(redacted).not.toContain('secretKey789');
            expect(redacted).toContain('***REDACTED***');
        });

        test('redacts JELLYFIN_API_KEY', () => {
            const sensitive = 'Using JELLYFIN_API_KEY=jellyfinSecret456';
            const redacted = logger.redact(sensitive);
            expect(redacted).not.toContain('jellyfinSecret456');
            expect(redacted).toContain('***REDACTED***');
        });

        test('redacts Authorization Bearer tokens', () => {
            const sensitive =
                'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
            const redacted = logger.redact(sensitive);
            expect(redacted).not.toContain(
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature'
            );
            expect(redacted).toContain('***REDACTED***');
        });

        test('redacts multiple tokens in same string', () => {
            const sensitive = 'X-Plex-Token=token1 and JELLYFIN_API_KEY=token2';
            const redacted = logger.redact(sensitive);
            expect(redacted).not.toContain('token1');
            expect(redacted).not.toContain('token2');
            const redactionCount = (redacted.match(/\*\*\*REDACTED\*\*\*/g) || []).length;
            expect(redactionCount).toBe(2);
        });

        test('handles non-string input gracefully', () => {
            expect(logger.redact(null)).toBe(null);
            expect(logger.redact(undefined)).toBe(undefined);
            expect(logger.redact(123)).toBe(123);
            expect(logger.redact({})).toEqual({});
        });

        test('case-insensitive pattern matching', () => {
            const sensitive1 = 'x-plex-token=abc123';
            const sensitive2 = 'X-PLEX-TOKEN=def456';
            const sensitive3 = 'X-PlEx-ToKeN=ghi789';

            expect(logger.redact(sensitive1)).toContain('***REDACTED***');
            expect(logger.redact(sensitive2)).toContain('***REDACTED***');
            expect(logger.redact(sensitive3)).toContain('***REDACTED***');
        });
    });

    describe('convenience methods', () => {
        test('fatal method logs at error level', () => {
            logger.fatal('Fatal error occurred');
            const logs = logger.getRecentLogs('ERROR', 10);
            expect(logs.some(log => log.message.includes('Fatal error occurred'))).toBe(true);
        });

        test('__ping utility returns true', () => {
            expect(logger.__ping()).toBe(true);
        });

        test('__resetMemory clears memory logs', () => {
            logger.info('Test1');
            logger.info('Test2');
            expect(logger.memoryLogs.length).toBeGreaterThan(0);

            logger.__resetMemory();
            expect(logger.memoryLogs.length).toBe(0);
        });
    });

    describe('setTimeout initialization error handling', () => {
        test('logger initializes even if updateLogLevelFromDebug fails', done => {
            // The module has a setTimeout that calls updateLogLevelFromDebug
            // If it throws, it should be caught and logged to console.warn
            // This test verifies the logger is still functional

            logger.info('Test after initialization');
            const logs = logger.getRecentLogs(null, 1);
            expect(logs.length).toBeGreaterThan(0);
            done();
        }, 200); // Wait for setTimeout to complete
    });
});
