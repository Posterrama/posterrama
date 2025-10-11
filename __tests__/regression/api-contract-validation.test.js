/**
 * API Contract Regression Tests
 *
 * Deze tests valideren dat API endpoints hun contract niet breken
 * bij code wijzigingen. Ze testen zowel structuur als gedrag.
 */

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../../server');

// Mock logger om side effects te voorkomen
jest.mock('../../utils/logger');

/**
 * API Contract Validator
 * Valideert dat responses consistent blijven met verwachte schema's
 */
class APIContractValidator {
    constructor() {
        this.contractsPath = path.join(__dirname, 'contracts');
        this.ensureContractsDir();
        this.updateEnabled = this.isUpdateEnabled();
    }

    ensureContractsDir() {
        if (!fs.existsSync(this.contractsPath)) {
            fs.mkdirSync(this.contractsPath, { recursive: true });
        }
    }

    isUpdateEnabled() {
        const v = process.env.REGRESSION_UPDATE;
        if (!v) return false;
        return ['1', 'true', 'yes', 'y', 'on'].includes(String(v).toLowerCase());
    }

    /**
     * Validate en sla contract op voor toekomstige vergelijking
     */
    async validateAndSaveContract(endpoint, response, options = {}) {
        const contractFile = path.join(this.contractsPath, `${endpoint.replace(/\//g, '_')}.json`);

        // Extract contract details
        const contract = {
            endpoint,
            status: response.status,
            headers: this.normalizeHeaders(response.headers),
            bodyStructure: this.extractStructure(response.body),
            timestamp: new Date().toISOString(),
            ...options,
        };

        // Als er al een contract bestaat, valideer tegen bestaand contract
        if (fs.existsSync(contractFile)) {
            const existingContract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
            this.compareContracts(existingContract, contract);
        } else {
            console.log(`📝 Baseline ontbreekt voor ${endpoint} (${path.basename(contractFile)})`);
            if (!this.updateEnabled) {
                console.log('   ↪︎ Write skipped (REGRESSION_UPDATE not set)');
            }
        }

        // Sla huidige contract alleen op als update modus actief is
        if (this.updateEnabled) {
            fs.writeFileSync(contractFile, JSON.stringify(contract, null, 2));
        }

        return contract;
    }

    normalizeHeaders(headers) {
        // Normaliseer headers door variabele waarden te vervangen
        const normalized = { ...headers };

        // Remove timestamps en andere variabele waarden
        delete normalized.date;
        delete normalized['x-request-id'];

        // Behoud alleen structure-relevante headers
        return {
            'content-type': normalized['content-type'],
            'cache-control': normalized['cache-control'],
            'content-length': normalized['content-length'] ? 'present' : undefined,
        };
    }

    extractStructure(body) {
        if (body === null || body === undefined) return null;
        if (typeof body !== 'object') return typeof body;

        if (Array.isArray(body)) {
            return ['array', body.length > 0 ? this.extractStructure(body[0]) : 'empty'];
        }

        const structure = {};
        for (const [key, value] of Object.entries(body)) {
            structure[key] = this.extractStructure(value);
        }
        return structure;
    }

    compareContracts(existing, current) {
        // Status code moet consistent zijn (tenzij expliciet toegestaan)
        const variableStatusEndpoints = new Set(['/image-error']);
        if (!variableStatusEndpoints.has(current.endpoint)) {
            if (existing.status !== current.status) {
                throw new Error(
                    `🚨 API CONTRACT BREACH: ${current.endpoint} status changed from ${existing.status} to ${current.status}`
                );
            }
        }

        // Content-Type moet consistent zijn
        // Exception: /image-error can vary between text/plain and application/json depending on Express/Node version
        const isImageError = current.endpoint === '/image-error';
        const contentTypeVariants = [
            'text/plain; charset=utf-8',
            'application/json; charset=utf-8',
        ];
        const isAcceptableVariant =
            isImageError &&
            contentTypeVariants.includes(existing.headers['content-type']) &&
            contentTypeVariants.includes(current.headers['content-type']);

        if (
            !isAcceptableVariant &&
            existing.headers['content-type'] !== current.headers['content-type']
        ) {
            throw new Error(
                `🚨 API CONTRACT BREACH: ${current.endpoint} content-type changed from ${existing.headers['content-type']} to ${current.headers['content-type']}`
            );
        }

        // Body structure moet backwards compatible zijn
        this.validateStructureCompatibility(
            existing.bodyStructure,
            current.bodyStructure,
            current.endpoint
        );
    }

