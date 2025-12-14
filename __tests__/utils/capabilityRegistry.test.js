/**
 * Tests for Capability Registry
 */

describe('Capability Registry', () => {
    let capabilityRegistry;

    beforeEach(() => {
        jest.resetModules();
        // Mock wsHub to avoid actual WebSocket connections
        jest.mock('../../utils/wsHub', () => ({
            sendCommand: jest.fn().mockResolvedValue(true),
            sendApplySettings: jest.fn().mockResolvedValue(true),
        }));
        capabilityRegistry = require('../../utils/capabilityRegistry');
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        test('initializes with core capabilities', () => {
            capabilityRegistry.init();

            expect(capabilityRegistry.capabilities.size).toBeGreaterThan(0);
            expect(capabilityRegistry.initialized).toBe(true);
        });

        test('registers playback capabilities', () => {
            capabilityRegistry.init();

            expect(capabilityRegistry.has('playback.pause')).toBe(true);
            expect(capabilityRegistry.has('playback.resume')).toBe(true);
            expect(capabilityRegistry.has('playback.next')).toBe(true);
            expect(capabilityRegistry.has('playback.previous')).toBe(true);
            expect(capabilityRegistry.has('playback.toggle')).toBe(true);
        });

        test('registers power capabilities', () => {
            capabilityRegistry.init();

            expect(capabilityRegistry.has('power.toggle')).toBe(true);
            expect(capabilityRegistry.has('power.on')).toBe(true);
            expect(capabilityRegistry.has('power.off')).toBe(true);
        });

        test('registers navigation capabilities', () => {
            capabilityRegistry.init();

            expect(capabilityRegistry.has('pin.current')).toBe(true);
            expect(capabilityRegistry.has('pin.unpin')).toBe(true);
        });

        test('registers management capabilities', () => {
            capabilityRegistry.init();

            expect(capabilityRegistry.has('mgmt.reload')).toBe(true);
            expect(capabilityRegistry.has('mgmt.reset')).toBe(true);
        });

        test('registers mode capabilities', () => {
            capabilityRegistry.init();

            expect(capabilityRegistry.has('mode.select')).toBe(true);
        });

        test('does not initialize twice', () => {
            capabilityRegistry.init();
            const sizeAfterFirst = capabilityRegistry.capabilities.size;

            capabilityRegistry.init();
            const sizeAfterSecond = capabilityRegistry.capabilities.size;

            expect(sizeAfterFirst).toBe(sizeAfterSecond);
        });

        test('registers modern cinema + wallart + screensaver settings capabilities', () => {
            capabilityRegistry.init();

            // Cinema (modern schema)
            expect(capabilityRegistry.has('settings.cinema.footer.type')).toBe(true);
            expect(capabilityRegistry.has('settings.cinema.footer.taglineMarquee')).toBe(true);
            expect(capabilityRegistry.has('settings.cinema.metadata.specs.showHDR')).toBe(true);
            expect(capabilityRegistry.has('settings.cinema.metadata.specs.style')).toBe(true);
            expect(capabilityRegistry.has('settings.cinema.header.typography.fontFamily')).toBe(
                true
            );
            expect(capabilityRegistry.has('settings.cinema.footer.typography.shadow')).toBe(true);

            // Wallart (modern schema)
            expect(capabilityRegistry.has('settings.wallartMode.refreshRate')).toBe(true);
            expect(capabilityRegistry.has('settings.wallartMode.randomness')).toBe(true);
            expect(capabilityRegistry.has('settings.wallartMode.ambientGradient')).toBe(true);
            expect(capabilityRegistry.has('settings.wallartMode.orientation')).toBe(true);

            // Screensaver orientation
            expect(capabilityRegistry.has('settings.screensaverMode.orientation')).toBe(true);

            // Override modal parity (Cinema)
            expect(capabilityRegistry.has('settings.cinema.nowPlaying.priority')).toBe(true);
            expect(capabilityRegistry.has('settings.cinema.nowPlaying.filterUser')).toBe(true);
            expect(capabilityRegistry.has('settings.cinema.nowPlaying.sourcePreference')).toBe(
                true
            );
            expect(capabilityRegistry.has('settings.cinema.pinnedMediaKey')).toBe(true);
        });

        test('keeps Cinema text presets in sync with cinema-ui.js', () => {
            jest.resetModules();
            jest.mock('../../utils/wsHub', () => ({
                sendCommand: jest.fn().mockResolvedValue(true),
                sendApplySettings: jest.fn().mockResolvedValue(true),
            }));

            // Ensure the optionsGetter only reflects system presets (no config presets)
            jest.doMock('../../config', () => ({
                config: { cinema: { presets: { headerTexts: [], footerTexts: [] } } },
            }));

            const fs = require('fs');
            const path = require('path');
            const cinemaUiPath = path.join(
                __dirname,
                '..',
                '..',
                'public',
                'cinema',
                'cinema-ui.js'
            );
            const src = fs.readFileSync(cinemaUiPath, 'utf8');
            const m = src.match(/const\s+SYSTEM_TEXT_PRESETS\s*=\s*\[([\s\S]*?)\];/);
            expect(m).toBeTruthy();
            const block = m[1] || '';
            const uiPresets = Array.from(block.matchAll(/['"]([^'"]+)['"]/g)).map(x => x[1]);

            const reg = require('../../utils/capabilityRegistry');
            reg.init();
            const cap = reg.get('settings.cinema.header.text');
            expect(cap).toBeTruthy();
            expect(typeof cap.optionsGetter).toBe('function');

            const dummyDevice = { id: 'd1', currentState: { mode: 'cinema' } };
            const mqttPresets = cap.optionsGetter(dummyDevice);
            expect(mqttPresets).toEqual(uiPresets);
        });

        test('keeps Cinema specs options in sync with admin.html', () => {
            const fs = require('fs');
            const path = require('path');
            const adminHtmlPath = path.join(__dirname, '..', '..', 'public', 'admin.html');
            const html = fs.readFileSync(adminHtmlPath, 'utf8');

            const styleSelect = html.match(
                /<select\s+id="cinemaSpecsStyle"[^>]*>([\s\S]*?)<\/select>/
            );
            expect(styleSelect).toBeTruthy();
            const styleOpts = Array.from(
                (styleSelect[1] || '').matchAll(/<option\s+value="([^"]+)"/g)
            ).map(x => x[1]);

            const iconSetSelect = html.match(
                /<select\s+id="cinemaSpecsIconSet"[^>]*>([\s\S]*?)<\/select>/
            );
            expect(iconSetSelect).toBeTruthy();
            const iconSetOpts = Array.from(
                (iconSetSelect[1] || '').matchAll(/<option\s+value="([^"]+)"/g)
            ).map(x => x[1]);

            capabilityRegistry.init();
            const styleCap = capabilityRegistry.get('settings.cinema.metadata.specs.style');
            const iconSetCap = capabilityRegistry.get('settings.cinema.metadata.specs.iconSet');

            expect(styleCap.options).toEqual(styleOpts);
            expect(iconSetCap.options).toEqual(iconSetOpts);
        });
    });

    describe('Capability Registration', () => {
        beforeEach(() => {
            capabilityRegistry.init();
        });

        test('registers custom capability', () => {
            capabilityRegistry.register('custom.test', {
                name: 'Test Capability',
                category: 'test',
                entityType: 'button',
                icon: 'mdi:test',
            });

            expect(capabilityRegistry.has('custom.test')).toBe(true);
        });

        test('stores capability with all properties', () => {
            const spec = {
                name: 'Test',
                category: 'test',
                entityType: 'switch',
                icon: 'mdi:test',
                min: 0,
                max: 100,
                options: ['a', 'b', 'c'],
            };

            capabilityRegistry.register('test.capability', spec);
            const registered = capabilityRegistry.get('test.capability');

            expect(registered).toMatchObject({
                id: 'test.capability',
                ...spec,
            });
        });

        test('overwrites existing capability with warning', () => {
            const mockWarn = jest.spyOn(require('../../utils/logger'), 'warn');

            capabilityRegistry.register('test.overwrite', { name: 'First' });
            capabilityRegistry.register('test.overwrite', { name: 'Second' });

            const cap = capabilityRegistry.get('test.overwrite');
            expect(cap.name).toBe('Second');
            expect(mockWarn).toHaveBeenCalled();
        });
    });

    describe('Capability Retrieval', () => {
        beforeEach(() => {
            capabilityRegistry.init();
        });

        test('gets capability by ID', () => {
            const cap = capabilityRegistry.get('playback.pause');

            expect(cap).toBeDefined();
            expect(cap.id).toBe('playback.pause');
            expect(cap.name).toBe('Pause');
            expect(cap.category).toBe('playback');
        });

        test('returns null for non-existent capability', () => {
            const cap = capabilityRegistry.get('nonexistent.capability');

            expect(cap).toBeNull();
        });

        test('checks if capability exists', () => {
            expect(capabilityRegistry.has('playback.next')).toBe(true);
            expect(capabilityRegistry.has('nonexistent')).toBe(false);
        });
    });

    describe('Available Capabilities for Device', () => {
        beforeEach(() => {
            capabilityRegistry.init();
        });

        test('returns all always-available capabilities', () => {
            capabilityRegistry.init();

            const device = {
                id: 'test-device',
                currentState: { mode: 'wallart' },
            };

            const available = capabilityRegistry.getAvailableCapabilities(device);

            // Should include capabilities that are always available (no mode restriction)
            const hasReload = available.some(c => c.id === 'mgmt.reload');

            expect(hasReload).toBe(true);

            // Playback.next requires screensaver mode, so should NOT be available in wallart
            const hasNext = available.some(c => c.id === 'playback.next');
            expect(hasNext).toBe(false);
        });

        test('filters capabilities based on device state', () => {
            const deviceScreensaver = {
                id: 'test-device',
                currentState: { mode: 'screensaver' },
            };

            const available = capabilityRegistry.getAvailableCapabilities(deviceScreensaver);

            // Pause is only available in screensaver mode
            const hasPause = available.some(c => c.id === 'playback.pause');
            expect(hasPause).toBe(true);
        });

        test('excludes capabilities when condition not met', () => {
            const deviceWallart = {
                id: 'test-device',
                currentState: { mode: 'wallart' },
            };

            const available = capabilityRegistry.getAvailableCapabilities(deviceWallart);

            // Pause requires screensaver mode
            const hasPause = available.some(c => c.id === 'playback.pause');
            expect(hasPause).toBe(false);
        });

        test('includes pin.unpin only when device is pinned', () => {
            const devicePinned = {
                id: 'test-device',
                currentState: { pinned: true },
            };

            const deviceNotPinned = {
                id: 'test-device',
                currentState: { pinned: false },
            };

            const availablePinned = capabilityRegistry.getAvailableCapabilities(devicePinned);
            const availableNotPinned = capabilityRegistry.getAvailableCapabilities(deviceNotPinned);

            expect(availablePinned.some(c => c.id === 'pin.unpin')).toBe(true);
            expect(availableNotPinned.some(c => c.id === 'pin.unpin')).toBe(false);
        });

        test('does not expose deprecated legacy capabilities', () => {
            const deviceCinema = {
                id: 'test-device',
                currentState: { mode: 'cinema' },
            };

            const available = capabilityRegistry.getAvailableCapabilities(deviceCinema);

            // Deprecated legacy entities should not be available
            expect(available.some(c => c.id === 'settings.cinema.footer.specs.showFlags')).toBe(
                false
            );
            expect(available.some(c => c.id === 'settings.cinema.footer.marqueeStyle')).toBe(false);

            // Modern replacements should be available
            expect(available.some(c => c.id === 'settings.cinema.metadata.specs.showHDR')).toBe(
                true
            );
            expect(
                available.some(c => c.id === 'settings.cinema.footer.typography.fontFamily')
            ).toBe(true);
        });

        test('includes power.on only when device is powered off', () => {
            const deviceOff = {
                id: 'test-device',
                currentState: { poweredOff: true },
            };

            const deviceOn = {
                id: 'test-device',
                currentState: { poweredOff: false },
            };

            const availableOff = capabilityRegistry.getAvailableCapabilities(deviceOff);
            const availableOn = capabilityRegistry.getAvailableCapabilities(deviceOn);

            expect(availableOff.some(c => c.id === 'power.on')).toBe(true);
            expect(availableOn.some(c => c.id === 'power.on')).toBe(false);
        });

        test('handles errors in availableWhen gracefully', () => {
            capabilityRegistry.register('error.test', {
                name: 'Error Test',
                availableWhen: () => {
                    throw new Error('Test error');
                },
            });

            const device = { id: 'test' };
            const available = capabilityRegistry.getAvailableCapabilities(device);

            // Should not crash, should exclude the capability
            expect(available.some(c => c.id === 'error.test')).toBe(false);
        });
    });

    describe('Capability Properties', () => {
        beforeEach(() => {
            capabilityRegistry.init();
        });

        test('playback capabilities have correct entity types', () => {
            const pause = capabilityRegistry.get('playback.pause');
            expect(pause.entityType).toBe('button');
        });

        test('power.toggle is a switch', () => {
            const powerToggle = capabilityRegistry.get('power.toggle');
            expect(powerToggle.entityType).toBe('switch');
        });

        test('mode.select is a select with options', () => {
            const modeSelect = capabilityRegistry.get('mode.select');
            expect(modeSelect.entityType).toBe('select');
            expect(modeSelect.options).toEqual(['screensaver', 'wallart', 'cinema']);
        });

        test('capabilities have icons', () => {
            const next = capabilityRegistry.get('playback.next');
            expect(next.icon).toBe('mdi:skip-next');

            const reload = capabilityRegistry.get('mgmt.reload');
            expect(reload.icon).toBe('mdi:refresh');
        });

        test('power.toggle has state getter', () => {
            const powerToggle = capabilityRegistry.get('power.toggle');
            expect(powerToggle.stateGetter).toBeDefined();

            const deviceOn = { currentState: { poweredOff: false } };
            const deviceOff = { currentState: { poweredOff: true } };

            expect(powerToggle.stateGetter(deviceOn)).toBe(true);
            expect(powerToggle.stateGetter(deviceOff)).toBe(false);
        });

        test('mode.select has state getter', () => {
            const modeSelect = capabilityRegistry.get('mode.select');
            expect(modeSelect.stateGetter).toBeDefined();

            const device = { currentState: { mode: 'wallart' } };
            expect(modeSelect.stateGetter(device)).toBe('wallart');
        });
    });
});
