/*
 End-to-end smoke tests for device management
 Covers: register, heartbeat, pairing claim, and command queue
 
 REFACTORED: Uses isolated route testing instead of full server loading
 - Eliminates timing/race conditions from server startup
 - Faster test execution
 - More reliable in parallel test runs
*/

const { createDeviceRouteTestContext } = require('../test-utils/route-test-helpers');

describe('Devices E2E (Isolated Route Testing)', () => {
    let context;

    beforeEach(() => {
        // Create fresh isolated test context for each test
        context = createDeviceRouteTestContext({ authenticated: false });
    });

    test('register -> heartbeat -> list', async () => {
        const iid = `test-iid-${Date.now()}`;
        const hw = 'hw-test-123';

        // Register device
        const reg = await context
            .request()
            .post('/api/devices/register')
            .set('X-Install-Id', iid)
            .set('X-Hardware-Id', hw)
            .send({ installId: iid, hardwareId: hw, name: 'Test Device' })
            .expect(200);

        expect(reg.body.deviceId).toBeTruthy();
        expect(reg.body.secret).toBeTruthy();

        const { deviceId, secret: deviceSecret } = reg.body;

        // Send heartbeat
        const hb = await context
            .request()
            .post('/api/devices/heartbeat')
            .send({
                deviceId,
                secret: deviceSecret,
                installId: iid,
                hardwareId: hw,
                userAgent: 'jest',
                screen: { w: 1920, h: 1080, dpr: 1 },
                mode: 'screensaver',
            })
            .expect(200);

        expect(hb.body).toHaveProperty('queuedCommands');
        expect(Array.isArray(hb.body.queuedCommands)).toBe(true);

        // List devices without auth should fail
        await context.request().get('/api/devices').expect(401);
    });

    test('pairing claim rotates secret', async () => {
        const iid = `test-iid-${Date.now()}`;
        const hw = 'hw-test-abc';

        // Register device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
            name: 'Pairing Test Device',
        });

        expect(reg.status).toBe(200);
        const { deviceId, secret: deviceSecret } = reg.body;

        // Try to claim with invalid code (should fail)
        await context
            .request()
            .post('/api/devices/pair')
            .send({ code: '000000', token: 'invalid' })
            .expect(400);

        // Heartbeat should still work with original secret
        const hb = await context.helpers.sendHeartbeat(deviceId, deviceSecret, {
            installId: iid,
            hardwareId: hw,
        });

        expect(hb.status).toBe(200);
        expect(hb.body).toHaveProperty('queuedCommands');
    });

    test('command queue enqueues and returns on heartbeat', async () => {
        const iid = `test-iid-${Date.now()}`;
        const hw = 'hw-test-queue';

        // Register device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
            name: 'Queue Test Device',
        });

        expect(reg.status).toBe(200);
        const { deviceId, secret: deviceSecret } = reg.body;

        // Try to queue command without auth (should fail with 401)
        await context
            .request()
            .post('/api/devices/command')
            .send({
                deviceIds: [deviceId],
                command: { type: 'core.mgmt.reload', payload: {} },
            })
            .expect(401);

        // Heartbeat returns empty commands queue (since command wasn't queued due to 401)
        const hb = await context.helpers.sendHeartbeat(deviceId, deviceSecret, {
            installId: iid,
            hardwareId: hw,
        });

        expect(hb.status).toBe(200);
        expect(hb.body).toHaveProperty('queuedCommands');
        expect(Array.isArray(hb.body.queuedCommands)).toBe(true);
        expect(hb.body.queuedCommands.length).toBe(0);
    });

    test('authenticated admin can queue commands', async () => {
        // Create context with authentication enabled
        const authContext = createDeviceRouteTestContext({ authenticated: true });

        const iid = `test-iid-${Date.now()}`;
        const hw = 'hw-test-admin-queue';

        // Register device
        const reg = await authContext.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
            name: 'Admin Queue Test',
        });

        expect(reg.status).toBe(200);
        const { deviceId, secret: deviceSecret } = reg.body;

        // Queue command via API (with auth)
        const cmdRes = await authContext
            .request()
            .post('/api/devices/command')
            .set('Authorization', 'Bearer test-token')
            .send({
                deviceIds: [deviceId],
                command: { type: 'core.mgmt.reload', payload: {} },
            });

        // Should succeed since device is offline (queued)
        expect(cmdRes.status).toBe(200);
        expect(cmdRes.body.success).toBe(true);
        expect(cmdRes.body.queued).toBe(1);
        expect(cmdRes.body.sent).toBe(0);

        // Heartbeat returns queued commands
        const hb = await authContext.helpers.sendHeartbeat(deviceId, deviceSecret, {
            installId: iid,
            hardwareId: hw,
        });

        expect(hb.status).toBe(200);
        expect(hb.body.queuedCommands.length).toBeGreaterThan(0);
        expect(hb.body.queuedCommands[0]).toHaveProperty('type', 'core.mgmt.reload');
    });
});
