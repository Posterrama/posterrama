/**
 * MQTT Bridge
 *
 * Bridges Posterrama device management to MQTT for Home Assistant integration.
 * Handles:
 * - Connection to MQTT broker
 * - Publishing device state
 * - Publishing Home Assistant Discovery configs
 * - Receiving and routing commands
 * - Availability tracking
 */

const mqtt = require('mqtt');
const EventEmitter = require('events');
const logger = require('./logger');
const capabilityRegistry = require('./capabilityRegistry');

class MqttBridge extends EventEmitter {
    constructor(config) {
        super();
        this.client = null;
        this.connected = false;
        this.config = config || null;
        this.stats = {
            published: 0,
            errors: 0,
        };
        this.deviceStates = new Map();
        this.discoveryPublished = new Set();
        this.deviceModes = new Map(); // Track device modes to detect changes
    }

    /**
     * Initialize MQTT connection and setup
     */
    async init() {
        if (!this.config || !this.config.enabled) {
            logger.info('MQTT bridge disabled in configuration');
            return;
        }

        try {
            // Support both flat and nested config structures
            // If broker is a string (flat), use it directly
            // If broker is an object (nested), use broker.host
            const brokerHost =
                typeof this.config.broker === 'string'
                    ? this.config.broker
                    : this.config.broker?.host || 'localhost';
            const brokerPort =
                typeof this.config.broker === 'object'
                    ? this.config.broker.port || 1883
                    : this.config.port || 1883;

            logger.info('🔌 Initializing MQTT bridge...', {
                broker: `${brokerHost}:${brokerPort}`,
                discovery: this.config.discovery?.enabled || false,
            });

            // Initialize capability registry
            capabilityRegistry.init();

            // Connect to broker
            await this.connect();

            // Setup periodic state publishing
            this.startStatePublishing();

            logger.info('✅ MQTT bridge initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize MQTT bridge:', error);
            this.stats.errors++;
            throw error;
        }
    }

