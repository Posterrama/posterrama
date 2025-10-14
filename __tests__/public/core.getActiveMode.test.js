/* Regression + unit tests for PosterramaCore.getActiveMode */
/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('PosterramaCore.getActiveMode', () => {
    const coreFile = path.join(__dirname, '../../public/core.js');
    const coreSource = fs.readFileSync(coreFile, 'utf8');

    function loadCore() {
        const context = {
            window: { location: { pathname: '/', origin: 'https://example.test' } },
            URL,
        };
        context.window.window = context.window;
        vm.createContext(context);
        vm.runInContext(coreSource, context);
        return context.window.PosterramaCore;
    }

    test('cinemaMode true => cinema', () => {
        const core = loadCore();
        expect(core.getActiveMode({ cinemaMode: true })).toBe('cinema');
    });

    test('wallart enabled => wallart', () => {
        const core = loadCore();
        expect(core.getActiveMode({ wallartMode: { enabled: true } })).toBe('wallart');
    });

    test('default fallback => screensaver', () => {
        const core = loadCore();
        expect(core.getActiveMode({})).toBe('screensaver');
        expect(core.getActiveMode(null)).toBe('screensaver');
    });

    test('wallart preferred only if cinema not forced', () => {
        const core = loadCore();
        expect(core.getActiveMode({ cinemaMode: true, wallartMode: { enabled: true } })).toBe(
            'cinema'
        );
    });
});
