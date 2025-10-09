const request = require('supertest');

describe('Devices Pairing Happy Path', () => {
    let app;

    beforeAll(async () => {
        // Initialize app once for all tests to reduce module loading race conditions
        process.env.NODE_ENV = 'test';
        process.env.DEVICE_MGMT_ENABLED = 'true';
        process.env.API_ACCESS_TOKEN = 'test-token';

        // Clear any cached modules
        jest.resetModules();

        // Wait a bit to ensure clean state
        await new Promise(r => setTimeout(r, 100));
    });

    beforeEach(async () => {
        // Isolate device store per test to avoid coverage-run interference
        // Add extra randomness and timestamp to prevent race conditions in parallel runs
        const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.${performance.now()}`;
        process.env.DEVICES_STORE_PATH = `devices.test.${unique}.pair.json`;

        // Ensure fresh app instance for each test
        jest.resetModules();
        app = require('../../server');

        // Add stabilization delay
        await new Promise(r => setTimeout(r, 100));
    });

    test('admin generates code and device claims with token -> rotated secret', async () => {
        // Ensure app is available
        if (!app) {
            app = require('../../server');
        }

        // Add extra stabilization delay
        await new Promise(r => setTimeout(r, 200));

        // Register a device to pair with more robust retry logic
        let reg;
        let lastError;
        const maxRetries = 10; // Increased retries

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Add delay before each attempt
                if (attempt > 0) {
                    await new Promise(r => setTimeout(r, 100 * attempt)); // Progressive backoff
                }

                reg = await request(app)
                    .post('/api/devices/register')
                    .set('Content-Type', 'application/json')
                    .send({ installId: 'iid-pair-happy', hardwareId: 'hw-pair-happy' });

                if (reg.status === 200 && reg.body && reg.body.deviceId) {
                    break;
                }
                lastError = new Error(
                    `Registration failed with status ${reg.status}: ${reg.text || 'No response body'}`
                );
            } catch (error) {
                lastError = error;
                console.warn(`Device registration attempt ${attempt + 1} failed:`, error.message);
            }
        }

        if (!reg || reg.status !== 200 || !reg.body || !reg.body.deviceId) {
            throw (
                lastError ||
                new Error('Registration failed after all retries - no valid response received')
            );
        }

        const { deviceId, deviceSecret } = reg.body;

        // Ensure we have valid data
        expect(deviceId).toBeTruthy();
        expect(deviceSecret).toBeTruthy();

        // Extended delay to ensure fs writes are fully flushed
        await new Promise(r => setTimeout(r, 200));

        // Admin generates pairing code
        const gen = await request(app)
            .post(`/api/devices/${encodeURIComponent(deviceId)}/pairing-code`)
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send({ ttlMs: 120000 })
            .expect(200);
        expect(gen.body).toHaveProperty('code');
        expect(gen.body).toHaveProperty('token');
        expect(gen.body).toHaveProperty('expiresAt');

        // Device claims with code + token
        const claim = await request(app)
            .post('/api/devices/pair')
            .set('Content-Type', 'application/json')
            .send({ code: gen.body.code, token: gen.body.token, name: 'Paired', location: 'Lab' })
            .expect(200);
        expect(claim.body.deviceId).toBe(deviceId);
        expect(claim.body.deviceSecret).toBeTruthy();
        expect(claim.body.deviceSecret).not.toBe(deviceSecret); // rotated

        // Heartbeat should accept new secret
        await request(app)
            .post('/api/devices/heartbeat')
            .set('Content-Type', 'application/json')
            .send({
                deviceId,
                deviceSecret: claim.body.deviceSecret,
                installId: 'iid-pair-happy',
                hardwareId: 'hw-pair-happy',
                userAgent: 'jest',
                screen: { w: 1280, h: 720, dpr: 1 },
                mode: 'screensaver',
            })
            .expect(200);
    }); // Use global Jest timeout
});
