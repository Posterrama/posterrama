/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

describe('public/ui/auto-loader.js', () => {
    const filePath = path.join(__dirname, '../../public/ui/auto-loader.js');

    function loadModuleIntoContext({ window, document }) {
        const src = fs.readFileSync(filePath, 'utf8');

        const context = {
            window,
            document,
            MutationObserver: window.MutationObserver,
            Event: window.Event,
            URL,
            // Timers (Jest fake timers patch these globals)
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
        };

        vm.createContext(context);

        // Prefer true ESM evaluation when available
        if (typeof vm.SourceTextModule === 'function') {
            const mod = new vm.SourceTextModule(src, {
                context,
                identifier: 'public/ui/auto-loader.js',
            });

            // No imports in this module currently, but keep a linker for safety.
            return mod
                .link(() => {
                    throw new Error('auto-loader.js should not import modules in tests');
                })
                .then(() => mod.evaluate())
                .then(() => mod.namespace);
        }

        // Fallback: strip `export` keyword (keeps behavior testable)
        const rewritten =
            src.replace(/\bexport\s+function\s+initAutoLoader\s*\(/, 'function initAutoLoader(') +
            '\nwindow.__autoLoaderTestExports = { initAutoLoader };\n';

        vm.runInContext(rewritten, context, { filename: 'public/ui/auto-loader.js' });
        return Promise.resolve(context.window.__autoLoaderTestExports);
    }

    test('does nothing when no data-mode is set', async () => {
        jest.useFakeTimers();

        const dom = new JSDOM(`<!doctype html><html><head></head><body></body></html>`, {
            url: 'https://example.test/',
            pretendToBeVisual: true,
        });

        const exportsNs = await loadModuleIntoContext({
            window: dom.window,
            document: dom.window.document,
        });

        expect(typeof exportsNs.initAutoLoader).toBe('function');

        exportsNs.initAutoLoader({ timeoutMs: 200 });

        // No mode => should not inject loader
        expect(dom.window.document.getElementById('posterrama-loader')).toBeNull();

        jest.runOnlyPendingTimers();
        expect(dom.window.document.getElementById('posterrama-loader')).toBeNull();
    });

    test('shows loader in screensaver mode and hides on content-ready event', async () => {
        jest.useFakeTimers();

        const dom = new JSDOM(
            `<!doctype html><html><head></head><body data-mode="screensaver"><div id="poster"></div></body></html>`,
            {
                url: 'https://example.test/screensaver',
                pretendToBeVisual: true,
            }
        );

        const exportsNs = await loadModuleIntoContext({
            window: dom.window,
            document: dom.window.document,
        });

        const api = exportsNs.initAutoLoader({ timeoutMs: 2000, modes: ['screensaver'] });

        const loader = dom.window.document.getElementById('posterrama-loader');
        expect(loader).not.toBeNull();
        expect(loader.classList.contains('is-active')).toBe(true);

        api.markReady();

        // Hide is triggered; removal is delayed by 260ms
        jest.advanceTimersByTime(300);

        expect(dom.window.document.getElementById('posterrama-loader')).toBeNull();
    });

    test('wallart mode: gradient backgrounds do not count as ready', async () => {
        jest.useFakeTimers();

        const dom = new JSDOM(
            `<!doctype html><html><head></head><body data-mode="wallart">
              <div id="layer-a" style="background-image: linear-gradient(135deg, #111, #222);"></div>
              <div id="layer-b" style="background-image: linear-gradient(135deg, #111, #222);"></div>
              <div id="poster-a"></div>
              <div id="poster-b"></div>
              <div id="poster"></div>
            </body></html>`,
            {
                url: 'https://example.test/wallart',
                pretendToBeVisual: true,
            }
        );

        const exportsNs = await loadModuleIntoContext({
            window: dom.window,
            document: dom.window.document,
        });

        exportsNs.initAutoLoader({
            timeoutMs: 2000,
            modes: ['wallart'],
            enableBusyDetector: false,
        });

        const loader = dom.window.document.getElementById('posterrama-loader');
        expect(loader).not.toBeNull();
        expect(loader.classList.contains('is-active')).toBe(true);
    });

    test('wallart mode: hides loader when first wallart poster tile appears', async () => {
        jest.useFakeTimers();

        const dom = new JSDOM(
            `<!doctype html><html><head></head><body data-mode="wallart">
              <div id="layer-a"></div>
              <div id="layer-b"></div>
              <div id="wallart-grid"></div>
            </body></html>`,
            {
                url: 'https://example.test/wallart',
                pretendToBeVisual: true,
            }
        );

        const exportsNs = await loadModuleIntoContext({
            window: dom.window,
            document: dom.window.document,
        });

        exportsNs.initAutoLoader({
            timeoutMs: 2000,
            modes: ['wallart'],
            enableBusyDetector: false,
        });

        // Loader starts visible
        expect(dom.window.document.getElementById('posterrama-loader')).not.toBeNull();

        // Simulate first wallart tile render
        const grid = dom.window.document.getElementById('wallart-grid');
        const tile = dom.window.document.createElement('div');
        tile.className = 'wallart-poster-item';
        const img = dom.window.document.createElement('img');
        img.setAttribute('src', '/image/test.jpg');
        tile.appendChild(img);
        grid.appendChild(tile);

        // Polling runs every 750ms; removal is delayed ~220ms
        jest.advanceTimersByTime(1100);

        expect(dom.window.document.getElementById('posterrama-loader')).toBeNull();
    });
});
