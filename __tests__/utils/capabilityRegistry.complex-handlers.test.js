/**
 * Tests for complex capabilityRegistry commandHandlers that require deviceStore
 */

// Mock wsHub
jest.mock('../../utils/wsHub', () => ({
    sendCommand: jest.fn().mockResolvedValue(true),
    sendApplySettings: jest.fn().mockResolvedValue(true),
}));

// Mock deviceStore
const mockDeviceStore = {
    getById: jest.fn(),
    patchDevice: jest.fn().mockResolvedValue(true),
};

jest.mock('../../utils/deviceStore', () => mockDeviceStore);

describe('CapabilityRegistry - Complex CommandHandlers', () => {
    let capabilityRegistry;
    let wsHub;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        wsHub = require('../../utils/wsHub');
        capabilityRegistry = require('../../utils/capabilityRegistry');

        // Reset and initialize
        capabilityRegistry.capabilities.clear();
        capabilityRegistry.initialized = false;
        capabilityRegistry.init();
    });

    describe('mode.select commandHandler', () => {
        test('updates device settingsOverride and sends command', async () => {
            const mockDevice = {
                id: 'device-1',
                name: 'Test Device',
                settingsOverride: {},
            };

            mockDeviceStore.getById.mockResolvedValue(mockDevice);

            const capability = capabilityRegistry.get('mode.select');
            await capability.commandHandler('device-1', 'cinema');

            expect(mockDeviceStore.getById).toHaveBeenCalledWith('device-1');
            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith('device-1', {
                settingsOverride: expect.objectContaining({
                    mode: 'cinema',
                    cinemaMode: true,
                    wallartMode: expect.objectContaining({
                        enabled: false,
                    }),
                }),
            });
            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-1', {
                type: 'mode.navigate',
                payload: { mode: 'cinema' },
            });
        });

        test('handles screensaver mode selection', async () => {
            const mockDevice = {
                id: 'device-2',
                settingsOverride: { someExisting: 'value' },
            };

            mockDeviceStore.getById.mockResolvedValue(mockDevice);

            const capability = capabilityRegistry.get('mode.select');
            await capability.commandHandler('device-2', 'screensaver');

            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith('device-2', {
                settingsOverride: expect.objectContaining({
                    mode: 'screensaver',
                    cinemaMode: false,
                    wallartMode: expect.objectContaining({
                        enabled: false,
                    }),
                }),
            });
        });

        test('handles wallart mode selection', async () => {
            const mockDevice = {
                id: 'device-3',
                settingsOverride: {},
            };

            mockDeviceStore.getById.mockResolvedValue(mockDevice);

            const capability = capabilityRegistry.get('mode.select');
            await capability.commandHandler('device-3', 'wallart');

            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith('device-3', {
                settingsOverride: expect.objectContaining({
                    mode: 'wallart',
                    cinemaMode: false,
                    wallartMode: expect.objectContaining({
                        enabled: true,
                    }),
                }),
            });
        });

        test('throws error when device not found', async () => {
            mockDeviceStore.getById.mockResolvedValue(null);

            const capability = capabilityRegistry.get('mode.select');

            await expect(capability.commandHandler('nonexistent', 'cinema')).rejects.toThrow(
                'Device not found: nonexistent'
            );
        });

        test('preserves existing wallartMode settings', async () => {
            const mockDevice = {
                id: 'device-4',
                settingsOverride: {
                    wallartMode: {
                        density: 'high',
                        customProp: 'value',
                    },
                },
            };

            mockDeviceStore.getById.mockResolvedValue(mockDevice);

            const capability = capabilityRegistry.get('mode.select');
            await capability.commandHandler('device-4', 'cinema');

            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith('device-4', {
                settingsOverride: expect.objectContaining({
                    wallartMode: expect.objectContaining({
                        density: 'high',
                        customProp: 'value',
                        enabled: false,
                    }),
                }),
            });
        });
    });

    describe('mode.select stateGetter', () => {
        test('returns device mode from settingsOverride', () => {
            const device = {
                settingsOverride: { mode: 'cinema' },
            };

            const capability = capabilityRegistry.get('mode.select');
            const result = capability.stateGetter(device);

            expect(result).toBe('cinema');
        });

        test('falls back to clientInfo.mode', () => {
            const device = {
                clientInfo: { mode: 'wallart' },
            };

            const capability = capabilityRegistry.get('mode.select');
            const result = capability.stateGetter(device);

            expect(result).toBe('wallart');
        });

        test('falls back to currentState.mode', () => {
            const device = {
                currentState: { mode: 'screensaver' },
            };

            const capability = capabilityRegistry.get('mode.select');
            const result = capability.stateGetter(device);

            expect(result).toBe('screensaver');
        });

        test('returns screensaver as default', () => {
            const device = {};

            const capability = capabilityRegistry.get('mode.select');
            const result = capability.stateGetter(device);

            expect(result).toBe('screensaver');
        });
    });

    describe('playback.toggle commandHandler', () => {
        test('sends playback.toggle command', async () => {
            const capability = capabilityRegistry.get('playback.toggle');
            await capability.commandHandler('device-1');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-1', {
                type: 'playback.toggle',
                payload: {},
            });
        });
    });

    describe('power.toggle commandHandler and stateGetter', () => {
        test('calls power.on when value is ON', async () => {
            const capability = capabilityRegistry.get('power.toggle');
            await capability.commandHandler('device-1', 'ON');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-1', {
                type: 'power.on',
                payload: {},
            });
        });

        test('calls power.off when value is OFF', async () => {
            const capability = capabilityRegistry.get('power.toggle');
            await capability.commandHandler('device-1', 'OFF');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-1', {
                type: 'power.off',
                payload: {},
            });
        });

        test('stateGetter returns true when powered on', () => {
            const device = { currentState: { poweredOff: false } };
            const capability = capabilityRegistry.get('power.toggle');

            expect(capability.stateGetter(device)).toBe(true);
        });

        test('stateGetter returns false when powered off', () => {
            const device = { currentState: { poweredOff: true } };
            const capability = capabilityRegistry.get('power.toggle');

            expect(capability.stateGetter(device)).toBe(false);
        });

        test('stateGetter returns true when poweredOff undefined', () => {
            const device = { currentState: {} };
            const capability = capabilityRegistry.get('power.toggle');

            expect(capability.stateGetter(device)).toBe(true);
        });
    });
});
