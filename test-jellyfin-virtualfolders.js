#!/usr/bin/env node
/**
 * Test /Library/VirtualFolders endpoint
 * Compare performance with other methods
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
    timeout: 30000, // 30 seconds for slow endpoints
});

async function testVirtualFolders() {
    console.log('🧪 Testing /Library/VirtualFolders endpoint\n');
    console.log('='.repeat(80));

    try {
        const start = Date.now();
        const response = await client.get('/Library/VirtualFolders');
        const duration = Date.now() - start;
        const folders = response.data || [];

        console.log(`✅ SUCCESS! Response time: ${duration}ms`);
        console.log(`\n📊 Found ${folders.length} virtual folders:\n`);

        folders.forEach((folder, index) => {
            console.log(`${index + 1}. ${folder.Name}`);
            console.log(`   ItemId: ${folder.ItemId || 'N/A'}`);
            console.log(`   CollectionType: ${folder.CollectionType || 'unknown'}`);
            console.log(`   Locations: ${folder.Locations ? folder.Locations.join(', ') : 'N/A'}`);
            console.log(
                `   LibraryOptions: ${JSON.stringify(folder.LibraryOptions || {}, null, 2)}`
            );
            console.log('');
        });

        console.log('='.repeat(80));
        console.log('\n🔄 Now comparing with /Users/{id}/Views method...\n');
        console.log('='.repeat(80));

        // Get user for comparison
        const usersResponse = await client.get('/Users');
        const userId = usersResponse.data[0].Id;

        const start2 = Date.now();
        const viewsResponse = await client.get(`/Users/${userId}/Views`);
        const duration2 = Date.now() - start2;
        const views = viewsResponse.data.Items || [];

        console.log(`✅ /Users/{id}/Views response time: ${duration2}ms`);
        console.log(`\n📊 Found ${views.length} user views:\n`);

        views.forEach((view, index) => {
            console.log(`${index + 1}. ${view.Name}`);
            console.log(`   Id: ${view.Id}`);
            console.log(`   CollectionType: ${view.CollectionType || 'unknown'}`);
            console.log('');
        });

        console.log('='.repeat(80));
        console.log('\n📈 PERFORMANCE COMPARISON:');
        console.log('='.repeat(80));
        console.log(`/Library/VirtualFolders:  ${duration}ms → ${folders.length} folders`);
        console.log(`/Users/{id}/Views:        ${duration2}ms → ${views.length} views`);
        console.log(`Difference:               ${Math.abs(duration - duration2)}ms`);
        console.log(
            `Winner:                   ${duration < duration2 ? '/Library/VirtualFolders 🏆' : '/Users/{id}/Views 🏆'}`
        );

        console.log('\n💡 IMPORTANT QUESTIONS FOR YOU:\n');
        console.log('1. Do VirtualFolders have ItemId that we can use with /Items for counts?');
        console.log('2. Are VirtualFolders and UserViews the same libraries?');
        console.log('3. Which method gives the most complete/accurate library list?');
        console.log('4. Can we use VirtualFolders.ItemId with /Items endpoint?');
        console.log('\n⏳ Testing if VirtualFolders ItemId works with /Items...\n');

        for (const folder of folders.slice(0, 2)) {
            // Test first 2 only
            console.log(`📁 Testing: ${folder.Name}`);
            if (folder.ItemId) {
                try {
                    const countStart = Date.now();
                    const itemsResponse = await client.get('/Items', {
                        params: {
                            ParentId: folder.ItemId,
                            Recursive: true,
                            Limit: 0,
                        },
                    });
                    const countDuration = Date.now() - countStart;
                    console.log(
                        `   ✅ /Items with VirtualFolder.ItemId works! Count: ${itemsResponse.data.TotalRecordCount} (${countDuration}ms)`
                    );
                } catch (err) {
                    console.log(`   ❌ /Items with VirtualFolder.ItemId failed: ${err.message}`);
                }
            } else {
                console.log('   ⚠️  No ItemId available for this VirtualFolder');
            }
        }
    } catch (error) {
        console.error(`❌ FAILED: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✨ Test complete! Please review results and decide which method to use.');
    console.log('='.repeat(80));
}

testVirtualFolders().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
});
