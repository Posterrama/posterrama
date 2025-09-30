const request = require('supertest');
const fs = require('fs/promises');
const path = require('path');

jest.mock('../../config/index.js', () => {
    const real = jest.requireActual('../../config/index.js');
    // Wrap to allow dynamic mutation of config backing file content
    return real;
});

describe('GET /api/admin/source-status configured flag logic', () => {
    let app;
    let originalReadFile;

    beforeAll(() => {
        originalReadFile = fs.readFile;
    });

    afterAll(() => {
        fs.readFile = originalReadFile;
    });

    beforeEach(() => {
        jest.resetModules();
        // Minimal server bootstrap
        app = require('../../server');
    });

    test('configured=false when hostname missing even if token present', async () => {
        process.env.PLEX_TOKEN = 'token123';
        // Mock config.json content: enabled server with port but no hostname
        fs.readFile = jest.fn(async file => {
            if (file.endsWith('config.json')) {
                return JSON.stringify({
                    mediaServers: [
                        {
                            name: 'plex1',
                            type: 'plex',
                            enabled: true,
                            port: 32400,
                            tokenEnvVar: 'PLEX_TOKEN',
                        },
                    ],
                });
            }
            return originalReadFile(file);
        });

        const res = await request(app)
            .get('/api/admin/source-status')
            .set('Authorization', 'Bearer test');
        expect(res.status).toBe(200);
        expect(res.body.plex.configured).toBe(false);
    });

    test('configured=false when port missing even if hostname and token present', async () => {
        process.env.PLEX_TOKEN = 'tokenABC';
        fs.readFile = jest.fn(async file => {
            if (file.endsWith('config.json')) {
                return JSON.stringify({
                    mediaServers: [
                        {
                            name: 'plex1',
                            type: 'plex',
                            enabled: true,
                            hostname: 'localhost',
                            tokenEnvVar: 'PLEX_TOKEN',
                        },
                    ],
                });
            }
            return originalReadFile(file);
        });

        const res = await request(app)
            .get('/api/admin/source-status')
            .set('Authorization', 'Bearer test');
        expect(res.status).toBe(200);
        expect(res.body.plex.configured).toBe(false);
    });

    test('configured=true when hostname, port and token present', async () => {
        process.env.PLEX_TOKEN = 'tokFull';
        fs.readFile = jest.fn(async file => {
            if (file.endsWith('config.json')) {
                return JSON.stringify({
                    mediaServers: [
                        {
                            name: 'plex1',
                            type: 'plex',
                            enabled: true,
                            hostname: 'localhost',
                            port: 32400,
                            tokenEnvVar: 'PLEX_TOKEN',
                        },
                    ],
                });
            }
            return originalReadFile(file);
        });
        const res = await request(app)
            .get('/api/admin/source-status')
            .set('Authorization', 'Bearer test');
        expect(res.status).toBe(200);
        expect(res.body.plex.configured).toBe(true);
    });
});
