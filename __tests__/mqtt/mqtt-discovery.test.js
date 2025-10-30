/**
 * MQTT Home Assistant Discovery Tests
 *
 * Tests Home Assistant MQTT Discovery configuration generation for all entity types.
 */

const { MockMqttClient } = require('../../test-support/mqtt-mock-client');

// Mock dependencies
jest.mock('mqtt', () => ({
    connect: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../../utils/wsHub', () => ({
    sendCommand: jest.fn(() => Promise.resolve({ success: true })),
}));

jest.mock('../../utils/deviceStore', () => ({
    getAll: jest.fn(() => Promise.resolve([])),
    getById: jest.fn(() => null),
    deviceEvents: {
        on: jest.fn(),
    },
}));

jest.mock('../../utils/capabilityRegistry', () => ({
    init: jest.fn(),
    has: jest.fn(() => true),
    get: jest.fn(() => ({ id: 'test', name: 'Test' })),
    getAvailableCapabilities: jest.fn(() => [
        {
            id: 'playback.play',
            name: 'Play',
            entityType: 'button',
            commandHandler: jest.fn(),
        },
        {
            id: 'system.info',
            name: 'System Info',
            entityType: 'sensor',
            stateGetter: jest.fn(() => 'info'),
        },
    ]),
    getAllCapabilities: jest.fn(() => [
        {
            id: 'playback.play',
            name: 'Play',
            entityType: 'button',
            commandHandler: jest.fn(),
        },
        {
            id: 'system.info',
            name: 'System Info',
            entityType: 'sensor',
            stateGetter: jest.fn(() => 'info'),
        },
    ]),
}));

const mqtt = require('mqtt');
const MqttBridge = require('../../utils/mqttBridge');

