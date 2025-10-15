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
        // Helper to safely join base + segment ensuring exactly one slash after origin
        function join(seg) {
            let b = base || '/';
            if (!b.startsWith('/')) b = '/' + b; // enforce leading slash
            if (!b.endsWith('/')) b += '/';
            seg = (seg || '').replace(/^\/+/, '');
            return b + seg;
        }
        let pathSegment = 'screensaver';
        if (mode === 'cinema') pathSegment = 'cinema';
        else if (mode === 'wallart') pathSegment = 'wallart';
        const url = new URL(join(pathSegment), origin).toString();
        // Final hardening: if an implementation bug elsewhere stripped the slash after origin, fix it here
        try {
            const o = origin.replace(/\/?$/, '');
            if (url.startsWith(o) && !url.startsWith(o + '/')) {
                const rest = url.slice(o.length).replace(/^\/+/, '');
                return o + '/' + rest;
            }
        } catch (_) {
            /* ignore */
        }
        return url;
    };

    let lastNavTs = 0;
    Core.navigateToMode = function navigateToMode(mode, opts = {}) {
        const now = Date.now();
        if (now - lastNavTs < 1200) return; // debounce multi-triggers
        lastNavTs = now;
        let url = Core.buildUrlForMode(mode);
        // Safety: enforce slash after origin (guards against any malformed concatenations)
        try {
            const o = window.location.origin.replace(/\/?$/, '');
            if (url.startsWith(o) && !url.startsWith(o + '/')) {
                const rest = url.slice(o.length).replace(/^\/+/, '');
                url = o + '/' + rest;
            }
        } catch (_) {
            /* ignore */
        }
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

    // Lightweight, centralized Service Worker registration
    // Pages that include core.js (cinema, wallart, screensaver) will auto-register.
    // Server stamps /sw.js?v=<version> so we always fetch the latest worker.
    try {
        if ('serviceWorker' in navigator && !window.__swRegisteredViaCore) {
            window.addEventListener('load', () => {
                try {
                    navigator.serviceWorker
                        .register('/sw.js')
                        .then(() => {
                            window.__swRegisteredViaCore = true;
                        })
                        .catch(() => {
                            /* silent */
                        });
                } catch (_) {
                    /* ignore */
                }
            });
        }
    } catch (_) {
        /* ignore */
    }
})();
