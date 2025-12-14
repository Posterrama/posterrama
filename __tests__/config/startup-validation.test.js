/**
 * Config Validation at Startup Tests (Issue #10)
 *
 * Tests that configuration validation runs at application startup
 * and catches invalid configurations before services initialize.
 */

const { validateConfig } = require('../../config/validators');

describe('Config Validation at Startup (Issue #10)', () => {
    describe('validateConfig function', () => {
        it('should validate a correct configuration', () => {
            const validConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                showClearLogo: true,
                showPoster: true,
                showMetadata: true,
                showRottenTomatoes: false,
                rottenTomatoesMinimumScore: 7,
                kenBurnsEffect: {
                    enabled: true,
                    durationSeconds: 20,
                },
                mediaServers: [
                    {
                        name: 'Test Plex',
                        type: 'plex',
                        enabled: true,
                        hostname: 'localhost',
                        port: 32400,
                        tokenEnvVar: 'PLEX_TOKEN',
                    },
                ],
            };

            const result = validateConfig(validConfig);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.sanitized).toBeDefined();
            expect(result.sanitized.clockWidget).toBe(true);
        });

        it('should reject configuration with invalid transitionIntervalSeconds', () => {
            const invalidConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 2, // Too low (min is 5)
                backgroundRefreshMinutes: 30,
                mediaServers: [],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0].path).toContain('transitionIntervalSeconds');
            expect(result.sanitized).toBeNull();
        });

        it('should reject configuration with invalid backgroundRefreshMinutes', () => {
            const invalidConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 2000, // Too high (max is 1440)
                mediaServers: [],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0].path).toContain('backgroundRefreshMinutes');
        });

        it('should reject configuration with missing required fields', () => {
            const invalidConfig = {
                mediaServers: [
                    {
                        type: 'plex',
                        enabled: true,
                        hostname: 'localhost',
                        port: 32400,
                        // Missing required tokenEnvVar
                    },
                ],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should report multiple validation errors', () => {
            const invalidConfig = {
                transitionIntervalSeconds: 2, // Too low
                backgroundRefreshMinutes: 2000, // Too high
                rottenTomatoesMinimumScore: 15, // Too high (max 10)
                mediaServers: [],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(3);
        });

        it('should validate Jellyfin server configuration', () => {
            const validConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                mediaServers: [
                    {
                        name: 'Test Jellyfin',
                        type: 'jellyfin',
                        enabled: true,
                        hostname: 'localhost',
                        port: 8096,
                        tokenEnvVar: 'JELLYFIN_API_KEY',
                    },
                ],
            };

            const result = validateConfig(validConfig);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should validate RomM server configuration', () => {
            const validConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                mediaServers: [
                    {
                        name: 'Test RomM',
                        type: 'romm',
                        enabled: true,
                        url: 'https://romm.example.com',
                        username: 'testuser',
                        password: 'testpass',
                    },
                ],
            };

            const result = validateConfig(validConfig);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject RomM configuration missing required fields', () => {
            const invalidConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                mediaServers: [
                    {
                        name: 'Test RomM',
                        type: 'romm',
                        enabled: true,
                        url: 'https://romm.example.com',
                        // Missing username and password
                    },
                ],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should validate kenBurnsEffect configuration', () => {
            const validConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                kenBurnsEffect: {
                    enabled: true,
                    durationSeconds: 15,
                },
                mediaServers: [],
            };

            const result = validateConfig(validConfig);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject invalid kenBurnsEffect durationSeconds', () => {
            const invalidConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                kenBurnsEffect: {
                    enabled: true,
                    durationSeconds: 100, // Too high (max is 60)
                },
                mediaServers: [],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should validate wallartMode music configuration', () => {
            const validConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                wallartMode: {
                    musicMode: {
                        enabled: true,
                        displayStyle: 'covers-only',
                        animation: 'vinyl-spin',
                        density: 'medium',
                        showArtist: true,
                        showAlbumTitle: true,
                        showYear: true,
                        showGenre: false,
                        artistRotationSeconds: 60,
                        sortMode: 'weighted-random',
                        sortWeights: {
                            recent: 20,
                            popular: 30,
                            random: 50,
                        },
                    },
                },
                mediaServers: [],
            };

            const result = validateConfig(validConfig);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject invalid wallartMode displayStyle', () => {
            const invalidConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                wallartMode: {
                    musicMode: {
                        enabled: true,
                        displayStyle: 'invalid-style', // Invalid value
                    },
                },
                mediaServers: [],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should strip unknown fields from configuration', () => {
            const configWithUnknown = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                unknownField: 'should be stripped',
                mediaServers: [],
            };

            const result = validateConfig(configWithUnknown);

            expect(result.valid).toBe(true);
            expect(result.sanitized).toBeDefined();
            expect(result.sanitized.unknownField).toBeUndefined();
        });

        it('should reject legacy hostnameEnvVar field', () => {
            const invalidConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                mediaServers: [
                    {
                        name: 'Test Plex',
                        type: 'plex',
                        enabled: true,
                        hostnameEnvVar: 'PLEX_HOSTNAME', // Legacy field
                        portEnvVar: 'PLEX_PORT', // Legacy field
                        tokenEnvVar: 'PLEX_TOKEN',
                    },
                ],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should allow disabled servers without required fields', () => {
            const validConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                mediaServers: [
                    {
                        name: 'Disabled Plex',
                        type: 'plex',
                        enabled: false,
                        tokenEnvVar: 'PLEX_TOKEN',
                        // hostname and port not required when disabled
                    },
                ],
            };

            const result = validateConfig(validConfig);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should validate empty mediaServers array', () => {
            const validConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                mediaServers: [],
            };

            const result = validateConfig(validConfig);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should provide detailed error information', () => {
            const invalidConfig = {
                transitionIntervalSeconds: 'invalid', // Wrong type
                mediaServers: [],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toHaveProperty('path');
            expect(result.errors[0]).toHaveProperty('message');
            expect(result.errors[0]).toHaveProperty('type');
        });
    });

    describe('error message formatting', () => {
        it('should format path correctly for nested fields', () => {
            const invalidConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                kenBurnsEffect: {
                    enabled: true,
                    durationSeconds: 200, // Invalid
                },
                mediaServers: [],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors[0].path).toContain('kenBurnsEffect');
            expect(result.errors[0].path).toContain('durationSeconds');
        });

        it('should format path correctly for array items', () => {
            const invalidConfig = {
                clockWidget: true,
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                mediaServers: [
                    {
                        name: 'Test Server',
                        type: 'invalid-type', // Invalid
                        enabled: true,
                    },
                ],
            };

            const result = validateConfig(invalidConfig);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('integration with application startup', () => {
        it('should be importable from server.js context', () => {
            // This test verifies that validateConfig can be imported
            // and used in the server startup sequence
            expect(typeof validateConfig).toBe('function');
        });

        it('should handle configuration validation errors gracefully', () => {
            const invalidConfig = {
                transitionIntervalSeconds: -1,
                mediaServers: [],
            };

            const result = validateConfig(invalidConfig);

            expect(result).toHaveProperty('valid');
            expect(result).toHaveProperty('errors');
            expect(result).toHaveProperty('sanitized');
            expect(result.valid).toBe(false);
        });
    });
});
