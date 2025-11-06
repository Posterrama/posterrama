#!/usr/bin/env node

/**
 * Test script to validate metadata extraction against Plex XML
 * Compares our extraction with raw Plex data for Black Phone 2
 */

const axios = require('axios');

const PLEX_SERVER = 'http://192.168.10.25:32400';
const PLEX_TOKEN = 'ZeYnLxQRS39361p8mQXz';
const RATING_KEY = '277048'; // Black Phone 2

async function getPlexRawData() {
    const url = `${PLEX_SERVER}/library/metadata/${RATING_KEY}?X-Plex-Token=${PLEX_TOKEN}`;
    const response = await axios.get(url, {
        headers: { Accept: 'application/json' },
    });
    return response.data.MediaContainer.Metadata[0];
}

async function getPosterramaExtraction() {
    // Simply fetch from our API endpoint - force a fresh fetch by using a filter
    const response = await axios.get(`${PLEX_SERVER}/library/metadata/${RATING_KEY}`, {
        headers: { Accept: 'application/json' },
        params: { 'X-Plex-Token': PLEX_TOKEN },
    });

    const rawItem = response.data.MediaContainer.Metadata[0];

    // Now manually process using our helper (simulate what the adapter does)
    const { processPlexItem } = require('./lib/plex-helpers');

    const serverConfig = {
        type: 'plex',
        name: 'Plex Server',
        hostname: '192.168.10.25',
        port: 32400,
        tokenEnvVar: 'PLEX_TOKEN',
    };

    // Create a mock plex client
    const mockPlex = {
        query: async path => {
            const url = `${PLEX_SERVER}${path}`;
            const resp = await axios.get(url, {
                headers: { Accept: 'application/json' },
                params: { 'X-Plex-Token': PLEX_TOKEN },
            });
            return resp.data;
        },
    };

    const processed = await processPlexItem(
        { ...rawItem, librarySectionTitle: 'Upcoming' },
        serverConfig,
        mockPlex,
        false
    );

    return processed;
}

