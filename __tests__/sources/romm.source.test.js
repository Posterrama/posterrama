/**
 * Tests for RomM Source
 */

const RommSource = require('../../sources/romm');
const logger = require('../../utils/logger');

// Mock dependencies
jest.mock('../../utils/logger');
jest.mock('../../utils/romm-http-client');

describe('RommSource', () => {
    let rommSource;
    let mockClient;
    let mockServerConfig;
    let mockShuffleArray;
    const RommHttpClient = require('../../utils/romm-http-client');

    beforeEach(() => {
        jest.clearAllMocks();

        mockServerConfig = {
            name: 'TestRomM',
            url: 'http://localhost:8080',
            username: 'testuser',
            password: 'testpass',
            selectedPlatforms: ['n64', 'switch'],
            filters: {
                favouritesOnly: false,
                playableOnly: false,
                excludeUnidentified: false,
            },
        };

        mockShuffleArray = jest.fn(arr => arr);

        mockClient = {
            authenticate: jest.fn().mockResolvedValue(true),
            getRoms: jest.fn(),
            getPlatforms: jest.fn().mockResolvedValue([
                { id: 1, slug: 'n64', display_name: 'Nintendo 64' },
                { id: 2, slug: 'switch', display_name: 'Nintendo Switch' },
            ]),
            testConnection: jest.fn().mockResolvedValue(true),
        };

        RommHttpClient.mockImplementation(() => mockClient);

        rommSource = new RommSource(mockServerConfig, mockShuffleArray, false);
    });

    describe('Constructor', () => {
        it('should initialize with correct configuration', () => {
            expect(rommSource.server).toBe(mockServerConfig);
            expect(rommSource.shuffleArray).toBe(mockShuffleArray);
            expect(rommSource.isDebug).toBe(false);
        });

        it('should initialize metrics', () => {
            expect(rommSource.metrics).toEqual({
                requestCount: 0,
                itemsProcessed: 0,
                itemsFiltered: 0,
                averageProcessingTime: 0,
                lastRequestTime: null,
                errorCount: 0,
            });
        });
    });

    describe('getClient', () => {
        it('should create and authenticate client on first call', async () => {
            const client = await rommSource.getClient();
            expect(RommHttpClient).toHaveBeenCalled();
            expect(mockClient.authenticate).toHaveBeenCalled();
            expect(client).toBe(mockClient);
        });

        it('should return cached client on subsequent calls', async () => {
            await rommSource.getClient();
            await rommSource.getClient();
            expect(RommHttpClient).toHaveBeenCalledTimes(1);
            expect(mockClient.authenticate).toHaveBeenCalledTimes(1);
        });
    });

    describe('getMetrics', () => {
        it('should return metrics with filter efficiency', () => {
            rommSource.metrics.itemsProcessed = 100;
            rommSource.metrics.itemsFiltered = 20;

            const metrics = rommSource.getMetrics();

            expect(metrics.filterEfficiency).toBe(0.2);
        });

        it('should handle zero items processed', () => {
            const metrics = rommSource.getMetrics();
            expect(metrics.filterEfficiency).toBe(0);
        });
    });

    describe('resetMetrics', () => {
        it('should reset all metrics to zero', () => {
            rommSource.metrics.requestCount = 10;
            rommSource.metrics.errorCount = 5;

            rommSource.resetMetrics();

            expect(rommSource.metrics.requestCount).toBe(0);
            expect(rommSource.metrics.errorCount).toBe(0);
        });
    });

    describe('getAvailablePlatforms', () => {
        it('should fetch and format platforms', async () => {
            mockClient.getPlatforms.mockResolvedValueOnce([
                {
                    id: 1,
                    slug: 'n64',
                    name: 'Nintendo 64',
                    display_name: 'Nintendo 64',
                    rom_count: 100,
                },
                {
                    id: 2,
                    slug: 'switch',
                    name: 'Switch',
                    rom_count: 200,
                },
            ]);

            const platforms = await rommSource.getAvailablePlatforms();

            expect(platforms).toEqual([
                { id: 1, slug: 'n64', name: 'Nintendo 64', romCount: 100 },
                { id: 2, slug: 'switch', name: 'Switch', romCount: 200 },
            ]);
        });

        it('should handle errors gracefully', async () => {
            mockClient.getPlatforms.mockRejectedValueOnce(new Error('API error'));

            const platforms = await rommSource.getAvailablePlatforms();

            expect(platforms).toEqual([]);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('processRomItem', () => {
        it('should process ROM with full metadata', () => {
            const rom = {
                id: 1,
                name: 'Super Mario 64',
                slug: 'super-mario-64',
                summary: 'Classic platformer',
                platform_id: 3,
                platform_slug: 'n64',
                platform_name: 'Nintendo 64',
                igdb_id: 1074,
                sgdb_id: 5219,
                moby_id: 2533,
                fs_size_bytes: 8388608,
                fs_name: 'Super Mario 64.z64',
                igdb_metadata: {
                    total_rating: 94.2,
                    genres: ['Platform'],
                    franchises: ['Super Mario'],
                },
                moby_metadata: {
                    moby_score: 9.2,
                    genres: ['Action'],
                },
                launchbox_metadata: {
                    community_rating: 9.3,
                    max_players: 1,
                },
            };

            const result = rommSource.processRomItem(rom);

            expect(result.id).toContain('romm_TestRomM_1');
            expect(result.title).toBe('Super Mario 64');
            expect(result.platform).toBe('Nintendo 64');
            expect(result.igdbId).toBe(1074);
            expect(result.fileSize).toBe(8388608);
            expect(result.igdbMetadata.totalRating).toBe(94.2);
            expect(result.mobyMetadata.mobyScore).toBe(9.2);
            expect(result.launchboxMetadata.communityRating).toBe(9.3);
        });

        it('should handle ROM without metadata', () => {
            const rom = {
                id: 2,
                name: 'Unknown Game',
                platform_slug: 'gba',
                platform_name: 'Game Boy Advance',
            };

            const result = rommSource.processRomItem(rom);

            expect(result.title).toBe('Unknown Game');
            expect(result.igdbMetadata).toBeNull();
            expect(result.mobyMetadata).toBeNull();
        });
    });

    describe('fetchMedia', () => {
        it('should fetch ROMs from selected platforms', async () => {
            mockClient.getRoms.mockResolvedValue({
                items: [
                    {
                        id: 1,
                        name: 'Game 1',
                        platform_slug: 'n64',
                        platform_name: 'Nintendo 64',
                    },
                    {
                        id: 2,
                        name: 'Game 2',
                        platform_slug: 'n64',
                        platform_name: 'Nintendo 64',
                    },
                ],
            });

            const result = await rommSource.fetchMedia(['n64'], 'game', 10);

            expect(mockClient.getRoms).toHaveBeenCalled();
            expect(result.length).toBeGreaterThan(0);
            expect(result[0].title).toBe('Game 1');
        });

        it('should handle pagination', async () => {
            mockClient.getRoms
                .mockResolvedValueOnce({
                    items: new Array(500).fill(null).map((_, i) => ({
                        id: i + 1,
                        name: `Game ${i + 1}`,
                        platform_slug: 'n64',
                        platform_name: 'Nintendo 64',
                    })),
                })
                .mockResolvedValueOnce({
                    items: new Array(100).fill(null).map((_, i) => ({
                        id: i + 501,
                        name: `Game ${i + 501}`,
                        platform_slug: 'n64',
                        platform_name: 'Nintendo 64',
                    })),
                });

            const result = await rommSource.fetchMedia(['n64'], 'game', 50);

            expect(mockClient.getRoms).toHaveBeenCalled();
            expect(result).toHaveLength(50);
        });

        it('should reject non-game types', async () => {
            const result = await rommSource.fetchMedia(['n64'], 'movie', 10);

            expect(result).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should handle empty platforms', async () => {
            const result = await rommSource.fetchMedia([], 'game', 10);

            expect(result).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should update metrics', async () => {
            mockClient.getRoms.mockResolvedValue({
                items: [{ id: 1, name: 'Game', platform_slug: 'n64', platform_name: 'N64' }],
            });

            await rommSource.fetchMedia(['n64'], 'game', 10);

            expect(rommSource.metrics.requestCount).toBe(1);
            expect(rommSource.metrics.itemsProcessed).toBeGreaterThan(0);
        });
    });

    describe('testConnection', () => {
        it('should return true on successful connection', async () => {
            const result = await rommSource.testConnection();
            expect(result).toBe(true);
        });

        it('should return false on connection failure', async () => {
            mockClient.testConnection.mockRejectedValue(new Error('Connection failed'));

            const result = await rommSource.testConnection();

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('applyFilters', () => {
        it('should filter favorites only', () => {
            const roms = [
                { id: 1, rom_user: { is_favorite: true } },
                { id: 2, rom_user: { is_favorite: false } },
                { id: 3, rom_user: null },
            ];

            rommSource.server.filters = { favouritesOnly: true };

            const result = rommSource.applyFilters(roms);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(1);
        });

        it('should filter playable only', () => {
            const roms = [{ id: 1, playable: true }, { id: 2, playable: false }, { id: 3 }];

            rommSource.server.filters = { playableOnly: true };

            const result = rommSource.applyFilters(roms);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(1);
        });

        it('should exclude unidentified', () => {
            const roms = [
                { id: 1, is_identified: true },
                { id: 2, is_identified: false },
                { id: 3 },
            ];

            rommSource.server.filters = { excludeUnidentified: true };

            const result = rommSource.applyFilters(roms);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(1);
        });

        it('should handle missing filters config', () => {
            const roms = [{ id: 1 }, { id: 2 }];
            rommSource.server.filters = null;

            const result = rommSource.applyFilters(roms);

            expect(result).toHaveLength(2);
        });
    });

    describe('fetchMedia error handling', () => {
        beforeEach(() => {
            mockClient.getPlatforms.mockResolvedValue([
                { id: 1, slug: 'n64', display_name: 'Nintendo 64' },
            ]);
        });

        it('should handle platform fetch errors gracefully', async () => {
            mockClient.getRoms.mockRejectedValue(new Error('Platform API error'));

            const result = await rommSource.fetchMedia(['n64'], 'game', 10);

            expect(result).toEqual([]);
            expect(rommSource.metrics.errorCount).toBeGreaterThan(0);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should handle invalid response format', async () => {
            mockClient.getRoms.mockResolvedValue({ items: null });

            const result = await rommSource.fetchMedia(['n64'], 'game', 10);

            expect(result).toEqual([]);
        });

        it('should log debug info when fetching ROMs', async () => {
            rommSource.isDebug = true;
            mockClient.getRoms.mockResolvedValue({
                items: [{ id: 1, name: 'Game', platform_slug: 'n64', platform_name: 'N64' }],
            });

            await rommSource.fetchMedia(['n64'], 'game', 10);

            expect(logger.debug).toHaveBeenCalled();
        });
    });
});
