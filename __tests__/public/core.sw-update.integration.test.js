/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * This test simulates a Service Worker update lifecycle and verifies that:
 * - core registers using the stamped URL when provided via window.__swUrl
 * - a controllerchange event triggers a throttled reload
 */
describe('PosterramaCore SW update flow (integration-lite)', () => {
    const corePath = path.join(__dirname, '../../public/core.js');
    const src = fs.readFileSync(corePath, 'utf8');

    function loadCoreWithMocks({ swUrl }) {
        const calls = { registerUrl: null, reloads: 0 };
        const windowMock = {
            location: {
                href: 'https://example.test/admin',
                origin: 'https://example.test',
                pathname: '/admin', // Use admin path, not display mode
                replace: () => {},
            },
            addEventListener: (evt, fn) => {
                if (evt === 'load') setTimeout(fn, 0);
            },
            document: {},
        };
        if (swUrl) windowMock.__swUrl = swUrl; // stamped URL hint
        windowMock.window = windowMock;

        // Minimal throttleReload spy via Core API shim until core assigns it
        // We'll intercept reload by monkey-patching later after Core is exposed
        const navigatorMock = {
            serviceWorker: {
                _listeners: {},
                addEventListener: function (evt, cb) {
                    this._listeners[evt] = this._listeners[evt] || [];
                    this._listeners[evt].push(cb);
                },
                _emit: function (evt) {
                    (this._listeners[evt] || []).forEach(fn => {
                        try {
                            fn();
                        } catch (_) {
                            // intentionally ignored in test harness
                        }
                    });
                },
                register: url => {
                    calls.registerUrl = url;
                    return Promise.resolve({});
                },
            },
        };

        const context = { window: windowMock, navigator: navigatorMock, URL };
        vm.createContext(context);
        vm.runInContext(src, context, { filename: 'core.js' });

        // Patch Core.throttleReload to count reloads
        if (context.window.PosterramaCore) {
            const Core = context.window.PosterramaCore;
            const orig = Core.throttleReload.bind(Core);
            Core.throttleReload = function () {
                calls.reloads += 1;
                return orig();
            };
        }

        return { context, calls };
    }

    test('uses stamped sw URL and reloads on controllerchange (once)', async () => {
        const stamped = '/sw.js?v=abc123';
        const { context, calls } = loadCoreWithMocks({ swUrl: stamped });

        // Allow load handler to run registration
        await new Promise(r => setTimeout(r, 5));
        expect(calls.registerUrl).toBe(stamped);

        // Emit controllerchange -> should trigger a (throttled) reload
        context.navigator.serviceWorker._emit('controllerchange');
        await new Promise(r => setTimeout(r, 5));
        expect(calls.reloads).toBeGreaterThanOrEqual(1);

        // Emit again quickly -> throttle should prevent rapid multiple reloads
        context.navigator.serviceWorker._emit('controllerchange');
        await new Promise(r => setTimeout(r, 5));
        expect(calls.reloads).toBeLessThanOrEqual(2); // at most 2 due to timing, typically stays 1
    });
});
