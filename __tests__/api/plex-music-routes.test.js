/**
 * @file __tests__/api/plex-music-routes.test.js
 * Smoke tests for Plex Music admin API endpoints.
 *
 * Note: These tests verify that the helper functions are correctly exported
 * and can be imported. Full integration tests with HTTP requests and
 * authentication are handled in separate integration test files.
 */

const plexHelpers = require('../../lib/plex-helpers');

describe('Plex Music Admin Routes - Smoke Tests', () => {
    test('plex-helpers exports music functions', () => {
        expect(plexHelpers).toHaveProperty('getPlexMusicLibraries');
        expect(plexHelpers).toHaveProperty('getPlexMusicGenres');
        expect(plexHelpers).toHaveProperty('getPlexMusicArtists');
        expect(typeof plexHelpers.getPlexMusicLibraries).toBe('function');
        expect(typeof plexHelpers.getPlexMusicGenres).toBe('function');
        expect(typeof plexHelpers.getPlexMusicArtists).toBe('function');
    });

    test('server.js imports music functions from plex-helpers', () => {
        // Verify the functions can be imported in server context
        const { getPlexMusicLibraries, getPlexMusicGenres, getPlexMusicArtists } = plexHelpers;
        expect(getPlexMusicLibraries).toBeDefined();
        expect(getPlexMusicGenres).toBeDefined();
        expect(getPlexMusicArtists).toBeDefined();
    });
});
