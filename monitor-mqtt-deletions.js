#!/usr/bin/env node
/**
 * Simple test: Monitor MQTT when deleting a device
 *
 * Usage: Manually delete a device via admin UI, this script shows the MQTT cleanup
 */

const mqtt = require('mqtt');

const MQTT_BROKER = 'mqtt://192.168.10.20:1883';

const client = mqtt.connect(MQTT_BROKER, {
    username: 'mqtt',
    password: 'mqtt',
    clientId: 'posterrama-monitor-' + Math.random().toString(16).substring(2, 8),
});

console.log('🔍 Monitoring MQTT for device deletions...\n');
console.log('Delete a device via the admin UI and watch this output.\n');
console.log('Press Ctrl+C to exit\n');
console.log('═'.repeat(60) + '\n');

client.on('connect', () => {
    console.log('✅ Connected to MQTT broker\n');

    // Subscribe to all posterrama topics
    client.subscribe('homeassistant/#', err => {
        if (err) {
            console.error('❌ Subscribe error:', err);
            process.exit(1);
        }
    });

    console.log('👀 Watching for changes...\n');
});

client.on('message', (topic, message) => {
    // Only show posterrama-related messages
    if (topic.includes('posterrama_')) {
        const payload = message.toString();
        const timestamp = new Date().toLocaleTimeString();

        // Empty payload = entity removal
        if (payload === '') {
            const parts = topic.split('/');
            const entityType = parts[1]; // button, switch, select, etc
            const deviceId = parts[2]; // posterrama_xxx
            const capability = parts[3]; // capability name

            console.log(`🗑️  [${timestamp}] REMOVED ${entityType}.${capability}`);
            console.log(`   Topic: ${topic}`);
            console.log(`   Device: ${deviceId}`);
            console.log();
        } else if (topic.endsWith('/config')) {
            // New/updated entity
            try {
                const config = JSON.parse(payload);
                const timestamp = new Date().toLocaleTimeString();
                console.log(`📡 [${timestamp}] PUBLISHED ${config.name}`);
                console.log(`   Unique ID: ${config.unique_id}`);
                console.log();
            } catch (e) {
                // Ignore parse errors
            }
        }
    }
});

client.on('error', err => {
    console.error('\n❌ MQTT Error:', err.message);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\n\n👋 Monitoring stopped');
    client.end();
    process.exit(0);
});
