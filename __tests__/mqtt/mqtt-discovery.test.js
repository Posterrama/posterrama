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
    getAvailableCapabilities: jest.fn(() => []),
    getAllCapabilities: jest.fn(() => []),
}));

const mqtt = require('mqtt');
const MqttBridge = require('../../utils/mqttBridge');

describe('MQTT Home Assistant Discovery', () => {
    let mqttBridge;
    let mockClient;

    beforeEach(async () => {
        jest.clearAllMocks();

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

            const messages = mockClient.getPublishedMessages('homeassistant/');
            if (messages.length > 0) {
                const config = JSON.parse(messages[0].payload.toString());
                expect(config.device).toBeDefined();
                expect(config.device.identifiers).toContain('test-device-1');
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

            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'test-broker', port: 1883 },
                topicPrefix: 'posterrama',
                discovery: {
                    enabled: true,
                    prefix: 'custom-discovery',
                },
            });

            await mqttBridge.init();
            await new Promise(resolve => setImmediate(resolve));

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

            const messages = mockClient.getPublishedMessages('custom-discovery/');
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
                expect(config.state_topic).toBeDefined();
                expect(config.state_topic).toContain('posterrama/device/test-device-1');
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

            const messages = mockClient.getPublishedMessages('homeassistant/');
            if (messages.length > 0) {
                const config = JSON.parse(messages[0].payload.toString());
                expect(config.availability_topic).toBeDefined();
                expect(config.availability_topic).toContain(
                    'posterrama/device/test-device-1/availability'
                );
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
            const firstCount = mockClient.getPublishedMessages('homeassistant/').length;

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

            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'test-broker', port: 1883 },
                topicPrefix: 'posterrama',
                discovery: {
                    enabled: false,
                },
            });

            await mqttBridge.init();
            await new Promise(resolve => setImmediate(resolve));

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

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
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

            const cameraConfigs = mockClient.getPublishedMessages('homeassistant/camera/');
            expect(cameraConfigs.length).toBeGreaterThan(0);
        });
    });
});
