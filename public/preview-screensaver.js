'use strict';
(function () {
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
                Object.defineProperty(window, 'appConfig', {
                    value: cfg,
                    writable: true,
                });
            } catch (_) {
                // fallback assign
                window.appConfig = cfg;
            }
            return true;
        } catch (_) {
            // noop
            return false;
        }
    }
    async function ensureMediaQueue() {
        try {
            if (Array.isArray(window.mediaQueue) && window.mediaQueue.length > 0) return true;
            const count = 12;
            const type = (window.appConfig && window.appConfig.type) || 'movies';
            const url = `/get-media?count=${count}&type=${encodeURIComponent(type)}`;
            const res = await fetch(url, {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' },
            });
            if (!res.ok) return false;
            const data = await res.json();
            const items = Array.isArray(data)
                ? data
                : Array.isArray(data?.results)
                  ? data.results
                  : [];
            if (!items.length) return false;
            try {
                Object.defineProperty(window, 'mediaQueue', {
                    value: items,
                    writable: true,
                });
            } catch (_) {
                // fallback assign
                window.mediaQueue = items;
            }
            return true;
        } catch (_) {
            // noop
            return false;
        }
    }
    async function start() {
        try {
            await ensureConfig();
            try {
                window.PosterramaDevice &&
                    window.PosterramaDevice.init &&
                    window.PosterramaDevice.init(window.appConfig || {});
            } catch (_) {
                // optional device init
            }
            await ensureMediaQueue();
            if (
                window.PosterramaScreensaver &&
                typeof window.PosterramaScreensaver.start === 'function'
            ) {
                window.PosterramaScreensaver.start();
                try {
                    const loader = document.getElementById('loader');
                    if (loader) {
                        loader.style.opacity = '0';
                        loader.style.display = 'none';
                    }
                } catch (_) {
                    // hide loader best-effort
                }
            }
        } catch (_) {
            // noop
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
