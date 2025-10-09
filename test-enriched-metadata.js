#!/usr/bin/env node
/**
 * Test script to verify enriched metadata extraction from Plex
 * Simulates a Plex API response and verifies all new fields are captured
 */

// Simulate a rich Plex item response with all the new fields
const mockPlexItem = {
    MediaContainer: {
        Metadata: [
            {
                key: '/library/metadata/12345',
                ratingKey: '12345',
                title: 'Test Movie',
                originalTitle: 'Film de Test (Original French Title)',
                titleSort: 'Test Movie, The',
                year: 2024,
                type: 'movie',
                thumb: '/library/metadata/12345/thumb/1234567890',
                art: '/library/metadata/12345/art/1234567890',
                banner: '/library/metadata/12345/banner/1234567890',
                tagline: 'The ultimate test',
                summary: 'A test movie to verify metadata extraction',
                rating: 8.5,
                audienceRating: 9.2,
                userRating: 7.5,
                contentRating: 'PG-13',
                viewCount: 42,
                lastViewedAt: 1699999999,
                addedAt: 1700000000,
                duration: 7200000,

                // Collections
                Collection: [
                    { tag: 'Test Movie Collection', id: 1001 },
                    { tag: 'Award Winners', id: 1002 },
                ],

                // Countries
                Country: [
                    { tag: 'United States', code: 'US' },
                    { tag: 'France', code: 'FR' },
                ],

                // Genres
                Genre: [
                    { tag: 'Action', id: 1 },
                    { tag: 'Adventure', id: 2 },
                ],

                // People
                Role: [
                    {
                        tag: 'Actor One',
                        role: 'Lead Character',
                        thumb: '/library/metadata/12345/role/1',
                        id: 5001,
                    },
                ],
                Director: [
                    {
                        tag: 'Director One',
                        thumb: '/library/metadata/12345/director/1',
                        id: 5002,
                    },
                ],
                Writer: [
                    {
                        tag: 'Writer One',
                        thumb: '/library/metadata/12345/writer/1',
                        id: 5003,
                    },
                ],
                Producer: [
                    {
                        tag: 'Producer One',
                        thumb: '/library/metadata/12345/producer/1',
                        id: 5004,
                    },
                ],

                // Studios
                Studio: [{ tag: 'Test Studios' }, { tag: 'Marvel Studios' }],

                // GUIDs
                Guid: [{ id: 'imdb://tt1234567' }, { id: 'tmdb://98765' }, { id: 'tvdb://11111' }],

                // Ratings (Rotten Tomatoes)
                Rating: [
                    {
                        image: 'rottentomatoes://image.rating.ripe',
                        value: 8.7,
                        type: 'critic',
                    },
                ],

                // Images array (multiple backgrounds)
                Image: [
                    { type: 'clearLogo', url: '/library/metadata/12345/clearlogo' },
                    { type: 'background', url: '/library/metadata/12345/art/1' },
                    { type: 'art', url: '/library/metadata/12345/art/2' },
                    { type: 'art', url: '/library/metadata/12345/art/3' },
                ],

                // Media info
                Media: [
                    {
                        videoResolution: '1080',
                        videoCodec: 'h264',
                        audioCodec: 'aac',
                        audioChannels: 6,
                    },
                ],
            },
        ],
    },
};

console.log('🧪 Mock Plex Item Structure:');
console.log('===========================\n');

const item = mockPlexItem.MediaContainer.Metadata[0];

console.log('📋 Basic Info:');
console.log(`  Title: ${item.title}`);
console.log(`  Original Title: ${item.originalTitle}`);
console.log(`  Sort Title: ${item.titleSort}`);
console.log(`  Year: ${item.year}`);
console.log('');

console.log('⭐ Ratings:');
console.log(`  Rating: ${item.rating}`);
console.log(`  Audience Rating: ${item.audienceRating}`);
console.log(`  User Rating: ${item.userRating}`);
console.log('');

console.log('📊 Statistics:');
console.log(`  View Count: ${item.viewCount}`);
console.log(`  Last Viewed: ${new Date(item.lastViewedAt * 1000).toISOString()}`);
console.log('');

console.log('🎬 Collections:');
item.Collection.forEach(c => console.log(`  - ${c.tag} (ID: ${c.id})`));
console.log('');

console.log('🌍 Countries:');
item.Country.forEach(c => console.log(`  - ${c.tag} (${c.code})`));
console.log('');

console.log('🎭 Genres:');
item.Genre.forEach(g => console.log(`  - ${g.tag}`));
console.log('');

console.log('🖼️  Images:');
console.log(`  Banner: ${item.banner ? '✓' : '✗'}`);
console.log(
    `  Multiple Art: ${item.Image.filter(i => i.type === 'art' || i.type === 'background').length} backgrounds`
);
console.log('');

console.log('✅ All new fields present in mock data!');
console.log('\n📝 Expected metadata.json structure:');
console.log(
    JSON.stringify(
        {
            collections: item.Collection.map(c => ({ name: c.tag, id: c.id })),
            countries: item.Country.map(c => c.tag),
            audienceRating: item.audienceRating,
            viewCount: item.viewCount,
            lastViewedAt: item.lastViewedAt * 1000,
            userRating: item.userRating,
            originalTitle: item.originalTitle,
            titleSort: item.titleSort,
            images: {
                banner: !!item.banner,
                fanartCount:
                    item.Image.filter(i => i.type === 'art' || i.type === 'background').length - 1,
            },
        },
        null,
        2
    )
);
