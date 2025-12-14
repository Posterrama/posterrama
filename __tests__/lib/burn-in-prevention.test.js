/**
 * Tests for lib/burn-in-prevention.js
 */

const burnInPrevention = require('../../lib/burn-in-prevention');

describe('burn-in-prevention', () => {
    describe('DEFAULTS', () => {
        it('should have correct default structure', () => {
            const defaults = burnInPrevention.DEFAULTS;

            expect(defaults.enabled).toBe(false);
            expect(defaults.level).toBe('subtle');
            expect(defaults.pixelShift).toBeDefined();
            expect(defaults.elementCycling).toBeDefined();
            expect(defaults.screenRefresh).toBeDefined();
        });

        it('should have valid pixelShift defaults', () => {
            const { pixelShift } = burnInPrevention.DEFAULTS;

            expect(pixelShift.enabled).toBe(true);
            expect(pixelShift.amount).toBe(2);
            expect(pixelShift.intervalMs).toBe(180000); // 3 minutes
        });

        it('should have valid elementCycling defaults', () => {
            const { elementCycling } = burnInPrevention.DEFAULTS;

            expect(elementCycling.enabled).toBe(true);
            expect(elementCycling.intervalMs).toBe(300000); // 5 minutes
            expect(elementCycling.fadeMs).toBe(500);
        });

        it('should have valid screenRefresh defaults', () => {
            const { screenRefresh } = burnInPrevention.DEFAULTS;

            expect(screenRefresh.enabled).toBe(false);
            expect(screenRefresh.type).toBe('blackout');
            expect(screenRefresh.intervalMs).toBe(3600000); // 1 hour
        });
    });

    describe('LEVEL_PRESETS', () => {
        it('should have subtle, moderate, and aggressive presets', () => {
            const presets = burnInPrevention.LEVEL_PRESETS;

            expect(presets.subtle).toBeDefined();
            expect(presets.moderate).toBeDefined();
            expect(presets.aggressive).toBeDefined();
        });

        it('subtle preset should have minimal settings', () => {
            const { subtle } = burnInPrevention.LEVEL_PRESETS;

            expect(subtle.pixelShift.amount).toBe(1);
            expect(subtle.pixelShift.intervalMs).toBe(300000); // 5 min
            expect(subtle.elementCycling.enabled).toBe(false);
            expect(subtle.screenRefresh.enabled).toBe(false);
        });

        it('aggressive preset should have maximum settings', () => {
            const { aggressive } = burnInPrevention.LEVEL_PRESETS;

            expect(aggressive.pixelShift.amount).toBe(3);
            expect(aggressive.pixelShift.intervalMs).toBe(60000); // 1 min
            expect(aggressive.elementCycling.enabled).toBe(true);
            expect(aggressive.screenRefresh.enabled).toBe(true);
        });
    });

    describe('resolveConfig', () => {
        it('should return disabled config when input is null', () => {
            const result = burnInPrevention.resolveConfig(null);

            expect(result.enabled).toBe(false);
        });

        it('should return disabled config when input is undefined', () => {
            const result = burnInPrevention.resolveConfig(undefined);

            expect(result.enabled).toBe(false);
        });

        it('should return disabled config when enabled is false', () => {
            const result = burnInPrevention.resolveConfig({ enabled: false });

            expect(result.enabled).toBe(false);
        });

        it('should apply level preset when enabled', () => {
            const result = burnInPrevention.resolveConfig({
                enabled: true,
                level: 'aggressive',
            });

            expect(result.enabled).toBe(true);
            expect(result.level).toBe('aggressive');
            expect(result.pixelShift.amount).toBe(3);
            expect(result.screenRefresh.enabled).toBe(true);
        });

        it('should merge user overrides with preset', () => {
            const result = burnInPrevention.resolveConfig({
                enabled: true,
                level: 'subtle',
                pixelShift: {
                    amount: 5,
                },
            });

            expect(result.pixelShift.amount).toBe(5);
            expect(result.pixelShift.enabled).toBe(true); // From preset
        });

        it('should default to subtle level when not specified', () => {
            const result = burnInPrevention.resolveConfig({
                enabled: true,
            });

            expect(result.level).toBe('subtle');
        });
    });

    describe('validateConfig', () => {
        it('should validate correct config', () => {
            const result = burnInPrevention.validateConfig({
                enabled: true,
                level: 'moderate',
            });

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject invalid level', () => {
            const result = burnInPrevention.validateConfig({
                enabled: true,
                level: 'invalid',
            });

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('Invalid level');
        });

        it('should reject pixelShift.amount out of range', () => {
            const result = burnInPrevention.validateConfig({
                enabled: true,
                pixelShift: { amount: 20 },
            });

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('amount');
        });

        it('should reject pixelShift.intervalMs too low', () => {
            const result = burnInPrevention.validateConfig({
                enabled: true,
                pixelShift: { intervalMs: 1000 },
            });

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('intervalMs');
        });

        it('should reject elementCycling.intervalMs too low', () => {
            const result = burnInPrevention.validateConfig({
                enabled: true,
                elementCycling: { intervalMs: 1000 },
            });

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('intervalMs');
        });

        it('should reject invalid screenRefresh.type', () => {
            const result = burnInPrevention.validateConfig({
                enabled: true,
                screenRefresh: { type: 'invalid' },
            });

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('type');
        });

        it('should return error for non-object input', () => {
            const result = burnInPrevention.validateConfig('invalid');

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('must be an object');
        });

        it('should return error for null input', () => {
            const result = burnInPrevention.validateConfig(null);

            expect(result.valid).toBe(false);
        });
    });

    describe('getClientConfig', () => {
        it('should return client-safe configuration', () => {
            const fullConfig = {
                burnInPrevention: {
                    enabled: true,
                    level: 'moderate',
                },
            };

            const result = burnInPrevention.getClientConfig(fullConfig);

            expect(result.enabled).toBe(true);
            expect(result.level).toBe('moderate');
            expect(result.pixelShift).toBeDefined();
            expect(result.elementCycling).toBeDefined();
            expect(result.screenRefresh).toBeDefined();
        });

        it('should handle missing burnInPrevention section', () => {
            const result = burnInPrevention.getClientConfig({});

            expect(result.enabled).toBe(false);
        });

        it('should handle null config', () => {
            const result = burnInPrevention.getClientConfig(null);

            expect(result.enabled).toBe(false);
        });
    });

    describe('logStatus', () => {
        // Note: logStatus just logs, so we mainly test it doesn't throw
        it('should not throw when config is disabled', () => {
            expect(() => {
                burnInPrevention.logStatus({ burnInPrevention: { enabled: false } });
            }).not.toThrow();
        });

        it('should not throw when config is enabled', () => {
            expect(() => {
                burnInPrevention.logStatus({
                    burnInPrevention: {
                        enabled: true,
                        level: 'aggressive',
                    },
                });
            }).not.toThrow();
        });

        it('should not throw when config is null', () => {
            expect(() => {
                burnInPrevention.logStatus(null);
            }).not.toThrow();
        });
    });
});
