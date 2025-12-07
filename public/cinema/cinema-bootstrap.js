'use strict';
(function () {
    // Force service worker update if available
    async function forceServiceWorkerUpdate() {
        try {
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration) {
                    await registration.update();
                    console.log('[Cinema Bootstrap] SW update requested');

                    // If there's a new SW waiting, activate it immediately
                    if (registration.waiting) {
                        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                        console.log('[Cinema Bootstrap] SW skip waiting sent');
                    }
                }
            }
        } catch (e) {
            console.warn('[Cinema Bootstrap] SW update error:', e.message);
        }
    }

    async function ensureConfig() {
        try {
            if (window.appConfig) return window.appConfig;
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
                Object.defineProperty(window, 'appConfig', { value: cfg, writable: true });
            } catch (_) {
                window.appConfig = cfg;
            }
            // Also expose as __serverConfig for consistency with admin.js
            try {
                window.__serverConfig = cfg;
            } catch (_) {
                // Ignore if readonly
            }
            return cfg;
        } catch (e) {
            return null;
        }
    }

    async function fetchOneMedia() {
        try {
            const cfg = window.appConfig || (await ensureConfig()) || {};
            const type = (cfg && cfg.type) || 'movies';

            // Check if rotation is enabled - if so, fetch more media
            const rotationEnabled = cfg.cinema?.rotationIntervalMinutes > 0;
            const count = rotationEnabled ? 50 : 1;

            // Check if games mode is active
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
            if (!res.ok) return null;
            const data = await res.json();
            const items = Array.isArray(data)
                ? data
                : Array.isArray(data?.results)
                  ? data.results
                  : [];

            // Shuffle items for random order on each page load
            // Fisher-Yates shuffle algorithm
            for (let i = items.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [items[i], items[j]] = [items[j], items[i]];
            }

            // If rotation enabled, return all items; otherwise return first one (now randomized)
            return rotationEnabled ? items : items[0] || null;
        } catch (err) {
            console.error('[Cinema Bootstrap] Fetch media failed:', err.message, err.name);
            return null;
        }
    }

    async function start() {
        try {
            // Force SW update first
            await forceServiceWorkerUpdate();

            await ensureConfig();
            // Initialize device management (WebSocket, heartbeat, etc.)
            // IMPORTANT: await init() so setup overlay completes before media check
            try {
                if (window.PosterramaDevice && window.PosterramaDevice.init) {
                    await window.PosterramaDevice.init(window.appConfig || {});
                }
            } catch (e) {
                console.warn('[Cinema Bootstrap] Failed to init device management:', e);
            }
            const media = await fetchOneMedia();
            if (!media) {
                console.log('[Cinema] No media available, redirecting to no-media page');
                window.location.replace('/no-media.html');
                return;
            }

            try {
                // If media is an array, store it; otherwise wrap in array
                const mediaArray = Array.isArray(media) ? media : [media];

                if (!Object.getOwnPropertyDescriptor(window, 'mediaQueue')) {
                    Object.defineProperty(window, 'mediaQueue', {
                        value: mediaArray,
                        writable: true,
                    });
                } else {
                    window.mediaQueue = mediaArray;
                }
            } catch (_) {
                window.mediaQueue = Array.isArray(media) ? media : [media];
            }

            // Dispatch event with first media item
            const firstMedia = Array.isArray(media) ? media[0] : media;
            window.dispatchEvent(
                new CustomEvent('mediaUpdated', { detail: { media: firstMedia } })
            );
        } catch (_) {
            // ignore: loader hide attempt after start is non-critical
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
