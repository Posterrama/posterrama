#!/usr/bin/env node
/**
 * Test MQTT settings command
 */
const mqtt = require('mqtt');

const deviceId = 'ed263bb6-dbca-4faf-b1ca-1c37440e5c25';

const client = mqtt.connect('mqtt://192.168.10.20:1883', {
    username: 'mqtt',
    password: 'mqtt',
    clientId: 'posterrama-settings-test-' + Math.random().toString(16).substring(2, 8),
});

console.log('🧪 Testing MQTT Settings Commands\n');

client.on('connect', () => {
    console.log('✅ Connected\n');

    // Test 1: Set transition interval to 15 seconds
    setTimeout(() => {
        console.log('1️⃣  Setting transition interval to 15 seconds...');
        client.publish(`posterrama/device/${deviceId}/command/settings_transitionInterval`, '15');
    }, 1000);

    // Test 2: Change transition effect to kenburns
    setTimeout(() => {
        console.log('2️⃣  Changing transition effect to kenburns...');
        client.publish(
            `posterrama/device/${deviceId}/command/settings_transitionEffect`,
            'kenburns'
        );
    }, 2000);

    // Test 3: Toggle show metadata
    setTimeout(() => {
        console.log('3️⃣  Turning ON show metadata...');
        client.publish(`posterrama/device/${deviceId}/command/settings_showMetadata`, 'ON');
    }, 3000);

    // Test 4: Set UI scale to 120%
    setTimeout(() => {
        console.log('4️⃣  Setting UI scale to 120%...');
        client.publish(`posterrama/device/${deviceId}/command/settings_uiScaling_global`, '120');
    }, 4000);

    setTimeout(() => {
        console.log('\n✅ All commands sent!');
        console.log('\n📊 Check server logs:');
        console.log('   pm2 logs posterrama --lines 20 | grep "Executing MQTT"');
        setTimeout(() => {
            client.end();
            process.exit(0);
        }, 2000);
    }, 5000);
});

client.on('error', err => {
    console.error('❌ MQTT Error:', err.message);
    process.exit(1);
});
