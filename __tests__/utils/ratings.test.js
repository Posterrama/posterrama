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

            const mockLibraries = new Map([
                ['Movies', { id: 'lib1', name: 'Movies' }],
                ['TV Shows', { id: 'lib2', name: 'TV Shows' }],
            ]);

            const getJellyfinClient = jest.fn().mockResolvedValue(mockClient);
            const getJellyfinLibraries = jest.fn().mockResolvedValue(mockLibraries);

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: ['Movies'],
                showLibraryNames: ['TV Shows'],
            };

            const ratings = await fetchAllJellyfinRatings({
                serverConfig,
                getJellyfinClient,
                getJellyfinLibraries,
                logger: mockLogger,
            });

            expect(ratings).toEqual(['TV-14', 'TV-MA', 'PG']);
            expect(mockClient.getRatings).toHaveBeenCalledWith(['lib1', 'lib2']);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should return empty array when no libraries configured', async () => {
            const mockLibraries = new Map();
            const getJellyfinClient = jest.fn();
            const getJellyfinLibraries = jest.fn().mockResolvedValue(mockLibraries);

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: [],
                showLibraryNames: [],
            };

            const ratings = await fetchAllJellyfinRatings({
                serverConfig,
                getJellyfinClient,
                getJellyfinLibraries,
                logger: mockLogger,
            });

            expect(ratings).toEqual([]);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('No configured libraries found')
            );
        });

        it('should handle client errors gracefully', async () => {
            const mockLibraries = new Map([['Movies', { id: 'lib1' }]]);
            const getJellyfinClient = jest.fn().mockRejectedValue(new Error('Connection failed'));
            const getJellyfinLibraries = jest.fn().mockResolvedValue(mockLibraries);

            const serverConfig = {
                name: 'Test Jellyfin',
                movieLibraryNames: ['Movies'],
            };

            const ratings = await fetchAllJellyfinRatings({
                serverConfig,
                getJellyfinClient,
                getJellyfinLibraries,
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
        let mockPlexHttpClient;

        beforeEach(() => {
            // Mock the PlexHttpClient module
            mockPlexHttpClient = {
                getRatings: jest.fn(),
            };
            jest.mock('../../utils/plex-http-client', () => {
                return jest.fn().mockImplementation(() => mockPlexHttpClient);
            });
        });

        it('should fetch ratings using PlexHttpClient', async () => {
            mockPlexHttpClient.getRatings.mockResolvedValue(['PG', 'PG-13', 'R']);

            const mockPlex = { query: jest.fn() };
            const getPlexClient = jest.fn().mockResolvedValue(mockPlex);

            const serverConfig = {
                name: 'Test Plex',
            };

            const ratings = await fetchAllPlexRatings({
                serverConfig,
                getPlexClient,
                isDebug: false,
                logger: mockLogger,
            });

            expect(ratings).toEqual(['PG', 'PG-13', 'R']);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should handle client errors gracefully', async () => {
            const getPlexClient = jest.fn().mockRejectedValue(new Error('Connection failed'));

            const serverConfig = {
                name: 'Test Plex',
            };

            const ratings = await fetchAllPlexRatings({
                serverConfig,
                getPlexClient,
                isDebug: false,
                logger: mockLogger,
            });

            expect(ratings).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to fetch ratings'),
                'Connection failed'
            );
        });

        it('should handle PlexHttpClient errors', async () => {
            mockPlexHttpClient.getRatings.mockRejectedValue(new Error('API error'));

            const mockPlex = { query: jest.fn() };
            const getPlexClient = jest.fn().mockResolvedValue(mockPlex);

            const serverConfig = {
                name: 'Test Plex',
            };

            const ratings = await fetchAllPlexRatings({
                serverConfig,
                getPlexClient,
                isDebug: false,
                logger: mockLogger,
            });

            expect(ratings).toEqual([]);
        });
    });

    describe('getAllSourceRatings', () => {
        let mockRatingCache;

        beforeEach(() => {
            mockRatingCache = {
                getRatings: jest.fn().mockReturnValue([]),
                setRatings: jest.fn(),
            };
        });

        it('should return cached ratings when available', async () => {
            mockRatingCache.getRatings.mockReturnValue(['PG', 'PG-13', 'R']);

            const ratings = await getAllSourceRatings({
                sourceType: 'plex',
                config: { mediaServers: [] },
                ratingCache: mockRatingCache,
                logger: mockLogger,
                fetchJellyfinRatings: jest.fn(),
                fetchPlexRatings: jest.fn(),
            });

            expect(ratings).toEqual(['PG', 'PG-13', 'R']);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Using cached ratings')
            );
        });

        it('should fetch from enabled Jellyfin servers when cache is empty', async () => {
            const fetchJellyfinRatings = jest
                .fn()
                .mockResolvedValueOnce(['TV-14'])
                .mockResolvedValueOnce(['TV-MA']);

            const config = {
                mediaServers: [
                    { type: 'jellyfin', name: 'Server1', enabled: true },
                    { type: 'jellyfin', name: 'Server2', enabled: true },
                    { type: 'jellyfin', name: 'Server3', enabled: false }, // disabled
                ],
            };

            const ratings = await getAllSourceRatings({
                sourceType: 'jellyfin',
                config,
                ratingCache: mockRatingCache,
                logger: mockLogger,
                fetchJellyfinRatings,
                fetchPlexRatings: jest.fn(),
            });

            expect(fetchJellyfinRatings).toHaveBeenCalledTimes(2); // Only enabled servers
            expect(ratings).toContain('TV-14');
            expect(ratings).toContain('TV-MA');
        });

        it('should return empty array when no enabled servers found', async () => {
            const config = {
                mediaServers: [{ type: 'plex', name: 'Server1', enabled: false }],
            };

            const ratings = await getAllSourceRatings({
                sourceType: 'plex',
                config,
                ratingCache: mockRatingCache,
                logger: mockLogger,
                fetchJellyfinRatings: jest.fn(),
                fetchPlexRatings: jest.fn(),
            });

            expect(ratings).toEqual([]);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('No enabled servers found')
            );
        });
    });

    describe('getRatingsWithCounts', () => {
        it('should get Jellyfin ratings with counts', async () => {
            const mockClient = {
                getRatingsWithCounts: jest.fn().mockResolvedValue([
                    { rating: 'TV-14', count: 10 },
                    { rating: 'TV-MA', count: 5 },
                ]),
            };

            const mockLibraries = new Map([['Movies', { id: 'lib1', name: 'Movies' }]]);

            const config = {
                mediaServers: [
                    {
                        type: 'jellyfin',
                        name: 'Test',
                        enabled: true,
                        movieLibraryNames: ['Movies'],
                        showLibraryNames: [],
                    },
                ],
            };

            const result = await getRatingsWithCounts({
                sourceType: 'jellyfin',
                config,
                getJellyfinClient: jest.fn().mockResolvedValue(mockClient),
                getJellyfinLibraries: jest.fn().mockResolvedValue(mockLibraries),
                getPlexClient: jest.fn(),
                isDebug: false,
                logger: mockLogger,
            });

            expect(result).toEqual([
                { rating: 'TV-14', count: 10 },
                { rating: 'TV-MA', count: 5 },
            ]);
        });

        it('should throw error for no enabled server', async () => {
            const config = {
                mediaServers: [{ type: 'plex', name: 'Test', enabled: false }],
            };

            await expect(
                getRatingsWithCounts({
                    sourceType: 'plex',
                    config,
                    getJellyfinClient: jest.fn(),
                    getJellyfinLibraries: jest.fn(),
                    getPlexClient: jest.fn(),
                    isDebug: false,
                    logger: mockLogger,
                })
            ).rejects.toThrow('No enabled plex server found');
        });

        it('should throw error for unsupported source type', async () => {
            await expect(
                getRatingsWithCounts({
                    sourceType: 'unknown',
                    config: { mediaServers: [] },
                    getJellyfinClient: jest.fn(),
                    getJellyfinLibraries: jest.fn(),
                    getPlexClient: jest.fn(),
                    isDebug: false,
                    logger: mockLogger,
                })
            ).rejects.toThrow('Rating counts not supported');
        });
    });

    describe('getJellyfinQualitiesWithCounts', () => {
        it('should get quality counts from Jellyfin', async () => {
            const mockClient = {
                getQualitiesWithCounts: jest.fn().mockResolvedValue([
                    { quality: '1080p', count: 100 },
                    { quality: '4K', count: 50 },
                ]),
            };

            const mockLibraries = new Map([
                ['Movies', { id: 'lib1', name: 'Movies', type: 'movies' }],
                ['TV', { id: 'lib2', name: 'TV', type: 'tvshows' }],
            ]);

            const serverConfig = { name: 'Test Jellyfin' };

            const result = await getJellyfinQualitiesWithCounts({
                serverConfig,
                getJellyfinClient: jest.fn().mockResolvedValue(mockClient),
                getJellyfinLibraries: jest.fn().mockResolvedValue(mockLibraries),
                isDebug: false,
                logger: mockLogger,
            });

            expect(result).toEqual([
                { quality: '1080p', count: 100 },
                { quality: '4K', count: 50 },
            ]);
            expect(mockClient.getQualitiesWithCounts).toHaveBeenCalledWith(['lib1', 'lib2']);
        });

        it('should return empty array when no movie/TV libraries found', async () => {
            const mockLibraries = new Map([
                ['Music', { id: 'lib1', name: 'Music', type: 'music' }],
            ]);

            const serverConfig = { name: 'Test Jellyfin' };

            const result = await getJellyfinQualitiesWithCounts({
                serverConfig,
                getJellyfinClient: jest.fn(),
                getJellyfinLibraries: jest.fn().mockResolvedValue(mockLibraries),
                isDebug: false,
                logger: mockLogger,
            });

            expect(result).toEqual([]);
        });

        it('should handle errors gracefully', async () => {
            const getJellyfinClient = jest.fn().mockRejectedValue(new Error('Connection failed'));

            const serverConfig = { name: 'Test Jellyfin' };

            const result = await getJellyfinQualitiesWithCounts({
                serverConfig,
                getJellyfinClient,
                getJellyfinLibraries: jest.fn(),
                isDebug: false,
                logger: mockLogger,
            });

            expect(result).toEqual([]);
        });
    });

    describe('getJellyfinQualitiesWithCounts', () => {
        it('should get quality counts from Jellyfin', async () => {
            const mockClient = {
                getQualitiesWithCounts: jest.fn().mockResolvedValue([
                    { quality: '1080p', count: 100 },
                    { quality: '4K', count: 50 },
                ]),
            };

            const mockLibraries = new Map([
                ['Movies', { id: 'lib1', name: 'Movies', type: 'movies' }],
                ['TV', { id: 'lib2', name: 'TV', type: 'tvshows' }],
            ]);

            const serverConfig = { name: 'Test Jellyfin' };

            const result = await getJellyfinQualitiesWithCounts({
                serverConfig,
                getJellyfinClient: jest.fn().mockResolvedValue(mockClient),
                getJellyfinLibraries: jest.fn().mockResolvedValue(mockLibraries),
                isDebug: false,
                logger: mockLogger,
            });

            expect(result).toEqual([
                { quality: '1080p', count: 100 },
                { quality: '4K', count: 50 },
            ]);
            expect(mockClient.getQualitiesWithCounts).toHaveBeenCalledWith(['lib1', 'lib2']);
        });

        it('should handle errors gracefully', async () => {
            const getJellyfinClient = jest.fn().mockRejectedValue(new Error('Connection failed'));

            const serverConfig = { name: 'Test Jellyfin' };

            const result = await getJellyfinQualitiesWithCounts({
                serverConfig,
                getJellyfinClient,
                getJellyfinLibraries: jest.fn(),
                isDebug: false,
                logger: mockLogger,
            });

            expect(result).toEqual([]);
        });
    });
});
