/**
 * Tests for jellyfin_connectivity health check
 */

const path = require('path');

// Helper to build a minimal config.json fixture
function buildConfig(enabled = true) {
    return JSON.stringify({
        mediaServers: [
            {
                name: 'Jellyfin Main',
                type: 'jellyfin',
                enabled,
                hostname: '127.0.0.1',
                port: 8096,
                tokenEnvVar: 'JELLYFIN_API_KEY',
            },
        ],
    });
}

// Spy on fs.promises.readFile instead of mocking entire fs (winston needs full fs API)
function mockFsWithConfig(jsonString) {
    const fs = require('fs');
    if (fs.promises && fs.promises.readFile) {
        jest.spyOn(fs.promises, 'readFile').mockResolvedValue(jsonString);
    } else {
        throw new Error('fs.promises.readFile not available to spy on');
    }
}

function mockServerTestConnection(impl) {
    const serverPath = path.resolve(__dirname, '../../server.js');
    jest.doMock(
        serverPath,
        () => ({
            testServerConnection: jest.fn(impl),
        }),
        { virtual: false }
    );
}

function unmockAll() {
    jest.restoreAllMocks();
}

describe('jellyfin_connectivity health check', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        unmockAll();
    });

    test('returns ok when testServerConnection reports ok', async () => {
        mockFsWithConfig(buildConfig(true));
        mockServerTestConnection(async () => ({ status: 'ok', message: 'Connection successful.' }));
        const hc = require('../../utils/healthCheck');
        const res = await hc.checkJellyfinConnectivity();

        expect(res).toBeTruthy();
        expect(res.name).toBe('jellyfin_connectivity');
        expect(res.status).toBe('ok');
        expect(res.details).toBeTruthy();
        expect(Array.isArray(res.details.servers)).toBe(true);
        expect(res.details.servers.length).toBe(1);
        expect(res.details.servers[0].status).toBe('ok');
        expect(res.details.servers[0].server).toBe('Jellyfin Main');
    });

    test('returns error when any Jellyfin server fails', async () => {
        mockFsWithConfig(buildConfig(true));
        mockServerTestConnection(async () => ({ status: 'error', message: 'Connection failed.' }));
        const hc = require('../../utils/healthCheck');
        const res = await hc.checkJellyfinConnectivity();

        expect(res).toBeTruthy();
        expect(res.name).toBe('jellyfin_connectivity');
        expect(res.status).toBe('error');
        expect(res.details.servers[0].status).toBe('error');
    });
});
