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

        this.config = config || {};
        this.client = null;
        this.connected = false;
        this.publishTimer = null;
        this.deviceStates = new Map(); // Track last published state to avoid duplicates
        this.discoveryPublished = new Set(); // Track which devices have discovery published

        // Stats
        this.stats = {
            messagesPublished: 0,
            messagesReceived: 0,
            commandsExecuted: 0,
            errors: 0,
            lastPublish: null,
            connectedAt: null,
        };
    }

    /**
     * Initialize MQTT connection and setup
     */
    async init() {
        if (!this.config.enabled) {
            logger.info('MQTT bridge disabled in configuration');
            return;
        }

        try {
            logger.info('🔌 Initializing MQTT bridge...', {
                broker: `${this.config.broker.host}:${this.config.broker.port}`,
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
            const brokerUrl = `mqtt://${this.config.broker.host}:${this.config.broker.port}`;

            const options = {
                clientId: `posterrama_${Date.now()}`,
                clean: true,
                reconnectPeriod: 5000,
                connectTimeout: 30000,
            };

            // Add authentication if configured
            if (this.config.broker.username) {
                options.username = this.config.broker.username;
            }

            if (this.config.broker.passwordEnvVar) {
                const password = process.env[this.config.broker.passwordEnvVar];
                if (password) {
                    options.password = password;
                }
            }

            // TLS support
            if (this.config.broker.tls) {
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

            // Build state payload
            const state = {
                device_id: device.id,
                name: device.name || device.id,
                location: device.location || '',
                status: device.status || 'unknown',
                mode: device.currentState?.mode || 'screensaver',
                paused: device.currentState?.paused || false,
                pinned: device.currentState?.pinned || false,
                powered_off: device.currentState?.poweredOff || false,
                media_id: device.currentState?.mediaId || null,
                pin_media_id: device.currentState?.pinMediaId || null,
                last_seen: device.lastSeenAt || null,
                preset: device.preset || '',
            };

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
     * Publish Home Assistant Discovery configuration for a device
     */
    async publishDiscovery(device) {
        if (!this.client || !this.connected) return;
        if (!this.config.discovery?.enabled) return;

        try {
            // Skip if already published for this device
            if (this.discoveryPublished.has(device.id)) {
                return;
            }

            const capabilities = capabilityRegistry.getAvailableCapabilities(device);
            const discoveryPrefix = this.config.discovery.prefix || 'homeassistant';
            const topicPrefix = this.config.topicPrefix || 'posterrama';

            logger.info('🔍 Publishing Home Assistant discovery', {
                deviceId: device.id,
                capabilities: capabilities.length,
            });

            for (const cap of capabilities) {
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
                    topic: discoveryTopic,
                });
            }

            this.discoveryPublished.add(device.id);
        } catch (error) {
            logger.error('Error publishing discovery:', error);
            this.stats.errors++;
        }
    }

    /**
     * Build Home Assistant Discovery configuration
     */
    buildDiscoveryConfig(device, capability, topicPrefix) {
        const packageJson = require('../package.json');

        const baseConfig = {
            name: `${device.name || device.id} ${capability.name}`,
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

            case 'sensor':
                return {
                    ...baseConfig,
                    state_topic: stateTopic,
                    value_template: `{{ value_json['${capability.id}'] | default('unknown') }}`,
                    icon: capability.icon,
                };

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
        await this.publishDiscovery(device);
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
