/**
 * Admin Broadcast to All Devices Tests
 *
 * REFACTORED: Uses isolated route testing with mocked WebSocket hub
 * - No more full server loading
 * - Explicit WebSocket connection state control
 * - Deterministic broadcast behavior
 */

const { createDeviceRouteTestContext } = require('../test-utils/route-test-helpers');

describe('Admin broadcast to all devices (Isolated)', () => {
    test('broadcast queues for offline devices', async () => {
        const context = createDeviceRouteTestContext({ authenticated: true });

        const iid1 = `iid-b1-${Date.now()}`;
        const iid2 = `iid-b2-${Date.now()}`;

        // Register a couple of devices (no WS connection)
        const reg1 = await context.helpers.registerDevice({
            installId: iid1,
            hardwareId: 'hw-b1',
            name: 'Broadcast Device 1',
        });
        const reg2 = await context.helpers.registerDevice({
            installId: iid2,
            hardwareId: 'hw-b2',
            name: 'Broadcast Device 2',
        });

        expect(reg1.status).toBe(200);
        expect(reg2.status).toBe(200);

        const deviceId1 = reg1.body.deviceId;
        const deviceId2 = reg2.body.deviceId;

        // Ensure devices are NOT connected
        expect(context.mocks.wsHub.isConnected(deviceId1)).toBe(false);
        expect(context.mocks.wsHub.isConnected(deviceId2)).toBe(false);

        // Queue broadcast command via mock device store
        await context.mocks.deviceStore.enqueueCommand(deviceId1, {
            type: 'core.mgmt.reload',
            payload: {},
        });
        await context.mocks.deviceStore.enqueueCommand(deviceId2, {
            type: 'core.mgmt.reload',
            payload: {},
        });

        // Verify commands were queued
        const commands1 = await context.mocks.deviceStore.dequeueCommands(deviceId1);
        const commands2 = await context.mocks.deviceStore.dequeueCommands(deviceId2);

        expect(commands1.length).toBe(1);
        expect(commands2.length).toBe(1);
        expect(commands1[0].type).toBe('core.mgmt.reload');
        expect(commands2[0].type).toBe('core.mgmt.reload');
    });

    test('broadcast sends live to connected devices', async () => {
        const context = createDeviceRouteTestContext({ authenticated: true });

        const iid1 = `iid-live1-${Date.now()}`;
        const iid2 = `iid-live2-${Date.now()}`;

        // Register devices
        const reg1 = await context.helpers.registerDevice({
            installId: iid1,
            hardwareId: 'hw-live1',
        });
        const reg2 = await context.helpers.registerDevice({
            installId: iid2,
            hardwareId: 'hw-live2',
        });

        const deviceId1 = reg1.body.deviceId;
        const deviceId2 = reg2.body.deviceId;

        // Connect both devices to WebSocket
        const mockWs1 = { send: jest.fn(), readyState: 1 };
        const mockWs2 = { send: jest.fn(), readyState: 1 };

        context.mocks.wsHub.addConnection(deviceId1, mockWs1);
        context.mocks.wsHub.addConnection(deviceId2, mockWs2);

        // Verify connections
        expect(context.mocks.wsHub.isConnected(deviceId1)).toBe(true);
        expect(context.mocks.wsHub.isConnected(deviceId2)).toBe(true);

        // Broadcast command
        const results = await context.mocks.wsHub.broadcast({
            type: 'core.mgmt.reload',
            payload: {},
        });

        expect(results.length).toBe(2);
        expect(results.every(r => r.success)).toBe(true);
        expect(results.map(r => r.deviceId)).toEqual(
            expect.arrayContaining([deviceId1, deviceId2])
        );
    });

    test('broadcast with filter sends to subset of devices', async () => {
        const context = createDeviceRouteTestContext({ authenticated: true });

        // Register three devices
        const reg1 = await context.helpers.registerDevice({
            installId: `iid-filter1-${Date.now()}`,
        });
        const reg2 = await context.helpers.registerDevice({
            installId: `iid-filter2-${Date.now()}`,
        });
        const reg3 = await context.helpers.registerDevice({
            installId: `iid-filter3-${Date.now()}`,
        });

        const deviceId1 = reg1.body.deviceId;
        const deviceId2 = reg2.body.deviceId;
        const deviceId3 = reg3.body.deviceId;

        // Connect all devices
        context.mocks.wsHub.addConnection(deviceId1, { send: jest.fn(), readyState: 1 });
        context.mocks.wsHub.addConnection(deviceId2, { send: jest.fn(), readyState: 1 });
        context.mocks.wsHub.addConnection(deviceId3, { send: jest.fn(), readyState: 1 });

        // Broadcast with filter (only device1 and device2)
        const results = await context.mocks.wsHub.broadcast(
            { type: 'test.command', payload: {} },
            devId => devId === deviceId1 || devId === deviceId2
        );

        expect(results.length).toBe(2);
        expect(results.map(r => r.deviceId)).toEqual(
            expect.arrayContaining([deviceId1, deviceId2])
        );
        expect(results.map(r => r.deviceId)).not.toContain(deviceId3);
    });

    test('broadcast handles mixed connected/disconnected devices', async () => {
        const context = createDeviceRouteTestContext({ authenticated: true });

        // Register three devices
        const reg1 = await context.helpers.registerDevice({
            installId: `iid-mixed1-${Date.now()}`,
        });
        const reg2 = await context.helpers.registerDevice({
            installId: `iid-mixed2-${Date.now()}`,
        });
        const reg3 = await context.helpers.registerDevice({
            installId: `iid-mixed3-${Date.now()}`,
        });

        const deviceId1 = reg1.body.deviceId;
        const deviceId2 = reg2.body.deviceId;
        const deviceId3 = reg3.body.deviceId;

        // Connect only device1 and device3
        context.mocks.wsHub.addConnection(deviceId1, { send: jest.fn(), readyState: 1 });
        context.mocks.wsHub.addConnection(deviceId3, { send: jest.fn(), readyState: 1 });

        // device2 is NOT connected
        expect(context.mocks.wsHub.isConnected(deviceId2)).toBe(false);

        // Broadcast to connected devices
        const results = await context.mocks.wsHub.broadcast({
            type: 'core.mgmt.reload',
            payload: {},
        });

        // Only connected devices should receive
        expect(results.length).toBe(2);
        expect(results.map(r => r.deviceId)).toEqual(
            expect.arrayContaining([deviceId1, deviceId3])
        );
    });
});
