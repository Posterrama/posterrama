/**
 * Comprehensive tests for all settings capability commandHandlers
 * Target: capabilityRegistry.js coverage boost (currently 44%)
 */

const capabilityRegistry = require('../../utils/capabilityRegistry');
const deviceStore = require('../../utils/deviceStore');

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../../utils/deviceStore');
jest.mock('../../utils/wsHub');

describe('CapabilityRegistry - All Settings CommandHandlers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        capabilityRegistry.init({
            sendCommand: jest.fn(),
            sendApplySettings: jest.fn(),
        });
        deviceStore.patchDevice.mockResolvedValue({});
        deviceStore.getById.mockImplementation(id =>
            Promise.resolve({
                id,
                settingsOverride: {},
                isPoweredOn: true,
                isPinned: false,
            })
        );
        deviceStore.getAll.mockImplementation(() =>
            Promise.resolve([
                { id: 'dev1', settingsOverride: {}, isPoweredOn: true },
                { id: 'dev2', settingsOverride: {}, isPoweredOn: true },
                { id: 'dev3', settingsOverride: {}, isPoweredOn: true },
                { id: 'dev4', settingsOverride: {}, isPoweredOn: true },
                { id: 'dev5', settingsOverride: {}, isPoweredOn: true },
                { id: 'dev6', settingsOverride: {}, isPoweredOn: true },
                { id: 'dev7', settingsOverride: {}, isPoweredOn: true },
                { id: 'dev8', settingsOverride: {}, isPoweredOn: true },
            ])
        );
    });

    describe('wallartMode settings', () => {
        test('animationType commandHandler', async () => {
            const device = { id: 'dev1', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.wallartMode.animationType');

            await cap.commandHandler(device.id, 'fade');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev1', expect.any(Object));
        });

        test('ambiance commandHandler', async () => {
            const device = { id: 'dev2', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.wallartMode.ambiance');

            await cap.commandHandler(device.id, 'cinematic');

            // This capability is deprecated/no-op (availableWhen=false), so it shouldn't persist.
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('layout commandHandler', async () => {
            const device = { id: 'dev3', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.wallartMode.layout');

            await cap.commandHandler(device.id, 'poster');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev3', expect.any(Object));
        });

        test('heroSide commandHandler', async () => {
            const device = { id: 'dev4', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.wallartMode.heroSide');

            await cap.commandHandler(device.id, 'left');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev4', expect.any(Object));
        });

        test('heroRotation commandHandler', async () => {
            const device = { id: 'dev5', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.wallartMode.heroRotation');

            await cap.commandHandler(device.id, 60);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev5', expect.any(Object));
        });

        test('posterRefreshRate commandHandler', async () => {
            const device = { id: 'dev6', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.wallartMode.posterRefreshRate');

            await cap.commandHandler(device.id, 45);

            // Deprecated/no-op
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('timingRandomness commandHandler', async () => {
            const device = { id: 'dev7', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.wallartMode.timingRandomness');

            await cap.commandHandler(device.id, 0.3);

            // Deprecated/no-op
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('biasToAmbiance commandHandler', async () => {
            const device = { id: 'dev8', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.wallartMode.biasToAmbiance');

            await cap.commandHandler(device.id, 0.7);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev8', expect.any(Object));
        });

        test('density commandHandler', async () => {
            const device = { id: 'dev9', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.wallartMode.density');

            await cap.commandHandler(device.id, 'high');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev9', expect.any(Object));
        });
    });

    describe('cinema settings', () => {
        test('orientation commandHandler', async () => {
            const device = { id: 'dev1', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.orientation');

            await cap.commandHandler(device.id, 'vertical');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev1', expect.any(Object));
        });

        test('poster.cinematicTransitions.selectionMode commandHandler', async () => {
            const device = { id: 'dev1', settingsOverride: {} };
            const cap = capabilityRegistry.get(
                'settings.cinema.poster.cinematicTransitions.selectionMode'
            );

            await cap.commandHandler(device.id, 'single');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev1', expect.any(Object));
        });

        test('poster.cinematicTransitions.singleTransition commandHandler', async () => {
            const device = { id: 'dev2', settingsOverride: {} };
            const cap = capabilityRegistry.get(
                'settings.cinema.poster.cinematicTransitions.singleTransition'
            );

            // Use a legacy value to verify mapping via cinema-transition-compat
            await cap.commandHandler(device.id, 'zoomIn');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev2', {
                settingsOverride: {
                    cinema: {
                        poster: {
                            cinematicTransitions: {
                                singleTransition: 'dollyIn',
                            },
                        },
                    },
                },
            });
        });

        test('poster.cinematicTransitions.enabled.fade commandHandler', async () => {
            const device = { id: 'dev3', settingsOverride: {} };
            const cap = capabilityRegistry.get(
                'settings.cinema.poster.cinematicTransitions.enabled.fade'
            );

            await cap.commandHandler(device.id, true);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev3', expect.any(Object));
        });

        test('header.enabled commandHandler', async () => {
            const device = { id: 'dev2', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.header.enabled');

            await cap.commandHandler(device.id, true);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev2', expect.any(Object));
        });

        test('header.text commandHandler', async () => {
            const device = { id: 'dev3', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.header.text');

            await cap.commandHandler(device.id, 'NOW PLAYING');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev3', expect.any(Object));
        });

        test('header.style commandHandler', async () => {
            const device = { id: 'dev4', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.header.style');

            await cap.commandHandler(device.id, 'classic');

            // Deprecated/no-op (modern schema uses header.typography.*)
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('ambilight.enabled commandHandler', async () => {
            const device = { id: 'dev5', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.ambilight.enabled');

            await cap.commandHandler(device.id, true);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev5', expect.any(Object));
        });

        test('ambilight.strength commandHandler', async () => {
            const device = { id: 'dev6', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.ambilight.strength');

            await cap.commandHandler(device.id, 0.8);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev6', expect.any(Object));
        });

        test('footer.enabled commandHandler', async () => {
            const device = { id: 'dev7', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.enabled');

            await cap.commandHandler(device.id, true);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev7', expect.any(Object));
        });

        test('footer.type commandHandler', async () => {
            const device = { id: 'dev8', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.type');

            await cap.commandHandler(device.id, 'specs');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev8', expect.any(Object));
        });

        test('footer.marqueeText commandHandler', async () => {
            const device = { id: 'dev9', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeText');

            await cap.commandHandler(device.id, 'Welcome to our cinema!');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev9', expect.any(Object));
        });

        test('footer.marqueeStyle commandHandler', async () => {
            const device = { id: 'dev10', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeStyle');

            await cap.commandHandler(device.id, 'classic');

            // Deprecated/no-op (modern schema uses footer.typography.*)
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('footer.specs.style commandHandler', async () => {
            const device = { id: 'dev11', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.style');

            await cap.commandHandler(device.id, 'modern');

            // Deprecated/no-op (replaced by cinema.metadata.specs.*)
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('footer.specs.iconSet commandHandler', async () => {
            const device = { id: 'dev12', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.iconSet');

            await cap.commandHandler(device.id, 'standard');

            // Deprecated/no-op
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('footer.specs.showResolution commandHandler', async () => {
            const device = { id: 'dev13', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showResolution');

            await cap.commandHandler(device.id, true);

            // Deprecated/no-op
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('footer.specs.showAudio commandHandler', async () => {
            const device = { id: 'dev14', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showAudio');

            await cap.commandHandler(device.id, true);

            // Deprecated/no-op
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('footer.specs.showAspectRatio commandHandler', async () => {
            const device = { id: 'dev15', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showAspectRatio');

            await cap.commandHandler(device.id, true);

            // Deprecated/no-op
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });

        test('footer.specs.showFlags commandHandler', async () => {
            const device = { id: 'dev16', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showFlags');

            await cap.commandHandler(device.id, true);

            // Deprecated/no-op
            expect(deviceStore.patchDevice).not.toHaveBeenCalled();
        });
    });

    describe('uiScaling settings', () => {
        test('global commandHandler', async () => {
            const device = { id: 'dev1', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.uiScaling.global');

            await cap.commandHandler(device.id, 1.2);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev1', expect.any(Object));
        });

        test('content commandHandler', async () => {
            const device = { id: 'dev2', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.uiScaling.content');

            await cap.commandHandler(device.id, 1.5);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev2', expect.any(Object));
        });

        test('clearlogo commandHandler', async () => {
            const device = { id: 'dev3', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.uiScaling.clearlogo');

            await cap.commandHandler(device.id, 0.8);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev3', expect.any(Object));
        });

        test('clock commandHandler', async () => {
            const device = { id: 'dev4', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.uiScaling.clock');

            await cap.commandHandler(device.id, 1.1);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev4', expect.any(Object));
        });
    });

    describe('base settings', () => {
        test('transitionInterval commandHandler', async () => {
            const device = { id: 'dev1', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.transitionInterval');

            await cap.commandHandler(device.id, 8000);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev1', expect.any(Object));
        });

        test('effectPauseTime commandHandler', async () => {
            const device = { id: 'dev2', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.effectPauseTime');

            await cap.commandHandler(device.id, 500);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev2', expect.any(Object));
        });

        test('transitionEffect commandHandler', async () => {
            const device = { id: 'dev3', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.transitionEffect');

            await cap.commandHandler(device.id, 'fade');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev3', expect.any(Object));
        });

        test('clockFormat commandHandler', async () => {
            const device = { id: 'dev4', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.clockFormat');

            await cap.commandHandler(device.id, '24h');

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev4', expect.any(Object));
        });

        test('showClock commandHandler', async () => {
            const device = { id: 'dev5', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.showClock');

            await cap.commandHandler(device.id, true);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev5', expect.any(Object));
        });

        test('showLogo commandHandler', async () => {
            const device = { id: 'dev6', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.showLogo');

            await cap.commandHandler(device.id, true);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev6', expect.any(Object));
        });

        test('showMetadata commandHandler', async () => {
            const device = { id: 'dev7', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.showMetadata');

            await cap.commandHandler(device.id, true);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev7', expect.any(Object));
        });

        test('showRottenTomatoes commandHandler', async () => {
            const device = { id: 'dev8', settingsOverride: {} };
            const cap = capabilityRegistry.get('settings.showRottenTomatoes');

            await cap.commandHandler(device.id, true);

            expect(deviceStore.patchDevice).toHaveBeenCalledWith('dev8', expect.any(Object));
        });
    });

    describe('stateGetters with device overrides', () => {
        test('wallartMode.animationType stateGetter returns device override', () => {
            const device = {
                id: 'dev1',
                settingsOverride: {
                    wallartMode: { animationType: 'zoom' },
                },
            };
            const cap = capabilityRegistry.get('settings.wallartMode.animationType');

            const result = cap.stateGetter(device);

            expect(result).toBe('zoom');
        });

        test('cinema.orientation stateGetter returns device override', () => {
            const device = {
                id: 'dev2',
                settingsOverride: {
                    cinema: { orientation: 'vertical' },
                },
            };
            const cap = capabilityRegistry.get('settings.cinema.orientation');

            const result = cap.stateGetter(device);

            expect(result).toBe('vertical');
        });

        test('uiScaling.global stateGetter returns device override', () => {
            const device = {
                id: 'dev3',
                settingsOverride: {
                    uiScaling: { global: 1.5 },
                },
            };
            const cap = capabilityRegistry.get('settings.uiScaling.global');

            const result = cap.stateGetter(device);

            expect(result).toBe(1.5);
        });
    });
});
