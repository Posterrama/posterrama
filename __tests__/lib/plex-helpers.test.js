/**
 * @fileoverview Unit tests for lib/plex-helpers.js
 * @description Tests the core Plex helper functions for media processing.
 * Covers:
 * - processPlexItem: Media normalization and metadata extraction
 * - Quality resolution mapping (SD, 720p, 1080p, 4K)
 * - Genre extraction from Plex data
 * - IMDb URL extraction from GUIDs
 * - Rotten Tomatoes rating parsing
 * - Clear logo and banner extraction
 * - Cast/crew data processing
 */

describe('Plex Helpers', () => {
    let plexHelpers;
    let mockPlex;
    let mockLogger;

    beforeEach(() => {
        jest.resetModules();

        // Mock logger
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        jest.doMock('../../utils/logger', () => mockLogger);

        // Mock plex-client-ctrl
        jest.doMock('../../utils/plex-client-ctrl', () => ({
            createCompatiblePlexClient: jest.fn().mockResolvedValue({
                query: jest.fn(),
            }),
        }));

        // Load module
        plexHelpers = require('../../lib/plex-helpers');

        // Setup mock Plex client
        mockPlex = {
            query: jest.fn(),
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
        plexHelpers.clearPlexClients();
    });

    describe('createPlexClient', () => {
        it('should throw ApiError when hostname is missing', async () => {
            await expect(
                plexHelpers.createPlexClient({
                    port: 32400,
                    token: 'test-token',
                })
            ).rejects.toThrow(/missing hostname, port, or token/);
        });

        it('should throw ApiError when port is missing', async () => {
            await expect(
                plexHelpers.createPlexClient({
                    hostname: 'plex.example.com',
                    token: 'test-token',
                })
            ).rejects.toThrow(/missing hostname, port, or token/);
        });

        it('should throw ApiError when token is missing', async () => {
            await expect(
                plexHelpers.createPlexClient({
                    hostname: 'plex.example.com',
                    port: 32400,
                })
            ).rejects.toThrow(/missing hostname, port, or token/);
        });

        it('should create client with valid parameters', async () => {
            const { createCompatiblePlexClient } = require('../../utils/plex-client-ctrl');

            await plexHelpers.createPlexClient({
                hostname: 'plex.example.com',
                port: 32400,
                token: 'test-token',
                timeout: 5000,
            });

            expect(createCompatiblePlexClient).toHaveBeenCalledWith({
                hostname: 'plex.example.com',
                port: 32400,
                token: 'test-token',
                timeout: 5000,
            });
        });
    });

    describe('getPlexClient', () => {
        it('should return direct client if provided', async () => {
            const directClient = { query: jest.fn() };
            const serverConfig = {
                name: 'TestServer',
                _directClient: directClient,
            };

            const result = await plexHelpers.getPlexClient(serverConfig);

            expect(result).toBe(directClient);
        });

        it('should cache clients by server name', async () => {
            const serverConfig = {
                name: 'TestServer',
                hostname: 'plex.example.com',
                port: 32400,
                token: 'test-token',
            };

            const client1 = await plexHelpers.getPlexClient(serverConfig);
            const client2 = await plexHelpers.getPlexClient(serverConfig);

            expect(client1).toBe(client2);
        });
    });

    describe('clearPlexClients', () => {
        it('should clear specific client by name', async () => {
            const serverConfig = {
                name: 'TestServer',
                hostname: 'plex.example.com',
                port: 32400,
                token: 'test-token',
            };

            await plexHelpers.getPlexClient(serverConfig);
            plexHelpers.clearPlexClients('TestServer');

            // Next call should create a new client
            const { createCompatiblePlexClient } = require('../../utils/plex-client-ctrl');
            createCompatiblePlexClient.mockClear();

            await plexHelpers.getPlexClient(serverConfig);

            expect(createCompatiblePlexClient).toHaveBeenCalled();
        });

        it('should clear all clients when no name provided', async () => {
            const serverConfig1 = {
                name: 'Server1',
                hostname: 'plex1.example.com',
                port: 32400,
                token: 'token1',
            };
            const serverConfig2 = {
                name: 'Server2',
                hostname: 'plex2.example.com',
                port: 32400,
                token: 'token2',
            };

            await plexHelpers.getPlexClient(serverConfig1);
            await plexHelpers.getPlexClient(serverConfig2);
            plexHelpers.clearPlexClients();

            const { createCompatiblePlexClient } = require('../../utils/plex-client-ctrl');
            createCompatiblePlexClient.mockClear();

            await plexHelpers.getPlexClient(serverConfig1);
            expect(createCompatiblePlexClient).toHaveBeenCalled();
        });
    });

    describe('processPlexItem', () => {
        const serverConfig = {
            name: 'TestServer',
            type: 'plex',
        };

        it('should return null if itemSummary has no key', async () => {
            const result = await plexHelpers.processPlexItem({}, serverConfig, mockPlex);

            expect(result).toBeNull();
        });

        it('should return null if Plex returns no metadata', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: { Metadata: [] },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result).toBeNull();
        });

        it('should return null if item has no art or thumb', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            // No art or thumb
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result).toBeNull();
        });

        it('should process a valid movie item', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            year: 2023,
                            summary: 'A test movie',
                            art: '/library/metadata/123/art',
                            thumb: '/library/metadata/123/thumb',
                            contentRating: 'PG-13',
                            duration: 7200000, // 2 hours in ms
                            Media: [
                                {
                                    videoResolution: '1080',
                                },
                            ],
                            Genre: [{ tag: 'Action' }, { tag: 'Drama' }],
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result).not.toBeNull();
            expect(result.title).toBe('Test Movie');
            expect(result.year).toBe(2023);
            expect(result.key).toBe('plex-TestServer-123');
            expect(result.qualityLabel).toBe('1080p');
            expect(result.genres).toEqual(['Action', 'Drama']);
        });

        it('should extract IMDb URL from GUIDs', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            art: '/art',
                            thumb: '/thumb',
                            Guid: [
                                { id: 'tmdb://12345' },
                                { id: 'imdb://tt1234567' },
                                { id: 'tvdb://67890' },
                            ],
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result.imdbUrl).toBe('https://www.imdb.com/title/tt1234567/');
        });

        it('should extract clear logo from Image array', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            art: '/art',
                            thumb: '/thumb',
                            Image: [
                                { type: 'poster', url: '/poster' },
                                { type: 'clearLogo', url: '/clearlogo' },
                            ],
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result.clearLogoUrl).toContain(encodeURIComponent('/clearlogo'));
        });

        it('should parse Rotten Tomatoes rating data', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            art: '/art',
                            thumb: '/thumb',
                            Rating: [
                                {
                                    image: 'rottentomatoes://image/ripe',
                                    type: 'critic',
                                    value: 8.5, // 85% on 10-point scale
                                },
                            ],
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result.rottenTomatoes).toEqual({
                score: 85,
                icon: 'certified-fresh',
                originalScore: 8.5,
            });
        });

        it('should map fresh RT rating correctly', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            art: '/art',
                            thumb: '/thumb',
                            Rating: [
                                {
                                    image: 'rottentomatoes://image/ripe',
                                    type: 'critic',
                                    value: 7.0, // 70% - fresh but not certified
                                },
                            ],
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result.rottenTomatoes.icon).toBe('fresh');
            expect(result.rottenTomatoes.score).toBe(70);
        });

        it('should map rotten RT rating correctly', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            art: '/art',
                            thumb: '/thumb',
                            Rating: [
                                {
                                    image: 'rottentomatoes://image/rotten',
                                    type: 'critic',
                                    value: 4.0, // 40% - rotten
                                },
                            ],
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result.rottenTomatoes.icon).toBe('rotten');
            expect(result.rottenTomatoes.score).toBe(40);
        });

        it('should extract cast data with thumbnails', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            art: '/art',
                            thumb: '/thumb',
                            Role: [
                                { tag: 'John Actor', role: 'Lead Character', thumb: '/actor1.jpg' },
                                { tag: 'Jane Actress', role: 'Supporting', thumb: null },
                            ],
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result.cast).toHaveLength(2);
            expect(result.cast[0].name).toBe('John Actor');
            expect(result.cast[0].role).toBe('Lead Character');
            expect(result.cast[0].thumbUrl).toContain('/image?server=');
        });

        it('should extract studio data', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            art: '/art',
                            thumb: '/thumb',
                            Studio: [{ tag: 'Warner Bros' }, { tag: 'DC Films' }],
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result.studios).toEqual(['Warner Bros', 'DC Films']);
        });

        it('should generate key from server config and rating key', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '456',
                            title: 'Test Movie',
                            type: 'movie',
                            art: '/art',
                            thumb: '/thumb',
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/456' },
                serverConfig,
                mockPlex
            );

            expect(result.key).toBe('plex-TestServer-456');
        });
    });

    describe('Quality Resolution Mapping', () => {
        const serverConfig = { name: 'TestServer', type: 'plex' };

        const createMockMetadata = videoResolution => ({
            MediaContainer: {
                Metadata: [
                    {
                        ratingKey: '123',
                        title: 'Test Movie',
                        type: 'movie',
                        art: '/art',
                        thumb: '/thumb',
                        Media: [{ videoResolution }],
                    },
                ],
            },
        });

        it('should map "sd" to "SD"', async () => {
            mockPlex.query.mockResolvedValue(createMockMetadata('sd'));
            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );
            expect(result.qualityLabel).toBe('SD');
        });

        it('should map "720" to "720p"', async () => {
            mockPlex.query.mockResolvedValue(createMockMetadata('720'));
            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );
            expect(result.qualityLabel).toBe('720p');
        });

        it('should map "hd" to "720p"', async () => {
            mockPlex.query.mockResolvedValue(createMockMetadata('hd'));
            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );
            expect(result.qualityLabel).toBe('720p');
        });

        it('should map "1080" to "1080p"', async () => {
            mockPlex.query.mockResolvedValue(createMockMetadata('1080'));
            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );
            expect(result.qualityLabel).toBe('1080p');
        });

        it('should map "1080p" to "1080p"', async () => {
            mockPlex.query.mockResolvedValue(createMockMetadata('1080p'));
            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );
            expect(result.qualityLabel).toBe('1080p');
        });

        it('should map "4k" to "4K"', async () => {
            mockPlex.query.mockResolvedValue(createMockMetadata('4k'));
            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );
            expect(result.qualityLabel).toBe('4K');
        });

        it('should map "2160" to "4K"', async () => {
            mockPlex.query.mockResolvedValue(createMockMetadata('2160'));
            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );
            expect(result.qualityLabel).toBe('4K');
        });

        it('should handle missing Media array gracefully', async () => {
            mockPlex.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            art: '/art',
                            thumb: '/thumb',
                            // No Media array
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result.qualityLabel).toBeNull();
        });
    });

    describe('TV Show Processing', () => {
        const serverConfig = { name: 'TestServer', type: 'plex' };

        it('should fetch parent show data for episodes', async () => {
            // First call returns episode data
            mockPlex.query.mockResolvedValueOnce({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Episode Title',
                            type: 'episode',
                            parentKey: '/library/metadata/100', // Reference to show
                            art: '/episode/art',
                            thumb: '/episode/thumb',
                            Media: [{ videoResolution: '1080' }],
                        },
                    ],
                },
            });

            // Second call returns show data
            mockPlex.query.mockResolvedValueOnce({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '100',
                            title: 'Show Title',
                            type: 'show',
                            art: '/show/art',
                            thumb: '/show/thumb',
                            Genre: [{ tag: 'Drama' }],
                        },
                    ],
                },
            });

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            expect(result.title).toBe('Show Title');
            expect(result.backgroundUrl).toContain(encodeURIComponent('/show/art'));
            expect(result.qualityLabel).toBe('1080p'); // Should use episode's Media
        });

        it('should handle failed parent lookup gracefully', async () => {
            mockPlex.query.mockResolvedValueOnce({
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Episode Title',
                            type: 'episode',
                            parentKey: '/library/metadata/100',
                            art: '/episode/art',
                            thumb: '/episode/thumb',
                        },
                    ],
                },
            });

            // Parent lookup fails
            mockPlex.query.mockRejectedValueOnce(new Error('Not found'));

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            // Should still return something with episode data
            expect(result).not.toBeNull();
        });
    });

    describe('Error Handling', () => {
        const serverConfig = { name: 'TestServer', type: 'plex' };

        it('should handle Plex API errors gracefully', async () => {
            mockPlex.query.mockRejectedValue(new Error('Connection refused'));

            const result = await plexHelpers.processPlexItem(
                { key: '/library/metadata/123' },
                serverConfig,
                mockPlex
            );

            // Should catch error and return null or handle appropriately
            expect(result).toBeNull();
        });
    });
});
