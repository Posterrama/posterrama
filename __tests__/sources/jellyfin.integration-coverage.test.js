/**
 * Integration test for jellyfin.js to improve actual code coverage
 */

const JellyfinSource = require('../../sources/jellyfin');

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

describe('JellyfinSource Integration Coverage', () => {
    let jellyfinSource;

    beforeEach(() => {
        const mockServerConfig = {
            name: 'Integration Test Server',
            url: 'http://test.jellyfin.com',
            apiKey: 'test-key',
            genreFilter: 'Action,Comedy',
            qualityFilter: '1080p,4K',
            ratingFilter: ['PG', 'PG-13'],
            recentlyAddedOnly: true,
            recentlyAddedDays: 30,
        };

        const mockGetJellyfinClient = jest.fn(() =>
            Promise.resolve({
                getItems: jest.fn(() =>
                    Promise.resolve({
                        Items: [
                            {
                                Id: '1',
                                Name: 'Action Movie',
                                Type: 'Movie',
                                DateCreated: new Date().toISOString(),
                                CommunityRating: 8.5,
                                OfficialRating: 'PG-13',
                                Genres: ['Action', 'Adventure'],
                                MediaSources: [
                                    {
                                        MediaStreams: [{ Type: 'Video', Height: 1080 }],
                                    },
                                ],
                            },
                            {
                                Id: '2',
                                Name: 'Low Rated Drama',
                                Type: 'Movie',
                                DateCreated: new Date(
                                    Date.now() - 60 * 24 * 60 * 60 * 1000
                                ).toISOString(),
                                CommunityRating: 5.0,
                                OfficialRating: 'R',
                                Genres: ['Drama'],
                                MediaSources: [
                                    {
                                        MediaStreams: [{ Type: 'Video', Height: 480 }],
                                    },
                                ],
                            },
                            {
                                Id: '3',
                                Name: 'No Genres Movie',
                                Type: 'Movie',
                                DateCreated: new Date().toISOString(),
                                CommunityRating: 7.0,
                                OfficialRating: 'PG',
                                Genres: [],
                                MediaSources: [],
                            },
                            {
                                Id: '4',
                                Name: 'Comedy Movie',
                                Type: 'Movie',
                                DateCreated: new Date().toISOString(),
                                CommunityRating: 8.0,
                                OfficialRating: null, // No rating
                                Genres: ['Comedy'],
                                MediaSources: [
                                    {
                                        MediaStreams: [{ Type: 'Video', Height: 2160 }],
                                    },
                                ],
                            },
                        ],
                    })
                ),
                testConnection: jest.fn(() =>
                    Promise.resolve({
                        version: '10.8.0',
                        serverName: 'Test Server',
                        id: 'test-id',
                    })
                ),
            })
        );

        const mockProcessJellyfinItem = jest.fn(item =>
            Promise.resolve({
                id: item.Id,
                title: item.Name,
                type: item.Type,
            })
        );

        const mockGetJellyfinLibraries = jest.fn(() =>
            Promise.resolve(new Map([['Movies', { id: '1', name: 'Movies' }]]))
        );

        const mockShuffleArray = jest.fn(arr => [...arr]);

        jellyfinSource = new JellyfinSource(
            mockServerConfig,
            mockGetJellyfinClient,
            mockProcessJellyfinItem,
            mockGetJellyfinLibraries,
            mockShuffleArray,
            60, // rtMinScore
            true // isDebug
        );
    });

    it('should execute fetchMedia with all filters and hit various code branches', async () => {
        const result = await jellyfinSource.fetchMedia(['Movies'], 'Movie', 10);

        // Verify the function executed and returned results
        expect(Array.isArray(result)).toBe(true);

        // Verify metrics were updated
        expect(jellyfinSource.metrics.requestCount).toBeGreaterThan(0);
        expect(jellyfinSource.metrics.itemsProcessed).toBeGreaterThan(0);
    });

    it('should execute getServerInfo and hit those code branches', async () => {
        const serverInfo = await jellyfinSource.getServerInfo();

        expect(serverInfo).toEqual({
            name: 'Integration Test Server',
            type: 'jellyfin',
            version: '10.8.0',
            serverName: 'Test Server',
            id: 'test-id',
            metrics: expect.any(Object),
        });
    });

    it('should test error handling in fetchMedia', async () => {
        // Create a source that will fail
        const failingSource = new JellyfinSource(
            { name: 'Failing Server' },
            jest.fn(() => Promise.reject(new Error('Connection failed'))),
            jest.fn(),
            jest.fn(),
            jest.fn(),
            0,
            true
        );

        await expect(failingSource.fetchMedia(['Movies'], 'Movie', 10)).rejects.toThrow(
            'Connection failed'
        );

        expect(failingSource.metrics.errorCount).toBe(1);
    });

    it('should test error handling in getServerInfo', async () => {
        const logger = require('../../utils/logger');

        const failingSource = new JellyfinSource(
            { name: 'Failing Server' },
            jest.fn(() =>
                Promise.resolve({
                    testConnection: jest.fn(() => Promise.reject(new Error('Server error'))),
                })
            ),
            jest.fn(),
            jest.fn(),
            jest.fn(),
            0,
            true
        );

        await expect(failingSource.getServerInfo()).rejects.toThrow('Server error');

        // Updated to match new structured error logging format
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('getServerInfo failed'),
            expect.objectContaining({
                error: expect.objectContaining({
                    message: 'Server error',
                }),
            })
        );
    });

    it('should test with different server configurations', async () => {
        // Test with minimal configuration (no filters)
        const minimalSource = new JellyfinSource(
            { name: 'Minimal Server' },
            jest.fn(() =>
                Promise.resolve({
                    getItems: jest.fn(() => Promise.resolve({ Items: [] })),
                })
            ),
            jest.fn(),
            jest.fn(() => Promise.resolve(new Map())),
            jest.fn(arr => arr),
            0,
            false // Debug disabled
        );

        const result = await minimalSource.fetchMedia(['Movies'], 'Movie', 5);
        expect(Array.isArray(result)).toBe(true);
    });

    it('should test legacy rating filters', async () => {
        const legacySource = new JellyfinSource(
            {
                name: 'Legacy Server',
                ratingFilters: {
                    minCommunityRating: 7.0,
                    allowedOfficialRatings: ['PG', 'PG-13'],
                    minUserRating: 8.0,
                },
            },
            jest.fn(() =>
                Promise.resolve({
                    getItems: jest.fn(() =>
                        Promise.resolve({
                            Items: [
                                {
                                    Id: '1',
                                    Name: 'Test Movie',
                                    CommunityRating: 8.0,
                                    OfficialRating: 'PG-13',
                                    UserData: { Rating: 9.0 },
                                },
                            ],
                        })
                    ),
                })
            ),
            jest.fn(item => Promise.resolve(item)),
            jest.fn(() => Promise.resolve(new Map([['Movies', { id: '1' }]]))),
            jest.fn(arr => arr),
            0,
            true
        );

        const result = await legacySource.fetchMedia(['Movies'], 'Movie', 5);
        expect(Array.isArray(result)).toBe(true);
    });

    it('should test server info with missing properties', async () => {
        const incompleteSource = new JellyfinSource(
            { name: 'Incomplete Server' },
            jest.fn(() =>
                Promise.resolve({
                    testConnection: jest.fn(() => Promise.resolve({})), // Empty response
                })
            ),
            jest.fn(),
            jest.fn(),
            jest.fn(),
            0,
            false
        );

        const serverInfo = await incompleteSource.getServerInfo();
        expect(serverInfo.version).toBe('Unknown');
        expect(serverInfo.serverName).toBe('Unknown');
        expect(serverInfo.id).toBe('Unknown');
    });
});