    /**
     * Connect to MQTT broker
     */
    async connect() {
        return new Promise((resolve, reject) => {
            // Support both flat and nested config structures
            const brokerHost =
                typeof this.config.broker === 'string'
                    ? this.config.broker
                    : this.config.broker?.host || 'localhost';
            const brokerPort =
                typeof this.config.broker === 'object'
                    ? this.config.broker.port || 1883
                    : this.config.port || 1883;
            const brokerUrl = `mqtt://${brokerHost}:${brokerPort}`;

            const options = {
                clientId: `posterrama_${Date.now()}`,
                clean: true,
                reconnectPeriod: 5000,
                connectTimeout: 30000,
            };

            // Add authentication if configured - support both structures
            const username = this.config.broker?.username || this.config.username;
            const password = this.config.broker?.password || this.config.password;

            if (username) {
                options.username = username;
            }

            if (password) {
                options.password = password;
            }

            // Also check for password from env var (legacy)
            if (this.config.broker?.passwordEnvVar) {
                const envPassword = process.env[this.config.broker.passwordEnvVar];
                if (envPassword) {
                    options.password = envPassword;
                }
            }

            // TLS support
            if (this.config.broker?.tls || this.config.tls) {
                options.protocol = 'mqtts';
            }

            logger.debug('Connecting to MQTT broker...', {
                url: brokerUrl,
                clientId: options.clientId,
            });

            this.client = mqtt.connect(brokerUrl, options);

            this.client.on('connect', () => {
                this.connected = true;
                this.stats.connectedAt = new Date().toISOString();
                logger.info('✅ MQTT broker connected', { broker: brokerUrl });

                // Subscribe to command topics
                this.subscribeToCommands();

                resolve();
            });

            this.client.on('error', error => {
                logger.error('MQTT connection error:', error);
                this.stats.errors++;

                if (!this.connected) {
                    reject(error);
                }
            });

            this.client.on('reconnect', () => {
                logger.warn('MQTT reconnecting...');
            });

            this.client.on('offline', () => {
                this.connected = false;
                logger.warn('MQTT broker offline');
            });

            this.client.on('message', (topic, message) => {
                this.handleMessage(topic, message);
            });

            // Connection timeout
            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('MQTT connection timeout'));
                }
            }, options.connectTimeout);
        });
    }

    /**
     * Subscribe to command topics
     */
    subscribeToCommands() {
        if (!this.client || !this.connected) return;

        const prefix = this.config.topicPrefix || 'posterrama';

        // Subscribe to all device commands
        const deviceCommandTopic = `${prefix}/device/+/command/#`;

        // Subscribe to broadcast commands
        const broadcastCommandTopic = `${prefix}/broadcast/command/#`;

        this.client.subscribe([deviceCommandTopic, broadcastCommandTopic], err => {
            if (err) {
                logger.error('Failed to subscribe to command topics:', err);
                this.stats.errors++;
            } else {
                logger.info('📡 Subscribed to MQTT command topics', {
                    device: deviceCommandTopic,
                    broadcast: broadcastCommandTopic,
                });
            }
        });
    }

    /**
     * Handle incoming MQTT messages
     */
    async handleMessage(topic, message) {
        try {
            this.stats.messagesReceived++;

            const payload = message.toString();
            logger.debug('📨 MQTT message received', { topic, payload });

            // Parse topic to extract device ID and capability
            const prefix = this.config.topicPrefix || 'posterrama';

            // Device command: posterrama/device/{deviceId}/command/{capabilityId}
            const deviceMatch = topic.match(new RegExp(`^${prefix}/device/([^/]+)/command/(.+)$`));
            if (deviceMatch) {
                const [, deviceId, capabilityId] = deviceMatch;
                await this.handleDeviceCommand(deviceId, capabilityId, payload);
                return;
            }

            // Broadcast command: posterrama/broadcast/command/{capabilityId}
            const broadcastMatch = topic.match(new RegExp(`^${prefix}/broadcast/command/(.+)$`));
            if (broadcastMatch) {
                const [, capabilityId] = broadcastMatch;
                await this.handleBroadcastCommand(capabilityId, payload);
                return;
            }

            logger.warn('Unknown MQTT topic pattern:', topic);
        } catch (error) {
            logger.error('Error handling MQTT message:', error);
            this.stats.errors++;
        }
    }

    /**
     * Handle command for a specific device
     */
    async handleDeviceCommand(deviceId, capabilityId, payload) {
        try {
            // Convert MQTT topic format (underscores) to capability ID format (dots)
            // e.g., "playback_next" -> "playback.next"
            const normalizedCapabilityId = capabilityId.replace(/_/g, '.');

            const capability = capabilityRegistry.get(normalizedCapabilityId);

            if (!capability) {
                logger.warn('Unknown capability in command', {
                    deviceId,
                    capabilityId: normalizedCapabilityId,
                });
                return;
            }

            logger.info('🎮 Executing MQTT command', {
                deviceId,
                capabilityId: normalizedCapabilityId,
                payload,
            });

            // Parse payload (might be JSON or simple string)
            let value = payload;
            try {
                const parsed = JSON.parse(payload);
                value = parsed.value || parsed;
            } catch {
                // Not JSON, use as-is
            }

            // Execute command handler
            await capability.commandHandler(deviceId, value);

            this.stats.commandsExecuted++;
            logger.debug('✅ Command executed successfully', {
                deviceId,
                capabilityId: normalizedCapabilityId,
            });
        } catch (error) {
            logger.error('Error executing device command:', error);
            this.stats.errors++;
        }
    }

    /**
     * Handle broadcast command to all devices
     */
    async handleBroadcastCommand(capabilityId, payload) {
        try {
            const deviceStore = require('./deviceStore');
            const devices = await deviceStore.getAll();

            logger.info('📢 Executing broadcast command', {
                capabilityId,
                deviceCount: devices.length,
            });

            for (const device of devices) {
                await this.handleDeviceCommand(device.id, capabilityId, payload);
            }
        } catch (error) {
            logger.error('Error executing broadcast command:', error);
            this.stats.errors++;
        }
    }

    /**
     * Publish device state to MQTT
     */
    async publishDeviceState(device) {
        if (!this.client || !this.connected) return;

        try {
            const prefix = this.config.topicPrefix || 'posterrama';
            const stateTopic = `${prefix}/device/${device.id}/state`;

            // Debug: log device structure to understand what data we have
            const effectiveMode =
                device.clientInfo?.mode || device.currentState?.mode || 'screensaver';
            logger.debug('📊 Device state for MQTT publishing', {
                deviceId: device.id,
                mode: effectiveMode,
                clientInfoMode: device.clientInfo?.mode,
                currentStateMode: device.currentState?.mode,
                screen: device.clientInfo?.screen,
            });

            // Build state payload
            const state = {
                device_id: device.id,
                name: device.name || device.id,
                location: device.location || '',
                status: device.status || 'unknown',
                mode: device.clientInfo?.mode || device.currentState?.mode || 'screensaver',
                paused: device.currentState?.paused || false,
                pinned: device.currentState?.pinned || false,
                powered_off: device.currentState?.poweredOff || false,
                media_id: device.currentState?.mediaId || null,
                pin_media_id: device.currentState?.pinMediaId || null,
                last_seen: device.lastSeenAt || null,
                preset: device.preset || '',
            };

            // Check if mode changed - if so, republish discovery to update available entities
            const currentMode = state.mode;
            const previousMode = this.deviceModes.get(device.id);
            const modeChanged = previousMode && previousMode !== currentMode;

            if (modeChanged) {
                logger.info('🔄 Device mode changed, republishing discovery', {
                    deviceId: device.id,
                    previousMode,
                    currentMode,
                });

                // Unpublish ALL capabilities first (to remove unavailable ones from HA)
                await this.unpublishAllCapabilities(device);

                // Clear discovery cache to force republish
                this.discoveryPublished.delete(device.id);

                // Wait a bit to ensure HA processes the unpublish
                await new Promise(resolve => setTimeout(resolve, 500));

                // Republish only available capabilities for new mode
                await this.publishDiscovery(device);
            }
            this.deviceModes.set(device.id, currentMode);

            // Add capability-specific state values
            const capabilities = capabilityRegistry.getAvailableCapabilities(device);
            for (const cap of capabilities) {
                if (cap.stateGetter) {
                    try {
                        const value = cap.stateGetter(device);
                        state[cap.id] = value;
                    } catch (error) {
                        logger.error(`Error getting state for ${cap.id}:`, error);
                    }
                }
            }

            // Check if state changed (avoid unnecessary publishes)
            const stateKey = JSON.stringify(state);
            if (this.deviceStates.get(device.id) === stateKey) {
                return; // No change, skip publish
            }

            // Publish state
            await this.publish(stateTopic, JSON.stringify(state), { qos: 1, retain: false });

            this.deviceStates.set(device.id, stateKey);
            logger.debug('📤 Published device state', { deviceId: device.id, topic: stateTopic });
        } catch (error) {
            logger.error('Error publishing device state:', error);
            this.stats.errors++;
        }
    }

    /**
     * Publish availability status for a device
     */
    async publishDeviceAvailability(device) {
        if (!this.client || !this.connected) return;
        if (!this.config.availability?.enabled) return;

        try {
            const prefix = this.config.topicPrefix || 'posterrama';
            const availTopic = `${prefix}/device/${device.id}/availability`;

            const timeout = this.config.availability.timeout || 60;
            const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
            const now = new Date();

            let payload = 'offline';
            if (lastSeen && (now - lastSeen) / 1000 < timeout) {
                payload = 'online';
            }

            await this.publish(availTopic, payload, { qos: 1, retain: true });

            logger.debug('📶 Published availability', { deviceId: device.id, status: payload });
        } catch (error) {
            logger.error('Error publishing availability:', error);
            this.stats.errors++;
        }
    }

    /**
     * Publish camera preview notification (triggers Home Assistant to fetch image_url)
     */
    async publishCameraState(device) {
        if (!this.client || !this.connected) return;

        try {
            const prefix = this.config.topicPrefix || 'posterrama';
            const cameraTopic = `${prefix}/device/${device.id}/camera`;

            // Get the poster URL from device state
            const posterUrl = device.currentState?.posterUrl;
            if (!posterUrl) {
                logger.info('No poster URL available for camera state', { deviceId: device.id });
                return;
            }

            // Fetch the image and publish as base64
            const config = require('../config');
            const axios = require('axios');
            let imageUrl;

            // Build the full URL
            if (posterUrl.startsWith('/')) {
                // Local path - fetch from localhost
                imageUrl = `http://localhost:${config.serverPort || 4000}${posterUrl}`;
            } else if (posterUrl.startsWith('http')) {
                // Already a full URL
                imageUrl = posterUrl;
            } else {
                logger.info('Invalid poster URL format', { posterUrl });
                return;
            }

            logger.info('📷 Fetching camera image...', {
                deviceId: device.id,
                imageUrl: imageUrl.substring(0, 100),
            });

            // Fetch the image
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 5000,
                headers: {
                    'User-Agent': 'Posterrama-MQTT-Bridge/2.8.1',
                },
            });

            // Convert to base64
            const base64Image = Buffer.from(response.data).toString('base64');

            // Publish base64 image to MQTT
            await this.publish(cameraTopic, base64Image, { qos: 0, retain: false });

            logger.info('📷 Published camera image', {
                deviceId: device.id,
                imageSize: Math.round(response.data.length / 1024) + 'KB',
                base64Size: Math.round(base64Image.length / 1024) + 'KB',
            });
        } catch (error) {
            logger.error('Error publishing camera state:', {
                error: error.message,
                deviceId: device.id,
            });
            this.stats.errors++;
        }
    }

    /**
     * Publish Home Assistant Discovery configuration for a device
     */
    async publishDiscovery(device) {
        if (!this.client || !this.connected) return;
        if (!this.config.discovery?.enabled) {
            logger.debug('⏭️  Skipping discovery - discovery.enabled is false or undefined', {
                deviceId: device.id,
                discoveryEnabled: this.config.discovery?.enabled,
            });
            return;
        }

        try {
            // Skip if already published for this device (unless force)
            if (this.discoveryPublished.has(device.id)) {
                return;
            }

            const allCapabilities = capabilityRegistry.getAllCapabilities();
            const availableCapabilities = capabilityRegistry.getAvailableCapabilities(device);
            const discoveryPrefix = this.config.discovery.prefix || 'homeassistant';
            const topicPrefix = this.config.topicPrefix || 'posterrama';

            const availableIds = new Set(availableCapabilities.map(c => c.id));
            const skippedCount = allCapabilities.length - availableCapabilities.length;

            logger.info('🔍 Publishing Home Assistant discovery', {
                deviceId: device.id,
                mode: device.clientInfo?.mode || device.currentState?.mode,
                availableCapabilities: availableCapabilities.length,
                totalCapabilities: allCapabilities.length,
                skippedCapabilities: skippedCount,
            });

            // Publish only available capabilities
            for (const cap of availableCapabilities) {
                const discoveryConfig = this.buildDiscoveryConfig(device, cap, topicPrefix);
                const component = this.getHomeAssistantComponent(cap.entityType);
                const objectId = cap.id.replace(/\./g, '_');
                const discoveryTopic = `${discoveryPrefix}/${component}/posterrama_${device.id}/${objectId}/config`;

                await this.publish(discoveryTopic, JSON.stringify(discoveryConfig), {
                    qos: 1,
                    retain: true,
                });

                logger.debug('📡 Published discovery config', {
                    deviceId: device.id,
                    capability: cap.id,
                    category: cap.category,
                    topic: discoveryTopic,
                });
            }

            // Explicitly unpublish unavailable capabilities to ensure they're removed from HA
            for (const cap of allCapabilities) {
                if (!availableIds.has(cap.id)) {
                    const component = this.getHomeAssistantComponent(cap.entityType);
                    const objectId = cap.id.replace(/\./g, '_');
                    const discoveryTopic = `${discoveryPrefix}/${component}/posterrama_${device.id}/${objectId}/config`;

                    await this.publish(discoveryTopic, '', {
                        qos: 1,
                        retain: true,
                    });

                    logger.debug('� Unpublished unavailable capability', {
                        deviceId: device.id,
                        capability: cap.id,
                        reason: 'availableWhen check failed',
                    });
                }
            }

            this.discoveryPublished.add(device.id);
            logger.info('✅ Discovery publishing completed', {
                deviceId: device.id,
                published: availableCapabilities.length,
                unpublished: skippedCount,
            });
        } catch (error) {
            logger.error('Error publishing discovery:', error);
            this.stats.errors++;
        }
    }

    /**
     * Force republish discovery for a device (clears cache first)
     */
    async republishDiscovery(device) {
        this.discoveryPublished.delete(device.id);
        await this.publishDiscovery(device);
    }

    /**
     * Unpublish ALL capabilities for a device (used when mode changes)
     * This removes entities that are no longer available in the new mode
     */
    async unpublishAllCapabilities(device) {
        if (!this.client || !this.connected) return;
        if (!this.config.discovery?.enabled) return;

        try {
            const allCapabilities = capabilityRegistry.getAllCapabilities();
            const discoveryPrefix = this.config.discovery.prefix || 'homeassistant';

            logger.debug('🗑️  Unpublishing all capabilities for mode change', {
                deviceId: device.id,
                capabilityCount: allCapabilities.length,
            });

            // Send empty payload to each discovery topic to remove entities
            for (const cap of allCapabilities) {
                const component = this.getHomeAssistantComponent(cap.entityType);
                const objectId = cap.id.replace(/\./g, '_');
                const discoveryTopic = `${discoveryPrefix}/${component}/posterrama_${device.id}/${objectId}/config`;

                // Empty payload with retain flag removes the entity from Home Assistant
                await this.publish(discoveryTopic, '', {
                    qos: 1,
                    retain: true,
                });
            }

            logger.debug('✅ All capabilities unpublished', {
                deviceId: device.id,
            });
        } catch (error) {
            logger.error('Error unpublishing all capabilities:', error);
            this.stats.errors++;
        }
    }

    /**
     * Unpublish Home Assistant Discovery configuration for a deleted device
     * Sends empty payload with retain flag to remove all entities
     */
    async unpublishDiscovery(device) {
        if (!this.client || !this.connected) return;
        if (!this.config.discovery?.enabled) return;

        try {
            const capabilities = capabilityRegistry.getAvailableCapabilities(device);
            const discoveryPrefix = this.config.discovery.prefix || 'homeassistant';

            logger.info('🗑️  Removing Home Assistant discovery for deleted device', {
                deviceId: device.id,
                capabilities: capabilities.length,
            });

            // Send empty payload to each discovery topic to remove entities
            for (const cap of capabilities) {
                const component = this.getHomeAssistantComponent(cap.entityType);
                const objectId = cap.id.replace(/\./g, '_');
                const discoveryTopic = `${discoveryPrefix}/${component}/posterrama_${device.id}/${objectId}/config`;

                // Empty payload with retain flag removes the entity from Home Assistant
                await this.publish(discoveryTopic, '', {
                    qos: 1,
                    retain: true,
                });

                logger.debug('🗑️  Removed discovery config', {
                    deviceId: device.id,
                    capability: cap.id,
                    topic: discoveryTopic,
                });
            }

            // Remove from tracking
            this.discoveryPublished.delete(device.id);

            logger.info('✅ Device removed from Home Assistant', {
                deviceId: device.id,
                name: device.name,
            });
        } catch (error) {
            logger.error('Error unpublishing discovery:', error);
            this.stats.errors++;
        }
    }

    /**
     * Build Home Assistant Discovery configuration
     */
    buildDiscoveryConfig(device, capability, topicPrefix) {
        const packageJson = require('../package.json');

        const baseConfig = {
            // Use object_id to set the entity name without device prefix
            object_id: capability.id.replace(/\./g, '_'),
            name: capability.name, // Short name without device prefix
            unique_id: `posterrama_${device.id}_${capability.id}`,
            device: {
                identifiers: [`posterrama_${device.id}`],
                name: device.name || `Posterrama ${device.id}`,
                manufacturer: 'Posterrama',
                model: 'Media Display',
                sw_version: packageJson.version,
            },
        };

        // Add availability topic if enabled
        if (this.config.availability?.enabled) {
            baseConfig.availability = {
                topic: `${topicPrefix}/device/${device.id}/availability`,
            };
        }

        const objectId = capability.id.replace(/\./g, '_');
        const commandTopic = `${topicPrefix}/device/${device.id}/command/${objectId}`;
        const stateTopic = `${topicPrefix}/device/${device.id}/state`;

        // Entity-type specific configuration
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
                    unit_of_measurement: capability.unit || '',
                    icon: capability.icon,
                };

            case 'text':
                return {
                    ...baseConfig,
                    state_topic: stateTopic,
                    value_template: `{{ value_json['${capability.id}'] | default('') }}`,
                    command_topic: commandTopic,
                    mode: 'text',
                    pattern: capability.pattern || '.*',
                    icon: capability.icon,
                };

            case 'camera': {
                // Camera uses MQTT topic to publish base64-encoded images
                // Home Assistant expects 'image_topic' not 'topic' for camera entities
                return {
                    ...baseConfig,
                    image_topic: `${topicPrefix}/device/${device.id}/camera`,
                    image_encoding: 'b64', // Tell HA images are base64-encoded
                    icon: capability.icon,
                };
            }

            case 'sensor': {
                const sensorConfig = {
                    ...baseConfig,
                    state_topic: stateTopic,
                    value_template: `{{ value_json['${capability.id}'] | default('unknown') }}`,
                    icon: capability.icon,
                };

                // Add optional sensor fields
                if (capability.unitOfMeasurement) {
                    sensorConfig.unit_of_measurement = capability.unitOfMeasurement;
                }
                if (capability.deviceClass) {
                    sensorConfig.device_class = capability.deviceClass;
                }

                return sensorConfig;
            }

            default:
                return baseConfig;
        }
    }

    /**
     * Map entity type to Home Assistant component
     */
    getHomeAssistantComponent(entityType) {
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

    /**
     * Start periodic state publishing
     */
    startStatePublishing() {
        const interval = (this.config.publishInterval || 30) * 1000;

        this.publishTimer = setInterval(async () => {
            await this.publishAllDeviceStates();
        }, interval);

        logger.info(`⏰ State publishing started (interval: ${interval / 1000}s)`);
    }

    /**
     * Publish state for all devices
     */
    async publishAllDeviceStates() {
        if (!this.connected) return;

        try {
            const deviceStore = require('./deviceStore');
            const devices = await deviceStore.getAll();

            for (const device of devices) {
                await this.publishDeviceState(device);
                await this.publishDeviceAvailability(device);
                await this.publishCameraState(device);
                await this.publishDiscovery(device);
            }

            this.stats.lastPublish = new Date().toISOString();
        } catch (error) {
            logger.error('Error publishing all device states:', error);
            this.stats.errors++;
        }
    }

    /**
     * Publish to MQTT topic
     */
    async publish(topic, message, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.client || !this.connected) {
                reject(new Error('MQTT client not connected'));
                return;
            }

            this.client.publish(topic, message, options, err => {
                if (err) {
                    reject(err);
                } else {
                    this.stats.messagesPublished++;
                    resolve();
                }
            });
        });
    }

    /**
     * Handle device update event from deviceStore
     */
    async onDeviceUpdate(device) {
        await this.publishDeviceState(device);
        await this.publishDeviceAvailability(device);
        await this.publishCameraState(device);
        await this.publishDiscovery(device);
    }

    /**
     * Handle device deletion event from deviceStore
     */
    async onDeviceDelete(device) {
        // Remove all Home Assistant discovery configs for this device
        await this.unpublishDiscovery(device);

        // Clean up tracking
        this.deviceStates.delete(device.id);

        logger.info('🗑️  Device cleanup complete', {
            deviceId: device.id,
            name: device.name,
        });
    }

    /**
     * Get current statistics
     */
    getStats() {
        return {
            ...this.stats,
            connected: this.connected,
            devices_published: this.deviceStates.size,
            discoveries_published: this.discoveryPublished.size,
        };
    }

    /**
     * Shutdown MQTT bridge
     */
    async shutdown() {
        logger.info('🔌 Shutting down MQTT bridge...');

        if (this.publishTimer) {
            clearInterval(this.publishTimer);
            this.publishTimer = null;
        }

        if (this.client) {
            await new Promise(resolve => {
                this.client.end(false, {}, () => {
                    logger.info('✅ MQTT client disconnected');
                    resolve();
                });
            });
            this.client = null;
        }

        this.connected = false;
    }
}

module.exports = MqttBridge;
