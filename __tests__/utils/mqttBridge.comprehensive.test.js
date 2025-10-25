/**
 * Comprehensive tests for mqttBridge.js
 * Focus: connect, disconnect, publish methods, message handling, error paths
 */

// Create a fresh mock client for each test
let mockMqttClient;

const createMockClient = () => ({
    on: jest.fn(),
    publish: jest.fn((topic, payload, options, callback) => {
        if (callback) setImmediate(() => callback(null));
    }),
    subscribe: jest.fn((topic, options, callback) => {
        if (callback) setImmediate(() => callback(null));
    }),
    end: jest.fn((force, opts, callback) => {
        if (typeof opts === 'function') {
            setImmediate(() => opts());
        } else if (callback) {
            setImmediate(() => callback());
        }
    }),
    connected: true,
});

jest.mock('mqtt', () => ({
    connect: jest.fn(() => mockMqttClient),
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
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
    capabilities: new Map(),
    get: jest.fn(() => null),
    getAvailableCapabilities: jest.fn(() => []),
    getAllCapabilities: jest.fn(() => []),
}));

describe('MqttBridge - Comprehensive Coverage', () => {
    let MqttBridge;
    let mqttBridge;
    let logger;
    let mqtt;
    let capabilityRegistry;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create fresh mock client for each test
        mockMqttClient = createMockClient();

        mqtt = require('mqtt');
        mqtt.connect.mockReturnValue(mockMqttClient);

        logger = require('../../utils/logger');
        capabilityRegistry = require('../../utils/capabilityRegistry');

        // Reset mock implementations after clearAllMocks
        capabilityRegistry.get = jest.fn(() => null);
        capabilityRegistry.getAvailableCapabilities = jest.fn(() => []);
        capabilityRegistry.getAllCapabilities = jest.fn(() => []);

        MqttBridge = require('../../utils/mqttBridge');
    });

    afterEach(() => {
        if (mqttBridge?.publishTimer) {
            clearInterval(mqttBridge.publishTimer);
        }
    });

    describe('constructor', () => {
        test('initializes with config', () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            expect(mqttBridge.config).toBe(config);
            expect(mqttBridge.connected).toBe(false);
            expect(mqttBridge.stats.published).toBe(0);
            expect(mqttBridge.deviceStates).toBeInstanceOf(Map);
            expect(mqttBridge.commandHistory).toEqual([]);
        });

        test('initializes without config', () => {
            mqttBridge = new MqttBridge();
            expect(mqttBridge.config).toBe(null);
        });
    });

    describe('init()', () => {
        test('returns early if config is null', async () => {
            mqttBridge = new MqttBridge(null);
            await mqttBridge.init();

            expect(logger.info).toHaveBeenCalledWith('MQTT bridge disabled in configuration');
            expect(mqtt.connect).not.toHaveBeenCalled();
        });

        test('returns early if config.enabled is false', async () => {
            mqttBridge = new MqttBridge({ enabled: false });
            await mqttBridge.init();

            expect(logger.info).toHaveBeenCalledWith('MQTT bridge disabled in configuration');
            expect(mqtt.connect).not.toHaveBeenCalled();
        });

        test('throws error on connection failure', async () => {
            const config = { enabled: true, broker: 'localhost', port: 1883 };
            mqttBridge = new MqttBridge(config);

            const connectError = new Error('Connection failed');
            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'error') {
                    setImmediate(() => handler(connectError));
                }
            });

            await expect(mqttBridge.init()).rejects.toThrow('Connection failed');
            expect(mqttBridge.stats.errors).toBeGreaterThan(0);
        });
    });

    describe('connect()', () => {
        test('connects with flat config (broker string)', async () => {
            const config = {
                enabled: true,
                broker: 'mqtt.example.com',
                port: 1883,
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();

            expect(mqtt.connect).toHaveBeenCalledWith(
                'mqtt://mqtt.example.com:1883',
                expect.objectContaining({
                    clientId: expect.stringContaining('posterrama_'),
                    clean: true,
                })
            );
            expect(mqttBridge.connected).toBe(true);
        });

        test('connects with nested config (broker object)', async () => {
            const config = {
                enabled: true,
                broker: {
                    host: 'nested.example.com',
                    port: 8883,
                    username: 'user',
                    password: 'pass',
                },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();

            expect(mqtt.connect).toHaveBeenCalledWith(
                'mqtt://nested.example.com:8883',
                expect.objectContaining({
                    username: 'user',
                    password: 'pass',
                })
            );
        });

        test('uses TLS when configured', async () => {
            const config = {
                enabled: true,
                broker: { host: 'secure.example.com', port: 8883, tls: true },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();

            expect(mqtt.connect).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ protocol: 'mqtts' })
            );
        });

        test('handles password from environment variable', async () => {
            process.env.MQTT_PASSWORD = 'env-password';
            const config = {
                enabled: true,
                broker: {
                    host: 'localhost',
                    passwordEnvVar: 'MQTT_PASSWORD',
                },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();

            expect(mqtt.connect).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ password: 'env-password' })
            );

            delete process.env.MQTT_PASSWORD;
        });

        test('handles connection timeout', async () => {
            jest.useFakeTimers();
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation(() => {
                // Don't emit connect event
            });

            const connectPromise = mqttBridge.connect();
            jest.advanceTimersByTime(31000); // Advance past 30s timeout

            await expect(connectPromise).rejects.toThrow('MQTT connection timeout');
            jest.useRealTimers();
        });

        test('handles error event', async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            const error = new Error('Connection refused');
            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'error') {
                    setImmediate(() => handler(error));
                }
            });

            await expect(mqttBridge.connect()).rejects.toThrow('Connection refused');
            expect(mqttBridge.stats.errors).toBeGreaterThan(0);
        });

        test('logs reconnect event', async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                } else if (event === 'reconnect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();

            // Trigger reconnect
            const reconnectHandler = mockMqttClient.on.mock.calls.find(
                call => call[0] === 'reconnect'
            )?.[1];
            reconnectHandler?.();

            expect(logger.warn).toHaveBeenCalledWith('MQTT reconnecting...');
        });

        test('handles offline event', async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                } else if (event === 'offline') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
            expect(mqttBridge.connected).toBe(true);

            // Trigger offline
            const offlineHandler = mockMqttClient.on.mock.calls.find(
                call => call[0] === 'offline'
            )?.[1];
            offlineHandler?.();

            expect(mqttBridge.connected).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith('MQTT broker offline');
        });
    });

    describe('shutdown()', () => {
        test('ends client and clears timer when connected', async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
            mqttBridge.publishTimer = setInterval(() => {}, 1000);
            expect(mqttBridge.connected).toBe(true);

            await mqttBridge.shutdown();

            expect(mockMqttClient.end).toHaveBeenCalled();
            expect(mqttBridge.connected).toBe(false);
            expect(mqttBridge.publishTimer).toBe(null);
        });

        test('handles shutdown when not connected', async () => {
            mqttBridge = new MqttBridge({ enabled: true });

            await mqttBridge.shutdown();

            // Should not throw
            expect(mqttBridge.connected).toBe(false);
        });
    });

    describe('publish()', () => {
        beforeEach(async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        test('publishes message with default options', async () => {
            await mqttBridge.publish('test/topic', 'test-message', { retain: false, qos: 0 });

            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/topic',
                'test-message',
                { retain: false, qos: 0 },
                expect.any(Function)
            );
            expect(mqttBridge.stats.messagesPublished).toBe(1);
        });

        test('publishes with custom options', async () => {
            await mqttBridge.publish('test/topic', 'test-message', { retain: true, qos: 1 });

            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/topic',
                'test-message',
                { retain: true, qos: 1 },
                expect.any(Function)
            );
        });

        test('handles publish errors', async () => {
            mockMqttClient.publish.mockImplementation((topic, payload, options, callback) => {
                callback(new Error('Publish failed'));
            });

            await expect(mqttBridge.publish('test/topic', 'msg')).rejects.toThrow('Publish failed');
        });

        test('rejects when not connected', async () => {
            mqttBridge.connected = false;

            await expect(mqttBridge.publish('test/topic', 'msg')).rejects.toThrow(
                'MQTT client not connected'
            );

            expect(mockMqttClient.publish).not.toHaveBeenCalled();
        });
    });

    describe('getStats()', () => {
        test('returns stats with uptime', () => {
            mqttBridge = new MqttBridge({ enabled: true, broker: 'localhost' });
            mqttBridge.stats.messagesPublished = 42;
            mqttBridge.stats.commandsExecuted = 10;

            const stats = mqttBridge.getStats();

            expect(stats.messagesPublished).toBe(42);
            expect(stats.commandsExecuted).toBe(10);
            expect(stats.uptime_seconds).toBeGreaterThanOrEqual(0);
        });
    });

    describe('startStatePublishing()', () => {
        test('sets up periodic publishing', async () => {
            const config = {
                enabled: true,
                broker: 'localhost',
                statePublishInterval: 100,
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
            mqttBridge.startStatePublishing();

            expect(mqttBridge.publishTimer).toBeDefined();
            clearInterval(mqttBridge.publishTimer);
        });

        test('uses default interval if not configured', async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
            mqttBridge.startStatePublishing();

            expect(mqttBridge.publishTimer).toBeDefined();
            clearInterval(mqttBridge.publishTimer);
        });
    });

    describe('subscribeToCommands()', () => {
        test('subscribes to device and broadcast command topics', async () => {
            const config = { enabled: true, broker: 'localhost', topicPrefix: 'test' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
            mqttBridge.subscribeToCommands();

            expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
                ['test/device/+/command/#', 'test/broadcast/command/#'],
                expect.any(Function)
            );
        });

        test('uses default topic prefix if not configured', async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
            mqttBridge.subscribeToCommands();

            expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
                ['posterrama/device/+/command/#', 'posterrama/broadcast/command/#'],
                expect.any(Function)
            );
        });

        test('returns early when not connected', () => {
            mqttBridge = new MqttBridge({ enabled: true });
            mqttBridge.client = null;

            mqttBridge.subscribeToCommands();

            expect(mockMqttClient.subscribe).not.toHaveBeenCalled();
        });

        test('handles subscription errors', async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });
            mockMqttClient.subscribe.mockImplementation((topics, callback) => {
                callback(new Error('Subscribe failed'));
            });

            await mqttBridge.connect();
            mqttBridge.subscribeToCommands();

            expect(logger.error).toHaveBeenCalledWith(
                'Failed to subscribe to command topics:',
                expect.any(Error)
            );
            expect(mqttBridge.stats.errors).toBeGreaterThan(0);
        });
    });

    describe('handleMessage()', () => {
        beforeEach(async () => {
            const config = { enabled: true, broker: 'localhost', topicPrefix: 'test' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        test('increments messagesReceived counter', async () => {
            const initialCount = mqttBridge.stats.messagesReceived;

            await mqttBridge.handleMessage('test/device/dev1/command/test', Buffer.from('{}'));

            expect(mqttBridge.stats.messagesReceived).toBe(initialCount + 1);
        });

        test('handles device command topics', async () => {
            const handleDeviceCommandSpy = jest
                .spyOn(mqttBridge, 'handleDeviceCommand')
                .mockResolvedValue();

            await mqttBridge.handleMessage(
                'test/device/dev1/command/playback_pause',
                Buffer.from('{}')
            );

            expect(handleDeviceCommandSpy).toHaveBeenCalledWith('dev1', 'playback_pause', '{}');
        });

        test('handles broadcast command topics', async () => {
            const handleBroadcastCommandSpy = jest
                .spyOn(mqttBridge, 'handleBroadcastCommand')
                .mockResolvedValue();

            await mqttBridge.handleMessage(
                'test/broadcast/command/power_toggle',
                Buffer.from('ON')
            );

            expect(handleBroadcastCommandSpy).toHaveBeenCalledWith('power_toggle', 'ON');
        });

        test('warns on unknown topic pattern', async () => {
            await mqttBridge.handleMessage('unknown/topic/pattern', Buffer.from('data'));

            expect(logger.warn).toHaveBeenCalledWith(
                'Unknown MQTT topic pattern:',
                'unknown/topic/pattern'
            );
        });

        test('handles message processing errors', async () => {
            jest.spyOn(mqttBridge, 'handleDeviceCommand').mockRejectedValue(
                new Error('Command failed')
            );

            await mqttBridge.handleMessage('test/device/dev1/command/test', Buffer.from('{}'));

            expect(logger.error).toHaveBeenCalledWith(
                'Error handling MQTT message:',
                expect.any(Error)
            );
            expect(mqttBridge.stats.errors).toBeGreaterThan(0);
        });
    });

    describe('handleDeviceCommand()', () => {
        let mockCapability;

        beforeEach(async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();

            // Mock capability
            mockCapability = {
                name: 'Test Capability',
                commandHandler: jest.fn().mockResolvedValue(),
            };

            capabilityRegistry.get.mockReturnValue(mockCapability);
        });

        test('converts underscores to dots in capability ID', async () => {
            await mqttBridge.handleDeviceCommand('dev1', 'playback_pause', '{}');

            expect(capabilityRegistry.get).toHaveBeenCalledWith('playback.pause');
        });

        test('executes capability command handler', async () => {
            await mqttBridge.handleDeviceCommand('dev1', 'test_command', 'test-value');

            expect(mockCapability.commandHandler).toHaveBeenCalledWith('dev1', 'test-value');
            expect(mqttBridge.stats.commandsExecuted).toBe(1);
        });

        test('parses JSON payload', async () => {
            await mqttBridge.handleDeviceCommand('dev1', 'test', JSON.stringify({ value: 42 }));

            expect(mockCapability.commandHandler).toHaveBeenCalledWith('dev1', 42);
        });

        test('uses raw payload for non-JSON', async () => {
            await mqttBridge.handleDeviceCommand('dev1', 'test', 'raw-string');

            expect(mockCapability.commandHandler).toHaveBeenCalledWith('dev1', 'raw-string');
        });

        test('warns on unknown capability', async () => {
            capabilityRegistry.get.mockReturnValue(null);

            await mqttBridge.handleDeviceCommand('dev1', 'unknown_capability', '{}');

            expect(logger.warn).toHaveBeenCalledWith(
                'Unknown capability in command',
                expect.objectContaining({ capabilityId: 'unknown.capability' })
            );
        });

        test('handles command execution errors', async () => {
            mockCapability.commandHandler.mockRejectedValue(new Error('Handler failed'));

            await mqttBridge.handleDeviceCommand('dev1', 'test', '{}');

            expect(logger.error).toHaveBeenCalledWith(
                'Error executing device command:',
                expect.any(Error)
            );
            expect(mqttBridge.stats.errors).toBeGreaterThan(0);
        });

        test('adds successful command to history', async () => {
            const deviceStore = require('../../utils/deviceStore');
            deviceStore.getDevice = jest.fn(() => ({ name: 'Test Device' }));

            await mqttBridge.handleDeviceCommand('dev1', 'test', '{}');

            expect(mqttBridge.commandHistory.length).toBeGreaterThan(0);
            expect(mqttBridge.commandHistory[0]).toMatchObject({
                deviceId: 'dev1',
                success: true,
            });
        });

        test('limits command history to maxCommandHistory', async () => {
            mqttBridge.maxCommandHistory = 3;

            // Add 5 commands
            for (let i = 0; i < 5; i++) {
                await mqttBridge.handleDeviceCommand('dev1', 'test', '{}');
            }

            expect(mqttBridge.commandHistory.length).toBe(3);
        });
    });

    describe('handleBroadcastCommand()', () => {
        let deviceStore;

        beforeEach(async () => {
            const config = { enabled: true, broker: 'localhost' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();

            deviceStore = require('../../utils/deviceStore');
        });

        test('executes command on all devices', async () => {
            const mockDevices = [
                { id: 'dev1', name: 'Device 1' },
                { id: 'dev2', name: 'Device 2' },
                { id: 'dev3', name: 'Device 3' },
            ];

            deviceStore.getAll.mockResolvedValue(mockDevices);

            const handleDeviceCommandSpy = jest
                .spyOn(mqttBridge, 'handleDeviceCommand')
                .mockResolvedValue();

            await mqttBridge.handleBroadcastCommand('test_command', 'test-value');

            expect(deviceStore.getAll).toHaveBeenCalled();
            expect(handleDeviceCommandSpy).toHaveBeenCalledTimes(3);
            expect(handleDeviceCommandSpy).toHaveBeenCalledWith(
                'dev1',
                'test_command',
                'test-value'
            );
            expect(handleDeviceCommandSpy).toHaveBeenCalledWith(
                'dev2',
                'test_command',
                'test-value'
            );
            expect(handleDeviceCommandSpy).toHaveBeenCalledWith(
                'dev3',
                'test_command',
                'test-value'
            );
        });

        test('handles empty device list', async () => {
            deviceStore.getAll.mockResolvedValue([]);

            const handleDeviceCommandSpy = jest
                .spyOn(mqttBridge, 'handleDeviceCommand')
                .mockResolvedValue();

            await mqttBridge.handleBroadcastCommand('test', '{}');

            expect(handleDeviceCommandSpy).not.toHaveBeenCalled();
        });

        test('handles errors during broadcast', async () => {
            deviceStore.getAll.mockRejectedValue(new Error('Database error'));

            await mqttBridge.handleBroadcastCommand('test', '{}');

            expect(logger.error).toHaveBeenCalledWith(
                'Error executing broadcast command:',
                expect.any(Error)
            );
            expect(mqttBridge.stats.errors).toBeGreaterThan(0);
        });
    });

    describe('publishDeviceState()', () => {
        beforeEach(async () => {
            const config = { enabled: true, broker: 'localhost', topicPrefix: 'test' };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();

            capabilityRegistry.getAvailableCapabilities.mockReturnValue([
                {
                    id: 'test.capability',
                    stateGetter: jest.fn(() => 'test-value'),
                },
            ]);
        });

        test('publishes device state to MQTT', async () => {
            const device = {
                id: 'dev1',
                name: 'Test Device',
                location: 'Living Room',
                status: 'online',
                clientInfo: { mode: 'cinema' },
                currentState: {
                    paused: false,
                    pinned: false,
                    poweredOff: false,
                    mediaId: 'movie-123',
                },
                lastSeenAt: '2025-10-25T10:00:00Z',
                preset: 'default',
            };

            await mqttBridge.publishDeviceState(device);

            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/device/dev1/state',
                expect.stringContaining('"device_id":"dev1"'),
                expect.any(Object),
                expect.any(Function)
            );
        });

        test('returns early when not connected', async () => {
            mqttBridge.connected = false;

            const device = { id: 'dev1', name: 'Test' };
            await mqttBridge.publishDeviceState(device);

            expect(mockMqttClient.publish).not.toHaveBeenCalled();
        });

        test('includes capability states', async () => {
            const stateGetter = jest.fn(() => 42);
            capabilityRegistry.getAvailableCapabilities.mockReturnValue([
                { id: 'test.cap', stateGetter },
            ]);

            const device = {
                id: 'dev1',
                name: 'Test',
                currentState: {},
            };

            await mqttBridge.publishDeviceState(device);

            expect(stateGetter).toHaveBeenCalledWith(device);
            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('"test.cap":42'),
                expect.any(Object),
                expect.any(Function)
            );
        });

        test('handles stateGetter errors gracefully', async () => {
            capabilityRegistry.getAvailableCapabilities.mockReturnValue([
                {
                    id: 'failing.cap',
                    stateGetter: () => {
                        throw new Error('State error');
                    },
                },
            ]);

            const device = { id: 'dev1', name: 'Test', currentState: {} };

            await mqttBridge.publishDeviceState(device);

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error getting state for failing.cap'),
                expect.any(Error)
            );
        });

        test('republishes discovery when mode changes', async () => {
            const device = {
                id: 'dev1',
                name: 'Test',
                clientInfo: { mode: 'wallart' },
                currentState: {},
            };

            // Set initial mode
            mqttBridge.deviceModes.set('dev1', 'screensaver');

            const unpublishAllCapabilitiesSpy = jest
                .spyOn(mqttBridge, 'unpublishAllCapabilities')
                .mockResolvedValue();
            const publishDiscoverySpy = jest
                .spyOn(mqttBridge, 'publishDiscovery')
                .mockResolvedValue();

            await mqttBridge.publishDeviceState(device);

            expect(unpublishAllCapabilitiesSpy).toHaveBeenCalledWith(device);
            expect(publishDiscoverySpy).toHaveBeenCalledWith(device);
            expect(mqttBridge.deviceModes.get('dev1')).toBe('wallart');
        });
    });

    describe('publishDeviceAvailability()', () => {
        beforeEach(async () => {
            const config = {
                enabled: true,
                broker: 'localhost',
                topicPrefix: 'test',
                availability: { enabled: true, timeout: 60 },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        test('publishes online availability for active device', async () => {
            const device = {
                id: 'dev1',
                status: 'online',
                lastSeenAt: new Date(Date.now() - 30000).toISOString(), // 30 seconds ago
            };

            await mqttBridge.publishDeviceAvailability(device);

            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/device/dev1/availability',
                'online',
                { retain: true, qos: 1 },
                expect.any(Function)
            );
        });

        test('publishes offline availability for inactive device', async () => {
            const device = {
                id: 'dev1',
                status: 'offline',
            };

            await mqttBridge.publishDeviceAvailability(device);

            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/device/dev1/availability',
                'offline',
                { retain: true, qos: 1 },
                expect.any(Function)
            );
        });

        test('returns early when not connected', async () => {
            mqttBridge.connected = false;

            await mqttBridge.publishDeviceAvailability({ id: 'dev1' });

            expect(mockMqttClient.publish).not.toHaveBeenCalled();
        });
    });

    describe('publishDiscovery()', () => {
        beforeEach(async () => {
            const config = {
                enabled: true,
                broker: 'localhost',
                topicPrefix: 'test',
                discovery: { enabled: true, prefix: 'homeassistant' },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        test('publishes Home Assistant discovery configs', async () => {
            const testCapability = {
                id: 'test.button',
                name: 'Test Button',
                category: 'test',
                entityType: 'button',
                icon: 'mdi:test',
            };

            capabilityRegistry.getAllCapabilities.mockReturnValue([testCapability]);
            capabilityRegistry.getAvailableCapabilities.mockReturnValue([testCapability]);

            const device = {
                id: 'dev1',
                name: 'Test Device',
                currentState: {},
            };

            // Spy on publish method instead of mockMqttClient.publish
            const publishSpy = jest.spyOn(mqttBridge, 'publish').mockResolvedValue();

            await mqttBridge.publishDiscovery(device);

            expect(publishSpy).toHaveBeenCalledWith(
                expect.stringContaining('homeassistant/button/'),
                expect.stringContaining('"name":"Test Button"'),
                { retain: true, qos: 1 }
            );

            publishSpy.mockRestore();
        });

        test('skips discovery when disabled', async () => {
            mqttBridge.config.discovery.enabled = false;

            const device = { id: 'dev1', name: 'Test', currentState: {} };

            await mqttBridge.publishDiscovery(device);

            expect(mockMqttClient.publish).not.toHaveBeenCalled();
        });

        test('skips already published discoveries', async () => {
            mqttBridge.discoveryPublished.add('dev1');

            capabilityRegistry.getAvailableCapabilities.mockReturnValue([
                { id: 'test', name: 'Test', entityType: 'button' },
            ]);

            const device = { id: 'dev1', name: 'Test', currentState: {} };

            await mqttBridge.publishDiscovery(device);

            expect(mockMqttClient.publish).not.toHaveBeenCalled();
        });

        test('returns early when not connected', async () => {
            mqttBridge.connected = false;

            await mqttBridge.publishDiscovery({ id: 'dev1', currentState: {} });

            expect(mockMqttClient.publish).not.toHaveBeenCalled();
        });
    });

    describe('republishDiscovery', () => {
        beforeEach(async () => {
            const config = {
                enabled: true,
                broker: 'mqtt://localhost:1883',
                topic_prefix: 'posterrama',
                discovery: { enabled: true, prefix: 'homeassistant' },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        test('clears cache and republishes discovery', async () => {
            const device = { id: 'test-device', name: 'Test Device', currentState: {} };
            mqttBridge.discoveryPublished.add('test-device');

            const publishDiscoverySpy = jest
                .spyOn(mqttBridge, 'publishDiscovery')
                .mockResolvedValue();

            await mqttBridge.republishDiscovery(device);

            expect(mqttBridge.discoveryPublished.has('test-device')).toBe(false);
            expect(publishDiscoverySpy).toHaveBeenCalledWith(device);

            publishDiscoverySpy.mockRestore();
        });
    });

    describe('unpublishAllCapabilities', () => {
        beforeEach(async () => {
            const config = {
                enabled: true,
                broker: 'mqtt://localhost:1883',
                topic_prefix: 'posterrama',
                discovery: { enabled: true, prefix: 'homeassistant' },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        test('unpublishes all capabilities for a device', async () => {
            const device = { id: 'test-device', name: 'Test Device' };
            const allCaps = [
                { id: 'mode.select', entityType: 'select' },
                { id: 'power.toggle', entityType: 'button' },
            ];
            capabilityRegistry.getAllCapabilities.mockReturnValue(allCaps);

            const publishSpy = jest.spyOn(mqttBridge, 'publish').mockResolvedValue();

            await mqttBridge.unpublishAllCapabilities(device);

            // Should publish empty payload with retain to remove entities
            expect(publishSpy).toHaveBeenCalledWith(
                'homeassistant/select/posterrama_test-device/mode_select/config',
                '',
                { qos: 1, retain: true }
            );
            expect(publishSpy).toHaveBeenCalledWith(
                'homeassistant/button/posterrama_test-device/power_toggle/config',
                '',
                { qos: 1, retain: true }
            );

            publishSpy.mockRestore();
        });

        test('returns early if not connected', async () => {
            mqttBridge.connected = false;
            const device = { id: 'test-device' };
            const publishSpy = jest.spyOn(mqttBridge, 'publish');

            await mqttBridge.unpublishAllCapabilities(device);

            expect(publishSpy).not.toHaveBeenCalled();
            publishSpy.mockRestore();
        });

        test('returns early if discovery disabled', async () => {
            mqttBridge.config.discovery.enabled = false;
            const device = { id: 'test-device' };
            const publishSpy = jest.spyOn(mqttBridge, 'publish');

            await mqttBridge.unpublishAllCapabilities(device);

            expect(publishSpy).not.toHaveBeenCalled();
            publishSpy.mockRestore();
        });

        test('handles errors during unpublish', async () => {
            const device = { id: 'test-device' };
            capabilityRegistry.getAllCapabilities.mockImplementation(() => {
                throw new Error('Test error');
            });

            const initialErrors = mqttBridge.stats.errors;
            await mqttBridge.unpublishAllCapabilities(device);

            expect(mqttBridge.stats.errors).toBe(initialErrors + 1);
        });
    });

    describe('unpublishDiscovery', () => {
        beforeEach(async () => {
            const config = {
                enabled: true,
                broker: 'mqtt://localhost:1883',
                topic_prefix: 'posterrama',
                discovery: { enabled: true, prefix: 'homeassistant' },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        test('unpublishes discovery for deleted device', async () => {
            const device = { id: 'deleted-device', name: 'Deleted Device' };
            const availableCaps = [
                { id: 'mode.select', entityType: 'select' },
                { id: 'power.on', entityType: 'button' },
            ];
            capabilityRegistry.getAvailableCapabilities.mockReturnValue(availableCaps);
            mqttBridge.discoveryPublished.add('deleted-device');

            const publishSpy = jest.spyOn(mqttBridge, 'publish').mockResolvedValue();

            await mqttBridge.unpublishDiscovery(device);

            // Should send empty payloads to remove entities
            expect(publishSpy).toHaveBeenCalledWith(
                'homeassistant/select/posterrama_deleted-device/mode_select/config',
                '',
                { qos: 1, retain: true }
            );
            expect(publishSpy).toHaveBeenCalledWith(
                'homeassistant/button/posterrama_deleted-device/power_on/config',
                '',
                { qos: 1, retain: true }
            );

            // Should remove from tracking
            expect(mqttBridge.discoveryPublished.has('deleted-device')).toBe(false);

            publishSpy.mockRestore();
        });

        test('returns early if not connected', async () => {
            mqttBridge.connected = false;
            const device = { id: 'test-device' };
            const publishSpy = jest.spyOn(mqttBridge, 'publish');

            await mqttBridge.unpublishDiscovery(device);

            expect(publishSpy).not.toHaveBeenCalled();
            publishSpy.mockRestore();
        });

        test('returns early if discovery disabled', async () => {
            mqttBridge.config.discovery.enabled = false;
            const device = { id: 'test-device' };
            const publishSpy = jest.spyOn(mqttBridge, 'publish');

            await mqttBridge.unpublishDiscovery(device);

            expect(publishSpy).not.toHaveBeenCalled();
            publishSpy.mockRestore();
        });

        test('handles errors during unpublish', async () => {
            const device = { id: 'test-device', name: 'Test' };
            capabilityRegistry.getAvailableCapabilities.mockImplementation(() => {
                throw new Error('Test error');
            });

            const initialErrors = mqttBridge.stats.errors;
            await mqttBridge.unpublishDiscovery(device);

            expect(mqttBridge.stats.errors).toBe(initialErrors + 1);
        });
    });

    describe('buildDiscoveryConfig', () => {
        const device = {
            id: 'test-device',
            name: 'Test Device',
            hostname: 'test.local',
        };

        beforeEach(async () => {
            const config = {
                enabled: true,
                broker: 'mqtt://localhost:1883',
                topic_prefix: 'posterrama',
                availability: { enabled: true },
                discovery: { enabled: true, prefix: 'homeassistant' },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        test('generates correct config for button entity', () => {
            const capability = {
                id: 'playback.pause',
                name: 'Pause',
                entityType: 'button',
                icon: 'mdi:pause',
                category: 'playback',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config).toMatchObject({
                name: 'Pause',
                unique_id: 'posterrama_test-device_playback.pause',
                command_topic: 'posterrama/device/test-device/command/playback_pause',
                icon: 'mdi:pause',
                payload_press: '{}',
            });
            expect(config.availability).toEqual({
                topic: 'posterrama/device/test-device/availability',
            });
        });

        test('generates correct config for switch entity', () => {
            const capability = {
                id: 'power.toggle',
                name: 'Power',
                entityType: 'switch',
                icon: 'mdi:power',
                category: 'power',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config).toMatchObject({
                name: 'Power',
                state_topic: 'posterrama/device/test-device/state',
                command_topic: 'posterrama/device/test-device/command/power_toggle',
                payload_on: 'ON',
                payload_off: 'OFF',
                state_on: true,
                state_off: false,
            });
        });

        test('generates correct config for select entity', () => {
            const capability = {
                id: 'mode.select',
                name: 'Display Mode',
                entityType: 'select',
                options: ['cinema', 'screensaver', 'wallart'],
                icon: 'mdi:monitor',
                category: 'mode',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config).toMatchObject({
                name: 'Display Mode',
                command_topic: 'posterrama/device/test-device/command/mode_select',
                options: ['cinema', 'screensaver', 'wallart'],
            });
            expect(config.value_template).toContain("value_json['mode.select']");
        });

        test('generates correct config for number entity', () => {
            const capability = {
                id: 'settings.volume',
                name: 'Volume',
                entityType: 'number',
                min: 0,
                max: 100,
                step: 5,
                unit: '%',
                icon: 'mdi:volume-high',
                category: 'settings',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config).toMatchObject({
                name: 'Volume',
                command_topic: 'posterrama/device/test-device/command/settings_volume',
                min: 0,
                max: 100,
                step: 5,
                unit_of_measurement: '%',
            });
        });

        test('generates correct config for text entity', () => {
            const capability = {
                id: 'settings.customText',
                name: 'Custom Text',
                entityType: 'text',
                pattern: '^[a-zA-Z0-9 ]+$',
                icon: 'mdi:text',
                category: 'settings',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config).toMatchObject({
                name: 'Custom Text',
                command_topic: 'posterrama/device/test-device/command/settings_customText',
                mode: 'text',
                pattern: '^[a-zA-Z0-9 ]+$',
            });
        });

        test('generates correct config for camera entity', () => {
            const capability = {
                id: 'camera.snapshot',
                name: 'Screen Snapshot',
                entityType: 'camera',
                icon: 'mdi:camera',
                category: 'camera',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config).toMatchObject({
                name: 'Screen Snapshot',
                topic: 'posterrama/device/test-device/camera',
                image_topic: 'posterrama/device/test-device/camera',
                json_attributes_topic: 'posterrama/device/test-device/camera/state',
            });
        });

        test('generates correct config for sensor entity with optional fields', () => {
            const capability = {
                id: 'sensor.temperature',
                name: 'Temperature',
                entityType: 'sensor',
                unitOfMeasurement: '°C',
                deviceClass: 'temperature',
                icon: 'mdi:thermometer',
                category: 'diagnostic',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config).toMatchObject({
                name: 'Temperature',
                state_topic: 'posterrama/device/test-device/state',
                unit_of_measurement: '°C',
                device_class: 'temperature',
                entity_category: 'diagnostic',
            });
        });

        test('sets entity_category for diagnostic capabilities', () => {
            const capability = {
                id: 'sensor.uptime',
                name: 'Uptime',
                entityType: 'sensor',
                category: 'diagnostic',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config.entity_category).toBe('diagnostic');
        });

        test('omits availability when disabled', () => {
            mqttBridge.config.availability = { enabled: false };

            const capability = {
                id: 'test.cap',
                name: 'Test',
                entityType: 'button',
                category: 'playback',
            };

            const config = mqttBridge.buildDiscoveryConfig(device, capability, 'posterrama');

            expect(config.availability).toBeUndefined();
        });
    });

    describe('startStatePublishing', () => {
        beforeEach(async () => {
            const config = {
                enabled: true,
                broker: 'mqtt://localhost:1883',
                topic_prefix: 'posterrama',
                publishInterval: 10,
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        afterEach(() => {
            if (mqttBridge.publishTimer) {
                clearInterval(mqttBridge.publishTimer);
            }
        });

        test('starts periodic state publishing with interval', () => {
            mqttBridge.startStatePublishing();

            expect(mqttBridge.publishTimer).toBeDefined();

            clearInterval(mqttBridge.publishTimer);
        });

        test('uses default interval if not configured', async () => {
            mqttBridge.config.publishInterval = undefined;

            mqttBridge.startStatePublishing();

            expect(mqttBridge.publishTimer).toBeDefined();

            clearInterval(mqttBridge.publishTimer);
        });
    });

    describe('publishAllDeviceStates', () => {
        const deviceStore = require('../../utils/deviceStore');

        beforeEach(async () => {
            const config = {
                enabled: true,
                broker: 'mqtt://localhost:1883',
                topic_prefix: 'posterrama',
                discovery: { enabled: true, prefix: 'homeassistant' },
                availability: { enabled: true, timeout: 60 },
            };
            mqttBridge = new MqttBridge(config);

            mockMqttClient.on.mockImplementation((event, handler) => {
                if (event === 'connect') {
                    setImmediate(() => handler());
                }
            });

            await mqttBridge.connect();
        });

        test('publishes state for all devices', async () => {
            const mockDevices = [
                {
                    id: 'dev1',
                    name: 'Device 1',
                    currentState: { mode: 'cinema' },
                    lastSeenAt: Date.now(),
                },
                {
                    id: 'dev2',
                    name: 'Device 2',
                    currentState: { mode: 'wallart' },
                    lastSeenAt: Date.now(),
                },
            ];
            deviceStore.getAll.mockResolvedValue(mockDevices);

            const publishStateSpy = jest
                .spyOn(mqttBridge, 'publishDeviceState')
                .mockResolvedValue();
            const publishAvailSpy = jest
                .spyOn(mqttBridge, 'publishDeviceAvailability')
                .mockResolvedValue();
            const publishDiscoverySpy = jest
                .spyOn(mqttBridge, 'publishDiscovery')
                .mockResolvedValue();

            await mqttBridge.publishAllDeviceStates();

            expect(publishStateSpy).toHaveBeenCalledWith(mockDevices[0]);
            expect(publishStateSpy).toHaveBeenCalledWith(mockDevices[1]);
            expect(publishAvailSpy).toHaveBeenCalledTimes(2);
            expect(publishDiscoverySpy).toHaveBeenCalledTimes(2);

            publishStateSpy.mockRestore();
            publishAvailSpy.mockRestore();
            publishDiscoverySpy.mockRestore();
        });

        test('returns early if not connected', async () => {
            mqttBridge.connected = false;
            const publishStateSpy = jest.spyOn(mqttBridge, 'publishDeviceState');

            await mqttBridge.publishAllDeviceStates();

            expect(publishStateSpy).not.toHaveBeenCalled();
            publishStateSpy.mockRestore();
        });

        test('handles errors during publishing', async () => {
            deviceStore.getAll.mockRejectedValue(new Error('Test error'));

            const initialErrors = mqttBridge.stats.errors;

            await mqttBridge.publishAllDeviceStates();

            expect(mqttBridge.stats.errors).toBe(initialErrors + 1);
        });
    });
});
