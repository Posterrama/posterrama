#!/usr/bin/env node
/**
 * Mock Plex Response for Phase 2 Enriched Metadata Fields
 *
 * This script demonstrates what a fully enriched metadata.json would contain
 * when generated from a live Plex server with the XML data we analyzed.
 */

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║                                                                  ║');
console.log('║   PHASE 2: MOCK ENRICHED METADATA (Expected Structure)          ║');
console.log('║                                                                  ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// Simulate what processPlexItem() would extract from the XML
const mockEnrichedMetadata = {
    // Basic fields (already implemented)
    title: 'Sinners',
    year: 2025,
    tagline: 'Dance with the devil.',
    rating: 9.7,
    contentRating: 'R',
    overview:
        'From Ryan Coogler - director of "Black Panther" and "Creed" - and starring Michael B. Jordan, comes a new vision of fear: "Sinners." Trying to leave their troubled lives behind, twin brothers (Jordan) return to their hometown to start again, only to discover that an even greater evil is waiting to welcome them back.',

    // Phase 1 enriched fields (already implemented)
    collections: null, // Not in Sinners XML
    countries: ['United States of America'],
    audienceRating: 9.6,
    viewCount: null, // Not tracked for this item
    skipCount: 1,
    lastViewedAt: null,
    userRating: null,
    originalTitle: null,
    titleSort: null,

    // Phase 2 NEW enriched fields
    slug: 'sinners-2025',
    contentRatingAge: 16,
    addedAt: 1759537704000, // Converted to milliseconds
    updatedAt: 1759537704000,

    ultraBlurColors: {
        topLeft: '521707',
        topRight: '2b0c05',
        bottomRight: '50190f',
        bottomLeft: '8b1911',
    },

    ratingsDetailed: {
        imdb: {
            audience: {
                value: 7.6,
                image: 'imdb://image.rating',
            },
        },
        rottentomatoes: {
            critic: {
                value: 9.7,
                image: 'rottentomatoes://image.rating.ripe',
            },
            audience: {
                value: 9.6,
                image: 'rottentomatoes://image.rating.upright',
            },
        },
        themoviedb: {
            audience: {
                value: 7.5,
                image: 'themoviedb://image.rating',
            },
        },
    },

    parentalGuidance: {
        oneLiner: 'Violence, language in powerful, transporting monster movie.',
        recommendedAge: 16,
    },

    chapters: [
        {
            index: 1,
            startMs: 0,
            endMs: 481.815,
            thumbUrl: '/image?server=Plex%20Server&path=/library/media/363610/chapterImages/1',
        },
        {
            index: 2,
            startMs: 481.815,
            endMs: 980.438,
            thumbUrl: '/image?server=Plex%20Server&path=/library/media/363610/chapterImages/2',
        },
        {
            index: 3,
            startMs: 980.438,
            endMs: 1539.58,
            thumbUrl: '/image?server=Plex%20Server&path=/library/media/363610/chapterImages/3',
        },
        // ... 14 more chapters
        {
            index: 17,
            startMs: 8176.46,
            endMs: 8255.209,
            thumbUrl: '/image?server=Plex%20Server&path=/library/media/363610/chapterImages/17',
        },
    ],

    markers: [
        { type: 'credits', startMs: 7439.684, endMs: 7531.684, final: false },
        { type: 'credits', startMs: 7861.684, endMs: 8173.684, final: true },
    ],

    guids: [
        { source: 'plex', id: 'movie/65cc295b9e17522419e8553e' },
        { source: 'imdb', id: 'tt31193180' },
        { source: 'tmdb', id: '1233413' },
        { source: 'tvdb', id: '358595' },
    ],

    // Media technical details
    mediaStreams: [
        {
            videoResolution: '4k',
            videoCodec: 'hevc',
            audioCodec: 'truehd',
            audioChannels: 8,
        },
    ],

    // Existing enriched fields
    studios: ['Warner Bros. Pictures'],
    directors: ['Ryan Coogler'],
    writers: ['Ryan Coogler'],
    genres: ['Drama', 'Horror', 'Thriller', 'Action', 'Music', 'Fantasy', 'Suspense'],

    // Image flags
    images: {
        poster: true,
        background: true,
        clearlogo: true,
        thumbnail: true,
        fanartCount: 0,
        discart: false,
        banner: false,
    },
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('📋 PHASE 2 NEW FIELDS DEMONSTRATION\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('📌 slug:', `"${mockEnrichedMetadata.slug}"`);
console.log('   URL-friendly identifier for this item\n');

console.log('🔞 contentRatingAge:', mockEnrichedMetadata.contentRatingAge);
console.log(
    `   Numeric age (${mockEnrichedMetadata.contentRatingAge}) extracted from contentRating ("${mockEnrichedMetadata.contentRating}")\n`
);

console.log('⏭️  skipCount:', mockEnrichedMetadata.skipCount);
console.log('   Number of times user skipped this item\n');

console.log('📅 addedAt:', mockEnrichedMetadata.addedAt);
console.log(`   Added: ${new Date(mockEnrichedMetadata.addedAt).toISOString()}\n`);

console.log('📅 updatedAt:', mockEnrichedMetadata.updatedAt);
console.log(`   Updated: ${new Date(mockEnrichedMetadata.updatedAt).toISOString()}\n`);

console.log('🎨 ultraBlurColors:');
console.log(`   Perfect for UI theming and blur effects:`);
console.log(`   ┌─────────┬─────────┐`);
console.log(
    `   │ #${mockEnrichedMetadata.ultraBlurColors.topLeft}  │ #${mockEnrichedMetadata.ultraBlurColors.topRight}  │`
);
console.log(`   ├─────────┼─────────┤`);
console.log(
    `   │ #${mockEnrichedMetadata.ultraBlurColors.bottomLeft}  │ #${mockEnrichedMetadata.ultraBlurColors.bottomRight}  │`
);
console.log(`   └─────────┴─────────┘\n`);

console.log('⭐ ratingsDetailed:');
console.log('   Ratings broken down by source and type:');
Object.keys(mockEnrichedMetadata.ratingsDetailed).forEach(source => {
    console.log(`   ${source}:`);
    Object.keys(mockEnrichedMetadata.ratingsDetailed[source]).forEach(type => {
        const rating = mockEnrichedMetadata.ratingsDetailed[source][type];
        console.log(`      ${type}: ${rating.value}/10`);
    });
});
console.log('');

console.log('👨‍👩‍👧‍👦 parentalGuidance (CommonSenseMedia):');
console.log(`   "${mockEnrichedMetadata.parentalGuidance.oneLiner}"`);
console.log(`   Recommended age: ${mockEnrichedMetadata.parentalGuidance.recommendedAge}+\n`);

console.log(`📑 chapters: ${mockEnrichedMetadata.chapters.length} chapters`);
console.log('   Perfect for timeline preview UI:');
console.log(
    `   Chapter  1: ${mockEnrichedMetadata.chapters[0].startMs}ms - ${mockEnrichedMetadata.chapters[0].endMs}ms`
);
console.log(
    `   Chapter  2: ${mockEnrichedMetadata.chapters[1].startMs}ms - ${mockEnrichedMetadata.chapters[1].endMs}ms`
);
console.log(
    `   Chapter  3: ${mockEnrichedMetadata.chapters[2].startMs}ms - ${mockEnrichedMetadata.chapters[2].endMs}ms`
);
console.log(`   ... (14 more chapters)`);
console.log(
    `   Chapter 17: ${mockEnrichedMetadata.chapters[mockEnrichedMetadata.chapters.length - 1].startMs}ms - ${mockEnrichedMetadata.chapters[mockEnrichedMetadata.chapters.length - 1].endMs}ms`
);
console.log('   Each chapter includes thumbnail URL for preview\n');

console.log(`🏷️  markers: ${mockEnrichedMetadata.markers.length} markers`);
console.log('   Perfect for intro/credits skip functionality:');
mockEnrichedMetadata.markers.forEach((marker, i) => {
    console.log(
        `   [${i + 1}] ${marker.type}: ${marker.startMs}ms - ${marker.endMs}ms ${marker.final ? '(final)' : ''}`
    );
});
console.log('');

console.log(`🔗 guids: ${mockEnrichedMetadata.guids.length} external IDs`);
console.log('   Structured format with source identification:');
mockEnrichedMetadata.guids.forEach(guid => {
    console.log(`   ${guid.source.padEnd(8)} ${guid.id}`);
});
console.log('');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('💡 USE CASES FOR NEW FIELDS\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('🎨 UltraBlurColors:');
console.log('   - Dynamic UI theming based on poster colors');
console.log('   - Blur/glassmorphism effects');
console.log('   - Gradient backgrounds\n');

console.log('⭐ RatingsDetailed:');
console.log('   - Show multiple ratings side-by-side');
console.log('   - Filter by rating source (IMDb, RT, TMDB)');
console.log('   - Display critic vs audience differences\n');

console.log('📑 Chapters:');
console.log('   - Timeline scrubber with preview thumbnails');
console.log('   - Quick chapter navigation');
console.log('   - "Chapters" UI like Netflix\n');

console.log('🏷️  Markers:');
console.log('   - "Skip Intro" button');
console.log('   - "Skip Credits" button');
console.log('   - Auto-skip functionality\n');

console.log('👨‍👩‍👧‍👦 ParentalGuidance:');
console.log('   - Age-appropriate content filtering');
console.log('   - Parental controls');
console.log('   - Content warnings\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('✅ MOCK DATA COMPLETE\n');
console.log('   All Phase 2 fields demonstrated with real Plex XML data');
console.log('   New posterpacks will automatically include these fields\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Output the full structure as JSON for reference
console.log('\n📄 Full metadata.json structure:\n');
console.log(JSON.stringify(mockEnrichedMetadata, null, 2));
