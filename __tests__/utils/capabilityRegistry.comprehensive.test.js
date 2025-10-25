/**
 * Comprehensive tests for utils/capabilityRegistry.js
 * Focus: high coverage of init, register, getAvailableCapabilities, get, has, getAllCapabilities
 * and various availableWhen/commandHandler branches.
 */

// Mock wsHub before requiring capabilityRegistry
jest.mock('../../utils/wsHub', () => ({
    sendCommand: jest.fn().mockResolvedValue(true),
    sendApplySettings: jest.fn().mockResolvedValue(true),
}));

describe('CapabilityRegistry - Comprehensive Coverage', () => {
    let capabilityRegistry;
    let wsHub;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        // Get mocked wsHub
        wsHub = require('../../utils/wsHub');

        // Get singleton instance (capabilityRegistry exports singleton, not class)
        capabilityRegistry = require('../../utils/capabilityRegistry');

        // Reset registry state for each test
        capabilityRegistry.capabilities.clear();
        capabilityRegistry.initialized = false;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('singleton state', () => {
        test('starts with empty capabilities map when reset', () => {
            expect(capabilityRegistry.capabilities).toBeInstanceOf(Map);
            expect(capabilityRegistry.capabilities.size).toBe(0);
            expect(capabilityRegistry.initialized).toBe(false);
        });
    });

    describe('init()', () => {
        test('calls all register methods and sets initialized=true', () => {
            capabilityRegistry.init();

            expect(capabilityRegistry.initialized).toBe(true);
            expect(capabilityRegistry.capabilities.size).toBeGreaterThan(0);
        });

        test('does nothing if already initialized', () => {
            capabilityRegistry.init();
            const sizeAfterFirst = capabilityRegistry.capabilities.size;

            capabilityRegistry.init(); // second call

            expect(capabilityRegistry.capabilities.size).toBe(sizeAfterFirst);
        });
    });

    describe('register()', () => {
        test('registers a capability with default values', () => {
            capabilityRegistry.register('test.action', {
                name: 'Test Action',
                category: 'test',
            });

            expect(capabilityRegistry.has('test.action')).toBe(true);
            const cap = capabilityRegistry.get('test.action');
            expect(cap.name).toBe('Test Action');
            expect(cap.category).toBe('test');
            expect(cap.entityType).toBe('button'); // default
            expect(cap.icon).toBe('mdi:help'); // default
        });

        test('overwrites when registering duplicate capability', () => {
            capabilityRegistry.register('duplicate.id', { name: 'First' });
            capabilityRegistry.register('duplicate.id', { name: 'Second' });

            expect(capabilityRegistry.get('duplicate.id').name).toBe('Second');
        });

        test('stores all provided spec properties', () => {
            const availableWhenMock = jest.fn(() => true);
            const commandHandlerMock = jest.fn(() => Promise.resolve());
            const stateGetterMock = jest.fn(() => 'ON');

            capabilityRegistry.register('full.spec', {
                name: 'Full Spec',
                category: 'test',
                entityType: 'switch',
                icon: 'mdi:test',
                availableWhen: availableWhenMock,
                commandHandler: commandHandlerMock,
                stateGetter: stateGetterMock,
                min: 0,
                max: 100,
                step: 1,
                unit: '%',
                options: ['a', 'b'],
            });

            const cap = capabilityRegistry.get('full.spec');
            expect(cap.entityType).toBe('switch');
            expect(cap.icon).toBe('mdi:test');
            expect(cap.availableWhen).toBe(availableWhenMock);
            expect(cap.commandHandler).toBe(commandHandlerMock);
            expect(cap.stateGetter).toBe(stateGetterMock);
            expect(cap.min).toBe(0);
            expect(cap.max).toBe(100);
            expect(cap.step).toBe(1);
            expect(cap.unit).toBe('%');
            expect(cap.options).toEqual(['a', 'b']);
        });
    });

    describe('get()', () => {
        test('returns capability spec if exists', () => {
            capabilityRegistry.register('exists', { name: 'Exists' });
            const cap = capabilityRegistry.get('exists');
            expect(cap).toBeTruthy();
            expect(cap.name).toBe('Exists');
        });

        test('returns null if capability does not exist', () => {
            expect(capabilityRegistry.get('nonexistent')).toBeNull();
        });
    });

    describe('has()', () => {
        test('returns true if capability exists', () => {
            capabilityRegistry.register('check.me', { name: 'Check' });
            expect(capabilityRegistry.has('check.me')).toBe(true);
        });

        test('returns false if capability does not exist', () => {
            expect(capabilityRegistry.has('not.here')).toBe(false);
        });
    });

    describe('getAllCapabilities()', () => {
        test('returns all capabilities regardless of availability', () => {
            capabilityRegistry.register('cap1', { name: 'Cap 1' });
            capabilityRegistry.register('cap2', { name: 'Cap 2' });
            capabilityRegistry.register('cap3', {
                name: 'Cap 3',
                availableWhen: () => false,
            });

            const all = capabilityRegistry.getAllCapabilities();
            expect(all).toHaveLength(3);
            expect(all.map(c => c.id)).toEqual(expect.arrayContaining(['cap1', 'cap2', 'cap3']));
        });

        test('returns empty array if no capabilities registered', () => {
            const all = capabilityRegistry.getAllCapabilities();
            expect(all).toEqual([]);
        });
    });

    describe('getAvailableCapabilities()', () => {
        test('returns capabilities that pass availableWhen check', () => {
            capabilityRegistry.register('always', {
                name: 'Always',
                availableWhen: () => true,
            });
            capabilityRegistry.register('never', {
                name: 'Never',
                availableWhen: () => false,
            });
            capabilityRegistry.register('conditional', {
                name: 'Conditional',
                availableWhen: device => device.active === true,
            });

            const device = { active: true };
            const available = capabilityRegistry.getAvailableCapabilities(device);

            const ids = available.map(c => c.id);
            expect(ids).toContain('always');
            expect(ids).not.toContain('never');
            expect(ids).toContain('conditional');
        });

        test('returns capabilities without availableWhen (defaults to true)', () => {
            capabilityRegistry.register('no-check', { name: 'No Check' });

            const available = capabilityRegistry.getAvailableCapabilities({});
            expect(available.map(c => c.id)).toContain('no-check');
        });

        test('handles errors in availableWhen gracefully', () => {
            capabilityRegistry.register('throws', {
                name: 'Throws',
                availableWhen: () => {
                    throw new Error('availableWhen error');
                },
            });

            const available = capabilityRegistry.getAvailableCapabilities({});
            expect(available.map(c => c.id)).not.toContain('throws');
        });
    });

    describe('getDeviceMode()', () => {
        test('returns mode from clientInfo.mode if available', () => {
            const device = { clientInfo: { mode: 'cinema' } };
            expect(capabilityRegistry.getDeviceMode(device)).toBe('cinema');
        });

        test('falls back to currentState.mode if clientInfo.mode missing', () => {
            const device = { currentState: { mode: 'wallart' } };
            expect(capabilityRegistry.getDeviceMode(device)).toBe('wallart');
        });

        test('returns screensaver as default if both missing', () => {
            const device = {};
            expect(capabilityRegistry.getDeviceMode(device)).toBe('screensaver');
        });
    });

    describe('getModeSetting()', () => {
        test('returns device override if present', () => {
            const device = {
                settingsOverride: {
                    cinema: { header: { text: 'Override' } },
                },
            };

            const result = capabilityRegistry.getModeSetting(
                device,
                'cinema',
                'header.text',
                'Default'
            );
            expect(result).toBe('Override');
        });

        test('returns default if device override and global config missing', () => {
            const device = {};
            const result = capabilityRegistry.getModeSetting(
                device,
                'cinema',
                'missing.path',
                'Fallback'
            );
            expect(result).toBe('Fallback');
        });

        test('handles nested path correctly', () => {
            const device = {
                settingsOverride: {
                    wallart: { layout: { variant: 'grid' } },
                },
            };

            const result = capabilityRegistry.getModeSetting(
                device,
                'wallart',
                'layout.variant',
                'default'
            );
            expect(result).toBe('grid');
        });
    });

    describe('getCinemaSetting()', () => {
        test('calls getModeSetting with cinema mode', () => {
            const spy = jest.spyOn(capabilityRegistry, 'getModeSetting');
            capabilityRegistry.getCinemaSetting({}, 'header.text', 'Default');
            expect(spy).toHaveBeenCalledWith({}, 'cinema', 'header.text', 'Default');
        });
    });

    describe('getScreensaverSetting()', () => {
        test('calls getModeSetting with screensaver mode', () => {
            const spy = jest.spyOn(capabilityRegistry, 'getModeSetting');
            capabilityRegistry.getScreensaverSetting({}, 'interval', 10);
            expect(spy).toHaveBeenCalledWith({}, 'screensaver', 'interval', 10);
        });
    });

    describe('getWallartSetting()', () => {
        test('calls getModeSetting with wallart mode', () => {
            const spy = jest.spyOn(capabilityRegistry, 'getModeSetting');
            capabilityRegistry.getWallartSetting({}, 'density', 'high');
            expect(spy).toHaveBeenCalledWith({}, 'wallart', 'density', 'high');
        });
    });

    describe('integration: init + getAvailableCapabilities with device states', () => {
        beforeEach(() => {
            capabilityRegistry.init();
        });

        test('playback capabilities available in screensaver mode', () => {
            const device = { currentState: { mode: 'screensaver' } };
            const available = capabilityRegistry.getAvailableCapabilities(device);
            const ids = available.map(c => c.id);

            expect(ids).toContain('playback.pause');
            expect(ids).toContain('playback.resume');
            expect(ids).toContain('playback.next');
            expect(ids).toContain('playback.previous');
        });

        test('playback capabilities NOT available in wallart mode', () => {
            const device = { currentState: { mode: 'wallart' } };
            const available = capabilityRegistry.getAvailableCapabilities(device);
            const ids = available.map(c => c.id);

            expect(ids).not.toContain('playback.pause');
        });

        test('power.on available when device powered off', () => {
            const device = { currentState: { poweredOff: true } };
            const available = capabilityRegistry.getAvailableCapabilities(device);
            const ids = available.map(c => c.id);

            expect(ids).toContain('power.on');
        });

        test('power.off available when device powered on', () => {
            const device = { currentState: { poweredOff: false } };
            const available = capabilityRegistry.getAvailableCapabilities(device);
            const ids = available.map(c => c.id);

            expect(ids).toContain('power.off');
        });

        test('pin.unpin available only when device pinned', () => {
            const devicePinned = { currentState: { mode: 'screensaver', pinned: true } };
            const deviceNotPinned = { currentState: { mode: 'screensaver', pinned: false } };

            const availablePinned = capabilityRegistry.getAvailableCapabilities(devicePinned);
            const availableNotPinned = capabilityRegistry.getAvailableCapabilities(deviceNotPinned);

            expect(availablePinned.map(c => c.id)).toContain('pin.unpin');
            expect(availableNotPinned.map(c => c.id)).not.toContain('pin.unpin');
        });
    });

    describe('commandHandler invocation', () => {
        beforeEach(() => {
            capabilityRegistry.init();
        });

        test('playback.pause commandHandler calls wsHub.sendCommand', async () => {
            const cap = capabilityRegistry.get('playback.pause');
            await cap.commandHandler('device-123');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-123', {
                type: 'playback.pause',
            });
        });

        test('playback.resume commandHandler calls wsHub.sendCommand', async () => {
            const cap = capabilityRegistry.get('playback.resume');
            await cap.commandHandler('device-123');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-123', {
                type: 'playback.resume',
            });
        });

        test('playback.next commandHandler calls wsHub.sendCommand', async () => {
            const cap = capabilityRegistry.get('playback.next');
            await cap.commandHandler('device-123');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-123', {
                type: 'playback.next',
            });
        });

        test('playback.previous commandHandler calls wsHub.sendCommand', async () => {
            const cap = capabilityRegistry.get('playback.previous');
            await cap.commandHandler('device-123');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-123', {
                type: 'playback.previous',
            });
        });

        test('playback.toggle commandHandler calls wsHub.sendCommand', async () => {
            const cap = capabilityRegistry.get('playback.toggle');
            await cap.commandHandler('device-123');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-123', {
                type: 'playback.toggle',
            });
        });

        test('power.on commandHandler calls wsHub.sendCommand', async () => {
            const cap = capabilityRegistry.get('power.on');
            await cap.commandHandler('device-456');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-456', {
                type: 'power.on',
            });
        });

        test('power.off commandHandler calls wsHub.sendCommand', async () => {
            const cap = capabilityRegistry.get('power.off');
            await cap.commandHandler('device-456');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-456', {
                type: 'power.off',
            });
        });

        test('power.toggle commandHandler with ON calls power.on', async () => {
            const cap = capabilityRegistry.get('power.toggle');
            await cap.commandHandler('device-456', 'ON');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-456', {
                type: 'power.on',
            });
        });

        test('power.toggle commandHandler with OFF calls power.off', async () => {
            const cap = capabilityRegistry.get('power.toggle');
            await cap.commandHandler('device-456', 'OFF');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-456', {
                type: 'power.off',
            });
        });

        test('pin.current commandHandler sends playback.pin', async () => {
            const cap = capabilityRegistry.get('pin.current');
            await cap.commandHandler('device-789');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-789', {
                type: 'playback.pin',
            });
        });

        test('pin.unpin commandHandler sends playback.unpin', async () => {
            const cap = capabilityRegistry.get('pin.unpin');
            await cap.commandHandler('device-789');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-789', {
                type: 'playback.unpin',
            });
        });

        test('mgmt.reload commandHandler sends core.mgmt.reload', async () => {
            const cap = capabilityRegistry.get('mgmt.reload');
            await cap.commandHandler('device-101');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-101', {
                type: 'core.mgmt.reload',
            });
        });

        test('mgmt.reset commandHandler sends core.mgmt.reset', async () => {
            const cap = capabilityRegistry.get('mgmt.reset');
            await cap.commandHandler('device-102');

            expect(wsHub.sendCommand).toHaveBeenCalledWith('device-102', {
                type: 'core.mgmt.reset',
            });
        });
    });
});
