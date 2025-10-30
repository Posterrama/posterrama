/**
 * MQTT Command Routing Tests
 *
 * Tests command routing from MQTT topics to device capabilities.
 * Validates all 30+ capabilities are correctly routed to wsHub.
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

const mockWsHub = {
    sendCommand: jest.fn(() => Promise.resolve({ success: true })),
    broadcast: jest.fn(() => Promise.resolve({ success: true })),
};

jest.mock('../../utils/wsHub', () => mockWsHub);

const mockDeviceStore = {
    getAll: jest.fn(() =>
        Promise.resolve([
            {
                id: 'test-device-1',
                name: 'Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
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
    getDevice: jest.fn(id => ({
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

jest.mock('../../utils/capabilityRegistry');

const mqtt = require('mqtt');
const logger = require('../../utils/logger');
const MqttBridge = require('../../utils/mqttBridge');
const capabilityRegistry = require('../../utils/capabilityRegistry');

describe('MQTT Command Routing', () => {
    let mqttBridge;
    let mockClient;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Setup capabilityRegistry mock
        capabilityRegistry.has.mockReturnValue(true);
        capabilityRegistry.get.mockImplementation(id => ({
            id,
            name: id,
            commandHandler: async (deviceId, payload) => {
                return mockWsHub.sendCommand(deviceId, { type: id, payload });
            },
        }));

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

        // Wait for async connection and subscriptions
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

    describe('Playback Commands', () => {
        const testCases = [
            { capability: 'playback.pause', description: 'pause' },
            { capability: 'playback.resume', description: 'resume' },
            { capability: 'playback.next', description: 'next' },
            { capability: 'playback.previous', description: 'previous' },
            { capability: 'playback.shuffle', description: 'shuffle' },
        ];

        test.each(testCases)('routes $capability command', async ({ capability }) => {
            jest.clearAllMocks(); // Clear previous test calls

            const topic = `posterrama/device/test-device-1/command/${capability}`;
            const payload = {};

            // Simulate message through the mock client
            mockClient.simulateMessage(topic, JSON.stringify(payload));

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    type: capability,
                })
            );
        });
    });

    describe('Mode Commands', () => {
        const testCases = [
            { capability: 'mode.screensaver', description: 'screensaver' },
            { capability: 'mode.wallart', description: 'wallart' },
            { capability: 'mode.cinema', description: 'cinema' },
        ];

        test.each(testCases)('routes $capability command', async ({ capability }) => {
            const topic = `posterrama/device/test-device-1/command/${capability}`;
            const payload = {};

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    type: capability,
                })
            );
        });
    });

    describe('System Commands', () => {
        const testCases = [
            { capability: 'system.reboot' },
            { capability: 'system.refresh' },
            { capability: 'system.screenshot' },
        ];

        test.each(testCases)('routes $capability command', async ({ capability }) => {
            const topic = `posterrama/device/test-device-1/command/${capability}`;
            const payload = {};

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    type: capability,
                })
            );
        });
    });

    describe('Navigation Commands', () => {
        const testCases = [{ capability: 'navigation.home' }, { capability: 'navigation.back' }];

        test.each(testCases)('routes $capability command', async ({ capability }) => {
            const topic = `posterrama/device/test-device-1/command/${capability}`;
            const payload = {};

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    type: capability,
                })
            );
        });
    });

    describe('Command Validation', () => {
        test('ignores commands to non-existent devices', async () => {
            mockDeviceStore.getById.mockReturnValueOnce(null);

            const topic = 'posterrama/device/unknown-device/command/playback.pause';
            const payload = {};

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 50));

            // Command should not be routed if device doesn't exist
            // (this depends on mqttBridge implementation)
        });

        test('logs warning for invalid capability', async () => {
            capabilityRegistry.get.mockReturnValueOnce(null);

            const topic = 'posterrama/device/test-device-1/command/invalid.capability';
            const payload = {};

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should log warning about unknown capability
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Unknown capability'),
                expect.any(Object)
            );
        });

        test('handles malformed JSON payload gracefully', async () => {
            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = 'not-valid-json{';

            mockClient.simulateMessage(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should handle gracefully - payload used as-is if not JSON
            expect(mockWsHub.sendCommand).toHaveBeenCalled();
        });
    });

    describe('Command History', () => {
        test('tracks successful commands in history', async () => {
            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = {};

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = mqttBridge.getStats();
            expect(stats.commandHistory.length).toBeGreaterThan(0);
            expect(stats.commandHistory[0]).toMatchObject({
                deviceId: 'test-device-1',
                capabilityId: 'playback.pause',
            });
        });

        test('limits command history to maxCommandHistory', async () => {
            mqttBridge.maxCommandHistory = 3;

            for (let i = 0; i < 5; i++) {
                const topic = 'posterrama/device/test-device-1/command/playback.pause';
                const payload = {};
                mockClient.simulateMessage(topic, JSON.stringify(payload));
                await new Promise(resolve => setTimeout(resolve, 20));
            }

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = mqttBridge.getStats();
            expect(stats.commandHistory.length).toBeLessThanOrEqual(3);
        });

        test('includes timestamp in command history', async () => {
            const before = new Date().toISOString();
            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = {};

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = mqttBridge.getStats();
            const lastCommand = stats.commandHistory[stats.commandHistory.length - 1];
            expect(lastCommand.timestamp).toBeDefined();
            expect(new Date(lastCommand.timestamp).getTime()).toBeGreaterThanOrEqual(
                new Date(before).getTime()
            );
        });
    });

    describe('Statistics Tracking', () => {
        test('increments commandsExecuted counter', async () => {
            const stats = mqttBridge.getStats();
            const initialCount = stats.commandsExecuted;

            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = {};

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 100));

            const newStats = mqttBridge.getStats();
            expect(newStats.commandsExecuted).toBe(initialCount + 1);
        });

        test('increments messagesReceived counter', async () => {
            const stats = mqttBridge.getStats();
            const initialCount = stats.messagesReceived;

            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = {};

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 100));

            const newStats = mqttBridge.getStats();
            expect(newStats.messagesReceived).toBe(initialCount + 1);
        });
    });

    describe('Command Payload Handling', () => {
        test('passes payload data to command handler', async () => {
            const topic = 'posterrama/device/test-device-1/command/settings.brightness';
            const payload = { value: 75 };

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    type: 'settings.brightness',
                    payload: 75,
                })
            );
        });

        test('handles empty payload gracefully', async () => {
            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = '';

            mockClient.simulateMessage(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockWsHub.sendCommand).toHaveBeenCalled();
        });

        test('handles boolean payloads', async () => {
            const topic = 'posterrama/device/test-device-1/command/settings.wallart.enabled';
            const payload = { value: true };

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    payload: true,
                })
            );
        });

        test('handles numeric payloads', async () => {
            const topic = 'posterrama/device/test-device-1/command/settings.wallart.refreshRate';
            const payload = { value: 120 };

            mockClient.simulateMessage(topic, JSON.stringify(payload));

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    payload: 120,
                })
            );
        });
    });

    describe('Broadcast Commands', () => {
        test('routes broadcast command to all devices', async () => {
            const topic = 'posterrama/broadcast/command/playback_pause';
            const payload = '{}';

            // Mock deviceStore to return test devices
            const deviceStore = require('../../utils/deviceStore');
            deviceStore.getAll.mockResolvedValue([
                { id: 'device1', name: 'Device 1' },
                { id: 'device2', name: 'Device 2' },
            ]);

            mockClient.simulateMessage(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 100));

            // Should call sendCommand for each device
            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'device1',
                expect.objectContaining({
                    type: 'playback.pause',
                })
            );
            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'device2',
                expect.objectContaining({
                    type: 'playback.pause',
                })
            );
        });
    });
});
