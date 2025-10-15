/**
 * Minimal DOM/UI tests for Entry Route panel behavior.
 */

describe('Entry Route UI wiring', () => {
    beforeEach(() => {
        // Create a fresh DOM for each test with a deterministic base URL
        const { JSDOM } = require('jsdom');
        const dom = new JSDOM(
            `<!doctype html><html><body>
        <div id="rootRoute_status_wrap">
          <select id="rootRoute_statusCode"><option value="302">302</option><option value="307">307</option></select>
        </div>
        <select id="rootRoute_behavior">
          <option value="landing">Show landing</option>
          <option value="redirect">Redirect</option>
        </select>
        <input id="rootRoute_bypassParam" />
        <a id="rootRoute_bypass_open"></a>
                </body></html>`,
            { url: 'http://localhost/' }
        );
        global.window = dom.window;
        global.document = dom.window.document;
        // attach utils
        // eslint-disable-next-line global-require
        const utils = require('../../public/admin-utils.js');
        // expose for code that uses window
        // eslint-disable-next-line no-underscore-dangle
        global.window = Object.assign(global.window || {}, { __adminUtils: utils });
        // Ensure admin.js runs fresh each test with this DOM
        try {
            delete require.cache[require.resolve('../../public/admin.js')];
        } catch (_) {
            // ignore if not cached yet
        }
    });

    test('status select disabled when behavior!=redirect', () => {
        const utils = global.window.__adminUtils;
        const status = document.getElementById('rootRoute_statusCode');
        const wrap = document.getElementById('rootRoute_status_wrap');
        // initial landing
        utils.applyRedirectStatusState('landing', status, wrap);
        expect(status.disabled).toBe(true);
        // redirect
        utils.applyRedirectStatusState('redirect', status, wrap);
        expect(status.disabled).toBe(false);
        // back to landing
        utils.applyRedirectStatusState('landing', status, wrap);
        expect(status.disabled).toBe(true);
    });

    test('bypass link updates with input', () => {
        const utils = global.window.__adminUtils;
        const inp = document.getElementById('rootRoute_bypassParam');
        const link = document.getElementById('rootRoute_bypass_open');
        // wire like admin.js does
        const handler = () => utils.updateBypassOpenLink(link, (inp.value || '').trim());
        inp.addEventListener('input', handler);
        // init once
        handler();

        inp.value = 'landing';
        inp.dispatchEvent(new window.Event('input'));
        expect(link.textContent).toBe('Open /?landing');

        inp.value = '';
        inp.dispatchEvent(new window.Event('input'));
        expect(link.textContent).toBe('Open /');
    });
});
