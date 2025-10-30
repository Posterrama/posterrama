/**
 * MQTT Integration E2E Tests (Optional)
 *
 * These tests require a real MQTT broker and are skipped if not configured.
 * To run these tests locally, set environment variables:
 *
 * export MQTT_TEST_BROKER="mqtt://192.168.1.100:1883"
 * export MQTT_TEST_USERNAME="posterrama"
 * export MQTT_TEST_PASSWORD="your_password"
 *
 * Then run: npm test -- __tests__/mqtt/mqtt-integration.e2e.test.js
 */

const mqtt = require('mqtt');
const MqttBridge = require('../../utils/mqttBridge');

// Check if MQTT broker is configured
const MQTT_BROKER = process.env.MQTT_TEST_BROKER;
const MQTT_USERNAME = process.env.MQTT_TEST_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_TEST_PASSWORD;

const describeIf = MQTT_BROKER ? describe : describe.skip;

describeIf('MQTT Integration E2E (Real Broker)', () => {
    let mqttBridge;
    let testClient;
    let receivedMessages;

    beforeAll(() => {
        console.log(`🔌 Testing with real MQTT broker: ${MQTT_BROKER}`);
    });

    beforeEach(async () => {
        receivedMessages = [];

        // Create test client
        testClient = mqtt.connect(MQTT_BROKER, {
            username: MQTT_USERNAME,
            password: MQTT_PASSWORD,
        });

        await new Promise((resolve, reject) => {
            testClient.on('connect', resolve);
            testClient.on('error', reject);
            setTimeout(() => reject(new Error('Test client connection timeout')), 10000);
        });

        // Subscribe to all Posterrama topics
        testClient.subscribe('posterrama/#', err => {
            if (err) throw err;
        });

        // Capture messages
        testClient.on('message', (topic, payload) => {
            receivedMessages.push({
                topic,
                payload: payload.toString(),
                timestamp: Date.now(),
            });
        });

        // Create MQTT bridge
        const [protocol, rest] = MQTT_BROKER.split('://');
        const [host, port] = rest.split(':');

        mqttBridge = new MqttBridge({
            enabled: true,
            broker: {
                host,
                port: parseInt(port) || 1883,
                username: MQTT_USERNAME,
                password: MQTT_PASSWORD,
            },
            topicPrefix: 'posterrama',
            discovery: {
                enabled: true,
                prefix: 'homeassistant',
            },
        });

        await mqttBridge.init();
    });

    afterEach(async () => {
        if (mqttBridge) {
            await mqttBridge.shutdown();
        }
        if (testClient) {
            testClient.end();
        }
        receivedMessages = [];
    });

    describe('Connection', () => {
        test('connects to real broker successfully', () => {
            expect(mqttBridge.connected).toBe(true);
        });

        test('subscribes to command topics', async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
            expect(mqttBridge.client.subscriptions.size).toBeGreaterThan(0);
        });
    });

    describe('Device State Publishing', () => {
        test('publishes device state to real broker', async () => {
            const device = {
                id: 'e2e-test-device',
                name: 'E2E Test Device',
                status: 'online',
                location: 'Test Suite',
                currentState: {
                    mode: 'screensaver',
                    paused: false,
                },
            };

            await mqttBridge.publishDeviceState(device);

            // Wait for message to arrive
            await new Promise(resolve => setTimeout(resolve, 500));

            const stateMessages = receivedMessages.filter(msg => msg.topic.includes('/state'));
            expect(stateMessages.length).toBeGreaterThan(0);

            const payload = JSON.parse(stateMessages[0].payload);
            expect(payload.device_id).toBe('e2e-test-device');
            expect(payload.mode).toBe('screensaver');
        });
    });

    describe('Command Routing', () => {
        test('receives and routes commands from real broker', async () => {
            const device = {
                id: 'e2e-test-device',
                name: 'E2E Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            // Publish a command
            testClient.publish(
                'posterrama/device/e2e-test-device/command/playback.pause',
                JSON.stringify({})
            );

            // Wait for command to be processed
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Command should have been logged in history
            const hasCommand = mqttBridge.commandHistory.some(
                cmd => cmd.deviceId === 'e2e-test-device' && cmd.capability === 'playback.pause'
            );

            expect(hasCommand).toBe(true);
        });
    });

    describe('Home Assistant Discovery', () => {
        test('publishes discovery configs to real broker', async () => {
            const device = {
                id: 'e2e-test-device',
                name: 'E2E Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDiscovery(device);

            // Wait for messages
            await new Promise(resolve => setTimeout(resolve, 1000));

            const discoveryMessages = receivedMessages.filter(msg =>
                msg.topic.startsWith('homeassistant/')
            );
            expect(discoveryMessages.length).toBeGreaterThan(0);
        });
    });

    describe('QoS and Retain', () => {
        test('verifies QoS levels on real broker', async () => {
            const device = {
                id: 'e2e-test-device',
                name: 'E2E Test Device',
                status: 'online',
                currentState: { mode: 'screensaver' },
            };

            await mqttBridge.publishDeviceState(device);
            await new Promise(resolve => setTimeout(resolve, 500));

            // State messages should arrive (QoS 1 ensures delivery)
            const stateMessages = receivedMessages.filter(msg => msg.topic.includes('/state'));
            expect(stateMessages.length).toBeGreaterThan(0);
        });

        test('verifies retained availability messages', async () => {
            const device = {
                id: 'e2e-test-device',
                name: 'E2E Test Device',
                status: 'online',
            };

            await mqttBridge.publishDeviceAvailability(device);
            await new Promise(resolve => setTimeout(resolve, 500));

            // Disconnect and reconnect test client to check retained message
            testClient.end();
            await new Promise(resolve => setTimeout(resolve, 500));

            receivedMessages = [];
            testClient = mqtt.connect(MQTT_BROKER, {
                username: MQTT_USERNAME,
                password: MQTT_PASSWORD,
            });

            await new Promise(resolve => {
                testClient.on('connect', resolve);
            });

            testClient.subscribe('posterrama/#');
            testClient.on('message', (topic, payload) => {
                receivedMessages.push({ topic, payload: payload.toString() });
            });

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Should receive retained availability message
            const availabilityMessages = receivedMessages.filter(msg =>
                msg.topic.includes('/availability')
            );
            expect(availabilityMessages.length).toBeGreaterThan(0);
        });
    });
});

// Show message if tests are skipped
if (!MQTT_BROKER) {
    describe('MQTT Integration E2E (Skipped)', () => {
        test.skip('E2E tests require MQTT broker configuration', () => {
            console.log(`
⏭️  Skipping MQTT E2E tests - no broker configured

To run these tests locally with your real MQTT broker:

    export MQTT_TEST_BROKER="mqtt://192.168.1.100:1883"
    export MQTT_TEST_USERNAME="posterrama"
    export MQTT_TEST_PASSWORD="your_password"
    npm test -- __tests__/mqtt/mqtt-integration.e2e.test.js

These tests will always be skipped in CI/CD.
            `);
        });
    });
}
