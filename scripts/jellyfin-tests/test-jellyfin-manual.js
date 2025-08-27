#!/usr/bin/env node

const https = require('https');
const http = require('http');

// Test Jellyfin connection
async function testJellyfinConnection() {
    console.log('🔧 Testing Jellyfin Connection...\n');

    // Get values from environment variables (as configured in config.json)
    const hostname = process.env.JELLYFIN_HOSTNAME;
    const port = process.env.JELLYFIN_PORT;
    const apiKey = process.env.JELLYFIN_API_KEY;

    console.log('📋 Configuration:');
    console.log(`   Hostname: ${hostname || 'NOT SET'}`);
    console.log(`   Port: ${port || 'NOT SET'}`);
    console.log(`   API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : 'NOT SET'}`);
    console.log('');

    if (!hostname || !port || !apiKey) {
        console.log('❌ Missing required environment variables:');
        if (!hostname) console.log('   - JELLYFIN_HOSTNAME');
        if (!port) console.log('   - JELLYFIN_PORT');
        if (!apiKey) console.log('   - JELLYFIN_API_KEY');
        console.log('\nPlease set these environment variables and try again.');
        return;
    }

    // Determine protocol based on port
    const protocol = port === '443' || port === 443 ? 'https' : 'http';
    const baseUrl = `${protocol}://${hostname}:${port}`;
    console.log(`🌐 Testing connection to: ${baseUrl}`);
    console.log('');

    // Test 1: System Info
    console.log('🔍 Test 1: System Information');
    try {
        const systemInfo = await makeRequest(
            `${baseUrl}/System/Info`,
            apiKey,
            protocol === 'https'
        );
        console.log('✅ System Info retrieved successfully');
        console.log(`   Server Name: ${systemInfo.ServerName}`);
        console.log(`   Version: ${systemInfo.Version}`);
        console.log(`   Operating System: ${systemInfo.OperatingSystem}`);
    } catch (error) {
        console.log('❌ Failed to get system info:');
        console.log(`   ${error.message}`);
    }
    console.log('');

    // Test 2: Libraries
    console.log('🔍 Test 2: Media Libraries');
    try {
        const libraries = await makeRequest(
            `${baseUrl}/Library/VirtualFolders`,
            apiKey,
            protocol === 'https'
        );
        console.log('✅ Libraries retrieved successfully');
        console.log(`   Found ${libraries.length} libraries:`);
        libraries.forEach(lib => {
            console.log(`   - ${lib.Name} (${lib.CollectionType || 'mixed'})`);
        });
    } catch (error) {
        console.log('❌ Failed to get libraries:');
        console.log(`   ${error.message}`);
    }
    console.log('');

    // Test 3: Authentication
    console.log('🔍 Test 3: API Key Authentication');
    try {
        const users = await makeRequest(`${baseUrl}/Users`, apiKey, protocol === 'https');
        console.log('✅ Authentication successful');
        console.log(`   Found ${users.length} users`);
    } catch (error) {
        console.log('❌ Authentication failed:');
        console.log(`   ${error.message}`);
    }
}

function makeRequest(url, apiKey, useHttps = false) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'X-MediaBrowser-Token': apiKey,
                Accept: 'application/json',
            },
        };

        const client = useHttps ? https : http;

        const request = client.get(url, options, response => {
            let data = '';

            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    try {
                        const parsedData = JSON.parse(data);
                        resolve(parsedData);
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON response: ${error.message}`));
                    }
                } else {
                    reject(new Error(`HTTP ${response.statusCode}: ${data}`));
                }
            });
        });

        request.on('error', error => {
            reject(new Error(`Network error: ${error.message}`));
        });

        request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('Request timeout (10 seconds)'));
        });
    });
}

// Run the test
testJellyfinConnection().catch(console.error);
