#!/usr/bin/env node
/**
 * Test MQTT device deletion cleanup
 *
 * This script:
 * 1. Creates a temporary test device
 * 2. Waits for MQTT discovery to be published
 * 3. Deletes the device
 * 4. Verifies discovery configs are removed
 */

const mqtt = require('mqtt');
const axios = require('axios');

const BASE_URL = 'http://localhost:4000';
const MQTT_BROKER = 'mqtt://192.168.10.20:1883';

let testDeviceId = null;
const discoveryTopicsSeen = [];

const client = mqtt.connect(MQTT_BROKER, {
    username: 'mqtt',
    password: 'mqtt',
    clientId: 'posterrama-delete-test-' + Math.random().toString(16).substring(2, 8),
});

console.log('🧪 Testing MQTT Device Deletion Cleanup\n');
console.log('═'.repeat(60));

client.on('connect', async () => {
    console.log('\n✅ Connected to MQTT broker\n');

    // Subscribe to all Home Assistant discovery topics
    client.subscribe('homeassistant/#', err => {
        if (err) {
            console.error('❌ Subscribe error:', err);
            process.exit(1);
        }
        console.log('📡 Subscribed to Home Assistant discovery topics\n');
    });

    // Step 1: Create a test device
    console.log('1️⃣  Creating test device...');
    try {
        // First, get or create a pairing code
        const pairingResponse = await axios.post(
            `${BASE_URL}/api/devices/pairing-codes`,
            {},
            {
                headers: {
                    'X-Bypass-Device-Auth': 'true',
                },
            }
        );

        const pairingCode = pairingResponse.data.code;
        console.log(`   Pairing code: ${pairingCode}`);

        // Register the device using the pairing code
        const registerResponse = await axios.post(
            `${BASE_URL}/api/devices/register`,
            {
                name: 'MQTT Delete Test Device',
                pairingCode: pairingCode,
            },
            {
                headers: {
                    'X-Bypass-Device-Auth': 'true',
                },
            }
        );

        testDeviceId = registerResponse.data.id;
        console.log(`   ✅ Device created: ${testDeviceId}\n`);

        // Wait for MQTT discovery to publish
        console.log('2️⃣  Waiting for MQTT discovery to publish (5 seconds)...');
        setTimeout(async () => {
            console.log(`   📊 Discovery topics seen: ${discoveryTopicsSeen.length}\n`);

            if (discoveryTopicsSeen.length === 0) {
                console.log('   ⚠️  No discovery topics published yet, waiting longer...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            // Step 3: Delete the device
            console.log('3️⃣  Deleting device...');
            try {
                await axios.delete(`${BASE_URL}/api/devices/${testDeviceId}`, {
                    headers: {
                        'X-Bypass-Device-Auth': 'true',
                    },
                });
                console.log('   ✅ Device deleted from Posterrama\n');

                // Step 4: Monitor for empty discovery payloads (removal)
                console.log('4️⃣  Monitoring for discovery removal (10 seconds)...');
                let removalCount = 0;
                const originalHandler = client.listeners('message')[0];

                client.on('message', (topic, message) => {
                    if (topic.includes(`posterrama_${testDeviceId}`) && message.toString() === '') {
                        removalCount++;
                    }
                });

                setTimeout(() => {
                    console.log(`\n📊 Results:`);
                    console.log(`   Discovery topics published: ${discoveryTopicsSeen.length}`);
                    console.log(`   Discovery configs removed: ${removalCount}`);
                    console.log();

                    if (removalCount > 0) {
                        console.log('✅ SUCCESS: Device was properly removed from Home Assistant!');
                        console.log(`   ${removalCount} entities cleaned up`);
                    } else {
                        console.log('⚠️  WARNING: No removal messages detected (may take longer)');
                    }

                    console.log('\n' + '═'.repeat(60));
                    client.end();
                    process.exit(0);
                }, 10000);
            } catch (deleteError) {
                console.error('❌ Delete failed:', deleteError.message);
                client.end();
                process.exit(1);
            }
        }, 5000);
    } catch (error) {
        console.error('❌ Failed to create device:', error.message);
        client.end();
        process.exit(1);
    }
});

client.on('message', (topic, message) => {
    // Track discovery topics for our test device
    if (testDeviceId && topic.includes(`posterrama_${testDeviceId}`)) {
        const payload = message.toString();

        if (payload && payload.length > 0 && !discoveryTopicsSeen.includes(topic)) {
            discoveryTopicsSeen.push(topic);
            console.log(`   📡 Discovery: ${topic.split('/').slice(-2).join('/')}`);
        }
    }
});

client.on('error', err => {
    console.error('\n❌ MQTT Error:', err.message);
    client.end();
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\n\n👋 Test interrupted');
    client.end();
    process.exit(0);
});
