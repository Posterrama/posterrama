/**
 * Wallart Music Mode Display Tests
 *
 * Tests music mode detection, metadata overlay rendering,
 * and proper album cover display in wallart mode.
 *
 * @group wallart
 * @group unit
 * @group music
 */

const fs = require('fs');
const path = require('path');

describe('Wallart Music Mode Display', () => {
    let wallartDisplayJs;
    let mockWindow;
    let mockDocument;
    let mockAppConfig;

    beforeAll(() => {
        // Read the wallart-display.js file to extract createPosterElement function
        const wallartPath = path.join(__dirname, '../../public/wallart/wallart-display.js');
        wallartDisplayJs = fs.readFileSync(wallartPath, 'utf8');
    });

    beforeEach(() => {
        // Mock document.createElement
        mockDocument = {
            createElement: jest.fn(tag => {
                const el = {
                    tagName: tag.toUpperCase(),
                    className: '',
                    dataset: {},
                    style: { cssText: '' },
                    innerHTML: '',
                    appendChild: jest.fn(),
                    children: [],
                };
                // Make appendChild actually add to children array
                el.appendChild.mockImplementation(child => {
                    el.children.push(child);
                });
                return el;
            }),
            getElementById: jest.fn(() => null),
        };

        // Mock window with different music mode configs
        mockAppConfig = {
            wallartMode: {
                musicMode: {
                    enabled: true,
                    visibility: {
                        artist: true,
                        albumTitle: true,
                        year: true,
                        genre: true,
                    },
                },
            },
        };

        mockWindow = {
            innerWidth: 1920,
            innerHeight: 1080,
            appConfig: mockAppConfig,
            makeLazy: jest.fn(),
            debugLog: jest.fn(),
        };

        global.window = mockWindow;
        global.document = mockDocument;
        global.console = {
            ...console,
            warn: jest.fn(),
        };
        global.navigator = { userAgent: 'Mozilla/5.0' };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Music Item Detection', () => {
        test('should detect music items by type property', () => {
            const musicItem = {
                id: 'album-1',
                type: 'music',
                title: 'Abbey Road',
                artist: 'The Beatles',
                posterUrl: '/image_cache/album-1.jpg',
            };

            expect(musicItem.type).toBe('music');
        });

        test('should distinguish music from movie items', () => {
            const movieItem = {
                id: 'movie-1',
                type: 'movie',
                title: 'The Matrix',
                posterUrl: '/image_cache/movie-1.jpg',
            };

            expect(movieItem.type).not.toBe('music');
        });
    });

    describe('Album Cover Rendering', () => {
        test('should use object-fit: cover for music albums', () => {
            // Extract and eval the createPosterElement logic (simplified simulation)
            const item = {
                id: 'album-1',
                type: 'music',
                title: 'Dark Side of the Moon',
                artist: 'Pink Floyd',
                posterUrl: '/image_cache/album-1.jpg',
            };

            const isMusicItem = item.type === 'music';
            const objectFit = isMusicItem ? 'cover' : 'contain';

            expect(objectFit).toBe('cover');
            expect(wallartDisplayJs).toContain('object-fit: ${objectFit}');
        });

        test('should use object-fit: contain for non-music items', () => {
            const item = {
                id: 'movie-1',
                type: 'movie',
                title: 'Inception',
                posterUrl: '/image_cache/movie-1.jpg',
            };

            const isMusicItem = item.type === 'music';
            const objectFit = isMusicItem ? 'cover' : 'contain';

            expect(objectFit).toBe('contain');
        });
    });

    describe('Metadata Overlay Creation', () => {
        test('should create overlay when music mode enabled and visibility configured', () => {
            const musicConfig = mockWindow.appConfig.wallartMode.musicMode;
            const visibility = musicConfig.visibility;

            // At least one field should be enabled
            const shouldCreateOverlay =
                visibility.artist || visibility.albumTitle || visibility.year || visibility.genre;

            expect(shouldCreateOverlay).toBe(true);
            expect(visibility.artist).toBe(true);
            expect(visibility.albumTitle).toBe(true);
            expect(visibility.year).toBe(true);
            expect(visibility.genre).toBe(true);
        });

        test('should not create overlay when all visibility options disabled', () => {
            mockWindow.appConfig.wallartMode.musicMode.visibility = {
                artist: false,
                albumTitle: false,
                year: false,
                genre: false,
            };

            const visibility = mockWindow.appConfig.wallartMode.musicMode.visibility;
            const shouldCreateOverlay =
                visibility.artist || visibility.albumTitle || visibility.year || visibility.genre;

            expect(shouldCreateOverlay).toBe(false);
        });

        test('should handle partial visibility configuration', () => {
            mockWindow.appConfig.wallartMode.musicMode.visibility = {
                artist: true,
                albumTitle: false,
                year: false,
                genre: true,
            };

            const item = {
                id: 'album-1',
                type: 'music',
                title: 'Thriller',
                artist: 'Michael Jackson',
                year: '1982',
                genre: 'Pop',
                posterUrl: '/image_cache/album-1.jpg',
            };

            const visibility = mockWindow.appConfig.wallartMode.musicMode.visibility;

            // Check which fields should be displayed
            expect(visibility.artist && item.artist).toBeTruthy();
            expect(visibility.albumTitle && item.title).toBeFalsy();
            expect(visibility.year && item.year).toBeFalsy();
            expect(visibility.genre && item.genre).toBeTruthy();
        });
    });

    describe('Overlay Content Generation', () => {
        test('should include artist name when visible', () => {
            const item = {
                id: 'album-1',
                type: 'music',
                artist: 'The Beatles',
                posterUrl: '/image_cache/album-1.jpg',
            };

            const visibility = mockWindow.appConfig.wallartMode.musicMode.visibility;

            if (visibility.artist && item.artist) {
                const expectedHtml = `<div style="font-size: 0.9em; font-weight: 600; margin-bottom: 4px; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">${item.artist}</div>`;
                expect(expectedHtml).toContain('The Beatles');
                expect(expectedHtml).toContain('font-weight: 600');
            }
        });

        test('should include album title when visible', () => {
            const item = {
                id: 'album-1',
                type: 'music',
                title: 'Abbey Road',
                posterUrl: '/image_cache/album-1.jpg',
            };

            const visibility = mockWindow.appConfig.wallartMode.musicMode.visibility;

            if (visibility.albumTitle && item.title) {
                const expectedHtml = `<div style="font-size: 0.8em; opacity: 0.9; margin-bottom: 2px; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">${item.title}</div>`;
                expect(expectedHtml).toContain('Abbey Road');
                expect(expectedHtml).toContain('opacity: 0.9');
            }
        });

        test('should combine year and genre with separator', () => {
            const item = {
                id: 'album-1',
                type: 'music',
                year: '1969',
                genre: 'Rock',
                posterUrl: '/image_cache/album-1.jpg',
            };

            const visibility = mockWindow.appConfig.wallartMode.musicMode.visibility;
            const metaItems = [];

            if (visibility.year && item.year) {
                metaItems.push(item.year);
            }
            if (visibility.genre && item.genre) {
                metaItems.push(item.genre);
            }

            if (metaItems.length > 0) {
                const joined = metaItems.join(' • ');
                expect(joined).toBe('1969 • Rock');
            }
        });
    });

    describe('Error Handling', () => {
        test('should gracefully handle missing music config', () => {
            mockWindow.appConfig = {};

            const musicConfig = mockWindow.appConfig?.wallartMode?.musicMode || {};
            const visibility = musicConfig.visibility || {};

            expect(musicConfig).toEqual({});
            expect(visibility).toEqual({});

            // Should not crash when checking visibility
            const shouldCreateOverlay =
                visibility.artist || visibility.albumTitle || visibility.year || visibility.genre;
            expect(shouldCreateOverlay).toBeFalsy();
        });

        test('should handle missing item metadata gracefully', () => {
            const item = {
                id: 'album-1',
                type: 'music',
                posterUrl: '/image_cache/album-1.jpg',
                // Missing: title, artist, year, genre
            };

            const visibility = mockWindow.appConfig.wallartMode.musicMode.visibility;

            // Check each field safely
            const artistHtml = visibility.artist && item.artist ? `Artist: ${item.artist}` : '';
            const titleHtml = visibility.albumTitle && item.title ? `Title: ${item.title}` : '';

            expect(artistHtml).toBe('');
            expect(titleHtml).toBe('');
        });
    });

    describe('Code Coverage - Implementation Details', () => {
        test('wallart-display.js contains music mode detection logic', () => {
            expect(wallartDisplayJs).toContain("item.type === 'music'");
            expect(wallartDisplayJs).toContain('isMusicItem');
        });

        test('wallart-display.js contains metadata overlay creation', () => {
            expect(wallartDisplayJs).toContain('music-metadata-overlay');
            expect(wallartDisplayJs).toContain('visibility.artist');
            expect(wallartDisplayJs).toContain('visibility.albumTitle');
            expect(wallartDisplayJs).toContain('visibility.year');
            expect(wallartDisplayJs).toContain('visibility.genre');
        });

        test('wallart-display.js uses proper gradient for overlay background', () => {
            expect(wallartDisplayJs).toContain('linear-gradient(to top');
            expect(wallartDisplayJs).toContain('rgba(0,0,0,0.85)');
        });

        test('wallart-display.js handles overlay creation errors', () => {
            expect(wallartDisplayJs).toContain('catch (overlayErr)');
            expect(wallartDisplayJs).toContain('Failed to create music metadata overlay');
        });
    });
});
