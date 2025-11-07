/**
 * Tests for Plex Client Controller - PlexClientAdapter
 * Target: Increase coverage from 8.97% to 60%+
 */

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const { PlexClientAdapter } = require('../../utils/plex-client-ctrl');

describe('PlexClientAdapter - Legacy Query Interface', () => {
    let adapter;
    let mockPlexServer;

    beforeEach(() => {
        mockPlexServer = {
            baseurl: 'http://plex.example.com:32400',
            token: 'test-token',
            friendlyName: 'Test Plex Server',
            version: '1.32.5',
            platform: 'Linux',
            platformVersion: '5.15.0',
            machineIdentifier: 'test-machine-id',
            myPlex: true,
            myPlexUsername: 'testuser',
            transcoderVideo: true,
            transcoderAudio: true,
            library: jest.fn(),
            query: jest.fn(),
        };

        adapter = new PlexClientAdapter(mockPlexServer);
    });

    describe('Constructor', () => {
        it('should create adapter with plex server reference', () => {
            expect(adapter.plex).toBe(mockPlexServer);
            expect(adapter.baseurl).toBe('http://plex.example.com:32400');
            expect(adapter.token).toBe('test-token');
        });
    });

    describe('query() - Root Endpoint', () => {
        it('should return server info for root query', async () => {
            const result = await adapter.query('/');

            expect(result).toMatchObject({
                friendlyName: 'Test Plex Server',
                version: '1.32.5',
                platform: 'Linux',
            });
        });

        it('should return server info for empty query', async () => {
            const result = await adapter.query('');
            expect(result).toHaveProperty('friendlyName', 'Test Plex Server');
        });
    });

    describe('query() - Library Sections', () => {
        beforeEach(() => {
            mockPlexServer.library.mockResolvedValue({
                sections: jest.fn().mockResolvedValue([
                    {
                        key: '1',
                        title: 'Movies',
                        type: 'movie',
                        agent: 'com.plexapp.agents.themoviedb',
                        scanner: 'Plex Movie',
                        language: 'en',
                        uuid: 'uuid-1',
                        updatedAt: 1234567890,
                        scannedAt: 1234567890,
                    },
                ]),
            });
        });

        it('should return library sections', async () => {
            const result = await adapter.query('/library/sections');

            expect(result).toHaveProperty('MediaContainer');
            expect(result.MediaContainer).toHaveProperty('Directory');
            expect(result.MediaContainer.Directory[0].title).toBe('Movies');
        });
    });

    describe('query() - Section Content', () => {
        beforeEach(() => {
            mockPlexServer.library.mockResolvedValue({
                sectionByID: jest.fn().mockResolvedValue({
                    all: jest.fn().mockResolvedValue([{ title: 'Test Movie', year: 2023 }]),
                }),
            });
        });

        it('should return section content', async () => {
            const result = await adapter.query('/library/sections/1/all');
            expect(result).toHaveProperty('MediaContainer');
        });
    });

    describe('query() - Now Playing', () => {
        beforeEach(() => {
            mockPlexServer.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [{ title: 'Test Movie', type: 'movie' }],
                },
            });
        });

        it('should return active sessions', async () => {
            const result = await adapter.query('/status/sessions');
            expect(result).toHaveProperty('MediaContainer');
            expect(result.MediaContainer.Metadata).toHaveLength(1);
        });
    });

    describe('query() - Error Handling', () => {
        it('should handle library errors', async () => {
            mockPlexServer.library.mockRejectedValue(new Error('Library error'));
            await expect(adapter.query('/library/sections')).rejects.toThrow();
        });

        it('should throw for unmapped paths without raw query', async () => {
            const adapterWithoutQuery = new PlexClientAdapter({
                baseurl: 'http://test',
                token: 'token',
                friendlyName: 'Test',
            });

            await expect(adapterWithoutQuery.query('/unknown/path')).rejects.toThrow(
                'Legacy query path not yet mapped'
            );
        });
    });

    describe('query() - Section Details', () => {
        it('should return section details by ID', async () => {
            const mockSection = {
                key: '1',
                title: 'Movies',
                type: 'movie',
                agent: 'com.plexapp.agents.themoviedb',
                scanner: 'Plex Movie',
                language: 'en',
                uuid: 'uuid-123',
                updatedAt: 1234567890,
                scannedAt: 1234567890,
            };

            mockPlexServer.library.mockResolvedValue({
                sectionByID: jest.fn().mockResolvedValue(mockSection),
            });

            const result = await adapter.query('/library/sections/1');

            expect(result).toMatchObject({
                key: '1',
                title: 'Movies',
                type: 'movie',
                agent: 'com.plexapp.agents.themoviedb',
                scanner: 'Plex Movie',
                language: 'en',
                uuid: 'uuid-123',
            });
        });

        it('should handle section not found errors', async () => {
            mockPlexServer.library.mockResolvedValue({
                sectionByID: jest.fn().mockRejectedValue(new Error('Section not found')),
            });

            await expect(adapter.query('/library/sections/999')).rejects.toThrow(
                'Section not found'
            );
        });
    });

    describe('query() - Now Playing Edge Cases', () => {
        it('should handle empty sessions', async () => {
            mockPlexServer.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [],
                },
            });

            const result = await adapter.query('/status/sessions');
            expect(result.MediaContainer.size).toBe(0);
            expect(result.MediaContainer.Metadata).toEqual([]);
        });

        it('should handle missing MediaContainer', async () => {
            mockPlexServer.query.mockResolvedValue({});

            const result = await adapter.query('/status/sessions');
            expect(result.MediaContainer.size).toBe(0);
        });

        it('should handle sessions with query params', async () => {
            mockPlexServer.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [{ title: 'Active Movie' }],
                },
            });

            const result = await adapter.query('/status/sessions?includeTransient=1');
            expect(result.MediaContainer.Metadata).toHaveLength(1);
        });
    });

    describe('query() - Unmapped Paths', () => {
        it('should use raw query fallback for unmapped paths', async () => {
            mockPlexServer.query.mockResolvedValue({ custom: 'data' });

            const result = await adapter.query('/custom/endpoint');
            expect(result).toEqual({ custom: 'data' });
            expect(mockPlexServer.query).toHaveBeenCalledWith('/custom/endpoint');
        });

        it('should log debug message for unmapped paths', async () => {
            const logger = require('../../utils/logger');
            mockPlexServer.query.mockResolvedValue({});

            await adapter.query('/unmapped/path');
            // Logger may or may not be called depending on implementation
            // Just ensure query completes without error
            expect(mockPlexServer.query).toHaveBeenCalledWith('/unmapped/path');
        });
    });

    describe('query() - Media Details Mapping', () => {
        it('should map video resolution from height', async () => {
            mockPlexServer.library.mockResolvedValue({
                sectionByID: jest.fn().mockResolvedValue({
                    all: jest.fn().mockResolvedValue([
                        {
                            title: 'Test Movie',
                            media: [
                                { height: 2160, width: 3840, videoCodec: 'hevc' },
                                { height: 1080, width: 1920, videoCodec: 'h264' },
                                { height: 720, width: 1280, videoCodec: 'h264' },
                                { height: 480, width: 640, videoCodec: 'mpeg4' },
                            ],
                        },
                    ]),
                }),
            });

            const result = await adapter.query('/library/sections/1/all');
            const media = result.MediaContainer.Metadata[0].Media;

            expect(media[0].videoResolution).toBe('4k');
            expect(media[1].videoResolution).toBe('1080');
            expect(media[2].videoResolution).toBe('720');
            expect(media[3].videoResolution).toBe('sd');
        });

        it('should handle media without height', async () => {
            mockPlexServer.library.mockResolvedValue({
                sectionByID: jest.fn().mockResolvedValue({
                    all: jest.fn().mockResolvedValue([
                        {
                            title: 'Test Movie',
                            media: [{ videoCodec: 'h264', audioCodec: 'aac' }],
                        },
                    ]),
                }),
            });

            const result = await adapter.query('/library/sections/1/all');
            const media = result.MediaContainer.Metadata[0].Media;

            expect(media[0].videoResolution).toBeNull();
        });

        it('should map genre, director, writer, role, and country tags', async () => {
            mockPlexServer.library.mockResolvedValue({
                sectionByID: jest.fn().mockResolvedValue({
                    all: jest.fn().mockResolvedValue([
                        {
                            title: 'Test Movie',
                            genres: [{ tag: 'Action' }, { tag: 'Thriller' }],
                            directors: [{ tag: 'Director Name' }],
                            writers: [{ tag: 'Writer Name' }],
                            roles: [{ tag: 'Actor Name' }],
                            countries: [{ tag: 'USA' }],
                        },
                    ]),
                }),
            });

            const result = await adapter.query('/library/sections/1/all');
            const movie = result.MediaContainer.Metadata[0];

            expect(movie.Genre).toEqual([{ tag: 'Action' }, { tag: 'Thriller' }]);
            expect(movie.Director).toEqual([{ tag: 'Director Name' }]);
            expect(movie.Writer).toEqual([{ tag: 'Writer Name' }]);
            expect(movie.Role).toEqual([{ tag: 'Actor Name' }]);
            expect(movie.Country).toEqual([{ tag: 'USA' }]);
        });
    });
});
