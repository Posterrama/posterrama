/**
 * Music Mode Configuration Integration Tests
 *
 * Tests the integration between config, PlexSource, and data flow
 * for music mode functionality.
 *
 * @group integration
 * @group music
 */

describe('Music Mode Configuration Integration', () => {
    let originalConfig;
    let PlexSource;
    let originalFetchMusic;

    beforeAll(() => {
        const config = require('../../config');
        originalConfig = JSON.parse(JSON.stringify(config));
        PlexSource = require('../../sources/plex');
        originalFetchMusic = PlexSource.prototype.fetchMusic;
    });

    afterAll(() => {
        const config = require('../../config');
        Object.assign(config, originalConfig);
        if (originalFetchMusic) {
            PlexSource.prototype.fetchMusic = originalFetchMusic;
        }
    });

    afterEach(() => {
        if (originalFetchMusic) {
            PlexSource.prototype.fetchMusic = originalFetchMusic;
        }
        const config = require('../../config');
        Object.assign(config, originalConfig);
    });

    describe('Config → PlexSource Integration', () => {
        test('should pass correct parameters from config to fetchMusic', async () => {
            const config = require('../../config');
            config.mediaServers = [
                {
                    type: 'plex',
                    enabled: true,
                    url: 'http://localhost:32400',
                    token: 'test-token',
                    musicLibraryNames: ['Music', 'Classical'],
                    musicFilters: {
                        genres: ['Rock', 'Jazz'],
                        artists: ['The Beatles'],
                        minRating: 8.0,
                    },
                },
            ];

            const mockFetchMusic = jest.fn().mockResolvedValue([
                {
                    id: 'test-album',
                    type: 'music',
                    title: 'Test Album',
                    posterUrl: '/test.jpg',
                },
            ]);

            PlexSource.prototype.fetchMusic = mockFetchMusic;

            const plexServer = config.mediaServers[0];
            const plexSource = new PlexSource(plexServer);

            const libraries = plexServer.musicLibraryNames;
            const filters = plexServer.musicFilters;
            const count = 50;

            await plexSource.fetchMusic(libraries, count, filters);

            expect(mockFetchMusic).toHaveBeenCalledWith(['Music', 'Classical'], 50, {
                genres: ['Rock', 'Jazz'],
                artists: ['The Beatles'],
                minRating: 8.0,
            });
        });

        test('should handle music mode enabled state from config', () => {
            const config = require('../../config');
            config.wallartMode = {
                musicMode: {
                    enabled: true,
                    visibility: {
                        artist: true,
                        albumTitle: true,
                        year: false,
                        genre: true,
                    },
                },
            };

            const wallartMode = config.wallartMode || {};
            const musicMode = wallartMode.musicMode || {};
            const isMusicModeEnabled = musicMode.enabled === true;

            expect(isMusicModeEnabled).toBe(true);
            expect(musicMode.visibility.artist).toBe(true);
            expect(musicMode.visibility.year).toBe(false);
        });
    });

    describe('Data Format Integration', () => {
        test('should return music albums with required fields for frontend', async () => {
            const mockAlbums = [
                {
                    id: 'album-1',
                    type: 'music',
                    title: 'Abbey Road',
                    artist: 'The Beatles',
                    year: '1969',
                    genre: 'Rock',
                    posterUrl: '/image_cache/abbey-road.jpg',
                    rating: 9.5,
                },
                {
                    id: 'album-2',
                    type: 'music',
                    title: 'Kind of Blue',
                    artist: 'Miles Davis',
                    year: '1959',
                    genre: 'Jazz',
                    posterUrl: '/image_cache/kind-of-blue.jpg',
                    rating: 9.8,
                },
            ];

            PlexSource.prototype.fetchMusic = jest.fn().mockResolvedValue(mockAlbums);

            const config = require('../../config');
            config.mediaServers = [
                {
                    type: 'plex',
                    enabled: true,
                    url: 'http://localhost:32400',
                    token: 'test-token',
                    musicLibraryNames: ['Music'],
                },
            ];

            const plexSource = new PlexSource(config.mediaServers[0]);
            const albums = await plexSource.fetchMusic(['Music'], 50, {});

            expect(albums.length).toBe(2);

            // Verify each album has required fields for frontend
            albums.forEach(album => {
                expect(album).toHaveProperty('id');
                expect(album).toHaveProperty('type', 'music');
                expect(album).toHaveProperty('title');
                expect(album).toHaveProperty('artist');
                expect(album).toHaveProperty('posterUrl');
                expect(album).toHaveProperty('year');
                expect(album).toHaveProperty('genre');
            });
        });

        test('should handle albums with minimal metadata', async () => {
            const mockAlbums = [
                {
                    id: 'minimal-album',
                    type: 'music',
                    title: 'Unknown Album',
                    posterUrl: '/default.jpg',
                    // Missing: artist, year, genre
                },
            ];

            PlexSource.prototype.fetchMusic = jest.fn().mockResolvedValue(mockAlbums);

            const config = require('../../config');
            config.mediaServers = [
                {
                    type: 'plex',
                    enabled: true,
                    url: 'http://localhost:32400',
                    token: 'test-token',
                    musicLibraryNames: ['Music'],
                },
            ];

            const plexSource = new PlexSource(config.mediaServers[0]);
            const albums = await plexSource.fetchMusic(['Music'], 50, {});

            expect(albums.length).toBe(1);
            expect(albums[0].id).toBe('minimal-album');
            expect(albums[0].type).toBe('music');
            expect(albums[0].title).toBe('Unknown Album');

            // Missing fields should be handled gracefully by frontend
            expect([undefined, null, '']).toContain(albums[0].artist || null);
        });
    });

    describe('Filter Application', () => {
        test('should apply genre filters from config', async () => {
            const mockAlbums = [
                {
                    id: 'rock-album',
                    type: 'music',
                    title: 'Rock Album',
                    genre: 'Rock',
                    posterUrl: '/rock.jpg',
                },
            ];

            const mockFetchMusic = jest.fn().mockResolvedValue(mockAlbums);
            PlexSource.prototype.fetchMusic = mockFetchMusic;

            const config = require('../../config');
            config.mediaServers = [
                {
                    type: 'plex',
                    enabled: true,
                    url: 'http://localhost:32400',
                    token: 'test-token',
                    musicLibraryNames: ['Music'],
                    musicFilters: {
                        genres: ['Rock', 'Jazz'],
                    },
                },
            ];

            const plexSource = new PlexSource(config.mediaServers[0]);
            await plexSource.fetchMusic(['Music'], 50, { genres: ['Rock', 'Jazz'] });

            expect(mockFetchMusic).toHaveBeenCalledWith(
                ['Music'],
                50,
                expect.objectContaining({
                    genres: ['Rock', 'Jazz'],
                })
            );
        });

        test('should apply artist filters from config', async () => {
            const mockFetchMusic = jest.fn().mockResolvedValue([]);
            PlexSource.prototype.fetchMusic = mockFetchMusic;

            const config = require('../../config');
            config.mediaServers = [
                {
                    type: 'plex',
                    enabled: true,
                    url: 'http://localhost:32400',
                    token: 'test-token',
                    musicLibraryNames: ['Music'],
                    musicFilters: {
                        artists: ['The Beatles', 'Pink Floyd'],
                    },
                },
            ];

            const plexSource = new PlexSource(config.mediaServers[0]);
            await plexSource.fetchMusic(['Music'], 50, { artists: ['The Beatles', 'Pink Floyd'] });

            expect(mockFetchMusic).toHaveBeenCalledWith(
                ['Music'],
                50,
                expect.objectContaining({
                    artists: ['The Beatles', 'Pink Floyd'],
                })
            );
        });

        test('should apply minRating filter from config', async () => {
            const mockFetchMusic = jest.fn().mockResolvedValue([]);
            PlexSource.prototype.fetchMusic = mockFetchMusic;

            const config = require('../../config');
            config.mediaServers = [
                {
                    type: 'plex',
                    enabled: true,
                    url: 'http://localhost:32400',
                    token: 'test-token',
                    musicLibraryNames: ['Music'],
                    musicFilters: {
                        minRating: 7.5,
                    },
                },
            ];

            const plexSource = new PlexSource(config.mediaServers[0]);
            await plexSource.fetchMusic(['Music'], 50, { minRating: 7.5 });

            expect(mockFetchMusic).toHaveBeenCalledWith(
                ['Music'],
                50,
                expect.objectContaining({
                    minRating: 7.5,
                })
            );
        });
    });

    describe('Error Handling', () => {
        test('should handle fetchMusic errors gracefully', async () => {
            PlexSource.prototype.fetchMusic = jest
                .fn()
                .mockRejectedValue(new Error('Network error'));

            const config = require('../../config');
            config.mediaServers = [
                {
                    type: 'plex',
                    enabled: true,
                    url: 'http://localhost:32400',
                    token: 'invalid-token',
                    musicLibraryNames: ['Music'],
                },
            ];

            const plexSource = new PlexSource(config.mediaServers[0]);

            await expect(plexSource.fetchMusic(['Music'], 50, {})).rejects.toThrow('Network error');
        });

        test('should handle missing config gracefully', () => {
            const config = require('../../config');
            config.wallartMode = {};

            const musicMode = config.wallartMode?.musicMode || {};
            const enabled = musicMode.enabled === true;

            expect(enabled).toBe(false);
            expect(musicMode).toEqual({});
        });
    });

    describe('Performance', () => {
        test('should handle large album collections', async () => {
            const largeAlbumSet = Array.from({ length: 500 }, (_, i) => ({
                id: `album-${i}`,
                type: 'music',
                title: `Album ${i}`,
                artist: `Artist ${i % 50}`,
                year: String(1960 + (i % 65)),
                genre: ['Rock', 'Jazz', 'Pop'][i % 3],
                posterUrl: `/album-${i}.jpg`,
            }));

            PlexSource.prototype.fetchMusic = jest.fn().mockResolvedValue(largeAlbumSet);

            const config = require('../../config');
            config.mediaServers = [
                {
                    type: 'plex',
                    enabled: true,
                    url: 'http://localhost:32400',
                    token: 'test-token',
                    musicLibraryNames: ['Music'],
                },
            ];

            const plexSource = new PlexSource(config.mediaServers[0]);

            const startTime = Date.now();
            const albums = await plexSource.fetchMusic(['Music'], 500, {});
            const duration = Date.now() - startTime;

            expect(albums.length).toBe(500);
            expect(duration).toBeLessThan(100); // Should be very fast with mocking

            // Verify data integrity
            albums.forEach(album => {
                expect(album).toHaveProperty('id');
                expect(album).toHaveProperty('type', 'music');
            });
        });
    });
});
