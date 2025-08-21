const PlexSource = require('../../sources/plex');

describe('Plex Source - Enhanced Coverage', () => {
    let plexSource;
    let mockServerConfig;
    let mockGetPlexClient;
    let mockProcessPlexItem;
    let mockGetPlexLibraries;
    let mockShuffleArray;
    let mockPlexClient;

    beforeEach(() => {
        mockServerConfig = { name: 'Test Server', host: 'test.local', port: 32400, token: 'test' };
        mockPlexClient = { query: jest.fn() };
        mockGetPlexClient = jest.fn().mockReturnValue(mockPlexClient);
        mockProcessPlexItem = jest.fn().mockImplementation(item => ({ ...item, processed: true }));
        mockGetPlexLibraries = jest.fn();
        mockShuffleArray = jest.fn().mockImplementation(array => [...array]);
        plexSource = new PlexSource(
            mockServerConfig,
            mockGetPlexClient,
            mockProcessPlexItem,
            mockGetPlexLibraries,
            mockShuffleArray,
            0,
            false
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Content Filtering Edge Cases', () => {
        test('should handle empty rating filter', () => {
            const serverWithEmptyRating = { ...mockServerConfig, ratingFilter: '' };
            const plexSourceEmptyRating = new PlexSource(
                serverWithEmptyRating,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                false
            );

            const items = [
                { ratingKey: '1', contentRating: 'PG' },
                { ratingKey: '2', contentRating: 'R' },
            ];

            const result = plexSourceEmptyRating.applyContentFiltering(items);
            expect(result).toHaveLength(2);
        });

        test('should handle whitespace-only rating filter', () => {
            const serverWithWhitespaceRating = { ...mockServerConfig, ratingFilter: '   ' };
            const plexSourceWhitespace = new PlexSource(
                serverWithWhitespaceRating,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                false
            );

            const items = [{ ratingKey: '1', contentRating: 'PG' }];
            const result = plexSourceWhitespace.applyContentFiltering(items);
            expect(result).toHaveLength(1);
        });

        test('should handle empty genre filter', () => {
            const serverWithEmptyGenre = { ...mockServerConfig, genreFilter: '' };
            const plexSourceEmptyGenre = new PlexSource(
                serverWithEmptyGenre,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                false
            );

            const items = [{ ratingKey: '1', Genre: [{ tag: 'Action' }] }];
            const result = plexSourceEmptyGenre.applyContentFiltering(items);
            expect(result).toHaveLength(1);
        });

        test('should handle whitespace-only genre filter', () => {
            const serverWithWhitespaceGenre = { ...mockServerConfig, genreFilter: '   ' };
            const plexSourceWhitespace = new PlexSource(
                serverWithWhitespaceGenre,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                false
            );

            const items = [{ ratingKey: '1', Genre: [{ tag: 'Action' }] }];
            const result = plexSourceWhitespace.applyContentFiltering(items);
            expect(result).toHaveLength(1);
        });

        test('should handle items with no Genre property', () => {
            const serverWithGenre = { ...mockServerConfig, genreFilter: 'Action' };
            const plexSourceGenre = new PlexSource(
                serverWithGenre,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                false
            );

            const items = [
                { ratingKey: '1' }, // No Genre property
                { ratingKey: '2', Genre: null }, // Null Genre
                { ratingKey: '3', Genre: 'not-array' }, // Not an array
            ];

            const result = plexSourceGenre.applyContentFiltering(items);
            expect(result).toHaveLength(0);
        });

        test('should handle items with no addedAt for recently added filter', () => {
            const serverWithRecent = {
                ...mockServerConfig,
                recentlyAddedOnly: true,
                recentlyAddedDays: 7,
            };
            const plexSourceRecent = new PlexSource(
                serverWithRecent,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                false
            );

            const items = [
                { ratingKey: '1' }, // No addedAt
                { ratingKey: '2', addedAt: null }, // Null addedAt
            ];

            const result = plexSourceRecent.applyContentFiltering(items);
            expect(result).toHaveLength(0);
        });

        test('should handle empty quality filter', () => {
            const serverWithEmptyQuality = { ...mockServerConfig, qualityFilter: '' };
            const plexSourceEmptyQuality = new PlexSource(
                serverWithEmptyQuality,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                false
            );

            const items = [{ ratingKey: '1', Media: [{ videoResolution: '1080' }] }];
            const result = plexSourceEmptyQuality.applyContentFiltering(items);
            expect(result).toHaveLength(1);
        });

        test('should handle whitespace-only quality filter', () => {
            const serverWithWhitespaceQuality = { ...mockServerConfig, qualityFilter: '   ' };
            const plexSourceWhitespace = new PlexSource(
                serverWithWhitespaceQuality,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                false
            );

            const items = [{ ratingKey: '1', Media: [{ videoResolution: '1080' }] }];
            const result = plexSourceWhitespace.applyContentFiltering(items);
            expect(result).toHaveLength(1);
        });

        test('should handle items with no Media property for quality filter', () => {
            const serverWithQuality = { ...mockServerConfig, qualityFilter: '1080p' };
            const plexSourceQuality = new PlexSource(
                serverWithQuality,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                false
            );

            const items = [
                { ratingKey: '1' }, // No Media property
                { ratingKey: '2', Media: null }, // Null Media
                { ratingKey: '3', Media: 'not-array' }, // Not an array
            ];

            const result = plexSourceQuality.applyContentFiltering(items);
            expect(result).toHaveLength(0);
        });

        test('should handle all quality filter options', () => {
            const testQualityFilter = (filter, resolution, shouldMatch) => {
                const serverWithQuality = { ...mockServerConfig, qualityFilter: filter };
                const plexSourceQuality = new PlexSource(
                    serverWithQuality,
                    mockGetPlexClient,
                    mockProcessPlexItem,
                    mockGetPlexLibraries,
                    mockShuffleArray,
                    0,
                    false
                );

                const items = [{ ratingKey: '1', Media: [{ videoResolution: resolution }] }];
                const result = plexSourceQuality.applyContentFiltering(items);

                if (shouldMatch) {
                    expect(result).toHaveLength(1);
                } else {
                    expect(result).toHaveLength(0);
                }
            };

            // Test SD filter
            testQualityFilter('SD', 'sd', true);
            testQualityFilter('SD', '720', false);
            testQualityFilter('SD', undefined, true); // No resolution should match SD

            // Test 720p filter
            testQualityFilter('720p', '720', true);
            testQualityFilter('720p', 'hd', true);
            testQualityFilter('720p', '1080', false);

            // Test 1080p filter
            testQualityFilter('1080p', '1080', true);
            testQualityFilter('1080p', '720', false);

            // Test 4K filter
            testQualityFilter('4K', '4k', true);
            testQualityFilter('4K', '1080', false);

            // Test default case (unknown filter)
            testQualityFilter('UnknownQuality', 'anything', true);
        });
    });

    describe('Metrics Functionality', () => {
        test('should calculate filter efficiency correctly when no items processed', () => {
            const metrics = plexSource.getMetrics();
            expect(metrics.filterEfficiency).toBe(0);
        });

        test('should calculate filter efficiency correctly with processed items', () => {
            // Simulate some metrics
            plexSource.metrics.itemsProcessed = 10;
            plexSource.metrics.itemsFiltered = 3;

            const metrics = plexSource.getMetrics();
            expect(metrics.filterEfficiency).toBe(0.3);
        });

        test('should reset all metrics correctly', () => {
            // Set some metrics
            plexSource.metrics.requestCount = 5;
            plexSource.metrics.itemsProcessed = 10;
            plexSource.metrics.itemsFiltered = 3;
            plexSource.metrics.averageProcessingTime = 100;
            plexSource.metrics.lastRequestTime = new Date();
            plexSource.metrics.errorCount = 2;

            plexSource.resetMetrics();

            const metrics = plexSource.getMetrics();
            expect(metrics.requestCount).toBe(0);
            expect(metrics.itemsProcessed).toBe(0);
            expect(metrics.itemsFiltered).toBe(0);
            expect(metrics.averageProcessingTime).toBe(0);
            expect(metrics.lastRequestTime).toBeNull();
            expect(metrics.errorCount).toBe(0);
            expect(metrics.filterEfficiency).toBe(0);
        });
    });

    describe('fetchMedia Edge Cases', () => {
        test('should handle null processPlexItem result', async () => {
            mockProcessPlexItem.mockResolvedValue(null);

            const mockLibraries = new Map([['Movies', { key: '1', title: 'Movies' }]]);
            const mockMediaItems = [{ ratingKey: '1', title: 'Movie 1' }];

            mockGetPlexLibraries.mockResolvedValue(mockLibraries);
            mockPlexClient.query.mockResolvedValue({
                MediaContainer: { Metadata: mockMediaItems },
            });

            const result = await plexSource.fetchMedia(['Movies'], 'movie', 10);
            expect(result).toHaveLength(0);
        });

        test('should handle items without rottenTomatoes when rtMinScore is set', async () => {
            const plexSourceWithRating = new PlexSource(
                mockServerConfig,
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                7.0,
                false
            );

            mockProcessPlexItem.mockResolvedValue({ title: 'Movie without RT' });

            const mockLibraries = new Map([['Movies', { key: '1', title: 'Movies' }]]);
            const mockMediaItems = [{ ratingKey: '1', title: 'Movie 1' }];

            mockGetPlexLibraries.mockResolvedValue(mockLibraries);
            mockPlexClient.query.mockResolvedValue({
                MediaContainer: { Metadata: mockMediaItems },
            });

            const result = await plexSourceWithRating.fetchMedia(['Movies'], 'movie', 10);
            expect(result).toHaveLength(1); // Should pass through if no rottenTomatoes
        });

        test('should handle negative count (return all items)', async () => {
            const mockLibraries = new Map([['Movies', { key: '1', title: 'Movies' }]]);
            const mockMediaItems = [
                { ratingKey: '1', title: 'Movie 1' },
                { ratingKey: '2', title: 'Movie 2' },
                { ratingKey: '3', title: 'Movie 3' },
            ];

            mockGetPlexLibraries.mockResolvedValue(mockLibraries);
            mockPlexClient.query.mockResolvedValue({
                MediaContainer: { Metadata: mockMediaItems },
            });

            const result = await plexSource.fetchMedia(['Movies'], 'movie', -1);
            expect(result).toHaveLength(3); // Should return all items
        });
    });

    describe('Debug Logging', () => {
        test('should log debug information in content filtering when debug enabled', () => {
            const debugPlexSource = new PlexSource(
                {
                    ...mockServerConfig,
                    ratingFilter: 'PG-13',
                    genreFilter: 'Action',
                    recentlyAddedOnly: true,
                    recentlyAddedDays: 7,
                    qualityFilter: '1080p',
                },
                mockGetPlexClient,
                mockProcessPlexItem,
                mockGetPlexLibraries,
                mockShuffleArray,
                0,
                true
            );

            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            const now = Math.floor(Date.now() / 1000);
            const items = [
                {
                    ratingKey: '1',
                    contentRating: 'PG-13',
                    Genre: [{ tag: 'Action' }],
                    addedAt: now,
                    Media: [{ videoResolution: '1080' }],
                },
            ];

            debugPlexSource.applyContentFiltering(items);

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rating filter'));
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Genre filter'));
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Recently added filter')
            );
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Quality filter'));

            consoleSpy.mockRestore();
        });
    });
});
