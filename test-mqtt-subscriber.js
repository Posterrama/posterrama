#!/usr/bin/env node
/**
 * Quick MQTT subscriber to see what topics are being published
 */
const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://192.168.10.20:1883', {
    username: 'mqtt',
    password: 'mqtt',
    clientId: 'posterrama-test-subscriber-' + Math.random().toString(16).substring(2, 8),
});

client.on('connect', () => {
    console.log('✅ Connected to MQTT broker');
    console.log('\n📡 Subscribing to all Posterrama topics...\n');

    client.subscribe('posterrama/#', err => {
        if (err) {
            console.error('❌ Subscribe error:', err);
        } else {
            console.log('✅ Subscribed to posterrama/#');
            console.log('\n--- Waiting for messages (Ctrl+C to exit) ---\n');
        }
    });

    // Also subscribe to Home Assistant discovery
    client.subscribe('homeassistant/#', err => {
        if (err) {
            console.error('❌ Subscribe error:', err);
        } else {
            console.log('✅ Subscribed to homeassistant/#');
        }
    });
});

client.on('message', (topic, message) => {
    console.log(`\n📨 Topic: ${topic}`);

    try {
        const parsed = JSON.parse(message.toString());
        console.log('   Payload:', JSON.stringify(parsed, null, 2));
    } catch (e) {
        console.log('   Payload:', message.toString());
    }
});

client.on('error', err => {
    console.error('❌ MQTT Error:', err.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Disconnecting...');
    client.end();
    process.exit(0);
});
