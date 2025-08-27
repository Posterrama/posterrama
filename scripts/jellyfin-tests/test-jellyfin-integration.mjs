#!/usr/bin/env node

/**
 * Test script to verify Jellyfin integration
 * Tests server connection and basic configuration
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load environment variables if available
import 'dotenv/config';

const logger = require('./logger.js');
const { testServerConnection } = require('./server.js');

async function testJellyfinIntegration() {
    console.log('🎬 Testing Jellyfin Integration\n');

    // Test 1: Check if Jellyfin environment variables are set
    console.log('1. Checking environment variables...');
    const jellyfinHost = process.env.JELLYFIN_HOSTNAME;
    const jellyfinPort = process.env.JELLYFIN_PORT;
    const jellyfinApiKey = process.env.JELLYFIN_API_KEY;

    if (!jellyfinHost || !jellyfinPort || !jellyfinApiKey) {
        console.log('❌ Missing Jellyfin environment variables:');
        console.log(`   JELLYFIN_HOSTNAME: ${jellyfinHost ? '✓' : '❌'}`);
        console.log(`   JELLYFIN_PORT: ${jellyfinPort ? '✓' : '❌'}`);
        console.log(`   JELLYFIN_API_KEY: ${jellyfinApiKey ? '✓' : '❌'}`);
        console.log('\n   Set these variables to test Jellyfin integration.');
        return;
    }

    console.log('✓ All environment variables are set\n');

    // Test 2: Test server connection
    console.log('2. Testing server connection...');

    const testConfig = {
        name: 'Test Jellyfin Server',
        type: 'jellyfin',
        hostnameEnvVar: 'JELLYFIN_HOSTNAME',
        portEnvVar: 'JELLYFIN_PORT',
        tokenEnvVar: 'JELLYFIN_API_KEY',
        enabled: true,
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
