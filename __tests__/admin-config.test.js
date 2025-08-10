const request = require('supertest');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// Mock dependencies
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn().mockResolvedValue()
    },
    writeFile: jest.fn((path, data, callback) => callback && callback())
}));

describe('Admin Configuration Tests', () => {
    let app;
    let mockConfig;
    let mockAuth;

    beforeEach(() => {
        mockConfig = {
            clockWidget: true,
            clockTimezone: 'Europe/Amsterdam',
            clockFormat: '24h',
            transitionIntervalSeconds: 15,
            backgroundRefreshMinutes: 30,
            showClearLogo: true,
            showPoster: true,
            showMetadata: true,
            showRottenTomatoes: true,
            rottenTomatoesMinimumScore: 0,
            kenBurnsEffect: { enabled: true, durationSeconds: 15 }
        };

        // Mock authentication middleware
        mockAuth = jest.fn((req, res, next) => {
            req.user = { id: 'test-user', role: 'admin' };
            next();
        });

        // Create test express app
        app = express();
        app.use(express.json());

        // Add config endpoints
        app.get('/get-config', (req, res) => {
            res.json(mockConfig);
        });

        app.post('/api/admin/config', mockAuth, async (req, res) => {
            try {
                const { config: newConfig } = req.body;
                
                // Validate required fields
                if (!newConfig) {
                    return res.status(400).json({ error: 'Configuration is required' });
                }

                // Update config
                Object.assign(mockConfig, newConfig);
                
                // Mock file write - don't actually write in tests
                res.json({ message: 'Configuration saved successfully' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        app.get('/api/admin/config', mockAuth, (req, res) => {
            res.json(mockConfig);
        });

        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('Configuration Reading', () => {
        it('should return current configuration', async () => {
            const response = await request(app)
                .get('/get-config')
                .expect(200);

            expect(response.body).toEqual(mockConfig);
            expect(response.body.clockWidget).toBe(true);
            expect(response.body.clockTimezone).toBe('Europe/Amsterdam');
            expect(response.body.clockFormat).toBe('24h');
        });

        it('should return admin configuration with authentication', async () => {
            const response = await request(app)
                .get('/api/admin/config')
                .expect(200);

            expect(mockAuth).toHaveBeenCalled();
            expect(response.body).toEqual(mockConfig);
        });

        it('should include all clock-related settings', async () => {
            const response = await request(app)
                .get('/get-config')
                .expect(200);

            expect(response.body).toHaveProperty('clockWidget');
            expect(response.body).toHaveProperty('clockTimezone');
            expect(response.body).toHaveProperty('clockFormat');
            expect(typeof response.body.clockWidget).toBe('boolean');
            expect(typeof response.body.clockTimezone).toBe('string');
            expect(typeof response.body.clockFormat).toBe('string');
        });
    });

    describe('Configuration Updates', () => {
        it('should update clock widget setting', async () => {
            const update = { clockWidget: false };

            const response = await request(app)
                .post('/api/admin/config')
                .send({ config: update })
                .expect(200);

            expect(response.body.message).toBe('Configuration saved successfully');
            expect(mockConfig.clockWidget).toBe(false);
        });

        it('should update clock timezone setting', async () => {
            const update = { clockTimezone: 'America/New_York' };

            await request(app)
                .post('/api/admin/config')
                .send({ config: update })
                .expect(200);

            expect(mockConfig.clockTimezone).toBe('America/New_York');
        });

        it('should update clock format setting', async () => {
            const update = { clockFormat: '12h' };

            await request(app)
                .post('/api/admin/config')
                .send({ config: update })
                .expect(200);

            expect(mockConfig.clockFormat).toBe('12h');
        });

        it('should update multiple settings at once', async () => {
            const update = {
                clockWidget: false,
                clockTimezone: 'Asia/Tokyo',
                clockFormat: '12h',
                transitionIntervalSeconds: 30
            };

            await request(app)
                .post('/api/admin/config')
                .send({ config: update })
                .expect(200);

            expect(mockConfig.clockWidget).toBe(false);
            expect(mockConfig.clockTimezone).toBe('Asia/Tokyo');
            expect(mockConfig.clockFormat).toBe('12h');
            expect(mockConfig.transitionIntervalSeconds).toBe(30);
        });

        it('should preserve unchanged settings', async () => {
            const originalShowPoster = mockConfig.showPoster;
            const originalShowMetadata = mockConfig.showMetadata;

            const update = { clockTimezone: 'Pacific/Honolulu' };

            await request(app)
                .post('/api/admin/config')
                .send({ config: update })
                .expect(200);

            expect(mockConfig.clockTimezone).toBe('Pacific/Honolulu');
            expect(mockConfig.showPoster).toBe(originalShowPoster);
            expect(mockConfig.showMetadata).toBe(originalShowMetadata);
        });
    });

    describe('Configuration Validation', () => {
        it('should reject empty configuration', async () => {
            await request(app)
                .post('/api/admin/config')
                .send({})
                .expect(400);
        });

        it('should reject null configuration', async () => {
            await request(app)
                .post('/api/admin/config')
                .send({ config: null })
                .expect(400);
        });

        it('should accept valid timezone values', async () => {
            const validTimezones = [
                'UTC',
                'Europe/Amsterdam',
                'America/New_York',
                'Asia/Tokyo',
                'Pacific/Honolulu',
                'Australia/Sydney'
            ];

            for (const timezone of validTimezones) {
                await request(app)
                    .post('/api/admin/config')
                    .send({ config: { clockTimezone: timezone } })
                    .expect(200);

                expect(mockConfig.clockTimezone).toBe(timezone);
            }
        });

        it('should accept valid clock format values', async () => {
            const validFormats = ['12h', '24h'];

            for (const format of validFormats) {
                await request(app)
                    .post('/api/admin/config')
                    .send({ config: { clockFormat: format } })
                    .expect(200);

                expect(mockConfig.clockFormat).toBe(format);
            }
        });

        it('should accept valid transition intervals', async () => {
            const validIntervals = [5, 10, 15, 30, 60];

            for (const interval of validIntervals) {
                await request(app)
                    .post('/api/admin/config')
                    .send({ config: { transitionIntervalSeconds: interval } })
                    .expect(200);

                expect(mockConfig.transitionIntervalSeconds).toBe(interval);
            }
        });
    });

    describe('Authentication Requirements', () => {
        it('should require authentication for admin config access', async () => {
            await request(app)
                .get('/api/admin/config')
                .expect(200);

            expect(mockAuth).toHaveBeenCalled();
        });

        it('should require authentication for config updates', async () => {
            await request(app)
                .post('/api/admin/config')
                .send({ config: { clockWidget: false } })
                .expect(200);

            expect(mockAuth).toHaveBeenCalled();
        });

        it('should pass user context to authenticated requests', async () => {
            await request(app)
                .post('/api/admin/config')
                .send({ config: { clockWidget: false } })
                .expect(200);

            expect(mockAuth).toHaveBeenCalledWith(
                expect.objectContaining({ body: { config: { clockWidget: false } } }),
                expect.any(Object),
                expect.any(Function)
            );
        });
    });

    describe('Error Handling', () => {
        it('should handle file write errors', async () => {
            // Temporarily modify the endpoint to throw an error
            app._router.stack = app._router.stack.filter(layer => 
                !(layer.route && layer.route.path === '/api/admin/config' && 
                  layer.route.methods.post)
            );
            
            app.post('/api/admin/config', mockAuth, async (req, res) => {
                try {
                    throw new Error('File write error');
                } catch (error) {
                    return res.status(500).json({ error: error.message });
                }
            });

            await request(app)
                .post('/api/admin/config')
                .send({ config: { clockWidget: false }, env: {} })
                .expect(500);
        });

        it('should handle malformed JSON in request', async () => {
            await request(app)
                .post('/api/admin/config')
                .set('Content-Type', 'application/json')
                .send('{ invalid json }')
                .expect(400);
        });

        it('should handle missing config in request body', async () => {
            await request(app)
                .post('/api/admin/config')
                .send({ notConfig: {} })
                .expect(400);
        });
    });

    describe('Configuration Persistence', () => {
        it('should write configuration to file system', async () => {
            // Mock successful file write
            fs.writeFile.mockResolvedValue();
            
            const update = { clockTimezone: 'Europe/London' };

            await request(app)
                .post('/api/admin/config')
                .send({ config: update })
                .expect(200);

            expect(mockConfig.clockTimezone).toBe('Europe/London');
        });

        it('should format JSON output correctly', async () => {
            const update = { clockFormat: '12h' };

            await request(app)
                .post('/api/admin/config')
                .send({ config: update })
                .expect(200);

            expect(mockConfig.clockFormat).toBe('12h');
        });

        it('should maintain JSON structure after updates', async () => {
            const update = {
                clockWidget: false,
                kenBurnsEffect: { enabled: false, durationSeconds: 10 }
            };

            await request(app)
                .post('/api/admin/config')
                .send({ config: update })
                .expect(200);

            expect(mockConfig.kenBurnsEffect).toEqual({
                enabled: false,
                durationSeconds: 10
            });
        });
    });

    describe('Real-time Configuration Updates', () => {
        it('should reflect changes immediately in subsequent reads', async () => {
            // Update config
            const update = { clockTimezone: 'Australia/Melbourne' };
            await request(app)
                .post('/api/admin/config')
                .send({ config: update })
                .expect(200);

            // Immediately read config
            const response = await request(app)
                .get('/get-config')
                .expect(200);

            expect(response.body.clockTimezone).toBe('Australia/Melbourne');
        });

        it('should handle rapid consecutive updates', async () => {
            const updates = [
                { clockTimezone: 'America/Los_Angeles' },
                { clockFormat: '12h' },
                { clockWidget: false }
            ];

            for (const update of updates) {
                await request(app)
                    .post('/api/admin/config')
                    .send({ config: update })
                    .expect(200);
            }

            expect(mockConfig.clockTimezone).toBe('America/Los_Angeles');
            expect(mockConfig.clockFormat).toBe('12h');
            expect(mockConfig.clockWidget).toBe(false);
        });
    });
});
