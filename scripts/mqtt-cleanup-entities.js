#!/usr/bin/env node
/**
 * MQTT Entity Cleanup Script
 *
 * Removes old/orphaned MQTT entities from Home Assistant by:
 * 1. Publishing empty payloads to all known capability discovery topics
 * 2. Forcing a fresh republish of current capabilities
 *
 * Usage: node scripts/mqtt-cleanup-entities.js
 */

const mqtt = require('mqtt');
const deviceStore = require('../utils/deviceStore');
const capabilityRegistry = require('../utils/capabilityRegistry');
const config = require('../config.json');
const logger = require('../utils/logger');

async function cleanupEntities() {
    logger.info('🧹 Starting MQTT entity cleanup...');
    logger.info('⚠️  This will remove ALL Posterrama entities from Home Assistant');
    logger.info('   They will be recreated with current configuration');

    // Check if MQTT is enabled
    if (!config.mqtt?.enabled) {
        logger.error('❌ MQTT is not enabled in config.json');
        process.exit(1);
    }

    // Connect to MQTT broker
    const brokerHost =
        typeof config.mqtt.broker === 'string'
            ? config.mqtt.broker
            : config.mqtt.broker?.host || 'localhost';
    const brokerPort =
        typeof config.mqtt.broker === 'object'
            ? config.mqtt.broker.port || 1883
            : config.mqtt.port || 1883;
    const brokerUrl = `mqtt://${brokerHost}:${brokerPort}`;

    const mqttOptions = {
        clientId: `posterrama_cleanup_${Date.now()}`,
        clean: true,
        username: config.mqtt.broker?.username || config.mqtt.username,
        password: config.mqtt.broker?.password || config.mqtt.password,
    };

    logger.info(`📡 Connecting to MQTT broker: ${brokerUrl}`);

    const client = mqtt.connect(brokerUrl, mqttOptions);

    await new Promise((resolve, reject) => {
        client.on('connect', resolve);
        client.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });

    logger.info('✅ Connected to MQTT broker');

    try {
        // Initialize capability registry to get all known capabilities
        capabilityRegistry.init();
        const allCapabilities = capabilityRegistry.getAllCapabilities();

        // Get all devices
        const devices = await deviceStore.getAll();
        logger.info(
            `Found ${devices.length} device(s) and ${allCapabilities.length} capability types`
        );

        const discoveryPrefix = config.mqtt.discovery?.prefix || 'homeassistant';
        const topicPrefix = config.mqtt.topicPrefix || 'posterrama';

        let totalUnpublished = 0;
        let totalRepublished = 0;

        for (const device of devices) {
            logger.info(`\n🔧 Processing device: ${device.name} (${device.id})`);

            // Step 1: Unpublish ALL entity types with a wildcard pattern
            // This ensures we catch everything, including old renamed entities
            logger.info('  🗑️  Removing ALL Posterrama entities (all components)...');

            const allComponents = [
                'button',
                'switch',
                'select',
                'number',
                'text',
                'sensor',
                'camera',
                'binary_sensor',
                'light',
                'climate',
            ];

            // For each component type, unpublish all possible entity patterns
            for (const component of allComponents) {
                // Unpublish all current known capabilities for this component
                for (const cap of allCapabilities) {
                    if (getHomeAssistantComponent(cap.entityType) === component) {
                        const objectId = cap.id.replace(/\./g, '_');
                        const discoveryTopic = `${discoveryPrefix}/${component}/posterrama_${device.id}/${objectId}/config`;
                        await publish(client, discoveryTopic, '', { qos: 1, retain: true });
                        totalUnpublished++;
                    }
                }

                // Also unpublish common old patterns that might still exist
                const oldPatterns = [
                    'device_lastSeen',
                    'settings_wallartMode_refreshRate',
                    'power_on',
                    'power_off',
                    'device_reload',
                    'device_reset',
                    'settings_wallartMode_heroRotation', // Old switch version
                ];

                for (const pattern of oldPatterns) {
                    const discoveryTopic = `${discoveryPrefix}/${component}/posterrama_${device.id}/${pattern}/config`;
                    await publish(client, discoveryTopic, '', { qos: 1, retain: true });
                    totalUnpublished++;
                }
            }

            logger.info(
                `  ✅ Unpublished all entities across ${allComponents.length} component types`
            );

            // Step 2: Wait a bit to ensure Home Assistant processes the unpublish
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 3: Republish only available capabilities for current mode
            logger.info('  📥 Republishing available capabilities...');
            const availableCapabilities = capabilityRegistry.getAvailableCapabilities(device);

            for (const cap of availableCapabilities) {
                const discoveryConfig = buildDiscoveryConfig(device, cap, topicPrefix, config);
                const component = getHomeAssistantComponent(cap.entityType);
                const objectId = cap.id.replace(/\./g, '_');
                const discoveryTopic = `${discoveryPrefix}/${component}/posterrama_${device.id}/${objectId}/config`;

                await publish(client, discoveryTopic, JSON.stringify(discoveryConfig), {
                    qos: 1,
                    retain: true,
                });
                totalRepublished++;
            }

            logger.info(`  ✅ Republished ${availableCapabilities.length} available capabilities`);
        }

        logger.info(`\n✅ Cleanup complete!`);
        logger.info(`   Unpublished: ${totalUnpublished} entities`);
        logger.info(`   Republished: ${totalRepublished} entities`);
        logger.info(`   Removed: ${totalUnpublished - totalRepublished} old entities`);
    } catch (error) {
        logger.error('❌ Cleanup failed:', error);
        process.exit(1);
    } finally {
        client.end();
        // Give some time for final messages to send
        setTimeout(() => process.exit(0), 1000);
    }
}

