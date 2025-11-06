#!/usr/bin/env node
/**
 * Test script to verify Jellyfin metadata extraction completeness
 * Compares raw Jellyfin API response against our processJellyfinItem() extraction
 *
 * Usage: node test-jellyfin-metadata-extraction.js [itemId]
 * Example: node test-jellyfin-metadata-extraction.js abc123def456
 */

const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const { processJellyfinItem } = require('./lib/jellyfin-helpers');
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

async function getJellyfinRawData(itemId) {
    const jellyfinServer = config.mediaServers?.find(s => s.type === 'jellyfin' && s.enabled);

    if (!jellyfinServer) {
        throw new Error('No enabled Jellyfin server found in config');
    }

    const hostname = jellyfinServer.hostname;
    const port = jellyfinServer.port || 8096;
    const apiKey =
        jellyfinServer.apiKey ||
        jellyfinServer.token ||
        (jellyfinServer.tokenEnvVar ? process.env[jellyfinServer.tokenEnvVar] : null);
    const protocol = port === 8920 || port === 443 ? 'https' : 'http';
    const baseUrl = `${protocol}://${hostname}:${port}`;

    console.log(`\n🔍 Fetching raw Jellyfin data from: ${baseUrl}`);
    console.log(`📦 Item ID: ${itemId}\n`);

    // Get user ID if not configured
    const userIdEnvVar = jellyfinServer.userIdEnvVar;
    let effectiveUserId =
        jellyfinServer.userId || (userIdEnvVar ? process.env[userIdEnvVar] : null);
    if (!effectiveUserId) {
        try {
            const userResponse = await axios.get(`${baseUrl}/Users`, {
                headers: {
                    'X-Emby-Token': apiKey,
                },
            });
            if (userResponse.data && userResponse.data.length > 0) {
                effectiveUserId = userResponse.data[0].Id;
            }
        } catch (err) {
            throw new Error(`Failed to fetch users: ${err.message}`);
        }
    }

    // Fetch item details
    const response = await axios.get(`${baseUrl}/Users/${effectiveUserId}/Items/${itemId}`, {
        headers: {
            'X-Emby-Token': apiKey,
        },
        params: {
            Fields: 'People,Overview,Genres,Tags,Studios,ProviderIds,MediaSources,MediaStreams,Path,UserData,PrimaryImageAspectRatio,CommunityRating,CriticRating,OfficialRating,Taglines,ProductionLocations',
        },
    });

    return response.data;
}

async function getPosterramaExtraction(rawItem) {
    const jellyfinServer = config.mediaServers?.find(s => s.type === 'jellyfin' && s.enabled);

    // Create mock Jellyfin client
    const mockClient = {
        getImageUrl: (itemId, imageType, imageIndex = 0) => {
            const hostname = jellyfinServer.hostname;
            const port = jellyfinServer.port || 8096;
            const apiKey =
                jellyfinServer.apiKey ||
                jellyfinServer.token ||
                (jellyfinServer.tokenEnvVar ? process.env[jellyfinServer.tokenEnvVar] : null);
            const protocol = port === 8920 || port === 443 ? 'https' : 'http';
            const baseUrl = `${protocol}://${hostname}:${port}`;
            return `${baseUrl}/Items/${itemId}/Images/${imageType}/${imageIndex}?api_key=${apiKey}`;
        },
        getSpecialFeatures: async () => [], // Mock special features
    };

    return await processJellyfinItem(rawItem, jellyfinServer, mockClient);
}

