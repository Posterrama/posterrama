#!/usr/bin/env node
/**
 * Test different methods to speed up count fetching
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
    timeout: 30000,
});

async function testSpeedOptimizations() {
    console.log('🧪 Testing speed optimizations for count fetching\n');
    console.log('='.repeat(80));

    // Get VirtualFolders first
    const response = await client.get('/Library/VirtualFolders');
    const folders = response.data || [];

    // Test on one movie library and one series library
    const movieLib = folders.find(f => f.CollectionType === 'movies');
    const seriesLib = folders.find(f => f.CollectionType === 'tvshows');

    console.log('📁 Testing library:', movieLib.Name);
    console.log('='.repeat(80));

    // Method 1: Current method (Limit=0, Recursive=true)
    console.log('\n1️⃣  Method: Limit=0, Recursive=true');
    try {
        const start = Date.now();
        const res = await client.get('/Items', {
            params: {
                ParentId: movieLib.ItemId,
                Recursive: true,
                Limit: 0,
            },
        });
        const duration = Date.now() - start;
        console.log(`   ✅ Count: ${res.data.TotalRecordCount} (${duration}ms)`);
    } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
    }

    // Method 2: Without Recursive
    console.log('\n2️⃣  Method: Limit=0, NO Recursive');
    try {
        const start = Date.now();
        const res = await client.get('/Items', {
            params: {
                ParentId: movieLib.ItemId,
                Limit: 0,
            },
        });
        const duration = Date.now() - start;
        console.log(`   ✅ Count: ${res.data.TotalRecordCount} (${duration}ms)`);
    } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
    }

    // Method 3: With IncludeItemTypes
    console.log('\n3️⃣  Method: Limit=0, Recursive=true, IncludeItemTypes=Movie');
    try {
        const start = Date.now();
        const res = await client.get('/Items', {
            params: {
                ParentId: movieLib.ItemId,
                Recursive: true,
                IncludeItemTypes: 'Movie',
                Limit: 0,
            },
        });
        const duration = Date.now() - start;
        console.log(`   ✅ Count: ${res.data.TotalRecordCount} (${duration}ms)`);
    } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
    }

    // Method 4: With Fields=Id (minimal data)
    console.log('\n4️⃣  Method: Limit=0, Recursive=true, Fields=Id');
    try {
        const start = Date.now();
        const res = await client.get('/Items', {
            params: {
                ParentId: movieLib.ItemId,
                Recursive: true,
                Fields: 'Id',
                Limit: 0,
            },
        });
        const duration = Date.now() - start;
        console.log(`   ✅ Count: ${res.data.TotalRecordCount} (${duration}ms)`);
    } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
    }

    // Method 5: EnableTotalRecordCount=false (might skip counting?)
    console.log('\n5️⃣  Method: Limit=0, EnableTotalRecordCount=false');
    try {
        const start = Date.now();
        const res = await client.get('/Items', {
            params: {
                ParentId: movieLib.ItemId,
                Recursive: true,
                EnableTotalRecordCount: false,
                Limit: 0,
            },
        });
        const duration = Date.now() - start;
        console.log(`   ✅ Count: ${res.data.TotalRecordCount} (${duration}ms)`);
    } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('📁 Testing library:', seriesLib.Name);
    console.log('='.repeat(80));

    // Test series with IncludeItemTypes=Series
    console.log('\n6️⃣  Method: Series - Limit=0, Recursive=true, IncludeItemTypes=Series');
    try {
        const start = Date.now();
        const res = await client.get('/Items', {
            params: {
                ParentId: seriesLib.ItemId,
                Recursive: true,
                IncludeItemTypes: 'Series',
                Limit: 0,
            },
        });
        const duration = Date.now() - start;
        console.log(`   ✅ Count: ${res.data.TotalRecordCount} (${duration}ms)`);
    } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
    }

    // Test series without Recursive
    console.log('\n7️⃣  Method: Series - Limit=0, NO Recursive');
    try {
        const start = Date.now();
        const res = await client.get('/Items', {
            params: {
                ParentId: seriesLib.ItemId,
                Limit: 0,
            },
        });
        const duration = Date.now() - start;
        console.log(`   ✅ Count: ${res.data.TotalRecordCount} (${duration}ms)`);
    } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('💡 Recommendation will be based on fastest method');
    console.log('='.repeat(80));
}

testSpeedOptimizations().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
});