// Helper: publish to MQTT
function publish(client, topic, message, options) {
    return new Promise((resolve, reject) => {
        client.publish(topic, message, options, err => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Helper: map entity type to HA component
function getHomeAssistantComponent(entityType) {
    const mapping = {
        button: 'button',
        switch: 'switch',
        select: 'select',
        number: 'number',
        text: 'text',
        sensor: 'sensor',
        camera: 'camera',
    };
    return mapping[entityType] || 'sensor';
}

// Helper: build discovery config (simplified version)
function buildDiscoveryConfig(device, capability, topicPrefix, config) {
    const packageJson = require('../package.json');

    const baseConfig = {
        object_id: capability.id.replace(/\./g, '_'),
        name: capability.name,
        unique_id: `posterrama_${device.id}_${capability.id}`,
        device: {
            identifiers: [`posterrama_${device.id}`],
            name: device.name || `Posterrama ${device.id}`,
            manufacturer: 'Posterrama',
            model: 'Media Display',
            sw_version: packageJson.version,
        },
    };

    // Add entity_category based on capability category (CRITICAL for proper HA grouping)
    if (capability.category === 'settings') {
        baseConfig.entity_category = 'config';
    } else if (capability.category === 'diagnostic' || capability.category === 'sensor') {
        baseConfig.entity_category = 'diagnostic';
    }
    // 'mode' and 'camera' categories get no entity_category = they appear as main controls

    // Add availability if enabled
    if (config.mqtt.availability?.enabled) {
        baseConfig.availability = {
            topic: `${topicPrefix}/device/${device.id}/availability`,
        };
    }

    const objectId = capability.id.replace(/\./g, '_');
    const commandTopic = `${topicPrefix}/device/${device.id}/command/${objectId}`;
    const stateTopic = `${topicPrefix}/device/${device.id}/state`;

    // Build entity-specific config
    switch (capability.entityType) {
        case 'button':
            return {
                ...baseConfig,
                command_topic: commandTopic,
                icon: capability.icon,
                payload_press: '{}',
            };

        case 'switch':
            return {
                ...baseConfig,
                state_topic: stateTopic,
                value_template: `{{ value_json['${capability.id}'] | default(false) }}`,
                command_topic: commandTopic,
                payload_on: 'ON',
                payload_off: 'OFF',
                state_on: true,
                state_off: false,
                icon: capability.icon,
            };

        case 'select':
            return {
                ...baseConfig,
                state_topic: stateTopic,
                value_template: `{{ value_json['${capability.id}'] | default('${capability.options[0]}') }}`,
                command_topic: commandTopic,
                options: capability.options,
                icon: capability.icon,
            };

        case 'number':
            return {
                ...baseConfig,
                state_topic: stateTopic,
                value_template: `{{ value_json['${capability.id}'] | default(${capability.min || 0}) }}`,
                command_topic: commandTopic,
                min: capability.min || 0,
                max: capability.max || 100,
                step: capability.step || 1,
                mode: 'slider',
                icon: capability.icon,
            };

        case 'text':
            return {
                ...baseConfig,
                state_topic: stateTopic,
                value_template: `{{ value_json['${capability.id}'] | default('') }}`,
                command_topic: commandTopic,
                icon: capability.icon,
            };

        case 'sensor':
            return {
                ...baseConfig,
                state_topic: stateTopic,
                value_template: `{{ value_json['${capability.id}'] | default('Unknown') }}`,
                icon: capability.icon,
            };

        case 'camera':
            return {
                ...baseConfig,
                image_topic: `${topicPrefix}/device/${device.id}/camera`,
                image_encoding: 'b64',
                icon: capability.icon,
            };

        default:
            return baseConfig;
    }
}

// Run cleanup
cleanupEntities().catch(err => {
    logger.error('Fatal error:', err);
    process.exit(1);
});
