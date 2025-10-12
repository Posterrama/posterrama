#!/usr/bin/env node

/**
 * Test script to verify Plex /tree endpoint returns complete Media.Part.Stream data
 * Usage: PLEX_URL=http://ip:32400 PLEX_TOKEN=xxx node scripts/test-plex-tree.js [ratingKey]
 */

const https = require('https');
const http = require('http');

const PLEX_URL = process.env.PLEX_URL || 'http://192.168.10.25:32400';
const PLEX_TOKEN = process.env.PLEX_TOKEN;
const RATING_KEY = process.argv[2];

if (!PLEX_TOKEN) {
    console.error('❌ Error: PLEX_TOKEN environment variable required');
    console.error(
        'Usage: PLEX_URL=http://ip:32400 PLEX_TOKEN=xxx node scripts/test-plex-tree.js [ratingKey]'
    );
    process.exit(1);
}

async function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'X-Plex-Token': PLEX_TOKEN,
            },
        };

        client
            .get(options, res => {
                let data = '';
                res.on('data', chunk => (data += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(new Error(`Failed to parse JSON: ${err.message}`));
                    }
                });
            })
            .on('error', reject);
    });
}

async function testTreeEndpoint(ratingKey) {
    console.log(`\n🔍 Testing Plex /tree endpoint for ratingKey: ${ratingKey}\n`);

    // Standard metadata endpoint
    const standardUrl = `${PLEX_URL}/library/metadata/${ratingKey}?X-Plex-Token=${PLEX_TOKEN}`;
    console.log(`📡 Fetching standard metadata: ${standardUrl.replace(PLEX_TOKEN, 'xxx')}`);
    const standard = await fetchJson(standardUrl);
    const stdItem = standard?.MediaContainer?.Metadata?.[0];

    if (!stdItem) {
        console.error('❌ No metadata found in standard response');
        return;
    }

    console.log(`✅ Standard metadata: ${stdItem.title} (${stdItem.type})`);
    console.log(`   Media count: ${stdItem.Media?.length || 0}`);

    if (stdItem.Media?.[0]?.Part?.[0]?.Stream) {
        console.log(`   Stream count (standard): ${stdItem.Media[0].Part[0].Stream.length}`);
        console.log(
            `   First stream: ${JSON.stringify(stdItem.Media[0].Part[0].Stream[0], null, 2).substring(0, 200)}...`
        );
    } else {
        console.log(`   ⚠️  No Stream data in standard endpoint`);
    }

    // Tree endpoint
    const treeUrl = `${PLEX_URL}/library/metadata/${ratingKey}/tree?X-Plex-Token=${PLEX_TOKEN}`;
    console.log(`\n📡 Fetching tree metadata: ${treeUrl.replace(PLEX_TOKEN, 'xxx')}`);
    const tree = await fetchJson(treeUrl);
    const treeItem = tree?.MediaContainer?.Metadata?.[0];

    if (!treeItem) {
        console.error('❌ No metadata found in tree response');
        return;
    }

    console.log(`✅ Tree metadata: ${treeItem.title} (${treeItem.type})`);
    console.log(`   Media count: ${treeItem.Media?.length || 0}`);

    if (treeItem.Media?.[0]?.Part?.[0]?.Stream) {
        const streams = treeItem.Media[0].Part[0].Stream;
        console.log(`   Stream count (tree): ${streams.length}`);
        console.log(`\n📊 Stream breakdown:`);

        const video = streams.filter(s => s.streamType === 1);
        const audio = streams.filter(s => s.streamType === 2);
        const subtitle = streams.filter(s => s.streamType === 3);

        console.log(`   Video streams: ${video.length}`);
        if (video[0]) {
            console.log(
                `      Example: ${video[0].codec} ${video[0].width}x${video[0].height} ${video[0].bitrate}kbps`
            );
            console.log(`      Properties: ${Object.keys(video[0]).join(', ')}`);
        }

        console.log(`   Audio streams: ${audio.length}`);
        if (audio[0]) {
            console.log(
                `      Example: ${audio[0].codec} ${audio[0].channels}ch ${audio[0].audioChannelLayout || 'unknown'} ${audio[0].bitrate}kbps`
            );
            console.log(`      Properties: ${Object.keys(audio[0]).join(', ')}`);
        }

        console.log(`   Subtitle streams: ${subtitle.length}`);
        if (subtitle[0]) {
            console.log(
                `      Example: ${subtitle[0].codec} (${subtitle[0].language || 'unknown'}) ${subtitle[0].forced ? 'FORCED' : ''}`
            );
            console.log(`      Properties: ${Object.keys(subtitle[0]).join(', ')}`);
        }

        console.log(`\n✅ SUCCESS: /tree endpoint returns complete stream metadata!\n`);
    } else {
        console.log(`   ❌ No Stream data in tree endpoint either`);
    }
}

async function getFirstMovie() {
    console.log('🔍 Finding first movie in library...\n');
    const librariesUrl = `${PLEX_URL}/library/sections?X-Plex-Token=${PLEX_TOKEN}`;
    const libraries = await fetchJson(librariesUrl);

    const movieLib = libraries?.MediaContainer?.Directory?.find(d => d.type === 'movie');
    if (!movieLib) {
        console.error('❌ No movie library found');
        process.exit(1);
    }

    console.log(`✅ Found movie library: ${movieLib.title} (key: ${movieLib.key})`);

    const moviesUrl = `${PLEX_URL}/library/sections/${movieLib.key}/all?X-Plex-Token=${PLEX_TOKEN}`;
    const movies = await fetchJson(moviesUrl);

    const firstMovie = movies?.MediaContainer?.Metadata?.[0];
    if (!firstMovie) {
        console.error('❌ No movies found in library');
        process.exit(1);
    }

    console.log(`✅ Testing with: ${firstMovie.title} (ratingKey: ${firstMovie.ratingKey})\n`);
    return firstMovie.ratingKey;
}

(async () => {
    try {
        const ratingKey = RATING_KEY || (await getFirstMovie());
        await testTreeEndpoint(ratingKey);
    } catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    }
})();
