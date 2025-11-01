'use strict';
(function () {
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

            const url = `/get-media?count=${count}&type=${encodeURIComponent(type)}`;
            const res = await fetch(url, {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' },
            });
            if (!res.ok) return null;
            const data = await res.json();
            const items = Array.isArray(data)
                ? data
                : Array.isArray(data?.results)
                  ? data.results
                  : [];

            // If rotation enabled, return all items; otherwise return first one
            return rotationEnabled ? items : items[0] || null;
        } catch (_) {
            return null;
        }
    }

    async function start() {
        try {
            await ensureConfig();
            // Initialize device management (WebSocket, heartbeat, etc.)
            try {
                if (window.PosterramaDevice && window.PosterramaDevice.init) {
                    window.PosterramaDevice.init(window.appConfig || {});
                }
            } catch (e) {
                console.warn('[Cinema Bootstrap] Failed to init device management:', e);
            }
            const media = await fetchOneMedia();
            if (media) {
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
            } else {
                // Show a minimal message when no media found, and hide loader to avoid spinner lock
                try {
                    const el = document.getElementById('error-message');
                    if (el) {
                        el.textContent = 'No media available';
                        el.classList.remove('is-hidden');
                    }
                    const loader = document.getElementById('loader');
                    if (loader) {
                        loader.style.opacity = '0';
                        loader.style.display = 'none';
                    }
                } catch (_) {
                    // ignore: cleanup failure is non-critical
                }
            }
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
