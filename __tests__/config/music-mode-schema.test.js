const Ajv = require('ajv');
const fs = require('fs');
const path = require('path');

describe('Music Mode Config Schema', () => {
    let ajv, schema, musicModeSchema, mediaServerSchema;

    beforeAll(() => {
        ajv = new Ajv({ allErrors: true, strict: false });
        const schemaPath = path.resolve(__dirname, '..', '..', 'config.schema.json');
        schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        // Extract just the musicMode schema for focused testing
        musicModeSchema = schema.properties.wallartMode.properties.musicMode;
        mediaServerSchema = schema.properties.mediaServers.items;
    });

    describe('wallartMode.musicMode', () => {
        test('accepts valid music mode configuration', () => {
            const config = {
                enabled: true,
                displayStyle: 'covers-only',
                animation: 'vinyl-spin',
                gridSize: '4x4',
                layout: 'grid',
                showArtist: true,
                showAlbumTitle: true,
                showYear: true,
                showGenre: false,
            };

            const validate = ajv.compile(musicModeSchema);
            const valid = validate(config);
            expect(valid).toBe(true);
        });

        test('accepts hero-grid layout', () => {
            const config = {
                enabled: true,
                layout: 'hero-grid',
                gridSize: '4x4',
            };

            const validate = ajv.compile(musicModeSchema);
            const valid = validate(config);
            expect(valid).toBe(true);
        });

        test('accepts all display styles', () => {
            const styles = ['covers-only', 'artist-cards'];

            for (const style of styles) {
                const config = {
                    enabled: true,
                    displayStyle: style,
                };

                const validate = ajv.compile(musicModeSchema);
                const valid = validate(config);
                expect(valid).toBe(true);
            }
        });

        test('accepts all animation types', () => {
            const animations = ['vinyl-spin', 'slide-fade', 'crossfade', 'flip'];

            for (const animation of animations) {
                const config = {
                    enabled: true,
                    animation,
                };

                const validate = ajv.compile(musicModeSchema);
                const valid = validate(config);
                expect(valid).toBe(true);
            }
        });

        test('accepts all grid sizes', () => {
            const sizes = ['3x3', '4x4', '5x5', '6x6'];

            for (const gridSize of sizes) {
                const config = {
                    enabled: true,
                    gridSize,
                };

                const validate = ajv.compile(musicModeSchema);
                const valid = validate(config);
                expect(valid).toBe(true);
            }
        });

        test('rejects invalid display style', () => {
            const config = {
                enabled: true,
                displayStyle: 'invalid-style',
            };

            const validate = ajv.compile(musicModeSchema);
            const valid = validate(config);
            expect(valid).toBe(false);
        });

        test('rejects invalid grid size', () => {
            const config = {
                enabled: true,
                gridSize: '10x10',
            };

            const validate = ajv.compile(musicModeSchema);
            const valid = validate(config);
            expect(valid).toBe(false);
        });
    });

    describe('mediaServers music configuration', () => {
        test('accepts music library names for Plex server', () => {
            const config = {
                name: 'Test Plex',
                type: 'plex',
                enabled: true,
                hostname: 'localhost',
                port: 32400,
                tokenEnvVar: 'PLEX_TOKEN',
                musicLibraryNames: ['Music', 'Classical'],
            };

            const validate = ajv.compile(mediaServerSchema);
            const valid = validate(config);
            expect(valid).toBe(true);
        });

        test('accepts music filters configuration', () => {
            const config = {
                name: 'Test Plex',
                type: 'plex',
                enabled: true,
                hostname: 'localhost',
                port: 32400,
                tokenEnvVar: 'PLEX_TOKEN',
                musicFilters: {
                    genres: ['Rock', 'Jazz'],
                    artists: ['Pink Floyd', 'Miles Davis'],
                    minRating: 7.5,
                    sortWeights: {
                        recent: 20,
                        popular: 30,
                        random: 50,
                    },
                },
            };

            const validate = ajv.compile(mediaServerSchema);
            const valid = validate(config);
            expect(valid).toBe(true);
        });

        test('rejects invalid sort weight values', () => {
            const config = {
                name: 'Test Plex',
                type: 'plex',
                enabled: true,
                hostname: 'localhost',
                port: 32400,
                tokenEnvVar: 'PLEX_TOKEN',
                musicFilters: {
                    sortWeights: {
                        recent: 150, // Invalid: > 100
                        popular: 30,
                        random: 50,
                    },
                },
            };

            const validate = ajv.compile(mediaServerSchema);
            const valid = validate(config);
            expect(valid).toBe(false);
        });

        test('rejects invalid minRating value', () => {
            const config = {
                name: 'Test Plex',
                type: 'plex',
                enabled: true,
                hostname: 'localhost',
                port: 32400,
                tokenEnvVar: 'PLEX_TOKEN',
                musicFilters: {
                    minRating: 15, // Invalid: > 10
                },
            };

            const validate = ajv.compile(mediaServerSchema);
            const valid = validate(config);
            expect(valid).toBe(false);
        });
    });
});
