// Realistic test for Jellyfin source that matches actual implementation
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const JellyfinSource = require('../../sources/jellyfin');

describe('Jellyfin Source', () => {
    let jellyfinSource;
    let mockServerConfig;
    let mockGetJellyfinClient;
    let mockProcessJellyfinItem;
    let mockGetJellyfinLibraries;
    let mockShuffleArray;
    let mockJellyfinClient;

    beforeEach(() => {
        mockServerConfig = {
            name: 'Test Jellyfin Server',
            host: 'jellyfin.test.local',
            port: 8096,
            token: 'test-jellyfin-token',
        };

        mockJellyfinClient = {
            getItems: jest.fn(),
            testConnection: jest.fn(),
        };

        mockGetJellyfinClient = jest.fn().mockResolvedValue(mockJellyfinClient);
        mockProcessJellyfinItem = jest
            .fn()
            .mockImplementation(item => ({ ...item, processed: true }));
        mockGetJellyfinLibraries = jest.fn();
        mockShuffleArray = jest.fn().mockImplementation(array => [...array].reverse());

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

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        test('should initialize with provided configuration', () => {
            expect(jellyfinSource.server).toBe(mockServerConfig);
            expect(jellyfinSource.getJellyfinClient).toBe(mockGetJellyfinClient);
            expect(jellyfinSource.processJellyfinItem).toBe(mockProcessJellyfinItem);
            expect(jellyfinSource.getJellyfinLibraries).toBe(mockGetJellyfinLibraries);
            expect(jellyfinSource.shuffleArray).toBe(mockShuffleArray);
            expect(jellyfinSource.rtMinScore).toBe(0);
            expect(jellyfinSource.isDebug).toBe(false);
        });

        test('should initialize with default metrics', () => {
            const metrics = jellyfinSource.getMetrics();
            expect(metrics.requestCount).toBe(0);
            expect(metrics.itemsProcessed).toBe(0);
            expect(metrics.itemsFiltered).toBe(0);
            expect(metrics.averageProcessingTime).toBe(0);
            expect(metrics.lastRequestTime).toBe(null);
            expect(metrics.errorCount).toBe(0);
            expect(metrics.filterEfficiency).toBe(0);
        });
    });

    describe('getMetrics', () => {
        test('should return current metrics with calculated filter efficiency', () => {
            jellyfinSource.metrics.itemsProcessed = 100;
            jellyfinSource.metrics.itemsFiltered = 80;

            const metrics = jellyfinSource.getMetrics();
            expect(metrics.filterEfficiency).toBe(0.8);
            expect(metrics.itemsProcessed).toBe(100);
            expect(metrics.itemsFiltered).toBe(80);
        });

        test('should handle zero itemsProcessed gracefully', () => {
            const metrics = jellyfinSource.getMetrics();
            expect(metrics.filterEfficiency).toBe(0);
        });
    });

    describe('resetMetrics', () => {
        test('should reset all metrics to initial state', () => {
            jellyfinSource.metrics.requestCount = 5;
            jellyfinSource.metrics.itemsProcessed = 100;
            jellyfinSource.metrics.errorCount = 2;

            jellyfinSource.resetMetrics();

            const metrics = jellyfinSource.getMetrics();
            expect(metrics.requestCount).toBe(0);
            expect(metrics.itemsProcessed).toBe(0);
            expect(metrics.itemsFiltered).toBe(0);
            expect(metrics.averageProcessingTime).toBe(0);
            expect(metrics.lastRequestTime).toBe(null);
            expect(metrics.errorCount).toBe(0);
        });
    });

    describe('fetchMedia', () => {
        beforeEach(() => {
            const mockLibraries = new Map([
                ['Movies', { id: 'library-1', name: 'Movies' }],
                ['TV Shows', { id: 'library-2', name: 'TV Shows' }],
            ]);
            mockGetJellyfinLibraries.mockResolvedValue(mockLibraries);
        });

        test('should return empty array for empty library names', async () => {
            const result = await jellyfinSource.fetchMedia([], 'movie', 5);
            expect(result).toEqual([]);
        });

        test('should return empty array for zero count', async () => {
            const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 0);
            expect(result).toEqual([]);
        });

        test('should return empty array for null library names', async () => {
            const result = await jellyfinSource.fetchMedia(null, 'movie', 5);
            expect(result).toEqual([]);
        });

        test('should fetch movies from Jellyfin successfully', async () => {
            const mockItems = {
                Items: [
                    { Id: '1', Name: 'Movie 1', Type: 'Movie' },
                    { Id: '2', Name: 'Movie 2', Type: 'Movie' },
                ],
            };
            mockJellyfinClient.getItems.mockResolvedValue(mockItems);

            const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 2);

            expect(mockGetJellyfinClient).toHaveBeenCalledWith(mockServerConfig);
            expect(mockGetJellyfinLibraries).toHaveBeenCalledWith(mockServerConfig);
            expect(mockJellyfinClient.getItems).toHaveBeenCalledWith({
                parentId: 'library-1',
                includeItemTypes: ['Movie'],
                recursive: true,
                fields: [
                    'Genres',
                    'Overview',
                    'CommunityRating',
                    'ProductionYear',
                    'RunTimeTicks',
                    'Taglines',
                    'OriginalTitle',
                ],
                sortBy: ['Random'],
                limit: 4, // count * 2
            });
            expect(mockProcessJellyfinItem).toHaveBeenCalledTimes(2);
            expect(result).toHaveLength(2);
        });

        test('should fetch TV shows from Jellyfin successfully', async () => {
            const mockItems = {
                Items: [
                    { Id: '1', Name: 'Series 1', Type: 'Series' },
                    { Id: '2', Name: 'Series 2', Type: 'Series' },
                ],
            };
            mockJellyfinClient.getItems.mockResolvedValue(mockItems);

            const result = await jellyfinSource.fetchMedia(['TV Shows'], 'show', 2);

            expect(mockJellyfinClient.getItems).toHaveBeenCalledWith({
                parentId: 'library-2',
                includeItemTypes: ['Series'],
                recursive: true,
                fields: [
                    'Genres',
                    'Overview',
                    'CommunityRating',
                    'ProductionYear',
                    'RunTimeTicks',
                    'Taglines',
                    'OriginalTitle',
                ],
                sortBy: ['Random'],
                limit: 4, // count * 2
            });
            expect(result).toHaveLength(2);
        });

        test('should handle multiple libraries', async () => {
            const mockItems = {
                Items: [{ Id: '1', Name: 'Movie 1', Type: 'Movie' }],
            };
            mockJellyfinClient.getItems.mockResolvedValue(mockItems);

            const result = await jellyfinSource.fetchMedia(['Movies', 'TV Shows'], 'movie', 3);

            expect(mockJellyfinClient.getItems).toHaveBeenCalledTimes(2);
            expect(result).toHaveLength(2); // One item from each library
        });

        test('should handle missing library gracefully', async () => {
            const mockItems = {
                Items: [{ Id: '1', Name: 'Movie 1', Type: 'Movie' }],
            };
            mockJellyfinClient.getItems.mockResolvedValue(mockItems);

            const result = await jellyfinSource.fetchMedia(['Movies', 'NonExistent'], 'movie', 2);

            expect(mockJellyfinClient.getItems).toHaveBeenCalledTimes(1); // Only for Movies library
            expect(result).toHaveLength(1);
        });

        test('should handle library fetch errors gracefully', async () => {
            const mockItems = {
                Items: [{ Id: '1', Name: 'Movie 1', Type: 'Movie' }],
            };
            mockJellyfinClient.getItems
                .mockResolvedValueOnce(mockItems) // First library succeeds
                .mockRejectedValueOnce(new Error('Library error')); // Second library fails

            const result = await jellyfinSource.fetchMedia(['Movies', 'TV Shows'], 'movie', 2);

            expect(result).toHaveLength(1); // Only items from successful library
        });

        test('should filter out null processed items', async () => {
            const mockItems = {
                Items: [
                    { Id: '1', Name: 'Movie 1', Type: 'Movie' },
                    { Id: '2', Name: 'Movie 2', Type: 'Movie' },
                ],
            };
            mockJellyfinClient.getItems.mockResolvedValue(mockItems);
            mockProcessJellyfinItem
                .mockResolvedValueOnce({ id: '1', processed: true })
                .mockResolvedValueOnce(null); // Second item returns null

            const result = await jellyfinSource.fetchMedia(['Movies'], 'movie', 2);

            expect(result).toHaveLength(1); // Null item filtered out
            expect(result[0].id).toBe('1');
        });

        test('should update metrics correctly', async () => {
            const mockItems = {
                Items: [{ Id: '1', Name: 'Movie 1', Type: 'Movie' }],
            };
            mockJellyfinClient.getItems.mockResolvedValue(mockItems);

            await jellyfinSource.fetchMedia(['Movies'], 'movie', 1);

            const metrics = jellyfinSource.getMetrics();
            expect(metrics.requestCount).toBe(1);
            expect(metrics.itemsProcessed).toBe(1);
            expect(metrics.itemsFiltered).toBe(1);
            expect(metrics.lastRequestTime).toBeInstanceOf(Date);
            expect(metrics.averageProcessingTime).toBeGreaterThan(0);
        });

        test('should handle client errors and update error count', async () => {
            mockGetJellyfinClient.mockRejectedValue(new Error('Connection failed'));

            await expect(jellyfinSource.fetchMedia(['Movies'], 'movie', 1)).rejects.toThrow(
                'Connection failed'
            );

            const metrics = jellyfinSource.getMetrics();
            expect(metrics.errorCount).toBe(1);
        });

        test('should enable debug logging when isDebug is true', async () => {
            const debugSource = new JellyfinSource(
                mockServerConfig,
                mockGetJellyfinClient,
                mockProcessJellyfinItem,
                mockGetJellyfinLibraries,
                mockShuffleArray,
                0,
                true // Debug enabled
            );

            const mockItems = {
                Items: [{ Id: '1', Name: 'Movie 1', Type: 'Movie' }],
            };
            mockJellyfinClient.getItems.mockResolvedValue(mockItems);

            await debugSource.fetchMedia(['Movies'], 'movie', 1);

            const logger = require('../../utils/logger');
            expect(logger.info).toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalled();
        });
    });

    describe('getServerInfo', () => {
        test('should return server information successfully', async () => {
            const mockInfo = {
                version: '10.8.0',
                serverName: 'My Jellyfin Server',
                id: 'jellyfin-server-id',
            };
            mockJellyfinClient.testConnection.mockResolvedValue(mockInfo);

            const result = await jellyfinSource.getServerInfo();

            expect(mockGetJellyfinClient).toHaveBeenCalledWith(mockServerConfig);
            expect(mockJellyfinClient.testConnection).toHaveBeenCalled();
            expect(result).toEqual({
                name: 'Test Jellyfin Server',
                type: 'jellyfin',
                version: '10.8.0',
                serverName: 'My Jellyfin Server',
                id: 'jellyfin-server-id',
                metrics: jellyfinSource.getMetrics(),
            });
        });

        test('should handle missing version/serverName/id gracefully', async () => {
            const mockInfo = {}; // Empty response
            mockJellyfinClient.testConnection.mockResolvedValue(mockInfo);

            const result = await jellyfinSource.getServerInfo();

            expect(result).toEqual({
                name: 'Test Jellyfin Server',
                type: 'jellyfin',
                version: 'Unknown',
                serverName: 'Unknown',
                id: 'Unknown',
                metrics: jellyfinSource.getMetrics(),
            });
        });

        test('should handle connection errors', async () => {
            mockGetJellyfinClient.mockRejectedValue(new Error('Connection failed'));

            await expect(jellyfinSource.getServerInfo()).rejects.toThrow('Connection failed');
        });

        test('should handle testConnection errors', async () => {
            mockJellyfinClient.testConnection.mockRejectedValue(
                new Error('Test connection failed')
            );

            await expect(jellyfinSource.getServerInfo()).rejects.toThrow('Test connection failed');
        });
    });
});
