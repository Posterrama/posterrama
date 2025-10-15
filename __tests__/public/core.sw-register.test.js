/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('PosterramaCore service worker registration', () => {
    const corePath = path.join(__dirname, '../../public/core.js');
    const src = fs.readFileSync(corePath, 'utf8');

    function loadWithServiceWorkerSupport() {
        const registered = { called: false, url: null };
        const windowMock = {
            location: {
                href: 'https://example.test/wallart',
                origin: 'https://example.test',
                pathname: '/wallart',
                replace() {},
            },
            addEventListener: (evt, fn) => {
                if (evt === 'load') setTimeout(fn, 0);
            },
            document: {},
        };
        windowMock.window = windowMock;
        const navigatorMock = {
            serviceWorker: {
                register: url => {
                    registered.called = true;
                    registered.url = url;
                    return Promise.resolve({});
                },
            },
        };
        const context = { window: windowMock, navigator: navigatorMock, URL };
        vm.createContext(context);
        vm.runInContext(src, context, { filename: 'core.js' });
        return new Promise(resolve => setTimeout(() => resolve(registered), 5));
    }

    test('registers sw.js on load when supported', async () => {
        const res = await loadWithServiceWorkerSupport();
        expect(res.called).toBe(true);
        expect(res.url).toContain('/sw.js');
    });
});