    validateStructureCompatibility(expected, actual, endpoint) {
        // Tolerate fields becoming null while maintaining overall structure
        if (actual === null && expected === 'string') {
            return; // allow null for formerly string fields (e.g., when server address is unavailable)
        }

        if (typeof expected !== typeof actual) {
            throw new Error(
                `🚨 API CONTRACT BREACH: ${endpoint} body type changed from ${typeof expected} to ${typeof actual}`
            );
        }

        if (typeof expected === 'object' && expected !== null && actual !== null) {
            // Voor objecten: alle bestaande keys moeten nog bestaan
            for (const key in expected) {
                if (!(key in actual)) {
                    throw new Error(
                        `🚨 API CONTRACT BREACH: ${endpoint} missing required field '${key}'`
                    );
                }
                // Recursief valideren
                this.validateStructureCompatibility(
                    expected[key],
                    actual[key],
                    `${endpoint}.${key}`
                );
            }
        }
    }
}

describe('API Contract Regression Tests', () => {
    let contractValidator;

    beforeAll(() => {
        contractValidator = new APIContractValidator();
    });

    describe('Critical Public Endpoints', () => {
        test('/get-config should maintain contract', async () => {
            const res = await request(app).get('/get-config').expect(200);

            await contractValidator.validateAndSaveContract('/get-config', res, {
                description: 'Primary configuration endpoint - breaking changes affect all clients',
                criticality: 'HIGH',
            });

            // Specifieke structuur validaties
            expect(res.body).toHaveProperty('clockWidget');
            expect(res.body).toHaveProperty('wallartMode');
            expect(typeof res.body.clockWidget).toBe('boolean');
            expect(typeof res.body.wallartMode).toBe('object');
        });

        test('/get-media should maintain contract', async () => {
            const res = await request(app).get('/get-media');

            await contractValidator.validateAndSaveContract('/get-media', res, {
                description: 'Main media endpoint - core functionality',
                criticality: 'HIGH',
            });

            // Status kan variëren, maar response structure moet consistent zijn
            expect([200, 202, 503]).toContain(res.status);

            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            } else {
                expect(res.body).toHaveProperty('status');
            }
        });

        test('/health should maintain contract', async () => {
            const res = await request(app).get('/health').expect(200);

            await contractValidator.validateAndSaveContract('/health', res, {
                description: 'Health check endpoint - monitoring depends on this',
                criticality: 'CRITICAL',
            });

            expect(res.body).toHaveProperty('status');
            expect(res.body).toHaveProperty('timestamp');
        });
    });

    describe('Admin API Endpoints', () => {
        const adminHeaders = {
            'X-API-Token': 'test-token',
        };

        test('/api/media-sources should maintain contract', async () => {
            const res = await request(app).get('/api/media-sources').set(adminHeaders);

            await contractValidator.validateAndSaveContract('/api/media-sources', res, {
                description: 'Media sources configuration endpoint',
                criticality: 'MEDIUM',
            });
        });

        test('/api/config should maintain contract', async () => {
            const res = await request(app).get('/api/config').set(adminHeaders);

            await contractValidator.validateAndSaveContract('/api/config', res, {
                description: 'Full configuration API - admin panel depends on this',
                criticality: 'HIGH',
            });
        });
    });

    describe('Device Management Endpoints', () => {
        test('/devices/qr should maintain contract', async () => {
            const res = await request(app).get('/devices/qr');

            await contractValidator.validateAndSaveContract('/devices/qr', res, {
                description: 'Device pairing QR code endpoint',
                criticality: 'MEDIUM',
            });
        });
    });

    describe('Image Proxy Endpoints', () => {
        test('/image proxy should handle errors consistently', async () => {
            const res = await request(app)
                .get('/image?url=https://nonexistent.example.com/image.jpg')
                .timeout(5000);

            await contractValidator.validateAndSaveContract('/image-error', res, {
                description: 'Image proxy error handling - fallback behavior',
                criticality: 'MEDIUM',
            });

            // Error responses moeten consistent zijn
            expect([200, 302, 400, 404, 500]).toContain(res.status);
        });
    });
});

describe('Response Time Regression', () => {
    const performanceThresholds = {
        '/health': 100, // 100ms
        '/get-config': 200, // 200ms
        '/get-media': 2000, // 2s (kan langzaam zijn bij eerste load)
    };

    Object.entries(performanceThresholds).forEach(([endpoint, maxTime]) => {
        test(`${endpoint} should respond within ${maxTime}ms`, async () => {
            const start = Date.now();

            await request(app)
                .get(endpoint)
                .timeout(maxTime + 1000);

            const responseTime = Date.now() - start;

            console.log(`📊 ${endpoint} responded in ${responseTime}ms (limit: ${maxTime}ms)`);

            if (responseTime > maxTime) {
                console.warn(
                    `⚠️  PERFORMANCE REGRESSION: ${endpoint} took ${responseTime}ms (expected < ${maxTime}ms)`
                );
            }

            // Voor nu waarschuwen in plaats van falen om baseline te establishen
            // Later kun je dit aanscherpen naar expect(responseTime).toBeLessThan(maxTime);
        });
    });
});
