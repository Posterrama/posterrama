/**
 * Tests for parallel media fetching in media-aggregator.js
 * Verifies that sources are fetched in parallel and performance is improved
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
const TMDBSource = require('../../sources/tmdb.js');

describe('Media Aggregator - Parallel Fetching (#20)', () => {
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

    describe('Parallel server fetching', () => {
        test('should fetch from multiple Plex servers in parallel', async () => {
            const startTimes = [];
            const endTimes = [];

            // Mock two Plex servers with delays
            PlexSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async (_libraries, type) => {
                    startTimes.push(Date.now());
                    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate 100ms fetch
                    endTimes.push(Date.now());
                    return type === 'movie' ? [{ id: 'movie1', title: 'Test Movie' }] : [];
                }),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
            }));

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Plex Server 1',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
                {
                    type: 'plex',
                    name: 'Plex Server 2',
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

            // Verify both servers were called
            expect(PlexSource).toHaveBeenCalledTimes(2);

            // Verify parallel execution: start times should be close together
            if (startTimes.length >= 2) {
                const timeDiff = Math.abs(startTimes[1] - startTimes[0]);
                expect(timeDiff).toBeLessThan(50); // Started within 50ms of each other
            }

            // Verify results were aggregated
            expect(result.length).toBeGreaterThan(0);
        });

        test('should continue fetching if one server fails', async () => {
            PlexSource.mockImplementation(server => ({
                fetchMedia: jest.fn(async () => {
                    if (server.name === 'Plex Server 1') {
                        throw new Error('Server 1 failed');
                    }
                    return [{ id: 'movie1', title: 'Test Movie' }];
                }),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
            }));

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Plex Server 1',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
                {
                    type: 'plex',
                    name: 'Plex Server 2',
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

            // Verify server 2's media was still fetched
            expect(result.length).toBeGreaterThan(0);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed'),
                expect.any(Object)
            );
        });
    });

    describe('Parallel source types fetching', () => {
        test('should fetch media servers, TMDB, and local in parallel', async () => {
            const fetchTimes = { servers: null, tmdb: null, local: null };

            // Mock Plex server
            PlexSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async () => {
                    const start = Date.now();
                    await new Promise(resolve => setTimeout(resolve, 50));
                    fetchTimes.servers = Date.now() - start;
                    return [{ id: 'plex1', title: 'Plex Movie' }];
                }),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
            }));

            // Mock TMDB
            TMDBSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async () => {
                    const start = Date.now();
                    await new Promise(resolve => setTimeout(resolve, 50));
                    if (!fetchTimes.tmdb) fetchTimes.tmdb = Date.now() - start;
                    return [{ id: 'tmdb1', title: 'TMDB Movie' }];
                }),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
                cleanupCache: jest.fn(),
            }));

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

            const totalStart = Date.now();
            const result = await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });
            const totalTime = Date.now() - totalStart;

            // Total time should be less than sum of individual times (proving parallelism)
            // Each takes ~50ms, so sequential would be ~100ms+
            // Parallel should be ~50-80ms, allow 110ms for CI/slow systems
            expect(totalTime).toBeLessThan(110);

            // Verify both sources returned data
            expect(result.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Performance improvements', () => {
        test('should be significantly faster than sequential', async () => {
            // Mock 3 servers, each taking 50ms
            PlexSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async () => {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    return [{ id: 'movie1', title: 'Test Movie' }];
                }),
                getMetrics: jest.fn(() => ({ lastFetch: new Date().toISOString() })),
            }));

            mockConfig.mediaServers = [
                {
                    type: 'plex',
                    name: 'Server 1',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
                {
                    type: 'plex',
                    name: 'Server 2',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
                {
                    type: 'plex',
                    name: 'Server 3',
                    enabled: true,
                    movieLibraryNames: ['Movies'],
                    showLibraryNames: [],
                },
            ];

            const start = Date.now();
            await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });
            const duration = Date.now() - start;

            // Sequential would be 3 * 50ms = 150ms+
            // Parallel should be ~50-80ms
            expect(duration).toBeLessThan(100);

            // Verify parallel fetch log message
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Parallel Fetch'),
                expect.any(Object)
            );
        });
    });

    describe('Error resilience', () => {
        test('should handle complete source failures gracefully', async () => {
            PlexSource.mockImplementation(() => {
                throw new Error('Plex initialization failed');
            });

            TMDBSource.mockImplementation(() => ({
                fetchMedia: jest.fn(async () => {
                    throw new Error('TMDB API down');
                }),
                getMetrics: jest.fn(() => ({})),
                cleanupCache: jest.fn(),
            }));

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
            };

            // Should not throw, should return empty array
            const result = await getPlaylistMedia({
                config: mockConfig,
                processPlexItem: mockProcessPlexItem,
                shuffleArray: mockShuffleArray,
                localDirectorySource: null,
                logger: mockLogger,
                isDebug: false,
            });

            expect(result).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });
});
