/**
 * Tests for actual control capabilities (using real capability names)
 * Target: capabilityRegistry coverage boost from 59% to 70%+
 */

const capabilityRegistry = require('../../utils/capabilityRegistry');
const deviceStore = require('../../utils/deviceStore');
const wsHub = require('../../utils/wsHub');

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../../utils/deviceStore');
jest.mock('../../utils/wsHub');

describe('CapabilityRegistry - Real Control Capabilities', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Force reinit
        capabilityRegistry.initialized = false;
        capabilityRegistry.init();

        deviceStore.patchDevice.mockResolvedValue({});
        deviceStore.getById.mockImplementation(id =>
            Promise.resolve({
                id,
                settingsOverride: {},
                clientInfo: { mode: 'screensaver' },
                isPoweredOn: true,
                isPinned: false,
            })
        );
        deviceStore.getAll.mockResolvedValue([
            {
                id: 'dev1',
                isPoweredOn: true,
                isPinned: false,
                settingsOverride: {},
                clientInfo: { mode: 'screensaver' },
            },
        ]);

        wsHub.sendCommand.mockResolvedValue({});
        wsHub.sendApplySettings.mockResolvedValue({});
    });

    describe('playback controls', () => {
        test('playback.pause capability exists and has correct structure', () => {
            const cap = capabilityRegistry.get('playback.pause');

            expect(cap).toBeDefined();
            expect(cap.name).toBe('Pause');
            expect(cap.category).toBe('playback');
            expect(cap.entityType).toBe('button');
        });

        test('playback.resume capability exists', () => {
            const cap = capabilityRegistry.get('playback.resume');

            expect(cap).toBeDefined();
            expect(cap.name).toBe('Resume');
            expect(cap.entityType).toBe('button');
        });

        test('playback.next capability exists', () => {
            const cap = capabilityRegistry.get('playback.next');

            expect(cap).toBeDefined();
            expect(cap.name).toBe('Next');
        });

        test('playback.previous capability exists', () => {
            const cap = capabilityRegistry.get('playback.previous');

            expect(cap).toBeDefined();
            expect(cap.name).toBe('Previous');
        });

        test('playback.toggle capability exists and works', async () => {
            const cap = capabilityRegistry.get('playback.toggle');

            expect(cap).toBeDefined();
            await cap.commandHandler('dev1', null);

            expect(wsHub.sendCommand).toHaveBeenCalledWith('dev1', expect.any(Object));
        });

        test('playback capabilities have availableWhen checking mode', () => {
            const cap = capabilityRegistry.get('playback.pause');

            const screensaverDevice = { clientInfo: { mode: 'screensaver' }, isPoweredOn: true };
            const cinemaDevice = { clientInfo: { mode: 'cinema' }, isPoweredOn: true };

            expect(cap.availableWhen(screensaverDevice)).toBe(true);
            expect(cap.availableWhen(cinemaDevice)).toBe(false);
        });
    });

    describe('power controls', () => {
        test('power.on sends command (commandHandler takes deviceId string)', async () => {
            const cap = capabilityRegistry.get('power.on');

            await cap.commandHandler('dev1');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('dev1', expect.any(Object));
        });

        test('power.off sends command (commandHandler takes deviceId string)', async () => {
            const cap = capabilityRegistry.get('power.off');

            await cap.commandHandler('dev2');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('dev2', expect.any(Object));
        });

        test('power.toggle switches state correctly', async () => {
            const cap = capabilityRegistry.get('power.toggle');

            await cap.commandHandler('dev3', 'ON');
            expect(wsHub.sendCommand).toHaveBeenCalledWith('dev3', { type: 'power.on' });

            jest.clearAllMocks();

            await cap.commandHandler('dev4', 'OFF');
            expect(wsHub.sendCommand).toHaveBeenCalledWith('dev4', { type: 'power.off' });
        });

        test('power.toggle stateGetter returns boolean (true=ON, false=OFF)', () => {
            const cap = capabilityRegistry.get('power.toggle');

            expect(cap.stateGetter({ currentState: { poweredOff: false } })).toBe(true);
            expect(cap.stateGetter({ currentState: { poweredOff: true } })).toBe(false);
        });

        test('power.on available when powered off', () => {
            const cap = capabilityRegistry.get('power.on');

            expect(cap.availableWhen({ currentState: { poweredOff: true } })).toBe(true);
            expect(cap.availableWhen({ currentState: { poweredOff: false } })).toBe(false);
        });

        test('power.off available when powered on', () => {
            const cap = capabilityRegistry.get('power.off');

            expect(cap.availableWhen({ currentState: { poweredOff: true } })).toBe(false);
            expect(cap.availableWhen({ currentState: { poweredOff: false } })).toBe(true);
        });
    });

    describe('pin controls', () => {
        test('pin.current pins current poster', async () => {
            const cap = capabilityRegistry.get('pin.current');

            expect(cap).toBeDefined();
            await cap.commandHandler('dev1');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('dev1', expect.any(Object));
        });

        test('pin.unpin capability exists', async () => {
            const cap = capabilityRegistry.get('pin.unpin');

            expect(cap).toBeDefined();
            await cap.commandHandler('dev1');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('dev1', expect.any(Object));
        });

        test('pin.current available in screensaver mode', () => {
            const cap = capabilityRegistry.get('pin.current');

            expect(cap.availableWhen({ clientInfo: { mode: 'screensaver' } })).toBe(true);
            expect(cap.availableWhen({ clientInfo: { mode: 'cinema' } })).toBe(false);
        });

        test('pin.unpin available when pinned in screensaver mode', () => {
            const cap = capabilityRegistry.get('pin.unpin');

            const pinned = { clientInfo: { mode: 'screensaver' }, currentState: { pinned: true } };
            const unpinned = {
                clientInfo: { mode: 'screensaver' },
                currentState: { pinned: false },
            };
            const wrongMode = { clientInfo: { mode: 'cinema' }, currentState: { pinned: true } };

            expect(cap.availableWhen(pinned)).toBe(true);
            expect(cap.availableWhen(unpinned)).toBe(false);
            expect(cap.availableWhen(wrongMode)).toBe(false);
        });
    });

    describe('camera and mode capabilities', () => {
        test('mode.select switches modes', async () => {
            const cap = capabilityRegistry.get('mode.select');

            expect(cap).toBeDefined();
            expect(cap.entityType).toBe('select');
            expect(cap.options).toContain('cinema');
            expect(cap.options).toContain('screensaver');
            expect(cap.options).toContain('wallart');
        });

        test('mode.select commandHandler updates mode', async () => {
            const cap = capabilityRegistry.get('mode.select');

            await cap.commandHandler('dev1', 'cinema');
            expect(deviceStore.patchDevice).toHaveBeenCalled();

            await cap.commandHandler('dev2', 'wallart');
            expect(deviceStore.patchDevice).toHaveBeenCalled();
        });

        test('mode.select stateGetter returns current mode', () => {
            const cap = capabilityRegistry.get('mode.select');
            const device = {
                clientInfo: { mode: 'cinema' },
            };

            const result = cap.stateGetter(device);
            expect(result).toBe('cinema');
        });
    });

    describe('diagnostics', () => {
        test('getAllCapabilities returns all registered capabilities', () => {
            const all = capabilityRegistry.getAllCapabilities();

            expect(Array.isArray(all)).toBe(true);
            expect(all.length).toBeGreaterThan(0);

            // Should have various categories
            const categories = new Set(all.map(c => c.category));
            expect(categories.size).toBeGreaterThan(1);
        });

        test('getAvailableCapabilities filters by device state', () => {
            const screensaverDevice = {
                id: 'test',
                clientInfo: { mode: 'screensaver' },
                currentState: { poweredOff: false },
            };

            const available = capabilityRegistry.getAvailableCapabilities(screensaverDevice);

            expect(Array.isArray(available)).toBe(true);
            expect(available.length).toBeGreaterThan(0);
        });
    });

    describe('helper methods', () => {
        test('getDeviceMode returns mode from clientInfo', () => {
            const device = {
                clientInfo: { mode: 'wallart' },
            };

            const mode = capabilityRegistry.getDeviceMode(device);
            expect(mode).toBe('wallart');
        });

        test('getDeviceMode falls back to currentState', () => {
            const device = {
                currentState: { mode: 'cinema' },
            };

            const mode = capabilityRegistry.getDeviceMode(device);
            expect(mode).toBe('cinema');
        });

        test('getDeviceMode defaults to screensaver', () => {
            const device = {};

            const mode = capabilityRegistry.getDeviceMode(device);
            expect(mode).toBe('screensaver');
        });

        test('getCinemaSetting retrieves from settingsOverride', () => {
            const device = {
                settingsOverride: {
                    cinema: { orientation: 'horizontal' },
                },
            };

            const setting = capabilityRegistry.getCinemaSetting(device, 'orientation');
            expect(setting).toBe('horizontal');
        });

        test('getScreensaverSetting retrieves from settingsOverride', () => {
            const device = {
                settingsOverride: {
                    screensaver: { showClock: true },
                },
            };

            const setting = capabilityRegistry.getScreensaverSetting(device, 'showClock');
            expect(setting).toBe(true);
        });

        test('getWallartSetting retrieves from settingsOverride', () => {
            const device = {
                settingsOverride: {
                    wallart: { posterRefreshRate: 30 },
                },
            };

            const setting = capabilityRegistry.getWallartSetting(device, 'posterRefreshRate');
            expect(setting).toBe(30);
        });

        test('getModeSetting returns default when no override', () => {
            const device = {
                settingsOverride: {},
            };

            const setting = capabilityRegistry.getModeSetting(
                device,
                'cinema',
                'orientation',
                'vertical'
            );
            // Cinema orientation should return global config default (not hardcoded 'auto')
            expect(typeof setting).toBe('string');
            expect(['auto', 'portrait', 'portrait-flipped', 'landscape', 'vertical']).toContain(
                setting
            );
        });

        test('getModeSetting handles nested paths', () => {
            const device = {
                settingsOverride: {
                    cinema: {
                        header: { enabled: true, text: 'Test' },
                    },
                },
            };

            const setting = capabilityRegistry.getModeSetting(
                device,
                'cinema',
                'header.text',
                'default'
            );
            expect(setting).toBe('Test');
        });
    });

    describe('availability predicates', () => {
        test('screensaver mode capabilities check mode', () => {
            const screenCap = capabilityRegistry
                .getAllCapabilities()
                .find(c => c.availableWhen && c.category === 'settings');

            if (screenCap && screenCap.availableWhen) {
                const screensaverDevice = {
                    clientInfo: { mode: 'screensaver' },
                    isPoweredOn: true,
                };

                // Some capabilities should only be available in specific modes
                expect(typeof screenCap.availableWhen(screensaverDevice)).toBe('boolean');
            }
        });

        test('wallart mode capabilities check mode', () => {
            const wallartCap = capabilityRegistry.get('settings.wallartMode.animationType');

            const wallartDevice = {
                clientInfo: { mode: 'wallart' },
                isPoweredOn: true,
            };

            const cinemaDevice = {
                clientInfo: { mode: 'cinema' },
                isPoweredOn: true,
            };

            expect(wallartCap.availableWhen(wallartDevice)).toBe(true);
            expect(wallartCap.availableWhen(cinemaDevice)).toBe(false);
        });

        test('cinema mode capabilities check mode', () => {
            const cinemaCap = capabilityRegistry.get('settings.cinema.orientation');

            const cinemaDevice = {
                clientInfo: { mode: 'cinema' },
                isPoweredOn: true,
            };

            const screensaverDevice = {
                clientInfo: { mode: 'screensaver' },
                isPoweredOn: true,
            };

            expect(cinemaCap.availableWhen(cinemaDevice)).toBe(true);
            expect(cinemaCap.availableWhen(screensaverDevice)).toBe(false);
        });
    });

    describe('getAllCapabilities filtering', () => {
        test('returns all capabilities', () => {
            const all = capabilityRegistry.getAllCapabilities();

            expect(Array.isArray(all)).toBe(true);
            expect(all.length).toBeGreaterThan(0);
        });

        test('returns available capabilities for device', () => {
            const device = {
                id: 'test',
                isPoweredOn: true,
                clientInfo: { mode: 'wallart' },
            };

            const available = capabilityRegistry.getAvailableCapabilities(device);

            expect(Array.isArray(available)).toBe(true);
            expect(available.length).toBeGreaterThan(0);
            expect(available.length).toBeLessThanOrEqual(
                capabilityRegistry.getAllCapabilities().length
            );
        });

        test('filters out unavailable capabilities', () => {
            const poweredOffDevice = {
                id: 'test',
                isPoweredOn: false,
                settingsOverride: {},
            };

            const available = capabilityRegistry.getAvailableCapabilities(poweredOffDevice);
            const all = capabilityRegistry.getAllCapabilities();

            // Powered off device should have fewer available capabilities
            expect(available.length).toBeLessThan(all.length);
        });
    });
});
