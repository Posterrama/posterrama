/**
 * Device Pairing Happy Path Tests
 *
 * REFACTORED: Uses isolated route testing instead of full server loading
 * - Eliminates timing/race conditions from server startup
 * - No more file-based device store conflicts
 * - Faster and more reliable test execution
 */

const { createDeviceRouteTestContext } = require('../test-utils/route-test-helpers');

describe('Devices Pairing Happy Path (Isolated)', () => {
    let context;

    beforeEach(() => {
        // Create fresh isolated test context with authentication enabled
        context = createDeviceRouteTestContext({ authenticated: true });
    });

    test('admin generates code and device claims with token -> rotated secret', async () => {
        const iid = `iid-pair-happy-${Date.now()}`;
        const hw = `hw-pair-happy-${Date.now()}`;

        // Register a device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
            name: 'Pairing Test Device',
        });

        expect(reg.status).toBe(200);
        expect(reg.body.deviceId).toBeTruthy();
        expect(reg.body.secret).toBeTruthy();

        const { deviceId, secret: deviceSecret } = reg.body;

        // Admin generates pairing code
        const gen = await context.helpers.generatePairingCode(deviceId);

        expect(gen.status).toBe(200);
        expect(gen.body).toHaveProperty('code');
        expect(gen.body).toHaveProperty('token');
        expect(gen.body).toHaveProperty('expiresAt');

        const { code, token } = gen.body;

        // Device claims with code + token
        const claim = await context.helpers.claimPairing(code, token);

        expect(claim.status).toBe(200);
        expect(claim.body).toHaveProperty('deviceId', deviceId);
        expect(claim.body).toHaveProperty('secret');
        expect(claim.body.secret).not.toBe(deviceSecret); // Secret should be rotated

        const newSecret = claim.body.secret;

        // Old secret should no longer work
        const oldHb = await context.helpers.sendHeartbeat(deviceId, deviceSecret, {
            installId: iid,
            hardwareId: hw,
        });
        expect(oldHb.status).toBe(401); // Unauthorized

        // New secret should work
        const newHb = await context.helpers.sendHeartbeat(deviceId, newSecret, {
            installId: iid,
            hardwareId: hw,
        });
        expect(newHb.status).toBe(200);
        expect(newHb.body).toHaveProperty('queuedCommands');
    });

    test('pairing code expires after TTL', async () => {
        const iid = `iid-expire-test-${Date.now()}`;
        const hw = `hw-expire-test-${Date.now()}`;

        // Register device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
        });

        expect(reg.status).toBe(200);
        const { deviceId } = reg.body;

        // Generate pairing code with short TTL
        const gen = await context.helpers.generatePairingCode(deviceId, 100);

        expect(gen.status).toBe(200);
        const { code, token } = gen.body;

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 150));

        // Claim should fail
        const claim = await context.helpers.claimPairing(code, token);
        expect(claim.status).toBe(400);
    });

    test('pairing code cannot be claimed twice', async () => {
        const iid = `iid-double-claim-${Date.now()}`;
        const hw = `hw-double-claim-${Date.now()}`;

        // Register device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
        });

        expect(reg.status).toBe(200);
        const { deviceId } = reg.body;

        // Generate pairing code
        const gen = await context.helpers.generatePairingCode(deviceId);
        expect(gen.status).toBe(200);

        const { code, token } = gen.body;

        // First claim succeeds
        const claim1 = await context.helpers.claimPairing(code, token);
        expect(claim1.status).toBe(200);

        // Second claim fails
        const claim2 = await context.helpers.claimPairing(code, token);
        expect(claim2.status).toBe(400);
    });

    test('pairing requires valid token', async () => {
        const iid = `iid-token-test-${Date.now()}`;
        const hw = `hw-token-test-${Date.now()}`;

        // Register device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
        });

        expect(reg.status).toBe(200);
        const { deviceId } = reg.body;

        // Generate pairing code
        const gen = await context.helpers.generatePairingCode(deviceId);
        expect(gen.status).toBe(200);

        const { code } = gen.body;

        // Claim with wrong token fails
        const claim = await context.helpers.claimPairing(code, 'wrong-token');
        expect(claim.status).toBe(400);
    });

    test('pairing updates device isPaired status', async () => {
        const iid = `iid-paired-status-${Date.now()}`;
        const hw = `hw-paired-status-${Date.now()}`;

        // Register device
        const reg = await context.helpers.registerDevice({
            installId: iid,
            hardwareId: hw,
        });

        expect(reg.status).toBe(200);
        const { deviceId } = reg.body;

        // Check device is not paired initially
        let device = await context.mocks.deviceStore.getDevice(deviceId);
        expect(device.isPaired).toBe(false);

        // Generate and claim pairing code
        const gen = await context.helpers.generatePairingCode(deviceId);
        expect(gen.status).toBe(200);

        const { code, token } = gen.body;

        await context.helpers.claimPairing(code, token);

        // Check device is now paired
        device = await context.mocks.deviceStore.getDevice(deviceId);
        expect(device.isPaired).toBe(true);
    });
});
