#!/usr/bin/env node
/**
 * Debug script voor Jellyfin genre fetching
 */

import { JellyfinHttpClient } from './utils/jellyfin-http-client.js';

async function debugJellyfinGenres() {
    console.log('🐛 Debugging Jellyfin Genre Fetching\n');

    try {
        // Create client
        const client = new JellyfinHttpClient({
            hostname: process.env.JELLYFIN_HOSTNAME,
            port: process.env.JELLYFIN_PORT,
            apiKey: process.env.JELLYFIN_API_KEY,
            timeout: 10000,
        });

        // Test connection
        console.log('1️⃣ Testing connection...');
        const connectionInfo = await client.testConnection();
        console.log(`✅ Connected to: ${connectionInfo.name} v${connectionInfo.version}\n`);

        // Get all libraries
        console.log('2️⃣ Getting all libraries...');
        const allLibraries = await client.getLibraries();
        console.log(`✅ Found ${allLibraries.length} libraries:`);
        allLibraries.forEach(lib => {
            console.log(`   - ${lib.Name} (ID: ${lib.Id}, Type: ${lib.CollectionType})`);
        });

        // Filter libraries
        console.log('\n3️⃣ Filtering libraries...');
        const requestedLibraries = ['Movies', '4K'];
        const selectedLibraries = allLibraries.filter(lib => requestedLibraries.includes(lib.Name));
        console.log(`✅ Selected ${selectedLibraries.length} libraries:`);
        selectedLibraries.forEach(lib => {
            console.log(`   - ${lib.Name} (ID: ${lib.Id})`);
        });

        if (selectedLibraries.length === 0) {
            console.log('❌ No matching libraries found!');
            return;
        }

        // Get genres
        console.log('\n4️⃣ Getting genres...');
        const selectedLibraryIds = selectedLibraries.map(lib => lib.Id);
        console.log(`   - Using library IDs: ${selectedLibraryIds.join(', ')}`);

        const genres = await client.getGenres(selectedLibraryIds);
        console.log(`✅ Found ${genres.length} unique genres:`);
        genres.slice(0, 10).forEach(genre => {
            console.log(`   - ${genre}`);
        });

        if (genres.length > 10) {
            console.log(`   ... and ${genres.length - 10} more`);
        }
    } catch (error) {
        console.error('❌ Debug failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

await debugJellyfinGenres();
