#!/usr/bin/env node
/**
 * Jellyfin Endpoints Test Script
 * Tests various Jellyfin API endpoints to find the most efficient way to fetch libraries and counts
 */

const axios = require('axios');
const https = require('https');
require('dotenv').config();

const JELLYFIN_HOST = process.env.JELLYFIN_HOST || 'jelly.uberserver.nl';
const JELLYFIN_PORT = process.env.JELLYFIN_PORT || '443';
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;

if (!JELLYFIN_API_KEY) {
    console.error('❌ JELLYFIN_API_KEY not found in .env file');
    process.exit(1);
}

const baseURL = `https://${JELLYFIN_HOST}:${JELLYFIN_PORT}`;
console.log(`🔗 Testing Jellyfin at: ${baseURL}`);
console.log(`🔑 Using API Key: ${JELLYFIN_API_KEY.substring(0, 8)}...`);
console.log('');

// Create axios instance with SSL verification disabled for self-signed certs
const client = axios.create({
    baseURL,
    headers: {
        'X-Emby-Token': JELLYFIN_API_KEY,
    },
    httpsAgent: new https.Agent({
        rejectUnauthorized: false,
    }),
    timeout: 10000,
});

async function test(name, fn) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🧪 TEST: ${name}`);
    console.log('='.repeat(80));
    try {
        const start = Date.now();
        await fn();
        const duration = Date.now() - start;
        console.log(`✅ SUCCESS (${duration}ms)`);
    } catch (error) {
        console.error(`❌ FAILED: ${error.message}`);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data: ${JSON.stringify(error.response.data, null, 2)}`);
        }
    }
}

async function runTests() {
    console.log('🚀 Starting Jellyfin Endpoint Tests\n');

    // Test 1: Get System Info
    await test('GET /System/Info/Public', async () => {
        const response = await client.get('/System/Info/Public');
        console.log('Server Name:', response.data.ServerName);
        console.log('Version:', response.data.Version);
    });

    // Test 2: Get Library Views
    await test('GET /Library/Views', async () => {
        const response = await client.get('/Library/Views');
        const views = response.data.Items || [];
        console.log(`Found ${views.length} libraries:`);
        views.forEach(view => {
            console.log(`  - ${view.Name} (${view.CollectionType || 'unknown'}) [ID: ${view.Id}]`);
        });
    });

    // Test 3: Get Users
    await test('GET /Users', async () => {
        const response = await client.get('/Users');
        const users = response.data || [];
        console.log(`Found ${users.length} users:`);
        users.forEach(user => {
            console.log(`  - ${user.Name} [ID: ${user.Id}]`);
        });
    });

    // Test 4: Get Items/Counts (no ParentId - global counts)
    await test('GET /Items/Counts (global)', async () => {
        const response = await client.get('/Items/Counts');
        console.log('Global Counts:', JSON.stringify(response.data, null, 2));
    });

    // Test 5: Get Libraries and their counts using /Items/Counts with ParentId
    await test('GET /Items/Counts for each library', async () => {
        // First get the libraries
        const viewsResponse = await client.get('/Library/Views');
        const views = viewsResponse.data.Items || [];

        console.log('\nTesting /Items/Counts with ParentId for each library:');
        for (const view of views) {
            console.log(`\n  📁 ${view.Name} (${view.CollectionType})`);
            console.log(`     ID: ${view.Id}`);

            try {
                const countsResponse = await client.get('/Items/Counts', {
                    params: { ParentId: view.Id },
                });
                console.log(`     Counts:`, JSON.stringify(countsResponse.data, null, 2));
            } catch (err) {
                console.log(`     ❌ Failed: ${err.message}`);
            }
        }
    });

    // Test 6: Get Items with Limit=1 (old method for comparison)
    await test('GET /Items with Limit=1 (old method)', async () => {
        const viewsResponse = await client.get('/Library/Views');
        const views = viewsResponse.data.Items || [];

        console.log('\nTesting /Items with Limit=1 for each library:');
        for (const view of views) {
            const libType =
                view.CollectionType === 'movies'
                    ? 'Movie'
                    : view.CollectionType === 'tvshows'
                      ? 'Series'
                      : null;

            if (!libType) continue;

            console.log(`\n  📁 ${view.Name}`);
            const start = Date.now();
            try {
                const itemsResponse = await client.get('/Items', {
                    params: {
                        ParentId: view.Id,
                        Recursive: true,
                        IncludeItemTypes: libType,
                        Fields: 'Id',
                        Limit: 1,
                    },
                });
                const duration = Date.now() - start;
                console.log(
                    `     TotalRecordCount: ${itemsResponse.data.TotalRecordCount} (${duration}ms)`
                );
            } catch (err) {
                console.log(`     ❌ Failed: ${err.message}`);
            }
        }
    });

    // Test 7: Direct library section query
    await test('GET /library/sections/:id/all with size=1 (Plex-style)', async () => {
        const viewsResponse = await client.get('/Library/Views');
        const views = viewsResponse.data.Items || [];

        console.log('\nTesting direct library query (similar to Plex):');
        for (const view of views) {
            console.log(`\n  📁 ${view.Name}`);
            const start = Date.now();
            try {
                // Try the Items endpoint with StartIndex=0 and Limit=0
                const itemsResponse = await client.get('/Items', {
                    params: {
                        ParentId: view.Id,
                        Recursive: true,
                        StartIndex: 0,
                        Limit: 0,
                    },
                });
                const duration = Date.now() - start;
                console.log(
                    `     TotalRecordCount: ${itemsResponse.data.TotalRecordCount} (${duration}ms)`
                );
            } catch (err) {
                console.log(`     ❌ Failed: ${err.message}`);
            }
        }
    });

    console.log('\n' + '='.repeat(80));
    console.log('✨ All tests completed!');
    console.log('='.repeat(80));
}

runTests().catch(err => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
});
