/**
 * Jellyfin Missing Coverage Tests
 * Target: Increase coverage from 66.12% statements / 56.59% branches → 70%+
 * Focus: Uncovered lines 213-284,319,331-372,415-420,430,447,449,455,464-469,495-500,518-523,530-535,542-547,602
 *
 * Key gaps:
 * 1. Pagination logic (lines 213-284) - large libraries with >1000 items
 * 2. yearFilter logic (lines 331-372) - string ranges, PremiereDate/DateCreated fallbacks
 * 3. qualityFilter logic (lines 430-469) - MediaSources processing, quality mapping
 * 4. Legacy ratingFilters (lines 495-547) - minCommunityRating, allowedOfficialRatings, minUserRating
 */

const JellyfinSource = require('../../sources/jellyfin');

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

describe('Jellyfin Missing Coverage - Pagination', () => {
    let jellyfinSource;
    let mockServerConfig;
    let mockGetJellyfinClient;
    let mockProcessJellyfinItem;
    let mockGetJellyfinLibraries;
    let mockShuffleArray;
    let mockClient;

    beforeEach(() => {
        mockServerConfig = {
            name: 'Pagination Test Server',
            url: 'http://test.jellyfin.com',
            apiKey: 'test-key',
        };

        // Mock client that simulates large library with pagination
        mockClient = {
            getItems: jest.fn(),
        };

        mockGetJellyfinClient = jest.fn(() => Promise.resolve(mockClient));
        mockProcessJellyfinItem = jest.fn(item =>
            Promise.resolve({
                id: item.Id,
                title: item.Name,
            })
        );
        mockGetJellyfinLibraries = jest.fn(() =>
            Promise.resolve(new Map([['Large Library', { id: 'lib1', name: 'Large Library' }]]))
        );
        mockShuffleArray = jest.fn(arr => arr);

        jellyfinSource = new JellyfinSource(
            mockServerConfig,
            mockGetJellyfinClient,
            mockProcessJellyfinItem,
            mockGetJellyfinLibraries,
            mockShuffleArray,
            0,
            false
        );
    });

    test('handles large library with pagination (>1000 items)', async () => {
        // Create 2500 items to trigger pagination
        const createItems = count =>
            Array.from({ length: count }, (_, i) => ({
                Id: `item-${i}`,
                Name: `Movie ${i}`,
                Type: 'Movie',
                ProductionYear: 2020,
            }));

        const allItems = createItems(2500);

        // First page: 1000 items
        mockClient.getItems.mockImplementationOnce(() =>
            Promise.resolve({
                Items: allItems.slice(0, 1000),
                TotalRecordCount: 2500,
            })
        );

        // Subsequent pages (1000-2000, 2000-2500)
        mockClient.getItems.mockImplementationOnce(() =>
            Promise.resolve({
                Items: allItems.slice(1000, 2000),
                TotalRecordCount: 2500,
            })
        );

        mockClient.getItems.mockImplementationOnce(() =>
            Promise.resolve({
                Items: allItems.slice(2000, 2500),
                TotalRecordCount: 2500,
            })
        );

        const result = await jellyfinSource.fetchMedia(['Large Library'], 'movie', 100);

        // Should have fetched all pages
        expect(mockClient.getItems).toHaveBeenCalledTimes(3);
        expect(result.length).toBeLessThanOrEqual(100);
    });

    test('handles parallel batch pagination correctly', async () => {
        // Create library with 6000 items (will need 6 pages)
        const createItems = count =>
            Array.from({ length: count }, (_, i) => ({
                Id: `item-${i}`,
                Name: `Item ${i}`,
                Type: 'Movie',
            }));

        const allItems = createItems(6000);

        // Mock each page
        for (let i = 0; i < 6; i++) {
            const start = i * 1000;
            const end = Math.min(start + 1000, 6000);
            mockClient.getItems.mockImplementationOnce(() =>
                Promise.resolve({
                    Items: allItems.slice(start, end),
                    TotalRecordCount: 6000,
                })
            );
        }

        await jellyfinSource.fetchMedia(['Large Library'], 'movie', 50);

        // Should fetch 6 pages (1 initial + 5 remaining in batches)
        expect(mockClient.getItems).toHaveBeenCalledTimes(6);
    });

    test('handles pagination with debug logging', async () => {
        const logger = require('../../utils/logger');
        jellyfinSource.isDebug = true;

        const allItems = Array.from({ length: 2000 }, (_, i) => ({
            Id: `item-${i}`,
            Name: `Item ${i}`,
            Type: 'Movie',
        }));

        // First page
        mockClient.getItems.mockImplementationOnce(() =>
            Promise.resolve({
                Items: allItems.slice(0, 1000),
                TotalRecordCount: 2000,
            })
        );

        // Second page
        mockClient.getItems.mockImplementationOnce(() =>
            Promise.resolve({
                Items: allItems.slice(1000, 2000),
                TotalRecordCount: 2000,
            })
        );

        await jellyfinSource.fetchMedia(['Large Library'], 'movie', 10);

        // Debug logging should be called for batch progress
        expect(logger.debug).toHaveBeenCalled();
    });

    test('handles empty library name warning', async () => {
        const logger = require('../../utils/logger');

        mockClient.getItems.mockResolvedValue({
            Items: [],
            TotalRecordCount: 0,
        });

        const result = await jellyfinSource.fetchMedia(['Non-Existent Library'], 'movie', 10);

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Library "Non-Existent Library" not found')
        );
        expect(result).toEqual([]);
    });
});

