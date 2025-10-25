/**
 * Minimal tests for public/core.js helpers using a simulated DOM-like environment
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

// Mock BroadcastChannel to prevent open handles
global.BroadcastChannel = class MockBroadcastChannel {
    constructor(name) {
        this.name = name;
    }
    postMessage() {}
    close() {}
};

describe('PosterramaCore helpers (simulated)', () => {
    beforeAll(() => {
        // Simulate browser globals
        global.window = {
            location: {
                origin: 'http://localhost:4000',
                pathname: '/some/base/index.html',
                replace: jest.fn(),
            },
            navigator: {},
        };

        // Load and eval core.js in the simulated global context
        const src = fs.readFileSync(path.join(__dirname, '../../public/core.js'), 'utf8');
        // eslint-disable-next-line no-new-func
        new Function('window', src)(global.window);
    });

    afterAll(() => {
        // Clean up global window to prevent open handles
        delete global.window;
    });

    it('buildUrlForMode builds subpath-safe URLs', () => {
        const Core = global.window.PosterramaCore;
        expect(Core).toBeDefined();
        const c = Core.buildUrlForMode('cinema');
        const w = Core.buildUrlForMode('wallart');
        const s = Core.buildUrlForMode('screensaver');
        expect(c).toBe('http://localhost:4000/some/cinema');
        expect(w).toBe('http://localhost:4000/some/wallart');
        expect(s).toBe('http://localhost:4000/some/screensaver');
    });

    it('getActiveMode chooses correct mode from config', () => {
        const Core = global.window.PosterramaCore;
        expect(Core.getActiveMode({ cinemaMode: true })).toBe('cinema');
        expect(Core.getActiveMode({ wallartMode: { enabled: true } })).toBe('wallart');
        expect(Core.getActiveMode({})).toBe('screensaver');
        expect(Core.getActiveMode(null)).toBe('screensaver');
    });

    it('navigateToMode replaces location with debounced calls', () => {
        const Core = global.window.PosterramaCore;
        const calls = [];
        const orig = global.window.location.replace;
        global.window.location.replace = url => calls.push(url);
        try {
            Core.navigateToMode('cinema');
            Core.navigateToMode('wallart'); // debounced; should be ignored
            expect(calls.length).toBe(1);
            expect(calls[0]).toBe('http://localhost:4000/some/cinema');
        } finally {
            global.window.location.replace = orig;
        }
    });
});
