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
            const url = `/get-media?count=1&type=${encodeURIComponent(type)}`;
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
            return items[0] || null;
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
                    if (!Object.getOwnPropertyDescriptor(window, 'mediaQueue')) {
                        Object.defineProperty(window, 'mediaQueue', {
                            value: [media],
                            writable: true,
                        });
                    } else {
                        window.mediaQueue = [media];
                    }
                } catch (_) {
                    window.mediaQueue = [media];
                }
                window.dispatchEvent(new CustomEvent('mediaUpdated', { detail: { media } }));
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
