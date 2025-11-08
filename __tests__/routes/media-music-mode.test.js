/**
 * @file __tests__/routes/media-music-mode.test.js
 * Tests for music mode integration in /get-media endpoint
 */

const request = require('supertest');
const PlexSource = require('../../sources/plex');

// Mock PlexSource
jest.mock('../../sources/plex');

describe('GET /get-media - Music Mode', () => {
    let app;
    let originalConfig;

    beforeAll(() => {
        // Save original config
        originalConfig = require('../../config.json');

        // Mock config with music mode enabled
        jest.mock('../../config.json', () => ({
            ...originalConfig,
            wallartMode: {
                ...originalConfig.wallartMode,
                musicMode: {
                    enabled: true,
                    displayStyle: 'albumCover',
                    gridSize: '3x3',
                },
            },
            mediaServers: [
                {
                    type: 'plex',
                    enabled: true,
                    name: 'Test Plex',
                    musicLibraryNames: ['Music'],
                    musicFilters: {
                        genres: ['Rock', 'Jazz'],
                        minRating: 7.0,
                    },
                },
            ],
        }));

        app = require('../../server');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should return music albums when musicMode=1 and music mode is enabled', async () => {
        const mockAlbums = [
            {
                key: 'plex-album-1',
                type: 'music',
                title: 'Abbey Road',
                artist: 'The Beatles',
                album: 'Abbey Road',
                year: 1969,
                genres: ['Rock'],
                posterUrl: '/library/metadata/1/thumb',
                source: 'plex',
            },
            {
                key: 'plex-album-2',
                type: 'music',
                title: 'Kind of Blue',
                artist: 'Miles Davis',
                album: 'Kind of Blue',
                year: 1959,
                genres: ['Jazz'],
                posterUrl: '/library/metadata/2/thumb',
                source: 'plex',
            },
        ];

        // Mock fetchMusic method
        PlexSource.prototype.fetchMusic = jest.fn().mockResolvedValue(mockAlbums);

        const response = await request(app).get('/get-media?musicMode=1').expect(200);

        expect(response.body).toEqual(mockAlbums);
        expect(PlexSource.prototype.fetchMusic).toHaveBeenCalledWith(
            ['Music'],
            50, // default count
            expect.objectContaining({
                genres: ['Rock', 'Jazz'],
                minRating: 7.0,
            })
        );
    });

    test('should respect custom count parameter for music mode', async () => {
        PlexSource.prototype.fetchMusic = jest.fn().mockResolvedValue([]);

        await request(app).get('/get-media?musicMode=1&count=100').expect(200);

        expect(PlexSource.prototype.fetchMusic).toHaveBeenCalledWith(
            expect.any(Array),
            100,
            expect.any(Object)
        );
    });

    test('should return empty array when no Plex server is configured', async () => {
        // Temporarily override config
        const configModule = require('../../config.json');
        const originalServers = configModule.mediaServers;
        configModule.mediaServers = [];

        const response = await request(app).get('/get-media?musicMode=1').expect(200);

        expect(response.body).toEqual([]);

        // Restore
        configModule.mediaServers = originalServers;
    });

    test('should return empty array when no music libraries are configured', async () => {
        // Mock server without music libraries
        const configModule = require('../../config.json');
        const originalServers = configModule.mediaServers;
        configModule.mediaServers = [
            {
                type: 'plex',
                enabled: true,
                name: 'Test Plex',
                musicLibraryNames: [],
            },
        ];

        const response = await request(app).get('/get-media?musicMode=1').expect(200);

        expect(response.body).toEqual([]);

        // Restore
        configModule.mediaServers = originalServers;
    });

    test('should fall back to regular media on music fetch error', async () => {
        PlexSource.prototype.fetchMusic = jest.fn().mockRejectedValue(new Error('Plex API error'));

        // Should not throw, should fall back to regular playlist
        const response = await request(app).get('/get-media?musicMode=1').expect(200);

        // Should return whatever is in the regular playlist cache
        expect(Array.isArray(response.body)).toBe(true);
    });

    test('should not activate music mode when musicMode parameter is missing', async () => {
        PlexSource.prototype.fetchMusic = jest.fn().mockResolvedValue([]);

        await request(app).get('/get-media').expect(200);

        // fetchMusic should not be called
        expect(PlexSource.prototype.fetchMusic).not.toHaveBeenCalled();
    });

    test('should not activate music mode when music mode is disabled in config', async () => {
        // Temporarily disable music mode
        const configModule = require('../../config.json');
        const originalMusicMode = configModule.wallartMode?.musicMode;
        if (configModule.wallartMode) {
            configModule.wallartMode.musicMode = { enabled: false };
        }

        PlexSource.prototype.fetchMusic = jest.fn().mockResolvedValue([]);

        await request(app).get('/get-media?musicMode=1').expect(200);

        // fetchMusic should not be called
        expect(PlexSource.prototype.fetchMusic).not.toHaveBeenCalled();

        // Restore
        if (configModule.wallartMode) {
            configModule.wallartMode.musicMode = originalMusicMode;
        }
    });
});