function compareFields(jellyfinData, posterramaData) {
    console.log('\n📊 FIELD COMPARISON\n');
    console.log('='.repeat(80));

    const fieldMappings = [
        { jellyfin: 'Name', posterrama: 'title', desc: 'Title' },
        { jellyfin: 'OriginalTitle', posterrama: 'originalTitle', desc: 'Original Title' },
        { jellyfin: 'SortName', posterrama: 'titleSort', desc: 'Sort Title' },
        { jellyfin: 'ProductionYear', posterrama: 'year', desc: 'Year' },
        { jellyfin: 'Overview', posterrama: 'overview', desc: 'Overview' },
        { jellyfin: 'Taglines[0]', posterrama: 'tagline', desc: 'Tagline' },
        { jellyfin: 'Genres', posterrama: 'genres', desc: 'Genres (array)' },
        { jellyfin: 'CommunityRating', posterrama: 'rating', desc: 'Community Rating' },
        { jellyfin: 'OfficialRating', posterrama: 'contentRating', desc: 'Content Rating' },
        { jellyfin: 'CriticRating', posterrama: 'rottenTomatoes.rating', desc: 'Critic Rating' },
        { jellyfin: 'Studios', posterrama: 'studios', desc: 'Studios (array)' },
        { jellyfin: 'ProductionLocations', posterrama: 'countries', desc: 'Countries (array)' },
        { jellyfin: 'PremiereDate', posterrama: 'releaseDate', desc: 'Release Date' },
        { jellyfin: 'RunTimeTicks', posterrama: 'runtimeMs', desc: 'Runtime (ms)' },
        { jellyfin: 'DateCreated', posterrama: 'addedAtMs', desc: 'Added At (ms)' },
        { jellyfin: 'DateLastSaved', posterrama: 'updatedAt', desc: 'Updated At (ms)' },
        { jellyfin: 'UserData.PlayCount', posterrama: 'viewCount', desc: 'View Count' },
        { jellyfin: 'UserData.LastPlayedDate', posterrama: 'lastViewedAt', desc: 'Last Viewed' },
        { jellyfin: 'UserData.Rating', posterrama: 'ratings.user', desc: 'User Rating' },
        { jellyfin: 'ImageTags.Primary', posterrama: 'posterUrl', desc: 'Poster URL' },
        { jellyfin: 'ImageTags.Backdrop', posterrama: 'backgroundUrl', desc: 'Background URL' },
        { jellyfin: 'ImageTags.Logo', posterrama: 'clearLogoUrl', desc: 'Logo URL' },
        { jellyfin: 'ImageTags.Banner', posterrama: 'bannerUrl', desc: 'Banner URL' },
        { jellyfin: 'ImageTags.Thumb', posterrama: 'thumbUrl', desc: 'Thumb URL' },
        { jellyfin: 'ImageTags.Disc', posterrama: 'discArtUrl', desc: 'Disc Art URL' },
        { jellyfin: 'BackdropImageTags', posterrama: 'fanart', desc: 'Fanart (array)' },
        { jellyfin: 'People', posterrama: 'cast', desc: 'Cast (array)' },
        { jellyfin: 'MediaSources', posterrama: 'mediaStreams', desc: 'Media Streams' },
    ];

    let correctCount = 0;
    let nullInJellyfinCount = 0;
    let missingCount = 0;
    const incorrectCount = 0;

    fieldMappings.forEach(({ jellyfin, posterrama, desc }) => {
        const jellyfinValue = getNestedValue(jellyfinData, jellyfin);
        const posterramaValue = getNestedValue(posterramaData, posterrama);

        const jellyfinExists = jellyfinValue !== undefined && jellyfinValue !== null;
        const posterramaExists = posterramaValue !== undefined && posterramaValue !== null;

        let status, emoji;

        if (!jellyfinExists) {
            status = 'null in Jellyfin';
            emoji = '⚪';
            nullInJellyfinCount++;
        } else if (posterramaExists) {
            status = 'extracted';
            emoji = '✅';
            correctCount++;
        } else {
            status = 'MISSING in extraction';
            emoji = '❌';
            missingCount++;
        }

        console.log(`${emoji} ${desc.padEnd(30)} ${status}`);

        if (jellyfinExists && posterramaExists) {
            console.log(`   Jellyfin: ${formatValue(jellyfinValue)}`);
            console.log(`   Extracted: ${formatValue(posterramaValue)}`);
        } else if (jellyfinExists) {
            console.log(`   Jellyfin: ${formatValue(jellyfinValue)}`);
        }
        console.log();
    });

    console.log('='.repeat(80));
    console.log(`\n📈 SUMMARY:`);
    console.log(`✅ Correctly extracted: ${correctCount}`);
    console.log(`⚪ Null in Jellyfin: ${nullInJellyfinCount}`);
    console.log(`❌ Missing from extraction: ${missingCount}`);
    console.log(`⚠️  Incorrect extractions: ${incorrectCount}`);

    return { correctCount, nullInJellyfinCount, missingCount, incorrectCount };
}

