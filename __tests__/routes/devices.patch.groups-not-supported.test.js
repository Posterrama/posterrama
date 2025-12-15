const express = require('express');
const request = require('supertest');

const createDevicesRouter = require('../../routes/devices');

describe('Devices PATCH rejects legacy groups field', () => {
    test('returns 400 groups_not_supported', async () => {
        const deviceStore = {
            getById: jest.fn().mockResolvedValue({
                id: 'd1',
                profileId: null,
                settingsOverride: {},
            }),
            patchDevice: jest.fn(),
        };

        const app = express();
        app.use(
            '/api/devices',
            createDevicesRouter({
                deviceStore,
                wsHub: { isConnected: () => false },
                adminAuth: (req, res, next) => next(),
                adminAuthDevices: (req, res, next) => next(),
                testSessionShim: (req, res, next) => next(),
                deviceRegisterLimiter: (req, res, next) => next(),
                devicePairClaimLimiter: (req, res, next) => next(),
                asyncHandler: fn => fn,
                ApiError: Error,
                logger: {
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn(),
                },
                isDebug: false,
                config: {},
            })
        );

        const res = await request(app)
            .patch('/api/devices/d1')
            .send({ groups: ['x'] });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'groups_not_supported' });
        expect(deviceStore.patchDevice).not.toHaveBeenCalled();
    });
});
