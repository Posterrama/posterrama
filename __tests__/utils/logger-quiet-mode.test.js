/**
 * Tests for QUIET_TEST_LOGS behavior in utils/logger.js
 */

describe('logger quiet test mode', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
    });

    test('defaults to warn in test when QUIET_TEST_LOGS not set', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.QUIET_TEST_LOGS;
        const logger = require('../../utils/logger');
        expect(logger.level).toBe('warn');
    });

    test('clamps to error level when QUIET_TEST_LOGS=1', () => {
        process.env.NODE_ENV = 'test';
        process.env.QUIET_TEST_LOGS = '1';
        const logger = require('../../utils/logger');
        expect(logger.level).toBe('error');
    });
});
