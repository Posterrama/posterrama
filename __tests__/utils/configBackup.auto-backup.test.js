/**
 * Tests for auto-backup on config save feature (#68/#59)
 */

const request = require('supertest');

describe('Config Auto-Backup on Save (#68/#59)', () => {
    let app;

    beforeAll(async () => {
        // Ensure config.json has valid backups configuration
        const fs = require('fs');
        const path = require('path');
        const configPath = path.join(__dirname, '..', '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!config.backups || !config.backups.time || !config.backups.retention) {
            config.backups = {
                enabled: false,
                time: '02:00',
                retention: 7,
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        }

        // Import real app
        const serverModule = require('../../server');
        app = serverModule;
    });

    // Helper: Add API token authentication (uses real API_ACCESS_TOKEN from .env)
    const withAuth = req => req.set('x-api-key', process.env.API_ACCESS_TOKEN);

    describe('Auto-backup trigger', () => {
        it('should create backup when config is saved', async () => {
            // Get initial backup count
            const beforeRes = await withAuth(request(app).get('/api/admin/config-backups'));
            const beforeCount = beforeRes.body.length || 0;

            // Save config
            const saveRes = await withAuth(request(app))
                .post('/api/admin/config')
                .send({
                    config: { serverName: 'Test Server' },
                    env: { DEBUG: 'false' },
                });

            expect(saveRes.status).toBe(200);
            expect(saveRes.body.autoBackupCreated).toBe(true);

            // Verify backup was created
            const afterRes = await withAuth(request(app).get('/api/admin/config-backups'));
            expect(afterRes.body.length).toBe(beforeCount + 1);

            // Verify backup has correct label
            const latestBackup = afterRes.body[0];
            expect(latestBackup.label).toBe('Auto-backup (config save)');
            expect(latestBackup.note).toBe('Automatically created before config save');
        });

        it('should throttle auto-backups to 1 per 5 minutes', async () => {
            // First save - should create backup
            const firstRes = await withAuth(request(app))
                .post('/api/admin/config')
                .send({
                    config: { serverName: 'Test 1' },
                    env: {},
                });

            expect(firstRes.body.autoBackupCreated).toBe(true);

            // Second save immediately after - should be throttled
            const secondRes = await withAuth(request(app))
                .post('/api/admin/config')
                .send({
                    config: { serverName: 'Test 2' },
                    env: {},
                });

            expect(secondRes.body.autoBackupCreated).toBe(false);
        });

        it('should respect backups.enabled setting', async () => {
            // Disable backups
            const disableRes = await withAuth(request(app))
                .post('/api/admin/config')
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
            // Save config to trigger backup
            await withAuth(request(app))
                .post('/api/admin/config')
                .send({
                    config: { serverName: 'Metadata Test' },
                    env: {},
                });

            // Get latest backup
            const backupsRes = await withAuth(request(app).get('/api/admin/config-backups'));
            expect(backupsRes.status).toBe(200);

            const latestBackup = backupsRes.body[0];
            expect(latestBackup).toHaveProperty('label');
            expect(latestBackup).toHaveProperty('note');
            expect(latestBackup).toHaveProperty('timestamp');
            expect(latestBackup).toHaveProperty('id');
            expect(latestBackup.label).toBe('Auto-backup (config save)');
        });
    });
});
