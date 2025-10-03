/**
 * Critical Path E2E Regression Tests
 *
 * Deze tests valideren de complete user journeys om te voorkomen
 * dat wijzigingen de hoofdfunctionaliteit breken.
 */

const request = require('supertest');
// const WebSocket = require('ws');  // TODO: Add WebSocket tests later
// const { spawn } = require('child_process');  // TODO: Add process spawn tests later

let app;
let server;
let baseUrl;

/**
 * Critical Path Test Runner
 * Test complete workflows van start tot eind
 */
class CriticalPathTester {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.results = [];
    }

    async runCriticalPath(name, testFunction) {
        console.log(`🧪 Running critical path: ${name}`);
        const startTime = Date.now();

        try {
            await testFunction();
            const duration = Date.now() - startTime;
            this.results.push({ name, status: 'PASS', duration });
            console.log(`✅ ${name} completed in ${duration}ms`);
        } catch (error) {
            const duration = Date.now() - startTime;
            this.results.push({ name, status: 'FAIL', duration, error: error.message });
            console.log(`❌ ${name} failed after ${duration}ms: ${error.message}`);
            throw error;
        }
    }

    printResults() {
        console.log('\n📊 Critical Path Test Results:');
        this.results.forEach(result => {
            const status = result.status === 'PASS' ? '✅' : '❌';
            console.log(`${status} ${result.name}: ${result.duration}ms`);
            if (result.error) {
                console.log(`   Error: ${result.error}`);
            }
        });
    }
}

describe('Critical Path E2E Regression Tests', () => {
    let pathTester;

    beforeAll(async () => {
        // Start server voor E2E tests
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.API_ACCESS_TOKEN = 'test-token-regression';

        const uniquePort = 12000 + Math.floor(Math.random() * 1000);
        process.env.SERVER_PORT = uniquePort.toString();
        baseUrl = `http://localhost:${uniquePort}`;

        app = require('../../server');
        server = app.listen(uniquePort);

        pathTester = new CriticalPathTester(baseUrl);

        // Wacht tot server ready is
        await new Promise(resolve => setTimeout(resolve, 2000));
    }, 30000);

    afterAll(async () => {
        if (server) {
            server.close();
        }
        pathTester?.printResults();
    });

    describe('Media Display Critical Path', () => {
        test('Complete media display workflow should work', async () => {
            await pathTester.runCriticalPath('Media Display Workflow', async () => {
                // Stap 1: Haal configuratie op
                const configRes = await request(app).get('/get-config').expect(200);

                expect(configRes.body).toHaveProperty('wallartMode');

                // Stap 2: Haal media data op
                const mediaRes = await request(app).get('/get-media').timeout(10000);

                expect([200, 202, 503]).toContain(mediaRes.status);

                // Stap 3: Test image proxy (als er media is)
                if (mediaRes.status === 200 && mediaRes.body.length > 0) {
                    const firstItem = mediaRes.body[0];
                    if (firstItem.poster) {
                        const imageRes = await request(app)
                            .get(`/image?url=${encodeURIComponent(firstItem.poster)}`)
                            .timeout(5000);

                        expect([200, 302, 404]).toContain(imageRes.status);
                    }
                }
            });
        }, 30000);
    });

    describe('Admin Configuration Critical Path', () => {
        test('Complete admin workflow should work', async () => {
            await pathTester.runCriticalPath('Admin Configuration Workflow', async () => {
                const adminHeaders = { 'X-API-Token': 'test-token-regression' };

                // Stap 1: Haal huidige config op
                const currentConfigRes = await request(app)
                    .get('/api/config')
                    .set(adminHeaders)
                    .expect(200);

                expect(currentConfigRes.body).toBeDefined();
                const originalConfig = currentConfigRes.body;

                // Stap 2: Update een veilige config waarde
                const testUpdate = {
                    ...originalConfig,
                    clockWidget: !originalConfig.clockWidget, // Toggle boolean
                };

                await request(app)
                    .post('/api/config')
                    .set(adminHeaders)
                    .send(testUpdate)
                    .expect(200);

                // Stap 3: Verify dat wijziging is doorgevoerd
                const verifyRes = await request(app)
                    .get('/api/config')
                    .set(adminHeaders)
                    .expect(200);

                expect(verifyRes.body.clockWidget).toBe(testUpdate.clockWidget);

                // Stap 4: Restore originele config
                await request(app)
                    .post('/api/config')
                    .set(adminHeaders)
                    .send(originalConfig)
                    .expect(200);
            });
        }, 15000);
    });

    describe('Device Pairing Critical Path', () => {
        test('Device pairing workflow should work', async () => {
            await pathTester.runCriticalPath('Device Pairing Workflow', async () => {
                // Stap 1: Genereer pairing QR
                const qrRes = await request(app).get('/devices/qr').expect(200);

                expect(qrRes.headers['content-type']).toMatch(/image/);

                // Stap 2: Haal device list op (admin)
                const devicesRes = await request(app)
                    .get('/api/devices')
                    .set({ 'X-API-Token': 'test-token-regression' })
                    .expect(200);

                expect(Array.isArray(devicesRes.body)).toBe(true);
            });
        }, 10000);
    });

    describe('Health & Monitoring Critical Path', () => {
        test('Monitoring endpoints should work', async () => {
            await pathTester.runCriticalPath('Monitoring Workflow', async () => {
                // Stap 1: Health check
                const healthRes = await request(app).get('/health').expect(200);

                expect(healthRes.body).toHaveProperty('status');
                expect(healthRes.body).toHaveProperty('timestamp');

                // Stap 2: Media sources status
                const sourcesRes = await request(app)
                    .get('/api/media-sources')
                    .set({ 'X-API-Token': 'test-token-regression' });

                expect([200, 401]).toContain(sourcesRes.status);

                // Stap 3: API Documentation toegankelijk
                const docsRes = await request(app).get('/api-docs/').expect(200);

                expect(docsRes.text).toContain('Posterrama');
            });
        }, 8000);
    });
});

