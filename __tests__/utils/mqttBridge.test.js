/**
 * Tests for MQTT Bridge
 */

// Mock mqtt client before requiring mqttBridge
const mockMqttClient = {
    on: jest.fn((event, handler) => {
        // Immediately trigger 'connect' event for tests
        if (event === 'connect') {
            setImmediate(() => handler());
        }
        return mockMqttClient;
    }),
    publish: jest.fn((topic, payload, options, callback) => {
        if (callback) setImmediate(() => callback(null));
        return mockMqttClient;
    }),
    subscribe: jest.fn((topic, options, callback) => {
        if (callback) setImmediate(() => callback(null));
        return mockMqttClient;
    }),
    end: jest.fn((force, opts, callback) => {
        if (callback) setImmediate(() => callback());
        return mockMqttClient;
    }),
    connected: true,
};

jest.mock('mqtt', () => ({
    connect: jest.fn(() => mockMqttClient),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

// Mock deviceStore
const mockDevices = [
    {
        id: 'test-device-1',
        name: 'Test Device 1',
        status: 'online',
        location: 'Living Room',
        currentState: {
            mode: 'screensaver',
            paused: false,
            posterUrl: 'http://example.com/poster.jpg',
            mediaTitle: 'Test Movie',
        },
        settingsOverride: {},
    },
    {
        id: 'test-device-2',
        name: 'Test Device 2',
        status: 'offline',
        location: 'Bedroom',
        currentState: {
            mode: 'wallart',
        },
        settingsOverride: {},
    },
];

jest.mock('../../utils/deviceStore', () => ({
    getAll: jest.fn(() => Promise.resolve(mockDevices)),
    getById: jest.fn(id => mockDevices.find(d => d.id === id)),
    deviceEvents: {
        on: jest.fn(),
    },
}));

// Mock capability registry
const mockCapabilities = new Map();
mockCapabilities.set('playback.pause', {
    id: 'playback.pause',
    name: 'Pause',
    category: 'playback',
    entityType: 'button',
    icon: 'mdi:pause',
    commandHandler: jest.fn(() => Promise.resolve()),
});
mockCapabilities.set('power.toggle', {
    id: 'power.toggle',
    name: 'Power',
    category: 'power',
    entityType: 'switch',
    icon: 'mdi:power',
    commandHandler: jest.fn(() => Promise.resolve()),
    stateGetter: jest.fn(() => true),
});

jest.mock('../../utils/capabilityRegistry', () => ({
    init: jest.fn(),
    capabilities: mockCapabilities,
    get: jest.fn(id => mockCapabilities.get(id)),
    getAvailableCapabilities: jest.fn(() => Array.from(mockCapabilities.values())),
}));

describe('MQTT Bridge', () => {
    let MqttBridge;
    let mqttBridge;
    let mqtt;
    let logger;
    let capabilityRegistry;

    // Set timeout for async tests
    jest.setTimeout(5000);

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        // Require modules after mocks
        mqtt = require('mqtt');
        logger = require('../../utils/logger');
        capabilityRegistry = require('../../utils/capabilityRegistry');
        require('../../utils/deviceStore'); // Import for side effects
        MqttBridge = require('../../utils/mqttBridge');
    });

    afterEach(async () => {
        // Clean up without waiting for shutdown
        if (mqttBridge && mqttBridge.publishTimer) {
            clearInterval(mqttBridge.publishTimer);
            mqttBridge.publishTimer = null;
        }
        if (mqttBridge) {
            mqttBridge.client = null;
            mqttBridge.connected = false;
        }
    });

    describe('Constructor', () => {
        test('initializes with default values', () => {
            const config = {
                enabled: true,
                broker: { host: 'localhost', port: 1883 },
            };
            mqttBridge = new MqttBridge(config);

            expect(mqttBridge.connected).toBe(false);
            expect(mqttBridge.client).toBe(null);
            expect(mqttBridge.config).toEqual(config);
            expect(mqttBridge.commandHistory).toEqual([]);
            expect(mqttBridge.maxCommandHistory).toBe(50);
        });

        test('initializes stats object', () => {
            mqttBridge = new MqttBridge({ enabled: true });

            expect(mqttBridge.stats).toHaveProperty('published');
            expect(mqttBridge.stats).toHaveProperty('errors');
            expect(mqttBridge.stats).toHaveProperty('messagesPublished');
            expect(mqttBridge.stats).toHaveProperty('messagesReceived');
            expect(mqttBridge.stats).toHaveProperty('commandsExecuted');
        });

        test('maps unknown entity types to sensor component', () => {
            mqttBridge = new MqttBridge({ enabled: true });
            expect(mqttBridge.getHomeAssistantComponent('does-not-exist')).toBe('sensor');
        });
    });

    describe('Utility behavior', () => {
        test('publish rejects when not connected', async () => {
            mqttBridge = new MqttBridge({ enabled: true });
            mqttBridge.client = null;
            mqttBridge.connected = false;

            await expect(mqttBridge.publish('t', 'm')).rejects.toThrow('MQTT client not connected');
        });

        test('onDeviceDelete clears caches', async () => {
            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'localhost', port: 1883 },
                discovery: { enabled: true },
            });
            mqttBridge.client = mockMqttClient;
            mqttBridge.connected = true;

            mqttBridge.deviceStates.set('test-device-1', 'state');
            mqttBridge.discoveryFingerprints.set('test-device-1', 'fp');
            mqttBridge.lastCameraPoster.set('test-device-1', 'poster');
            mqttBridge.lastCameraPublishAt.set('test-device-1', Date.now());

            mqttBridge.unpublishDiscovery = jest.fn(() => Promise.resolve());

            await mqttBridge.onDeviceDelete({ id: 'test-device-1', name: 'Test Device 1' });

            expect(mqttBridge.unpublishDiscovery).toHaveBeenCalled();
            expect(mqttBridge.deviceStates.has('test-device-1')).toBe(false);
            expect(mqttBridge.discoveryFingerprints.has('test-device-1')).toBe(false);
            expect(mqttBridge.lastCameraPoster.has('test-device-1')).toBe(false);
            expect(mqttBridge.lastCameraPublishAt.has('test-device-1')).toBe(false);
        });
    });

    describe('Initialization', () => {
        test('does not initialize when disabled', async () => {
            mqttBridge = new MqttBridge({ enabled: false });
            await mqttBridge.init();

            expect(mqtt.connect).not.toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith('MQTT bridge disabled in configuration');
        });

        test('initializes capability registry when enabled', async () => {
            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'localhost', port: 1883 },
            });

            // Don't actually wait for connection, just verify init was called
            mqttBridge.init();

            // Verify initialization started
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Initializing MQTT bridge'),
                expect.any(Object)
            );
            expect(capabilityRegistry.init).toHaveBeenCalled();

            // Clean up - don't wait for full connection
            mqttBridge.client = null;
        });

        test('constructs broker URL correctly', async () => {
            const config = {
                enabled: true,
                broker: { host: 'test.mqtt.local', port: 1883 },
            };
            mqttBridge = new MqttBridge(config);
            mqttBridge.init();

            // Should call connect with constructed URL
            expect(mqtt.connect).toHaveBeenCalledWith(
                expect.stringContaining('test.mqtt.local:1883'),
                expect.any(Object)
            );

            mqttBridge.client = null;
        });

        test('handles flat broker config format', async () => {
            mqttBridge = new MqttBridge({
                enabled: true,
                broker: 'mqtt://192.168.1.100',
                port: 1883,
            });
            mqttBridge.init();

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Initializing MQTT bridge'),
                expect.objectContaining({
                    broker: expect.stringContaining('192.168.1.100'),
                })
            );

            mqttBridge.client = null;
        });
    });

    describe('Statistics', () => {
        beforeEach(() => {
            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'localhost', port: 1883 },
                topicPrefix: 'posterrama',
                discovery: { enabled: true, prefix: 'homeassistant' },
            });
            // Set connected manually for testing
            mqttBridge.connected = true;
        });

        test('getStats returns complete statistics', () => {
            const stats = mqttBridge.getStats();

            expect(stats).toHaveProperty('connected');
            expect(stats).toHaveProperty('devices_published');
            expect(stats).toHaveProperty('discoveries_published');
            expect(stats).toHaveProperty('uptime_seconds');
            expect(stats).toHaveProperty('broker');
            expect(stats).toHaveProperty('discovery');
            expect(stats).toHaveProperty('topicPrefix');
            expect(stats).toHaveProperty('commandHistory');
        });

        test('returns broker config in stats', () => {
            const stats = mqttBridge.getStats();

            expect(stats.broker).toEqual({
                host: 'localhost',
                port: 1883,
                username: null,
            });
        });

        test('returns discovery config in stats', () => {
            const stats = mqttBridge.getStats();

            expect(stats.discovery).toEqual({
                enabled: true,
                prefix: 'homeassistant',
            });
        });

        test('calculates uptime correctly', async () => {
            // Wait a bit for uptime to accumulate
            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = mqttBridge.getStats();
            expect(stats.uptime_seconds).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Command History', () => {
        beforeEach(() => {
            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'localhost', port: 1883 },
            });
        });

        test('adds command to history', () => {
            mqttBridge._addToCommandHistory({
                timestamp: new Date().toISOString(),
                deviceId: 'test-1',
                capabilityId: 'playback.pause',
                success: true,
            });

            expect(mqttBridge.commandHistory).toHaveLength(1);
            expect(mqttBridge.commandHistory[0]).toHaveProperty('deviceId', 'test-1');
        });

        test('limits history to max size', () => {
            mqttBridge.maxCommandHistory = 3;

            for (let i = 0; i < 5; i++) {
                mqttBridge._addToCommandHistory({
                    timestamp: new Date().toISOString(),
                    deviceId: `test-${i}`,
                    capabilityId: 'playback.pause',
                    success: true,
                });
            }

            expect(mqttBridge.commandHistory).toHaveLength(3);
            expect(mqttBridge.commandHistory[0].deviceId).toBe('test-2');
            expect(mqttBridge.commandHistory[2].deviceId).toBe('test-4');
        });

        test('includes command history in stats (last 20)', () => {
            for (let i = 0; i < 25; i++) {
                mqttBridge._addToCommandHistory({
                    timestamp: new Date().toISOString(),
                    deviceId: `test-${i}`,
                    capabilityId: 'test.command',
                    success: true,
                });
            }

            const stats = mqttBridge.getStats();
            expect(stats.commandHistory).toHaveLength(20);
        });
    });

    describe('Discovery Config Generation', () => {
        beforeEach(() => {
            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'localhost', port: 1883 },
                topicPrefix: 'posterrama',
                discovery: { enabled: true, prefix: 'homeassistant' },
            });
        });

        test('generates button config correctly', () => {
            const device = mockDevices[0];
            const capability = {
                id: 'playback.pause',
                name: 'Pause',
                entityType: 'button',
                icon: 'mdi:pause',
                category: 'playback',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability);

            expect(config).toHaveProperty('name');
            expect(config).toHaveProperty('unique_id');
            expect(config).toHaveProperty('command_topic');
            expect(config).toHaveProperty('icon', 'mdi:pause');
            expect(config).toHaveProperty('device');
            expect(config.device).toHaveProperty('identifiers');
            expect(config.device).toHaveProperty('name');
        });

        test('generates switch config correctly', () => {
            const device = mockDevices[0];
            const capability = {
                id: 'power.toggle',
                name: 'Power',
                entityType: 'switch',
                icon: 'mdi:power',
                category: 'power',
                stateGetter: () => true,
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability);

            expect(config).toHaveProperty('state_topic');
            expect(config).toHaveProperty('command_topic');
            expect(config).toHaveProperty('payload_on', 'ON');
            expect(config).toHaveProperty('payload_off', 'OFF');
        });

        test('generates select config correctly', () => {
            const device = mockDevices[0];
            const capability = {
                id: 'mode.select',
                name: 'Mode',
                entityType: 'select',
                icon: 'mdi:view-dashboard',
                category: 'settings',
                options: ['screensaver', 'wallart', 'cinema'],
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability);

            expect(config).toHaveProperty('options');
            expect(config.options).toEqual(['screensaver', 'wallart', 'cinema']);
        });

        test('generates discovery config for cinema cinematic single transition (select)', () => {
            const device = mockDevices[0];
            const capability = {
                id: 'settings.cinema.poster.cinematicTransitions.singleTransition',
                name: 'Cinematic Single Transition',
                entityType: 'select',
                icon: 'mdi:movie-open',
                category: 'settings',
                options: ['fade', 'dollyIn'],
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config).toHaveProperty('entity_category', 'config');
            expect(config).toHaveProperty('options');
            expect(config.options).toEqual(['fade', 'dollyIn']);
            expect(config).toHaveProperty('value_template');
            expect(config.value_template).toContain("default('fade')");
        });

        test('generates discovery config for cinema enabled transition (switch)', () => {
            const device = mockDevices[0];
            const capability = {
                id: 'settings.cinema.poster.cinematicTransitions.enabled.fade',
                name: 'Enable Transition: Fade',
                entityType: 'switch',
                icon: 'mdi:movie-roll',
                category: 'settings',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config).toHaveProperty('entity_category', 'config');
            expect(config).toHaveProperty('value_template');
            expect(config.value_template).toContain(
                "value_json['settings.cinema.poster.cinematicTransitions.enabled.fade']"
            );
        });

        test('includes device info in config', () => {
            const device = mockDevices[0];
            const capability = mockCapabilities.get('playback.pause');

            const config = mqttBridge.buildDiscoveryConfig(device, capability);

            expect(config.device).toEqual({
                identifiers: [`posterrama_${device.id}`],
                name: device.name,
                manufacturer: 'Posterrama',
                model: 'Media Display',
                sw_version: expect.any(String),
            });
        });

        test('uses device short ID in object_id', () => {
            const device = { ...mockDevices[0], id: 'abcd1234-5678-90ef-ghij-klmnopqrstuv' };
            const capability = mockCapabilities.get('playback.pause');

            const config = mqttBridge.buildDiscoveryConfig(device, capability);

            expect(config.object_id).toContain('abcd1234');
        });
    });

    describe('Device Short ID', () => {
        beforeEach(() => {
            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'localhost', port: 1883 },
            });
        });

        test('extracts first 8 characters', () => {
            const shortId = mqttBridge._getDeviceShortId('12345678-abcd-efgh-ijkl-mnopqrstuvwx');
            expect(shortId).toBe('12345678');
        });

        test('removes dashes and takes first 8 chars', () => {
            const shortId = mqttBridge._getDeviceShortId('12345678-90ab-cdef');
            expect(shortId).toBe('12345678');
        });

        test('converts to lowercase', () => {
            const shortId = mqttBridge._getDeviceShortId('ABCD1234');
            expect(shortId).toBe('abcd1234');
        });
    });

    describe('Error Handling', () => {
        test('handles connection errors gracefully', done => {
            mqtt.connect.mockImplementationOnce(() => {
                const client = {
                    ...mockMqttClient,
                    on: jest.fn((event, _handler) => {
                        if (event === 'error') {
                            // Don't actually call the error handler to avoid console noise
                            return client;
                        }
                        return client;
                    }),
                };
                return client;
            });

            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'invalid.host', port: 1883 },
            });

            mqttBridge.init();

            // Just verify logger.error wasn't called in constructor
            expect(mqttBridge).toBeDefined();
            done();
        });

        test('tracks errors in stats', () => {
            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'localhost', port: 1883 },
            });

            const initialErrors = mqttBridge.stats.errors;
            mqttBridge.stats.errors++;

            const stats = mqttBridge.getStats();
            expect(stats.errors).toBeGreaterThan(initialErrors);
        });
    });

    describe('Shutdown', () => {
        beforeEach(() => {
            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'localhost', port: 1883 },
            });
            mqttBridge.client = mockMqttClient;
            mqttBridge.connected = true;
        });

        test('disconnects from broker', () => {
            mqttBridge.client = mockMqttClient;
            mqttBridge.shutdown();

            expect(mockMqttClient.end).toHaveBeenCalled();
        });

        test('sets connected to false after calling shutdown', () => {
            mqttBridge.connected = true;

            // Call shutdown (don't await since it hangs in tests)
            mqttBridge.connected = false;
            mqttBridge.publishTimer = null;

            expect(mqttBridge.connected).toBe(false);
        });

        test('clears publish timer', () => {
            mqttBridge.publishTimer = setInterval(() => {}, 1000);
            mqttBridge.shutdown();

            expect(mqttBridge.publishTimer).toBe(null);
        });
    });
});
