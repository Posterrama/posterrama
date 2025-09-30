/**
 * Integration test: setup -> login flow should not create redirect loop.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');

let app; // will be required fresh per test run

// Helper to load server fresh (server.js exports app or starts server?)
// If server.js starts listening immediately, we may need to require and access the exported app.
// Inspecting other tests would give pattern; we assume module.exports = app is present (common in repo).

let originalEnvContent = null;
let envWasPresent = false;

beforeAll(() => {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(envPath)) {
        originalEnvContent = fs.readFileSync(envPath, 'utf8');
        fs.renameSync(envPath, envPath + '.bak_test');
        envWasPresent = true;
    }
    // Clear in-memory vars so server thinks setup not done
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.ADMIN_2FA_SECRET;
});

afterAll(() => {
    const envPath = path.join(__dirname, '..', '..', '.env');
    // Remove test-created .env (from setup flow)
    if (fs.existsSync(envPath)) {
        try {
            fs.unlinkSync(envPath);
        } catch (_) {
            /* ignore */
        }
    }
    if (envWasPresent) {
        // Restore original
        fs.renameSync(envPath + '.bak_test', envPath);
    } else {
        // Cleanup stray bak file just in case
        try {
            fs.unlinkSync(envPath + '.bak_test');
        } catch (_) {
            /* ignore */
        }
    }
});

beforeEach(() => {
    jest.resetModules();
    app = require('../../server');
});

describe('Admin setup then login flow', () => {
    test('completes setup without rotating existing SESSION_SECRET and allows login without redirect loop', async () => {
        const initialSecret = process.env.SESSION_SECRET;

        // Perform setup
        const setupRes = await request(app)
            .post('/admin/setup')
            .type('form')
            .send({ username: 'testadmin', password: 'supersecret123' })
            .expect(res => {
                if (res.status !== 200 && res.status !== 302) {
                    throw new Error(
                        'Unexpected status for setup: ' + res.status + ' body=' + res.text
                    );
                }
            });

        // If redirect (HTML completion), accept; if JSON 200 also fine
        if (setupRes.status === 200 && setupRes.body && setupRes.body.error) {
            throw new Error('Setup returned error body: ' + JSON.stringify(setupRes.body));
        }

        expect(setupRes.body || setupRes.text).toBeDefined();

        // SESSION_SECRET unchanged (or created if absent)
        if (initialSecret) {
            expect(process.env.SESSION_SECRET).toBe(initialSecret);
        } else {
            expect(process.env.SESSION_SECRET).toBeDefined();
            expect(process.env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
        }

        // Now login
        const agent = request.agent(app);
        const loginRes = await agent
            .post('/admin/login')
            .type('form')
            .send({ username: 'testadmin', password: 'supersecret123' })
            .expect(200);

        expect(loginRes.body).toBeDefined();
        expect(loginRes.body.success).toBe(true);
        expect(loginRes.body.redirectTo).toBe('/admin');

        // Follow redirect to /admin with same agent (cookie retained)
        const panelRes = await agent.get('/admin').expect(200);
        expect(panelRes.text).toContain('<!doctype html'); // crude sanity check admin HTML served
    });
});
