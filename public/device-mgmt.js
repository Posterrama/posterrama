/*
 * Posterrama – Client Device Management (MVP)
 * - Persists deviceId/secret (localStorage MVP)
 * - Registers when missing
 * - Sends heartbeat every 20s and on visibility change
 * - Executes queued core mgmt commands: reload, swUnregister, clearCache
 * - Feature-flag aware via appConfig.deviceMgmt?.enabled; falls back to probing endpoints
 */

(function () {
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
        installId: null,
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

    function clearIdentity() {
        const store = getStorage();
        if (!store) return;
        try {
            store.removeItem(STORAGE_KEYS.id);
            store.removeItem(STORAGE_KEYS.secret);
        } catch (_) {}
    }

    function cacheBustUrl(url) {
        const u = new URL(url, window.location.origin);
        u.searchParams.set('_r', Date.now().toString(36));
        return u.toString();
    }

    function getInstallId() {
        const store = getStorage();
        if (!store) return null;
        let iid = store.getItem('posterrama.installId');
        if (!iid) {
            iid =
                (crypto && crypto.randomUUID
                    ? crypto.randomUUID()
                    : Math.random().toString(36).slice(2)) +
                '-' +
                Date.now().toString(36);
            try {
                store.setItem('posterrama.installId', iid);
            } catch (_) {}
        }
        return iid;
    }

    async function registerIfNeeded() {
        if (state.deviceId && state.deviceSecret) return true;
        try {
            state.installId = state.installId || getInstallId();
            const res = await fetch('/api/devices/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Install-Id': state.installId },
                body: JSON.stringify({ installId: state.installId }),
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
            installId: state.installId || getInstallId(),
            userAgent: navigator.userAgent,
            screen: collectClientInfo().screen,
            mode: currentMode(),
            // current media/state can be extended later
        };
        try {
            const res = await fetch('/api/devices/heartbeat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Always include the same stable install id header
                    'X-Install-Id': state.installId || getInstallId(),
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                // If the server says unauthorized or not found, our device was likely deleted.
                if (res.status === 401 || res.status === 404) {
                    // Drop local identity and attempt seamless re-registration once.
                    clearIdentity();
                    state.deviceId = null;
                    state.deviceSecret = null;
                    const registered = await registerIfNeeded();
                    if (registered) {
                        // Push a fresh heartbeat with the new identity.
                        await sendHeartbeat();
                    }
                }
                return;
            }
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
        // debounce small resize bursts
        let resizeDebounce;
        window.addEventListener('resize', () => {
            clearTimeout(resizeDebounce);
            resizeDebounce = setTimeout(sendHeartbeat, 500);
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

        const { id, secret } = loadIdentity();
        state.deviceId = id;
        state.deviceSecret = secret;
        state.installId = getInstallId();
        const hasIdentity = !!(id && secret);

        // Enable if flag is set OR if we already have an identity (optimistic mode)
        state.enabled = !!(appConfig && appConfig.deviceMgmt && appConfig.deviceMgmt.enabled);
        if (!state.enabled && hasIdentity) state.enabled = true;

        // If URL contains a reset hint, force identity reset and re-register.
        try {
            const sp = new URLSearchParams(window.location.search);
            const shouldReset =
                sp.get('deviceReset') === '1' ||
                sp.get('device') === 'reset' ||
                sp.get('devreset') === '1';
            if (shouldReset) {
                // Clean the URL (no param) to avoid loops
                try {
                    const url = new URL(window.location.href);
                    ['deviceReset', 'device', 'devreset'].forEach(k => url.searchParams.delete(k));
                    window.history.replaceState({}, document.title, url.toString());
                } catch (_) {}
                // Perform reset + reload for clarity
                if (
                    window.PosterramaDevice &&
                    typeof window.PosterramaDevice.resetIdentity === 'function'
                ) {
                    window.PosterramaDevice.resetIdentity();
                    return; // prevent starting old heartbeat
                }
            }
        } catch (_) {}

        // If no identity yet, try to register once; if register fails, stop silently
        if (!hasIdentity) {
            const ok = await registerIfNeeded();
            if (!ok) {
                state.enabled = false;
                return;
            }
            state.enabled = true;
        }

        // Start interval and also send one immediate heartbeat for visibility in Network tab
        startHeartbeat();
        sendHeartbeat();
    }

    // Expose minimal debug helpers for testing without server roundtrip
    window.PosterramaDevice = {
        init,
        resetIdentity: () => {
            try {
                clearIdentity();
                state.deviceId = null;
                state.deviceSecret = null;
                // force a quick re-register + reload for clarity
                registerIfNeeded().then(() => {
                    try {
                        window.location.reload();
                    } catch (_) {}
                });
            } catch (_) {}
        },
        debugHandle: async cmd => {
            try {
                await handleCommand(cmd);
            } catch (_) {
                /* ignore */
            }
        },
        debugBeat: () => {
            try {
                return sendHeartbeat();
            } catch (_) {
                /* ignore */
            }
        },
    };
})();
