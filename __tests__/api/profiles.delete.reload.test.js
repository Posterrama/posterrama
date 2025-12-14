const express = require('express');
const request = require('supertest');

jest.mock('../../utils/profilesStore', () => ({
    deleteProfile: jest.fn(),
}));

jest.mock('../../utils/deviceStore', () => ({
    getAll: jest.fn(),
    patchDevice: jest.fn(),
    queueCommand: jest.fn(),
}));

jest.mock('../../utils/wsHub', () => ({
    isConnected: jest.fn(),
    sendCommand: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const profilesStore = require('../../utils/profilesStore');
const deviceStore = require('../../utils/deviceStore');
const wsHub = require('../../utils/wsHub');

describe('Profile delete triggers targeted reload (Isolated)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function makeApp() {
        const adminAuth = (_req, _res, next) => next();
        const cacheManager = { clear: jest.fn() };

        const createProfilesRouter = require('../../routes/profiles');
        const router = createProfilesRouter({ adminAuth, cacheManager });

        const app = express();
        app.use(express.json());
        app.use('/api/profiles', router);
        return app;
    }

    test('deleting a profile reloads only devices that had it', async () => {
        profilesStore.deleteProfile.mockResolvedValue(true);
        deviceStore.getAll.mockResolvedValue([
            { id: 'dev-1', profileId: 'p1' },
            { id: 'dev-2', profileId: 'p2' },
            { id: 'dev-3', profileId: 'p1' },
        ]);

        wsHub.isConnected.mockImplementation(id => id === 'dev-1');

        const app = makeApp();
        const resp = await request(app).delete('/api/profiles/p1');

        expect(resp.status).toBe(200);
        expect(resp.body).toEqual({ ok: true });

        // Only devices with p1 are cleared.
        expect(deviceStore.patchDevice).toHaveBeenCalledTimes(2);
        expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev-1', { profileId: null });
        expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev-3', { profileId: null });

        // Reload only affected devices: dev-1 live, dev-3 queued.
        expect(wsHub.sendCommand).toHaveBeenCalledTimes(1);
        expect(wsHub.sendCommand).toHaveBeenCalledWith('dev-1', {
            type: 'core.mgmt.reload',
            payload: {},
        });

        expect(deviceStore.queueCommand).toHaveBeenCalledTimes(1);
        expect(deviceStore.queueCommand).toHaveBeenCalledWith('dev-3', {
            type: 'core.mgmt.reload',
            payload: {},
        });
    });

    test('not_found: does not touch devices', async () => {
        profilesStore.deleteProfile.mockResolvedValue(false);
        deviceStore.getAll.mockResolvedValue([{ id: 'dev-1', profileId: 'p1' }]);

        const app = makeApp();
        const resp = await request(app).delete('/api/profiles/p1');

        expect(resp.status).toBe(404);
        expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        expect(wsHub.sendCommand).not.toHaveBeenCalled();
        expect(deviceStore.queueCommand).not.toHaveBeenCalled();
    });
});
