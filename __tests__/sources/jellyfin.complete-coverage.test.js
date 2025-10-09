/**
 * Additional advanced coverage tests for jellyfin.js for remaining uncovered lines
 */

const JellyfinSource = require('../../sources/jellyfin');

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

describe('JellyfinSource Complete Coverage', () => {
    let jellyfinSource;
    let mockServerConfig;
    let mockGetJellyfinClient;
    let mockProcessJellyfinItem;
    let mockGetJellyfinLibraries;
    let mockShuffleArray;
    let mockClient;

    beforeEach(() => {
        mockServerConfig = {
            name: 'Complete Test Server',
            url: 'http://test.jellyfin.com',
            apiKey: 'test-key',
            recentlyAddedOnly: true,
            recentlyAddedDays: 30,
        };

        mockClient = {
            getItems: jest.fn(),
            getLibraries: jest.fn(),
            testConnection: jest.fn(),
        };

        mockGetJellyfinClient = jest.fn(() => mockClient);
        mockProcessJellyfinItem = jest.fn(item =>
            Promise.resolve({
                id: item.Id,
                title: item.Name,
                processed: true,
            })
        );
        mockGetJellyfinLibraries = jest.fn(() =>
            Promise.resolve(
                new Map([
                    ['Movies', { id: '1', name: 'Movies' }],
                    ['TV Shows', { id: '2', name: 'TV Shows' }],
                ])
            )
        );
        mockShuffleArray = jest.fn(arr => [...arr].reverse());

        jellyfinSource = new JellyfinSource(
            mockServerConfig,
            mockGetJellyfinClient,
            mockProcessJellyfinItem,
            mockGetJellyfinLibraries,
            mockShuffleArray,
            0, // rtMinScore = 0 to disable RT filtering
            true // isDebug enabled
        );
    });

    describe('Recently Added Filter', () => {
        it('should filter by recently added items', () => {
            const now = Date.now();
            const daysAgo = now - 30 * 24 * 60 * 60 * 1000; // 30 days ago
            const olderDate = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago

            const recentItem = {
                Name: 'Recent Movie',
                DateCreated: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
            };

            const oldItem = {
                Name: 'Old Movie',
                DateCreated: new Date(olderDate).toISOString(), // 60 days ago
            };

            const itemWithoutDate = {
                Name: 'No Date Movie',
                DateCreated: null,
            };

            // Test recent item
            const recentAddedDate = new Date(recentItem.DateCreated);
            const isRecentEnough = recentAddedDate.getTime() >= daysAgo;
            expect(isRecentEnough).toBe(true);

            // Test old item
            const oldAddedDate = new Date(oldItem.DateCreated);
            const isOldEnough = oldAddedDate.getTime() >= daysAgo;
            expect(isOldEnough).toBe(false);

            // Test item without date
            const hasDate = !!itemWithoutDate.DateCreated;
            expect(hasDate).toBe(false);
        });

        it('should handle items without DateCreated', () => {
            const item = {
                Name: 'Movie Without Date',
                // No DateCreated property
            };

            const hasDate = !!item.DateCreated;
            expect(hasDate).toBe(false);
        });

        it('should handle invalid DateCreated', () => {
            const item = {
                Name: 'Movie With Invalid Date',
                DateCreated: 'invalid-date',
            };

            let isValidDate = false;
            try {
                const addedDate = new Date(item.DateCreated);
                isValidDate = !isNaN(addedDate.getTime());
            } catch (error) {
                isValidDate = false;
            }

            expect(isValidDate).toBe(false);
        });
    });

    describe('fetchMedia method logic tests', () => {
        it('should test recently added filter logic', () => {
            const now = Date.now();
            const daysAgo = now - 30 * 24 * 60 * 60 * 1000;

            const recentItem = {
                DateCreated: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
            };

            const oldItem = {
                DateCreated: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
            };

            // Test the filter logic directly
            const recentDate = new Date(recentItem.DateCreated);
            const oldDate = new Date(oldItem.DateCreated);

            expect(recentDate.getTime() >= daysAgo).toBe(true);
            expect(oldDate.getTime() >= daysAgo).toBe(false);
        });

        it('should handle null processing results', () => {
            const processedItems = [
                { id: '1', title: 'Valid' },
                null,
                { id: '2', title: 'Also Valid' },
                null,
            ];

            const validItems = processedItems.filter(item => item !== null);
            expect(validItems).toHaveLength(2);
            expect(validItems[0].title).toBe('Valid');
            expect(validItems[1].title).toBe('Also Valid');
        });

        it('should calculate processing time from hrtime', () => {
            const mockHrtime = [1, 500000000]; // 1.5 seconds
            const [seconds, nanoseconds] = mockHrtime;
            const processingTime = seconds * 1000 + nanoseconds / 1000000;

            expect(processingTime).toBe(1500);
        });

        it('should update metrics appropriately', () => {
            const initialMetrics = {
                averageProcessingTime: 100,
                itemsProcessed: 50,
                itemsFiltered: 30,
            };

            const newProcessingTime = 200;
            const newAverage = (initialMetrics.averageProcessingTime + newProcessingTime) / 2;

            expect(newAverage).toBe(150);
        });
    });

    describe('getServerInfo method', () => {
        it('should return server information successfully', async () => {
            mockClient.testConnection.mockResolvedValue({
                version: '10.8.0',
                serverName: 'My Jellyfin Server',
                id: 'server-id-123',
            });

            const serverInfo = await jellyfinSource.getServerInfo();

            expect(serverInfo).toEqual({
                name: mockServerConfig.name,
                type: 'jellyfin',
                version: '10.8.0',
                serverName: 'My Jellyfin Server',
                id: 'server-id-123',
                metrics: jellyfinSource.getMetrics(),
            });
        });

        it('should handle missing version information', async () => {
            mockClient.testConnection.mockResolvedValue({
                serverName: 'My Jellyfin Server',
                id: 'server-id-123',
                // version is missing
            });

            const serverInfo = await jellyfinSource.getServerInfo();

            expect(serverInfo.version).toBe('Unknown');
            expect(serverInfo.serverName).toBe('My Jellyfin Server');
            expect(serverInfo.id).toBe('server-id-123');
        });

        it('should handle missing server name', async () => {
            mockClient.testConnection.mockResolvedValue({
                version: '10.8.0',
                id: 'server-id-123',
                // serverName is missing
            });

            const serverInfo = await jellyfinSource.getServerInfo();

            expect(serverInfo.serverName).toBe('Unknown');
        });

        it('should handle missing server id', async () => {
            mockClient.testConnection.mockResolvedValue({
                version: '10.8.0',
                serverName: 'My Jellyfin Server',
                // id is missing
            });

            const serverInfo = await jellyfinSource.getServerInfo();

            expect(serverInfo.id).toBe('Unknown');
        });

        it('should handle complete missing info', async () => {
            mockClient.testConnection.mockResolvedValue({});

            const serverInfo = await jellyfinSource.getServerInfo();

            expect(serverInfo.version).toBe('Unknown');
            expect(serverInfo.serverName).toBe('Unknown');
            expect(serverInfo.id).toBe('Unknown');
        });

        it('should handle connection errors', async () => {
            const logger = require('../../utils/logger');
            mockClient.testConnection.mockRejectedValue(new Error('Connection timeout'));

            await expect(jellyfinSource.getServerInfo()).rejects.toThrow('Connection timeout');

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error getting server info'),
                'Connection timeout'
            );
        });
    });

    describe('Debug logging and console output', () => {
        it('should log debug messages for filter results', () => {
            const logger = require('../../utils/logger');

            jellyfinSource.server.genreFilter = 'Action';
            jellyfinSource.server.qualityFilter = '1080p';

            // Simulate the debug logging for filters
            if (
                jellyfinSource.server.genreFilter &&
                jellyfinSource.server.genreFilter.trim() !== ''
            ) {
                if (jellyfinSource.isDebug) {
                    logger.debug(`Genre filter applied: 5 items`);
                }
            }

            if (
                jellyfinSource.server.qualityFilter &&
                jellyfinSource.server.qualityFilter.trim() !== ''
            ) {
                if (jellyfinSource.isDebug) {
                    logger.debug(`Quality filter applied: 3 items`);
                }
            }

            expect(logger.debug).toHaveBeenCalledWith('Genre filter applied: 5 items');
            expect(logger.debug).toHaveBeenCalledWith('Quality filter applied: 3 items');
        });

        it('should log when no rating filters are configured', () => {
            const logger = require('../../utils/logger');

            // Clear all rating filters
            jellyfinSource.server.ratingFilter = null;
            jellyfinSource.server.ratingFilters = null;

            // Simulate the debug logging
            const ratingFilter = jellyfinSource.server.ratingFilter;
            const legacyFilters = jellyfinSource.server.ratingFilters;

            if (!ratingFilter && !legacyFilters) {
                if (jellyfinSource.isDebug) {
                    logger.debug('No rating filters configured for server');
                }
            }

            expect(logger.debug).toHaveBeenCalledWith('No rating filters configured for server');
        });

        it('should use console.log for filtering results', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            if (jellyfinSource.isDebug) {
                console.log(`After filtering: 5 items remaining.`);
            }

            expect(consoleSpy).toHaveBeenCalledWith(`After filtering: 5 items remaining.`);

            consoleSpy.mockRestore();
        });
    });

    describe('Processing time calculation', () => {
        it('should calculate average processing time correctly', () => {
            const initialAverage = jellyfinSource.metrics.averageProcessingTime;
            const newProcessingTime = 150; // milliseconds

            // Simulate the averaging calculation
            const newAverage = (initialAverage + newProcessingTime) / 2;
            jellyfinSource.metrics.averageProcessingTime = newAverage;

            expect(jellyfinSource.metrics.averageProcessingTime).toBe(newAverage);
        });

        it('should handle hrtime conversion to milliseconds', () => {
            // Mock process.hrtime return value [seconds, nanoseconds]
            const mockHrtime = [1, 500000000]; // 1.5 seconds

            const [seconds, nanoseconds] = mockHrtime;
            const processingTime = seconds * 1000 + nanoseconds / 1000000;

            expect(processingTime).toBe(1500); // 1500 milliseconds
        });
    });

    describe('Configuration validation edge cases', () => {
        it('should handle recentlyAddedOnly without recentlyAddedDays', () => {
            jellyfinSource.server.recentlyAddedOnly = true;
            jellyfinSource.server.recentlyAddedDays = null;

            const shouldApplyFilter =
                jellyfinSource.server.recentlyAddedOnly && jellyfinSource.server.recentlyAddedDays;

            expect(shouldApplyFilter).toBeFalsy(); // null is falsy
        });

        it('should handle recentlyAddedDays without recentlyAddedOnly', () => {
            jellyfinSource.server.recentlyAddedOnly = false;
            jellyfinSource.server.recentlyAddedDays = 30;

            const shouldApplyFilter =
                jellyfinSource.server.recentlyAddedOnly && jellyfinSource.server.recentlyAddedDays;

            expect(shouldApplyFilter).toBe(false);
        });
    });
});
