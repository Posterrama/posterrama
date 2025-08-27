#!/usr/bin/env node

/**
 * Test our new Jellyfin HTTP client implementation
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:4000';

async function testJellyfinAdmin() {
    console.log('🧪 Testing Jellyfin admin functionality...');

    try {
        // Test connection
        console.log('1. Testing Jellyfin connection...');
        const testResponse = await fetch(`${BASE_URL}/api/admin/test-jellyfin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hostname: process.env.JELLYFIN_HOSTNAME,
                port: process.env.JELLYFIN_PORT,
                apiKey: process.env.JELLYFIN_API_KEY,
            }),
        });

        if (testResponse.ok) {
            const testResult = await testResponse.json();
            console.log('✅ Connection test:', testResult);
        } else {
            console.log('❌ Connection test failed:', testResponse.status);
        }

        // Test libraries
        console.log('\n2. Testing Jellyfin libraries...');
        const libResponse = await fetch(`${BASE_URL}/api/admin/jellyfin-libraries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hostname: process.env.JELLYFIN_HOSTNAME,
                port: process.env.JELLYFIN_PORT,
                apiKey: process.env.JELLYFIN_API_KEY,
            }),
        });

        if (libResponse.ok) {
            const libResult = await libResponse.json();
            console.log(`✅ Libraries: Found ${libResult.libraries?.length || 0} libraries`);
            libResult.libraries?.slice(0, 3).forEach(lib => {
                console.log(`   - ${lib.name} (${lib.type})`);
            });
        } else {
            console.log('❌ Libraries test failed:', libResponse.status);
        }

        // Test genres
        console.log('\n3. Testing Jellyfin genres...');
        const genreResponse = await fetch(`${BASE_URL}/api/admin/jellyfin-genres`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hostname: process.env.JELLYFIN_HOSTNAME,
                port: process.env.JELLYFIN_PORT,
                apiKey: process.env.JELLYFIN_API_KEY,
                movieLibraries: ['Movies', '4K', 'Plexpool Mark'],
                showLibraries: [],
            }),
        });

        if (genreResponse.ok) {
            const genreResult = await genreResponse.json();
            console.log(`✅ Genres: Found ${genreResult.genres?.length || 0} genres`);
            console.log('   First 10:', genreResult.genres?.slice(0, 10));
        } else {
            console.log('❌ Genres test failed:', genreResponse.status);
        }
    } catch (error) {
        console.error('💥 Error:', error.message);
    }
}

console.log('🔧 Environment check:');
console.log(`   JELLYFIN_HOSTNAME: ${process.env.JELLYFIN_HOSTNAME || 'NOT SET'}`);
console.log(`   JELLYFIN_PORT: ${process.env.JELLYFIN_PORT || 'NOT SET'}`);
console.log(`   JELLYFIN_API_KEY: ${process.env.JELLYFIN_API_KEY ? '[SET]' : 'NOT SET'}`);
console.log('');

testJellyfinAdmin();
