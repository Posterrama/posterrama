#!/usr/bin/env node
/**
 * Test parallel count fetching with VirtualFolders
 * Shows total time for complete operation
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

async function testParallelCounts() {
    console.log('🧪 Testing COMPLETE library fetch with parallel counts\n');
    console.log('='.repeat(80));

    const totalStart = Date.now();

    // Step 1: Get VirtualFolders (only once)
    console.log('📥 Step 1: Fetching /Library/VirtualFolders...');
    const foldersStart = Date.now();
    const response = await client.get('/Library/VirtualFolders');
    const foldersDuration = Date.now() - foldersStart;
    const folders = response.data || [];

    console.log(`   ✅ Got ${folders.length} folders in ${foldersDuration}ms`);
    console.log('   📦 Cached VirtualFolders data (in real app)');

    // Step 2: Get counts in parallel
    console.log('\n📊 Step 2: Fetching counts for all libraries (PARALLEL)...');
    const countsStart = Date.now();

    const countPromises = folders.map(async folder => {
        const start = Date.now();
        try {
            const itemsResponse = await client.get('/Items', {
                params: {
                    ParentId: folder.ItemId,
                    Recursive: true,
                    Limit: 0,
                },
            });
            const duration = Date.now() - start;
            const count = itemsResponse?.data?.TotalRecordCount || 0;
            return {
                name: folder.Name,
                id: folder.ItemId,
                type: folder.CollectionType,
                count,
                duration,
                success: true,
            };
        } catch (error) {
            const duration = Date.now() - start;
            return {
                name: folder.Name,
                id: folder.ItemId,
                type: folder.CollectionType,
                count: 0,
                duration,
                success: false,
                error: error.message,
            };
        }
    });

    const results = await Promise.all(countPromises);
    const countsDuration = Date.now() - countsStart;

    console.log(`   ✅ All counts fetched in ${countsDuration}ms (parallel)`);

    // Step 3: Display results
    console.log('\n📋 Results:');
    console.log('='.repeat(80));
    results.forEach((result, index) => {
        const status = result.success ? '✅' : '❌';
        console.log(
            `${index + 1}. ${status} ${result.name.padEnd(25)} ${String(result.count).padStart(4)} items (${result.duration}ms)`
        );
        if (!result.success) {
            console.log(`   Error: ${result.error}`);
        }
    });

    const totalDuration = Date.now() - totalStart;

    console.log('\n' + '='.repeat(80));
    console.log('⏱️  TIMING BREAKDOWN:');
    console.log('='.repeat(80));
    console.log(`VirtualFolders fetch:     ${foldersDuration}ms`);
    console.log(`Parallel counts fetch:    ${countsDuration}ms`);
    console.log(`─────────────────────────────────────`);
    console.log(`TOTAL TIME:               ${totalDuration}ms`);

    // Calculate what sequential would have been
    const sequentialTime = foldersDuration + results.reduce((sum, r) => sum + r.duration, 0);
    const timeSaved = sequentialTime - totalDuration;
    console.log(`\nSequential would be:      ${sequentialTime}ms`);
    console.log(
        `Time saved with parallel: ${timeSaved}ms (${Math.round((timeSaved / sequentialTime) * 100)}% faster)`
    );

    console.log('\n💡 CACHING STRATEGY:');
    console.log('='.repeat(80));
    console.log('1. Cache VirtualFolders response for 5 minutes');
    console.log('2. Only fetch counts when "Fetch Libraries" is clicked');
    console.log('3. Parallel count fetching for speed');
    console.log('4. 30 second timeout for VirtualFolders');
    console.log('5. Individual 10 second timeout per count request');

    console.log('\n✨ Test complete!\n');
}

testParallelCounts().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
});
