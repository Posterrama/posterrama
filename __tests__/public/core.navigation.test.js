/*
 * Regression tests for navigation URL building (wallart -> cinema missing slash bug)
 */

/** @jest-environment node */
// We emulate a browser-like window manually (lighter than switching global testEnvironment)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('PosterramaCore navigation URL building', () => {
    const coreFile = path.join(__dirname, '../../public/core.js');
    const coreSource = fs.readFileSync(coreFile, 'utf8');

    function createWindowAt(pathname) {
        const loc = new URL('https://example.test' + pathname);
        const win = {
            location: {
                href: loc.toString(),
                origin: loc.origin,
                pathname: loc.pathname,
                replace(url) {
                    this.href = url;
                },
            },
            history: {
                pushState: (_s, _t, newPath) => {
                    const nloc = new URL(loc.origin + newPath);
                    win.location.pathname = nloc.pathname;
                    win.location.href = nloc.toString();
                },
            },
            document: {},
        };
        return win;
    }

    function loadCoreAt(pathname) {
        const context = { window: createWindowAt(pathname), URL }; // expose global URL
        context.window.window = context.window; // self reference
        vm.createContext(context);
        vm.runInContext(coreSource, context, { filename: 'core.js' });
        return context.window.PosterramaCore;
    }

    test('wallart -> cinema includes single slash after origin', () => {
        const core = loadCoreAt('/wallart');
        const url = core.buildUrlForMode('cinema');
        expect(url).toBe('https://example.test/cinema');
    });

    test('wallart -> screensaver default pathing', () => {
        const core = loadCoreAt('/wallart');
        const url = core.buildUrlForMode('screensaver');
        expect(url).toBe('https://example.test/screensaver');
    });

    test('nested base path wallart -> cinema', () => {
        const core = loadCoreAt('/some/base/wallart');
        const url = core.buildUrlForMode('cinema');
        expect(url).toBe('https://example.test/some/base/cinema');
    });

    test('index.html stripping in base path', () => {
        const core = loadCoreAt('/some/base/index.html');
        const url = core.buildUrlForMode('wallart');
        expect(url).toBe('https://example.test/some/wallart');
    });

    test('navigateToMode applies same normalization', () => {
        // Re-load to get a fresh window with spyable replace
        const context = { window: undefined, URL };
        const w = {
            location: {
                href: 'https://example.test/wallart',
                origin: 'https://example.test',
                pathname: '/wallart',
                replaceCalled: null,
                replace(url) {
                    this.replaceCalled = url;
                },
            },
            history: { pushState: () => {} },
            document: {},
        };
        w.window = w;
        context.window = w;
        vm.createContext(context);
        vm.runInContext(coreSource, context);
        context.window.PosterramaCore.navigateToMode('cinema');
        expect(context.window.location.replaceCalled).toBe('https://example.test/cinema');
    });

    test('deep subpath wallart -> screensaver keeps hierarchy', () => {
        const core = loadCoreAt('/a/b/c/wallart');
        const url = core.buildUrlForMode('screensaver');
        expect(url).toBe('https://example.test/a/b/c/screensaver');
    });

    test('root path screensaver -> cinema', () => {
        const core = loadCoreAt('/screensaver');
        const url = core.buildUrlForMode('cinema');
        expect(url).toBe('https://example.test/cinema');
    });
});
