#!/usr/bin/env node

/**
 * Test script to debug Jellyfin genres loading
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:4000';

async function testJellyfinGenres() {
    console.log('🧪 Testing Jellyfin genres endpoint...');
    
    try {
        const response = await fetch(`${BASE_URL}/api/admin/jellyfin-genres`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                hostname: process.env.JELLYFIN_HOSTNAME,
                port: process.env.JELLYFIN_PORT,
                apiKey: process.env.JELLYFIN_API_KEY,
                movieLibraries: ['Movies', '4K', 'Plexpool Mark'],
                showLibraries: []
            })
        });

        console.log(`📡 Response status: ${response.status}`);
        
        const result = await response.text();
        console.log('📋 Response body:');
        console.log(result);
        
        if (response.ok) {
            try {
                const jsonResult = JSON.parse(result);
                console.log(`✅ Success! Found ${jsonResult.genres?.length || 0} genres`);
                if (jsonResult.genres?.length > 0) {
                    console.log('🎭 First 10 genres:', jsonResult.genres.slice(0, 10));
                }
            } catch (parseError) {
                console.log('⚠️  Response is not JSON');
            }
        } else {
            console.log('❌ Request failed');
        }
        
    } catch (error) {
        console.error('💥 Error testing Jellyfin genres:', error.message);
    }
}

// Test environment variables
console.log('🔧 Environment check:');
console.log(`   JELLYFIN_HOSTNAME: ${process.env.JELLYFIN_HOSTNAME || 'NOT SET'}`);
console.log(`   JELLYFIN_PORT: ${process.env.JELLYFIN_PORT || 'NOT SET'}`);
console.log(`   JELLYFIN_API_KEY: ${process.env.JELLYFIN_API_KEY ? '[SET]' : 'NOT SET'}`);
console.log('');

testJellyfinGenres();
