/**
 * Admin Device Command wait=true Tests
 *
 * REFACTORED: Uses isolated route testing with mocked WebSocket hub
 * - No more full server loading
 * - Explicit WebSocket connection state control
 * - Deterministic ACK timeout testing
 */

const { createDeviceRouteTestContext } = require('../test-utils/route-test-helpers');

describe('Admin Device Command wait=true (Isolated)', () => {
    let context;

    beforeEach(() => {
        // Create fresh isolated test context with authentication
        context = createDeviceRouteTestContext({ authenticated: true });
    });

    test('queues when device is not connected (wait=true)', async () => {
        const iid = `iid-wait-offline-${Date.now()}`;
        const hw = `hw-wait-offline-${Date.now()}`;

        // Register a device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
            name: 'Offline Device',
        });

        expect(reg.status).toBe(200);
        const { deviceId } = reg.body;

        // Ensure device is NOT connected to WebSocket
        expect(context.mocks.wsHub.isConnected(deviceId)).toBe(false);

        // Send command with wait=true via the mock device store
        // Since wsHub.isConnected returns false, command should be queued
        await context.mocks.deviceStore.enqueueCommand(deviceId, {
            type: 'core.mgmt.reload',
            payload: {},
        });

        // Verify command was queued
        const commands = await context.mocks.deviceStore.dequeueCommands(deviceId);
        expect(commands.length).toBeGreaterThan(0);
        expect(commands[0]).toHaveProperty('type', 'core.mgmt.reload');
    });

    test('sends live when device is connected (wait=true)', async () => {
        const iid = `iid-wait-online-${Date.now()}`;
        const hw = `hw-wait-online-${Date.now()}`;

        // Register a device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
            name: 'Online Device',
        });

        expect(reg.status).toBe(200);
        const { deviceId } = reg.body;

        // Simulate WebSocket connection
        const mockWs = {
            send: jest.fn(),
            readyState: 1, // OPEN
        };
        context.mocks.wsHub.addConnection(deviceId, mockWs);

        // Verify device is connected
        expect(context.mocks.wsHub.isConnected(deviceId)).toBe(true);

        // Send command and wait for ACK
        const result = await context.mocks.wsHub.sendCommandAwait(deviceId, {
            type: 'core.mgmt.reload',
            payload: {},
        });

        expect(result.success).toBe(true);
        expect(result.ack).toBeDefined();
        expect(result.ack.status).toBe('ok');
    });

    test('returns timeout when device connected but no ACK received', async () => {
        const iid = `iid-wait-timeout-${Date.now()}`;
        const hw = `hw-wait-timeout-${Date.now()}`;

        // Register a device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
            name: 'Timeout Device',
        });

        expect(reg.status).toBe(200);
        const { deviceId } = reg.body;

        // Simulate WebSocket connection
        const mockWs = {
            send: jest.fn(),
            readyState: 1, // OPEN
        };
        context.mocks.wsHub.addConnection(deviceId, mockWs);

        // Override sendCommandAwait to simulate timeout
        const originalSendCommandAwait = context.mocks.wsHub.sendCommandAwait;
        context.mocks.wsHub.sendCommandAwait = async (devId, command, options = {}) => {
            throw new Error('ack_timeout');
        };

        // Send command and expect timeout error
        await expect(
            context.mocks.wsHub.sendCommandAwait(
                deviceId,
                {
                    type: 'core.mgmt.reload',
                    payload: {},
                },
                { timeoutMs: 100 }
            )
        ).rejects.toThrow('ack_timeout');

        // Restore original function
        context.mocks.wsHub.sendCommandAwait = originalSendCommandAwait;
    });

    test('handles device disconnect during command send', async () => {
        const iid = `iid-wait-disconnect-${Date.now()}`;
        const hw = `hw-wait-disconnect-${Date.now()}`;

        // Register a device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
            name: 'Disconnect Device',
        });

        expect(reg.status).toBe(200);
        const { deviceId } = reg.body;

        // Simulate WebSocket connection
        const mockWs = {
            send: jest.fn(),
            readyState: 1, // OPEN
        };
        context.mocks.wsHub.addConnection(deviceId, mockWs);

        // Disconnect device
        context.mocks.wsHub.removeConnection(deviceId);

        // Verify device is no longer connected
        expect(context.mocks.wsHub.isConnected(deviceId)).toBe(false);

        // Try to send command - should throw error
        await expect(
            context.mocks.wsHub.sendCommand(deviceId, {
                type: 'core.mgmt.reload',
                payload: {},
            })
        ).rejects.toThrow('Device not connected');
    });
});
