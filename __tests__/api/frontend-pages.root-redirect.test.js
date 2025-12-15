const express = require('express');
const request = require('supertest');
const path = require('path');
const fs = require('fs');

const createFrontendPagesRouter = require('../../routes/frontend-pages');

describe('frontend-pages root redirect', () => {
    test('GET / redirects using getConfig without reading config.json from disk', async () => {
        const readFileSpy = jest.spyOn(fs, 'readFileSync');

        const app = express();
        app.use(
            createFrontendPagesRouter({
                isAdminSetup: () => true,
                isAuthenticated: (req, res, next) => next(),
                getAssetVersions: () => ({}),
                ASSET_VERSION: 'test',
                logger: {
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                },
                publicDir: path.join(process.cwd(), 'public'),
                getConfig: () => ({
                    rootRoute: { behavior: 'redirect', defaultMode: 'cinema', statusCode: 307 },
                }),
            })
        );

        const res = await request(app)
            .get('/')
            .set('x-forwarded-prefix', '/posterrama')
            .expect(307);

        expect(res.headers.location).toBe('/posterrama/cinema');
        expect(res.headers['cache-control']).toBe('no-store');

        // Root redirect path must not read config.json from disk.
        const readConfigJson = readFileSpy.mock.calls.some(call =>
            String(call?.[0] || '').endsWith(`${path.sep}config.json`)
        );
        expect(readConfigJson).toBe(false);

        readFileSpy.mockRestore();
    });
});
