#!/usr/bin/env node
/**
 * Test MQTT command execution
 */
const mqtt = require('mqtt');

const deviceId = 'ed263bb6-dbca-4faf-b1ca-1c37440e5c25'; // MQTT Test device (online)

const client = mqtt.connect('mqtt://192.168.10.20:1883', {
    username: 'mqtt',
    password: 'mqtt',
    clientId: 'posterrama-command-test-' + Math.random().toString(16).substring(2, 8),
});

client.on('connect', () => {
    console.log('✅ Connected to MQTT broker\n');

    // Subscribe to state updates
    client.subscribe(`posterrama/device/${deviceId}/state`, err => {
        if (err) {
            console.error('❌ Subscribe error:', err);
        } else {
            console.log(`📡 Subscribed to device state updates\n`);

            // Wait 2 seconds then send a command
            setTimeout(() => {
                console.log('🎬 Sending NEXT command...\n');
                const topic = `posterrama/device/${deviceId}/command/playback_next`;
                client.publish(topic, JSON.stringify({}));

                // Keep listening for 10 more seconds
                setTimeout(() => {
                    console.log('\n✅ Test complete!');
                    client.end();
                    process.exit(0);
                }, 10000);
            }, 2000);
        }
    });
});

client.on('message', (topic, message) => {
    if (topic.includes('/state')) {
        console.log(`📊 State update received:`);
        try {
            const state = JSON.parse(message.toString());
            console.log(`   - Mode: ${state.mode}`);
            console.log(`   - Status: ${state.status}`);
            console.log(`   - Media: ${state.media_id}`);
            console.log(`   - Paused: ${state.paused}`);
            console.log();
        } catch (e) {
            console.log(message.toString());
        }
    }
});

client.on('error', err => {
    console.error('❌ MQTT Error:', err.message);
});
