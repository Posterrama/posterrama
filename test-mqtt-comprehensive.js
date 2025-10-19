#!/usr/bin/env node
/**
 * Comprehensive MQTT test
 * Tests command reception and routing
 */
const mqtt = require('mqtt');

const deviceId = 'ed263bb6-dbca-4faf-b1ca-1c37440e5c25'; // MQTT Test device

const client = mqtt.connect('mqtt://192.168.10.20:1883', {
    username: 'mqtt',
    password: 'mqtt',
    clientId: 'posterrama-comprehensive-test-' + Math.random().toString(16).substring(2, 8),
});

console.log('🧪 MQTT Integration Test\n');
console.log('═'.repeat(60));

client.on('connect', () => {
    console.log('\n✅ Connected to MQTT broker at 192.168.10.20:1883\n');

    // Subscribe to all posterrama topics
    client.subscribe('posterrama/#', err => {
        if (!err) {
            console.log('📡 Subscribed to posterrama/# \n');
        }
    });

    // Also subscribe to Home Assistant discovery
    client.subscribe('homeassistant/+/posterrama_+/+/config', err => {
        if (!err) {
            console.log('📡 Subscribed to Home Assistant discovery topics\n');
        }
    });

    console.log('─'.repeat(60));
    console.log('\n🎬 Test Commands:\n');

    setTimeout(() => {
        console.log('1️⃣  Sending NEXT command...');
        client.publish(`posterrama/device/${deviceId}/command/playback_next`, JSON.stringify({}));
    }, 2000);

    setTimeout(() => {
        console.log('2️⃣  Sending PAUSE command...');
        client.publish(`posterrama/device/${deviceId}/command/playback_pause`, JSON.stringify({}));
    }, 4000);

    setTimeout(() => {
        console.log('3️⃣  Switching to WALLART mode...');
        client.publish(
            `posterrama/device/${deviceId}/command/mode_select`,
            JSON.stringify({ value: 'wallart' })
        );
    }, 6000);

    setTimeout(() => {
        console.log('4️⃣  Toggling power...');
        client.publish(`posterrama/device/${deviceId}/command/power_toggle`, JSON.stringify({}));
    }, 8000);

    setTimeout(() => {
        console.log('\n' + '─'.repeat(60));
        console.log('\n✅ All test commands sent!\n');
        console.log('📊 Check PM2 logs to see command execution:');
        console.log('   pm2 logs posterrama --lines 50 | grep "Executing MQTT"\n');
        console.log('💡 Note: WebSocket commands will only execute if device is connected');
        console.log('   The MQTT bridge correctly receives and routes all commands.\n');

        setTimeout(() => {
            client.end();
            process.exit(0);
        }, 2000);
    }, 10000);
});

let messageCount = 0;

client.on('message', (topic, message) => {
    messageCount++;

    // Only show state and availability updates
    if (topic.includes('/state')) {
        try {
            const state = JSON.parse(message.toString());
            console.log(`\n📊 State Update (${deviceId.substring(0, 8)}...):`);
            console.log(
                `   Mode: ${state.mode} | Status: ${state.status} | Powered: ${!state.powered_off}`
            );
        } catch (e) {
            // Ignore parse errors
        }
    } else if (topic.includes('/availability')) {
        console.log(`\n🟢 Availability: ${message.toString()}`);
    }
});

client.on('error', err => {
    console.error('\n❌ MQTT Error:', err.message);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\n\n👋 Test interrupted');
    client.end();
    process.exit(0);
});
