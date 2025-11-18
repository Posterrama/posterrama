#!/usr/bin/env node
/**
 * Jellyfin Library Test - Find the correct endpoint
 */

const axios = require('axios');
const https = require('https');
require('dotenv').config();

const JELLYFIN_HOST = process.env.JELLYFIN_HOST || 'jelly.uberserver.nl';
const JELLYFIN_PORT = process.env.JELLYFIN_PORT || '443';
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;

const baseURL = `https://${JELLYFIN_HOST}:${JELLYFIN_PORT}`;

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

async function runTests() {
    console.log('🔍 Finding correct Jellyfin library endpoint...\n');

    // Get first user
    console.log('📝 Step 1: Get first user ID');
    const usersResponse = await client.get('/Users');
    const userId = usersResponse.data[0].Id;
    console.log(`   User: ${usersResponse.data[0].Name} (${userId})`);

    // Try User Views
    console.log('\n📝 Step 2: Get user views (libraries)');
    try {
        const viewsResponse = await client.get(`/Users/${userId}/Views`);
        const views = viewsResponse.data.Items || [];
        console.log(`   ✅ Found ${views.length} libraries:`);

        for (const view of views) {
            console.log(`\n   📁 ${view.Name}`);
            console.log(`      ID: ${view.Id}`);
            console.log(`      Type: ${view.CollectionType || 'unknown'}`);

            // Now try to get count for this library
            console.log(`      Testing count methods:`);

            // Method 1: /Items with Limit=0
            try {
                const start1 = Date.now();
                const items1 = await client.get('/Items', {
                    params: {
                        ParentId: view.Id,
                        Recursive: true,
                        Limit: 0,
                    },
                });
                const duration1 = Date.now() - start1;
                console.log(
                    `      ✅ /Items (Limit=0): ${items1.data.TotalRecordCount} items (${duration1}ms)`
                );
            } catch (err) {
                console.log(`      ❌ /Items (Limit=0): ${err.message}`);
            }

            // Method 2: /Items with Limit=1
            try {
                const start2 = Date.now();
                const items2 = await client.get('/Items', {
                    params: {
                        ParentId: view.Id,
                        Recursive: true,
                        IncludeItemTypes: view.CollectionType === 'movies' ? 'Movie' : 'Series',
                        Fields: 'Id',
                        Limit: 1,
                    },
                });
                const duration2 = Date.now() - start2;
                console.log(
                    `      ✅ /Items (Limit=1): ${items2.data.TotalRecordCount} items (${duration2}ms)`
                );
            } catch (err) {
                console.log(`      ❌ /Items (Limit=1): ${err.message}`);
            }

            // Method 3: /Users/{userId}/Items
            try {
                const start3 = Date.now();
                const items3 = await client.get(`/Users/${userId}/Items`, {
                    params: {
                        ParentId: view.Id,
                        Recursive: true,
                        Limit: 0,
                    },
                });
                const duration3 = Date.now() - start3;
                console.log(
                    `      ✅ /Users/{id}/Items: ${items3.data.TotalRecordCount} items (${duration3}ms)`
                );
            } catch (err) {
                console.log(`      ❌ /Users/{id}/Items: ${err.message}`);
            }
        }
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
    }

    console.log('\n✨ Test complete!');
}

runTests().catch(err => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
});
