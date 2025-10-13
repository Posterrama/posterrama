/**
 * Minimal tests for public/core.js helpers using a simulated DOM-like environment
 */

describe('PosterramaCore helpers (simulated)', () => {
    beforeAll(() => {
        // Simulate browser globals
        global.window = {
            location: {
                origin: 'http://localhost:4000',
                pathname: '/some/base/index.html',
            },
        };
        // Load core.js into this environment
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.join(__dirname, '../../public/core.js'), 'utf8');
        // Execute the IIFE in this context
        // eslint-disable-next-line no-new-func
        new Function('window', src)(global.window);
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
});
