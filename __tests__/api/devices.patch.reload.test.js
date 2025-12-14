const { createDeviceRouteTestContext } = require('../test-utils/route-test-helpers');

describe('Device PATCH triggers reload (Isolated)', () => {
    test('changing profileId sends live reload when connected', async () => {
        const context = createDeviceRouteTestContext({ authenticated: true, isDebug: true });

        const reg = await context.helpers.registerDevice({
            installId: `iid-prof-live-${Date.now()}`,
            hardwareId: `hw-prof-live-${Date.now()}`,
        });
        expect(reg.status).toBe(200);

        const deviceId = reg.body.deviceId;
        const mockWs = { send: jest.fn(), readyState: 1 };
        context.mocks.wsHub.addConnection(deviceId, mockWs);

        const resp = await context
            .request()
            .patch(`/api/devices/${encodeURIComponent(deviceId)}`)
            .send({ profileId: 'profile-1' });

        expect(resp.status).toBe(200);

        // Live reload => WS send invoked and no queued commands.
        expect(mockWs.send).toHaveBeenCalledTimes(1);
        expect(mockWs.send.mock.calls[0][0]).toContain('core.mgmt.reload');
        const queued = await context.mocks.deviceStore.dequeueCommands(deviceId);
        expect(queued.length).toBe(0);
    });

    test('changing profileId queues reload when offline', async () => {
        const context = createDeviceRouteTestContext({ authenticated: true });

        const reg = await context.helpers.registerDevice({
            installId: `iid-prof-queue-${Date.now()}`,
            hardwareId: `hw-prof-queue-${Date.now()}`,
        });
        expect(reg.status).toBe(200);
        const deviceId = reg.body.deviceId;

        const sendSpy = jest.spyOn(context.mocks.wsHub, 'sendCommand');

        const resp = await context
            .request()
            .patch(`/api/devices/${encodeURIComponent(deviceId)}`)
            .send({ profileId: 'profile-2' });

        expect(resp.status).toBe(200);
        expect(sendSpy).not.toHaveBeenCalled();

        const queued = await context.mocks.deviceStore.dequeueCommands(deviceId);
        expect(queued.length).toBe(1);
        expect(queued[0].type).toBe('core.mgmt.reload');
    });

    test('clearing settingsOverride queues reload when override existed', async () => {
        const context = createDeviceRouteTestContext({ authenticated: true });

        const reg = await context.helpers.registerDevice({
            installId: `iid-ovr-clear-${Date.now()}`,
            hardwareId: `hw-ovr-clear-${Date.now()}`,
        });
        expect(reg.status).toBe(200);
        const deviceId = reg.body.deviceId;

        // Seed an override so "clear" is a real change.
        await context.mocks.deviceStore.patchDevice(deviceId, {
            settingsOverride: { cinema: { enabled: true } },
        });

        const resp = await context
            .request()
            .patch(`/api/devices/${encodeURIComponent(deviceId)}`)
            .send({ settingsOverride: {} });

        expect(resp.status).toBe(200);

        const queued = await context.mocks.deviceStore.dequeueCommands(deviceId);
        expect(queued.length).toBe(1);
        expect(queued[0].type).toBe('core.mgmt.reload');
    });

    test('updating settingsOverride (non-empty) does not auto-reload', async () => {
        const context = createDeviceRouteTestContext({ authenticated: true });

        const reg = await context.helpers.registerDevice({
            installId: `iid-ovr-set-${Date.now()}`,
            hardwareId: `hw-ovr-set-${Date.now()}`,
        });
        expect(reg.status).toBe(200);
        const deviceId = reg.body.deviceId;

        const resp = await context
            .request()
            .patch(`/api/devices/${encodeURIComponent(deviceId)}`)
            .send({ settingsOverride: { cinema: { posterRotationSeconds: 30 } } });

        expect(resp.status).toBe(200);

        const queued = await context.mocks.deviceStore.dequeueCommands(deviceId);
        expect(queued.length).toBe(0);
    });
});
