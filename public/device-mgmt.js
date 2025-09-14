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
            /* noop: unable to access localStorage */
            return null;
        }
    }

    // --- IndexedDB-backed identity storage (with localStorage fallback & migration) ---
    async function openIDB() {
        if (!('indexedDB' in window)) throw new Error('no_idb');
        return await new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open('posterrama', 1);
                req.onupgradeneeded = () => {
                    try {
                        const db = req.result;
                        if (!db.objectStoreNames.contains('device')) db.createObjectStore('device');
                    } catch (_) {
                        /* noop: ignore upgrade errors */
                    }
                };
                req.onerror = () => reject(req.error || new Error('idb_open_error'));
                req.onsuccess = () => resolve(req.result);
            } catch (e) {
                reject(e);
            }
        });
    }

    async function idbGetIdentity() {
        try {
            const db = await openIDB();
            return await new Promise(resolve => {
                try {
                    const tx = db.transaction('device', 'readonly');
                    const store = tx.objectStore('device');
                    const req = store.get('identity');
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                } catch (_) {
                    /* noop: unable to retrieve identity */
                    resolve(null);
                }
            });
        } catch (_) {
            /* noop: unable to open IDB */
            return null;
        }
    }

    async function idbSaveIdentity(id, secret) {
        try {
            const db = await openIDB();
            await new Promise((resolve, reject) => {
                try {
                    const tx = db.transaction('device', 'readwrite');
                    const store = tx.objectStore('device');
                    store.put({ id, secret }, 'identity');
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => reject(tx.error || new Error('idb_tx_error'));
                } catch (e) {
                    reject(e);
                }
            });
        } catch (_) {
            /* noop: ignore idb write errors */
        }
    }

    async function idbClearIdentity() {
        try {
            const db = await openIDB();
            await new Promise((resolve, reject) => {
                try {
                    const tx = db.transaction('device', 'readwrite');
                    const store = tx.objectStore('device');
                    store.delete('identity');
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => reject(tx.error || new Error('idb_tx_error'));
                } catch (e) {
                    reject(e);
                }
            });
        } catch (_) {
            /* noop: ignore idb delete errors */
        }
    }
    async function loadIdentityAsync() {
        // Prefer IndexedDB; migrate from localStorage if present there only
        const fromIdb = await idbGetIdentity();
        if (fromIdb && fromIdb.id && fromIdb.secret) {
            return { id: fromIdb.id, secret: fromIdb.secret };
        }
        const store = getStorage();
        if (!store) return { id: null, secret: null };
        const id = store.getItem(STORAGE_KEYS.id);
        const secret = store.getItem(STORAGE_KEYS.secret);
        if (id && secret) {
            // Migrate to IDB (best-effort)
            try {
                await idbSaveIdentity(id, secret);
            } catch (_) {
                /* noop: ignore migration errors */
            }
        }
        return { id, secret };
    }
    async function saveIdentity(id, secret) {
        const store = getStorage();
        if (store) {
            try {
                if (id) store.setItem(STORAGE_KEYS.id, id);
                if (secret) store.setItem(STORAGE_KEYS.secret, secret);
            } catch (_) {
                // ignore localStorage errors
            }
        }
        await idbSaveIdentity(id, secret);
    }
    function clearIdentity() {
        const store = getStorage();
        if (store) {
            try {
                store.removeItem(STORAGE_KEYS.id);
                store.removeItem(STORAGE_KEYS.secret);
            } catch (_) {
                // ignore localStorage remove errors
            }
        }
        // Fire-and-forget IDB cleanup
        idbClearIdentity();
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
            try {
                const rand =
                    typeof crypto !== 'undefined' && crypto.randomUUID
                        ? crypto.randomUUID()
                        : Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
                iid = 'inst-' + rand;
            } catch (_) {
                iid = 'inst-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
            }
            try {
                store.setItem('posterrama.installId', iid);
            } catch (_) {
                // ignore inability to persist installId
            }
        }
        return iid;
    }

    // Best-effort hardwareId across browsers on the same machine:
    // - Combine platform, screen metrics, timezone, language, cpu/mem hints, and touch
    // - Include timezone offset to differentiate DST/locale changes less
    function computeHardwareId() {
        try {
            const nav = navigator || {};
            const scr = window.screen || {};
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            const langs = (nav.languages || []).join(',') || nav.language || '';
            const hints = [
                nav.platform || '',
                (scr.width || 0) + 'x' + (scr.height || 0) + '@' + (window.devicePixelRatio || 1),
                tz,
                langs,
                nav.deviceMemory != null ? nav.deviceMemory + 'gb' : '',
                scr.colorDepth != null ? scr.colorDepth + 'cd' : '',
                scr.pixelDepth != null ? scr.pixelDepth + 'pd' : '',
                nav.maxTouchPoints != null ? nav.maxTouchPoints + 'tp' : '',
                String(new Date().getTimezoneOffset()),
            ].join('|');
            // FNV-1a 32-bit hash
            let hash = 0x811c9dc5;
            for (let i = 0; i < hints.length; i++) {
                hash ^= hints.charCodeAt(i);
                hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
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
            return null;
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
                    'X-Install-Id': state.installId || '',
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
            state.deviceSecret = data.deviceSecret;
            await saveIdentity(state.deviceId, state.deviceSecret);
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

    // --- Welcome overlay: pairing or register when no identity ---
    function showWelcomeOverlay() {
        return new Promise(resolve => {
            const $ = sel => document.querySelector(sel);
            const overlay = document.createElement('div');
            overlay.id = 'pr-welcome-overlay';
            overlay.innerHTML = `
<style>
#pr-welcome-overlay{position:fixed;inset:0;background:radial-gradient(1200px 600px at 50% -10%, rgba(255,255,255,.08), rgba(0,0,0,.9)), rgba(0,0,0,.85);color:#fff;z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif}
#pr-welcome-card{width:min(96vw,960px);max-width:960px;background:rgba(20,20,20,.75);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px 24px;box-shadow:0 24px 60px rgba(0,0,0,.55);display:grid;grid-template-columns:1.2fr .9fr;gap:18px}
#pr-welcome-card h2{margin:0 0 6px;font-size:24px;letter-spacing:.2px}
#pr-sub{margin:0 0 10px;color:#cfd6e4;font-size:14px}
.pr-field{margin:10px 0}
.pr-field label{display:block;margin-bottom:6px;font-size:12px;color:#aab3c2}
.pr-field input{width:100%;padding:12px;border-radius:10px;border:1px solid #2f3642;background:#14161a;color:#fff;outline:none}
.pr-actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.pr-btn{appearance:none;border:0;border-radius:10px;padding:11px 16px;background:#2d6cdf;color:#fff;cursor:pointer;font-weight:600}
.pr-btn.sec{background:#2b2f36;color:#e6e8eb;border:1px solid #3a414d}
.pr-btn.warn{background:#3a414d;color:#e6e8eb}
.pr-msg{min-height:18px;color:#f88;font-size:13px;margin-top:8px}
.pr-qr{display:flex;flex-direction:column;align-items:center;justify-content:center}
.pr-qr img{max-width:320px;width:100%;height:auto;background:#fff;border-radius:12px;border:1px solid #2f3642;padding:10px}
.pr-qr .qr-caption{margin-top:8px;font-size:12px;color:#cfd6e4;text-align:center}
.pr-video{width:100%;max-height:240px;border-radius:10px;background:#000}
.pr-note{font-size:12px;color:#aab3c2;margin-top:8px}
.pr-topbar{display:flex;gap:10px;align-items:center;justify-content:space-between}
.pr-count{font-size:12px;color:#cfd6e4}
@media (max-width: 720px){#pr-welcome-card{grid-template-columns:1fr;}}
</style>
<div id="pr-welcome-card" role="dialog" aria-modal="true" aria-labelledby="pr-welcome-title">
  <div class="pr-left">
    <div class="pr-topbar">
      <div>
        <h2 id="pr-welcome-title">Set up this screen</h2>
    <p id="pr-sub">Enter a pairing code, scan the Admin QR, or register this device as new.</p>
      </div>
      <div class="pr-count"><span id="pr-countdown">02:00</span></div>
    </div>
    <div class="pr-field">
      <label for="pr-pair-code">Pair code</label>
      <input id="pr-pair-code" placeholder="e.g. 123456" inputmode="numeric" autocomplete="one-time-code" />
    </div>
    <div class="pr-field">
      <label for="pr-pair-token">Token (if provided)</label>
      <input id="pr-pair-token" placeholder="Optional" />
    </div>
    <div class="pr-actions">
      <button class="pr-btn" id="pr-do-pair">Pair</button>
      <button class="pr-btn sec" id="pr-scan">Scan QR</button>
      <button class="pr-btn sec" id="pr-register">Register as new</button>
      <button class="pr-btn warn" id="pr-close">Close</button>
    </div>
    <div class="pr-msg" id="pr-msg"></div>
    <div class="pr-qr" id="pr-qr" hidden>
      <video id="pr-video" class="pr-video" autoplay playsinline></video>
      <div class="pr-note">Point the camera at a pairing QR. Click Scan again to stop.</div>
    </div>
  </div>
  <div class="pr-qr">
    <img id="pr-qr-img" alt="Admin link QR"/>
    <div class="qr-caption">Scan to open Admin → Devices</div>
  </div>
</div>`;
            document.body.appendChild(overlay);

            const msg = $('#pr-msg');
            const codeEl = $('#pr-pair-code');
            const tokenEl = $('#pr-pair-token');
            const video = $('#pr-video');
            const qrWrap = $('#pr-qr');
            const qrImg = $('#pr-qr-img');
            const countdownEl = $('#pr-countdown');
            let stream = null;
            let scanning = false;
            let detector = null;
            let countTimer = null;
            let remaining = 120; // seconds

            function setMsg(t, ok) {
                msg.style.color = ok ? '#7ad97a' : '#f88';
                msg.textContent = t || '';
            }
            function fmt(n) {
                return n < 10 ? `0${n}` : `${n}`;
            }
            function tickCountdown() {
                remaining = Math.max(0, remaining - 1);
                if (countdownEl)
                    countdownEl.textContent = `${fmt(Math.floor(remaining / 60))}:${fmt(remaining % 60)}`;
                if (remaining <= 0) {
                    doClose();
                }
            }
            async function stopScan() {
                scanning = false;
                try {
                    if (stream) {
                        for (const tr of stream.getTracks()) tr.stop();
                    }
                    stream = null;
                } catch (_) {
                    /* noop: ignore stop stream errors */
                }
                if (qrWrap) qrWrap.hidden = true;
            }
            function doClose() {
                try {
                    stopScan();
                } catch (_) {
                    /* noop: ignore stopScan */
                }
                try {
                    clearInterval(countTimer);
                } catch (_) {
                    /* noop: ignore clearInterval */
                }
                try {
                    document.body.removeChild(overlay);
                } catch (_) {
                    /* noop: ignore removeChild */
                }
                resolve(true);
            }
            async function startScan() {
                if (!('BarcodeDetector' in window)) {
                    setMsg(
                        'QR scanning is not supported by this browser. Enter the code instead.',
                        false
                    );
                    return;
                }
                try {
                    detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                } catch (_) {
                    setMsg('QR scanning unavailable.', false);
                    return;
                }
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'environment' },
                    });
                    video.srcObject = stream;
                    qrWrap.hidden = false;
                    scanning = true;
                    const tick = async () => {
                        if (!scanning) return;
                        try {
                            const codes = await detector.detect(video);
                            if (codes && codes.length) {
                                const raw = codes[0].rawValue || '';
                                // Allow full claim URL or just code
                                try {
                                    const u = new URL(raw);
                                    const pc =
                                        u.searchParams.get('pair') ||
                                        u.searchParams.get('pairCode');
                                    const pt =
                                        u.searchParams.get('pairToken') ||
                                        u.searchParams.get('token');
                                    if (pc) codeEl.value = pc;
                                    if (pt) tokenEl.value = pt;
                                } catch (_) {
                                    codeEl.value = raw.replace(/\D/g, '').slice(0, 12);
                                }
                                setMsg('QR read. Click Pair.', true);
                                await stopScan();
                                return;
                            }
                        } catch (_) {
                            /* noop: detector.detect failed */
                        }
                        requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                } catch (e) {
                    setMsg('No camera access.', false);
                }
            }
            async function tryPair() {
                const code = (codeEl.value || '').trim();
                const token = (tokenEl.value || '').trim();
                if (!code) {
                    setMsg('Please enter a valid code.', false);
                    return;
                }
                setMsg('Pairing...', true);
                try {
                    const res = await fetch('/api/devices/pair', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code, token: token || undefined }),
                    });
                    if (!res.ok) {
                        setMsg('Code invalid or expired.', false);
                        return;
                    }
                    const data = await res.json();
                    await saveIdentity(data.deviceId, data.deviceSecret);
                    setMsg('Paired! Loading...', true);
                    setTimeout(() => {
                        try {
                            document.body.removeChild(overlay);
                        } catch (_) {
                            /* noop: overlay removal failed */
                        }
                        resolve(true);
                    }, 200);
                } catch (_) {
                    setMsg('Pairing failed. Please try again.', false);
                }
            }

            overlay.addEventListener('click', e => {
                if (e.target && e.target.id === 'pr-welcome-overlay') {
                    // Prevent click-through close; require explicit action
                    e.stopPropagation();
                }
            });
            $('#pr-do-pair').addEventListener('click', tryPair);
            $('#pr-register').addEventListener('click', async () => {
                setMsg('Registering...', true);
                try {
                    const ok = await registerIfNeeded();
                    if (ok) {
                        setMsg('Registered. Loading...', true);
                        setTimeout(() => {
                            try {
                                document.body.removeChild(overlay);
                            } catch (_) {
                                /* noop: overlay removal failed */
                            }
                            resolve(true);
                        }, 200);
                    } else {
                        setMsg('Registration not available.', false);
                    }
                } catch (_) {
                    setMsg('Registration failed.', false);
                }
            });
            $('#pr-scan').addEventListener('click', async () => {
                if (scanning) return void stopScan();
                await startScan();
            });
            $('#pr-close').addEventListener('click', doClose);
            // Inline QR: link to Admin → Devices with hints for this device
            try {
                const iid = state.installId || getInstallId();
                const hw = state.hardwareId || getHardwareId();
                const adminLink = `${window.location.origin}/admin#devices?setup=1${iid ? `&iid=${encodeURIComponent(iid)}` : ''}${hw ? `&hw=${encodeURIComponent(hw)}` : ''}`;
                if (qrImg) {
                    qrImg.src = `/api/qr?format=svg&text=${encodeURIComponent(adminLink)}`;
                }
            } catch (_) {
                /* noop: building admin link failed */
            }
            // Start countdown
            try {
                if (countdownEl) countdownEl.textContent = '02:00';
                countTimer = setInterval(tickCountdown, 1000);
            } catch (_) {
                /* noop: countdown init failed */
            }
            // Cleanup on unload
            window.addEventListener('beforeunload', stopScan);
        });
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
                        // helper to send ack back (best-effort)
                        const sendAck = (status = 'ok', info = null) => {
                            try {
                                if (state.ws && state.ws.readyState === WebSocket.OPEN && msg.id) {
                                    state.ws.send(
                                        JSON.stringify({ kind: 'ack', id: msg.id, status, info })
                                    );
                                }
                            } catch (_) {
                                // ignore ack send errors
                            }
                        };
                        // First try runtime playback hooks for immediate action
                        try {
                            const api = window.__posterramaPlayback || {};
                            if (t === 'playback.prev' && api.prev) {
                                liveDbg('[Live] invoking playback.prev');
                                api.prev();
                                return void sendAck('ok');
                            }
                            if (t === 'playback.next' && api.next) {
                                liveDbg('[Live] invoking playback.next');
                                api.next();
                                return void sendAck('ok');
                            }
                            if (t === 'playback.pause' && api.pause) {
                                liveDbg('[Live] invoking playback.pause');
                                api.pause();
                                return void sendAck('ok');
                            }
                            if (t === 'playback.resume' && api.resume) {
                                liveDbg('[Live] invoking playback.resume');
                                api.resume();
                                return void sendAck('ok');
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
                                    api.pinPoster({ mediaId: mediaIdHint });
                                    return void sendAck('ok');
                                } catch (_) {
                                    api.pinPoster(msg.payload);
                                    return void sendAck('ok');
                                }
                            }
                            if (t === 'source.switch' && api.switchSource) {
                                liveDbg('[Live] invoking source.switch', {
                                    sourceKey: msg.payload?.sourceKey,
                                });
                                api.switchSource(msg.payload?.sourceKey);
                                return void sendAck('ok');
                            }
                            if (t === 'power.off' && api.powerOff) {
                                liveDbg('[Live] invoking power.off');
                                api.powerOff();
                                return void sendAck('ok');
                            }
                            if (t === 'power.on' && api.powerOn) {
                                liveDbg('[Live] invoking power.on');
                                api.powerOn();
                                return void sendAck('ok');
                            }
                            if (t === 'power.toggle' && api.powerToggle) {
                                liveDbg('[Live] invoking power.toggle');
                                api.powerToggle();
                                return void sendAck('ok');
                            }
                        } catch (_) {
                            /* ignore playback hook errors */
                        }
                        // Fallback to mgmt command handler
                        liveDbg('[Live] delegating to handleCommand', { type: msg.type });
                        // For commands that may reload/reset, ack first then perform action
                        const typ = msg.type || '';
                        if (
                            typ === 'core.mgmt.reload' ||
                            typ === 'core.mgmt.reset' ||
                            typ === 'core.mgmt.clearCache' ||
                            typ === 'core.mgmt.swUnregister'
                        ) {
                            sendAck('ok');
                            handleCommand({ type: msg.type, payload: msg.payload });
                            return;
                        }
                        // For others, attempt to execute and then ack
                        try {
                            handleCommand({ type: msg.type, payload: msg.payload });
                            sendAck('ok');
                        } catch (e) {
                            sendAck('error', String(e && e.message ? e.message : e));
                        }
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
                                // Not a command, but we can optionally ack to log reception
                                try {
                                    if (
                                        state.ws &&
                                        state.ws.readyState === WebSocket.OPEN &&
                                        msg.id
                                    ) {
                                        state.ws.send(
                                            JSON.stringify({
                                                kind: 'ack',
                                                id: msg.id,
                                                status: 'ok',
                                            })
                                        );
                                    }
                                } catch (_) {
                                    /* noop: ack send after apply-settings failed */
                                }
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
            case 'remote.key': {
                try {
                    const api =
                        (typeof window !== 'undefined' && window.__posterramaPlayback) || {};
                    const key = (payload && payload.key) || '';
                    if (typeof api.remoteKey === 'function') {
                        liveDbg('[Live] invoking remote.key (queued)', { key });
                        return void api.remoteKey(key);
                    }
                    if (typeof api.navigate === 'function') {
                        liveDbg('[Live] invoking navigate (queued)', { key });
                        return void api.navigate(key);
                    }
                    // Fallbacks for common media keys
                    if (key === 'playpause') {
                        if (api.pause || api.resume) {
                            const paused =
                                typeof window !== 'undefined' && window.__posterramaPaused != null
                                    ? !!window.__posterramaPaused
                                    : null;
                            if (paused === true && api.resume) return void api.resume();
                            if (paused === false && api.pause) return void api.pause();
                        }
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

        const { id, secret } = await loadIdentityAsync();
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
            const pairToken = sp.get('pairToken') || sp.get('token');
            if (pairCode && pairCode.trim()) {
                try {
                    const res = await fetch('/api/devices/pair', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            code: pairCode.trim(),
                            token: pairToken || undefined,
                        }),
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
                            url.searchParams.delete('pairToken');
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
                            url.searchParams.delete('pairToken');
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

        // If no identity yet, present welcome overlay to pair or register
        if (!hasIdentity) {
            await showWelcomeOverlay();
            // After overlay resolves, re-load identity and enable
            const next = await loadIdentityAsync();
            if (!next.id || !next.secret) {
                state.enabled = false;
                return; // user closed or failed; keep idle
            }
            state.deviceId = next.id;
            state.deviceSecret = next.secret;
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
        getInstallId,
        getHardwareId,
    };
})();