function getNestedValue(obj, path) {
    const parts = path.split('.');
    let value = obj;

    for (const part of parts) {
        if (part.includes('[')) {
            const arrayPart = part.match(/([^[]+)\[(\d+)\]/);
            if (arrayPart) {
                const [, key, index] = arrayPart;
                value = value?.[key]?.[parseInt(index)];
            }
        } else {
            value = value?.[part];
        }

        if (value === undefined) return undefined;
    }

    return value;
}

function formatValue(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return value.substring(0, 100);
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value.toString();
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return JSON.stringify(value).substring(0, 100);
    return String(value);
}

function analyzeComplexFields(jellyfinData, posterramaData) {
    console.log('\n\n🔬 COMPLEX FIELD ANALYSIS\n');
    console.log('='.repeat(80));

    // Genres
    console.log('\n📂 Genres:');
    console.log(`Jellyfin: ${JSON.stringify(jellyfinData.Genres || [])}`);
    console.log(`Extracted: ${JSON.stringify(posterramaData.genres || [])}`);

    // People (cast, directors, writers)
    console.log('\n👥 People:');
    const jellyfinPeople = jellyfinData.People || [];
    console.log(`Jellyfin total: ${jellyfinPeople.length}`);
    console.log(`  Actors: ${jellyfinPeople.filter(p => p.Type === 'Actor').length}`);
    console.log(`  Directors: ${jellyfinPeople.filter(p => p.Type === 'Director').length}`);
    console.log(
        `  Writers: ${jellyfinPeople.filter(p => p.Type === 'Writer' || p.Type === 'Screenwriter').length}`
    );
    console.log(`Extracted cast: ${posterramaData.cast?.length || 0}`);
    console.log(`Extracted directors: ${posterramaData.directors?.length || 0}`);
    console.log(`Extracted writers: ${posterramaData.writers?.length || 0}`);

    // Images
    console.log('\n🖼️  Images:');
    const imageTags = jellyfinData.ImageTags || {};
    console.log(`Jellyfin ImageTags: ${Object.keys(imageTags).join(', ')}`);
    console.log(`Extracted posterUrl: ${posterramaData.posterUrl ? '✅' : '❌'}`);
    console.log(`Extracted backgroundUrl: ${posterramaData.backgroundUrl ? '✅' : '❌'}`);
    console.log(`Extracted clearLogoUrl: ${posterramaData.clearLogoUrl ? '✅' : '❌'}`);
    console.log(`Extracted bannerUrl: ${posterramaData.bannerUrl ? '✅' : '❌'}`);
    console.log(`Extracted thumbUrl: ${posterramaData.thumbUrl ? '✅' : '❌'}`);
    console.log(`Extracted discArtUrl: ${posterramaData.discArtUrl ? '✅' : '❌'}`);

    // Backdrops/Fanart
    console.log('\n🎨 Fanart:');
    const backdropTags = jellyfinData.BackdropImageTags || [];
    console.log(`Jellyfin BackdropImageTags: ${backdropTags.length}`);
    console.log(`Extracted fanart array: ${posterramaData.fanart?.length || 0}`);

    // Provider IDs
    console.log('\n🔗 Provider IDs:');
    const providerIds = jellyfinData.ProviderIds || {};
    console.log(`Jellyfin: ${JSON.stringify(providerIds)}`);
    console.log(`Extracted guids: ${JSON.stringify(posterramaData.guids || [])}`);
    console.log(`Extracted imdbUrl: ${posterramaData.imdbUrl || 'none'}`);

    // Media Sources / Streams
    console.log('\n💿 Media Sources:');
    const mediaSources = jellyfinData.MediaSources || [];
    console.log(`Jellyfin MediaSources: ${mediaSources.length}`);
    if (mediaSources.length > 0) {
        const firstSource = mediaSources[0];
        console.log(`  Container: ${firstSource.Container || 'unknown'}`);
        console.log(`  Video codec: ${firstSource.VideoCodec || 'unknown'}`);
        console.log(`  Audio codec: ${firstSource.AudioCodec || 'unknown'}`);
        console.log(`  Bitrate: ${firstSource.Bitrate || 'unknown'}`);
        console.log(
            `  Size: ${firstSource.Size ? (firstSource.Size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'unknown'}`
        );
    }
    console.log(`Extracted mediaStreams: ${posterramaData.mediaStreams?.length || 0}`);
    console.log(`Extracted audioTracks: ${posterramaData.audioTracks?.length || 0}`);
    console.log(`Extracted subtitles: ${posterramaData.subtitles?.length || 0}`);
    console.log(`Extracted videoStreams: ${posterramaData.videoStreams?.length || 0}`);

    // HDR / Quality
    console.log('\n✨ Quality & HDR:');
    console.log(`Extracted qualityLabel: ${posterramaData.qualityLabel || 'none'}`);
    console.log(`Extracted hasHDR: ${posterramaData.hasHDR || false}`);
    console.log(`Extracted hasDolbyVision: ${posterramaData.hasDolbyVision || false}`);
    console.log(`Extracted is3D: ${posterramaData.is3D || false}`);
    console.log(`Extracted hdrFormats: ${JSON.stringify(posterramaData.hdrFormats || [])}`);
}

async function main() {
    const itemId = process.argv[2];

    if (!itemId) {
        console.error('\n❌ Error: Please provide a Jellyfin item ID');
        console.error('Usage: node test-jellyfin-metadata-extraction.js [itemId]');
        console.error('\nExample: node test-jellyfin-metadata-extraction.js abc123def456\n');
        process.exit(1);
    }

    try {
        // Get raw Jellyfin data
        const jellyfinData = await getJellyfinRawData(itemId);
        console.log(
            `\n✅ Retrieved raw Jellyfin data for: ${jellyfinData.Name} (${jellyfinData.ProductionYear || 'unknown year'})`
        );

        // Get Posterrama extraction
        const posterramaData = await getPosterramaExtraction(jellyfinData);
        console.log(`✅ Processed through processJellyfinItem()`);

        // Compare fields
        const summary = compareFields(jellyfinData, posterramaData);

        // Analyze complex fields
        analyzeComplexFields(jellyfinData, posterramaData);

        // Print raw Jellyfin data structure
        console.log('\n\n📋 RAW JELLYFIN DATA STRUCTURE\n');
        console.log('='.repeat(80));
        console.log(JSON.stringify(jellyfinData, null, 2));

        // Final summary
        console.log('\n\n' + '='.repeat(80));
        console.log('🎬 JELLYFIN METADATA EXTRACTION TEST COMPLETE');
        console.log('='.repeat(80));
        console.log(`\nItem: ${jellyfinData.Name} (${jellyfinData.ProductionYear || 'unknown'})`);
        console.log(`Jellyfin ID: ${itemId}`);
        console.log(`\n✅ ${summary.correctCount} fields correctly extracted`);
        console.log(`⚪ ${summary.nullInJellyfinCount} fields null in Jellyfin (expected)`);
        console.log(`❌ ${summary.missingCount} fields missing from extraction`);
        console.log(`⚠️  ${summary.incorrectCount} fields incorrectly extracted`);
        console.log('\n');

        process.exit(summary.missingCount > 0 || summary.incorrectCount > 0 ? 1 : 0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

main();
