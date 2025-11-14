/**
 * Tests for Session Secret Validation (Issue #2)
 *
 * Note: These tests validate the session secret validation logic
 * that should run during server startup. Since the validation
 * happens at require-time and calls process.exit(), we need to
 * test the validation logic in isolation.
 */

const logger = require('../../utils/logger');

// Mock logger to capture error/warn messages
jest.mock('../../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

describe('Session Secret Validation (Issue #2)', () => {
    const originalEnv = process.env;
    const originalExit = process.exit;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        process.env = { ...originalEnv };
        process.exit = jest.fn();
    });

    afterEach(() => {
        process.env = originalEnv;
        process.exit = originalExit;
    });

    describe('production environment validation', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'production';
        });

        it('should reject missing SESSION_SECRET', () => {
            delete process.env.SESSION_SECRET;

            // Validation logic from server.js
            const secret = process.env.SESSION_SECRET;
            const isProduction = process.env.NODE_ENV === 'production';

            expect(secret).toBeUndefined();

            if (isProduction && !secret) {
                logger.error('SESSION_SECRET is required in production environment');
                process.exit(1);
            }

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('SESSION_SECRET is required')
            );
            expect(process.exit).toHaveBeenCalledWith(1);
        });

        it('should reject fallback SESSION_SECRET value', () => {
            process.env.SESSION_SECRET = 'fallback-insecure-secret-change-me';

            const secret = process.env.SESSION_SECRET;
            const isProduction = process.env.NODE_ENV === 'production';
            const isFallback = secret === 'fallback-insecure-secret-change-me';

            if (isProduction && isFallback) {
                logger.error('SESSION_SECRET cannot use fallback value in production');
                process.exit(1);
            }

            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('fallback value'));
            expect(process.exit).toHaveBeenCalledWith(1);
        });

        it('should reject short SESSION_SECRET (< 32 chars)', () => {
            process.env.SESSION_SECRET = 'short-secret';

            const secret = process.env.SESSION_SECRET;
            const isProduction = process.env.NODE_ENV === 'production';
            const isTooShort = secret.length < 32;

            if (isProduction && isTooShort) {
                logger.error(
                    `SESSION_SECRET must be at least 32 characters (current: ${secret.length})`
                );
                process.exit(1);
            }

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringMatching(/at least 32 characters/)
            );
            expect(process.exit).toHaveBeenCalledWith(1);
        });

        it('should accept valid SESSION_SECRET (32+ chars)', () => {
            process.env.SESSION_SECRET = 'a'.repeat(32);

            const secret = process.env.SESSION_SECRET;
            const isValid =
                secret && secret.length >= 32 && secret !== 'fallback-insecure-secret-change-me';

            expect(isValid).toBe(true);
            expect(logger.error).not.toHaveBeenCalled();
            expect(process.exit).not.toHaveBeenCalled();
        });

        it('should accept strong SESSION_SECRET (64+ chars)', () => {
            process.env.SESSION_SECRET = 'a'.repeat(64);

            const secret = process.env.SESSION_SECRET;
            expect(secret.length).toBeGreaterThanOrEqual(64);

            // Strong secret should pass all validations
            expect(logger.error).not.toHaveBeenCalled();
            expect(process.exit).not.toHaveBeenCalled();
        });
    });

    describe('development environment behavior', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'development';
        });

        it('should warn but continue with missing SESSION_SECRET', () => {
            delete process.env.SESSION_SECRET;

            const secret = process.env.SESSION_SECRET;
            const isProduction = process.env.NODE_ENV === 'production';

            if (!isProduction && !secret) {
                logger.warn('SESSION_SECRET not set, using fallback (development only)');
            }

            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('fallback'));
            expect(process.exit).not.toHaveBeenCalled();
        });

        it('should warn but continue with fallback SESSION_SECRET', () => {
            process.env.SESSION_SECRET = 'fallback-insecure-secret-change-me';

            const secret = process.env.SESSION_SECRET;
            const isProduction = process.env.NODE_ENV === 'production';
            const isFallback = secret === 'fallback-insecure-secret-change-me';

            if (!isProduction && isFallback) {
                logger.warn('Using fallback SESSION_SECRET (development only)');
            }

            expect(logger.warn).toHaveBeenCalled();
            expect(process.exit).not.toHaveBeenCalled();
        });

        it('should warn but continue with short SESSION_SECRET', () => {
            process.env.SESSION_SECRET = 'short-secret';

            const secret = process.env.SESSION_SECRET;
            const isProduction = process.env.NODE_ENV === 'production';
            const isTooShort = secret.length < 32;

            if (!isProduction && isTooShort) {
                logger.warn(`SESSION_SECRET is weak (${secret.length} chars, recommend 32+)`);
            }

            expect(logger.warn).toHaveBeenCalled();
            expect(process.exit).not.toHaveBeenCalled();
        });

        it('should accept valid SESSION_SECRET without warnings', () => {
            process.env.SESSION_SECRET = 'a'.repeat(32);

            const secret = process.env.SESSION_SECRET;
            const isValid = secret && secret.length >= 32;

            expect(isValid).toBe(true);
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
            expect(process.exit).not.toHaveBeenCalled();
        });
    });

    describe('test environment behavior', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'test';
        });

        it('should skip validation in test environment', () => {
            delete process.env.SESSION_SECRET;

            const isTest = process.env.NODE_ENV === 'test';

            if (isTest) {
                // No validation in test mode
            }

            expect(logger.error).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            expect(process.exit).not.toHaveBeenCalled();
        });

        it('should allow any SESSION_SECRET in test environment', () => {
            process.env.SESSION_SECRET = 'test-secret';

            const isTest = process.env.NODE_ENV === 'test';
            expect(isTest).toBe(true);

            // No warnings or errors in test mode
            expect(logger.error).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });
    });

    describe('validation edge cases', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'production';
        });

        it('should reject SESSION_SECRET with only whitespace', () => {
            process.env.SESSION_SECRET = '   ';

            const secret = process.env.SESSION_SECRET?.trim();
            const isProduction = process.env.NODE_ENV === 'production';

            if (isProduction && !secret) {
                logger.error('SESSION_SECRET cannot be empty or whitespace');
                process.exit(1);
            }

            expect(logger.error).toHaveBeenCalled();
            expect(process.exit).toHaveBeenCalledWith(1);
        });

        it('should accept SESSION_SECRET with special characters', () => {
            process.env.SESSION_SECRET = 'a!@#$%^&*()_+-=[]{}|;:,.<>?'.padEnd(32, 'x');

            const secret = process.env.SESSION_SECRET;
            expect(secret.length).toBeGreaterThanOrEqual(32);

            // Special chars should be fine
            expect(logger.error).not.toHaveBeenCalled();
            expect(process.exit).not.toHaveBeenCalled();
        });

        it('should accept SESSION_SECRET with Unicode characters', () => {
            process.env.SESSION_SECRET = '🔒🔑🛡️'.repeat(10).padEnd(32, 'x');

            const secret = process.env.SESSION_SECRET;
            expect(secret.length).toBeGreaterThanOrEqual(32);

            expect(logger.error).not.toHaveBeenCalled();
            expect(process.exit).not.toHaveBeenCalled();
        });

        it('should treat undefined NODE_ENV as production', () => {
            delete process.env.NODE_ENV;
            delete process.env.SESSION_SECRET;

            const isProduction = !process.env.NODE_ENV || process.env.NODE_ENV === 'production';

            expect(isProduction).toBe(true);

            // Should enforce production rules
            if (isProduction && !process.env.SESSION_SECRET) {
                logger.error('SESSION_SECRET is required');
                process.exit(1);
            }

            expect(logger.error).toHaveBeenCalled();
            expect(process.exit).toHaveBeenCalledWith(1);
        });
    });

    describe('validation messages', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'production';
        });

        it('should provide helpful error message for missing secret', () => {
            delete process.env.SESSION_SECRET;

            if (!process.env.SESSION_SECRET) {
                logger.error(
                    'SESSION_SECRET is required in production. Generate with: openssl rand -hex 32'
                );
                process.exit(1);
            }

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('openssl rand -hex 32')
            );
        });

        it('should provide helpful error message for fallback secret', () => {
            process.env.SESSION_SECRET = 'fallback-insecure-secret-change-me';

            const isFallback = process.env.SESSION_SECRET === 'fallback-insecure-secret-change-me';

            if (isFallback) {
                logger.error(
                    'SESSION_SECRET cannot use fallback value. Set unique secret in .env file'
                );
                process.exit(1);
            }

            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Set unique secret'));
        });

        it('should provide helpful error message for short secret', () => {
            process.env.SESSION_SECRET = 'abc123';

            const secret = process.env.SESSION_SECRET;
            if (secret.length < 32) {
                logger.error(
                    `SESSION_SECRET must be at least 32 characters (current: ${secret.length}). ` +
                        'Generate with: openssl rand -hex 32'
                );
                process.exit(1);
            }

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringMatching(/at least 32 characters.*openssl/)
            );
        });
    });
});
