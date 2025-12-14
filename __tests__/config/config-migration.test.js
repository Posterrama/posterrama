/**
 * Config Migration Tests
 *
 * Tests the migrateConfig function that automatically repairs
 * and migrates old/invalid configurations to valid ones.
 */

const { migrateConfig } = require('../../config/validate-env');

describe('Config Migration', () => {
    describe('backgroundRefreshMinutes migration', () => {
        it('should add backgroundRefreshMinutes with default value when missing', () => {
            const config = {
                transitionIntervalSeconds: 10,
                mediaServers: [],
            };

            const modified = migrateConfig(config);

            expect(modified).toBe(true);
            expect(config.backgroundRefreshMinutes).toBe(60);
        });

        it('should not modify config if backgroundRefreshMinutes already exists', () => {
            const config = {
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 30,
                mediaServers: [],
            };

            // migrateConfig modifies other things too, so we just check the value stays
            migrateConfig(config);

            expect(config.backgroundRefreshMinutes).toBe(30);
        });

        it('should fix invalid backgroundRefreshMinutes value (too low)', () => {
            const config = {
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 2, // Below minimum of 5
                mediaServers: [],
            };

            const modified = migrateConfig(config);

            expect(modified).toBe(true);
            expect(config.backgroundRefreshMinutes).toBe(60);
        });

        it('should fix invalid backgroundRefreshMinutes value (wrong type)', () => {
            const config = {
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 'invalid',
                mediaServers: [],
            };

            const modified = migrateConfig(config);

            expect(modified).toBe(true);
            expect(config.backgroundRefreshMinutes).toBe(60);
        });

        it('should preserve valid backgroundRefreshMinutes values', () => {
            const testValues = [5, 30, 60, 120, 1440];

            for (const value of testValues) {
                const config = {
                    transitionIntervalSeconds: 10,
                    backgroundRefreshMinutes: value,
                    mediaServers: [],
                };

                migrateConfig(config);

                expect(config.backgroundRefreshMinutes).toBe(value);
            }
        });
    });

    describe('cinema object migration', () => {
        it('should create cinema object if missing', () => {
            const config = {
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 60,
                mediaServers: [],
            };

            const modified = migrateConfig(config);

            expect(modified).toBe(true);
            expect(config.cinema).toBeDefined();
            expect(typeof config.cinema).toBe('object');
        });

        it('should fix invalid cinema orientation', () => {
            const config = {
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 60,
                mediaServers: [],
                cinema: {
                    orientation: 'invalid-orientation',
                },
            };

            const modified = migrateConfig(config);

            expect(modified).toBe(true);
            expect(config.cinema.orientation).toBe('auto');
        });
    });

    describe('globalEffects migration', () => {
        it('should create globalEffects object if missing', () => {
            const config = {
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 60,
                mediaServers: [],
                cinema: {},
            };

            const modified = migrateConfig(config);

            expect(modified).toBe(true);
            expect(config.cinema.globalEffects).toBeDefined();
        });

        it('should fix invalid colorFilter value', () => {
            const config = {
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 60,
                mediaServers: [],
                cinema: {
                    globalEffects: {
                        colorFilter: 'invalid-filter',
                    },
                },
            };

            const modified = migrateConfig(config);

            expect(modified).toBe(true);
            expect(config.cinema.globalEffects.colorFilter).toBe('none');
        });
    });
});
