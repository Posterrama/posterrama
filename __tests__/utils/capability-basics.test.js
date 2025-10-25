/**
 * Basic capability registry tests
 * Focus on simple paths to improve coverage
 */

const capabilityRegistry = require('../../utils/capabilityRegistry');

describe('Capability Registry - Basic Coverage', () => {
    beforeAll(() => {
        capabilityRegistry.init();
    });

    test('should have register method', () => {
        expect(typeof capabilityRegistry.register).toBe('function');
    });

    test('should have get method', () => {
        expect(typeof capabilityRegistry.get).toBe('function');
    });

    test('should have has method', () => {
        expect(typeof capabilityRegistry.has).toBe('function');
    });

    test('should have getAllCapabilities method', () => {
        expect(typeof capabilityRegistry.getAllCapabilities).toBe('function');
    });

    test('should have getAvailableCapabilities method', () => {
        expect(typeof capabilityRegistry.getAvailableCapabilities).toBe('function');
    });

    test('should have getDeviceMode method', () => {
        expect(typeof capabilityRegistry.getDeviceMode).toBe('function');
    });

    test('getAllCapabilities returns array', () => {
        const caps = capabilityRegistry.getAllCapabilities();
        expect(Array.isArray(caps)).toBe(true);
        expect(caps.length).toBeGreaterThan(0);
    });

    test('getAvailableCapabilities returns array for device', () => {
        const device = { currentState: {} };
        const caps = capabilityRegistry.getAvailableCapabilities(device);
        expect(Array.isArray(caps)).toBe(true);
    });

    test('getDeviceMode returns screensaver by default', () => {
        const mode = capabilityRegistry.getDeviceMode({});
        expect(mode).toBe('screensaver');
    });

    test('getDeviceMode prefers clientInfo.mode', () => {
        const device = {
            clientInfo: { mode: 'cinema' },
            currentState: { mode: 'wallart' },
        };
        const mode = capabilityRegistry.getDeviceMode(device);
        expect(mode).toBe('cinema');
    });

    test('getCinemaSetting returns default when no override', () => {
        const device = {};
        const result = capabilityRegistry.getCinemaSetting(device, 'test.path', 123);
        expect(result).toBe(123);
    });

    test('getScreensaverSetting returns default when no override', () => {
        const device = {};
        const result = capabilityRegistry.getScreensaverSetting(device, 'test.path', 456);
        expect(result).toBe(456);
    });

    test('getWallartSetting returns default when no override', () => {
        const device = {};
        const result = capabilityRegistry.getWallartSetting(device, 'test.path', 789);
        expect(result).toBe(789);
    });

    test('has returns true for registered capabilities', () => {
        expect(capabilityRegistry.has('playback.pause')).toBe(true);
        expect(capabilityRegistry.has('power.toggle')).toBe(true);
    });

    test('has returns false for non-existent capabilities', () => {
        expect(capabilityRegistry.has('nonexistent.capability')).toBe(false);
    });

    test('get returns capability object for existing', () => {
        const cap = capabilityRegistry.get('playback.pause');
        expect(cap).toBeDefined();
        expect(cap.id).toBe('playback.pause');
    });

    test('get returns null/undefined for non-existent', () => {
        const cap = capabilityRegistry.get('does.not.exist');
        expect(cap == null).toBe(true); // null or undefined
    });

    test('register adds new capability', () => {
        capabilityRegistry.register('test.new.cap', {
            name: 'Test Capability',
        });
        expect(capabilityRegistry.has('test.new.cap')).toBe(true);
    });

    test('register uses defaults for missing fields', () => {
        capabilityRegistry.register('test.defaults', {
            name: 'Minimal Test',
        });
        const cap = capabilityRegistry.get('test.defaults');
        expect(cap.entityType).toBe('button');
        expect(cap.category).toBe('general');
        expect(cap.icon).toBe('mdi:help');
    });

    test('getModeSetting handles nested paths', () => {
        const device = {
            settingsOverride: {
                cinema: {
                    poster: { transition: 5000 },
                },
            },
        };
        const result = capabilityRegistry.getModeSetting(
            device,
            'cinema',
            'poster.transition',
            3000
        );
        expect(result).toBe(5000);
    });

    test('getModeSetting fallback chain works', () => {
        const device = {};
        const result = capabilityRegistry.getModeSetting(device, 'cinema', 'missing.path', 999);
        expect(result).toBe(999);
    });

    test('capabilities have required properties', () => {
        const cap = capabilityRegistry.get('playback.pause');
        expect(cap).toHaveProperty('id');
        expect(cap).toHaveProperty('name');
        expect(cap).toHaveProperty('entityType');
        expect(cap).toHaveProperty('category');
        expect(cap).toHaveProperty('icon');
        expect(cap).toHaveProperty('commandHandler');
        expect(cap).toHaveProperty('availableWhen');
    });

    test('playback capabilities are registered', () => {
        [
            'playback.pause',
            'playback.resume',
            'playback.next',
            'playback.previous',
            'playback.toggle',
        ].forEach(id => expect(capabilityRegistry.has(id)).toBe(true));
    });

    test('power capabilities are registered', () => {
        ['power.toggle', 'power.on', 'power.off'].forEach(id =>
            expect(capabilityRegistry.has(id)).toBe(true)
        );
    });

    test('pin capabilities are registered', () => {
        ['pin.current', 'pin.unpin'].forEach(id => expect(capabilityRegistry.has(id)).toBe(true));
    });

    test('mgmt capabilities are registered', () => {
        ['mgmt.reload', 'mgmt.reset'].forEach(id => expect(capabilityRegistry.has(id)).toBe(true));
    });

    test('mode capability is registered', () => {
        expect(capabilityRegistry.has('mode.select')).toBe(true);
        const mode = capabilityRegistry.get('mode.select');
        expect(mode.entityType).toBe('select');
        expect(mode.options).toContain('cinema');
        expect(mode.options).toContain('screensaver');
        expect(mode.options).toContain('wallart');
    });
});
