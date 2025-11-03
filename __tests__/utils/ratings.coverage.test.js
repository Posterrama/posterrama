/**
 * Ratings Module - Additional Branch Coverage Tests
 * Targets uncovered error handling branches
 */

const { getAllSourceRatings, getRatingsWithCounts } = require('../../utils/ratings');

describe('Ratings Coverage - Error Branches', () => {
    let mockLogger;
    let mockRatingCache;

    beforeEach(() => {
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        mockRatingCache = {
            getRatings: jest.fn().mockReturnValue([]),
            setRatings: jest.fn(),
        };
    });

    describe('getAllSourceRatings - error handling', () => {
        test('handles fetchJellyfinRatings errors and continues with other servers', async () => {
            const fetchJellyfinRatings = jest
                .fn()
                .mockRejectedValueOnce(new Error('Server 1 timeout'))
                .mockResolvedValueOnce(['TV-14', 'TV-MA']); // Server 2 succeeds

            const config = {
                mediaServers: [
                    { type: 'jellyfin', name: 'Server1', enabled: true },
                    { type: 'jellyfin', name: 'Server2', enabled: true },
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

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to fetch ratings from server Server1'),
                'Server 1 timeout'
            );
            expect(ratings).toEqual(['TV-14', 'TV-MA']);
        });

        test('handles fetchPlexRatings errors gracefully', async () => {
            const fetchPlexRatings = jest
                .fn()
                .mockRejectedValueOnce(new Error('Plex connection lost'))
                .mockResolvedValueOnce(['PG', 'PG-13']);

            const config = {
                mediaServers: [
                    { type: 'plex', name: 'PlexMain', enabled: true },
                    { type: 'plex', name: 'PlexBackup', enabled: true },
                ],
            };

            const ratings = await getAllSourceRatings({
                sourceType: 'plex',
                config,
                ratingCache: mockRatingCache,
                logger: mockLogger,
                fetchJellyfinRatings: jest.fn(),
                fetchPlexRatings,
            });

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to fetch ratings from server PlexMain'),
                'Plex connection lost'
            );
            expect(ratings).toEqual(['PG', 'PG-13']);
        });

        test('warns on unsupported source type and returns empty array', async () => {
            const config = {
                mediaServers: [{ type: 'tmdb', name: 'TMDB', enabled: true }],
            };

            const ratings = await getAllSourceRatings({
                sourceType: 'tmdb',
                config,
                ratingCache: mockRatingCache,
                logger: mockLogger,
                fetchJellyfinRatings: jest.fn(),
                fetchPlexRatings: jest.fn(),
            });

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Unsupported source type: tmdb')
            );
            expect(ratings).toEqual([]);
        });

        test('returns empty array when all servers fail', async () => {
            const fetchJellyfinRatings = jest.fn().mockRejectedValue(new Error('All servers down'));

            const config = {
                mediaServers: [
                    { type: 'jellyfin', name: 'Server1', enabled: true },
                    { type: 'jellyfin', name: 'Server2', enabled: true },
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

            expect(mockLogger.error).toHaveBeenCalledTimes(2);
            expect(ratings).toEqual([]);
        });
    });

    describe('getRatingsWithCounts - error handling', () => {
        test('throws error for unsupported source type', async () => {
            await expect(
                getRatingsWithCounts({
                    sourceType: 'tmdb',
                    config: { mediaServers: [] },
                    getJellyfinClient: jest.fn(),
                    getJellyfinLibraries: jest.fn(),
                    getPlexClient: jest.fn(),
                    isDebug: false,
                    logger: mockLogger,
                })
            ).rejects.toThrow('Rating counts not supported for source type: tmdb');
        });

        test('throws error when no enabled server found', async () => {
            const config = {
                mediaServers: [
                    { type: 'jellyfin', name: 'Server1', enabled: false },
                    { type: 'plex', name: 'Server2', enabled: false },
                ],
            };

            await expect(
                getRatingsWithCounts({
                    sourceType: 'jellyfin',
                    config,
                    getJellyfinClient: jest.fn(),
                    getJellyfinLibraries: jest.fn(),
                    getPlexClient: jest.fn(),
                    isDebug: false,
                    logger: mockLogger,
                })
            ).rejects.toThrow('No enabled jellyfin server found');
        });

        test('logs and rethrows error when Jellyfin client fails', async () => {
            const config = {
                mediaServers: [
                    {
                        type: 'jellyfin',
                        name: 'JellyServer',
                        enabled: true,
                        movieLibraryNames: ['Movies'],
                        showLibraryNames: [],
                    },
                ],
            };

            const getJellyfinClient = jest.fn().mockRejectedValue(new Error('Auth failed'));

            await expect(
                getRatingsWithCounts({
                    sourceType: 'jellyfin',
                    config,
                    getJellyfinClient,
                    getJellyfinLibraries: jest.fn(),
                    getPlexClient: jest.fn(),
                    isDebug: false,
                    logger: mockLogger,
                })
            ).rejects.toThrow('Auth failed');

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to get ratings with counts for jellyfin'),
                'Auth failed'
            );
        });

        test('logs and rethrows error when Plex client fails', async () => {
            const config = {
                mediaServers: [
                    {
                        type: 'plex',
                        name: 'PlexServer',
                        enabled: true,
                    },
                ],
            };

            const getPlexClient = jest.fn().mockRejectedValue(new Error('Connection timeout'));

            await expect(
                getRatingsWithCounts({
                    sourceType: 'plex',
                    config,
                    getJellyfinClient: jest.fn(),
                    getJellyfinLibraries: jest.fn(),
                    getPlexClient,
                    isDebug: false,
                    logger: mockLogger,
                })
            ).rejects.toThrow('Connection timeout');

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to get ratings with counts for plex'),
                'Connection timeout'
            );
        });

        test('warns and returns empty array when no libraries configured for Jellyfin', async () => {
            const mockClient = {
                getRatingsWithCounts: jest.fn(),
            };

            const mockLibraries = new Map([['Movies', { id: 'lib1', name: 'Movies' }]]);

            const config = {
                mediaServers: [
                    {
                        type: 'jellyfin',
                        name: 'JellyServer',
                        enabled: true,
                        movieLibraryNames: [], // Empty
                        showLibraryNames: [], // Empty
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

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('No configured libraries found for JellyServer')
            );
            expect(result).toEqual([]);
            expect(mockClient.getRatingsWithCounts).not.toHaveBeenCalled();
        });

        test('warns and returns empty array when library names do not match', async () => {
            const mockClient = {
                getRatingsWithCounts: jest.fn(),
            };

            const mockLibraries = new Map([['Movies', { id: 'lib1', name: 'Movies' }]]);

            const config = {
                mediaServers: [
                    {
                        type: 'jellyfin',
                        name: 'JellyServer',
                        enabled: true,
                        movieLibraryNames: ['NonExistent'], // Does not exist in mockLibraries
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

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('No configured libraries found for JellyServer')
            );
            expect(result).toEqual([]);
        });

        test('successfully handles Plex ratings with counts', async () => {
            const mockPlexHttpClient = {
                getRatingsWithCounts: jest.fn().mockResolvedValue([
                    { rating: 'PG', count: 20 },
                    { rating: 'PG-13', count: 15 },
                ]),
            };

            // Mock the PlexHttpClient constructor
            jest.mock('../../utils/plex-http-client', () => {
                return jest.fn().mockImplementation(() => mockPlexHttpClient);
            });

            const PlexHttpClient = require('../../utils/plex-http-client');

            const config = {
                mediaServers: [
                    {
                        type: 'plex',
                        name: 'PlexServer',
                        enabled: true,
                    },
                ],
            };

            const mockPlex = {};

            const result = await getRatingsWithCounts({
                sourceType: 'plex',
                config,
                getJellyfinClient: jest.fn(),
                getJellyfinLibraries: jest.fn(),
                getPlexClient: jest.fn().mockResolvedValue(mockPlex),
                isDebug: true,
                logger: mockLogger,
            });

            expect(PlexHttpClient).toHaveBeenCalledWith(mockPlex, config.mediaServers[0], true);
            expect(result).toEqual([
                { rating: 'PG', count: 20 },
                { rating: 'PG-13', count: 15 },
            ]);
        });
    });
});
