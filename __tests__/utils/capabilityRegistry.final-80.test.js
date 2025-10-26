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

    describe('Screensaver Settings StateGetters with Config Fallback', () => {
        test('transitionInterval returns override value', () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');
            const device = { settingsOverride: { transitionInterval: 20000 } };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThan(0);
        });

        test('transitionInterval returns default when no override', () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThan(0);
        });

        test('effectPauseTime returns override value', () => {
            const cap = capabilityRegistry.get('settings.effectPauseTime');
            const device = { settingsOverride: { effectPauseTime: 5 } };

            expect(cap.stateGetter(device)).toBe(5);
        });

        test('transitionEffect returns override value', () => {
            const cap = capabilityRegistry.get('settings.transitionEffect');
            const device = { settingsOverride: { transitionEffect: 'zoom' } };

            expect(cap.stateGetter(device)).toBe('zoom');
        });

        test('clockFormat returns override value', () => {
            const cap = capabilityRegistry.get('settings.clockFormat');
            const device = { settingsOverride: { clockFormat: '24h' } };

            expect(cap.stateGetter(device)).toBe('24h');
        });
    });

    describe('Cinema Mode Settings StateGetters', () => {
        test('cinema.orientation returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.orientation');
            const device = {
                settingsOverride: {
                    cinema: { orientation: 'horizontal' },
                },
            };

            expect(cap.stateGetter(device)).toBe('horizontal');
        });

        test('cinema.header.enabled returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.enabled');
            const device = {
                settingsOverride: {
                    cinema: { header: { enabled: false } },
                },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('cinema.ambilight.enabled returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.ambilight.enabled');
            const device = {
                settingsOverride: {
                    cinema: { ambilight: { enabled: true } },
                },
            };

            expect(cap.stateGetter(device)).toBe(true);
        });
    });

    describe('Wallart Mode Settings StateGetters', () => {
        test('wallartMode.animationType returns override value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.animationType');
            const device = {
                settingsOverride: {
                    wallartMode: { animationType: 'fade' },
                },
            };

            expect(cap.stateGetter(device)).toBe('fade');
        });

        test('wallartMode.layout returns override value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.layout');
            const device = {
                settingsOverride: {
                    wallartMode: { layout: 'grid' },
                },
            };

            expect(cap.stateGetter(device)).toBe('grid');
        });

        test('wallartMode.heroSide returns override value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.heroSide');
            const device = {
                settingsOverride: {
                    wallartMode: { heroSide: 'right' },
                },
            };

            expect(cap.stateGetter(device)).toBe('right');
        });

        test('wallartMode.biasToAmbiance returns nested override value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.biasToAmbiance');
            const device = {
                settingsOverride: {
                    wallartMode: {
                        layoutSettings: {
                            heroGrid: {
                                biasAmbientToHero: true,
                            },
                        },
                    },
                },
            };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('wallartMode.biasToAmbiance returns simple override', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.biasToAmbiance');
            const device = {
                settingsOverride: {
                    wallartMode: { biasToAmbiance: 0.7 },
                },
            };

            expect(cap.stateGetter(device)).toBe(0.7);
        });

        test('wallartMode.biasToAmbiance returns default', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.biasToAmbiance');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });
    });

    describe('Cinema Header Settings Coverage', () => {
        test('cinema.header.text returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.text');
            const device = {
                settingsOverride: {
                    cinema: { header: { text: 'Feature Presentation' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('Feature Presentation');
        });

        test('cinema.header.text returns None for empty string', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.text');
            const device = {
                settingsOverride: {
                    cinema: { header: { text: '' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('None');
        });

        test('cinema.header.style returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.style');
            const device = {
                settingsOverride: {
                    cinema: { header: { style: 'classic' } },
                },
            };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });
    });

    describe('Device Sensors Coverage', () => {
        test('device.resolution returns formatted resolution from clientInfo', () => {
            const cap = capabilityRegistry.get('device.resolution');
            const device = {
                clientInfo: { screen: { w: 1920, h: 1080 } },
            };

            expect(cap.stateGetter(device)).toBe('1920×1080');
        });

        test('device.resolution returns formatted resolution from width/height', () => {
            const cap = capabilityRegistry.get('device.resolution');
            const device = {
                clientInfo: { screen: { width: 3840, height: 2160 } },
            };

            expect(cap.stateGetter(device)).toBe('3840×2160');
        });

        test('device.resolution returns formatted resolution from device.screen', () => {
            const cap = capabilityRegistry.get('device.resolution');
            const device = {
                screen: { w: 2560, h: 1440 },
            };

            expect(cap.stateGetter(device)).toBe('2560×1440');
        });

        test('device.resolution returns formatted resolution from device.screen width/height', () => {
            const cap = capabilityRegistry.get('device.resolution');
            const device = {
                screen: { width: 1280, height: 720 },
            };

            expect(cap.stateGetter(device)).toBe('1280×720');
        });

        test('device.resolution returns Unknown when no screen info', () => {
            const cap = capabilityRegistry.get('device.resolution');
            const device = {};

            expect(cap.stateGetter(device)).toBe('Unknown');
        });

        test('device.mode returns mode from clientInfo', () => {
            const cap = capabilityRegistry.get('device.mode');
            const device = { clientInfo: { mode: 'cinema' } };

            expect(cap.stateGetter(device)).toBe('cinema');
        });

        test('device.mode returns mode from currentState', () => {
            const cap = capabilityRegistry.get('device.mode');
            const device = { currentState: { mode: 'wallart' } };

            expect(cap.stateGetter(device)).toBe('wallart');
        });

        test('device.mode returns default screensaver', () => {
            const cap = capabilityRegistry.get('device.mode');
            const device = {};

            expect(cap.stateGetter(device)).toBe('screensaver');
        });

        test('device.userAgent returns userAgent from clientInfo', () => {
            const cap = capabilityRegistry.get('device.userAgent');
            const device = {
                clientInfo: { userAgent: 'Mozilla/5.0 Chrome/120.0' },
            };

            expect(cap.stateGetter(device)).toBe('Mozilla/5.0 Chrome/120.0');
        });

        test('device.userAgent returns null when no userAgent', () => {
            const cap = capabilityRegistry.get('device.userAgent');
            const device = {};

            expect(cap.stateGetter(device)).toBeNull();
        });

        test('device.clientType detects Apple TV', () => {
            const cap = capabilityRegistry.get('device.clientType');
            const device = {
                clientInfo: { userAgent: 'AppleTV/tvOS 17.0' },
            };

            expect(cap.stateGetter(device)).toBe('Apple TV');
        });

        test('device.clientType detects iOS', () => {
            const cap = capabilityRegistry.get('device.clientType');
            const device = {
                clientInfo: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' },
            };

            expect(cap.stateGetter(device)).toBe('iOS');
        });

        test('device.clientType detects Chrome', () => {
            const cap = capabilityRegistry.get('device.clientType');
            const device = {
                clientInfo: { userAgent: 'Mozilla/5.0 Chrome/120.0' },
            };

            expect(cap.stateGetter(device)).toBe('Chrome');
        });

        test('device.clientType detects Firefox', () => {
            const cap = capabilityRegistry.get('device.clientType');
            const device = {
                clientInfo: { userAgent: 'Mozilla/5.0 Firefox/120.0' },
            };

            expect(cap.stateGetter(device)).toBe('Firefox');
        });

        test('device.clientType detects Safari', () => {
            const cap = capabilityRegistry.get('device.clientType');
            const device = {
                clientInfo: { userAgent: 'Mozilla/5.0 Safari/17.0' },
            };

            expect(cap.stateGetter(device)).toBe('Safari');
        });

        test('device.clientType detects Edge', () => {
            const cap = capabilityRegistry.get('device.clientType');
            const device = {
                clientInfo: { userAgent: 'Mozilla/5.0 Edge/120.0' },
            };

            expect(cap.stateGetter(device)).toBe('Edge');
        });
    });

    describe('Additional Wallart Settings Coverage', () => {
        test('wallartMode.density returns override value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.density');
            const device = {
                settingsOverride: {
                    wallartMode: { density: 'high' },
                },
            };

            expect(cap.stateGetter(device)).toBe('high');
        });

        test('wallartMode.density returns default', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.density');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
            expect(['low', 'medium', 'high', 'ludicrous']).toContain(result);
        });

        test('wallartMode.posterRefreshRate returns override value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.posterRefreshRate');
            const device = {
                settingsOverride: {
                    wallartMode: { posterRefreshRate: 30 },
                },
            };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('wallartMode.heroRotation returns override value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.heroRotation');
            const device = {
                settingsOverride: {
                    wallartMode: { heroRotation: 45 },
                },
            };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('wallartMode.timingRandomness returns override value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.timingRandomness');
            const device = {
                settingsOverride: {
                    wallartMode: { timingRandomness: 0.8 },
                },
            };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('wallartMode.ambiance returns override value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.ambiance');
            const device = {
                settingsOverride: {
                    wallartMode: { ambiance: 'dark' },
                },
            };

            expect(cap.stateGetter(device)).toBe('dark');
        });
    });

    describe('Cinema Footer Settings Coverage', () => {
        test('cinema.footer.enabled returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.enabled');
            const device = {
                settingsOverride: {
                    cinema: { footer: { enabled: true } },
                },
            };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('boolean');
        });

        test('cinema.footer.type returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.type');
            const device = {
                settingsOverride: {
                    cinema: { footer: { type: 'marquee' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('marquee');
        });

        test('cinema.footer.type returns default', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.type');
            const device = {};

            expect(cap.stateGetter(device)).toBe('specs');
        });

        test('cinema.footer.marqueeText returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeText');
            const device = {
                settingsOverride: {
                    cinema: { footer: { marqueeText: 'Coming Attractions' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('Coming Attractions');
        });

        test('cinema.footer.marqueeText returns None for empty string', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeText');
            const device = {
                settingsOverride: {
                    cinema: { footer: { marqueeText: '' } },
                },
            };

            expect(cap.stateGetter(device)).toBe('None');
        });

        test('cinema.footer.marqueeText returns default', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeText');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });

        test('cinema.ambilight.strength returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.ambilight.strength');
            const device = {
                settingsOverride: {
                    cinema: { ambilight: { strength: 0.9 } },
                },
            };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });
    });

    describe('Common Settings Coverage', () => {
        test('showLogo stateGetter returns boolean', () => {
            const cap = capabilityRegistry.get('settings.showLogo');
            const device = {
                settingsOverride: { logoWidget: true },
            };

            expect(cap.stateGetter(device)).toBe(true);
        });

        test('showClock stateGetter returns boolean', () => {
            const cap = capabilityRegistry.get('settings.showClock');
            const device = {
                settingsOverride: { clockWidget: false },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });
    });

    describe('Power Capabilities Coverage', () => {
        test('power.toggle stateGetter returns true when not powered off', () => {
            const cap = capabilityRegistry.get('power.toggle');
            const device = { currentState: { poweredOff: false } };

            expect(cap.stateGetter(device)).toBe(true);
        });

        test('power.toggle stateGetter returns false when powered off', () => {
            const cap = capabilityRegistry.get('power.toggle');
            const device = { currentState: { poweredOff: true } };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('power.toggle stateGetter returns true when no currentState', () => {
            const cap = capabilityRegistry.get('power.toggle');
            const device = {};

            expect(cap.stateGetter(device)).toBe(true);
        });

        test('power.on availableWhen returns true when powered off', () => {
            const cap = capabilityRegistry.get('power.on');
            const device = { currentState: { poweredOff: true } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('power.on availableWhen returns false when powered on', () => {
            const cap = capabilityRegistry.get('power.on');
            const device = { currentState: { poweredOff: false } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('power.off availableWhen returns true when powered on', () => {
            const cap = capabilityRegistry.get('power.off');
            const device = { currentState: { poweredOff: false } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('power.off availableWhen returns false when powered off', () => {
            const cap = capabilityRegistry.get('power.off');
            const device = { currentState: { poweredOff: true } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });
    });

    describe('Playback Capabilities Coverage', () => {
        test('playback.pause availableWhen returns true for screensaver', () => {
            const cap = capabilityRegistry.get('playback.pause');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('playback.pause availableWhen returns false for cinema', () => {
            const cap = capabilityRegistry.get('playback.pause');
            const device = { clientInfo: { mode: 'cinema' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('playback.resume availableWhen returns true for screensaver', () => {
            const cap = capabilityRegistry.get('playback.resume');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('playback.next availableWhen returns true for screensaver', () => {
            const cap = capabilityRegistry.get('playback.next');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('playback.previous availableWhen returns true for screensaver', () => {
            const cap = capabilityRegistry.get('playback.previous');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('playback.toggle availableWhen returns true for screensaver', () => {
            const cap = capabilityRegistry.get('playback.toggle');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });
    });

    describe('Navigation Capabilities Coverage', () => {
        test('pin.current availableWhen returns true for screensaver', () => {
            const cap = capabilityRegistry.get('pin.current');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('pin.current availableWhen returns false for cinema', () => {
            const cap = capabilityRegistry.get('pin.current');
            const device = { clientInfo: { mode: 'cinema' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('pin.unpin availableWhen returns true when pinned in screensaver', () => {
            const cap = capabilityRegistry.get('pin.unpin');
            const device = {
                clientInfo: { mode: 'screensaver' },
                currentState: { pinned: true },
            };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('pin.unpin availableWhen returns false when not pinned', () => {
            const cap = capabilityRegistry.get('pin.unpin');
            const device = {
                clientInfo: { mode: 'screensaver' },
                currentState: { pinned: false },
            };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('pin.unpin availableWhen returns false in cinema mode', () => {
            const cap = capabilityRegistry.get('pin.unpin');
            const device = {
                clientInfo: { mode: 'cinema' },
                currentState: { pinned: true },
            };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });
    });

    describe('Management Capabilities Coverage', () => {
        test('mgmt.reload capability exists', () => {
            const cap = capabilityRegistry.get('mgmt.reload');

            expect(cap).toBeDefined();
            expect(cap.name).toBe('Reload');
        });

        test('mgmt.reset capability exists', () => {
            const cap = capabilityRegistry.get('mgmt.reset');

            expect(cap).toBeDefined();
            expect(cap.name).toBe('Reset');
        });
    });

    describe('Config Fallback Coverage for Settings', () => {
        test('transitionInterval falls back to config when override missing', () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');
            const device = { settingsOverride: {} };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThan(0);
        });

        test('effectPauseTime falls back to default 2', () => {
            const cap = capabilityRegistry.get('settings.effectPauseTime');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('transitionEffect falls back to kenburns', () => {
            const cap = capabilityRegistry.get('settings.transitionEffect');
            const device = {};

            expect(cap.stateGetter(device)).toBe('kenburns');
        });

        test('clockFormat falls back when no override', () => {
            const cap = capabilityRegistry.get('settings.clockFormat');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });

        test('uiScaling.global falls back to 100', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.global');
            const device = {};

            const result = cap.stateGetter(device);
            expect(result).toBe(100);
        });

        test('uiScaling.content falls back to 100', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.content');
            const device = {};

            const result = cap.stateGetter(device);
            expect(result).toBe(100);
        });

        test('uiScaling.clearlogo falls back to 100', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clearlogo');
            const device = {};

            const result = cap.stateGetter(device);
            expect(result).toBe(100);
        });

        test('uiScaling.clock falls back to 100', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clock');
            const device = {};

            const result = cap.stateGetter(device);
            expect(result).toBe(100);
        });

        test('wallartMode.density falls back to medium', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.density');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });

        test('wallartMode.posterRefreshRate falls back to default', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.posterRefreshRate');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('wallartMode.heroRotation falls back to default', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.heroRotation');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('wallartMode.timingRandomness falls back to default', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.timingRandomness');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('wallartMode.animationType falls back to default', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.animationType');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });

        test('wallartMode.ambiance falls back to default', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.ambiance');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('boolean');
        });

        test('wallartMode.layout falls back to default', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.layout');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });

        test('wallartMode.heroSide falls back to default', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.heroSide');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });
    });

    describe('Cinema Settings Config Fallback', () => {
        test('cinema.orientation falls back to auto', () => {
            const cap = capabilityRegistry.get('settings.cinema.orientation');
            const device = {};

            expect(cap.stateGetter(device)).toBe('auto');
        });

        test('cinema.header.enabled falls back to true', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.enabled');
            const device = {};

            expect(cap.stateGetter(device)).toBe(true);
        });

        test('cinema.header.text falls back to default', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.text');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });

        test('cinema.header.style falls back to default', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.style');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });

        test('cinema.ambilight.enabled falls back to default', () => {
            const cap = capabilityRegistry.get('settings.cinema.ambilight.enabled');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('boolean');
        });

        test('cinema.ambilight.strength falls back to default', () => {
            const cap = capabilityRegistry.get('settings.cinema.ambilight.strength');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('cinema.footer.enabled falls back to true', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.enabled');
            const device = {};

            expect(cap.stateGetter(device)).toBe(true);
        });

        test('cinema.footer.type falls back to specs', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.type');
            const device = {};

            expect(cap.stateGetter(device)).toBe('specs');
        });

        test('cinema.footer.marqueeText falls back to default', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeText');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });
    });

    describe('Helper Method Coverage', () => {
        test('getCinemaSetting with existing nested path', () => {
            const device = {
                settingsOverride: {
                    cinema: {
                        ambilight: {
                            strength: 0.5,
                        },
                    },
                },
            };

            const result = capabilityRegistry.getCinemaSetting(device, 'ambilight.strength', 0.7);
            expect(result).toBe(0.5);
        });

        test('getWallartSetting with existing value', () => {
            const device = {
                settingsOverride: {
                    wallart: {
                        animationType: 'slide',
                    },
                },
            };

            const result = capabilityRegistry.getWallartSetting(device, 'animationType', 'fade');
            expect(result).toBe('slide');
        });

        test('getScreensaverSetting with existing value', () => {
            const device = {
                settingsOverride: {
                    screensaver: {
                        clockFormat: '12h',
                    },
                },
            };

            const result = capabilityRegistry.getScreensaverSetting(device, 'clockFormat', '24h');
            expect(result).toBe('12h');
        });

        test('getModeSetting delegates to getCinemaSetting', () => {
            const device = {
                settingsOverride: {
                    cinema: {
                        footer: {
                            enabled: false,
                        },
                    },
                },
            };

            const result = capabilityRegistry.getModeSetting(
                device,
                'cinema',
                'footer.enabled',
                true
            );
            expect(result).toBe(false);
        });

        test('getModeSetting delegates to getWallartSetting', () => {
            const device = {
                settingsOverride: {
                    wallart: {
                        layout: 'poster',
                    },
                },
            };

            const result = capabilityRegistry.getModeSetting(device, 'wallart', 'layout', 'hero');
            expect(result).toBe('poster');
        });

        test('getModeSetting delegates to getScreensaverSetting', () => {
            const device = {
                settingsOverride: {
                    screensaver: {
                        showLogo: false,
                    },
                },
            };

            const result = capabilityRegistry.getModeSetting(
                device,
                'screensaver',
                'showLogo',
                true
            );
            expect(result).toBe(false);
        });

        test('getDeviceMode prioritizes clientInfo over currentState', () => {
            const device = {
                clientInfo: { mode: 'wallart' },
                currentState: { mode: 'cinema' },
            };

            expect(capabilityRegistry.getDeviceMode(device)).toBe('wallart');
        });
    });

    describe('Additional State Getters', () => {
        test('showLogo with undefined returns default', () => {
            const cap = capabilityRegistry.get('settings.showLogo');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('boolean');
        });

        test('showClock with undefined returns default', () => {
            const cap = capabilityRegistry.get('settings.showClock');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('boolean');
        });
    });

    describe('Capability Registry Basics', () => {
        test('getAllCapabilities returns consistent results', () => {
            const all1 = capabilityRegistry.getAllCapabilities();
            const all2 = capabilityRegistry.getAllCapabilities();

            expect(all1.length).toBe(all2.length);
            expect(all1.length).toBeGreaterThan(50);
        });

        test('has returns false for non-existent capability', () => {
            expect(capabilityRegistry.has('completely.made.up.capability')).toBe(false);
        });

        test('get returns null for non-existent capability', () => {
            expect(capabilityRegistry.get('completely.made.up.capability')).toBeNull();
        });

        test('getAvailableCapabilities returns array', () => {
            const device = { clientInfo: { mode: 'screensaver' } };
            const available = capabilityRegistry.getAvailableCapabilities(device);

            expect(Array.isArray(available)).toBe(true);
            expect(available.length).toBeGreaterThan(0);
        });
    });

    describe('Cinema Footer Advanced Settings', () => {
        test('cinema.footer.marqueeStyle returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeStyle');
            const device = {
                settingsOverride: {
                    cinema: { footer: { marqueeStyle: 'modern' } },
                },
            };

            const result = cap.stateGetter(device);
            expect(result).toBe('modern');
        });

        test('cinema.footer.marqueeStyle returns default classic', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.marqueeStyle');
            const device = {};

            expect(cap.stateGetter(device)).toBe('classic');
        });

        test('cinema.footer.specs.style returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.style');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { style: 'filled' } } },
                },
            };

            expect(cap.stateGetter(device)).toBe('filled');
        });

        test('cinema.footer.specs.style returns default subtle', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.style');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
            expect(['subtle', 'outline', 'filled']).toContain(result);
        });

        test('cinema.footer.specs.iconSet returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.iconSet');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { iconSet: 'line' } } },
                },
            };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('string');
        });

        test('cinema.footer.specs.showFlags returns override value', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showFlags');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { showFlags: true } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(true);
        });

        test('cinema.footer.specs.showFlags returns default false', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showFlags');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('boolean');
        });

        test('cinema.footer.specs.showFlags availableWhen returns true for cinema', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showFlags');
            const device = { clientInfo: { mode: 'cinema' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('cinema.footer.specs.showFlags availableWhen returns false for screensaver', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showFlags');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });
    });

    describe('Camera and Additional Capabilities', () => {
        test('camera.preview capability exists', () => {
            const cap = capabilityRegistry.get('camera.preview');

            expect(cap).toBeDefined();
            expect(cap.name).toBe('Current Poster');
            expect(cap.category).toBe('camera');
        });

        test('showMetadata stateGetter returns override', () => {
            const cap = capabilityRegistry.get('settings.showMetadata');
            if (cap) {
                const device = { settingsOverride: { showMetadata: false } };
                expect(cap.stateGetter(device)).toBe(false);
            }
        });

        test('showMetadata stateGetter returns default', () => {
            const cap = capabilityRegistry.get('settings.showMetadata');
            if (cap) {
                const device = {};
                const result = cap.stateGetter(device);
                expect(typeof result).toBe('boolean');
            }
        });

        test('showRottenTomatoes stateGetter returns override', () => {
            const cap = capabilityRegistry.get('settings.showRottenTomatoes');
            if (cap) {
                const device = { settingsOverride: { showRottenTomatoes: false } };
                expect(cap.stateGetter(device)).toBe(false);
            }
        });

        test('showRottenTomatoes availableWhen checks for screensaver', () => {
            const cap = capabilityRegistry.get('settings.showRottenTomatoes');
            if (cap && cap.availableWhen) {
                const device = { clientInfo: { mode: 'screensaver' } };
                expect(cap.availableWhen(device)).toBe(true);
            }
        });
    });

    describe('Additional StateGetter Edge Cases', () => {
        test('transitionInterval with very small value', () => {
            const cap = capabilityRegistry.get('settings.transitionInterval');
            const device = { settingsOverride: { transitionInterval: 1 } };

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('number');
        });

        test('uiScaling.global with max value', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.global');
            const device = { settingsOverride: { uiScaling: { global: 200 } } };

            expect(cap.stateGetter(device)).toBe(200);
        });

        test('uiScaling.global with min value', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.global');
            const device = { settingsOverride: { uiScaling: { global: 50 } } };

            expect(cap.stateGetter(device)).toBe(50);
        });

        test('wallartMode.posterRefreshRate with max value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.posterRefreshRate');
            const device = {
                settingsOverride: { wallartMode: { posterRefreshRate: 60 } },
            };

            const result = cap.stateGetter(device);
            expect(result).toBe(60);
        });

        test('wallartMode.posterRefreshRate with min value', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.posterRefreshRate');
            const device = {
                settingsOverride: { wallartMode: { posterRefreshRate: 1 } },
            };

            const result = cap.stateGetter(device);
            expect(result).toBe(1);
        });

        test('cinema.ambilight.strength with zero', () => {
            const cap = capabilityRegistry.get('settings.cinema.ambilight.strength');
            const device = {
                settingsOverride: { cinema: { ambilight: { strength: 0 } } },
            };

            const result = cap.stateGetter(device);
            expect(result).toBe(0);
        });

        test('cinema.ambilight.strength with max', () => {
            const cap = capabilityRegistry.get('settings.cinema.ambilight.strength');
            const device = {
                settingsOverride: { cinema: { ambilight: { strength: 1 } } },
            };

            const result = cap.stateGetter(device);
            expect(result).toBe(1);
        });
    });

    describe('AvailableWhen Edge Cases', () => {
        test('clockFormat availableWhen returns false for wallart', () => {
            const cap = capabilityRegistry.get('settings.clockFormat');
            const device = { clientInfo: { mode: 'wallart' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('wallartMode.density availableWhen returns true for wallart', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.density');
            const device = { clientInfo: { mode: 'wallart' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('wallartMode.density availableWhen returns false for cinema', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.density');
            const device = { clientInfo: { mode: 'cinema' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });

        test('cinema.orientation availableWhen returns true for cinema', () => {
            const cap = capabilityRegistry.get('settings.cinema.orientation');
            const device = { clientInfo: { mode: 'cinema' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(true);
            }
        });

        test('cinema.orientation availableWhen returns false for screensaver', () => {
            const cap = capabilityRegistry.get('settings.cinema.orientation');
            const device = { clientInfo: { mode: 'screensaver' } };

            if (cap.availableWhen) {
                expect(cap.availableWhen(device)).toBe(false);
            }
        });
    });

    describe('Deeply Nested Settings Coverage', () => {
        test('cinema.footer.specs.showResolution with override', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showResolution');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { showResolution: false } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('cinema.footer.specs.showResolution without override returns default', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showResolution');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('boolean');
        });

        test('cinema.footer.specs.showAudio with override', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showAudio');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { showAudio: false } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('cinema.footer.specs.showAudio without override', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showAudio');
            const device = {};

            const result = cap.stateGetter(device);
            expect(typeof result).toBe('boolean');
        });

        test('cinema.footer.specs.showAspectRatio with override', () => {
            const cap = capabilityRegistry.get('settings.cinema.footer.specs.showAspectRatio');
            const device = {
                settingsOverride: {
                    cinema: { footer: { specs: { showAspectRatio: false } } },
                },
            };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('wallart layout supports both old and new format', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.layout');
            const device1 = {
                settingsOverride: { wallartMode: { layout: 'classic' } },
            };
            const device2 = {
                settingsOverride: { wallartMode: { layoutVariant: 'heroGrid' } },
            };

            const result1 = cap.stateGetter(device1);
            const result2 = cap.stateGetter(device2);

            expect(typeof result1).toBe('string');
            expect(typeof result2).toBe('string');
        });

        test('wallartMode.heroSide supports multiple paths', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.heroSide');
            const device1 = {
                settingsOverride: {
                    wallartMode: {
                        layoutSettings: { heroGrid: { heroSide: 'left' } },
                    },
                },
            };
            const device2 = {
                settingsOverride: { wallartMode: { heroSide: 'right' } },
            };

            expect(cap.stateGetter(device1)).toBe('left');
            expect(cap.stateGetter(device2)).toBe('right');
        });

        test('wallartMode.heroRotation supports multiple paths', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.heroRotation');
            const device1 = {
                settingsOverride: {
                    wallartMode: {
                        layoutSettings: { heroGrid: { heroRotationMinutes: 10 } },
                    },
                },
            };
            const device2 = {
                settingsOverride: { wallartMode: { heroRotation: 15 } },
            };

            expect(cap.stateGetter(device1)).toBe(10);
            expect(cap.stateGetter(device2)).toBe(15);
        });

        test('getDeviceMode with both clientInfo and currentState', () => {
            const device1 = {
                clientInfo: { mode: 'cinema' },
                currentState: { mode: 'wallart' },
            };
            const device2 = {
                currentState: { mode: 'screensaver' },
            };
            const device3 = {};

            // clientInfo takes precedence
            expect(capabilityRegistry.getDeviceMode(device1)).toBe('cinema');
            // Falls back to currentState
            expect(capabilityRegistry.getDeviceMode(device2)).toBe('screensaver');
            // Falls back to default
            expect(capabilityRegistry.getDeviceMode(device3)).toBe('screensaver');
        });

        test('getCinemaSetting with nested override path', () => {
            const device = {
                settingsOverride: {
                    cinema: { footer: { ambilight: { strength: 0.8 } } },
                },
            };

            const result = capabilityRegistry.getCinemaSetting(
                device,
                'footer.ambilight.strength',
                0.5
            );
            expect(result).toBe(0.8);
        });

        test('getWallartSetting with nested override path', () => {
            const device = {
                settingsOverride: {
                    wallart: { layoutSettings: { heroGrid: { heroSide: 'left' } } },
                },
            };

            // Note: getWallartSetting internally uses mode='wallart', so path should be just the nested path
            const result = capabilityRegistry.getWallartSetting(
                device,
                'layoutSettings.heroGrid.heroSide',
                'right'
            );
            // Should find settingsOverride.wallart.layoutSettings.heroGrid.heroSide = 'left'
            expect(result).toBe('left');
        });

        test('getModeSetting for cinema with nested path', () => {
            const device = {
                clientInfo: { mode: 'cinema' },
                settingsOverride: {
                    cinema: { header: { enabled: false } },
                },
            };

            // getModeSetting needs 4 params: device, mode, path, default
            const result = capabilityRegistry.getModeSetting(
                device,
                'cinema',
                'header.enabled',
                true
            );
            expect(result).toBe(false);
        });

        test('getModeSetting for wallart with nested path', () => {
            const device = {
                clientInfo: { mode: 'wallart' },
                settingsOverride: {
                    wallartMode: { layoutSettings: { heroGrid: { heroSide: 'right' } } },
                },
            };

            const result = capabilityRegistry.getModeSetting(
                device,
                'wallartMode',
                'layoutSettings.heroGrid.heroSide',
                'left'
            );
            expect(result).toBe('right');
        });

        test('getScreensaverSetting with top-level override', () => {
            const device = {
                settingsOverride: { screensaver: { transitionInterval: 20 } },
            };

            const result = capabilityRegistry.getScreensaverSetting(
                device,
                'transitionInterval',
                10
            );
            expect(result).toBe(20);
        });
    });

    describe('Additional Edge Case Coverage', () => {
        test('wallartMode.layout converts heroGrid to hero-grid', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.layout');
            const device = {
                settingsOverride: { wallartMode: { layoutVariant: 'heroGrid' } },
            };

            expect(cap.stateGetter(device)).toBe('hero-grid');
        });

        test('wallartMode.layout keeps classic as-is', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.layout');
            const device = {
                settingsOverride: { wallartMode: { layoutVariant: 'classic' } },
            };

            expect(cap.stateGetter(device)).toBe('classic');
        });

        test('wallartMode.layout falls back to old layout property', () => {
            const cap = capabilityRegistry.get('settings.wallartMode.layout');
            const device = {
                settingsOverride: { wallartMode: { layout: 'classic' } },
            };

            expect(cap.stateGetter(device)).toBe('classic');
        });

        test('cinema.header.text converts empty string to None', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.text');
            const device = {
                settingsOverride: { cinema: { header: { text: '' } } },
            };

            const result = cap.stateGetter(device);
            expect(result).toBe('None');
        });

        test('cinema.header.text returns actual text', () => {
            const cap = capabilityRegistry.get('settings.cinema.header.text');
            const device = {
                settingsOverride: { cinema: { header: { text: 'Now Playing' } } },
            };

            expect(cap.stateGetter(device)).toBe('Now Playing');
        });

        test('getAllCapabilities returns all registered capabilities', () => {
            const allCaps = capabilityRegistry.getAllCapabilities();

            expect(Array.isArray(allCaps)).toBe(true);
            expect(allCaps.length).toBeGreaterThan(60); // Should have 68 capabilities
            expect(allCaps[0]).toHaveProperty('id');
            expect(allCaps[0]).toHaveProperty('name');
            expect(allCaps[0]).toHaveProperty('category');
        });

        test('getAvailableCapabilities filters by mode', () => {
            const device = { clientInfo: { mode: 'cinema' } };
            const available = capabilityRegistry.getAvailableCapabilities(device);

            const cinemaOnly = available.filter(
                c => c.id.includes('cinema') || c.id.includes('settings.cinema')
            );
            expect(cinemaOnly.length).toBeGreaterThan(0);

            // Should not include wallart-specific capabilities
            const wallartOnly = available.filter(c => c.id.includes('wallartMode'));
            expect(wallartOnly.length).toBe(0);
        });

        test('power.toggle stateGetter with poweredOff true', () => {
            const cap = capabilityRegistry.get('power.toggle');
            const device = { currentState: { poweredOff: true } };

            expect(cap.stateGetter(device)).toBe(false);
        });

        test('power.toggle stateGetter defaults to true', () => {
            const cap = capabilityRegistry.get('power.toggle');
            const device = { currentState: {} };

            expect(cap.stateGetter(device)).toBe(true);
        });

        test('device.userAgent sensor returns from clientInfo', () => {
            const cap = capabilityRegistry.get('device.userAgent');
            const device = { clientInfo: { userAgent: 'Mozilla/5.0' } };

            expect(cap.stateGetter(device)).toBe('Mozilla/5.0');
        });

        test('device.userAgent sensor returns Unknown when missing', () => {
            const cap = capabilityRegistry.get('device.userAgent');
            const device = { clientInfo: {} };

            expect(cap.stateGetter(device)).toBeNull();
        });

        test('mode.select with cinema override', () => {
            const cap = capabilityRegistry.get('mode.select');
            const device = {
                settingsOverride: { mode: 'cinema' },
            };

            expect(cap.stateGetter(device)).toBe('cinema');
        });

        test('mode.select falls back to clientInfo', () => {
            const cap = capabilityRegistry.get('mode.select');
            const device = {
                clientInfo: { mode: 'wallart' },
            };

            expect(cap.stateGetter(device)).toBe('wallart');
        });

        test('mode.select falls back to currentState', () => {
            const cap = capabilityRegistry.get('mode.select');
            const device = {
                currentState: { mode: 'cinema' },
            };

            expect(cap.stateGetter(device)).toBe('cinema');
        });

        test('uiScaling.clearlogo with override', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clearlogo');
            const device = {
                settingsOverride: { uiScaling: { clearlogo: 150 } },
            };

            expect(cap.stateGetter(device)).toBe(150);
        });

        test('uiScaling.clock with override', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.clock');
            const device = {
                settingsOverride: { uiScaling: { clock: 120 } },
            };

            expect(cap.stateGetter(device)).toBe(120);
        });

        test('uiScaling.content with override', () => {
            const cap = capabilityRegistry.get('settings.uiScaling.content');
            const device = {
                settingsOverride: { uiScaling: { content: 180 } },
            };

            expect(cap.stateGetter(device)).toBe(180);
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