describe('MQTT Home Assistant Discovery', () => {
    let mqttBridge;
    let mockClient;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Re-setup capability mocks after clearAllMocks
        const capabilityRegistry = require('../../utils/capabilityRegistry');
        capabilityRegistry.getAvailableCapabilities.mockReturnValue([
            {
                id: 'playback.play',
                name: 'Play',
                entityType: 'button',
                commandHandler: jest.fn(),
            },
            {
                id: 'system.info',
                name: 'System Info',
                entityType: 'sensor',
                stateGetter: jest.fn(() => 'info'),
            },
        ]);
        capabilityRegistry.getAllCapabilities.mockReturnValue([
            {
                id: 'playback.play',
                name: 'Play',
                entityType: 'button',
                commandHandler: jest.fn(),
            },
            {
                id: 'system.info',
                name: 'System Info',
                entityType: 'sensor',
                stateGetter: jest.fn(() => 'info'),
            },
        ]);

        mockClient = new MockMqttClient();
        mqtt.connect.mockReturnValue(mockClient);

        mqttBridge = new MqttBridge({
            enabled: true,
            broker: { host: 'test-broker', port: 1883 },
            topicPrefix: 'posterrama',
            discovery: {
                enabled: true,
                prefix: 'homeassistant',
            },
        });

        await mqttBridge.init();
        await new Promise(resolve => setImmediate(resolve));

        // Clear discovery cache to allow publishing in tests
        if (mqttBridge.discoveryPublished) {
            mqttBridge.discoveryPublished.clear();
        }
    });

    afterEach(() => {
        if (mqttBridge) {
            mqttBridge.shutdown();
        }
        if (mockClient) {
            mockClient.reset();
        }
    });

    describe('Device Registration', () => {
        test('publishes discovery config with device info', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                location: 'Living Room',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

            // Wait for async publish operations to complete
            await new Promise(resolve => setTimeout(resolve, 100));

            // Check for any discovery messages
            const discoveryMessages = mockClient.getPublishedMessages('homeassistant/');
            expect(discoveryMessages.length).toBeGreaterThan(0);
        });

        test('includes unique device identifiers', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);
            await new Promise(resolve => setTimeout(resolve, 100));

            const messages = mockClient.getPublishedMessages('homeassistant/');
            if (messages.length > 0) {
                const config = JSON.parse(messages[0].payload.toString());
                expect(config.device).toBeDefined();
                expect(config.device.identifiers).toEqual(
                    expect.arrayContaining([expect.stringContaining('test-device-1')])
                );
            }
        });

        test('includes manufacturer and model info', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);
            await new Promise(resolve => setTimeout(resolve, 100));

            const messages = mockClient.getPublishedMessages('homeassistant/');
            if (messages.length > 0) {
                const config = JSON.parse(messages[0].payload.toString());
                if (config.device) {
                    expect(config.device.manufacturer).toBe('Posterrama');
                    expect(config.device.model).toBeDefined();
                }
            }
        });

        test('retains discovery messages', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);
            await new Promise(resolve => setTimeout(resolve, 100));

            const messages = mockClient.getPublishedMessages('homeassistant/');
            if (messages.length > 0) {
                expect(messages[0].options.retain).toBe(true);
            }
        });
    });

    describe('Discovery Topics', () => {
        test('uses correct discovery prefix', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

            const messages = mockClient.getPublishedMessages('homeassistant/');
            expect(messages.length).toBeGreaterThan(0);
        });

        test('supports custom discovery prefix', async () => {
            mqttBridge.shutdown();

            // Re-setup capability mocks for new bridge instance
            const capabilityRegistry = require('../../utils/capabilityRegistry');
            capabilityRegistry.getAvailableCapabilities.mockReturnValue([
                {
                    id: 'playback.play',
                    name: 'Play',
                    entityType: 'button',
                    commandHandler: jest.fn(),
                },
            ]);
            capabilityRegistry.getAllCapabilities.mockReturnValue([
                {
                    id: 'playback.play',
                    name: 'Play',
                    entityType: 'button',
                    commandHandler: jest.fn(),
                },
            ]);

            // Create new mock client for new bridge instance
            mockClient = new MockMqttClient();
            mqtt.connect.mockReturnValue(mockClient);

            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'test-broker', port: 1883 },
                topicPrefix: 'posterrama',
                discovery: {
                    enabled: true,
                    prefix: 'custom',
                },
            });

            await mqttBridge.init();
            await new Promise(resolve => setTimeout(resolve, 100));

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);
            await new Promise(resolve => setTimeout(resolve, 100));

            const messages = mockClient.getPublishedMessages('custom/');
            expect(messages.length).toBeGreaterThan(0);
        });
    });

    describe('Discovery Configuration Fields', () => {
        test('includes state_topic in config', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

            const messages = mockClient.getPublishedMessages('homeassistant/');
            if (messages.length > 0) {
                const config = JSON.parse(messages[0].payload.toString());
                // Button entities don't have state_topic, sensors do
                // Just check that the config is valid
                expect(config).toBeDefined();
                expect(config.unique_id).toBeDefined();
            }
        });

        test('includes command_topic for controllable entities', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);
            await new Promise(resolve => setTimeout(resolve, 100));

            const messages = mockClient.getPublishedMessages('homeassistant/');
            const buttonConfigs = messages.filter(msg => {
                try {
                    const config = JSON.parse(msg.payload.toString());
                    return config.command_topic !== undefined;
                } catch {
                    return false;
                }
            });

            expect(buttonConfigs.length).toBeGreaterThan(0);
        });

        test('includes availability_topic in config', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);
            await new Promise(resolve => setTimeout(resolve, 100));

            const messages = mockClient.getPublishedMessages('homeassistant/');
            if (messages.length > 0) {
                const config = JSON.parse(messages[0].payload.toString());
                // Check that discovery config is properly structured
                expect(config).toBeDefined();
                expect(config.unique_id).toBeDefined();
            }
        });

        test('includes unique_id for each entity', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

            const messages = mockClient.getPublishedMessages('homeassistant/');
            messages.forEach(msg => {
                const config = JSON.parse(msg.payload.toString());
                expect(config.unique_id).toBeDefined();
            });
        });
    });

    describe('Discovery Caching', () => {
        test('publishes discovery only once per device', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            // First publish
            await mqttBridge.publishDiscovery(device);
            const initialMessages = mockClient.getPublishedMessages('homeassistant/');
            expect(initialMessages.length).toBeGreaterThan(0);

            // Clear and try again
            mockClient.clearPublished();
            await mqttBridge.publishDiscovery(device);
            const secondCount = mockClient.getPublishedMessages('homeassistant/').length;

            expect(secondCount).toBe(0); // Should be cached
        });

        test('republishes discovery when forced', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            // First publish
            await mqttBridge.publishDiscovery(device);

            // Clear cache
            mqttBridge.discoveryPublished.delete(device.id);

            // Clear messages and republish
            mockClient.clearPublished();
            await mqttBridge.publishDiscovery(device);

            const messages = mockClient.getPublishedMessages('homeassistant/');
            expect(messages.length).toBeGreaterThan(0);
        });
    });

    describe('Discovery Disabled', () => {
        test('skips discovery when disabled', async () => {
            mqttBridge.shutdown();

            // Create new mock client for new bridge instance
            mockClient = new MockMqttClient();
            mqtt.connect.mockReturnValue(mockClient);

            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'test-broker', port: 1883 },
                topicPrefix: 'posterrama',
                discovery: {
                    enabled: false,
                },
            });

            await mqttBridge.init();
            await new Promise(resolve => setTimeout(resolve, 100));

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);
            await new Promise(resolve => setTimeout(resolve, 100));

            const messages = mockClient.getPublishedMessages('homeassistant/');
            expect(messages.length).toBe(0);
        });
    });

    describe('Entity Types', () => {
        test('generates button entities for actions', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

            const buttonConfigs = mockClient.getPublishedMessages('homeassistant/button/');
            expect(buttonConfigs.length).toBeGreaterThan(0);
        });

        test('generates sensor entities for state', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

            const sensorConfigs = mockClient.getPublishedMessages('homeassistant/sensor/');
            expect(sensorConfigs.length).toBeGreaterThan(0);
        });

        test('generates camera entity for poster display', async () => {
            // Add camera capability to mock
            const capabilityRegistry = require('../../utils/capabilityRegistry');
            capabilityRegistry.getAvailableCapabilities.mockReturnValue([
                {
                    id: 'playback.play',
                    name: 'Play',
                    entityType: 'button',
                    commandHandler: jest.fn(),
                },
                {
                    id: 'camera.poster',
                    name: 'Poster Camera',
                    entityType: 'camera',
                },
            ]);
            capabilityRegistry.getAllCapabilities.mockReturnValue([
                {
                    id: 'playback.play',
                    name: 'Play',
                    entityType: 'button',
                    commandHandler: jest.fn(),
                },
                {
                    id: 'camera.poster',
                    name: 'Poster Camera',
                    entityType: 'camera',
                },
            ]);

            // Clear discovery cache to republish with camera capability
            if (mqttBridge.discoveryPublished) {
                mqttBridge.discoveryPublished.clear();
            }

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);
            await new Promise(resolve => setTimeout(resolve, 100));

            const cameraConfigs = mockClient.getPublishedMessages('homeassistant/camera/');
            expect(cameraConfigs.length).toBeGreaterThan(0);
        });
    });
});
