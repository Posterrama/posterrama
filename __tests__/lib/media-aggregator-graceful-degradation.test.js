/**
 * Tests for graceful degradation in media-aggregator.js (Issue #97 Phase 5)
 * Verifies that partial source failures don't break entire aggregation
 */

const { getPlaylistMedia } = require('../../lib/media-aggregator');

// Mock all source dependencies
jest.mock('../../sources/plex.js');
jest.mock('../../sources/jellyfin.js');
jest.mock('../../sources/tmdb.js');
jest.mock('../../sources/romm.js');
jest.mock('../../lib/plex-helpers.js');
jest.mock('../../lib/jellyfin-helpers.js');

const PlexSource = require('../../sources/plex.js');
const JellyfinSource = require('../../sources/jellyfin.js');
const TMDBSource = require('../../sources/tmdb.js');

describe('Media Aggregator - Graceful Degradation (#97)', () => {
    let mockLogger;
    let mockConfig;
    let mockProcessPlexItem;
    let mockShuffleArray;

    beforeEach(() => {
        jest.clearAllMocks();

        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        mockProcessPlexItem = jest.fn(item => item);
        mockShuffleArray = jest.fn(arr => arr);

        mockConfig = {
            mediaServers: [],
            rottenTomatoesMinimumScore: 7,
            tmdbSource: null,
            localDirectory: null,
            streamingSources: [],
        };
    });

    describe('Partial source failures', () => {
        test('should continue when one Plex server fails', async () => {
            // Mock server that fails during construction/initialization
            PlexSource.mockImplementation(server => {
                if (server.name === 'Plex 1') {
                    throw new Error('Plex 1 connection timeout');
                }
                return {
                    fetchMedia: jest.fn(async (_libraries, type) =>
                        type === 'movie'
                            ? [{ id: `${server.name}-movie`, title: 'Test Movie' }]
                            : []
                    ),
                    getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
                };
            });

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Plex 1',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
                {
                    type: 'plex',
                    name: 'Plex 2',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
            ];

            const result = await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });

            // Should have media from Plex 2
            expect(result.media).toBeDefined();
            expect(result.media.length).toBe(1);
            expect(result.media[0].id).toBe('Plex 2-movie');

            // Should track error from Plex 1
            expect(result.errors).toBeDefined();
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toMatchObject({
                source: 'Plex 1',
                type: 'plex',
                operation: 'fetchMedia',
                message: expect.stringContaining('timeout'),
            });
        });

        test('should continue when TMDB fails but Plex succeeds', async () => {
            PlexSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async (_libraries, type) =>
                    type === 'movie' ? [{ id: 'plex-movie-1', title: 'Plex Movie' }] : []
                ),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
            }));

            // Mock TMDB constructor to throw - simulating complete TMDB failure
            TMDBSource.mockImplementation(() => {
                throw new Error('TMDB rate limit exceeded');
            });

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Plex Server',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
            ];

            mockConfig.tmdbSource = {
                enabled: true,
                apiKey: 'test-key',
                name: 'TMDB',
            };

            const result = await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });

            // Should have Plex media
            expect(result.media.length).toBe(1);
            expect(result.media[0].id).toBe('plex-movie-1');

            // Should track TMDB error
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toMatchObject({
                source: 'TMDB',
                type: 'tmdb',
                operation: 'fetchMedia',
                message: expect.stringContaining('rate limit'),
            });

            // Should log warning about partial failure
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Completed with'),
                expect.objectContaining({
                    errorSources: 'TMDB',
                })
            );
        });

        test('should continue when Jellyfin fails but others succeed', async () => {
            PlexSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async () => [{ id: 'plex-1', title: 'Plex Movie' }]),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
            }));

            // Mock Jellyfin to throw during construction
            JellyfinSource.mockImplementation(() => {
                throw new Error('Jellyfin authentication failed');
            });

            // TMDB returns both movies and tv results
            TMDBSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async type =>
                    type === 'movie'
                        ? [{ id: 'tmdb-movie-1', title: 'TMDB Movie' }]
                        : [{ id: 'tmdb-tv-1', title: 'TMDB TV Show' }]
                ),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
                cleanupCache: jest.fn(),
            }));

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Plex',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
                {
                    type: 'jellyfin',
                    name: 'Jellyfin',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
            ];

            mockConfig.tmdbSource = {
                enabled: true,
                apiKey: 'test-key',
                name: 'TMDB',
            };

            const result = await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });

            // Should have media from Plex (1) and TMDB (2: movie + tv)
            expect(result.media.length).toBeGreaterThanOrEqual(3);

            // Should track Jellyfin error
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toMatchObject({
                source: 'Jellyfin',
                type: 'jellyfin',
                operation: 'fetchMedia',
                message: expect.stringContaining('authentication'),
            });
        });

        test('should handle multiple source failures gracefully', async () => {
            // Both servers fail during construction
            PlexSource.mockImplementation(() => {
                throw new Error('Plex network error');
            });

            JellyfinSource.mockImplementation(() => {
                throw new Error('Jellyfin timeout');
            });

            // TMDB returns both movies and tv
            TMDBSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async type =>
                    type === 'movie'
                        ? [{ id: 'tmdb-movie-1', title: 'TMDB Movie' }]
                        : [{ id: 'tmdb-tv-1', title: 'TMDB TV' }]
                ),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
                cleanupCache: jest.fn(),
            }));

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Plex',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
                {
                    type: 'jellyfin',
                    name: 'Jellyfin',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
            ];

            mockConfig.tmdbSource = {
                enabled: true,
                apiKey: 'test-key',
                name: 'TMDB',
            };

            const result = await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });

            // Should still have TMDB media (movies + tv)
            expect(result.media.length).toBeGreaterThanOrEqual(2);

            // Should track both errors
            expect(result.errors.length).toBe(2);
            expect(result.errors).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        source: 'Plex',
                        type: 'plex',
                        operation: 'fetchMedia',
                    }),
                    expect.objectContaining({
                        source: 'Jellyfin',
                        type: 'jellyfin',
                        operation: 'fetchMedia',
                    }),
                ])
            );

            // Should log warning with all error sources
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Completed with 2 source error'),
                expect.objectContaining({
                    errorSources: expect.stringMatching(/Plex.*Jellyfin|Jellyfin.*Plex/),
                })
            );
        });

        test('should return empty media with errors when all sources fail', async () => {
            // All sources fail during construction
            PlexSource.mockImplementation(() => {
                throw new Error('Plex down');
            });

            TMDBSource.mockImplementation(() => {
                throw new Error('TMDB down');
            });

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Plex',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
            ];

            mockConfig.tmdbSource = {
                enabled: true,
                apiKey: 'test-key',
                name: 'TMDB',
            };

            const result = await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });

            // Should have no media
            expect(result.media).toEqual([]);

            // Should track all errors
            expect(result.errors.length).toBe(2);
        });
    });

    describe('Error structure validation', () => {
        test('should include all required error fields', async () => {
            PlexSource.mockImplementation(() => {
                const err = new Error('Network timeout');
                err.code = 'ETIMEDOUT';
                throw err;
            });

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Plex Server',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
            ];

            const result = await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });

            expect(result.errors.length).toBe(1);
            const error = result.errors[0];

            // Verify all required fields
            expect(error).toHaveProperty('source');
            expect(error).toHaveProperty('type');
            expect(error).toHaveProperty('operation');
            expect(error).toHaveProperty('message');
            expect(error).toHaveProperty('timestamp');

            expect(error.source).toBe('Plex Server');
            expect(error.type).toBe('plex');
            expect(error.operation).toBe('fetchMedia');
            expect(error.message).toContain('timeout');
            expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
        });
    });

    describe('Success without errors', () => {
        test('should return empty errors array when all sources succeed', async () => {
            PlexSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async () => [{ id: 'plex-1', title: 'Plex Movie' }]),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
            }));

            // TMDB returns both movies and tv
            TMDBSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async type =>
                    type === 'movie'
                        ? [{ id: 'tmdb-movie-1', title: 'TMDB Movie' }]
                        : [{ id: 'tmdb-tv-1', title: 'TMDB TV' }]
                ),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
                cleanupCache: jest.fn(),
            }));

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Plex',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
            ];

            mockConfig.tmdbSource = {
                enabled: true,
                apiKey: 'test-key',
                name: 'TMDB',
            };

            const result = await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });

            expect(result.media.length).toBeGreaterThanOrEqual(3);
            expect(result.errors).toEqual([]);

            // Should log success message
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('completed successfully'),
                expect.any(Object)
            );
        });
    });
});
