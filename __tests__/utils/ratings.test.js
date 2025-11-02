/**
 * Tests for Media Source Ratings Utilities
 * Target: Increase coverage from 0.93% to 70%+
 */

const {
    fetchAllJellyfinRatings,
    fetchAllPlexRatings,
    getAllSourceRatings,
    getRatingsWithCounts,
    getJellyfinQualitiesWithCounts,
} = require('../../utils/ratings');

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

describe('Media Source Ratings Utilities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('fetchAllJellyfinRatings', () => {
        it('should fetch ratings from configured Jellyfin libraries', async () => {
            const mockClient = {
                getRatings: jest.fn().mockResolvedValue(['TV-14', 'TV-MA', 'PG']),
            };

            const getJellyfinClient = jest.fn().mockResolvedValue(mockClient);

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: ['Movies'],
                showLibraryNames: ['TV Shows'],
            };

            const ratings = await fetchAllJellyfinRatings({
                serverConfig,
                getJellyfinClient,
                logger: mockLogger,
            });

            expect(ratings).toEqual(['TV-14', 'TV-MA', 'PG']);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should return empty array when no libraries configured', async () => {
            const getJellyfinClient = jest.fn();

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: [],
                showLibraryNames: [],
            };

            const ratings = await fetchAllJellyfinRatings({
                serverConfig,
                getJellyfinClient,
                logger: mockLogger,
            });

            expect(ratings).toEqual([]);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('No configured libraries found')
            );
        });

        it('should handle client errors gracefully', async () => {
            const getJellyfinClient = jest.fn().mockRejectedValue(new Error('Connection failed'));

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: ['Movies'],
            };

            const ratings = await fetchAllJellyfinRatings({
                serverConfig,
                getJellyfinClient,
                logger: mockLogger,
            });

            expect(ratings).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to fetch ratings'),
                'Connection failed'
            );
        });
    });

    describe('fetchAllPlexRatings', () => {
        it('should fetch and deduplicate ratings from Plex libraries', async () => {
            const mockClient = {
                query: jest
                    .fn()
                    .mockResolvedValueOnce({
                        MediaContainer: {
                            Metadata: [{ contentRating: 'PG' }, { contentRating: 'PG-13' }],
                        },
                    })
                    .mockResolvedValueOnce({
                        MediaContainer: {
                            Metadata: [
                                { contentRating: 'R' },
                                { contentRating: 'PG' }, // Duplicate
                            ],
                        },
                    }),
            };

            const getPlexClient = jest.fn().mockResolvedValue(mockClient);

            const serverConfig = {
                name: 'Test Plex',
                movieLibraryNames: ['Movies', 'Kids Movies'],
            };

            const ratings = await fetchAllPlexRatings({
                serverConfig,
                getPlexClient,
                logger: mockLogger,
            });

            // Should be deduplicated and sorted
            expect(ratings).toEqual(['PG', 'PG-13', 'R']);
            expect(mockClient.query).toHaveBeenCalledTimes(2);
        });

        it('should return empty array when no libraries configured', async () => {
            const getPlexClient = jest.fn();

            const serverConfig = {
                name: 'Test Plex',
                movieLibraryNames: [],
                showLibraryNames: [],
            };

            const ratings = await fetchAllPlexRatings({
                serverConfig,
                getPlexClient,
                logger: mockLogger,
            });

            expect(ratings).toEqual([]);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('No configured libraries found')
            );
        });

        it('should handle client errors gracefully', async () => {
            const getPlexClient = jest.fn().mockRejectedValue(new Error('Connection failed'));

            const serverConfig = {
                name: 'Test Plex',
                movieLibraryNames: ['Movies'],
            };

            const ratings = await fetchAllPlexRatings({
                serverConfig,
                getPlexClient,
                logger: mockLogger,
            });

            expect(ratings).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to fetch ratings'),
                'Connection failed'
            );
        });

        it('should filter out empty ratings', async () => {
            const mockClient = {
                query: jest.fn().mockResolvedValue({
                    MediaContainer: {
                        Metadata: [
                            { contentRating: 'PG' },
                            { contentRating: '' },
                            { contentRating: null },
                            {},
                        ],
                    },
                }),
            };

            const getPlexClient = jest.fn().mockResolvedValue(mockClient);

            const serverConfig = {
                name: 'Test Plex',
                movieLibraryNames: ['Movies'],
            };

            const ratings = await fetchAllPlexRatings({
                serverConfig,
                getPlexClient,
                logger: mockLogger,
            });

            expect(ratings).toEqual(['PG']);
        });
    });

    describe('getAllSourceRatings', () => {
        it('should fetch ratings from all configured media servers', async () => {
            const mockJellyfinClient = {
                getRatings: jest.fn().mockResolvedValue(['TV-14', 'TV-MA']),
            };

            const mockPlexClient = {
                query: jest.fn().mockResolvedValue({
                    MediaContainer: {
                        Metadata: [{ contentRating: 'PG' }],
                    },
                }),
            };

            const getJellyfinClient = jest.fn().mockResolvedValue(mockJellyfinClient);
            const getPlexClient = jest.fn().mockResolvedValue(mockPlexClient);

            const config = {
                mediaServers: [
                    {
                        type: 'jellyfin',
                        name: 'Test Jellyfin',
                        enabled: true,
                        movieLibraryNames: ['Movies'],
                    },
                    {
                        type: 'plex',
                        name: 'Test Plex',
                        enabled: true,
                        movieLibraryNames: ['Movies'],
                    },
                ],
            };

            const ratings = await getAllSourceRatings({
                config,
                getJellyfinClient,
                getPlexClient,
                logger: mockLogger,
            });

            expect(ratings).toEqual(['PG', 'TV-14', 'TV-MA']);
        });

        it('should skip disabled servers', async () => {
            const config = {
                mediaServers: [
                    {
                        type: 'plex',
                        name: 'Disabled Plex',
                        enabled: false,
                        movieLibraryNames: ['Movies'],
                    },
                ],
            };

            const ratings = await getAllSourceRatings({
                config,
                getJellyfinClient: jest.fn(),
                getPlexClient: jest.fn(),
                logger: mockLogger,
            });

            expect(ratings).toEqual([]);
        });

        it('should handle unknown server types', async () => {
            const config = {
                mediaServers: [
                    {
                        type: 'unknown',
                        name: 'Unknown Server',
                        enabled: true,
                    },
                ],
            };

            const ratings = await getAllSourceRatings({
                config,
                getJellyfinClient: jest.fn(),
                getPlexClient: jest.fn(),
                logger: mockLogger,
            });

            expect(ratings).toEqual([]);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Unknown server type')
            );
        });
    });

    describe('getRatingsWithCounts', () => {
        it('should count ratings for configured libraries', async () => {
            const mockClient = {
                getRatingsWithCounts: jest.fn().mockResolvedValue([
                    { rating: 'PG', count: 10 },
                    { rating: 'PG-13', count: 25 },
                ]),
            };

            const getJellyfinClient = jest.fn().mockResolvedValue(mockClient);

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: ['Movies'],
            };

            const result = await getRatingsWithCounts({
                serverConfig,
                getJellyfinClient,
                logger: mockLogger,
            });

            expect(result).toEqual([
                { rating: 'PG', count: 10 },
                { rating: 'PG-13', count: 25 },
            ]);
        });

        it('should handle errors gracefully', async () => {
            const getJellyfinClient = jest.fn().mockRejectedValue(new Error('Failed'));

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: ['Movies'],
            };

            const result = await getRatingsWithCounts({
                serverConfig,
                getJellyfinClient,
                logger: mockLogger,
            });

            expect(result).toEqual([]);
        });
    });

    describe('getJellyfinQualitiesWithCounts', () => {
        it('should fetch quality counts from Jellyfin', async () => {
            const mockClient = {
                getQualitiesWithCounts: jest.fn().mockResolvedValue([
                    { quality: '1080p', count: 50 },
                    { quality: '4K', count: 15 },
                ]),
            };

            const getJellyfinClient = jest.fn().mockResolvedValue(mockClient);

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: ['Movies'],
            };

            const result = await getJellyfinQualitiesWithCounts({
                serverConfig,
                getJellyfinClient,
                logger: mockLogger,
            });

            expect(result).toEqual([
                { quality: '1080p', count: 50 },
                { quality: '4K', count: 15 },
            ]);
        });

        it('should handle errors gracefully', async () => {
            const getJellyfinClient = jest.fn().mockRejectedValue(new Error('Failed'));

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: ['Movies'],
            };

            const result = await getJellyfinQualitiesWithCounts({
                serverConfig,
                getJellyfinClient,
                logger: mockLogger,
            });

            expect(result).toEqual([]);
        });
    });
});
