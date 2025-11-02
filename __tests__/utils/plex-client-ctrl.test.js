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
});
