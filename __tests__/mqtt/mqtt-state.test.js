/**
 * MQTT State Publishing Tests
 *
 * Tests state publishing to MQTT topics for devices, cameras, and availability.
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
    broadcast: jest.fn(() => Promise.resolve({ success: true })),
}));

const mockDeviceStore = {
    getAll: jest.fn(() =>
        Promise.resolve([
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
        ])
    ),
    getById: jest.fn(id => ({
        id,
        name: 'Test Device',
        status: 'online',
        currentState: { mode: 'screensaver' },
        settingsOverride: {},
    })),
    deviceEvents: {
        on: jest.fn(),
    },
};

jest.mock('../../utils/deviceStore', () => mockDeviceStore);

jest.mock('../../utils/capabilityRegistry', () => ({
    init: jest.fn(),
    has: jest.fn(() => true),
    get: jest.fn(id => ({ id, name: id })),
    getAvailableCapabilities: jest.fn(() => []),
    getAllCapabilities: jest.fn(() => []),
}));

const mqtt = require('mqtt');
const logger = require('../../utils/logger');
const MqttBridge = require('../../utils/mqttBridge');

describe('MQTT State Publishing', () => {
    let mqttBridge;
    let mockClient;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Setup capabilityRegistry mock to return empty arrays
        const capabilityRegistry = require('../../utils/capabilityRegistry');
        capabilityRegistry.getAvailableCapabilities.mockReturnValue([]);
        capabilityRegistry.getAllCapabilities.mockReturnValue([]);

        // Create mock client
        mockClient = new MockMqttClient();
        mqtt.connect.mockReturnValue(mockClient);

        // Create bridge instance
        mqttBridge = new MqttBridge({
            enabled: true,
            broker: { host: 'test-broker', port: 1883 },
            topicPrefix: 'posterrama',
            discovery: { enabled: false },
        });

        await mqttBridge.init();

        // Ensure client and bridge are marked as connected
        mockClient.connected = true;
        mqttBridge.connected = true;

        // Clear any cached state to avoid "no change" skips
        if (mqttBridge.deviceStates) {
            mqttBridge.deviceStates.clear();
        }
        if (mqttBridge.deviceModes) {
            mqttBridge.deviceModes.clear();
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(() => {
        if (mqttBridge) {
            mqttBridge.shutdown();
        }
        if (mockClient) {
            mockClient.reset();
        }
    });

    describe('Device State Publishing', () => {
        test('publishes device state to correct topic', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                location: 'Living Room',
                currentState: {
                    mode: 'screensaver',
                    paused: false,
                },
            };

            await mqttBridge.publishDeviceState(device);
            await new Promise(resolve => setTimeout(resolve, 50));

            const messages = mockClient.getPublishedMessages(
                'posterrama/device/test-device-1/state'
            );
            expect(messages.length).toBeGreaterThan(0);

            const payload = JSON.parse(messages[0].payload.toString());
            expect(payload).toMatchObject({
                device_id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                mode: 'screensaver',
                paused: false,
            });
        });

        test('includes location in state', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                location: 'Living Room',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDeviceState(device);
            await new Promise(resolve => setTimeout(resolve, 50));

            const payload = mockClient.getLastPublishedPayload(
                'posterrama/device/test-device-1/state'
            );
            expect(payload.location).toBe('Living Room');
        });

        test('includes mode in state', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'wallart' },
            };

            await mqttBridge.publishDeviceState(device);
            await new Promise(resolve => setTimeout(resolve, 50));

            const payload = mockClient.getLastPublishedPayload(
                'posterrama/device/test-device-1/state'
            );
            expect(payload.mode).toBe('wallart');
        });

        test('includes paused state', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: {
                    mode: 'screensaver',
                    paused: true,
                },
            };

            await mqttBridge.publishDeviceState(device);
            await new Promise(resolve => setTimeout(resolve, 50));

            const payload = mockClient.getLastPublishedPayload(
                'posterrama/device/test-device-1/state'
            );
            expect(payload.paused).toBe(true);
        });

        test('uses QoS 1 for state messages', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDeviceState(device);
            await new Promise(resolve => setTimeout(resolve, 50));

            const message = mockClient.getLastPublishedMessage(
                'posterrama/device/test-device-1/state'
            );
            expect(message.options.qos).toBe(1);
        });

        test('does not retain state messages', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDeviceState(device);
            await new Promise(resolve => setTimeout(resolve, 50));

            const message = mockClient.getLastPublishedMessage(
                'posterrama/device/test-device-1/state'
            );
            expect(message.options.retain).toBe(false);
        });

        test('skips publishing if not connected', async () => {
            mqttBridge.connected = false;

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDeviceState(device);
            await new Promise(resolve => setTimeout(resolve, 50));

            const messages = mockClient.getPublishedMessages(
                'posterrama/device/test-device-1/state'
            );
            expect(messages.length).toBe(0);
        });

        test('handles mode changes and republishes discovery', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            // First publish
            await mqttBridge.publishDeviceState(device);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Change mode
            device.currentState.mode = 'wallart';

            // Clear published messages
            mockClient.clearPublished();

            // Second publish with different mode
            await mqttBridge.publishDeviceState(device);

            // Should have published state
            const messages = mockClient.getPublishedMessages(
                'posterrama/device/test-device-1/state'
            );
            expect(messages.length).toBeGreaterThan(0);
        });
    });

    describe('Camera State Publishing', () => {
        test('publishes camera state with poster URL', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                currentState: {
                    posterUrl: 'http://example.com/poster.jpg',
                    mediaTitle: 'Test Movie',
                },
            };

            await mqttBridge.publishCameraState(device);

            const messages = mockClient.getPublishedMessages(
                'posterrama/device/test-device-1/camera'
            );
            expect(messages.length).toBeGreaterThan(0);

            const payload = JSON.parse(messages[0].payload.toString());
            expect(payload.image_url).toBe('http://example.com/poster.jpg');
        });

        test('includes media title in camera state', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                currentState: {
                    posterUrl: 'http://example.com/poster.jpg',
                    mediaTitle: 'Inception',
                },
            };

            await mqttBridge.publishCameraState(device);

            const payload = mockClient.getLastPublishedPayload(
                'posterrama/device/test-device-1/camera'
            );
            expect(payload.media_title).toBe('Inception');
        });

        test('skips camera publish if no poster URL', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                currentState: {},
            };

            await mqttBridge.publishCameraState(device);

            const messages = mockClient.getPublishedMessages(
                'posterrama/device/test-device-1/camera'
            );
            expect(messages.length).toBe(0);
        });
    });

    describe('Availability Publishing', () => {
        test('publishes online status for active devices', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
            };

            await mqttBridge.publishDeviceAvailability(device);

            const payload = mockClient.getLastPublishedPayload(
                'posterrama/device/test-device-1/availability'
            );
            expect(payload).toBe('online');
        });

        test('publishes offline status for inactive devices', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'offline',
            };

            await mqttBridge.publishDeviceAvailability(device);

            const payload = mockClient.getLastPublishedPayload(
                'posterrama/device/test-device-1/availability'
            );
            expect(payload).toBe('offline');
        });

        test('retains availability messages', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
            };

            await mqttBridge.publishDeviceAvailability(device);

            const message = mockClient.getLastPublishedMessage(
                'posterrama/device/test-device-1/availability'
            );
            expect(message.options.retain).toBe(true);
        });
    });

    describe('State Publishing Optimization', () => {
        test('skips publishing if state unchanged', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver', paused: false },
            };

            // First publish
            await mqttBridge.publishDeviceState(device);
            const initialMessages = mockClient.getPublishedMessages(
                'posterrama/device/test-device-1/state'
            );
            expect(initialMessages.length).toBeGreaterThan(0);

            // Clear and publish again with same state
            mockClient.clearPublished();
            await mqttBridge.publishDeviceState(device);

            const secondCount = mockClient.getPublishedMessages(
                'posterrama/device/test-device-1/state'
            ).length;
            expect(secondCount).toBe(0); // Should skip duplicate
        });

        test('publishes when state changes', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver', paused: false },
            };

            // First publish
            await mqttBridge.publishDeviceState(device);

            // Change state
            device.currentState.paused = true;

            // Clear and publish again
            mockClient.clearPublished();
            await mqttBridge.publishDeviceState(device);

            const messages = mockClient.getPublishedMessages(
                'posterrama/device/test-device-1/state'
            );
            expect(messages.length).toBeGreaterThan(0);
        });
    });

    describe('Statistics Tracking', () => {
        test('increments messagesPublished counter', async () => {
            const initialCount = mqttBridge.stats.messagesPublished;

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDeviceState(device);

            expect(mqttBridge.stats.messagesPublished).toBeGreaterThan(initialCount);
        });

        test('updates lastPublish timestamp', async () => {
            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            const before = Date.now();
            await mqttBridge.publishDeviceState(device);
            const after = Date.now();

            expect(mqttBridge.stats.lastPublish).toBeDefined();
            const lastPublish = new Date(mqttBridge.stats.lastPublish).getTime();
            expect(lastPublish).toBeGreaterThanOrEqual(before);
            expect(lastPublish).toBeLessThanOrEqual(after);
        });
    });

    describe('Topic Prefix Handling', () => {
        test('uses custom topic prefix for state', async () => {
            mqttBridge.shutdown();

            mqttBridge = new MqttBridge({
                enabled: true,
                broker: { host: 'test-broker', port: 1883 },
                topicPrefix: 'custom-prefix',
                discovery: { enabled: false },
            });

            await mqttBridge.init();
            await new Promise(resolve => setImmediate(resolve));

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDeviceState(device);

            const messages = mockClient.getPublishedMessages(
                'custom-prefix/device/test-device-1/state'
            );
            expect(messages.length).toBeGreaterThan(0);
        });
    });

    describe('Error Handling', () => {
        test('handles publish errors gracefully', async () => {
            // Make publish fail
            mockClient.publish = jest.fn((topic, payload, options, callback) => {
                if (callback) callback(new Error('Publish failed'));
            });

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            // Should not throw
            await expect(mqttBridge.publishDeviceState(device)).resolves.not.toThrow();
        });

        test('increments error counter on publish failure', async () => {
            const initialErrors = mqttBridge.stats.errors;

            // Make publish fail
            mockClient.publish = jest.fn((topic, payload, options, callback) => {
                if (callback) callback(new Error('Publish failed'));
            });

            const device = {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDeviceState(device);

            expect(mqttBridge.stats.errors).toBeGreaterThan(initialErrors);
        });
    });
});
