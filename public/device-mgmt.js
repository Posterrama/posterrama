/*
 * Posterrama – Client Device Management (MVP)
 * - Persists deviceId/secret (localStorage MVP)
 * - Registers when missing
 * - Sends heartbeat every 20s and on visibility change
 * - Executes queued core mgmt commands: reload, swUnregister, clearCache
 * - Feature-flag aware via appConfig.deviceMgmt?.enabled; falls back to probing endpoints
 */

(function () {
    const logger =
        (window.logger && window.logger.scope && window.logger.scope('device')) || console;

    const STORAGE_KEYS = {
        id: 'posterrama.device.id',
        secret: 'posterrama.device.secret',
    };

    const state = {
        enabled: false,
        appConfig: null,
        heartbeatTimer: null,
        deviceId: null,
        deviceSecret: null,
    };

    function getStorage() {
        try {
            return window.localStorage;
        } catch (_) {
            return null;
        }
    }

    function loadIdentity() {
        const store = getStorage();
        if (!store) return { id: null, secret: null };
        const id = store.getItem(STORAGE_KEYS.id);
        const secret = store.getItem(STORAGE_KEYS.secret);
        return { id, secret };
    }

    function saveIdentity(id, secret) {
        const store = getStorage();
        if (!store) return;
        if (id) store.setItem(STORAGE_KEYS.id, id);
        if (secret) store.setItem(STORAGE_KEYS.secret, secret);
    }

    function cacheBustUrl(url) {
        const u = new URL(url, window.location.origin);
        u.searchParams.set('_r', Date.now().toString(36));
        return u.toString();
    }

    async function registerIfNeeded() {
        if (state.deviceId && state.deviceSecret) return true;
        try {
            const res = await fetch('/api/devices/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (!res.ok) {
                // Feature disabled or server error — disable client mgmt quietly
                state.enabled = false;
                return false;
            }
            const data = await res.json();
            state.deviceId = data.deviceId;
            state.deviceSecret = data.deviceSecret;
            saveIdentity(state.deviceId, state.deviceSecret);
            return true;
        } catch (e) {
            state.enabled = false;
            return false;
        }
    }

    function collectClientInfo() {
        try {
            return {
                userAgent: navigator.userAgent,
                screen: {
                    w: window.screen?.width || 0,
                    h: window.screen?.height || 0,
                    dpr: window.devicePixelRatio || 1,
                },
            };
        } catch (_) {
            return { userAgent: 'unknown', screen: { w: 0, h: 0, dpr: 1 } };
        }
    }

    function currentMode() {
        try {
            const cfg = state.appConfig || {};
            if (cfg.cinemaMode) return 'cinema';
            if (cfg.wallartMode && cfg.wallartMode.enabled) return 'wallart';
            return 'screensaver';
        } catch (_) {
            return 'unknown';
        }
    }

    async function sendHeartbeat() {
        if (!state.enabled || !state.deviceId || !state.deviceSecret) return;
        const payload = {
            deviceId: state.deviceId,
            deviceSecret: state.deviceSecret,
            userAgent: navigator.userAgent,
            screen: collectClientInfo().screen,
            mode: currentMode(),
            // current media/state can be extended later
        };
        try {
            const res = await fetch('/api/devices/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) return;
            const data = await res.json();
            if (Array.isArray(data.commandsQueued) && data.commandsQueued.length) {
                for (const cmd of data.commandsQueued) {
                    await handleCommand(cmd);
                }
            }
        } catch (_) {
            // silent; will retry on next tick
        }
    }

    async function handleCommand(cmd) {
        const type = cmd?.type || '';
        switch (type) {
            case 'core.mgmt.reload':
                forceReload();
                break;
            case 'core.mgmt.swUnregister':
                await unregisterServiceWorkers();
                // reload after unregister to ensure a clean scope
                forceReload();
                break;
            case 'core.mgmt.clearCache':
                await clearCaches();
                // optional reload after cache clear
                forceReload();
                break;
            default:
                break;
        }
    }

    function forceReload() {
        try {
            const busted = cacheBustUrl(window.location.href);
            window.location.replace(busted);
        } catch (_) {
            window.location.reload();
        }
    }

    async function unregisterServiceWorkers() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister().catch(() => {})));
        } catch (_) {
            // ignore
        }
    }

    async function clearCaches() {
        if (!('caches' in window)) return;
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
        } catch (_) {
            // ignore
        }
    }

    function startHeartbeat() {
        stopHeartbeat();
        // Stagger first beat a bit to avoid thundering herd on reloads
        const firstIn = 3000 + Math.floor(Math.random() * 2000);
        state.heartbeatTimer = setTimeout(() => {
            sendHeartbeat();
            state.heartbeatTimer = setInterval(sendHeartbeat, 20000);
        }, firstIn);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                // send a quick beat when user returns
                sendHeartbeat();
            }
        });
        window.addEventListener('resize', () => {
            // debounce small resize bursts
            let t;
            return () => {
                clearTimeout(t);
                t = setTimeout(sendHeartbeat, 500);
            };
        });
    }

    function stopHeartbeat() {
        if (state.heartbeatTimer) {
            clearTimeout(state.heartbeatTimer);
            clearInterval(state.heartbeatTimer);
            state.heartbeatTimer = null;
        }
    }

    async function init(appConfig) {
        state.appConfig = appConfig || {};
        // Respect feature flag if present; otherwise we probe during register
        state.enabled = !!(appConfig && appConfig.deviceMgmt && appConfig.deviceMgmt.enabled);

        const { id, secret } = loadIdentity();
        state.deviceId = id;
        state.deviceSecret = secret;

        if (!state.enabled && !id) {
            // If not explicitly enabled, attempt a one-time register probe
            const ok = await registerIfNeeded();
            if (!ok) return; // feature disabled remotely
            state.enabled = true;
        } else if (!id || !secret) {
            const ok = await registerIfNeeded();
            if (!ok) return;
        }

        startHeartbeat();
    }

    window.PosterramaDevice = { init };
})();