describe('Jellyfin Missing Coverage - Year Filter', () => {
    let jellyfinSource;
    let mockServerConfig;
    let mockGetJellyfinClient;
    let mockProcessJellyfinItem;
    let mockGetJellyfinLibraries;
    let mockShuffleArray;
    let mockClient;

    beforeEach(() => {
        mockServerConfig = {
            name: 'Year Filter Test Server',
            url: 'http://test.jellyfin.com',
            apiKey: 'test-key',
        };

        mockClient = { getItems: jest.fn() };
        mockGetJellyfinClient = jest.fn(() => Promise.resolve(mockClient));
        mockProcessJellyfinItem = jest.fn(item => Promise.resolve({ id: item.Id }));
        mockGetJellyfinLibraries = jest.fn(() =>
            Promise.resolve(new Map([['Movies', { id: 'lib1', name: 'Movies' }]]))
        );
        mockShuffleArray = jest.fn(arr => arr);

        jellyfinSource = new JellyfinSource(
            mockServerConfig,
            mockGetJellyfinClient,
            mockProcessJellyfinItem,
            mockGetJellyfinLibraries,
            mockShuffleArray,
            0,
            false
        );
    });

    test('handles yearFilter as number (minimum year)', async () => {
        jellyfinSource.server.yearFilter = 2010;

        mockClient.getItems.mockResolvedValue({
            Items: [
                { Id: '1', Name: 'Movie 2015', ProductionYear: 2015 },
                { Id: '2', Name: 'Movie 2005', ProductionYear: 2005 }, // Should be filtered out
                { Id: '3', Name: 'Movie 2020', ProductionYear: 2020 },
            ],
            TotalRecordCount: 3,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(2);
    });

    test('handles yearFilter as string with single year', async () => {
        jellyfinSource.server.yearFilter = '2020';

        mockClient.getItems.mockResolvedValue({
            Items: [
                { Id: '1', Name: 'Movie 2020', ProductionYear: 2020 },
                { Id: '2', Name: 'Movie 2019', ProductionYear: 2019 }, // Filtered out
            ],
            TotalRecordCount: 2,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(1);
    });

    test('handles yearFilter as string with range (2010-2020)', async () => {
        jellyfinSource.server.yearFilter = '2010-2020';

        mockClient.getItems.mockResolvedValue({
            Items: [
                { Id: '1', Name: 'Movie 2015', ProductionYear: 2015 },
                { Id: '2', Name: 'Movie 2005', ProductionYear: 2005 }, // Filtered out
                { Id: '3', Name: 'Movie 2022', ProductionYear: 2022 }, // Filtered out
                { Id: '4', Name: 'Movie 2010', ProductionYear: 2010 },
                { Id: '5', Name: 'Movie 2020', ProductionYear: 2020 },
            ],
            TotalRecordCount: 5,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(3);
    });

    test('handles yearFilter with multiple ranges (2010-2015, 2018-2020)', async () => {
        jellyfinSource.server.yearFilter = '2010-2015, 2018-2020';

        mockClient.getItems.mockResolvedValue({
            Items: [
                { Id: '1', Name: 'Movie 2012', ProductionYear: 2012 }, // In range 1
                { Id: '2', Name: 'Movie 2016', ProductionYear: 2016 }, // Filtered out
                { Id: '3', Name: 'Movie 2019', ProductionYear: 2019 }, // In range 2
                { Id: '4', Name: 'Movie 2021', ProductionYear: 2021 }, // Filtered out
            ],
            TotalRecordCount: 4,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(2);
    });

    test('handles item without ProductionYear using PremiereDate fallback', async () => {
        jellyfinSource.server.yearFilter = '2020';

        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: 'Movie with PremiereDate',
                    ProductionYear: null,
                    PremiereDate: '2020-05-15T00:00:00Z',
                },
                {
                    Id: '2',
                    Name: 'Old Movie',
                    ProductionYear: null,
                    PremiereDate: '2010-01-01T00:00:00Z',
                }, // Filtered out
            ],
            TotalRecordCount: 2,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(1);
    });

    test('handles item using DateCreated fallback', async () => {
        jellyfinSource.server.yearFilter = '2019-2021';

        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: 'Movie with DateCreated',
                    ProductionYear: null,
                    PremiereDate: null,
                    DateCreated: '2020-03-10T00:00:00Z',
                },
                {
                    Id: '2',
                    Name: 'Old Movie',
                    ProductionYear: null,
                    PremiereDate: null,
                    DateCreated: '2015-01-01T00:00:00Z',
                }, // Filtered out
            ],
            TotalRecordCount: 2,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(1);
    });

    test('filters out items with no valid year', async () => {
        jellyfinSource.server.yearFilter = '2020';

        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: 'Movie without year',
                    ProductionYear: null,
                    PremiereDate: null,
                    DateCreated: null,
                }, // Filtered out
                { Id: '2', Name: 'Movie 2020', ProductionYear: 2020 },
            ],
            TotalRecordCount: 2,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(1);
    });
});

describe('Jellyfin Missing Coverage - Quality Filter', () => {
    let jellyfinSource;
    let mockServerConfig;
    let mockGetJellyfinClient;
    let mockProcessJellyfinItem;
    let mockGetJellyfinLibraries;
    let mockShuffleArray;
    let mockClient;

    beforeEach(() => {
        mockServerConfig = {
            name: 'Quality Filter Test Server',
            url: 'http://test.jellyfin.com',
            apiKey: 'test-key',
            qualityFilter: '1080p,4K',
        };

        mockClient = { getItems: jest.fn() };
        mockGetJellyfinClient = jest.fn(() => Promise.resolve(mockClient));
        mockProcessJellyfinItem = jest.fn(item => Promise.resolve({ id: item.Id }));
        mockGetJellyfinLibraries = jest.fn(() =>
            Promise.resolve(new Map([['Movies', { id: 'lib1', name: 'Movies' }]]))
        );
        mockShuffleArray = jest.fn(arr => arr);

        jellyfinSource = new JellyfinSource(
            mockServerConfig,
            mockGetJellyfinClient,
            mockProcessJellyfinItem,
            mockGetJellyfinLibraries,
            mockShuffleArray,
            0,
            false
        );
    });

    test('filters by quality - accepts 1080p', async () => {
        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: '1080p Movie',
                    MediaSources: [
                        {
                            MediaStreams: [{ Type: 'Video', Height: 1080 }, { Type: 'Audio' }],
                        },
                    ],
                },
                {
                    Id: '2',
                    Name: '720p Movie',
                    MediaSources: [
                        {
                            MediaStreams: [{ Type: 'Video', Height: 720 }],
                        },
                    ],
                }, // Filtered out
            ],
            TotalRecordCount: 2,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(1);
    });

    test('maps video heights to quality labels correctly', async () => {
        const testCases = [
            { height: 480, expectedQuality: 'SD', shouldInclude: false },
            { height: 576, expectedQuality: 'SD', shouldInclude: false },
            { height: 720, expectedQuality: '720p', shouldInclude: false },
            { height: 1080, expectedQuality: '1080p', shouldInclude: true },
            { height: 2160, expectedQuality: '4K', shouldInclude: true },
            { height: 1440, expectedQuality: '1440p', shouldInclude: false },
        ];

        for (const tc of testCases) {
            mockClient.getItems.mockResolvedValue({
                Items: [
                    {
                        Id: `item-${tc.height}`,
                        Name: `${tc.height}p Movie`,
                        MediaSources: [
                            {
                                MediaStreams: [{ Type: 'Video', Height: tc.height }],
                            },
                        ],
                    },
                ],
                TotalRecordCount: 1,
            });

            const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

            if (tc.shouldInclude) {
                expect(result.length).toBe(1);
            } else {
                expect(result.length).toBe(0);
            }
        }
    });

    test('skips quality filter for TV shows', async () => {
        jellyfinSource.server.qualityFilter = '4K'; // Very restrictive

        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: 'TV Show',
                    Type: 'Series',
                    MediaSources: [
                        {
                            MediaStreams: [{ Type: 'Video', Height: 720 }], // 720p but should pass
                        },
                    ],
                },
            ],
            TotalRecordCount: 1,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'show', 10);

        // Should not filter shows by quality
        expect(result.length).toBe(1);
    });

    test('filters out items without MediaSources', async () => {
        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: 'Movie without MediaSources',
                    MediaSources: null,
                },
                {
                    Id: '2',
                    Name: '1080p Movie',
                    MediaSources: [
                        {
                            MediaStreams: [{ Type: 'Video', Height: 1080 }],
                        },
                    ],
                },
            ],
            TotalRecordCount: 2,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(1);
    });

    test('filters out items without video streams', async () => {
        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: 'Movie without video stream',
                    MediaSources: [
                        {
                            MediaStreams: [{ Type: 'Audio' }], // No video stream
                        },
                    ],
                },
            ],
            TotalRecordCount: 1,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(0);
    });
});

