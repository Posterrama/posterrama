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
        hardwareId: null,
        ws: null,
        wsTimer: null,
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
        } catch (_) {
            // ignore storage removal errors
        }
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
            } catch (_) {
                // ignore inability to persist installId
            }
        }
        return iid;
    }

    // Best-effort hardwareId across browsers on the same machine:
    // - Use persistentStorage API to request durability
    // - Combine userAgent, platform, screen metrics, timezone, and language
    // - Store in localStorage when available to keep stable per browser profile
    function computeHardwareId() {
        try {
            const nav = navigator || {};
            const scr = window.screen || {};
            const hints = [
                nav.platform || '',
                (scr.width || 0) + 'x' + (scr.height || 0) + '@' + (window.devicePixelRatio || 1),
                Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                (nav.language || '') + '|' + (nav.languages || []).join(','),
                (nav.hardwareConcurrency || 0) + 'c',
                (nav.deviceMemory || 0) + 'gb',
                (scr.colorDepth || 0) + 'cd',
                (scr.pixelDepth || 0) + 'pd',
                (nav.maxTouchPoints || 0) + 'tp',
            ].join('|');
            // Simple, stable hash (FNV-1a)
            let hash = 2166136261;
            for (let i = 0; i < hints.length; i++) {
                hash ^= hints.charCodeAt(i);
                hash = (hash >>> 0) * 16777619;
            }
            return 'hw-' + (hash >>> 0).toString(16);
        } catch (_) {
            return null;
        }
    }

    function getHardwareId() {
        const store = getStorage();
        try {
            let hw = store && store.getItem('posterrama.hardwareId');
            if (!hw) {
                hw = computeHardwareId();
                if (store && hw) store.setItem('posterrama.hardwareId', hw);
            }
            return hw;
        } catch (_) {
            return computeHardwareId();
        }
    }

    async function registerIfNeeded() {
        if (state.deviceId && state.deviceSecret) return true;
        try {
            state.installId = state.installId || getInstallId();
            state.hardwareId = state.hardwareId || getHardwareId();
            const res = await fetch('/api/devices/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Install-Id': state.installId,
                    'X-Hardware-Id': state.hardwareId || '',
                },
                body: JSON.stringify({ installId: state.installId, hardwareId: state.hardwareId }),
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
        // Try to collect mediaId, pin, and power state from the main app runtime (if available)
        let mediaId;
        let pinned;
        let pinMediaId;
        let poweredOff;
        try {
            if (typeof window !== 'undefined') {
                // Current media identifier exposed by script.js
                if (window.__posterramaCurrentMediaId != null)
                    mediaId = window.__posterramaCurrentMediaId;
                // Pin state and the media it pinned (if available)
                if (window.__posterramaPinned != null) pinned = !!window.__posterramaPinned;
                if (window.__posterramaPinnedMediaId != null)
                    pinMediaId = window.__posterramaPinnedMediaId;
                if (window.__posterramaPoweredOff != null)
                    poweredOff = !!window.__posterramaPoweredOff;
            }
        } catch (_) {
            // ignore inability to read runtime media state
        }
        const payload = {
            deviceId: state.deviceId,
            deviceSecret: state.deviceSecret,
            installId: state.installId || getInstallId(),
            hardwareId: state.hardwareId || getHardwareId(),
            userAgent: navigator.userAgent,
            screen: collectClientInfo().screen,
            mode: currentMode(),
            // Include playback paused state if the main app exposes it
            paused:
                typeof window !== 'undefined' && window.__posterramaPaused != null
                    ? !!window.__posterramaPaused
                    : undefined,
            mediaId,
            pinned,
            pinMediaId,
            poweredOff,
        };
        try {
            const res = await fetch('/api/devices/heartbeat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Always include the same stable install id header
                    'X-Install-Id': state.installId || getInstallId(),
                    'X-Hardware-Id': state.hardwareId || getHardwareId() || '',
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
                try {
                    liveDbg('[Live] heartbeat delivered commands', {
                        count: data.commandsQueued.length,
                        types: data.commandsQueued.map(c => c && c.type).filter(Boolean),
                    });
                } catch (_) {
                    /* ignore debug errors */
                }
                for (const cmd of data.commandsQueued) {
                    await handleCommand(cmd);
                }
            }
        } catch (_) {
            // silent; will retry on next tick
        }
    }

    // --- WebSocket live control ---
    // Debug logger (toggle with window.__POSTERRAMA_LIVE_DEBUG = false to silence)
    function liveDbg() {
        try {
            if (typeof window !== 'undefined' && window.__POSTERRAMA_LIVE_DEBUG === false) return;
        } catch (_) {
            // ignore logger availability check
        }
        try {
            if (
                typeof window !== 'undefined' &&
                window.logger &&
                typeof window.logger.debug === 'function' &&
                window.logger.isDebug &&
                window.logger.isDebug()
            ) {
                window.logger.debug.apply(window.logger, arguments);
            } else {
                // eslint-disable-next-line no-console
                console.info.apply(console, arguments);
            }
        } catch (_) {
            // ignore logger fallback
        }
    }
    function connectWS() {
        if (!state.enabled || !state.deviceId || !state.deviceSecret) return;
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${proto}://${window.location.host}/ws/devices`;
        try {
            const ws = new WebSocket(url);
            state.ws = ws;
            ws.onopen = () => {
                liveDbg('[Live] WS open', { url });
                try {
                    ws.send(
                        JSON.stringify({
                            kind: 'hello',
                            deviceId: state.deviceId,
                            deviceSecret: state.deviceSecret,
                        })
                    );
                    liveDbg('[Live] WS hello sent', { deviceId: state.deviceId });
                } catch (_) {
                    /* ignore initial hello send errors */
                }
            };
            ws.onmessage = ev => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (!msg || !msg.kind) return;
                    if (msg.kind === 'hello-ack') {
                        liveDbg('[Live] WS hello-ack');
                        return;
                    }
                    if (msg.kind === 'command') {
                        const t = msg.type || '';
                        liveDbg('[Live] WS command received', { type: t, payload: msg.payload });
                        // First try runtime playback hooks for immediate action
                        try {
                            const api = window.__posterramaPlayback || {};
                            if (t === 'playback.prev' && api.prev) {
                                liveDbg('[Live] invoking playback.prev');
                                return void api.prev();
                            }
                            if (t === 'playback.next' && api.next) {
                                liveDbg('[Live] invoking playback.next');
                                return void api.next();
                            }
                            if (t === 'playback.pause' && api.pause) {
                                liveDbg('[Live] invoking playback.pause');
                                return void api.pause();
                            }
                            if (t === 'playback.resume' && api.resume) {
                                liveDbg('[Live] invoking playback.resume');
                                return void api.resume();
                            }
                            if (t === 'playback.pinPoster' && api.pinPoster) {
                                liveDbg('[Live] invoking playback.pinPoster', {
                                    payload: msg.payload,
                                });
                                // Ensure we provide mediaId when pinning for better persistence
                                try {
                                    const mediaIdHint =
                                        (typeof window !== 'undefined' &&
                                            window.__posterramaCurrentMediaId) ||
                                        undefined;
                                    return void api.pinPoster({ mediaId: mediaIdHint });
                                } catch (_) {
                                    return void api.pinPoster(msg.payload);
                                }
                            }
                            if (t === 'source.switch' && api.switchSource) {
                                liveDbg('[Live] invoking source.switch', {
                                    sourceKey: msg.payload?.sourceKey,
                                });
                                return void api.switchSource(msg.payload?.sourceKey);
                            }
                            if (t === 'power.off' && api.powerOff) {
                                liveDbg('[Live] invoking power.off');
                                return void api.powerOff();
                            }
                            if (t === 'power.on' && api.powerOn) {
                                liveDbg('[Live] invoking power.on');
                                return void api.powerOn();
                            }
                            if (t === 'power.toggle' && api.powerToggle) {
                                liveDbg('[Live] invoking power.toggle');
                                return void api.powerToggle();
                            }
                        } catch (_) {
                            /* ignore playback hook errors */
                        }
                        // Fallback to mgmt command handler
                        liveDbg('[Live] delegating to handleCommand', { type: msg.type });
                        handleCommand({ type: msg.type, payload: msg.payload });
                    } else if (msg.kind === 'sync-tick') {
                        // Forward sync-tick to runtime slideshow for transition alignment
                        try {
                            if (typeof window.__posterramaOnSyncTick === 'function') {
                                window.__posterramaOnSyncTick(msg.payload || {});
                            }
                        } catch (_) {
                            /* ignore sync handler errors */
                        }
                    } else if (msg.kind === 'apply-settings' && msg.payload) {
                        // Apply partial settings live if script.js exposed applySettings
                        try {
                            if (typeof window.applySettings === 'function') {
                                liveDbg('[Live] WS apply-settings received', {
                                    keys: Object.keys(msg.payload || {}),
                                });
                                window.applySettings(msg.payload);
                            }
                        } catch (_) {
                            /* ignore applySettings errors */
                        }
                    }
                } catch (_) {
                    /* ignore ws message parse errors */
                }
            };
            ws.onclose = ev => {
                state.ws = null;
                try {
                    liveDbg('[Live] WS close', { code: ev?.code, reason: ev?.reason });
                } catch (_) {
                    // ignore parse or handling errors
                }
                scheduleReconnect();
            };
            ws.onerror = err => {
                try {
                    liveDbg('[Live] WS error', err);
                } catch (_) {
                    // ignore logging errors
                }
                try {
                    ws.close();
                } catch (_) {
                    /* ignore ws close errors */
                }
            };
        } catch (_) {
            liveDbg('[Live] WS connect exception, scheduling reconnect');
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (state.wsTimer) return;
        state.wsTimer = setTimeout(
            () => {
                state.wsTimer = null;
                connectWS();
            },
            3000 + Math.floor(Math.random() * 2000)
        );
    }

    async function handleCommand(cmd) {
        const type = cmd?.type || '';
        const payload = cmd?.payload;
        liveDbg('[Live] queued command received', { type });
        switch (type) {
            // Core management commands
            case 'core.mgmt.reload':
                forceReload();
                break;
            case 'core.mgmt.swUnregister':
                await unregisterServiceWorkers();
                // reload after unregister to ensure a clean scope
                forceReload();
                break;
            case 'core.mgmt.reset':
                try {
                    await clearCaches();
                } catch (_) {
                    // ignore cache clear errors
                }
                try {
                    await unregisterServiceWorkers();
                } catch (_) {
                    // ignore SW unregister errors
                }
                forceReload();
                break;
            case 'core.mgmt.clearCache':
                await clearCaches();
                // optional reload after cache clear
                forceReload();
                break;
            // Playback and power commands (mirror WS behavior)
            case 'playback.prev': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    if (api.prev) {
                        liveDbg('[Live] invoking playback.prev (queued)');
                        return void api.prev();
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            case 'playback.next': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    if (api.next) {
                        liveDbg('[Live] invoking playback.next (queued)');
                        return void api.next();
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            case 'playback.pause': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    if (api.pause) {
                        liveDbg('[Live] invoking playback.pause (queued)');
                        return void api.pause();
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            case 'playback.resume': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    if (api.resume) {
                        liveDbg('[Live] invoking playback.resume (queued)');
                        return void api.resume();
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            case 'playback.toggle': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    // If explicit toggle is provided, base decision on runtime paused flag when available
                    const paused =
                        typeof window !== 'undefined' && window.__posterramaPaused != null
                            ? !!window.__posterramaPaused
                            : null;
                    if (paused === true && api.resume) {
                        liveDbg('[Live] invoking playback.resume (queued via toggle)');
                        return void api.resume();
                    }
                    if (paused === false && api.pause) {
                        liveDbg('[Live] invoking playback.pause (queued via toggle)');
                        return void api.pause();
                    }
                    // Fallback: if pause available prefer pause; else try resume
                    if (api.pause) {
                        liveDbg('[Live] invoking playback.pause (queued via toggle,fallback)');
                        return void api.pause();
                    }
                    if (api.resume) {
                        liveDbg('[Live] invoking playback.resume (queued via toggle,fallback)');
                        return void api.resume();
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            case 'playback.pinPoster': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    if (api.pinPoster) {
                        liveDbg('[Live] invoking playback.pinPoster (queued)', { payload });
                        try {
                            const mediaIdHint =
                                (typeof window !== 'undefined' &&
                                    window.__posterramaCurrentMediaId) ||
                                undefined;
                            return void api.pinPoster({ mediaId: mediaIdHint });
                        } catch (_) {
                            return void api.pinPoster(payload);
                        }
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            case 'source.switch': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    if (api.switchSource) {
                        liveDbg('[Live] invoking source.switch (queued)', {
                            sourceKey: payload && payload.sourceKey,
                        });
                        return void api.switchSource(payload && payload.sourceKey);
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            case 'power.off': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    if (api.powerOff) {
                        liveDbg('[Live] invoking power.off (queued)');
                        return void api.powerOff();
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            case 'power.on': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    if (api.powerOn) {
                        liveDbg('[Live] invoking power.on (queued)');
                        return void api.powerOn();
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            case 'power.toggle': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    if (api.powerToggle) {
                        liveDbg('[Live] invoking power.toggle (queued)');
                        return void api.powerToggle();
                    }
                } catch (_) {
                    // ignore unsupported API or runtime
                }
                break;
            }
            default:
                // Unknown or unsupported command type
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
            await Promise.all(
                regs.map(r =>
                    r.unregister().catch(() => {
                        // ignore per-registration unregister errors
                    })
                )
            );
        } catch (_) {
            // ignore SW registry errors
        }
    }

    async function clearCaches() {
        if (!('caches' in window)) return;
        try {
            const keys = await caches.keys();
            await Promise.all(
                keys.map(k =>
                    caches.delete(k).catch(() => {
                        // ignore per-cache delete errors
                        return false;
                    })
                )
            );
        } catch (_) {
            // ignore cache deletion errors
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
        // connect live channel
        connectWS();
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
            // Pairing claim: allow ?pair=CODE or ?pairCode=CODE to adopt an existing device
            const pairCode = sp.get('pairCode') || sp.get('pair');
            if (pairCode && pairCode.trim()) {
                try {
                    const res = await fetch('/api/devices/pair', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: pairCode.trim() }),
                    });
                    if (res.ok) {
                        const data = await res.json();
                        // Save new identity and reload
                        saveIdentity(data.deviceId, data.deviceSecret);
                        state.deviceId = data.deviceId;
                        state.deviceSecret = data.deviceSecret;
                        // Clean the URL to avoid repeating
                        try {
                            const url = new URL(window.location.href);
                            url.searchParams.delete('pair');
                            url.searchParams.delete('pairCode');
                            window.history.replaceState({}, document.title, url.toString());
                        } catch (_) {
                            // ignore URL cleanup errors
                        }
                        // Reload to pick up the new identity cleanly
                        forceReload();
                        return;
                    } else {
                        // Pairing failed; remove params and continue normally
                        try {
                            const url = new URL(window.location.href);
                            url.searchParams.delete('pair');
                            url.searchParams.delete('pairCode');
                            window.history.replaceState({}, document.title, url.toString());
                        } catch (_) {
                            // ignore URL cleanup errors (pairing failed)
                        }
                    }
                } catch (_) {
                    // ignore pairing request errors
                }
            }
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
                } catch (_) {
                    // ignore URL cleanup errors
                }
                // Perform reset + reload for clarity
                if (
                    window.PosterramaDevice &&
                    typeof window.PosterramaDevice.resetIdentity === 'function'
                ) {
                    window.PosterramaDevice.resetIdentity();
                    return; // prevent starting old heartbeat
                }
            }
        } catch (_) {
            // ignore store.setItem errors
        }

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
        beat: () => {
            try {
                return sendHeartbeat();
            } catch (_) {
                /* ignore */
            }
        },
        resetIdentity: () => {
            try {
                clearIdentity();
                state.deviceId = null;
                state.deviceSecret = null;
                // force a quick re-register + reload for clarity
                registerIfNeeded().then(() => {
                    try {
                        window.location.reload();
                    } catch (_) {
                        // ignore reload errors
                    }
                });
            } catch (_) {
                // ignore resetIdentity errors
            }
        },
        debugHandle: async cmd => {
            try {
                await handleCommand(cmd);
            } catch (_) {
                // ignore debugHandle errors
            }
        },
        debugBeat: () => {
            try {
                return sendHeartbeat();
            } catch (_) {
                // ignore debugBeat errors
            }
        },
    };
})();
