// Posterrama Core Utilities
(function () {
    const Core = {};

    Core.fetchConfig = async function fetchConfig(extra = {}) {
        const qs = `_t=${Date.now()}`;
        const url = `/get-config?${qs}`;
        const resp = await fetch(url, {
            cache: 'no-cache',
            headers: { 'Cache-Control': 'no-cache' },
            ...extra,
        });
        if (!resp.ok) throw new Error('config fetch failed');
        return resp.json();
    };

    Core.getActiveMode = function getActiveMode(cfg) {
        if (cfg?.cinemaMode === true) return 'cinema';
        if (cfg?.wallartMode?.enabled === true) return 'wallart';
        return 'screensaver';
    };

    Core.buildBasePath = function buildBasePath() {
        // Normalize: collapse multiple slashes
        let p = (window.location.pathname || '/').replace(/\/+/, '/');
        p = p.replace(/\/+/g, '/');
        // Strip trailing slash (except root)
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        // Remove last segment
        p = p.replace(/[^/]+$/, '');
        // Ensure single trailing slash
        if (!p.endsWith('/')) p += '/';
        return p;
    };

    Core.buildUrlForMode = function buildUrlForMode(mode) {
        const base = Core.buildBasePath();
        const basePart = base === '/' ? '' : base;
        switch (mode) {
            case 'cinema':
                return window.location.origin + basePart + 'cinema';
            case 'wallart':
                return window.location.origin + basePart + 'wallart';
            case 'screensaver':
            default:
                return window.location.origin + basePart + 'screensaver';
        }
    };

    let lastNavTs = 0;
    Core.navigateToMode = function navigateToMode(mode, opts = {}) {
        const now = Date.now();
        if (now - lastNavTs < 1200) return; // debounce multi-triggers
        lastNavTs = now;
        const url = Core.buildUrlForMode(mode);
        if (opts.replace !== false) return void window.location.replace(url);
        window.location.href = url;
    };

    let lastReloadTs = 0;
    Core.throttleReload = function throttleReload(nextUrl) {
        const now = Date.now();
        if (now - lastReloadTs < 8000) return; // prevent rapid reload loops
        lastReloadTs = now;
        if (nextUrl) return void window.location.replace(nextUrl);
        window.location.reload();
    };

    Core.bootstrapLogger = function bootstrapLogger() {
        try {
            if (window.logger && typeof window.logger.isDebug === 'function') {
                return true;
            }
        } catch (_) {
            // ignore
        }
        return false;
    };

    // Expose
    window.PosterramaCore = Core;
})();
