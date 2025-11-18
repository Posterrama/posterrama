/**
 * Screensaver Bootstrap Module
 *
 * Handles initialization logic for screensaver display mode
 */

/**
 * Force service worker update if available
 */
async function forceServiceWorkerUpdate() {
    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                await registration.update();
                console.log('[Screensaver] SW update requested');
            }
        }
    } catch (e) {
        console.warn('[Screensaver] SW update error:', e.message);
    }
}

/**
 * Ensure config is loaded into window.appConfig
 */
async function ensureConfig() {
    try {
        if (window.appConfig) return true;

        const useCore = !!(window.PosterramaCore && window.PosterramaCore.fetchConfig);
        const cfg = useCore
            ? await window.PosterramaCore.fetchConfig()
            : await (
                  await fetch('/get-config', {
                      cache: 'no-cache',
                      headers: { 'Cache-Control': 'no-cache' },
                  })
              ).json();

        try {
            if (!Object.getOwnPropertyDescriptor(window, 'appConfig')) {
                Object.defineProperty(window, 'appConfig', {
                    value: cfg,
                    writable: true,
                });
            } else {
                window.appConfig = cfg;
            }
        } catch (_) {
            window.appConfig = cfg;
        }

        // Also expose as __serverConfig for consistency with admin.js
        try {
            window.__serverConfig = cfg;
        } catch (_) {
            // Ignore if readonly
        }

        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Ensure media queue is loaded into window.mediaQueue
 */
async function ensureMediaQueue() {
    try {
        if (Array.isArray(window.mediaQueue) && window.mediaQueue.length > 0) return true;

        const count = 12; // fetch multiple items so screensaver can rotate
        const type = (window.appConfig && window.appConfig.type) || 'movies';

        // Check if games mode is active in config
        const wallartMode = window.__serverConfig?.wallartMode || {};
        const isGamesOnly = wallartMode.gamesOnly === true;

        // Build absolute URL for better Safari/iOS compatibility
        const baseUrl = window.location.origin;
        let url = `${baseUrl}/get-media?count=${count}&type=${encodeURIComponent(type)}`;

        // Add appropriate parameter based on games mode
        if (isGamesOnly) {
            url += '&gamesOnly=true';
        } else {
            url += '&excludeGames=1';
        }

        const res = await fetch(url, {
            method: 'GET',
            cache: 'no-cache',
            headers: {
                'Cache-Control': 'no-cache',
                Accept: 'application/json',
            },
            credentials: 'same-origin',
            mode: 'cors',
        });

        if (!res.ok) return false;

        const data = await res.json();
        const items = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];

        if (!items.length) return false;

        try {
            if (!Object.getOwnPropertyDescriptor(window, 'mediaQueue')) {
                Object.defineProperty(window, 'mediaQueue', {
                    value: items,
                    writable: true,
                });
            } else {
                window.mediaQueue = items;
            }
        } catch (_) {
            window.mediaQueue = items;
        }

        return true;
    } catch (err) {
        console.error('[Screensaver] Fetch media failed:', err.message, err.name);
        return false;
    }
}

/**
 * Start screensaver initialization sequence
 */
export async function startScreensaver() {
    try {
        // Force SW update first
        await forceServiceWorkerUpdate();

        // Load config and media
        await ensureConfig();

        // Initialize device management (optional)
        try {
            if (window.PosterramaDevice && window.PosterramaDevice.init) {
                window.PosterramaDevice.init(window.appConfig || {});
            }
        } catch (_) {
            // Device init is optional
        }

        const hasMedia = await ensureMediaQueue();
        if (!hasMedia) {
            console.log('[Screensaver] No media available, redirecting to no-media page');
            window.location.replace('/no-media.html');
            return;
        }

        // Preload first poster for better LCP (Largest Contentful Paint)
        try {
            if (Array.isArray(window.mediaQueue) && window.mediaQueue.length > 0) {
                const firstPoster = window.mediaQueue[0];
                const posterUrl = firstPoster?.posterUrl || firstPoster?.poster_path;

                if (posterUrl) {
                    // Create hidden image to trigger browser preload with high priority
                    const preloadImg = new Image();
                    preloadImg.fetchPriority = 'high';
                    preloadImg.src = posterUrl;
                    // No need to wait - browser will cache it
                }
            }
        } catch (_) {
            // Preload is optional performance optimization
        }

        // Debug log
        try {
            if (window.logger && window.logger.debug) {
                window.logger.debug('[Screensaver] bootstrap: config+media ready', {
                    count: (Array.isArray(window.mediaQueue) && window.mediaQueue.length) || 0,
                });
            }
        } catch (_) {
            // Debug logging is optional
        }

        // Start screensaver display
        if (
            window.PosterramaScreensaver &&
            typeof window.PosterramaScreensaver.start === 'function'
        ) {
            window.PosterramaScreensaver.start();
        }
    } catch (_) {
        // Silently fail - screensaver will show error state
    }
}

/**
 * Initialize screensaver when DOM is ready
 */
export function initScreensaver() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startScreensaver);
    } else {
        startScreensaver();
    }
}
