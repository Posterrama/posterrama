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

        // If we're on an index.html path, step up two segments so mode URLs live next to the base
        // Example: /some/base/index.html -> /some/
        const parts = p.split('/').filter(Boolean); // removes empty segments
        if (parts.length > 0 && parts[parts.length - 1] === 'index.html') {
            parts.pop(); // remove index.html
            if (parts.length > 0) parts.pop(); // remove containing folder (e.g., "base")
            p = '/' + parts.join('/');
        } else {
            // Remove only the last segment (current file or page)
            p = p.replace(/[^/]+$/, '');
        }

        // Ensure single trailing slash
        if (!p.endsWith('/')) p += '/';
        return p;
    };

    Core.buildUrlForMode = function buildUrlForMode(mode) {
        const base = Core.buildBasePath();
        const origin = window.location.origin;
        switch (mode) {
            case 'cinema':
                return new URL(base + 'cinema', origin).toString();
            case 'wallart':
                return new URL(base + 'wallart', origin).toString();
            case 'screensaver':
            default:
                return new URL(base + 'screensaver', origin).toString();
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

    // Start a lightweight auto-exit poll that keeps the page in the correct mode
    // Options: { currentMode: 'cinema'|'wallart'|'screensaver', intervalMs?: number }
    Core.startAutoExitPoll = function startAutoExitPoll(opts = {}) {
        try {
            const currentMode = String(opts.currentMode || '').toLowerCase();
            const baseInterval = Math.max(5000, Number(opts.intervalMs || 15000));
            if (window.__autoExitTimer) clearInterval(window.__autoExitTimer);

            const tick = async () => {
                try {
                    const cfg = await Core.fetchConfig();
                    const target = Core.getActiveMode(cfg);
                    if (target && currentMode && target !== currentMode) {
                        Core.navigateToMode(target);
                    }
                } catch (_) {
                    // ignore transient failures
                }
            };

            // First check shortly after load, then at intervals with slight jitter
            setTimeout(tick, 800);
            window.__autoExitTimer = setInterval(() => {
                const jitter = Math.floor(Math.random() * 1500);
                setTimeout(tick, jitter);
            }, baseInterval);
        } catch (_) {
            /* ignore */
        }
    };

    // Expose
    window.PosterramaCore = Core;
})();
