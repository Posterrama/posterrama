// Posterrama Core Utilities
(function () {
    const Core = {};

    Core.fetchConfig = async function fetchConfig(extra = {}) {
        const qs = `_t=${Date.now()}`;
        const url = `/get-config?${qs}`;

        // Build headers with device identity if available (for per-device settings override)
        const headers = {
            'Cache-Control': 'no-cache',
            ...(extra.headers || {}),
        };

        // Add device identity headers if device management is active
        try {
            if (typeof window !== 'undefined' && window.PosterramaDevice) {
                const deviceState = window.PosterramaDevice.getState?.();
                if (deviceState) {
                    if (deviceState.deviceId) headers['X-Device-Id'] = deviceState.deviceId;
                    if (deviceState.installId) headers['X-Install-Id'] = deviceState.installId;
                    if (deviceState.hardwareId) headers['X-Hardware-Id'] = deviceState.hardwareId;
                }
            }
        } catch (_) {
            // Ignore device header injection failures
        }

        const resp = await fetch(url, {
            cache: 'no-cache',
            headers,
            ...extra,
        });
        if (!resp.ok) throw new Error('config fetch failed');
        return resp.json();
    };

    Core.loadPromoOverlay = function loadPromoOverlay(cfg) {
        // Only load promo overlay if config flag is set (typically on port 4001 promo site)
        if (!cfg || cfg.promoBoxEnabled !== true) return;
        if (window.__promoBoxInjected) return; // Already loaded

        console.debug('[Core] Loading promo box overlay');

        // Load CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/promo/promo-box.css?v=' + Date.now();
        document.head.appendChild(link);

        // Load JS
        const script = document.createElement('script');
        script.src = '/promo/promo-box-overlay.js?v=' + Date.now();
        script.async = true;
        document.body.appendChild(script);

        // Also load Font Awesome for the GitHub icon if not already present
        if (!document.querySelector('link[href*="font-awesome"]')) {
            const fa = document.createElement('link');
            fa.rel = 'stylesheet';
            fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css';
            fa.integrity =
                'sha512-1ycn6IcaQQ40/MKBW2W4Rhis/DbILU74C1vSrLJxCq57o941Ym01SwNsOMqvEBFlcgUa6xLiPY/NS5R+E6ztJQ==';
            fa.crossOrigin = 'anonymous';
            fa.referrerPolicy = 'no-referrer';
            document.head.appendChild(fa);
        }

        // Load Google Fonts for promo box if not already present
        if (!document.querySelector('link[href*="fonts.googleapis.com"]')) {
            const fonts = document.createElement('link');
            fonts.rel = 'stylesheet';
            fonts.href =
                'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&family=Kalam:wght@400;700&display=swap';
            document.head.appendChild(fonts);
        }
    };

    Core.getActiveMode = function getActiveMode(cfg) {
        // First check for explicit mode property (device overrides from MQTT/HA)
        if (cfg?.mode && typeof cfg.mode === 'string') {
            const normalized = String(cfg.mode).toLowerCase();
            if (
                normalized === 'cinema' ||
                normalized === 'wallart' ||
                normalized === 'screensaver'
            ) {
                return normalized;
            }
        }
        // Fall back to legacy boolean flags (admin display settings)
        if (cfg?.cinemaMode === true) return 'cinema';
        if (cfg?.wallartMode?.enabled === true) return 'wallart';
        return 'screensaver';
    };

    Core.buildBasePath = function buildBasePath() {
        // Normalize: collapse multiple slashes
        let p = (window.location.pathname || '/').replace(/\/+/g, '/');
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
            // Examples: /wallart -> /, /app/wallart -> /app/, /cinema -> /
            const lastSlash = p.lastIndexOf('/');
            if (lastSlash >= 0) {
                p = p.substring(0, lastSlash + 1); // keep up to and including the slash
            }
        }

        // Ensure trailing slash
        if (!p.endsWith('/')) p += '/';
        // Collapse any resulting double slashes
        p = p.replace(/\/+/g, '/');
        return p;
    };

    Core.buildUrlForMode = function buildUrlForMode(mode) {
        const base = Core.buildBasePath();
        const origin = window.location.origin;

        // Determine the target mode segment
        let pathSegment = 'screensaver';
        if (mode === 'cinema') pathSegment = 'cinema';
        else if (mode === 'wallart') pathSegment = 'wallart';

        // Normalize base: ensure it starts and ends with a single slash
        let b = (base || '/').replace(/\/+/g, '/'); // collapse multiple slashes
        if (!b.startsWith('/')) b = '/' + b;
        if (!b.endsWith('/')) b += '/';

        // Remove any leading slashes from segment
        const seg = pathSegment.replace(/^\/+/, '');

        // Build full path: base + segment
        // Example: / + cinema = /cinema, /app/ + cinema = /app/cinema
        let fullPath = b + seg;

        // Ensure fullPath starts with a slash to prevent origin+path concatenation issues
        if (!fullPath.startsWith('/')) fullPath = '/' + fullPath;

        // Build full URL: origin + fullPath
        // Ensure origin has no trailing slash
        const cleanOrigin = origin.replace(/\/$/, '');

        return cleanOrigin + fullPath;
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
        window.debugLog &&
            window.debugLog('CORE_THROTTLE_RELOAD_CALLED', {
                nextUrl,
                timeSinceLastReload: now - lastReloadTs,
                willReload: now - lastReloadTs >= 8000,
            });
        if (now - lastReloadTs < 8000) return; // prevent rapid reload loops
        lastReloadTs = now;
        window.debugLog && window.debugLog('CORE_THROTTLE_RELOAD_EXECUTING', { nextUrl });
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
            window.debugLog && window.debugLog('AUTO_EXIT_SKIP_PREVIEW', {});
            return;
        }

        try {
            const currentMode = String(opts.currentMode || '').toLowerCase();
            const baseInterval = Math.max(5000, Number(opts.intervalMs || 15000));
            if (window.__autoExitTimer) {
                window.debugLog && window.debugLog('AUTO_EXIT_CLEAR_EXISTING', {});
                clearInterval(window.__autoExitTimer);
            }

            window.debugLog &&
                window.debugLog('AUTO_EXIT_SETUP', { currentMode, intervalMs: baseInterval });

            const tick = async () => {
                try {
                    // Skip tick if tab is not visible (prevents multi-tab navigation loops)
                    if (document.hidden || document.visibilityState === 'hidden') {
                        window.debugLog &&
                            window.debugLog('AUTO_EXIT_SKIP_HIDDEN', { currentMode });
                        return;
                    }

                    window.debugLog && window.debugLog('AUTO_EXIT_TICK', { currentMode });
                    const cfg = await Core.fetchConfig();

                    // Update window.appConfig with fresh config from server
                    // This ensures device-specific settings overrides are applied
                    if (cfg && typeof cfg === 'object') {
                        if (typeof window.appConfig === 'object' && window.appConfig !== null) {
                            // Merge fresh config into existing appConfig
                            Object.assign(window.appConfig, cfg);
                        } else {
                            window.appConfig = cfg;
                        }

                        // Dispatch settingsUpdated event so display modules can react
                        try {
                            const event = new CustomEvent('settingsUpdated', {
                                detail: { settings: cfg },
                            });
                            window.dispatchEvent(event);
                        } catch (_) {
                            // Ignore event dispatch errors
                        }
                    }

                    const target = Core.getActiveMode(cfg);
                    window.debugLog &&
                        window.debugLog('AUTO_EXIT_CHECK', {
                            currentMode,
                            targetMode: target,
                            willNavigate: target && currentMode && target !== currentMode,
                        });
                    if (target && currentMode && target !== currentMode) {
                        window.debugLog &&
                            window.debugLog('AUTO_EXIT_NAVIGATE', {
                                from: currentMode,
                                to: target,
                            });
                        Core.navigateToMode(target);
                    }
                } catch (e) {
                    window.debugLog &&
                        window.debugLog('AUTO_EXIT_TICK_ERROR', { error: e.message });
                }
            };

            // First check shortly after load, then at intervals with slight jitter
            window.debugLog && window.debugLog('AUTO_EXIT_FIRST_TICK', { delayMs: 800 });
            setTimeout(tick, 800);
            window.__autoExitTimer = setInterval(() => {
                const jitter = Math.floor(Math.random() * 1500);
                setTimeout(tick, jitter);
            }, baseInterval);
        } catch (e) {
            window.debugLog && window.debugLog('AUTO_EXIT_SETUP_ERROR', { error: e.message });
        }
    };

    // Global applySettings function for live configuration updates
    // Used by preview mode, WebSocket commands, and other runtime config changes
    // Deep merge helper for settings
    // Recursively merges source into target without losing nested properties
    function deepMerge(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                // Recursively merge nested objects
                result[key] = deepMerge(result[key] || {}, source[key]);
            } else {
                // Direct assignment for primitives and arrays
                result[key] = source[key];
            }
        }
        return result;
    }

    // Define this BEFORE setupPreviewListener so it's available when postMessage arrives
    window.applySettings = function applySettings(newSettings) {
        try {
            window.debugLog &&
                window.debugLog('APPLY_SETTINGS_CALLED', {
                    keys: Object.keys(newSettings),
                    cinemaMode: newSettings.cinemaMode,
                    wallartEnabled: newSettings.wallartMode?.enabled,
                    caller: new Error().stack.split('\n')[2]?.trim(),
                });

            console.log('[applySettings] Received settings update', {
                keys: Object.keys(newSettings),
                wallartMode: newSettings.wallartMode,
                cinemaMode: newSettings.cinemaMode,
                clockWidget: newSettings.clockWidget,
                showMetadata: newSettings.showMetadata,
            });

            // Merge new settings into existing appConfig using deep merge
            if (typeof window.appConfig === 'object' && window.appConfig !== null) {
                window.appConfig = deepMerge(window.appConfig, newSettings);
            } else {
                window.appConfig = newSettings;
            }

            console.log(
                '[applySettings] Updated window.appConfig, dispatching settingsUpdated event'
            );

            window.debugLog &&
                window.debugLog('APPLY_SETTINGS_DISPATCH_EVENT', {
                    hasWallartMode: !!newSettings.wallartMode,
                });

            // Trigger a custom event that modules can listen to for live updates
            window.dispatchEvent(
                new CustomEvent('settingsUpdated', {
                    detail: { settings: newSettings },
                })
            );
        } catch (e) {
            console.error('[applySettings] Failed to apply settings:', e);
            window.debugLog && window.debugLog('APPLY_SETTINGS_ERROR', { error: e.message });
        }
    };

    // Setup preview mode postMessage listener for live settings updates
    Core.setupPreviewListener = function setupPreviewListener() {
        if (!Core.isPreviewMode()) {
            return;
        }

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
            try {
                // Security: verify origin matches current window
                if (event.origin !== window.location.origin) {
                    return;
                }

                const data = event.data || {};

                // Handle preview update messages from admin
                if (data.type === 'posterrama.preview.update' && data.payload) {
                    // Store the preview config
                    window.__previewConfig = data.payload;

                    // Apply settings DIRECTLY inline instead of calling window.applySettings
                    try {
                        // Merge new settings into existing appConfig
                        if (typeof window.appConfig === 'object' && window.appConfig !== null) {
                            Object.assign(window.appConfig, data.payload);
                        } else {
                            window.appConfig = data.payload;
                        }

                        // Trigger a custom event that modules can listen to for live updates
                        window.dispatchEvent(
                            new CustomEvent('settingsUpdated', {
                                detail: { settings: data.payload },
                            })
                        );
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
        Core.setupPreviewListener();
    }

    // Expose
    window.PosterramaCore = Core;

    // Listen for config updates via BroadcastChannel (from admin Save Settings)
    // This allows all tabs (screensaver/wallart/cinema) to receive updates without WebSocket
    try {
        if (typeof BroadcastChannel !== 'undefined' && !Core.isPreviewMode()) {
            const configChannel = new BroadcastChannel('posterrama-config');
            configChannel.onmessage = event => {
                try {
                    if (event.data && event.data.type === 'config-updated') {
                        // Update window.appConfig first (merge new settings into existing config)
                        if (!window.appConfig) {
                            window.appConfig = {};
                        }
                        Object.assign(window.appConfig, event.data.settings);

                        // Dispatch settingsUpdated event just like WebSocket does
                        const settingsEvent = new CustomEvent('settingsUpdated', {
                            detail: { settings: event.data.settings },
                        });
                        window.dispatchEvent(settingsEvent);
                    }
                } catch (e) {
                    console.error('[Core] BroadcastChannel message handling failed:', e);
                }
            };
        }
    } catch (e) {
        console.warn('[Core] BroadcastChannel setup failed:', e);
    }

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
                            window.debugLog && window.debugLog('SW_CONTROLLERCHANGE_EVENT', {});
                            // Don't auto-reload display modes - they should run continuously
                            // Admin can manually reload if needed
                            const pathname = window.location.pathname;
                            const isDisplayMode =
                                pathname.includes('/wallart') ||
                                pathname.includes('/screensaver') ||
                                pathname.includes('/cinema');
                            if (isDisplayMode) {
                                window.debugLog &&
                                    window.debugLog('SW_CONTROLLERCHANGE_SKIPPED_DISPLAY', {
                                        pathname,
                                    });
                                return;
                            }
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
