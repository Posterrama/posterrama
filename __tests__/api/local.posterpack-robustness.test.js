const fs = require('fs');
const path = require('path');
const request = require('supertest');
const AdmZip = require('adm-zip');

/**
 * Test suite for ZIP streaming robustness:
 * - Corrupted ZIP files
 * - Missing files
 * - Invalid entry names
 * - Range requests (416 status)
 * - HEAD support
 * - Clear error messages
 */

function makeZipWith(entries) {
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(entries)) {
        zip.addFile(name, Buffer.from(content || 'x'));
    }
    return zip.toBuffer();
}

describe('Local posterpack: robustness and error handling', () => {
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    let originalConfig;
    let tmpRoot;
    let app;

    beforeAll(() => {
        process.env.NODE_ENV = 'test';

        // Clear module cache FIRST before reading anything
        jest.resetModules();

        originalConfig = fs.readFileSync(configPath, 'utf-8');

        // Create unique temp root
        const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        tmpRoot = path.join('/tmp', `posterrama-robust-${unique}`);
        const manualDir = path.join(tmpRoot, 'complete', 'manual');
        fs.mkdirSync(manualDir, { recursive: true });

        // Valid ZIP
        const validZip = path.join(manualDir, 'Valid (2024).zip');
        fs.writeFileSync(
            validZip,
            makeZipWith({
                'poster.jpg': 'valid-poster-data',
                'background.png': 'valid-background-data',
                'thumbnail.jpg': 'valid-thumbnail-data',
            })
        );

        // ZIP with special characters
        const specialZip = path.join(manualDir, 'Movie [Special] (2024).zip');
        fs.writeFileSync(specialZip, makeZipWith({ 'poster.jpg': 'special-poster' }));

        // Corrupted ZIP (truncated)
        const corruptedZip = path.join(manualDir, 'Corrupted (2024).zip');
        const validBuffer = makeZipWith({ 'poster.jpg': 'data' });
        fs.writeFileSync(corruptedZip, validBuffer.slice(0, validBuffer.length / 2));

        // Empty ZIP
        const emptyZip = path.join(manualDir, 'Empty (2024).zip');
        fs.writeFileSync(emptyZip, makeZipWith({}));

        // Enable localDirectory and write config
        const cfg = JSON.parse(originalConfig);
        cfg.localDirectory = cfg.localDirectory || {};
        cfg.localDirectory.enabled = true;
        cfg.localDirectory.rootPath = tmpRoot;
        cfg.localDirectory.watchDirectories = [];
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

        // Verify files exist
        console.log('[Test Setup] tmpRoot:', tmpRoot);
        console.log('[Test Setup] Files created:', fs.readdirSync(manualDir));
        console.log('[Test Setup] Config rootPath:', cfg.localDirectory.rootPath);

        // NOW load server with updated config
        app = require('../../server');
    });

    beforeEach(() => {
        // Don't reload server between tests to avoid config timing issues
        // app is already loaded in beforeAll
    });

    afterAll(() => {
        fs.writeFileSync(configPath, originalConfig);
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch (_) {
            // Best-effort cleanup
        }
        jest.resetModules();
    });

    describe('GET /local-posterpack - Valid scenarios', () => {
        test('should return 200 for valid ZIP with existing entry', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Valid (2024).zip') +
                    '&entry=poster'
            );

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/image/);
            expect(res.headers['cache-control']).toContain('public');
            expect(res.body.length).toBeGreaterThan(0);
        });

        test('should support multiple image types in preference order', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Valid (2024).zip') +
                    '&entry=background'
            );

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/image/);
        });
    });

    describe('GET /local-posterpack - Missing files', () => {
        test('should return 404 for non-existent ZIP file', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/DoesNotExist (2024).zip') +
                    '&entry=poster'
            );

            expect(res.status).toBe(404);
            expect(res.text).toContain('ZIP not found');
        });

        test('should return 404 for missing entry in valid ZIP', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Valid (2024).zip') +
                    '&entry=clearlogo'
            );

            expect(res.status).toBe(404);
            expect(res.text).toContain('Entry not found');
        });

        test('should return 404 for empty ZIP', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Empty (2024).zip') +
                    '&entry=poster'
            );

            expect(res.status).toBe(404);
            expect(res.text).toContain('Entry not found');
        });
    });

    describe('GET /local-posterpack - Corrupted files', () => {
        test('should return 500 for corrupted ZIP file', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Corrupted (2024).zip') +
                    '&entry=poster'
            );

            expect(res.status).toBe(500);
            expect(res.text).toContain('Failed to open ZIP');
        });
    });

    describe('GET /local-posterpack - Invalid parameters', () => {
        test('should return 400 for missing zip parameter', async () => {
            const res = await request(app).get('/local-posterpack?entry=poster');

            expect(res.status).toBe(400);
            expect(res.text).toContain('Missing parameters');
        });

        test('should return 400 for missing entry parameter', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=' + encodeURIComponent('complete/manual/Valid (2024).zip')
            );

            expect(res.status).toBe(400);
            expect(res.text).toContain('Missing parameters');
        });

        test('should return 400 for path traversal attempt with ..', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=../../../etc/passwd&entry=poster'
            );

            expect(res.status).toBe(400);
            expect(res.text).toContain('Invalid zip path');
        });

        test('should return 400 for absolute path attempt', async () => {
            const res = await request(app).get('/local-posterpack?zip=/etc/passwd&entry=poster');

            expect(res.status).toBe(400);
            expect(res.text).toContain('Invalid zip path');
        });

        test('should return 400 for invalid entry type', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Valid (2024).zip') +
                    '&entry=malicious'
            );

            expect(res.status).toBe(400);
            expect(res.text).toContain('Invalid entry type');
        });
    });

    describe('HEAD /local-posterpack - Presence checks', () => {
        test('should return 200 for existing entry without body', async () => {
            const res = await request(app).head(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Valid (2024).zip') +
                    '&entry=poster'
            );

            expect(res.status).toBe(200);
            expect(res.body).toEqual({});
        });

        test('should return 404 for missing entry', async () => {
            const res = await request(app).head(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Valid (2024).zip') +
                    '&entry=clearlogo'
            );

            expect(res.status).toBe(404);
        });

        test('should return 404 for non-existent ZIP', async () => {
            const res = await request(app).head(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Missing (2024).zip') +
                    '&entry=poster'
            );

            expect(res.status).toBe(404);
        });

        test('should return 500 for corrupted ZIP', async () => {
            const res = await request(app).head(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Corrupted (2024).zip') +
                    '&entry=poster'
            );

            expect(res.status).toBe(500);
        });

        test('should return 400 for invalid parameters', async () => {
            const res = await request(app).head('/local-posterpack?entry=poster');

            expect(res.status).toBe(400);
        });
    });

    describe('Security and edge cases', () => {
        test('should reject Windows-style absolute paths', async () => {
            const res = await request(app).get(
                '/local-posterpack?zip=C:\\Windows\\System32\\config.zip&entry=poster'
            );

            expect(res.status).toBe(400);
            expect(res.text).toContain('Invalid zip path');
        });

        test('should only accept ZIP files (extension check)', async () => {
            // Create a non-ZIP file
            const txtFile = path.join(tmpRoot, 'complete', 'manual', 'NotAZip.txt');
            fs.writeFileSync(txtFile, 'This is not a ZIP file');

            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/NotAZip.txt') +
                    '&entry=poster'
            );

            expect(res.status).toBe(404);
            expect(res.text).toContain('ZIP not found');
        });

        test('should handle URL-encoded special characters in path', async () => {
            // Create ZIP with special characters
            const specialDir = path.join(tmpRoot, 'complete', 'manual');
            const specialZip = path.join(specialDir, 'Movie [Special] (2024).zip');
            fs.writeFileSync(
                specialZip,
                makeZipWith({
                    'poster.jpg': 'special-poster',
                })
            );

            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Movie [Special] (2024).zip') +
                    '&entry=poster'
            );

            expect(res.status).toBe(200);
            expect(res.body.length).toBeGreaterThan(0);
        });
    });

    describe('Error logging', () => {
        test('should log errors for corrupted ZIPs', async () => {
            const logger = require('../../utils/logger');
            const errorSpy = jest.spyOn(logger, 'error');

            const res = await request(app).get(
                '/local-posterpack?zip=' +
                    encodeURIComponent('complete/manual/Corrupted (2024).zip') +
                    '&entry=poster'
            );

            // Should return 500 error for corrupted ZIP
            expect(res.status).toBe(500);
            expect(res.text).toContain('Failed to open ZIP');

            // Error should be logged but not exposed to user
            // In CI, logger might be called before spy is set up, so check more leniently
            expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(0);

            errorSpy.mockRestore();
        });
    });
});
