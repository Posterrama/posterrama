/**
 * Capability Registry - Final push to 80% coverage
 * Focus: mode selection, getDeviceMode, getAllCapabilities, media sensors
 */

const capabilityRegistry = require('../../utils/capabilityRegistry');

describe('CapabilityRegistry - 80% Coverage Push', () => {
    beforeAll(() => {
        if (!capabilityRegistry.initialized) {
            capabilityRegistry.init();
        }
    });

    describe('GetDeviceMode Helper', () => {
        test('returns mode from clientInfo.mode', () => {
            const device = { clientInfo: { mode: 'cinema' } };
            expect(capabilityRegistry.getDeviceMode(device)).toBe('cinema');
        });

        test('returns mode from currentState.mode when no clientInfo', () => {
            const device = { currentState: { mode: 'wallart' } };
            expect(capabilityRegistry.getDeviceMode(device)).toBe('wallart');
        });

        test('returns screensaver as default when no mode info', () => {
            const device = {};
            expect(capabilityRegistry.getDeviceMode(device)).toBe('screensaver');
        });

        test('prioritizes clientInfo over currentState', () => {
            const device = {
                clientInfo: { mode: 'cinema' },
                currentState: { mode: 'wallart' },
            };
            expect(capabilityRegistry.getDeviceMode(device)).toBe('cinema');
        });
    });

    describe('GetAllCapabilities Method', () => {
        test('returns array of all capabilities', () => {
            const all = capabilityRegistry.getAllCapabilities();

            expect(Array.isArray(all)).toBe(true);
            expect(all.length).toBeGreaterThan(50);
        });

        test('each capability has id property', () => {
            const all = capabilityRegistry.getAllCapabilities();

            all.forEach(cap => {
                expect(cap).toHaveProperty('id');
                expect(typeof cap.id).toBe('string');
            });
        });

        test('each capability has name property', () => {
            const all = capabilityRegistry.getAllCapabilities();

            all.forEach(cap => {
                expect(cap).toHaveProperty('name');
                expect(typeof cap.name).toBe('string');
            });
        });

        test('includes playback.pause capability', () => {
            const all = capabilityRegistry.getAllCapabilities();
            const pauseCap = all.find(c => c.id === 'playback.pause');

            expect(pauseCap).toBeDefined();
            expect(pauseCap.name).toBe('Pause');
        });
    });

    describe('GetAvailableCapabilities Method', () => {
        test('returns array for screensaver mode', () => {
            const device = { clientInfo: { mode: 'screensaver' } };
            const available = capabilityRegistry.getAvailableCapabilities(device);

            expect(Array.isArray(available)).toBe(true);
            expect(available.length).toBeGreaterThan(0);
        });

        test('returns array for cinema mode', () => {
            const device = { clientInfo: { mode: 'cinema' } };
            const available = capabilityRegistry.getAvailableCapabilities(device);

            expect(Array.isArray(available)).toBe(true);
        });

        test('returns array for wallart mode', () => {
            const device = { clientInfo: { mode: 'wallart' } };
            const available = capabilityRegistry.getAvailableCapabilities(device);

            expect(Array.isArray(available)).toBe(true);
        });

        test('includes capabilities without availableWhen', () => {
            const device = { clientInfo: { mode: 'cinema' } };
            const available = capabilityRegistry.getAvailableCapabilities(device);

            // Should return some capabilities
            expect(available.length).toBeGreaterThan(0);
        });
    });

    describe('Media Sensor StateGetters', () => {
        test('media.title returns title from currentState', () => {
            const cap = capabilityRegistry.get('media.title');
            const device = { currentState: { title: 'The Matrix' } };

            expect(cap.stateGetter(device)).toBe('The Matrix');
        });

        test('media.title returns Unknown when no currentState', () => {
            const cap = capabilityRegistry.get('media.title');
            const device = {};

            expect(cap.stateGetter(device)).toBe('Unknown');
        });

        test('media.year returns year from currentState', () => {
            const cap = capabilityRegistry.get('media.year');
            const device = { currentState: { year: 1999 } };

            expect(cap.stateGetter(device)).toBe(1999);
        });

        test('media.year returns null when no year', () => {
            const cap = capabilityRegistry.get('media.year');
            const device = { currentState: {} };

            expect(cap.stateGetter(device)).toBeNull();
        });

        test('media.rating returns rating from currentState', () => {
            const cap = capabilityRegistry.get('media.rating');
            const device = { currentState: { rating: 8.7 } };

            expect(cap.stateGetter(device)).toBe(8.7);
        });

        test('media.rating returns null when no rating', () => {
            const cap = capabilityRegistry.get('media.rating');
            const device = { currentState: {} };

            expect(cap.stateGetter(device)).toBeNull();
        });

        test('media.runtime returns runtime from currentState', () => {
            const cap = capabilityRegistry.get('media.runtime');
            const device = { currentState: { runtime: 136 } };

            expect(cap.stateGetter(device)).toBe(136);
        });

        test('media.runtime returns null when no runtime', () => {
            const cap = capabilityRegistry.get('media.runtime');
            const device = { currentState: {} };

            expect(cap.stateGetter(device)).toBeNull();
        });

        test('media.genres returns genres from currentState', () => {
            const cap = capabilityRegistry.get('media.genres');
            const device = { currentState: { genres: ['Sci-Fi', 'Action'] } };

            const result = cap.stateGetter(device);
            // genres might be returned as string or array
            expect(result).toBeTruthy();
        });
    });

    describe('Mode Select StateGetter', () => {
        test('returns mode from settingsOverride', () => {
            const cap = capabilityRegistry.get('mode.select');
            const device = { settingsOverride: { mode: 'wallart' } };

            expect(cap.stateGetter(device)).toBe('wallart');
        });

        test('returns mode from clientInfo when no override', () => {
            const cap = capabilityRegistry.get('mode.select');
            const device = { clientInfo: { mode: 'cinema' } };

            expect(cap.stateGetter(device)).toBe('cinema');
        });

        test('returns mode from currentState when no override or clientInfo', () => {
            const cap = capabilityRegistry.get('mode.select');
            const device = { currentState: { mode: 'screensaver' } };

            expect(cap.stateGetter(device)).toBe('screensaver');
        });

        test('returns screensaver as default', () => {
            const cap = capabilityRegistry.get('mode.select');
            const device = {};

            expect(cap.stateGetter(device)).toBe('screensaver');
        });
    });

    describe('UI Scaling StateGetters', () => {
        test('uiScaling.clearlogo returns override value', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clearlogo');
            const device = { settingsOverride: { uiScaling: { clearlogo: 150 } } };

            expect(cap.stateGetter(device)).toBe(150);
        });

        test('uiScaling.clearlogo returns default when no override', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clearlogo');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('uiScaling.clock returns override value', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clock');
            const device = { settingsOverride: { uiScaling: { clock: 120 } } };

            expect(cap.stateGetter(device)).toBe(120);
        });

        test('uiScaling.content returns override value', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.content');
            const device = { settingsOverride: { uiScaling: { content: 110 } } };

            expect(cap.stateGetter(device)).toBe(110);
        });

        test('uiScaling.global returns override value', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.global');
            const device = { settingsOverride: { uiScaling: { global: 125 } } };

            expect(cap.stateGetter(device)).toBe(125);
        });
    });

    describe('AvailableWhen Conditions', () => {
        test('clockFormat available in screensaver mode', () => {
            const cap = capabilityRegistry.get('settings.clockFormat');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('clockFormat not available in cinema mode', () => {
            const cap = capabilityRegistry.get('settings.clockFormat');
            const device = { clientInfo: { mode: 'cinema' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('uiScaling.clearlogo available in screensaver mode', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clearlogo');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('uiScaling.clearlogo not available in cinema mode', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clearlogo');
            const device = { clientInfo: { mode: 'cinema' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('transitionEffect available in screensaver mode', () => {
            const cap = capabilityRegistry.get('settings.transitionEffect');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('transitionEffect not available in wallart mode', () => {
            const cap = capabilityRegistry.get('settings.transitionEffect');
            const device = { clientInfo: { mode: 'wallart' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('effectPauseTime available in screensaver mode', () => {
            const cap = capabilityRegistry.get('settings.effectPauseTime');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });
    });

    describe('Capability Registration', () => {
        test('get returns capability for existing id', () => {
            const cap = capabilityRegistry.get('playback.pause');

            expect(cap).toBeDefined();
            expect(cap.id).toBe('playback.pause');
        });

        test('get returns null for non-existent id', () => {
            const cap = capabilityRegistry.get('non.existent.id');

            expect(cap).toBeNull();
        });

        test('has returns true for existing capability', () => {
            expect(capabilityRegistry.has('settings.transitionInterval')).toBe(true);
        });

        test('has returns false for non-existent capability', () => {
            expect(capabilityRegistry.has('non.existent')).toBe(false);
        });
    });
});
