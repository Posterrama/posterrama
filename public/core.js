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

        // Determine the target mode segment
        let pathSegment = 'screensaver';
        if (mode === 'cinema') pathSegment = 'cinema';
        else if (mode === 'wallart') pathSegment = 'wallart';

        // Ensure base starts with slash and ends with slash
        let b = base || '/';
        if (!b.startsWith('/')) b = '/' + b;
        if (!b.endsWith('/')) b += '/';

        // Remove leading slashes from segment
        const seg = pathSegment.replace(/^\/+/, '');

        // Build full URL: origin + base + segment
        // URL constructor requires origin to NOT have trailing slash, but our base already has leading slash
        const cleanOrigin = origin.replace(/\/$/, '');
        const fullPath = b + seg;

        return cleanOrigin + fullPath;
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

    // Detect if running in preview mode (iframe embed in admin)
    Core.isPreviewMode = function isPreviewMode() {
        try {
            // Check for ?preview=1 in URL (most reliable)
            const params = new URLSearchParams(window.location.search);
            if (params.get('preview') === '1') {
                return true;
            }

            // Also check if running in iframe (secondary check)
            try {
                if (window.self !== window.top) {
                    return true;
                }
            } catch (e) {
                // If we get a security error, we're definitely in a cross-origin iframe
                return true;
            }
        } catch (_) {
            /* ignore outer try errors */
        }
        return false;
    };

    // Start a lightweight auto-exit poll that keeps the page in the correct mode
    // Options: { currentMode: 'cinema'|'wallart'|'screensaver', intervalMs?: number }
    Core.startAutoExitPoll = function startAutoExitPoll(opts = {}) {
        // Skip auto-exit in preview mode to avoid navigation loops
        const inPreview = Core.isPreviewMode();
        if (inPreview) {
            return;
        }

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

    // Global applySettings function for live configuration updates
    // Used by preview mode, WebSocket commands, and other runtime config changes
    // Define this BEFORE setupPreviewListener so it's available when postMessage arrives
    window.applySettings = function applySettings(newSettings) {
        try {
            console.log('[applySettings] Received settings update', {
                keys: Object.keys(newSettings),
                cinemaMode: newSettings.cinemaMode,
                clockWidget: newSettings.clockWidget,
                showMetadata: newSettings.showMetadata,
            });

            // Merge new settings into existing appConfig
            if (typeof window.appConfig === 'object' && window.appConfig !== null) {
                Object.assign(window.appConfig, newSettings);
            } else {
                window.appConfig = newSettings;
            }

            console.log(
                '[applySettings] Updated window.appConfig, dispatching settingsUpdated event'
            );

            // Trigger a custom event that modules can listen to for live updates
            window.dispatchEvent(
                new CustomEvent('settingsUpdated', {
                    detail: { settings: newSettings },
                })
            );
        } catch (e) {
            console.error('[applySettings] Failed to apply settings:', e);
        }
    };

    // Setup preview mode postMessage listener for live settings updates
    Core.setupPreviewListener = function setupPreviewListener() {
        if (!Core.isPreviewMode()) {
            console.log('[setupPreviewListener] Not in preview mode, skipping');
            return;
        }

        console.log('[setupPreviewListener] Setting up preview listener in preview mode');

        // Store preview config override
        window.__previewConfig = null;

        // Override fetchConfig to return preview config when available
        const originalFetchConfig = Core.fetchConfig;
        Core.fetchConfig = async function (extra = {}) {
            // If we have a preview config override, merge it with the real config
            const realConfig = await originalFetchConfig(extra);
            if (window.__previewConfig) {
                // Merge preview config on top of real config
                return { ...realConfig, ...window.__previewConfig };
            }
            return realConfig;
        };

        window.addEventListener('message', event => {
            console.log('[setupPreviewListener] Received message event', {
                origin: event.origin,
                windowOrigin: window.location.origin,
                dataType: event.data?.type,
            });

            try {
                // Security: verify origin matches current window
                if (event.origin !== window.location.origin) {
                    console.log('[setupPreviewListener] Origin mismatch, ignoring');
                    return;
                }

                const data = event.data || {};

                // Handle preview update messages from admin
                if (data.type === 'posterrama.preview.update' && data.payload) {
                    console.log(
                        '[setupPreviewListener] Received preview update, applying directly',
                        {
                            payload: data.payload,
                            payloadKeys: Object.keys(data.payload || {}),
                        }
                    );

                    // Store the preview config
                    window.__previewConfig = data.payload;

                    // Apply settings DIRECTLY inline instead of calling window.applySettings
                    try {
                        // Merge new settings into existing appConfig
                        if (typeof window.appConfig === 'object' && window.appConfig !== null) {
                            console.log('[setupPreviewListener] Merging into existing appConfig');
                            Object.assign(window.appConfig, data.payload);
                        } else {
                            console.log('[setupPreviewListener] Creating new appConfig');
                            window.appConfig = data.payload;
                        }

                        console.log('[setupPreviewListener] Dispatching settingsUpdated event');

                        // Trigger a custom event that modules can listen to for live updates
                        window.dispatchEvent(
                            new CustomEvent('settingsUpdated', {
                                detail: { settings: data.payload },
                            })
                        );

                        console.log('[setupPreviewListener] Settings applied successfully');
                    } catch (e) {
                        console.error('[setupPreviewListener] Failed to apply settings:', e);
                    }
                }
            } catch (_) {
                /* ignore malformed messages */
            }
        });
    };

    // Auto-setup preview listener if in preview mode
    if (Core.isPreviewMode()) {
        console.log('[Core Init] In preview mode, calling setupPreviewListener');
        Core.setupPreviewListener();
    } else {
        console.log('[Core Init] Not in preview mode');
    }

    // Expose
    window.PosterramaCore = Core;

    // Lightweight, centralized Service Worker registration
    // Pages that include core.js (cinema, wallart, screensaver) will auto-register.
    // Server stamps /sw.js?v=<version> so we always fetch the latest worker.
    // Skip SW registration in preview mode to avoid conflicts with parent page
    try {
        if (
            'serviceWorker' in navigator &&
            !window.__swRegisteredViaCore &&
            !Core.isPreviewMode()
        ) {
            // Listen for controllerchange so when a new SW takes control we refresh the shell once
            try {
                const sw = navigator.serviceWorker;
                if (
                    sw &&
                    typeof sw.addEventListener === 'function' &&
                    !window.__swCtlChangeHooked
                ) {
                    sw.addEventListener('controllerchange', () => {
                        try {
                            // Debounced reload to avoid loops
                            Core.throttleReload();
                        } catch (_) {
                            /* ignore */
                        }
                    });
                    window.__swCtlChangeHooked = true;
                }
            } catch (_) {
                /* ignore */
            }
            window.addEventListener('load', () => {
                try {
                    const swUrl = window.__swUrl || '/sw.js';
                    navigator.serviceWorker
                        .register(swUrl)
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
