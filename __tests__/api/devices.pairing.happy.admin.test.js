const request = require('supertest');

describe('Devices Pairing Happy Path', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.DEVICE_MGMT_ENABLED = 'true';
        process.env.API_ACCESS_TOKEN = 'test-token';
        // Isolate device store per test to avoid coverage-run interference
        // Add extra randomness and timestamp to prevent race conditions in parallel runs
        const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.${performance.now()}`;
        process.env.DEVICES_STORE_PATH = `devices.test.${unique}.pair.json`;
    });

    test('admin generates code and device claims with token -> rotated secret', async () => {
        const app = require('../../server');

        // Add extra delay to prevent race conditions
        await new Promise(r => setTimeout(r, 50));

        // Register a device to pair with more robust retry logic
        let reg;
        let lastError;
        const maxRetries = 5;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                reg = await request(app)
                    .post('/api/devices/register')
                    .set('Content-Type', 'application/json')
                    .send({ installId: 'iid-pair-happy', hardwareId: 'hw-pair-happy' });

                if (reg.status === 200) {
                    break;
                }
                lastError = new Error(`Registration failed with status ${reg.status}: ${reg.text}`);
            } catch (error) {
                lastError = error;
            }

            if (attempt < maxRetries - 1) {
                await new Promise(r => setTimeout(r, 50 * (attempt + 1))); // Exponential backoff
            }
        }

        if (!reg || reg.status !== 200) {
            throw lastError || new Error('Registration failed after all retries');
        }

        const { deviceId, deviceSecret } = reg.body;
        // Increased delay to ensure fs writes are fully flushed before subsequent mutations
        await new Promise(r => setTimeout(r, 100));

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
    }, 15000); // 15 second timeout for CI environments
});