function compareFields(plexData, ourData) {
    console.log('='.repeat(80));
    console.log('METADATA EXTRACTION COMPARISON - Black Phone 2');
    console.log('='.repeat(80));
    console.log();

    // Define field mappings: Plex field -> Our field
    const fieldMappings = [
        ['title', 'title'],
        ['tagline', 'tagline'],
        ['summary', 'overview'],
        ['rating', 'rating'],
        ['audienceRating', 'audienceRating'],
        ['ratingImage', 'ratingImage'],
        ['audienceRatingImage', 'audienceRatingImage'],
        ['ratingCount', 'ratingCount'],
        ['year', 'year'],
        ['contentRating', 'contentRating'],
        ['contentRatingAge', 'contentRatingAge'],
        ['studio', 'studios'],
        ['originalTitle', 'originalTitle'],
        ['slug', 'slug'],
        ['viewOffset', 'viewOffset'],
        ['viewCount', 'viewCount'],
        ['lastViewedAt', 'lastViewedAt'],
        ['hero', 'heroUrl'],
        ['primaryExtraKey', 'primaryExtraKey'],
        ['chapterSource', 'chapterSource'],
        ['addedAt', 'addedAt'],
        ['updatedAt', 'updatedAt'],
        ['originallyAvailableAt', 'releaseDate'],
        ['duration', 'runtimeMs'],
    ];

    const results = {
        correct: [],
        missing: [],
        incorrect: [],
        nullInPlex: [],
    };

    fieldMappings.forEach(([plexField, ourField]) => {
        const plexValue = plexData[plexField];
        const ourValue = ourData?.[ourField];

        if (plexValue === null || plexValue === undefined) {
            results.nullInPlex.push({ plexField, ourField, plexValue, ourValue });
        } else if (ourValue === null || ourValue === undefined) {
            results.missing.push({ plexField, ourField, plexValue, ourValue });
        } else if (plexField === 'studio' && Array.isArray(ourValue)) {
            // Special case: studio is string in Plex, array in our data
            if (ourValue.includes(plexValue)) {
                results.correct.push({ plexField, ourField, plexValue, ourValue });
            } else {
                results.incorrect.push({ plexField, ourField, plexValue, ourValue });
            }
        } else if (
            typeof plexValue === typeof ourValue ||
            (Array.isArray(plexValue) && Array.isArray(ourValue))
        ) {
            results.correct.push({ plexField, ourField, plexValue, ourValue });
        } else {
            results.incorrect.push({ plexField, ourField, plexValue, ourValue });
        }
    });

    // Print results
    console.log('✅ CORRECTLY EXTRACTED FIELDS:');
    console.log('-'.repeat(80));
    results.correct.forEach(({ plexField, ourField, plexValue }) => {
        const displayValue =
            typeof plexValue === 'string' && plexValue.length > 50
                ? plexValue.substring(0, 50) + '...'
                : JSON.stringify(plexValue);
        console.log(`  ${plexField} → ${ourField}: ${displayValue}`);
    });
    console.log();

    if (results.nullInPlex.length > 0) {
        console.log('⚪ NULL IN PLEX (Expected to be null in our data):');
        console.log('-'.repeat(80));
        results.nullInPlex.forEach(({ plexField, ourField, ourValue }) => {
            console.log(
                `  ${plexField} → ${ourField}: Plex=null, Ours=${JSON.stringify(ourValue)}`
            );
        });
        console.log();
    }

    if (results.missing.length > 0) {
        console.log('❌ MISSING OR NULL IN OUR EXTRACTION (but available in Plex):');
        console.log('-'.repeat(80));
        results.missing.forEach(({ plexField, ourField, plexValue }) => {
            const displayValue =
                typeof plexValue === 'string' && plexValue.length > 50
                    ? plexValue.substring(0, 50) + '...'
                    : JSON.stringify(plexValue);
            console.log(`  ${plexField} → ${ourField}: Plex=${displayValue}, Ours=null`);
        });
        console.log();
    }

    if (results.incorrect.length > 0) {
        console.log('⚠️  INCORRECT EXTRACTION (type mismatch or wrong value):');
        console.log('-'.repeat(80));
        results.incorrect.forEach(({ plexField, ourField, plexValue, ourValue }) => {
            console.log(
                `  ${plexField} → ${ourField}: Plex=${JSON.stringify(plexValue)}, Ours=${JSON.stringify(ourValue)}`
            );
        });
        console.log();
    }

    // Check for complex fields
    console.log('🔍 COMPLEX FIELDS ANALYSIS:');
    console.log('-'.repeat(80));

    // Genres
    const plexGenres = plexData.Genre?.map(g => g.tag) || [];
    const ourGenres = ourData?.genres || [];
    console.log(`  Genres: Plex=${JSON.stringify(plexGenres)}, Ours=${JSON.stringify(ourGenres)}`);

    // Directors
    const plexDirectors = plexData.Director?.map(d => d.tag) || [];
    const ourDirectors = ourData?.directors || [];
    console.log(
        `  Directors: Plex=${JSON.stringify(plexDirectors)}, Ours=${JSON.stringify(ourDirectors)}`
    );

    // Writers
    const plexWriters = plexData.Writer?.map(w => w.tag) || [];
    const ourWriters = ourData?.writers || [];
    console.log(
        `  Writers: Plex=${JSON.stringify(plexWriters)}, Ours=${JSON.stringify(ourWriters)}`
    );

    // Cast (just count)
    const plexCastCount = plexData.Role?.length || 0;
    const ourCastCount = ourData?.cast?.length || 0;
    console.log(`  Cast count: Plex=${plexCastCount}, Ours=${ourCastCount}`);

    // Ratings
    const plexRatings = plexData.Rating?.length || 0;
    const ourRatingsDetailed = ourData?.ratingsDetailed
        ? Object.keys(ourData.ratingsDetailed).length
        : 0;
    console.log(
        `  Ratings: Plex has ${plexRatings} ratings, Ours has ${ourRatingsDetailed} detailed`
    );

    // Images
    const plexImages = plexData.Image?.length || 0;
    console.log(`  Images: Plex has ${plexImages} images`);
    if (plexData.Image) {
        plexData.Image.forEach(img => {
            console.log(`    - ${img.type}: ${img.url ? 'Available' : 'Missing'}`);
        });
    }

    // UltraBlurColors
    const plexColors = plexData.UltraBlurColors;
    const ourColors = ourData?.ultraBlurColors;
    console.log(`  UltraBlurColors: Plex=${!!plexColors}, Ours=${!!ourColors}`);
    if (plexColors) {
        console.log(`    Plex: ${JSON.stringify(plexColors)}`);
    }
    if (ourColors) {
        console.log(`    Ours: ${JSON.stringify(ourColors)}`);
    }

    // CommonSenseMedia
    const plexCSM = plexData.CommonSenseMedia;
    console.log(`  CommonSenseMedia: Plex=${!!plexCSM}, Ours=${!!ourData?.commonSenseMedia}`);
    if (plexCSM) {
        console.log(`    Plex oneLiner: ${plexCSM.oneLiner}`);
        console.log(`    Plex AgeRating: ${JSON.stringify(plexCSM.AgeRating)}`);
    }
    if (ourData?.commonSenseMedia) {
        console.log(`    Ours oneLiner: ${ourData.commonSenseMedia.oneLiner}`);
        console.log(`    Ours ageRating: ${JSON.stringify(ourData.commonSenseMedia.ageRating)}`);
    }

    // Reviews
    const plexReviews = plexData.Review?.length || 0;
    const ourReviews = ourData?.reviews?.length || 0;
    console.log(`  Reviews: Plex=${plexReviews}, Ours=${ourReviews}`);
    if (ourReviews > 0 && ourData.reviews[0]) {
        console.log(
            `    First review: ${ourData.reviews[0].tag} - ${ourData.reviews[0].text?.substring(0, 50)}...`
        );
    }

    // backgroundSquare
    const plexBgSquare = plexData.Image?.find(img => img.type === 'backgroundSquare');
    console.log(
        `  backgroundSquare: Plex=${!!plexBgSquare}, Ours=${!!ourData?.backgroundSquareUrl}`
    );

    // Extras
    const plexExtras = plexData.Extras?.size || 0;
    const ourExtras = ourData?.extras?.length || 0;
    console.log(`  Extras: Plex=${plexExtras}, Ours=${ourExtras}`);

    // Related
    const plexRelated = plexData.Related?.Hub?.[0]?.size || 0;
    const ourRelated = ourData?.related?.length || 0;
    console.log(`  Related: Plex=${plexRelated}, Ours=${ourRelated}`);

    console.log();
    console.log('='.repeat(80));
    console.log('SUMMARY:');
    console.log(`  ✅ Correct: ${results.correct.length}`);
    console.log(`  ⚪ Null in Plex: ${results.nullInPlex.length}`);
    console.log(`  ❌ Missing: ${results.missing.length}`);
    console.log(`  ⚠️  Incorrect: ${results.incorrect.length}`);
    console.log('='.repeat(80));
}

async function main() {
    try {
        console.log('Fetching Plex raw data...');
        const plexData = await getPlexRawData();

        console.log('Fetching Posterrama extraction...');
        const ourData = await getPosterramaExtraction();

        if (!ourData) {
            console.error('❌ Black Phone 2 not found in Posterrama extraction!');
            console.error('   The movie may not be in the fetched items.');
            console.error('   Try increasing the count parameter or checking filters.');
            process.exit(1);
        }

        compareFields(plexData, ourData);
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.status, error.response.statusText);
        }
        process.exit(1);
    }
}

main();
