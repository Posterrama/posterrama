#!/usr/bin/env node

/**
 * Test script to verify Jellyfin integration
 * Tests server connection and basic configuration
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load environment variables if available
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const logger = require('./logger.js');
const { testServerConnection } = require('./server.js');

async function testJellyfinIntegration() {
    console.log('🎬 Testing Jellyfin Integration\n');

    // Load config.json and extract first enabled jellyfin server
    console.log('1. Reading config.json for Jellyfin server...');
    const configPath = path.join(process.cwd(), 'config.json');
    let configObj;
    try {
        configObj = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        console.log(`❌ Failed to read config.json: ${e.message}`);
        return;
    }
    const jellyfinServer = (configObj.mediaServers || []).find(s => s.type === 'jellyfin');
    if (!jellyfinServer) {
        console.log('❌ No Jellyfin server entry found in config.json');
        return;
    }
    const jellyfinHost = jellyfinServer.hostname;
    const jellyfinPort = jellyfinServer.port;
    const jellyfinApiKey = process.env[jellyfinServer.tokenEnvVar || 'JELLYFIN_API_KEY'];
    if (!jellyfinHost || !jellyfinPort || !jellyfinApiKey) {
        console.log('❌ Missing Jellyfin configuration or API key:');
        console.log(`   hostname: ${jellyfinHost ? '✓' : '❌'}`);
        console.log(`   port: ${jellyfinPort ? '✓' : '❌'}`);
        console.log(`   apiKey (env ${jellyfinServer.tokenEnvVar || 'JELLYFIN_API_KEY'}): ${jellyfinApiKey ? '✓' : '❌'}`);
        return;
    }
    console.log('✓ Jellyfin configuration present\n');

    // Test 2: Test server connection
    console.log('2. Testing server connection...');

    const testConfig = {
        name: jellyfinServer.name || 'Test Jellyfin Server',
        type: 'jellyfin',
        enabled: true,
        hostname: jellyfinHost,
        port: jellyfinPort,
        tokenEnvVar: jellyfinServer.tokenEnvVar || 'JELLYFIN_API_KEY',
    };

    try {
        const result = await testServerConnection(testConfig);

        if (result.status === 'ok') {
            console.log('✓ Jellyfin server connection successful!');
            console.log(`   Message: ${result.message}`);
        } else {
            console.log('❌ Jellyfin server connection failed:');
            console.log(`   Error: ${result.message}`);
        }
    } catch (error) {
        console.log('❌ Unexpected error during connection test:');
        console.log(`   ${error.message}`);
    }

    console.log('\n🎬 Jellyfin integration test completed!');
}

// Run the test
testJellyfinIntegration().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
