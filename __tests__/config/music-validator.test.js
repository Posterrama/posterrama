const { validate } = require('../../config/validators');

describe('Music Media Item Validation', () => {
    describe('mediaItem validator', () => {
        test('accepts valid music item with all fields', () => {
            const musicItem = {
                key: '/library/metadata/12345',
                title: 'Dark Side of the Moon',
                type: 'music',
                posterUrl: 'https://example.com/album-cover.jpg',
                backdropUrl: 'https://example.com/artist-photo.jpg',
                year: 1973,
                rating: 9.5,
                source: 'plex',
                rottenTomatoesScore: null,
                artist: 'Pink Floyd',
                artistId: '54321',
                album: 'Dark Side of the Moon',
                albumId: '12345',
                genres: ['Progressive Rock', 'Psychedelic Rock'],
                styles: ['Art Rock', 'Space Rock'],
                moods: ['Atmospheric', 'Dark'],
            };

            const { error } = validate('mediaItem', musicItem);
            expect(error).toBeUndefined();
        });

        test('accepts music item with minimal fields', () => {
            const musicItem = {
                key: '/library/metadata/12345',
                title: 'Unknown Album',
                type: 'music',
                source: 'plex',
            };

            const { error } = validate('mediaItem', musicItem);
            expect(error).toBeUndefined();
        });

        test('accepts music item with artist but no other music fields', () => {
            const musicItem = {
                key: '/library/metadata/12345',
                title: 'Greatest Hits',
                type: 'music',
                source: 'plex',
                artist: 'Queen',
            };

            const { error } = validate('mediaItem', musicItem);
            expect(error).toBeUndefined();
        });

        test('accepts empty genres/styles/moods arrays', () => {
            const musicItem = {
                key: '/library/metadata/12345',
                title: 'Album',
                type: 'music',
                source: 'plex',
                genres: [],
                styles: [],
                moods: [],
            };

            const { error } = validate('mediaItem', musicItem);
            expect(error).toBeUndefined();
        });

        test('rejects invalid type for music item', () => {
            const musicItem = {
                key: '/library/metadata/12345',
                title: 'Album',
                type: 'invalid-type',
                source: 'plex',
            };

            expect(() => validate('mediaItem', musicItem)).toThrow(/type.*must be one of/i);
        });

        test('rejects music item without required fields', () => {
            const musicItem = {
                title: 'Album',
                type: 'music',
                // Missing key and source
            };

            expect(() => validate('mediaItem', musicItem)).toThrow(/required/i);
        });

        test('music-specific fields not present on movie items', () => {
            const movieItem = {
                key: '/library/metadata/12345',
                title: 'The Matrix',
                type: 'movie',
                source: 'plex',
                artist: 'Should not be here',
                album: 'Should not be here',
            };

            // Validator allows these fields but doesn't require them
            // The application should filter them out based on type
            const { error } = validate('mediaItem', movieItem);
            expect(error).toBeUndefined();
        });

        test('accepts music item with URIs containing special characters', () => {
            const musicItem = {
                key: '/library/metadata/12345',
                title: 'AC/DC - Back in Black',
                type: 'music',
                posterUrl: 'https://example.com/album?id=123&size=large',
                source: 'plex',
                artist: 'AC/DC',
            };

            const { error } = validate('mediaItem', musicItem);
            expect(error).toBeUndefined();
        });

        test('validates year range for music items', () => {
            const musicItemValid = {
                key: '/library/metadata/12345',
                title: 'Album',
                type: 'music',
                source: 'plex',
                year: 2023,
            };

            const { error: errorValid } = validate('mediaItem', musicItemValid);
            expect(errorValid).toBeUndefined();

            const musicItemInvalid = {
                key: '/library/metadata/12345',
                title: 'Album',
                type: 'music',
                source: 'plex',
                year: 3000, // Invalid: > 2100
            };

            expect(() => validate('mediaItem', musicItemInvalid)).toThrow(/year.*2100/i);
        });

        test('validates rating range for music items', () => {
            const musicItemValid = {
                key: '/library/metadata/12345',
                title: 'Album',
                type: 'music',
                source: 'plex',
                rating: 8.5,
            };

            const { error: errorValid } = validate('mediaItem', musicItemValid);
            expect(errorValid).toBeUndefined();

            const musicItemInvalid = {
                key: '/library/metadata/12345',
                title: 'Album',
                type: 'music',
                source: 'plex',
                rating: 15, // Invalid: > 10
            };

            expect(() => validate('mediaItem', musicItemInvalid)).toThrow(/rating.*10/i);
        });
    });
});
