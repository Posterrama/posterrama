#!/usr/bin/env node
/**
 * MQTT Entity Cleanup Script
 *
 * Removes old/orphaned MQTT entities from Home Assistant by:
 * 1. Publishing empty payloads to all known capability discovery topics
 * 2. Forcing a fresh republish of current capabilities
 * 3. Removing Posterrama entities/devices from the Home Assistant registry (optional, via HA WebSocket API)
 *
 * Usage:
 *   node scripts/mqtt-cleanup-entities.js
 *
 * Home Assistant registry cleanup:
 *   - Set HOME_ASSISTANT_URL (e.g. http://homeassistant.local:8123)
 *   - Set HOME_ASSISTANT_TOKEN (Long-Lived Access Token)
 *   - By default, the script will prompt before deleting registry entries
 *   - Use --yes to skip prompt
 *
 * Modes:
 *   --ha-only     Only remove from HA registry (no MQTT publish)
 *   --mqtt-only   Only publish MQTT discovery cleanup/republish
 *   --dry-run     Do not delete HA registry entries (still prints what would be removed)
 *   --no-republish Clear MQTT discovery but do not recreate entities
 */

const mqtt = require('mqtt');
const deviceStore = require('../utils/deviceStore');
const capabilityRegistry = require('../utils/capabilityRegistry');
const config = require('../config.json');
const logger = require('../utils/logger');
const WebSocket = require('ws');
const readline = require('readline');

function parseArgs(argv) {
    const args = new Set((argv || []).slice(2));
    return {
        yes: args.has('--yes'),
        dryRun: args.has('--dry-run'),
        haOnly: args.has('--ha-only'),
        mqttOnly: args.has('--mqtt-only'),
        noRepublish: args.has('--no-republish'),
    };
}

function buildHaWsUrl(homeAssistantUrl) {
    const raw = String(homeAssistantUrl || '').trim();
    if (!raw) return null;

    try {
        const u = new URL(raw);
        const protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${u.host}/api/websocket`;
    } catch (_) {
        // Common: users pass "homeassistant.local:8123" (no scheme)
        try {
            if (!/^https?:\/\//i.test(raw) && !/^wss?:\/\//i.test(raw)) {
                const u = new URL(`http://${raw}`);
                const protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
                return `${protocol}//${u.host}/api/websocket`;
            }
        } catch (_) {
            // fall through
        }

        // Allow users to pass ws(s)://... directly
        if (raw.startsWith('ws://') || raw.startsWith('wss://')) {
            return raw.endsWith('/api/websocket') ? raw : `${raw.replace(/\/$/, '')}/api/websocket`;
        }
        return null;
    }
}

async function promptYesNo(question) {
    if (!process.stdin.isTTY) return false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await new Promise(resolve => rl.question(question, resolve));
        return String(answer || '')
            .trim()
            .toLowerCase()
            .startsWith('y');
    } finally {
        rl.close();
    }
}

async function haWsConnect({ url, token, timeoutMs = 10000 }) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
            try {
                ws.close();
            } catch (_) {
                /* noop */
            }
            reject(new Error('Home Assistant WebSocket connection timeout'));
        }, timeoutMs);

        ws.once('error', err => {
            clearTimeout(timeout);
            reject(err);
        });

        ws.once('open', () => {
            // Wait for auth_required, then auth
        });

        const onMessage = msg => {
            let data;
            try {
                data = JSON.parse(String(msg));
            } catch (_) {
                return;
            }

            if (data.type === 'auth_required') {
                ws.send(JSON.stringify({ type: 'auth', access_token: token }));
                return;
            }

            if (data.type === 'auth_ok') {
                clearTimeout(timeout);
                ws.off('message', onMessage);
                resolve(ws);
                return;
            }

            if (data.type === 'auth_invalid') {
                clearTimeout(timeout);
                ws.off('message', onMessage);
                reject(new Error('Home Assistant auth failed (invalid token)'));
            }
        };

        ws.on('message', onMessage);
    });
}

function haWsRequest(ws, request, timeoutMs = 15000) {
    const id = request.id;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.off('message', onMessage);
            reject(new Error(`Home Assistant request timeout (id=${id})`));
        }, timeoutMs);

        const onMessage = raw => {
            let msg;
            try {
                msg = JSON.parse(String(raw));
            } catch (_) {
                return;
            }
            if (msg.id !== id) return;
            clearTimeout(timer);
            ws.off('message', onMessage);
            if (msg.success) return resolve(msg.result);
            const err = msg.error?.message || 'Home Assistant request failed';
            reject(new Error(err));
        };

        ws.on('message', onMessage);
        ws.send(JSON.stringify(request));
    });
}

function isPosterramaEntity(entity) {
    const uniqueId = String(entity?.unique_id || '');
    const entityId = String(entity?.entity_id || '');
    const originalName = String(entity?.original_name || '');
    const platform = String(entity?.platform || '');

    if (uniqueId.toLowerCase().startsWith('posterrama_')) return true;
    if (entityId.toLowerCase().includes('posterrama')) return true;
    if (originalName.toLowerCase().includes('posterrama')) return true;

    // Some HA installs might prefix unique_id differently; keep this conservative.
    if (platform === 'mqtt' && uniqueId.toLowerCase().includes('posterrama')) return true;
    return false;
}

