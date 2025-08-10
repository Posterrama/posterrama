const PlexSource = require('../sources/plex');

describe('Plex Source', () => {
    let plexSource;
    let mockServerConfig;
    let mockGetPlexClient;
    let mockProcessPlexItem;
    let mockGetPlexLibraries;
    let mockShuffleArray;
    let mockPlexClient;

    beforeEach(() => {
        mockServerConfig = {
            name: 'Test Plex Server',
            host: 'test.local',
            port: 32400,
            token: 'test-token'
        };

        mockPlexClient = {
            query: jest.fn()
        };

        mockGetPlexClient = jest.fn().mockReturnValue(mockPlexClient);
        mockProcessPlexItem = jest.fn().mockImplementation(item => ({ ...item, processed: true }));
        mockGetPlexLibraries = jest.fn();
        mockShuffleArray = jest.fn().mockImplementation(array => [...array].reverse());

        plexSource = new PlexSource(
            mockServerConfig,
            mockGetPlexClient,
            mockProcessPlexItem,
            mockGetPlexLibraries,
            mockShuffleArray,
            0, // rtMinScore
            false // isDebug
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should initialize with provided configuration', () => {
            expect(plexSource.server).toBe(mockServerConfig);
            expect(plexSource.getPlexClient).toBe(mockGetPlexClient);
            expect(plexSource.processPlexItem).toBe(mockProcessPlexItem);
            expect(plexSource.getPlexLibraries).toBe(mockGetPlexLibraries);
            expect(plexSource.shuffleArray).toBe(mockShuffleArray);
            expect(plexSource.rtMinScore).toBe(0);
            expect(plexSource.isDebug).toBe(false);
            expect(mockGetPlexClient).toHaveBeenCalledWith(mockServerConfig);
        });
    });

    describe('fetchMedia', () => {
        it('should return empty array when no library names provided', async () => {
            const result = await plexSource.fetchMedia([], 'movie', 10);
            expect(result).toEqual([]);
        });

        it('should return empty array when count is 0', async () => {
            const result = await plexSource.fetchMedia(['Movies'], 'movie', 0);
            expect(result).toEqual([]);
        });

        it('should return empty array when library names is null', async () => {
            const result = await plexSource.fetchMedia(null, 'movie', 10);
            expect(result).toEqual([]);
        });

        it('should fetch media from valid libraries', async () => {
            const mockLibraries = new Map([
                ['Movies', { key: '1', title: 'Movies' }],
                ['TV Shows', { key: '2', title: 'TV Shows' }]
            ]);

            const mockMediaItems = [
                { ratingKey: '1', title: 'Movie 1', type: 'movie' },
                { ratingKey: '2', title: 'Movie 2', type: 'movie' },
                { ratingKey: '3', title: 'Movie 3', type: 'movie' }
            ];

            mockGetPlexLibraries.mockResolvedValue(mockLibraries);
            mockPlexClient.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: mockMediaItems
                }
            });

            const result = await plexSource.fetchMedia(['Movies'], 'movie', 2);

            expect(mockGetPlexLibraries).toHaveBeenCalledWith(mockServerConfig);
            expect(mockPlexClient.query).toHaveBeenCalledWith('/library/sections/1/all');
            expect(mockShuffleArray).toHaveBeenCalledWith(mockMediaItems);
            expect(mockProcessPlexItem).toHaveBeenCalledTimes(2);
            expect(result).toHaveLength(2);
        });

        it('should warn when library is not found', async () => {
            const mockLibraries = new Map([
                ['Movies', { key: '1', title: 'Movies' }]
            ]);

            mockGetPlexLibraries.mockResolvedValue(mockLibraries);
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

            const result = await plexSource.fetchMedia(['NonExistent'], 'movie', 10);

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[PlexSource:Test Plex Server] Library "NonExistent" not found.'
            );
            expect(result).toEqual([]);

            consoleWarnSpy.mockRestore();
        });

        it('should handle libraries with no content', async () => {
            const mockLibraries = new Map([
                ['Empty', { key: '1', title: 'Empty' }]
            ]);

            mockGetPlexLibraries.mockResolvedValue(mockLibraries);
            mockPlexClient.query.mockResolvedValue({
                MediaContainer: {}
            });

            const result = await plexSource.fetchMedia(['Empty'], 'movie', 10);

            expect(result).toEqual([]);
        });

        it('should handle errors gracefully', async () => {
            mockGetPlexLibraries.mockRejectedValue(new Error('Network error'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            const result = await plexSource.fetchMedia(['Movies'], 'movie', 10);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[PlexSource:Test Plex Server] Error fetching media: Network error'
            );
            expect(result).toEqual([]);

            consoleErrorSpy.mockRestore();
        });

        it('should respect rtMinScore filtering', async () => {
            const plexSourceWithRating = new PlexSource(
                mockServerConfig,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                7.0, // rtMinScore
                false
            );

            const mockLibraries = new Map([
                ['Movies', { key: '1', title: 'Movies' }]
            ]);

            const mockMediaItems = [
                { ratingKey: '1', title: 'Good Movie', rating: 8.5 },
                { ratingKey: '2', title: 'Bad Movie', rating: 5.0 }, // Should be filtered out
                { ratingKey: '3', title: 'Great Movie', rating: 9.0 }
            ];

            mockGetPlexLibraries.mockResolvedValue(mockLibraries);
            mockPlexClient.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: mockMediaItems
                }
            });

            // Reset the mock to count calls for this test
            mockProcessPlexItem.mockClear();

            // Mock processPlexItem to return items with rottenTomatoes scores
            mockProcessPlexItem
                .mockResolvedValueOnce({ 
                    title: 'Good Movie', 
                    rottenTomatoes: { originalScore: 0.85 } // 8.5/10 = 0.85, * 10 = 8.5 >= 7.0
                })
                .mockResolvedValueOnce({ 
                    title: 'Bad Movie', 
                    rottenTomatoes: { originalScore: 0.50 } // 5.0/10 = 0.50, * 10 = 5.0 < 7.0
                })
                .mockResolvedValueOnce({ 
                    title: 'Great Movie', 
                    rottenTomatoes: { originalScore: 0.90 } // 9.0/10 = 0.90, * 10 = 9.0 >= 7.0
                });

            const result = await plexSourceWithRating.fetchMedia(['Movies'], 'movie', 10);

            // All items should be processed (called 3 times)
            expect(mockProcessPlexItem).toHaveBeenCalledTimes(3);
            
            // But result should only contain items with rating >= 7.0 (2 items)
            expect(result).toHaveLength(2);
            expect(result).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ title: 'Good Movie' }),
                    expect.objectContaining({ title: 'Great Movie' })
                ])
            );
        });

        it('should log debug information when debug is enabled', async () => {
            const debugPlexSource = new PlexSource(
                mockServerConfig,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                true // isDebug
            );

            const mockLibraries = new Map([
                ['Movies', { key: '1', title: 'Movies' }]
            ]);

            const mockMediaItems = [
                { ratingKey: '1', title: 'Movie 1' }
            ];

            mockGetPlexLibraries.mockResolvedValue(mockLibraries);
            mockPlexClient.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: mockMediaItems
                }
            });

            const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

            await debugPlexSource.fetchMedia(['Movies'], 'movie', 5);

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[PlexSource:Test Plex Server] Fetching 5 movie(s) from libraries: Movies'
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[PlexSource:Test Plex Server] Found 1 total items in specified libraries.'
            );

            consoleLogSpy.mockRestore();
        });

        it('should handle multiple libraries', async () => {
            const mockLibraries = new Map([
                ['Movies', { key: '1', title: 'Movies' }],
                ['Documentaries', { key: '2', title: 'Documentaries' }]
            ]);

            const movieItems = [
                { ratingKey: '1', title: 'Movie 1' },
                { ratingKey: '2', title: 'Movie 2' }
            ];

            const docItems = [
                { ratingKey: '3', title: 'Doc 1' },
                { ratingKey: '4', title: 'Doc 2' }
            ];

            mockGetPlexLibraries.mockResolvedValue(mockLibraries);
            mockPlexClient.query
                .mockResolvedValueOnce({
                    MediaContainer: { Metadata: movieItems }
                })
                .mockResolvedValueOnce({
                    MediaContainer: { Metadata: docItems }
                });

            const result = await plexSource.fetchMedia(['Movies', 'Documentaries'], 'movie', 3);

            expect(mockPlexClient.query).toHaveBeenCalledTimes(2);
            expect(mockPlexClient.query).toHaveBeenCalledWith('/library/sections/1/all');
            expect(mockPlexClient.query).toHaveBeenCalledWith('/library/sections/2/all');
            expect(mockProcessPlexItem).toHaveBeenCalledTimes(3);
        });
    });
});
