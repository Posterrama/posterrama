/**
 * Route Modules Integration Tests
 * Tests extracted route modules work correctly in isolation
 * Uses the proven isolated testing pattern from device tests
 */

const express = require('express');
const request = require('supertest');
const path = require('path');
const fs = require('fs');

describe('Route Modules Integration Tests', () => {
    describe('Groups Module', () => {
        let app;
        let testGroupsFile;
        let groupsStore;

        beforeAll(() => {
            testGroupsFile = path.join(__dirname, '../../groups.route-test.json');

            // Import groupsStore
            groupsStore = require('../../utils/groupsStore');

            // Create test app
            app = express();
            app.use(express.json());

            // Mock dependencies
            const mockCacheManager = { clear: jest.fn() };
            const mockAuth = (req, res, next) => next();

            // Mount groups router
            const createGroupsRouter = require('../../routes/groups');
            const groupsRouter = createGroupsRouter({
                adminAuth: mockAuth,
                cacheManager: mockCacheManager,
            });
            app.use('/api/groups', groupsRouter);
        });

        afterEach(async () => {
            // Clean up groups
            const groups = await groupsStore.getAll();
            for (const group of groups) {
                try {
                    await groupsStore.deleteGroup(group.id);
                } catch (e) {
                    // ignore
                }
            }
        });

        afterAll(() => {
            if (fs.existsSync(testGroupsFile)) {
                fs.unlinkSync(testGroupsFile);
            }
        });

        it('should create and retrieve a group', async () => {
            // Create
            const createRes = await request(app)
                .post('/api/groups')
                .send({ id: 'test-1', name: 'Test Group' })
                .expect(201);

            expect(createRes.body.id).toBe('test-1');
            expect(createRes.body.name).toBe('Test Group');

            // Retrieve
            const getRes = await request(app).get('/api/groups').expect(200);
            expect(getRes.body.length).toBeGreaterThan(0);
            expect(getRes.body.find(g => g.id === 'test-1')).toBeDefined();
        });

        it('should update a group', async () => {
            // Create
            await request(app)
                .post('/api/groups')
                .send({ id: 'update-test', name: 'Original' })
                .expect(201);

            // Update
            const updateRes = await request(app)
                .patch('/api/groups/update-test')
                .send({ name: 'Updated' })
                .expect(200);

            expect(updateRes.body.name).toBe('Updated');
        });

        it('should delete a group', async () => {
            // Create
            await request(app)
                .post('/api/groups')
                .send({ id: 'delete-test', name: 'To Delete' })
                .expect(201);

            // Delete
            await request(app).delete('/api/groups/delete-test').expect(200);

            // Verify gone
            const groups = await groupsStore.getAll();
            expect(groups.find(g => g.id === 'delete-test')).toBeUndefined();
        });
    });

    describe('Config Backups Module', () => {
        let app;
        let mockFunctions;

        beforeAll(() => {
            app = express();
            app.use(express.json());

            // Mock all config backup functions
            mockFunctions = {
                cfgListBackups: jest.fn().mockResolvedValue([]),
                cfgCreateBackup: jest.fn().mockResolvedValue({ id: 'backup-1', files: [] }),
                cfgCleanupOld: jest.fn().mockResolvedValue({ removed: 0 }),
                cfgRestoreFile: jest.fn().mockResolvedValue(true),
                cfgDeleteBackup: jest.fn().mockResolvedValue(true),
                cfgReadSchedule: jest
                    .fn()
                    .mockResolvedValue({ enabled: false, time: '02:30', retention: 5 }),
                cfgWriteSchedule: jest.fn().mockResolvedValue(true),
            };

            // Mount config-backups router
            const createConfigBackupsRouter = require('../../routes/config-backups');
            const router = createConfigBackupsRouter({
                isAuthenticated: (req, res, next) => next(),
                logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
                CFG_FILES: ['config.json', '.env'],
                ...mockFunctions,
                broadcastAdminEvent: jest.fn(),
            });
            app.use('/api/admin/config-backups', router);
        });

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should list backups', async () => {
            mockFunctions.cfgListBackups.mockResolvedValueOnce([
                { id: 'b1', files: ['config.json'] },
            ]);

            const res = await request(app).get('/api/admin/config-backups').expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('should create a backup', async () => {
            const res = await request(app).post('/api/admin/config-backups').expect(200);
            expect(res.body).toHaveProperty('id');
            expect(mockFunctions.cfgCreateBackup).toHaveBeenCalled();
        });

        it('should get backup schedule', async () => {
            const res = await request(app).get('/api/admin/config-backups/schedule').expect(200);
            expect(res.body).toHaveProperty('enabled');
            expect(res.body).toHaveProperty('time');
        });

        it('should update backup schedule', async () => {
            const res = await request(app)
                .post('/api/admin/config-backups/schedule')
                .send({ enabled: true, time: '03:00', retention: 7 })
                .expect(200);

            expect(res.body.ok).toBe(true);
            expect(mockFunctions.cfgWriteSchedule).toHaveBeenCalled();
        });
    });

    describe('Profile Photo Module', () => {
        let app;
        let testUploadsDir;

        beforeAll(() => {
            testUploadsDir = path.join(__dirname, '../../uploads/route-test');
            if (!fs.existsSync(testUploadsDir)) {
                fs.mkdirSync(testUploadsDir, { recursive: true });
            }

            app = express();
            app.use(express.json());

            // Mock upload middleware
            const mockUpload = {
                single: () => (req, res, next) => next(),
            };

            // Mount profile-photo router
            const createProfilePhotoRouter = require('../../routes/profile-photo');
            const router = createProfilePhotoRouter({
                adminAuth: (req, res, next) => next(),
                logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
                uploadsDir: testUploadsDir,
                upload: mockUpload,
                broadcastAdminEvent: jest.fn(),
            });
            app.use('/api/admin/profile', router);
        });

        afterAll(() => {
            if (fs.existsSync(testUploadsDir)) {
                fs.rmSync(testUploadsDir, { recursive: true, force: true });
            }
        });

        it('should return 404 when no photo exists', async () => {
            await request(app).get('/api/admin/profile/photo').expect(404);
        });

        it('should handle photo upload endpoint', async () => {
            // This will fail without actual file, but tests route exists
            const res = await request(app).post('/api/admin/profile/photo');
            expect([200, 400]).toContain(res.status); // Either success or missing file error
        });
    });

    describe('Public API Module', () => {
        let app;

        beforeAll(() => {
            app = express();
            app.use(express.json());

            // Mock dependencies
            const mockConfig = { version: '2.8.8' };
            const mockRatingCache = {
                getRatings: jest.fn().mockResolvedValue(['PG', 'PG-13', 'R']),
                getRatingsWithCounts: jest.fn().mockResolvedValue([]),
                getStats: jest.fn().mockResolvedValue({}),
                refreshSource: jest.fn().mockResolvedValue({ success: true }),
            };

            // Mount public-api router
            const createPublicApiRouter = require('../../routes/public-api');
            const router = createPublicApiRouter({
                config: mockConfig,
                ratingCache: mockRatingCache,
                logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
                isAuthenticated: (req, res, next) => next(),
            });
            app.use('/api', router);
        });

        it('should return version', async () => {
            const res = await request(app).get('/api/version').expect(200);
            expect(res.body).toHaveProperty('version');
        });

        it('should return config', async () => {
            const res = await request(app).get('/api/config').expect(200);
            expect(res.body).toHaveProperty('version');
        });

        it('should return ratings for a source', async () => {
            const res = await request(app).get('/api/sources/plex/ratings').expect(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
    });

    describe('Health Module', () => {
        let app;

        beforeAll(() => {
            app = express();

            // Health router is directly exported, not a factory
            const healthRouter = require('../../routes/health');
            app.use('/', healthRouter);
        });

        it('should return basic health status', async () => {
            const res = await request(app).get('/health').expect(200);
            expect(res.body).toHaveProperty('status');
        });

        it('should return health on /api/health alias', async () => {
            const res = await request(app).get('/api/health').expect(200);
            expect(res.body).toHaveProperty('status');
        });
    });

    describe('QR Module', () => {
        let app;

        beforeAll(() => {
            app = express();

            // Mount QR router
            const createQRRouter = require('../../routes/qr');
            const router = createQRRouter({
                isAuthenticated: (req, res, next) => next(),
            });
            app.use('/', router);
        });

        it('should generate QR code with text parameter', async () => {
            const res = await request(app).get('/api/qr').query({ text: 'https://example.com' });

            // Should either succeed (200) or have qrcode module missing (501)
            expect([200, 501]).toContain(res.status);
        });

        it('should require text parameter', async () => {
            const res = await request(app).get('/api/qr').expect(400);
            expect(res.body).toHaveProperty('error');
        });
    });
});
