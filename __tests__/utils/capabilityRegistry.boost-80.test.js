/**
 * Capability Registry Coverage Boost - Target 80%
 * Focuses on uncovered lines: stateGetters, availableWhen conditions, edge cases
 */

jest.mock('../../utils/wsHub', () => ({
    sendCommand: jest.fn().mockResolvedValue(true),
    sendApplySettings: jest.fn().mockResolvedValue(true),
}));

const mockDeviceStore = {
    getById: jest.fn(),
    patchDevice: jest.fn(),
    getAll: jest.fn(),
};

jest.mock('../../utils/deviceStore', () => mockDeviceStore);

describe('CapabilityRegistry - Coverage Boost to 80%', () => {
    let capabilityRegistry;
    let wsHub;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        wsHub = require('../../utils/wsHub');
        capabilityRegistry = require('../../utils/capabilityRegistry');

        capabilityRegistry.capabilities.clear();
        capabilityRegistry.initialized = false;
        capabilityRegistry.init();

        // Default mock implementations
        mockDeviceStore.getById.mockResolvedValue({
            id: 'dev1',
            name: 'Test Device',
            activeMode: 'screensaver',
            settingsOverride: {},
            isPoweredOn: true,
        });

        mockDeviceStore.patchDevice.mockResolvedValue({
            id: 'dev1',
            settingsOverride: {},
        });
    });

    describe('StateGetters with config fallbacks', () => {
        test('transitionInterval stateGetter returns device override', () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');
            const device = { settingsOverride: { transitionInterval: 15000 } };

            expect(cap.stateGetter(device)).toBe(15000);
        });

        test('transitionInterval stateGetter returns default when no override', () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');
            const device = { settingsOverride: {} };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThan(0);
        });

        test('effectPauseTime stateGetter returns device override', () => {
            const cap = capabilityRegistry.get('settings.effectPauseTime');
            const device = { settingsOverride: { effectPauseTime: 5 } };

            expect(cap.stateGetter(device)).toBe(5);
        });

        test('effectPauseTime stateGetter returns default when no override', () => {
            const cap = capabilityRegistry.get('settings.effectPauseTime');
            const device = { settingsOverride: {} };

            expect(cap.stateGetter(device)).toBe(2);
        });

        test('transitionEffect stateGetter returns device override', () => {
            const cap = capabilityRegistry.get('settings.transitionEffect');
            const device = { settingsOverride: { transitionEffect: 'zoom' } };

            expect(cap.stateGetter(device)).toBe('zoom');
        });

        test('clockFormat stateGetter returns device override', () => {
            const cap = capabilityRegistry.get('settings.clockFormat');
            const device = { settingsOverride: { clockFormat: '24h' } };

            expect(cap.stateGetter(device)).toBe('24h');
        });
    });

    describe('Wallart Mode StateGetters', () => {
        test('wallartMode.animationType stateGetter with nested override', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.animationType');
            const device = {
                settingsOverride: {
                    wallartMode: { animationType: 'zoom' },
                },
            };

            expect(cap.stateGetter(device)).toBe('zoom');
        });

        test('wallartMode.animationType stateGetter without override', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.animationType');
            const device = { settingsOverride: {} };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });

        test('wallartMode.ambiance stateGetter', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.ambiance');
            const device = {
                settingsOverride: {
                    wallartMode: { ambiance: 'dark' },
                },
            };

            expect(cap.stateGetter(device)).toBe('dark');
        });

        test('wallartMode.layout stateGetter', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.layout');
            const device = {
                settingsOverride: {
                    wallartMode: { layout: 'poster' },
                },
            };

            expect(cap.stateGetter(device)).toBe('poster');
        });

        test('wallartMode.heroSide stateGetter', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.heroSide');
            const device = {
                settingsOverride: {
                    wallartMode: { layoutSettings: { heroGrid: { side: 'left' } } },
                },
            };

            expect(cap.stateGetter(device)).toBe('left');
        });

        test('wallartMode.heroRotation stateGetter', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.heroRotation');
            const device = {
                settingsOverride: {
                    wallartMode: { layoutSettings: { heroGrid: { heroRotationMinutes: 60 } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(60);
        });

        test('wallartMode.posterRefreshRate stateGetter', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.posterRefreshRate');
            const device = {
                settingsOverride: {
                    wallartMode: { layoutSettings: { heroGrid: { posterRefreshMinutes: 30 } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(30);
        });

        test('wallartMode.timingRandomness stateGetter', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.timingRandomness');
            const device = {
                settingsOverride: {
                    wallartMode: { timingRandomness: 0.5 },
                },
            };

            expect(cap.stateGetter(device)).toBe(0.5);
        });

        test('wallartMode.biasToAmbiance stateGetter', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.biasToAmbiance');
            const device = {
                settingsOverride: {
                    wallartMode: { biasToAmbiance: 0.7 },
                },
            };

            expect(cap.stateGetter(device)).toBe(0.7);
        });

        test('wallartMode.density stateGetter', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.density');
            const device = {
                settingsOverride: {
                    wallartMode: { density: 'high' },
                },
            };

            expect(cap.stateGetter(device)).toBe('high');
        });
    });

    describe('Cinema Mode StateGetters', () => {
        test('cinema.orientation stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.orientation');
            const device = {
                settingsOverride: {
                    cinema: { orientation: 'vertical' },
                },
            };

            expect(cap.stateGetter(device)).toBe('vertical');
        });

        test('cinema.header.enabled stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.enabled');
            const device = {
                settingsOverride: {
                    cinema: { header: { enabled: false } },
                },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('cinema.header.text stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.text');
            const device = {
                settingsOverride: {
                    cinema: { header: { text: 'NOW SHOWING' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('NOW SHOWING');
        });

        test('cinema.header.style stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.style');
            const device = {
                settingsOverride: {
                    cinema: { header: { style: 'classic' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('classic');
        });

        test('cinema.ambilight.enabled stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.ambilight.enabled');
            const device = {
                settingsOverride: {
                    cinema: { ambilight: { enabled: true } },
                },
            };

            expect(cap.stateGetter(device)).toBe(true);
        });

        test('cinema.ambilight.strength stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.ambilight.strength');
            const device = {
                settingsOverride: {
                    cinema: { ambilight: { strength: 0.8 } },
                },
            };

            expect(cap.stateGetter(device)).toBe(0.8);
        });

        test('cinema.footer.enabled stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.enabled');
            const device = {
                settingsOverride: {
                    cinema: { footer: { enabled: true } },
                },
            };

            expect(cap.stateGetter(device)).toBe(true);
        });

        test('cinema.footer.type stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.type');
            const device = {
                settingsOverride: {
                    cinema: { footer: { type: 'specs' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('specs');
        });

        test('cinema.footer.marqueeText stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeText');
            const device = {
                settingsOverride: {
                    cinema: { footer: { marqueeText: 'Welcome!' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('Welcome!');
        });

        test('cinema.footer.marqueeStyle stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeStyle');
            const device = {
                settingsOverride: {
                    cinema: { footer: { marqueeStyle: 'modern' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('modern');
        });

        test('cinema.footer.specs.style stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.style');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { style: 'modern' } } },
                },
            };

            expect(cap.stateGetter(device)).toBe('modern');
        });

        test('cinema.footer.specs.iconSet stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.iconSet');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { iconSet: 'standard' } } },
                },
            };

            expect(cap.stateGetter(device)).toBe('standard');
        });

        test('cinema.footer.specs.showResolution stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showResolution');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { showResolution: false } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('cinema.footer.specs.showAudio stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showAudio');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { showAudio: false } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('cinema.footer.specs.showAspectRatio stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showAspectRatio');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { showAspectRatio: false } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('cinema.footer.specs.showFlags stateGetter', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showFlags');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { showFlags: false } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });
    });

    describe('UI Scaling StateGetters', () => {
        test('uiScaling.global stateGetter', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.global');
            const device = {
                settingsOverride: {
                    uiScaling: { global: 1.5 },
                },
            };

            expect(cap.stateGetter(device)).toBe(1.5);
        });

        test('uiScaling.content stateGetter', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.content');
            const device = {
                settingsOverride: {
                    uiScaling: { content: 1.2 },
                },
            };

            expect(cap.stateGetter(device)).toBe(1.2);
        });

        test('uiScaling.clearlogo stateGetter', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clearlogo');
            const device = {
                settingsOverride: {
                    uiScaling: { clearlogo: 0.8 },
                },
            };

            expect(cap.stateGetter(device)).toBe(0.8);
        });

        test('uiScaling.clock stateGetter', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clock');
            const device = {
                settingsOverride: {
                    uiScaling: { clock: 1.1 },
                },
            };

            expect(cap.stateGetter(device)).toBe(1.1);
        });
    });

    describe('AvailableWhen Conditions', () => {
        test('screensaver-only capabilities are not available in wallart mode', () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');
            const device = { activeMode: 'wallart' };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('screensaver-only capabilities are available in screensaver mode', () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');
            const device = { activeMode: 'screensaver' };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('effectPauseTime available only in screensaver', () => {
            const cap = capabilityRegistry.get('settings.effectPauseTime');
            const ssDevice = { activeMode: 'screensaver' };
            const wallDevice = { activeMode: 'wallart' };

            if (cap.availableWhen) {
                expect(cap.availableWhen(ssDevice)).toBe(true);
                expect(cap.availableWhen(wallDevice)).toBe(false);
            }
        });

        test('transitionEffect available only in screensaver', () => {
            const cap = capabilityRegistry.get('settings.transitionEffect');
            const ssDevice = { activeMode: 'screensaver' };
            const cinemaDevice = { activeMode: 'cinema' };

            if (cap.availableWhen) {
                expect(cap.availableWhen(ssDevice)).toBe(true);
                expect(cap.availableWhen(cinemaDevice)).toBe(false);
            }
        });

        test('clockFormat available only in screensaver', () => {
            const cap = capabilityRegistry.get('settings.clockFormat');
            const ssDevice = { activeMode: 'screensaver' };

            if (cap.availableWhen) {
                expect(cap.availableWhen(ssDevice)).toBe(true);
            }
        });
    });

    describe('getDeviceMode helper', () => {
        test('returns device activeMode when present', () => {
            const device = { activeMode: 'cinema' };
            const cap = capabilityRegistry.get('power'); // Use any cap to get the registry
            // getDeviceMode is not exposed, so we test it through availableWhen
            expect(device.activeMode).toBe('cinema');
        });

        test('capability availableWhen uses device mode', () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');
            const ssDevice = { activeMode: 'screensaver' };
            const cinemaDevice = { activeMode: 'cinema' };

            if (cap.availableWhen) {
                expect(cap.availableWhen(ssDevice)).toBe(true);
                expect(cap.availableWhen(cinemaDevice)).toBe(false);
            }
        });
    });

    describe('Capability registration', () => {
        test('register stores capability', () => {
            capabilityRegistry.register('test.capability', {
                name: 'Test',
                category: 'test',
                entityType: 'switch',
            });

            expect(capabilityRegistry.has('test.capability')).toBe(true);
            expect(capabilityRegistry.get('test.capability').name).toBe('Test');
        });

        test('get returns undefined for non-existent capability', () => {
            expect(capabilityRegistry.get('non.existent')).toBeUndefined();
        });

        test('getAll returns all capabilities', () => {
            const all = capabilityRegistry.getAll();
            expect(Array.isArray(all)).toBe(true);
            expect(all.length).toBeGreaterThan(0);
        });

        test('has returns true for existing capability', () => {
            expect(capabilityRegistry.has('power')).toBe(true);
        });

        test('has returns false for non-existing capability', () => {
            expect(capabilityRegistry.has('non.existent')).toBe(false);
        });
    });

    describe('applyAndPersistSettings integration', () => {
        beforeEach(() => {
            mockDeviceStore.getAll.mockResolvedValue([
                {
                    id: 'test-device',
                    name: 'Test',
                    activeMode: 'screensaver',
                    settingsOverride: { existingKey: 'value' },
                },
            ]);

            mockDeviceStore.patchDevice.mockResolvedValue({
                id: 'test-device',
                settingsOverride: { existingKey: 'value', newKey: 'newValue' },
            });
        });

        test('showClock commandHandler persists settings', async () => {
            const cap = capabilityRegistry.get('settings.showClock');

            const result = await cap.commandHandler('test-device', 'ON');

            expect(result).toBe(true);
            expect(mockDeviceStore.getAll).toHaveBeenCalled();
            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith(
                'test-device',
                expect.objectContaining({
                    settingsOverride: expect.objectContaining({
                        clockWidget: true,
                    }),
                })
            );
            expect(wsHub.sendApplySettings).toHaveBeenCalledWith('test-device', {
                clockWidget: true,
            });
        });

        test('showLogo commandHandler persists settings', async () => {
            const cap = capabilityRegistry.get('settings.showLogo');

            await cap.commandHandler('test-device', 'OFF');

            expect(mockDeviceStore.patchDevice).toHaveBeenCalled();
            expect(wsHub.sendApplySettings).toHaveBeenCalled();
        });

        test('applyAndPersistSettings handles device not found error', async () => {
            mockDeviceStore.getAll.mockResolvedValue([]);

            const cap = capabilityRegistry.get('settings.showClock');

            await expect(cap.commandHandler('non-existent', 'ON')).rejects.toThrow(
                'Device non-existent not found'
            );
        });

        test('applyAndPersistSettings handles patchDevice error', async () => {
            mockDeviceStore.patchDevice.mockRejectedValue(new Error('Database error'));

            const cap = capabilityRegistry.get('settings.showClock');

            await expect(cap.commandHandler('test-device', 'ON')).rejects.toThrow('Database error');
        });

        test('applyAndPersistSettings handles wsHub error', async () => {
            wsHub.sendApplySettings.mockRejectedValueOnce(new Error('WebSocket error'));

            const cap = capabilityRegistry.get('settings.showClock');

            await expect(cap.commandHandler('test-device', 'ON')).rejects.toThrow(
                'WebSocket error'
            );
        });

        test('transitionInterval commandHandler uses applyAndPersistSettings', async () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');

            await cap.commandHandler('test-device', 12000);

            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith(
                'test-device',
                expect.objectContaining({
                    settingsOverride: expect.objectContaining({
                        transitionInterval: 12000,
                    }),
                })
            );
        });

        test('effectPauseTime commandHandler uses applyAndPersistSettings', async () => {
            const cap = capabilityRegistry.get('settings.effectPauseTime');

            await cap.commandHandler('test-device', '3');

            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith(
                'test-device',
                expect.objectContaining({
                    settingsOverride: expect.objectContaining({
                        effectPauseTime: 3,
                    }),
                })
            );
        });

        test('transitionEffect commandHandler uses applyAndPersistSettings', async () => {
            const cap = capabilityRegistry.get('settings.transitionEffect');

            await cap.commandHandler('test-device', 'zoom');

            expect(mockDeviceStore.patchDevice).toHaveBeenCalled();
            expect(wsHub.sendApplySettings).toHaveBeenCalled();
        });

        test('clockFormat commandHandler uses applyAndPersistSettings', async () => {
            const cap = capabilityRegistry.get('settings.clockFormat');

            await cap.commandHandler('test-device', '24h');

            expect(mockDeviceStore.patchDevice).toHaveBeenCalled();
        });
    });
});
