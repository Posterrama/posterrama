#!/usr/bin/env node
/**
 * Test admin genre API met juiste authenticatie
 */

import axios from 'axios';

async function testAdminGenreAPI() {
    console.log('🔐 Testing Admin Genre API with Authentication\n');

    try {
        // First login to get session
        console.log('1️⃣ Logging into admin...');
        const loginResponse = await axios.post(
            'http://localhost:4000/admin/login',
            {
                username: 'admin',
                password: 'admin',
            },
            {
                withCredentials: true,
            }
        );

        console.log('✅ Login successful');

        // Extract session cookie
        const cookies = loginResponse.headers['set-cookie'];
        const sessionCookie = cookies ? cookies.find(c => c.startsWith('connect.sid=')) : null;

        if (!sessionCookie) {
            throw new Error('No session cookie received');
        }

        console.log('2️⃣ Testing genre API with session...');

        // Now test the genre API with session
        const genreResponse = await axios.post(
            'http://localhost:4000/api/admin/jellyfin-genres',
            {
                hostname: process.env.JELLYFIN_HOSTNAME,
                port: process.env.JELLYFIN_PORT,
                apiKey: null, // Test with null to use env variable
                movieLibraries: ['Movies', '4K'],
                showLibraries: [],
            },
            {
                headers: {
                    Cookie: sessionCookie,
                    'Content-Type': 'application/json',
                },
            }
        );

        const genres = genreResponse.data.genres || [];
        console.log(`✅ Genre API successful: ${genres.length} genres found`);
        console.log('   First 10 genres:', genres.slice(0, 10));

        console.log('\n🎉 Admin genre API test completed successfully!');
    } catch (error) {
        console.error('❌ Test failed:', error.response?.data || error.message);
    }
}

await testAdminGenreAPI();
