/**
 * Comprehensive tests for jellyfin.js to improve coverage
 */

const JellyfinSource = require('../../sources/jellyfin');

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

describe('JellyfinSource', () => {
    let jellyfinSource;
    let mockServerConfig;
    let mockGetJellyfinClient;
    let mockProcessJellyfinItem;
    let mockGetJellyfinLibraries;
    let mockShuffleArray;
    let mockRtMinScore;

    beforeEach(() => {
        mockServerConfig = {
            name: 'Test Jellyfin Server',
            url: 'http://jellyfin.test',
            apiKey: 'test-api-key',
            ratingFilter: ['PG', 'PG-13'],
            genreFilter: ['Action', 'Comedy'],
            qualityFilter: ['1080p'],
        };

        mockGetJellyfinClient = jest.fn();
        mockProcessJellyfinItem = jest.fn();
        mockGetJellyfinLibraries = jest.fn();
        mockShuffleArray = jest.fn(arr => [...arr].reverse()); // Simple mock implementation
        mockRtMinScore = 50;

        jellyfinSource = new JellyfinSource(
            mockServerConfig,
            mockGetJellyfinClient,
            mockProcessJellyfinItem,
            mockGetJellyfinLibraries,
            mockShuffleArray,
            mockRtMinScore,
            false // isDebug
        );
    });

    describe('Constructor', () => {
        it('should initialize with server configuration', () => {
            expect(jellyfinSource.server).toBe(mockServerConfig);
            expect(jellyfinSource.getJellyfinClient).toBe(mockGetJellyfinClient);
            expect(jellyfinSource.processJellyfinItem).toBe(mockProcessJellyfinItem);
            expect(jellyfinSource.getJellyfinLibraries).toBe(mockGetJellyfinLibraries);
            expect(jellyfinSource.shuffleArray).toBe(mockShuffleArray);
            expect(jellyfinSource.rtMinScore).toBe(mockRtMinScore);
        });

        it('should initialize metrics', () => {
            expect(jellyfinSource.metrics).toEqual({
                requestCount: 0,
                itemsProcessed: 0,
                itemsFiltered: 0,
                averageProcessingTime: 0,
                lastRequestTime: null,
                errorCount: 0,
            });
        });

        it('should log rating configuration when debug is enabled', () => {
            new JellyfinSource(
                mockServerConfig,
                mockGetJellyfinClient,
                mockProcessJellyfinItem,
                mockGetJellyfinLibraries,
                mockShuffleArray,
                mockRtMinScore,
                true // isDebug
            );

            const logger = require('../../utils/logger');
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Initialized with rating configuration'),
                expect.any(Object)
            );
        });

        it('should handle server config without rating filters', () => {
            const configWithoutRating = { ...mockServerConfig };
            delete configWithoutRating.ratingFilter;
            delete configWithoutRating.ratingFilters;

            new JellyfinSource(
                configWithoutRating,
                mockGetJellyfinClient,
                mockProcessJellyfinItem,
                mockGetJellyfinLibraries,
                mockShuffleArray,
                mockRtMinScore,
                true // isDebug
            );

            const logger = require('../../utils/logger');
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Initialized with rating configuration'),
                expect.objectContaining({
                    ratingFilter: 'none',
                    legacyRatingFilters: 'none',
                })
            );
        });
    });

    describe('getMetrics', () => {
        it('should return default metrics when no data is cached', () => {
            const metrics = jellyfinSource.getMetrics();

            expect(metrics).toEqual({
                totalItems: 0,
                lastFetch: undefined,
                cacheDuration: 3600000,
                requestCount: 0,
                itemsProcessed: 0,
                itemsFiltered: 0,
                averageProcessingTime: 0,
                lastRequestTime: null,
                errorCount: 0,
                filterEfficiency: 0,
            });
        });

        it('should calculate filter efficiency correctly', () => {
            jellyfinSource.metrics.itemsProcessed = 100;
            jellyfinSource.metrics.itemsFiltered = 75;

            const metrics = jellyfinSource.getMetrics();
            expect(metrics.filterEfficiency).toBe(0.75);
        });

        it('should return cached media count when available', () => {
            jellyfinSource.cachedMedia = [
                { id: 1, title: 'Movie 1' },
                { id: 2, title: 'Movie 2' },
            ];
            jellyfinSource.lastFetch = new Date();

            const metrics = jellyfinSource.getMetrics();
            expect(metrics.totalItems).toBe(2);
            expect(metrics.lastFetch).toBeDefined();
        });

        it('should include all metric properties', () => {
            jellyfinSource.metrics = {
                requestCount: 5,
                itemsProcessed: 100,
                itemsFiltered: 80,
                averageProcessingTime: 250,
                lastRequestTime: new Date(),
                errorCount: 2,
            };

            const metrics = jellyfinSource.getMetrics();
            expect(metrics.requestCount).toBe(5);
            expect(metrics.averageProcessingTime).toBe(250);
            expect(metrics.errorCount).toBe(2);
            expect(metrics.lastRequestTime).toBeDefined();
        });
    });

    describe('getAvailableRatings', () => {
        it('should return empty array when no cached media', () => {
            const ratings = jellyfinSource.getAvailableRatings();
            expect(ratings).toEqual([]);
        });

        it('should extract unique ratings from cached media', () => {
            jellyfinSource.cachedMedia = [
                { title: 'Movie 1', rating: 'PG' },
                { title: 'Movie 2', rating: 'PG-13' },
                { title: 'Movie 3', rating: 'PG' }, // Duplicate
                { title: 'Movie 4', rating: 'R' },
            ];

            const ratings = jellyfinSource.getAvailableRatings();
            expect(ratings).toEqual(['PG', 'PG-13', 'R']); // Sorted and unique
        });

        it('should handle empty and whitespace ratings', () => {
            jellyfinSource.cachedMedia = [
                { title: 'Movie 1', rating: 'PG' },
                { title: 'Movie 2', rating: '' },
                { title: 'Movie 3', rating: '   ' },
                { title: 'Movie 4', rating: null },
                { title: 'Movie 5' }, // No rating property
                { title: 'Movie 6', rating: 'R' },
            ];

            const ratings = jellyfinSource.getAvailableRatings();
            expect(ratings).toEqual(['PG', 'R']);
        });

        it('should trim whitespace from ratings', () => {
            jellyfinSource.cachedMedia = [
                { title: 'Movie 1', rating: '  PG  ' },
                { title: 'Movie 2', rating: 'PG-13\n' },
                { title: 'Movie 3', rating: '\tR\t' },
            ];

            const ratings = jellyfinSource.getAvailableRatings();
            expect(ratings).toEqual(['PG', 'PG-13', 'R']);
        });

        it('should return sorted ratings', () => {
            jellyfinSource.cachedMedia = [
                { title: 'Movie 1', rating: 'R' },
                { title: 'Movie 2', rating: 'G' },
                { title: 'Movie 3', rating: 'PG-13' },
                { title: 'Movie 4', rating: 'PG' },
            ];

            const ratings = jellyfinSource.getAvailableRatings();
            expect(ratings).toEqual(['G', 'PG', 'PG-13', 'R']);
        });
    });

    describe('resetMetrics', () => {
        it('should reset all metrics to initial values', () => {
            // Set some non-zero metrics
            jellyfinSource.metrics = {
                requestCount: 10,
                itemsProcessed: 500,
                itemsFiltered: 400,
                averageProcessingTime: 150,
                lastRequestTime: new Date(),
                errorCount: 3,
            };

            jellyfinSource.resetMetrics();

            expect(jellyfinSource.metrics).toEqual({
                requestCount: 0,
                itemsProcessed: 0,
                itemsFiltered: 0,
                averageProcessingTime: 0,
                lastRequestTime: null,
                errorCount: 0,
            });
        });
    });

    describe('Error handling and edge cases', () => {
        it('should handle missing server configuration properties', () => {
            const minimalConfig = { name: 'Minimal Server' };

            const minimalJellyfinSource = new JellyfinSource(
                minimalConfig,
                mockGetJellyfinClient,
                mockProcessJellyfinItem,
                mockGetJellyfinLibraries,
                mockShuffleArray,
                mockRtMinScore,
                false
            );

            expect(minimalJellyfinSource.server).toBe(minimalConfig);
            expect(minimalJellyfinSource.getMetrics()).toBeDefined();
        });

        it('should handle null or undefined dependencies gracefully', () => {
            const jellyfinSourceWithNulls = new JellyfinSource(
                mockServerConfig,
                null,
                null,
                null,
                null,
                0,
                false
            );

            expect(jellyfinSourceWithNulls.getJellyfinClient).toBeNull();
            expect(jellyfinSourceWithNulls.processJellyfinItem).toBeNull();
            expect(jellyfinSourceWithNulls.rtMinScore).toBe(0);
        });

        it('should handle metrics calculation with zero itemsProcessed', () => {
            jellyfinSource.metrics.itemsProcessed = 0;
            jellyfinSource.metrics.itemsFiltered = 10; // This shouldn't happen but test edge case

            const metrics = jellyfinSource.getMetrics();
            expect(metrics.filterEfficiency).toBe(0);
        });
    });

    describe('Debug mode', () => {
        it('should not log when debug is disabled', () => {
            const logger = require('../../utils/logger');
            logger.info.mockClear();

            new JellyfinSource(
                mockServerConfig,
                mockGetJellyfinClient,
                mockProcessJellyfinItem,
                mockGetJellyfinLibraries,
                mockShuffleArray,
                mockRtMinScore,
                false // isDebug disabled
            );

            expect(logger.info).not.toHaveBeenCalled();
        });

        it('should log configuration when debug is enabled', () => {
            const logger = require('../../utils/logger');
            logger.info.mockClear();

            new JellyfinSource(
                mockServerConfig,
                mockGetJellyfinClient,
                mockProcessJellyfinItem,
                mockGetJellyfinLibraries,
                mockShuffleArray,
                mockRtMinScore,
                true // isDebug enabled
            );

            expect(logger.info).toHaveBeenCalledTimes(1);
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('[JellyfinSource:Test Jellyfin Server]'),
                expect.objectContaining({
                    ratingFilter: mockServerConfig.ratingFilter,
                    rtMinScore: mockRtMinScore,
                })
            );
        });
    });

    describe('Complex scenarios', () => {
        it('should handle complex rating filter configurations', () => {
            const complexConfig = {
                ...mockServerConfig,
                ratingFilter: ['G', 'PG', 'PG-13'],
                ratingFilters: ['R', 'NC-17'], // Legacy format
            };

            const complexJellyfinSource = new JellyfinSource(
                complexConfig,
                mockGetJellyfinClient,
                mockProcessJellyfinItem,
                mockGetJellyfinLibraries,
                mockShuffleArray,
                mockRtMinScore,
                true
            );

            expect(complexJellyfinSource.server.ratingFilter).toEqual(['G', 'PG', 'PG-13']);
            expect(complexJellyfinSource.server.ratingFilters).toEqual(['R', 'NC-17']);
        });

        it('should maintain separate metrics for different instances', () => {
            const secondJellyfinSource = new JellyfinSource(
                { ...mockServerConfig, name: 'Second Server' },
                mockGetJellyfinClient,
                mockProcessJellyfinItem,
                mockGetJellyfinLibraries,
                mockShuffleArray,
                mockRtMinScore,
                false
            );

            // Modify metrics of first instance
            jellyfinSource.metrics.requestCount = 5;

            // Second instance should have separate metrics
            expect(secondJellyfinSource.metrics.requestCount).toBe(0);
            expect(jellyfinSource.metrics.requestCount).toBe(5);
        });
    });
});
