/*
 * Posterrama – Client Device Management (MVP)
 * - Persists deviceId/secret (localStorage MVP)
 * - Registers when missing
 * - Sends heartbeat every 20s and on visibility change
 * - Executes queued core mgmt commands: reload, swUnregister, clearCache
 * - Feature-flag aware via appConfig.deviceMgmt?.enabled; falls back to probing endpoints
 */

(function () {
    // --- Early preview mode detection -------------------------------------------
    // Skip device management entirely in preview mode (iframe embed in admin)
    try {
        const params = new URLSearchParams(window.location.search);
        const isPreview = params.get('preview') === '1' || window.self !== window.top;
        if (isPreview) {
            // console.info('[DeviceMgmt] Preview mode detected – skipping initialization.');
            return; // abort IIFE
        }
    } catch (_) {
        // ignore preview detection errors
    }

    // --- Early bypass detection -------------------------------------------------
    // If the server flagged this client as bypassed (IP allow list), skip loading the entire
    // device management subsystem (registration, heartbeats, websockets, overlays).
    // Detection strategies:
    // 1. window.__POSTERRAMA_CONFIG injected by main script with deviceMgmt.bypassActive
    // 2. Fallback fetch to /api/devices/bypass-check (fast, uncached)
    try {
        if (typeof window !== 'undefined') {
            const preCfg = window.__POSTERRAMA_CONFIG;
            if (preCfg && preCfg.deviceMgmt && preCfg.deviceMgmt.bypassActive) {
                console.info('[DeviceMgmt] Bypass active (config flag) – skipping initialization.');
                return; // abort IIFE
            }
        }
    } catch (_) {
        // ignore pre-config inspection errors
    }
    // Create a synchronous-ish XHR (avoid adding async waterfall) but only if fetch not yet used.
    // We prefer fetch but guard for older browsers; keep it very small.
    try {
        // Use a tiny fetch with cache busting to avoid stale intermediary caches.
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 1500); // 1.5s safety timeout
        // Fire and forget; we don't await because early return saves runtime cost.
        fetch('/api/devices/bypass-check?_r=' + Date.now().toString(36), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: ctrl.signal,
        })
            .then(r => (r.ok ? r.json() : null))
            .then(j => {
                if (j && j.bypass) {
                    console.info('[DeviceMgmt] Bypass active (probe) – skipping initialization.');
                    // Replace the IIFE body with a noop; future calls to PosterramaDevice.init will be ignored.
                    window.PosterramaDevice = { init: () => {}, bypass: true };
                }
            })
            .catch(() => {
                /* silent */
            });
    } catch (_) {
        // ignore probe errors
    }
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
        // registration check dedupe/backoff
        checkCooldownUntil: 0,
        checkInFlight: false,
        registrationPollTimer: null,
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

    // Centralized helper to call /api/devices/check politely with 429 backoff
    async function checkRegistrationStatus(deviceId) {
        const now = Date.now();
        if (state.checkCooldownUntil && now < state.checkCooldownUntil) {
            return { skipped: true, cooldownMs: state.checkCooldownUntil - now };
        }
        if (state.checkInFlight) {
            return { skipped: true, inFlight: true };
        }
        state.checkInFlight = true;
        try {
            const res = await fetch('/api/devices/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Install-Id': state.installId || getInstallId() || '',
                    'X-Hardware-Id': state.hardwareId || getHardwareId() || '',
                },
                body: JSON.stringify({ deviceId }),
            });
            if (res.status === 429) {
                // Back off progressively between 10s-30s
                const base = 10000;
                const jitter = Math.floor(Math.random() * 20000);
                state.checkCooldownUntil = Date.now() + base + jitter;
                return { ok: false, rateLimited: true, retryAt: state.checkCooldownUntil };
            }
            if (!res.ok) {
                return { ok: false, status: res.status };
            }
            const data = await res.json();
            return { ok: true, data };
        } catch (e) {
            // Treat network errors as soft-fail; do not spam
            return { ok: false, error: e && e.message ? e.message : String(e) };
        } finally {
            state.checkInFlight = false;
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
            // Check if running on standalone cinema/wallart/screensaver page
            const bodyMode = document.body.dataset.mode;
            if (bodyMode === 'cinema') return 'cinema';
            if (bodyMode === 'wallart') return 'wallart';
            if (bodyMode === 'screensaver') return 'screensaver';

            // Fallback to config-based detection
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
                // Current media identifier (legacy script.js used to expose this)
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
        // Pull current media details from the main app if exposed
        let curr = null;
        try {
            if (typeof window !== 'undefined' && window.__posterramaCurrentMedia) {
                curr = window.__posterramaCurrentMedia;
            }
        } catch (_) {
            // noop: unable to read current media from main app
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
            // When unpinned, force pinMediaId to '' so the server clears lingering values
            pinMediaId: pinned === false ? '' : pinMediaId,
            poweredOff,
            // Optional media context (used by admin device list for tiny preview)
            title: curr && curr.title,
            year: curr && curr.year,
            rating: curr && curr.rating,
            posterUrl: curr && curr.posterUrl,
            backgroundUrl: curr && curr.backgroundUrl,
            thumbnailUrl: curr && curr.thumbnailUrl,
            runtime: curr && curr.runtime,
            genres: curr && curr.genres,
            overview: curr && curr.overview,
            tagline: curr && curr.tagline,
            contentRating: curr && curr.contentRating,
        };
        try {
            // Lightweight debug to help diagnose admin-device sync issues
            try {
                liveDbg('[Live] heartbeat payload', {
                    mediaId,
                    title: curr && curr.title,
                    paused: payload.paused,
                    hasThumb: !!(payload.thumbnailUrl || payload.posterUrl),
                });
            } catch (_) {
                /* debug logging unavailable */
            }
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
                    window.debugLog &&
                        window.debugLog('DEVICE_MGMT_HEARTBEAT_COMMANDS', {
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
#pr-welcome-overlay{position:fixed;inset:0;background:linear-gradient(135deg, rgba(0,0,0,.92) 0%, rgba(20,20,30,.95) 100%);color:#fff;z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;padding:20px;box-sizing:border-box}
#pr-welcome-card{width:min(85vw,680px);background:linear-gradient(145deg, rgba(25,25,35,.9) 0%, rgba(15,15,25,.95) 100%);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:0;box-shadow:0 25px 50px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.05);overflow:hidden;position:relative}
.pr-header{background:linear-gradient(90deg, #1e293b 0%, #334155 100%);padding:24px 32px;border-bottom:1px solid rgba(255,255,255,.08);position:relative}
.pr-header h2{margin:0;font-size:24px;font-weight:600;color:#ffffff;letter-spacing:-.2px}
.pr-header .pr-subtitle{margin:6px 0 0;color:#94a3b8;font-size:14px;font-weight:400}
.pr-countdown{position:absolute;top:24px;right:32px;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:#60a5fa;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:600;font-mono}
.pr-body{padding:32px;display:grid;grid-template-columns:1fr 240px;gap:40px;align-items:start}
.pr-main{display:flex;flex-direction:column;gap:24px}
.pr-field{display:flex;flex-direction:column;gap:8px}
.pr-field label{font-size:13px;color:#94a3b8;font-weight:500;margin-bottom:4px}
.pr-code-input{width:220px;padding:16px;background:rgba(15,23,42,.8);border:2px solid rgba(71,85,105,.4);border-radius:12px;color:#fff;font-size:20px;text-align:center;letter-spacing:8px;font-family:ui-monospace,monospace;outline:none;transition:all 0.2s ease}
.pr-code-input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1);background:rgba(15,23,42,.95)}
.pr-code-input::placeholder{color:#475569;letter-spacing:6px}
.pr-primary-actions{display:flex;gap:12px;margin-top:8px;width:256px}
.pr-btn{border:0;border-radius:10px;padding:12px 8px;font-weight:600;font-size:14px;cursor:pointer;transition:all 0.15s ease;position:relative;z-index:20;display:inline-block !important;visibility:visible !important;opacity:1 !important;outline:none;flex:1;text-align:center}
.pr-btn.primary{background:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);color:#fff;box-shadow:0 4px 12px rgba(59,130,246,.25)}
.pr-btn.primary:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(59,130,246,.3)}
.pr-btn.secondary{background:rgba(71,85,105,.6);color:#e2e8f0;border:1px solid rgba(100,116,139,.5)}
.pr-btn.secondary:hover{background:rgba(71,85,105,.8);border-color:rgba(100,116,139,.8)}
.pr-secondary-section{display:flex;flex-direction:column;gap:16px;margin-top:-8px}
.pr-footer{padding:20px 32px;background:rgba(15,23,42,.3);border-top:1px solid rgba(255,255,255,.05)}
.pr-footer-btn{width:100%;background:rgba(71,85,105,.25);border:1px solid rgba(100,116,139,.4);color:#cbd5e1;padding:16px 20px;border-radius:12px;font-size:14px;font-weight:500;cursor:pointer;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center}
.pr-footer-btn:hover{background:rgba(71,85,105,.4);border-color:rgba(100,116,139,.6);color:#e2e8f0;transform:translateY(-1px)}
.pr-btn.tertiary{background:rgba(100,116,139,.3);color:#cbd5e1;border:1px solid rgba(100,116,139,.4)}
.pr-btn.tertiary:hover{background:rgba(100,116,139,.5)}
.pr-qr-section{display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px;background:rgba(255,255,255,.02);border-radius:16px;border:1px solid rgba(255,255,255,.05)}
.pr-qr-code{width:180px;height:180px;background:#fff;border-radius:12px;padding:12px;box-shadow:0 8px 25px rgba(0,0,0,.2)}
.pr-qr-caption{font-size:12px;color:#94a3b8;text-align:center;font-weight:500}
.pr-msg{color:#ef4444;font-size:13px;font-weight:500;min-height:18px;padding:8px 0}
/* Ultra-aggressive button visibility rules */
#pr-do-pair, #pr-close, #pr-skip-setup {display: inline-block !important; visibility: visible !important; opacity: 1 !important;}
button#pr-do-pair, button#pr-close, button#pr-skip-setup {display: inline-block !important; visibility: visible !important; opacity: 1 !important;}
.pr-btn#pr-do-pair, .pr-btn#pr-close, .pr-footer-btn#pr-skip-setup {display: inline-block !important; visibility: visible !important; opacity: 1 !important;}
@media (max-width: 768px){.pr-body{grid-template-columns:1fr;gap:24px}.pr-qr-section{order:-1}.pr-header{padding:20px 24px}.pr-countdown{position:static;margin-top:12px;align-self:flex-start}.pr-body{padding:24px}}
</style>
<div id="pr-welcome-card" role="dialog" aria-modal="true" aria-labelledby="pr-welcome-title">
  <div class="pr-header">
    <h2 id="pr-welcome-title">Set up this screen</h2>
    <p class="pr-subtitle">Connect with admin panel to manage this display</p>
    <div class="pr-countdown"><span id="pr-countdown">02:00</span></div>
  </div>
  
  <div class="pr-body">
    <div class="pr-main">
      <div class="pr-field">
        <label for="pr-pair-code">Enter pairing code</label>
        <input id="pr-pair-code" class="pr-code-input" placeholder="● ● ● ● ● ●" maxlength="6" inputmode="numeric" autocomplete="one-time-code" />
      </div>
      
      <div class="pr-primary-actions">
        <button class="pr-btn primary" id="pr-do-pair" type="button">Connect</button>
        <button class="pr-btn tertiary" id="pr-close" type="button">Skip setup</button>
      </div>
      
      <div class="pr-msg" id="pr-msg"></div>
    </div>
    
    <div class="pr-qr-section">
      <img id="pr-qr-img" class="pr-qr-code" alt="QR code for device registration"/>
      <div class="pr-qr-caption">Scan with mobile device</div>
    </div>
  </div>
  
  <div class="pr-footer">
    <button class="pr-footer-btn" id="pr-skip-setup" type="button">
      Don't show this again
    </button>
  </div>
</div>`;
            document.body.appendChild(overlay);

            // IMMEDIATE button protection - before any other scripts can interfere
            const immediateProtection = () => {
                const buttons = ['pr-do-pair', 'pr-close', 'pr-skip-setup'];
                buttons.forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.style.cssText +=
                            '; display: inline-block !important; visibility: visible !important; opacity: 1 !important;';
                        // Also add to the element's style attribute directly
                        btn.setAttribute(
                            'style',
                            btn.getAttribute('style') +
                                '; display: inline-block !important; visibility: visible !important; opacity: 1 !important;'
                        );
                    }
                });
            };

            // Run immediately multiple times
            immediateProtection();
            setTimeout(immediateProtection, 1);
            setTimeout(immediateProtection, 10);
            setTimeout(immediateProtection, 50);

            const msg = $('#pr-msg');
            const codeEl = $('#pr-pair-code');
            const skipButton = $('#pr-skip-setup');
            const countdownEl = $('#pr-countdown');
            let countTimer = null;
            let remaining = 120; // seconds

            // Interactive placeholder for pairing code
            function updatePlaceholder() {
                const value = codeEl.value;
                const maxLength = 6;
                let placeholder = '';
                for (let i = 0; i < maxLength; i++) {
                    if (i < value.length) {
                        placeholder += value[i] + ' ';
                    } else {
                        placeholder += '● ';
                    }
                }
                codeEl.placeholder = placeholder.trim();
            }

            // Prevent form submission
            const form = $('#pr-setup-form');
            if (form) {
                form.addEventListener('submit', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                });
            }

            codeEl.addEventListener('input', updatePlaceholder);
            codeEl.addEventListener('focus', updatePlaceholder);
            codeEl.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    tryPair();
                }
            });
            updatePlaceholder(); // Initial call

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
            function doClose() {
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

            async function tryPair() {
                const code = (codeEl.value || '').trim();
                if (!code) {
                    setMsg('Please enter a valid pairing code.', false);
                    return;
                }
                setMsg('Pairing...', true);
                try {
                    const res = await fetch('/api/devices/pair', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code }),
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

            $('#pr-do-pair').addEventListener('click', async e => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Connect button clicked');
                await tryPair();
            });

            $('#pr-close').addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Close button clicked');
                doClose();
            });

            // Footer skip button
            skipButton.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();

                // Visual feedback
                skipButton.style.opacity = '0.6';
                skipButton.textContent = 'Saving preference...';

                try {
                    localStorage.setItem('posterrama-skip-device-setup', 'true');
                } catch (_) {
                    /* noop: localStorage failed */
                }

                // Small delay for user feedback
                setTimeout(() => {
                    doClose();
                }, 800);
            });

            // Force button visibility
            function ensureButtonsVisible() {
                const buttons = ['#pr-do-pair', '#pr-close', '#pr-skip-setup'];
                buttons.forEach(id => {
                    const btn = $(id);
                    if (btn) {
                        btn.style.setProperty('display', 'inline-block', 'important');
                        btn.style.setProperty('visibility', 'visible', 'important');
                        btn.style.setProperty('opacity', '1', 'important');
                        btn.style.pointerEvents = 'auto';
                    }
                });
            }

            // Watch for DOM changes that might hide buttons
            const observer = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                        const target = mutation.target;
                        if (
                            target.id &&
                            ['pr-do-pair', 'pr-close', 'pr-skip-setup'].includes(target.id)
                        ) {
                            console.log(`Button ${target.id} style changed, forcing visibility`);
                            ensureButtonsVisible();
                        }
                    }
                });
            });

            // Start observing the card for changes
            const card = $('#pr-welcome-card');
            if (card) {
                observer.observe(card, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['style', 'class'],
                });
            }

            // Ensure buttons stay visible
            setInterval(ensureButtonsVisible, 200);
            ensureButtonsVisible();

            // Debug: Log button visibility
            function checkButtons() {
                // Silent check for button visibility
            }

            // Auto-registration QR: link to Admin with device info for auto-registration
            // Delay QR loading to prevent interference with buttons
            let registrationPollTimer = null;
            setTimeout(() => {
                try {
                    const iid = state.installId || getInstallId();
                    const hw = state.hardwareId || getHardwareId();
                    const deviceId = state.deviceId || hw || iid || `device-${Date.now()}`;
                    const deviceName = `Screen ${deviceId.substring(0, 8)}`;

                    // IMPORTANT: No hash fragment to avoid interfering with query parameters
                    const autoRegisterUrl = `${window.location.origin}/admin?auto-register=true&device-id=${encodeURIComponent(deviceId)}&device-name=${encodeURIComponent(deviceName)}`;
                    const qrImg = $('#pr-qr-img');
                    if (qrImg) {
                        qrImg.onload = () => {
                            setTimeout(() => {
                                checkButtons();
                                ensureButtonsVisible();
                            }, 100);
                        };
                        qrImg.onerror = () => {
                            setTimeout(checkButtons, 100);
                        };
                        qrImg.src = `/api/qr?format=svg&text=${encodeURIComponent(autoRegisterUrl)}`;
                    }

                    // Start polling for successful registration (single interval, 429-aware)
                    if (state.registrationPollTimer) clearInterval(state.registrationPollTimer);
                    registrationPollTimer = setInterval(async () => {
                        try {
                            const res = await checkRegistrationStatus(deviceId);
                            if (res.skipped) {
                                // skipped due to cooldown or inflight; do nothing
                                return;
                            }
                            if (res.ok && res.data && res.data.isRegistered) {
                                clearInterval(registrationPollTimer);
                                state.registrationPollTimer = null;
                                showRegistrationSuccess(deviceName);
                            }
                            if (res.rateLimited) {
                                // Slow the poll cadence while rate-limited
                                try {
                                    clearInterval(registrationPollTimer);
                                } catch (_) {
                                    /* noop: UI propagation best-effort */
                                }
                                state.registrationPollTimer = setTimeout(
                                    () => {
                                        // resume interval polling after cooldown
                                        state.registrationPollTimer = setInterval(() => {
                                            checkRegistrationStatus(deviceId);
                                        }, 7000);
                                    },
                                    Math.max(3000, (res.retryAt || Date.now()) - Date.now())
                                );
                            }
                        } catch (_) {
                            // Silent retry on error
                        }
                    }, 5000); // Check every 5 seconds
                    state.registrationPollTimer = registrationPollTimer;
                } catch (_) {
                    /* noop: building auto-register link failed */
                }
            }, 300);

            // Function to show success in the modal
            function showRegistrationSuccess(deviceName) {
                const welcomeCard = $('#pr-welcome-card');
                if (!welcomeCard) return;

                // Replace the entire content with success message using same styling as setup modal
                welcomeCard.innerHTML = `
                    <div class="pr-header">
                        <h2 id="pr-success-title">🎉 Device Connected!</h2>
                        <p class="pr-subtitle">Your screen is now ready for remote control</p>
                    </div>
                    
                    <div class="pr-body" style="grid-template-columns: 1fr; text-align: center;">
                        <div class="pr-main">
                            <div style="
                                background: rgba(34, 197, 94, 0.1);
                                border: 1px solid rgba(34, 197, 94, 0.3);
                                border-radius: 16px;
                                padding: 32px 24px;
                                margin: 16px 0;
                            ">
                                <div style="font-size: 64px; margin-bottom: 16px;">✅</div>
                                <h3 style="
                                    margin: 0 0 12px 0;
                                    font-size: 20px;
                                    font-weight: 600;
                                    color: #22c55e;
                                ">"${deviceName}" is registered</h3>
                                <p style="
                                    margin: 0;
                                    font-size: 14px;
                                    color: #94a3b8;
                                    line-height: 1.5;
                                ">This screen can now be controlled remotely from the admin panel</p>
                            </div>
                            
                            <div style="
                                background: rgba(255, 255, 255, 0.02);
                                border: 1px solid rgba(255, 255, 255, 0.08);
                                border-radius: 12px;
                                padding: 20px;
                                text-align: left;
                                margin: 24px 0;
                            ">
                                <div style="display: flex; align-items: center; margin-bottom: 12px;">
                                    <span style="font-size: 20px; margin-right: 12px;">🎮</span>
                                    <span style="font-size: 14px; color: #e2e8f0;">Remote control enabled</span>
                                </div>
                                <div style="display: flex; align-items: center; margin-bottom: 12px;">
                                    <span style="font-size: 20px; margin-right: 12px;">📱</span>
                                    <span style="font-size: 14px; color: #e2e8f0;">Commands sync automatically</span>
                                </div>
                                <div style="display: flex; align-items: center;">
                                    <span style="font-size: 20px; margin-right: 12px;">⚡</span>
                                    <span style="font-size: 14px; color: #e2e8f0;">Live monitoring active</span>
                                </div>
                            </div>
                            
                            <button class="pr-btn primary" id="pr-success-continue" style="width: 200px; margin: 0 auto;">
                                Continue
                            </button>
                        </div>
                    </div>
                `;

                // Handle continue button
                const continueBtn = $('#pr-success-continue');
                if (continueBtn) {
                    continueBtn.addEventListener('click', () => {
                        // Clean up
                        clearInterval(countTimer);
                        if (registrationPollTimer) {
                            clearInterval(registrationPollTimer);
                        }

                        // Remove the modal after a short delay
                        setTimeout(() => {
                            doClose();
                        }, 500);
                    });
                }

                // Auto-close after 8 seconds
                setTimeout(() => {
                    if (continueBtn) {
                        continueBtn.click();
                    }
                }, 8000);
            }

            // Clean up polling timer when modal closes
            const originalDoClose = typeof doClose === 'function' ? doClose : () => {};
            function wrappedDoClose() {
                if (registrationPollTimer) {
                    clearInterval(registrationPollTimer);
                }
                if (state.registrationPollTimer) {
                    try {
                        clearInterval(state.registrationPollTimer);
                        clearTimeout(state.registrationPollTimer);
                    } catch (_) {
                        /* noop: stale heartbeat update */
                    }
                    state.registrationPollTimer = null;
                }
                return originalDoClose();
            }
            // Assign via window to avoid reassigning a function declaration in some modes
            if (typeof window !== 'undefined') {
                window.doClose = wrappedDoClose;
            } else {
                // Fallback to local reassignment if window is not available
                // eslint-disable-next-line no-func-assign
                doClose = wrappedDoClose;
            }

            // Initial button check
            setTimeout(checkButtons, 50);

            // Start countdown
            try {
                if (countdownEl) countdownEl.textContent = '02:00';
                countTimer = setInterval(tickCountdown, 1000);
            } catch (_) {
                /* noop: countdown init failed */
            }
        });
    }

    // Add a subtle setup button to the runtime interface for skipped devices
    function addSetupButton() {
        // Only add if not already present
        if (document.getElementById('pr-setup-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'pr-setup-btn';
        btn.innerHTML = '<i class="fas fa-cog"></i>';
        btn.title = 'Set up device management';
        btn.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background-color: rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(5px);
            border: none;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;
            padding: 6px 10px;
            border-radius: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s, color 0.2s;
            z-index: 9999;
            min-width: 36px;
            min-height: 36px;
            font-size: 14px;
        `;

        btn.addEventListener('mouseenter', () => {
            btn.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            btn.style.color = '#fff';
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
            btn.style.color = 'rgba(255, 255, 255, 0.7)';
        });

        btn.addEventListener('click', async () => {
            // Remove the skip flag and show setup
            try {
                localStorage.removeItem('posterrama-skip-device-setup');
            } catch (_) {
                /* ignore localStorage errors */
            }

            // Remove the button
            btn.remove();

            // Show setup overlay
            await showWelcomeOverlay();

            // Re-init device management if successful
            const next = await loadIdentityAsync();
            if (next.id && next.secret) {
                state.deviceId = next.id;
                state.deviceSecret = next.secret;
                state.enabled = true;
                startHeartbeat();
                sendHeartbeat();
            } else {
                // If setup was skipped again, re-add the button
                addSetupButton();
            }
        });

        document.body.appendChild(btn);
    }

    // --- WebSocket live control ---
    // Debug logger (toggle with window.__POSTERRAMA_LIVE_DEBUG = false to silence)
    function liveDbg() {
        try {
            if (typeof window !== 'undefined' && window.__POSTERRAMA_LIVE_DEBUG === false) return;
        } catch (_) {
            // ignore logger availability check
        }
        // Only log to console if debug is enabled (check URL param or localStorage)
        try {
            let debugEnabled = false;
            try {
                const urlParams = new URLSearchParams(window.location.search);
                debugEnabled = urlParams.get('debug') === 'true';
                if (!debugEnabled) {
                    debugEnabled = localStorage.getItem('posterrama_debug_enabled') === 'true';
                }
            } catch (_) {
                /* URL/localStorage check failed */
            }

            if (debugEnabled) {
                console.info.apply(console, arguments);
            }

            // Always log to window.logger if available (for debugLogView)
            if (
                typeof window !== 'undefined' &&
                window.logger &&
                typeof window.logger.debug === 'function'
            ) {
                window.logger.debug.apply(window.logger, arguments);
            }
        } catch (_) {
            // ignore logger fallback
        }
    }
    function connectWS() {
        if (!state.enabled || !state.deviceId || !state.deviceSecret) return;
        // Don't create duplicate connections
        if (
            state.ws &&
            (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)
        ) {
            return;
        }
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${proto}://${window.location.host}/ws/devices`;
        window.debugLog && window.debugLog('DEVICE_MGMT_WS_CONNECT', { url });
        try {
            const ws = new WebSocket(url);
            state.ws = ws;
            ws.onopen = () => {
                liveDbg('[Live] WS open', { url });
                window.debugLog && window.debugLog('DEVICE_MGMT_WS_OPEN', { url });
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

                        // Handle settings.apply command from server broadcast
                        if (t === 'settings.apply' && msg.payload) {
                            try {
                                liveDbg('[Live] WS settings.apply received', {
                                    keys: Object.keys(msg.payload || {}),
                                });
                                window.debugLog &&
                                    window.debugLog('DEVICE_MGMT_WS_SETTINGS_APPLY', {
                                        keys: Object.keys(msg.payload || {}),
                                        payload: msg.payload,
                                    });

                                // Dispatch settingsUpdated event for all displays
                                const event = new CustomEvent('settingsUpdated', {
                                    detail: { settings: msg.payload },
                                });
                                window.dispatchEvent(event);

                                sendAck('ok');
                                return;
                            } catch (e) {
                                liveDbg('[Live] settings.apply failed:', e);
                                sendAck('error', String(e?.message || e));
                                return;
                            }
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
                        // Apply partial settings live if a global applySettings is exposed (legacy support)
                        try {
                            if (typeof window.applySettings === 'function') {
                                liveDbg('[Live] WS apply-settings received', {
                                    keys: Object.keys(msg.payload || {}),
                                });
                                window.debugLog &&
                                    window.debugLog('DEVICE_MGMT_WS_APPLY_SETTINGS', {
                                        keys: Object.keys(msg.payload || {}),
                                        payload: msg.payload,
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
        window.debugLog && window.debugLog('DEVICE_MGMT_COMMAND', { type, payload });
        switch (type) {
            // Core management commands
            case 'core.mgmt.reload':
                window.debugLog && window.debugLog('DEVICE_MGMT_CMD_RELOAD', {});
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
            case 'mode.navigate': {
                try {
                    const target = (payload && payload.mode) || '';
                    const Core = typeof window !== 'undefined' ? window.PosterramaCore : null;
                    if (Core && typeof Core.navigateToMode === 'function') {
                        liveDbg('[Live] invoking Core.navigateToMode', { target });
                        Core.navigateToMode(String(target || 'screensaver'));
                        return;
                    }
                } catch (_) {
                    // Core not available or navigation failed; ignore
                }
                break;
            }
            default:
                // Unknown or unsupported command type
                break;
        }
    }

    // Prevent rapid reload loops: allow at most one reload every 8 seconds
    function safeReload(nextUrl) {
        window.debugLog && window.debugLog('DEVICE_MGMT_SAFE_RELOAD_CALLED', { nextUrl });
        try {
            const now = Date.now();
            const key = 'pr_last_reload_ts';
            const last = Number(localStorage.getItem(key) || '0');
            if (now - last < 8000) {
                // Too soon since last reload; skip
                window.debugLog &&
                    window.debugLog('DEVICE_MGMT_RELOAD_BLOCKED', {
                        timeSinceLast: now - last,
                        threshold: 8000,
                    });
                return;
            }
            localStorage.setItem(key, String(now));
        } catch (_) {
            // If localStorage unavailable, still proceed but we tried
        }

        window.debugLog &&
            window.debugLog('DEVICE_MGMT_RELOAD_EXECUTING', { nextUrl: nextUrl || 'reload' });
        try {
            if (nextUrl && typeof nextUrl === 'string') {
                window.location.replace(nextUrl);
            } else {
                window.location.reload();
            }
        } catch (_) {
            // Best-effort reload fallback
            try {
                window.location.href = nextUrl || window.location.href;
            } catch (_) {
                /* noop: rate-limit/backoff guard */
            }
        }
    }

    function forceReload() {
        window.debugLog && window.debugLog('DEVICE_MGMT_FORCE_RELOAD', {});
        try {
            const busted = cacheBustUrl(window.location.href);
            // Also remove known query params that can cause repeated actions
            try {
                const url = new URL(busted);
                ['pair', 'pairCode', 'pairToken', 'deviceReset', 'device', 'devreset'].forEach(k =>
                    url.searchParams.delete(k)
                );
                safeReload(url.toString());
                return;
            } catch (_) {
                // If URL API fails, just use busted
            }
            safeReload(busted);
        } catch (_) {
            safeReload();
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
        window.debugLog && window.debugLog('DEVICE_MGMT_HEARTBEAT_START', { firstIn });
        state.heartbeatTimer = setTimeout(() => {
            sendHeartbeat();
            state.heartbeatTimer = setInterval(sendHeartbeat, 20000);
        }, firstIn);
        // Also send one early beat once the runtime exposes current media to reduce initial mismatch
        try {
            let tries = 0;
            state.earlyBeatTimer = setInterval(() => {
                tries++;
                try {
                    const hasCurr =
                        typeof window !== 'undefined' &&
                        (window.__posterramaCurrentMediaId != null ||
                            (window.__posterramaCurrentMedia &&
                                (window.__posterramaCurrentMedia.title ||
                                    window.__posterramaCurrentMedia.posterUrl)));
                    if (hasCurr || tries > 6) {
                        clearInterval(state.earlyBeatTimer);
                        state.earlyBeatTimer = null;
                        // small debounce to let UI settle
                        setTimeout(
                            () => {
                                try {
                                    sendHeartbeat();
                                } catch (_) {
                                    /* noop */
                                }
                            },
                            hasCurr ? 150 : 500
                        );
                    }
                } catch (_) {
                    if (state.earlyBeatTimer) {
                        clearInterval(state.earlyBeatTimer);
                        state.earlyBeatTimer = null;
                    }
                }
            }, 300);
        } catch (_) {
            /* ignore early-beat probe errors */
        }

        // Event listeners: only add once, not on every startHeartbeat call
        if (!state.heartbeatListenersAdded) {
            state.heartbeatListenersAdded = true;

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

        // connect live channel
        connectWS();
    }

    function stopHeartbeat() {
        if (state.heartbeatTimer) {
            clearTimeout(state.heartbeatTimer);
            clearInterval(state.heartbeatTimer);
            state.heartbeatTimer = null;
        }
        if (state.earlyBeatTimer) {
            clearInterval(state.earlyBeatTimer);
            state.earlyBeatTimer = null;
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

        // If no identity yet OR identity is invalid on server, check if user wants to skip setup
        let needsSetup = !hasIdentity;

        if (hasIdentity) {
            console.log('🔍 [DEBUG] Checking if device is still registered on server');
            console.log('  - deviceId from localStorage:', state.deviceId);
            try {
                const res = await checkRegistrationStatus(state.deviceId);
                if (res.skipped) {
                    console.log('  → Skipping device check due to cooldown/in-flight');
                } else if (res.rateLimited) {
                    console.log(
                        '  → Rate limited on device check; will assume registered during cooldown'
                    );
                } else if (res.ok && res.data) {
                    console.log('  - Server response:', res.data);
                    if (!res.data.isRegistered) {
                        console.log('  → Device not registered on server, clearing local identity');
                        clearIdentity();
                        state.deviceId = null;
                        state.deviceSecret = null;
                        needsSetup = true;
                    } else {
                        console.log('  → Device is registered on server, skipping setup');
                    }
                } else {
                    console.log('  → Device check failed, assuming device is registered');
                }
            } catch (error) {
                console.log('  → Device check error, assuming registered:', error && error.message);
                needsSetup = false;
            }
        } else {
            console.log(
                '🔍 [DEBUG] No local identity found, checking if device exists on server with hardware ID'
            );

            // Try to recover identity by checking if our hardware ID is registered
            try {
                const hardwareId = getHardwareId();
                console.log('  - Generated hardware ID:', hardwareId);

                const res = await checkRegistrationStatus(hardwareId);

                if (res.ok && res.data) {
                    const result = res.data;
                    console.log('  - Server response for hardware ID:', result);

                    if (result.isRegistered) {
                        console.log(
                            '  → Device found on server with hardware ID, attempting automatic recovery'
                        );

                        // Try to automatically re-adopt this device since it's already registered with our hardware ID
                        try {
                            const recoveryResponse = await fetch('/api/devices/register', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    name:
                                        result.deviceName || `Screen ${hardwareId.substring(0, 9)}`,
                                    hardwareId: hardwareId,
                                    location: '', // Keep location empty
                                }),
                            });

                            if (recoveryResponse.ok) {
                                const recoveryData = await recoveryResponse.json();
                                console.log('  → Automatic recovery successful:', recoveryData);

                                // Save the recovered identity
                                await saveIdentity(
                                    recoveryData.deviceId,
                                    recoveryData.deviceSecret
                                );
                                state.deviceId = recoveryData.deviceId;
                                state.deviceSecret = recoveryData.deviceSecret;

                                console.log('  → Local identity restored, skipping setup');

                                // Enable device management and start heartbeat immediately
                                state.enabled = true;

                                // Send immediate heartbeat to update device status
                                try {
                                    console.log('  → Sending heartbeat to update device status');
                                    await sendHeartbeat();
                                    startHeartbeat();
                                } catch (heartbeatError) {
                                    console.log(
                                        '  → Initial heartbeat failed:',
                                        heartbeatError.message
                                    );
                                }

                                needsSetup = false;
                            } else {
                                console.log('  → Automatic recovery failed, will show setup');
                                needsSetup = true;
                            }
                        } catch (recoveryError) {
                            console.log('  → Recovery error:', recoveryError.message);
                            needsSetup = true;
                        }
                    } else {
                        console.log('  → Hardware ID not found on server, setup required');
                        needsSetup = true;
                    }
                } else if (res.rateLimited || res.skipped) {
                    console.log(
                        '  → Rate-limited or skipped hardware ID check; deferring setup prompt'
                    );
                    needsSetup = true;
                } else {
                    console.log('  → Server check failed, will show setup');
                    needsSetup = true;
                }
            } catch (error) {
                console.log('  → Network error checking hardware ID:', error.message);
                needsSetup = true;
            }
        }

        console.log('🔍 [DEBUG] Setup decision: needsSetup =', needsSetup);

        if (needsSetup) {
            // Check if user previously chose to skip device setup
            let skipSetup = false;
            try {
                skipSetup = localStorage.getItem('posterrama-skip-device-setup') === 'true';
            } catch (_) {
                /* ignore localStorage errors */
            }

            if (!skipSetup) {
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
            } else {
                // User chose to skip setup, disable device management
                state.enabled = false;
                // Add subtle setup button to runtime interface
                addSetupButton();
                return;
            }
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
                        // Debounced reload to avoid loops
                        safeReload();
                    } catch (_) {
                        // ignore reload errors
                    }
                });
            } catch (_) {
                // ignore resetIdentity errors
            }
        },
        showSetup: () => {
            try {
                // Remove skip flag if set
                localStorage.removeItem('posterrama-skip-device-setup');
                // Remove setup button if present
                const btn = document.getElementById('pr-setup-btn');
                if (btn) btn.remove();
                // Show setup overlay
                return showWelcomeOverlay();
            } catch (_) {
                // ignore showSetup errors
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