function isPosterramaDevice(device) {
    const manufacturer = String(device?.manufacturer || '');
    if (manufacturer.toLowerCase() === 'posterrama') return true;

    const identifiers = Array.isArray(device?.identifiers) ? device.identifiers : [];
    return identifiers.some(pair =>
        Array.isArray(pair)
            ? String(pair.join(':')).toLowerCase().includes('posterrama')
            : String(pair).toLowerCase().includes('posterrama')
    );
}

async function cleanupHomeAssistantRegistry({ yes, dryRun }) {
    const haUrl = process.env.HOME_ASSISTANT_URL || process.env.HASS_URL || process.env.HA_URL;
    const haToken =
        process.env.HOME_ASSISTANT_TOKEN ||
        process.env.HASS_TOKEN ||
        process.env.HA_TOKEN ||
        process.env.SUPERVISOR_TOKEN;
    const wsUrl = buildHaWsUrl(haUrl);

    if (!wsUrl || !haToken) {
        logger.warn(
            '⚠️  Skipping Home Assistant registry cleanup (set HOME_ASSISTANT_URL + HOME_ASSISTANT_TOKEN to enable)'
        );
        logger.warn('   Detected:', {
            hasUrl: Boolean(haUrl),
            urlValue: haUrl ? String(haUrl) : undefined,
            hasToken: Boolean(haToken),
        });
        return { removedEntities: 0, removedDevices: 0, matchedEntities: 0, matchedDevices: 0 };
    }

    logger.info('🏠 Connecting to Home Assistant WebSocket API...');
    const ws = await haWsConnect({ url: wsUrl, token: haToken });
    logger.info('✅ Connected to Home Assistant');

    let nextId = 1;
    const req = type => ({ id: nextId++, type });

    try {
        const entities = await haWsRequest(ws, req('config/entity_registry/list'));
        const devices = await haWsRequest(ws, req('config/device_registry/list'));

        const posterramaDevices = (Array.isArray(devices) ? devices : []).filter(
            isPosterramaDevice
        );
        const posterramaDeviceIds = new Set(posterramaDevices.map(d => d?.id).filter(Boolean));

        const posterramaEntities = (Array.isArray(entities) ? entities : []).filter(e => {
            if (isPosterramaEntity(e)) return true;
            const deviceId = e?.device_id;
            return deviceId ? posterramaDeviceIds.has(deviceId) : false;
        });

        logger.info(
            `🔎 Home Assistant registry matches: ${posterramaEntities.length} entities, ${posterramaDevices.length} devices`
        );

        if (posterramaEntities.length === 0 && posterramaDevices.length === 0) {
            return { removedEntities: 0, removedDevices: 0, matchedEntities: 0, matchedDevices: 0 };
        }

        if (dryRun) {
            logger.info('🧪 Dry-run enabled: no registry entries will be deleted');
            return {
                removedEntities: 0,
                removedDevices: 0,
                matchedEntities: posterramaEntities.length,
                matchedDevices: posterramaDevices.length,
            };
        }

        if (!yes) {
            const ok = await promptYesNo(
                `Delete ${posterramaEntities.length} entities and ${posterramaDevices.length} devices from Home Assistant? (y/N) `
            );
            if (!ok) {
                logger.warn('Aborted Home Assistant cleanup. Re-run with --yes to skip prompt.');
                return {
                    removedEntities: 0,
                    removedDevices: 0,
                    matchedEntities: posterramaEntities.length,
                    matchedDevices: posterramaDevices.length,
                };
            }
        }

        let removedEntities = 0;
        for (const e of posterramaEntities) {
            const entityId = e?.entity_id;
            if (!entityId) continue;
            try {
                await haWsRequest(ws, {
                    id: nextId++,
                    type: 'config/entity_registry/remove',
                    entity_id: entityId,
                });
                removedEntities++;
            } catch (err) {
                logger.warn('Failed to remove entity from HA registry', {
                    entity_id: entityId,
                    error: err?.message || String(err),
                });
            }
        }

        // Devices should be removed after entities; HA may block device removal if entities remain.
        let removedDevices = 0;
        for (const d of posterramaDevices) {
            const deviceId = d?.id;
            if (!deviceId) continue;
            try {
                await haWsRequest(ws, {
                    id: nextId++,
                    type: 'config/device_registry/remove',
                    device_id: deviceId,
                });
                removedDevices++;
            } catch (err) {
                logger.warn('Failed to remove device from HA registry', {
                    device_id: deviceId,
                    error: err?.message || String(err),
                });
            }
        }

        return {
            removedEntities,
            removedDevices,
            matchedEntities: posterramaEntities.length,
            matchedDevices: posterramaDevices.length,
        };
    } finally {
        try {
            ws.close();
        } catch (_) {
            /* noop */
        }
    }
}

