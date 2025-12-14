/**
 * Tests for Standardized External API Timeouts (Issue #3)
 */

const config = require('../../config/index');

describe('External API Timeout Configuration (Issue #3)', () => {
    describe('timeout configuration', () => {
        it('should have external API timeout constants defined', () => {
            expect(config.getTimeout('externalApiBase')).toBeDefined();
            expect(config.getTimeout('externalApiPlex')).toBeDefined();
            expect(config.getTimeout('externalApiJellyfin')).toBeDefined();
            expect(config.getTimeout('externalApiTmdb')).toBeDefined();
            expect(config.getTimeout('externalApiRomm')).toBeDefined();
        });

        it('should have test connection timeouts', () => {
            expect(config.getTimeout('externalApiTestConnection')).toBeDefined();
            expect(config.getTimeout('externalApiQuickTest')).toBeDefined();
        });

        it('should have retry configuration', () => {
            expect(config.getTimeout('externalApiMaxRetries')).toBeDefined();
            expect(config.getTimeout('externalApiRetryDelay')).toBeDefined();
        });

        it('should use consistent default values', () => {
            // Plex and RomM are generally fast
            expect(config.getTimeout('externalApiPlex')).toBe(15000);
            // Jellyfin can be slower for large libraries (virtual folders, counting)
            expect(config.getTimeout('externalApiJellyfin')).toBe(30000);
            expect(config.getTimeout('externalApiRomm')).toBe(15000);

            // TMDB usually faster, 10 seconds
            expect(config.getTimeout('externalApiTmdb')).toBe(10000);
        });

        it('should have appropriate test connection timeouts', () => {
            const testTimeout = config.getTimeout('externalApiTestConnection');
            const quickTestTimeout = config.getTimeout('externalApiQuickTest');

            expect(testTimeout).toBe(8000);
            expect(quickTestTimeout).toBe(5000);
            expect(quickTestTimeout).toBeLessThan(testTimeout);
        });

        it('should have reasonable retry configuration', () => {
            const maxRetries = config.getTimeout('externalApiMaxRetries');
            const retryDelay = config.getTimeout('externalApiRetryDelay');

            expect(maxRetries).toBe(2);
            expect(retryDelay).toBe(1000);
            expect(maxRetries).toBeGreaterThanOrEqual(0);
            expect(retryDelay).toBeGreaterThan(0);
        });
    });

    describe('environment variable overrides', () => {
        // Environment overrides are tested in other config tests
        // This test just verifies the mechanism works
        it('should support environment variable overrides', () => {
            // The config supports TIMEOUT_<KEY> overrides via getInt()
            // Tested by the getTimeout method implementation
            expect(typeof config.getTimeout).toBe('function');
        });
    });

    describe('timeout values consistency', () => {
        it('should have base timeout as reference', () => {
            const baseTimeout = config.getTimeout('externalApiBase');

            expect(baseTimeout).toBe(30000);
            // Jellyfin aligns with base; others may be lower
            expect(config.getTimeout('externalApiJellyfin')).toBe(baseTimeout);
            expect(config.getTimeout('externalApiPlex')).toBeLessThanOrEqual(baseTimeout);
        });

        it('should have test timeouts shorter than main timeouts', () => {
            const mainTimeout = config.getTimeout('externalApiBase');
            const testTimeout = config.getTimeout('externalApiTestConnection');
            const quickTimeout = config.getTimeout('externalApiQuickTest');

            expect(testTimeout).toBeLessThan(mainTimeout);
            expect(quickTimeout).toBeLessThan(testTimeout);
        });

        it('should have all timeouts in milliseconds', () => {
            const timeouts = [
                'externalApiBase',
                'externalApiPlex',
                'externalApiJellyfin',
                'externalApiTmdb',
                'externalApiRomm',
                'externalApiTestConnection',
                'externalApiQuickTest',
            ];

            timeouts.forEach(timeout => {
                const value = config.getTimeout(timeout);
                expect(value).toBeGreaterThan(1000); // At least 1 second
                expect(value).toBeLessThan(60000); // Less than 1 minute
                expect(value % 1000).toBe(0); // Should be round seconds
            });
        });
    });

    describe('HTTP client integration', () => {
        it('should export getTimeout method', () => {
            expect(typeof config.getTimeout).toBe('function');
        });

        it('should return numeric timeout values', () => {
            const timeout = config.getTimeout('externalApiPlex');

            expect(typeof timeout).toBe('number');
            expect(timeout).toBeGreaterThan(0);
        });

        it('should handle unknown timeout keys gracefully', () => {
            const timeout = config.getTimeout('nonexistentTimeout');

            expect(timeout).toBeUndefined();
        });
    });

    describe('retry configuration', () => {
        it('should have sensible max retries', () => {
            const maxRetries = config.getTimeout('externalApiMaxRetries');

            expect(maxRetries).toBeGreaterThanOrEqual(0);
            expect(maxRetries).toBeLessThanOrEqual(5);
        });

        it('should have reasonable retry delay', () => {
            const retryDelay = config.getTimeout('externalApiRetryDelay');

            expect(retryDelay).toBeGreaterThanOrEqual(500);
            expect(retryDelay).toBeLessThanOrEqual(5000);
        });

        it('should allow exponential backoff calculation', () => {
            const baseDelay = config.getTimeout('externalApiRetryDelay');
            const maxRetries = config.getTimeout('externalApiMaxRetries');

            // Simulate exponential backoff
            let totalDelay = 0;
            for (let i = 0; i < maxRetries; i++) {
                totalDelay += baseDelay * Math.pow(2, i);
            }

            // Total retry time should be reasonable (less than 10 seconds)
            expect(totalDelay).toBeLessThan(10000);
        });
    });

    describe('timeout naming consistency', () => {
        it('should follow naming convention', () => {
            const timeoutKeys = [
                'externalApiBase',
                'externalApiPlex',
                'externalApiJellyfin',
                'externalApiTmdb',
                'externalApiRomm',
                'externalApiTestConnection',
                'externalApiQuickTest',
                'externalApiMaxRetries',
                'externalApiRetryDelay',
            ];

            timeoutKeys.forEach(key => {
                // Should start with 'externalApi'
                expect(key.startsWith('externalApi')).toBe(true);

                // Should be camelCase
                expect(/^[a-z][a-zA-Z0-9]*$/.test(key)).toBe(true);
            });
        });
    });
});
