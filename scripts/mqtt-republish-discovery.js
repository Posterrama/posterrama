#!/usr/bin/env node
/**
 * Force republish MQTT Discovery for all devices
 * This removes all old entity configs and publishes new ones with updated object_id format
 */

const deviceStore = require('../utils/deviceStore');
const MqttBridge = require('../utils/mqttBridge');
const config = require('../config/');
const logger = require('../utils/logger');

async function republishDiscovery() {
    try {
        logger.info('🔄 Starting MQTT discovery republish...');

        // Get all devices (deviceStore doesn't need init)
        const devices = await deviceStore.getAll();
        logger.info(`Found ${devices.length} devices`);

        if (!config.mqtt?.enabled) {
            logger.error('MQTT is not enabled in config');
            process.exit(1);
        }

        // Initialize MQTT bridge
        const mqttBridge = new MqttBridge(config.mqtt);
        await mqttBridge.init();

        // Wait a bit for connection to stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));

        // For each device, force republish
        for (const device of devices) {
            logger.info(`📡 Republishing discovery for device: ${device.name || device.id}`);

            // Clear cache to force republish
            mqttBridge.discoveryPublished.delete(device.id);

            // Unpublish all old configs first
            await mqttBridge.unpublishAllCapabilities(device);

            // Wait a bit for HA to process the removals
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Publish new configs
            await mqttBridge.publishDiscovery(device);

            // Publish current state
            await mqttBridge.publishDeviceState(device);
            await mqttBridge.publishCameraState(device);

            logger.info(`✅ Completed for ${device.name || device.id}`);
        }

        logger.info('✅ All devices republished successfully');

        // Shutdown
        await mqttBridge.shutdown();
        process.exit(0);
    } catch (error) {
        logger.error('Error republishing discovery:', error);
        process.exit(1);
    }
}

republishDiscovery();
