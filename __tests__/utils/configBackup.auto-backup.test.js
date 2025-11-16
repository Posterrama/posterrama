/**
 * Tests for auto-backup on config save feature (#68/#59)
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs').promises;

describe('Config Auto-Backup on Save (#68/#59)', () => {
    let app;
    let authToken;

    beforeAll(async () => {
        // Set test environment
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_USERNAME = 'testadmin';
        process.env.ADMIN_PASSWORD = 'testpass123';

        // Import app
        const serverModule = require('../../server');
        app = serverModule;

        // Login to get auth token
        const loginRes = await request(app)
            .post('/api/login')
            .send({ username: 'testadmin', password: 'testpass123' });

        authToken = loginRes.headers['set-cookie'];
    });

    afterAll(async () => {
        // Cleanup
        delete process.env.ADMIN_USERNAME;
        delete process.env.ADMIN_PASSWORD;
    });

    describe('Auto-backup trigger', () => {
        it('should create backup when config is saved', async () => {
            // Get initial backup count
            const beforeRes = await request(app)
                .get('/api/admin/config-backups')
                .set('Cookie', authToken);

            const beforeCount = beforeRes.body.length || 0;

            // Save config
            const saveRes = await request(app)
                .post('/api/admin/config')
                .set('Cookie', authToken)
                .send({
                    config: { serverName: 'Test Server' },
                    env: { DEBUG: 'false' },
                });

            expect(saveRes.status).toBe(200);
            expect(saveRes.body.autoBackupCreated).toBe(true);

            // Verify backup was created
            const afterRes = await request(app)
                .get('/api/admin/config-backups')
                .set('Cookie', authToken);

            expect(afterRes.body.length).toBe(beforeCount + 1);

            // Verify backup has correct label
            const latestBackup = afterRes.body[0];
            expect(latestBackup.label).toBe('Auto-backup (config save)');
            expect(latestBackup.note).toBe('Automatically created before config save');
        });

        it('should throttle auto-backups to 1 per 5 minutes', async () => {
            // First save - should create backup
            const firstRes = await request(app)
                .post('/api/admin/config')
                .set('Cookie', authToken)
                .send({
                    config: { serverName: 'Test 1' },
                    env: {},
                });

            expect(firstRes.body.autoBackupCreated).toBe(true);

            // Second save immediately after - should be throttled
            const secondRes = await request(app)
                .post('/api/admin/config')
                .set('Cookie', authToken)
                .send({
                    config: { serverName: 'Test 2' },
                    env: {},
                });

            expect(secondRes.body.autoBackupCreated).toBe(false);
        });

        it('should respect backups.enabled setting', async () => {
            // Disable backups
            const disableRes = await request(app)
                .post('/api/admin/config')
                .set('Cookie', authToken)
                .send({
                    config: {
                        serverName: 'Test',
                        backups: { enabled: false },
                    },
                    env: {},
                });

            expect(disableRes.body.autoBackupCreated).toBe(false);
        });
    });

    describe('Auto-backup metadata', () => {
        it('should include correct metadata fields', async () => {
            const res = await request(app)
                .post('/api/admin/config')
                .set('Cookie', authToken)
                .send({
                    config: { serverName: 'Metadata Test' },
                    env: {},
                });

            expect(res.body.autoBackupCreated).toBe(true);

            // Get the backup
            const backupsRes = await request(app)
                .get('/api/admin/config-backups')
                .set('Cookie', authToken);

            const autoBackup = backupsRes.body.find(b => b.label === 'Auto-backup (config save)');

            expect(autoBackup).toBeDefined();
            expect(autoBackup.id).toMatch(/^\d{8}-\d{6}$/);
            expect(autoBackup.createdAt).toBeDefined();
            expect(autoBackup.files).toBeInstanceOf(Array);
            expect(autoBackup.sizeBytes).toBeGreaterThan(0);
        });
    });
});