describe('Performance Regression Baselines', () => {
    const performanceBaselines = {
        serverStartup: 5000, // Server moet binnen 5s opstarten
        configLoad: 100, // Config laden binnen 100ms
        mediaQuery: 3000, // Media query binnen 3s
        imageProxy: 2000, // Image proxy binnen 2s
    };

    test('Server startup time regression', async () => {
        // Deze test meet hoe lang het duurt om een verse server instance te starten
        const startTime = Date.now();

        // Simuleer fresh start door modules te resetten
        jest.resetModules();
        delete require.cache[require.resolve('../../server')];

        // Laad server opnieuw
        require('../../server');

        const startupTime = Date.now() - startTime;
        console.log(
            `📊 Server startup time: ${startupTime}ms (baseline: ${performanceBaselines.serverStartup}ms)`
        );

        // Waarschuw als startup tijd toeneemt
        if (startupTime > performanceBaselines.serverStartup) {
            console.warn(
                `⚠️  STARTUP REGRESSION: Server took ${startupTime}ms to start (expected < ${performanceBaselines.serverStartup}ms)`
            );
        }
    });

    test('Memory usage baseline', async () => {
        const initialMemory = process.memoryUsage();

        // Simuleer typical werkload
        for (let i = 0; i < 10; i++) {
            await request(app).get('/get-config');
            await request(app).get('/health');
        }

        const finalMemory = process.memoryUsage();
        const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

        console.log(
            `📊 Memory increase after 20 requests: ${Math.round((memoryIncrease / 1024 / 1024) * 100) / 100}MB`
        );

        // Waarschuw bij grote memory increases (mogelijk memory leak)
        if (memoryIncrease > 50 * 1024 * 1024) {
            // 50MB
            console.warn(
                `⚠️  MEMORY REGRESSION: Memory increased by ${Math.round(memoryIncrease / 1024 / 1024)}MB`
            );
        }
    });
});
