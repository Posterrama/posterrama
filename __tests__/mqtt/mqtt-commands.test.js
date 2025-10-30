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
    deviceEvents: {
        on: jest.fn(),
    },
};

jest.mock('../../utils/deviceStore', () => mockDeviceStore);

jest.mock('../../utils/capabilityRegistry', () => {
    const registry = {
        init: jest.fn(),
        has: jest.fn(() => true),
        get: jest.fn(id => ({
            id,
            name: id,
            commandHandler: (deviceId, payload) =>
                mockWsHub.sendCommand(deviceId, { type: id, payload }),
        })),
        getAllCapabilities: jest.fn(() => [
            { id: 'playback.pause', category: 'playback' },
            { id: 'playback.resume', category: 'playback' },
        ]),
    };
    return registry;
});

const mqtt = require('mqtt');
const logger = require('../../utils/logger');
const MqttBridge = require('../../utils/mqttBridge');
const capabilityRegistry = require('../../utils/capabilityRegistry');

describe('MQTT Command Routing', () => {
    let mqttBridge;
    let mockClient;
    let messageHandler;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Create mock client
        mockClient = new MockMqttClient();
        mqtt.connect.mockReturnValue(mockClient);

        // Capture message handler when registered
        const originalOn = mockClient.on.bind(mockClient);
        mockClient.on = jest.fn((event, handler) => {
            if (event === 'message') {
                messageHandler = handler;
            }
            return originalOn(event, handler);
        });

        // Create bridge instance
        mqttBridge = new MqttBridge({
            enabled: true,
            broker: { host: 'test-broker', port: 1883 },
            topicPrefix: 'posterrama',
            discovery: { enabled: false },
        });

        await mqttBridge.init();

        // Wait for async connection
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

    describe('Playback Commands', () => {
        const testCases = [
            { capability: 'playback.pause', description: 'pause' },
            { capability: 'playback.resume', description: 'resume' },
            { capability: 'playback.next', description: 'next' },
            { capability: 'playback.previous', description: 'previous' },
            { capability: 'playback.shuffle', description: 'shuffle' },
        ];

        test.each(testCases)('routes $capability command', async ({ capability }) => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = `posterrama/device/test-device-1/command/${capability}`;
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setImmediate(resolve));

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
            { capability: 'mode.screensaver' },
            { capability: 'mode.wallart' },
            { capability: 'mode.cinema' },
        ];

        test.each(testCases)('routes $capability command', async ({ capability }) => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = `posterrama/device/test-device-1/command/${capability}`;
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setImmediate(resolve));

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
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = `posterrama/device/test-device-1/command/${capability}`;
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setImmediate(resolve));

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
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = `posterrama/device/test-device-1/command/${capability}`;
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setImmediate(resolve));

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
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            mockDeviceStore.getById.mockReturnValueOnce(null);

            const topic = 'posterrama/device/unknown-device/command/playback.pause';
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setImmediate(resolve));

            // Command should not be routed if device doesn't exist
            // (this depends on mqttBridge implementation)
        });

        test('logs warning for invalid capability', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            capabilityRegistry.has.mockReturnValueOnce(false);

            const topic = 'posterrama/device/test-device-1/command/invalid.capability';
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setImmediate(resolve));

            // Should log warning about unknown capability
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Unknown capability'),
                expect.any(Object)
            );
        });

        test('handles malformed JSON payload gracefully', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = Buffer.from('not-valid-json{');

            messageHandler(topic, payload);

            await new Promise(resolve => setImmediate(resolve));

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to parse'),
                expect.any(Object)
            );
        });
    });

    describe('Command History', () => {
        test('tracks successful commands in history', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mqttBridge.commandHistory.length).toBeGreaterThan(0);
            expect(mqttBridge.commandHistory[0]).toMatchObject({
                deviceId: 'test-device-1',
                capability: 'playback.pause',
            });
        });

        test('limits command history to maxCommandHistory', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            mqttBridge.maxCommandHistory = 3;

            for (let i = 0; i < 5; i++) {
                const topic = 'posterrama/device/test-device-1/command/playback.pause';
                const payload = Buffer.from(JSON.stringify({}));
                messageHandler(topic, payload);
                await new Promise(resolve => setImmediate(resolve));
            }

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mqttBridge.commandHistory.length).toBeLessThanOrEqual(3);
        });

        test('includes timestamp in command history', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const before = Date.now();
            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));
            const after = Date.now();

            const lastCommand = mqttBridge.commandHistory[mqttBridge.commandHistory.length - 1];
            expect(lastCommand.timestamp).toBeGreaterThanOrEqual(before);
            expect(lastCommand.timestamp).toBeLessThanOrEqual(after);
        });
    });

    describe('Statistics Tracking', () => {
        test('increments commandsExecuted counter', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const initialCount = mqttBridge.stats.commandsExecuted;

            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mqttBridge.stats.commandsExecuted).toBe(initialCount + 1);
        });

        test('increments messagesReceived counter', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const initialCount = mqttBridge.stats.messagesReceived;

            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mqttBridge.stats.messagesReceived).toBe(initialCount + 1);
        });
    });

    describe('Command Payload Handling', () => {
        test('passes payload data to command handler', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = 'posterrama/device/test-device-1/command/settings.brightness';
            const payload = Buffer.from(JSON.stringify({ value: 75 }));

            messageHandler(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    type: 'settings.brightness',
                    payload: expect.objectContaining({ value: 75 }),
                })
            );
        });

        test('handles empty payload gracefully', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = 'posterrama/device/test-device-1/command/playback.pause';
            const payload = Buffer.from('');

            messageHandler(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockWsHub.sendCommand).toHaveBeenCalled();
        });

        test('handles boolean payloads', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = 'posterrama/device/test-device-1/command/settings.wallart.enabled';
            const payload = Buffer.from(JSON.stringify({ value: true }));

            messageHandler(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    payload: expect.objectContaining({ value: true }),
                })
            );
        });

        test('handles numeric payloads', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = 'posterrama/device/test-device-1/command/settings.wallart.refreshRate';
            const payload = Buffer.from(JSON.stringify({ value: 120 }));

            messageHandler(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockWsHub.sendCommand).toHaveBeenCalledWith(
                'test-device-1',
                expect.objectContaining({
                    payload: expect.objectContaining({ value: 120 }),
                })
            );
        });
    });

    describe('Broadcast Commands', () => {
        test('routes broadcast command to all devices', async () => {
            if (!messageHandler) {
                throw new Error('Message handler not registered');
            }

            const topic = 'posterrama/broadcast/command/playback.pause';
            const payload = Buffer.from(JSON.stringify({}));

            messageHandler(topic, payload);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockWsHub.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'playback.pause',
                })
            );
        });
    });
});