describe('Jellyfin Missing Coverage - Legacy Rating Filters', () => {
    let jellyfinSource;
    let mockServerConfig;
    let mockGetJellyfinClient;
    let mockProcessJellyfinItem;
    let mockGetJellyfinLibraries;
    let mockShuffleArray;
    let mockClient;

    beforeEach(() => {
        mockServerConfig = {
            name: 'Legacy Rating Test Server',
            url: 'http://test.jellyfin.com',
            apiKey: 'test-key',
            ratingFilters: {
                minCommunityRating: 7.0,
                allowedOfficialRatings: ['PG', 'PG-13', 'R'],
                minUserRating: 8.0,
            },
        };

        mockClient = { getItems: jest.fn() };
        mockGetJellyfinClient = jest.fn(() => Promise.resolve(mockClient));
        mockProcessJellyfinItem = jest.fn(item => Promise.resolve({ id: item.Id }));
        mockGetJellyfinLibraries = jest.fn(() =>
            Promise.resolve(new Map([['Movies', { id: 'lib1', name: 'Movies' }]]))
        );
        mockShuffleArray = jest.fn(arr => arr);

        jellyfinSource = new JellyfinSource(
            mockServerConfig,
            mockGetJellyfinClient,
            mockProcessJellyfinItem,
            mockGetJellyfinLibraries,
            mockShuffleArray,
            0,
            true // debug enabled
        );
    });

    test('filters by minCommunityRating', async () => {
        mockClient.getItems.mockResolvedValue({
            Items: [
                { Id: '1', Name: 'Good Movie', CommunityRating: 8.5 },
                { Id: '2', Name: 'Bad Movie', CommunityRating: 5.0 }, // Filtered out
                { Id: '3', Name: 'Great Movie', CommunityRating: 9.2 },
            ],
            TotalRecordCount: 3,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(2);
    });

    test('filters by allowedOfficialRatings', async () => {
        mockClient.getItems.mockResolvedValue({
            Items: [
                { Id: '1', Name: 'PG Movie', OfficialRating: 'PG', CommunityRating: 8.0 },
                { Id: '2', Name: 'NC-17 Movie', OfficialRating: 'NC-17', CommunityRating: 8.0 }, // Filtered out
                { Id: '3', Name: 'R Movie', OfficialRating: 'R', CommunityRating: 8.0 },
            ],
            TotalRecordCount: 3,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(2);
    });

    test('filters by minUserRating', async () => {
        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: 'User Loved',
                    CommunityRating: 8.0,
                    OfficialRating: 'PG',
                    UserData: { Rating: 9.0 },
                },
                {
                    Id: '2',
                    Name: 'User Disliked',
                    CommunityRating: 8.0,
                    OfficialRating: 'PG',
                    UserData: { Rating: 5.0 },
                }, // Filtered out
            ],
            TotalRecordCount: 2,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(1);
    });

    test('handles items without UserData', async () => {
        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: 'No User Rating',
                    CommunityRating: 8.0,
                    OfficialRating: 'PG',
                    UserData: null, // No user data
                },
            ],
            TotalRecordCount: 1,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        // Should pass (minUserRating only applies if UserData.Rating exists)
        expect(result.length).toBe(1);
    });

    test('combines all legacy filters', async () => {
        mockClient.getItems.mockResolvedValue({
            Items: [
                {
                    Id: '1',
                    Name: 'Perfect Movie',
                    CommunityRating: 9.0,
                    OfficialRating: 'PG-13',
                    UserData: { Rating: 10.0 },
                },
                {
                    Id: '2',
                    Name: 'Low Community',
                    CommunityRating: 5.0, // Fails
                    OfficialRating: 'PG',
                    UserData: { Rating: 9.0 },
                },
                {
                    Id: '3',
                    Name: 'Wrong Rating',
                    CommunityRating: 8.0,
                    OfficialRating: 'G', // Fails
                    UserData: { Rating: 9.0 },
                },
                {
                    Id: '4',
                    Name: 'Low User Rating',
                    CommunityRating: 8.0,
                    OfficialRating: 'R',
                    UserData: { Rating: 6.0 }, // Fails
                },
            ],
            TotalRecordCount: 4,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(1);
        expect(result[0].id).toBe('1');
    });
});

describe('Jellyfin Missing Coverage - Edge Cases', () => {
    let jellyfinSource;
    let mockServerConfig;
    let mockGetJellyfinClient;
    let mockProcessJellyfinItem;
    let mockGetJellyfinLibraries;
    let mockShuffleArray;
    let mockClient;

    beforeEach(() => {
        mockServerConfig = {
            name: 'Edge Case Server',
            url: 'http://test.jellyfin.com',
            apiKey: 'test-key',
        };

        mockClient = { getItems: jest.fn() };
        mockGetJellyfinClient = jest.fn(() => Promise.resolve(mockClient));
        mockProcessJellyfinItem = jest.fn(item => Promise.resolve({ id: item.Id }));
        mockGetJellyfinLibraries = jest.fn(() =>
            Promise.resolve(new Map([['Movies', { id: 'lib1', name: 'Movies' }]]))
        );
        mockShuffleArray = jest.fn(arr => arr);

        jellyfinSource = new JellyfinSource(
            mockServerConfig,
            mockGetJellyfinClient,
            mockProcessJellyfinItem,
            mockGetJellyfinLibraries,
            mockShuffleArray,
            0,
            true
        );
    });

    test('handles empty items array with debug logging', async () => {
        const logger = require('../../utils/logger');

        mockClient.getItems.mockResolvedValue({
            Items: [],
            TotalRecordCount: 0,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result).toEqual([]);
        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('No items returned'));
    });

    test('handles all items filtered out', async () => {
        const logger = require('../../utils/logger');
        jellyfinSource.server.ratingFilter = 'PG';

        mockClient.getItems.mockResolvedValue({
            Items: [
                { Id: '1', Name: 'R Movie', OfficialRating: 'R' },
                { Id: '2', Name: 'NC-17 Movie', OfficialRating: 'NC-17' },
            ],
            TotalRecordCount: 2,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result).toEqual([]);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('All items filtered out')
        );
    });

    test('handles RT min score filtering', async () => {
        jellyfinSource.rtMinScore = 70; // 70% RT score

        mockClient.getItems.mockResolvedValue({
            Items: [
                { Id: '1', Name: 'High Rated', CommunityRating: 8.5 }, // 8.5 > 7.0 (70/10)
                { Id: '2', Name: 'Low Rated', CommunityRating: 5.0 }, // 5.0 < 7.0
            ],
            TotalRecordCount: 2,
        });

        const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 10);

        expect(result.length).toBe(1);
    });
});