async function cleanupEntities() {
    const args = parseArgs(process.argv);

    logger.info('🧹 Starting MQTT entity cleanup...');
    logger.info('⚠️  This will remove ALL Posterrama entities from Home Assistant');
    logger.info('   They will be recreated with current configuration');

    const doHa = !args.mqttOnly;
    const doMqtt = !args.haOnly;

    // Step A: remove from Home Assistant registry (handles large backlogs of old devices)
    let haResult = {
        removedEntities: 0,
        removedDevices: 0,
        matchedEntities: 0,
        matchedDevices: 0,
    };
    if (doHa) {
        try {
            haResult = await cleanupHomeAssistantRegistry({ yes: args.yes, dryRun: args.dryRun });
        } catch (e) {
            logger.error('❌ Home Assistant registry cleanup failed:', e?.message || e);
        }
    }

    // Step B: MQTT retained discovery cleanup/republish
    if (!doMqtt) {
        logger.info('✅ Done (HA-only mode).');
        logger.info(
            `HA registry: removed ${haResult.removedEntities}/${haResult.matchedEntities} entities, ${haResult.removedDevices}/${haResult.matchedDevices} devices`
        );
        return;
    }

    // Check if MQTT is enabled
    if (!config.mqtt?.enabled) {
        logger.warn('⚠️  MQTT is not enabled in config.json - skipping MQTT publish cleanup');
        logger.info(
            `HA registry: removed ${haResult.removedEntities}/${haResult.matchedEntities} entities, ${haResult.removedDevices}/${haResult.matchedDevices} devices`
        );
        return;
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

        // Sweep ALL retained Posterrama discovery topics, including orphaned devices.
        // This is far more reliable than only iterating current deviceStore.
        // NOTE: MQTT wildcards must occupy an entire path segment; you cannot use partial wildcards
        // like "posterrama_+". Subscribe broadly, then filter topics in-code.
        const sweepFilter = `${discoveryPrefix}/+/+/+/config`;
        logger.info(`\n🧽 Sweeping retained discovery topics: ${sweepFilter}`);

        const discoveredTopics = new Set();
        const onMsg = (topic, _payload, packet) => {
            if (!packet?.retain) return;
            const t = String(topic || '');
            const parts = t.split('/');
            // Expected: {discoveryPrefix}/{component}/{nodeId}/{objectId}/config
            // Example: homeassistant/select/posterrama_<deviceId>/settings_cinema_header_text/config
            if (parts.length !== 5) return;
            if (parts[0] !== discoveryPrefix) return;
            if (parts[4] !== 'config') return;
            if (!String(parts[2] || '').startsWith('posterrama_')) return;
            discoveredTopics.add(t);
        };
        client.on('message', onMsg);

        await new Promise((resolve, reject) => {
            client.subscribe(sweepFilter, { qos: 0 }, err => (err ? reject(err) : resolve()));
        });

        // Wait briefly for retained messages to arrive
        await new Promise(resolve => setTimeout(resolve, 2000));

        await new Promise(resolve => {
            client.unsubscribe(sweepFilter, () => resolve());
        });
        client.off('message', onMsg);

        const topicsToClear = Array.from(discoveredTopics);
        logger.info(
            `🗑️  Found ${topicsToClear.length} retained Posterrama discovery topic(s) to clear`
        );
        for (const t of topicsToClear) {
            await publish(client, t, '', { qos: 1, retain: true });
            totalUnpublished++;
        }

        if (topicsToClear.length > 0) {
            // Give HA a moment to process the retained removals
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        if (args.noRepublish) {
            logger.info('⏭️  Skipping republish (--no-republish enabled)');
        } else {
            for (const device of devices) {
                logger.info(`\n🔧 Processing device: ${device.name} (${device.id})`);

                // Republish only available capabilities for current mode
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

                logger.info(
                    `  ✅ Republished ${availableCapabilities.length} available capabilities`
                );
            }
        }

        logger.info(`\n✅ Cleanup complete!`);
        logger.info(`   Unpublished: ${totalUnpublished} entities`);
        logger.info(`   Republished: ${totalRepublished} entities`);
        logger.info(`   Removed: ${totalUnpublished - totalRepublished} old entities`);
        logger.info(
            `   HA registry removed: ${haResult.removedEntities}/${haResult.matchedEntities} entities, ${haResult.removedDevices}/${haResult.matchedDevices} devices`
        );
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

        case 'select': {
            let options = capability.options;
            if (typeof capability.optionsGetter === 'function') {
                try {
                    const next = capability.optionsGetter(device);
                    if (Array.isArray(next) && next.length) options = next;
                } catch (_) {
                    // ignore in cleanup script
                }
            }
            const safeOptions = Array.isArray(options) ? options : [];
            const fallbackOpt = safeOptions.length ? safeOptions[0] : '';
            return {
                ...baseConfig,
                state_topic: stateTopic,
                value_template: `{{ value_json['${capability.id}'] | default('${fallbackOpt}') }}`,
                command_topic: commandTopic,
                options: safeOptions,
                icon: capability.icon,
            };
        }

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
                pattern: capability.pattern || '.*',
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
