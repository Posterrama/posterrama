const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_EXPAND_AFTER_MS = 1200;
const DEFAULT_BUSY_DECAY_MS = 900;
const DEFAULT_LONGTASK_THRESHOLD_MS = 600;
const DEFAULT_FREEZE_GAP_MS = 1200;

function ensureStyles() {
    const id = 'posterrama-auto-loader-styles';
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
/* Posterrama Auto Loader (overlay, injected) */

:root {
    --pl-right: 16px;
    --pl-bottom: 16px;
    --pl-pill-width: auto;
    --pl-accent-1: #14b8a6;
    --pl-accent-2: #8b5cf6;
    --pl-accent-3: #f093fb;
}

/* Display modes: match the controls pill baseline (right:50px; bottom:35px). */
body[data-mode='screensaver'],
body[data-mode='wallart'],
body[data-mode='cinema'] {
    --pl-right: 50px;
    --pl-bottom: 28px;
}

/* Cinema and wallart often have no visible controls pill to measure.
   Give them a default 'controls-like' width so the new wide design shows up. */
body[data-mode='cinema'],
body[data-mode='wallart'] {
    --pl-pill-width: 140px;
}

#posterrama-loader {
    position: fixed;
    z-index: 9999;
    right: calc(env(safe-area-inset-right) + var(--pl-right));
    bottom: calc(env(safe-area-inset-bottom) + var(--pl-bottom));
    opacity: 0;
    transform: translateY(8px);
    pointer-events: none;
    transition: opacity 180ms ease, transform 180ms ease;
}

#posterrama-loader.is-active {
    opacity: 1;
    transform: translateY(0);
}

/* When we anchor to the screensaver controls, keep the loader ABOVE them. */
#posterrama-loader.is-anchored-to-controls {
    z-index: 100000;
}

#posterrama-loader .pl-surface {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 50px;
    background-color: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(5px);
    -webkit-backdrop-filter: blur(5px);
    min-height: 28px;
    width: var(--pl-pill-width);
}

/* Wide animated shimmer line */
#posterrama-loader .pl-fill {
    display: block;
    flex: 1 1 auto;
    height: 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
    overflow: hidden;
}

#posterrama-loader .pl-fill::before {
    content: '';
    display: block;
    height: 100%;
    width: 55%;
    border-radius: 999px;
    background: linear-gradient(
        90deg,
        rgba(255,255,255,0),
        rgba(20,184,166,0.75),
        rgba(139,92,246,0.75),
        rgba(240,147,251,0.55),
        rgba(255,255,255,0)
    );
    animation: posterrama-fill-sweep 1.35s ease-in-out infinite;
    opacity: 0.95;
}

/* Screen-reader-only label (keep status semantics without visible text) */
#posterrama-loader .pl-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

@keyframes posterrama-fill-sweep {
    0% { transform: translateX(-75%); opacity: 0.45; }
    45% { opacity: 1; }
    100% { transform: translateX(185%); opacity: 0.6; }
}

#posterrama-loader.is-extended .pl-fill { height: 12px; }
`;

    document.head.appendChild(style);
}

function getMode() {
    return document.body?.dataset?.mode || null;
}

function ensureLoaderElement() {
    let el = document.getElementById('posterrama-loader');
    if (el) return { el, kind: 'injected' };

    el = document.createElement('div');
    el.id = 'posterrama-loader';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.innerHTML = `
            <div class="pl-surface">
                <div class="pl-fill" aria-hidden="true"></div>
                <span class="pl-sr-only" data-pl-title>Loading</span>
            </div>
    `;
    document.body.appendChild(el);
    return { el, kind: 'injected' };
}

function getCandidateRoots() {
    const roots = [];
    const info = document.getElementById('info-container');
    if (info) roots.push(info);

    const title = document.getElementById('title');
    if (title) roots.push(title);

    const tagline = document.getElementById('tagline');
    if (tagline) roots.push(tagline);

    const poster = document.getElementById('poster');
    if (poster) roots.push(poster);

    // Screensaver/wallart layers
    const layerA = document.getElementById('layer-a');
    const layerB = document.getElementById('layer-b');
    if (layerA) roots.push(layerA);
    if (layerB) roots.push(layerB);

    // unique
    return Array.from(new Set(roots));
}

function getBackgroundImageString(el) {
    if (!el) return '';

    const inline = (el.style && el.style.backgroundImage) || '';
    if (inline && inline !== 'none') return String(inline);

    try {
        const computed = window.getComputedStyle(el).backgroundImage;
        return String(computed || '');
    } catch (_) {
        return '';
    }
}

function backgroundHasNonEmptyUrl(el) {
    const bg = getBackgroundImageString(el);
    if (!bg || bg === 'none') return false;

    // Ignore gradients/etc; we only consider a real poster ready if a url(...) is present.
    const re = /url\((['"]?)(.*?)\1\)/g;
    let match;
    // Avoid String.matchAll for better compatibility on kiosk/embedded browsers.
    while ((match = re.exec(bg))) {
        const raw = (match[2] || '').trim();
        if (!raw) continue;
        // Reject empty url("") / url('')
        if (raw === '""' || raw === "''") continue;
        return true;
    }
    return false;
}

function looksLikeContentIsReady() {
    const title = document.getElementById('title');
    if (title && title.textContent && title.textContent.trim().length > 0) return true;

    const tagline = document.getElementById('tagline');
    if (tagline && tagline.textContent && tagline.textContent.trim().length > 0) return true;

    // Common poster targets
    const poster = document.getElementById('poster');
    if (backgroundHasNonEmptyUrl(poster)) return true;

    const posterA = document.getElementById('poster-a');
    const posterB = document.getElementById('poster-b');
    if (backgroundHasNonEmptyUrl(posterA) || backgroundHasNonEmptyUrl(posterB)) return true;

    // Screensaver/wallart background layers
    const layerA = document.getElementById('layer-a');
    const layerB = document.getElementById('layer-b');
    if (backgroundHasNonEmptyUrl(layerA) || backgroundHasNonEmptyUrl(layerB)) return true;

    // Wallart: treat the first rendered poster tile as "ready".
    // The wallart UI does not use #poster backgrounds; it builds a grid of <img> tiles.
    const wallartGrid = document.getElementById('wallart-grid');
    if (wallartGrid) {
        const firstImg = wallartGrid.querySelector('.wallart-poster-item img');
        const src = firstImg && firstImg.getAttribute('src');
        if (src && String(src).trim().length > 0) return true;
        if (wallartGrid.children && wallartGrid.children.length > 0) return true;
    }

    // Any explicitly-marked readiness
    if (document.documentElement?.classList?.contains('posterrama-ready')) return true;

    return false;
}

export function initAutoLoader(options = {}) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    const timeoutMs =
        typeof options.timeoutMs === 'number' && options.timeoutMs > 0
            ? options.timeoutMs
            : DEFAULT_TIMEOUT_MS;

    const expandAfterMs =
        typeof options.expandAfterMs === 'number' && options.expandAfterMs >= 0
            ? options.expandAfterMs
            : DEFAULT_EXPAND_AFTER_MS;

    const enabledModes = Array.isArray(options.modes)
        ? options.modes
        : ['screensaver', 'wallart', 'cinema'];

    const busyDecayMs =
        typeof options.busyDecayMs === 'number' && options.busyDecayMs > 0
            ? options.busyDecayMs
            : DEFAULT_BUSY_DECAY_MS;

    const longTaskThresholdMs =
        typeof options.longTaskThresholdMs === 'number' && options.longTaskThresholdMs > 0
            ? options.longTaskThresholdMs
            : DEFAULT_LONGTASK_THRESHOLD_MS;

    const freezeGapMs =
        typeof options.freezeGapMs === 'number' && options.freezeGapMs > 0
            ? options.freezeGapMs
            : DEFAULT_FREEZE_GAP_MS;

    const busyModes = Array.isArray(options.busyModes) ? options.busyModes : ['wallart'];
    const enableBusyDetector = options.enableBusyDetector !== false;
    const enableRafFreezeDetector = options.enableRafFreezeDetector === true;

    const state = {
        active: false,
        wantInitial: false,
        wantBusy: false,
        busyTimer: null,
        perfObserver: null,
        rafId: null,
        destroyed: false,
        readyDone: false,
        isExtended: false,
        extendedTimer: null,
        anchorListener: null,
        anchorTimer: null,
        timers: new Set(),
        readyTimers: new Set(),
        observers: [],
        readyObservers: [],
        readyListener: null,
    };

    const api = { show, hide, markReady, destroy };

    function setTimer(id) {
        state.timers.add(id);
        return id;
    }

    function setReadyTimer(id) {
        state.readyTimers.add(id);
        state.timers.add(id);
        return id;
    }

    function clearReadyTimers() {
        for (const id of state.readyTimers) {
            clearTimeout(id);
            clearInterval(id);
            state.timers.delete(id);
        }
        state.readyTimers.clear();
    }

    function clearTimers() {
        for (const id of state.timers) {
            clearTimeout(id);
            clearInterval(id);
        }
        state.timers.clear();
    }

    function disconnectObservers() {
        for (const obs of state.observers) {
            try {
                obs.disconnect();
            } catch (_) {
                // ignore
            }
        }
        state.observers = [];
    }

    function disconnectReadyObservers() {
        for (const obs of state.readyObservers) {
            try {
                obs.disconnect();
            } catch (_) {
                // ignore
            }
        }
        state.readyObservers = [];
    }

    function stopReadyWatchers() {
        disconnectReadyObservers();
        clearReadyTimers();

        if (state.readyListener) {
            try {
                window.removeEventListener('posterrama:content-ready', state.readyListener);
            } catch (_) {
                // ignore
            }
            state.readyListener = null;
        }

        if (state.anchorListener) {
            try {
                window.removeEventListener('resize', state.anchorListener);
            } catch (_) {
                // ignore
            }
            state.anchorListener = null;
        }

        if (state.anchorTimer) {
            clearTimeout(state.anchorTimer);
            state.timers.delete(state.anchorTimer);
            state.anchorTimer = null;
        }
    }

    function setAnchorVars({ rightPx, bottomPx } = {}) {
        try {
            if (typeof rightPx === 'number' && Number.isFinite(rightPx)) {
                // Allow slight negative values to intentionally clip the right rounding.
                const clampedRight = Math.min(600, Math.max(-120, rightPx));
                document.documentElement.style.setProperty('--pl-right', `${clampedRight}px`);
            }
            if (typeof bottomPx === 'number' && Number.isFinite(bottomPx)) {
                document.documentElement.style.setProperty(
                    '--pl-bottom',
                    `${Math.max(0, bottomPx)}px`
                );
            }
        } catch (_) {
            // ignore
        }
    }

    function setPillWidthPx(widthPx) {
        try {
            if (typeof widthPx === 'number' && Number.isFinite(widthPx) && widthPx > 0) {
                document.documentElement.style.setProperty(
                    '--pl-pill-width',
                    `${Math.round(widthPx)}px`
                );
                return;
            }
            document.documentElement.style.setProperty('--pl-pill-width', 'auto');
        } catch (_) {
            // ignore
        }
    }

    function computeAnchorFromControls(_loaderEl) {
        const controls = document.getElementById('controls-container');
        if (!controls || typeof controls.getBoundingClientRect !== 'function') return null;

        const rect = controls.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;

        const rightGap = window.innerWidth - rect.right;
        const bottomGap = window.innerHeight - rect.bottom;

        // Match HALF the controls pill width, align to the same baseline, and push slightly
        // into the right edge so the rounding naturally clips.
        setPillWidthPx(rect.width * 0.5);

        const clipPx = 14;
        const rightPx = Math.min(rightGap - clipPx, -clipPx);
        // Slightly lower than the controls baseline.
        const downPx = 7;
        const bottomPx = Math.max(0, bottomGap - downPx);
        return { rightPx, bottomPx, hasControls: true };
    }

    function updateAnchorPosition(loaderEl) {
        // Defaults are handled by CSS vars; only override when controls exist.
        const anchored = computeAnchorFromControls(loaderEl);
        if (anchored) {
            setAnchorVars(anchored);
            try {
                loaderEl.classList.add('is-wide');
                loaderEl.classList.add('is-anchored-to-controls');
            } catch (_) {
                // ignore
            }
        } else {
            setPillWidthPx(null);
            try {
                loaderEl.classList.remove('is-wide');
                loaderEl.classList.remove('is-anchored-to-controls');
            } catch (_) {
                // ignore
            }
        }
    }

    function setMessage({ title, sub } = {}) {
        try {
            const injected = document.getElementById('posterrama-loader');
            if (!injected) return;
            const titleEl = injected.querySelector('[data-pl-title]');
            const subEl = injected.querySelector('[data-pl-sub]');
            if (titleEl && typeof title === 'string') titleEl.textContent = title;
            if (subEl && typeof sub === 'string') subEl.textContent = sub;
        } catch (_) {
            // ignore
        }
    }

    function updateVisibility() {
        if (state.destroyed) return;
        ensureStyles();

        const wantVisible = state.wantInitial || state.wantBusy;
        if (!wantVisible) {
            const injected = document.getElementById('posterrama-loader');
            if (injected) {
                injected.classList.remove('is-active');
                setTimeout(() => {
                    try {
                        injected.remove();
                    } catch (_) {
                        // ignore
                    }
                }, 220);
            }
            state.active = false;
            return;
        }

        const { el } = ensureLoaderElement();

        // Keep the loader in the bottom-right corner with equal inset.
        // If it would overlap the controls pill, shift it left.
        updateAnchorPosition(el);

        el.classList.add('is-active');
        el.classList.toggle('is-extended', !!state.isExtended);
        state.active = true;

        if (state.wantBusy && !state.wantInitial) {
            setMessage({ title: 'Working', sub: 'Rendering…' });
        } else {
            setMessage({ title: 'Loading', sub: 'Fetching artwork…' });
        }
    }

    function show(reason = 'initial') {
        if (state.destroyed) return;
        if (reason === 'busy') {
            state.wantBusy = true;
        } else {
            state.wantInitial = true;
            state.isExtended = false;

            if (state.extendedTimer) {
                clearTimeout(state.extendedTimer);
                state.timers.delete(state.extendedTimer);
                state.extendedTimer = null;
            }

            if (expandAfterMs > 0) {
                state.extendedTimer = setTimer(
                    setTimeout(() => {
                        if (state.destroyed) return;
                        if (!state.wantInitial) return;
                        state.isExtended = true;
                        updateVisibility();
                    }, expandAfterMs)
                );
            }
        }
        updateVisibility();
    }

    function hide() {
        if (state.destroyed) return;
        state.wantInitial = false;
        updateVisibility();
    }

    function handleReadyDetected() {
        if (state.destroyed) return;
        if (state.readyDone) return;
        state.readyDone = true;
        state.isExtended = false;
        stopReadyWatchers();
        hide();
    }

    function markReady() {
        try {
            window.dispatchEvent(new Event('posterrama:content-ready'));
        } catch (_) {
            // ignore
        }
    }

    function destroy() {
        state.destroyed = true;
        state.wantInitial = false;
        state.wantBusy = false;
        updateVisibility();
        disconnectObservers();
        stopReadyWatchers();
        clearTimers();

        if (state.perfObserver) {
            try {
                state.perfObserver.disconnect();
            } catch (_) {
                // ignore
            }
            state.perfObserver = null;
        }

        if (state.rafId && typeof window.cancelAnimationFrame === 'function') {
            try {
                window.cancelAnimationFrame(state.rafId);
            } catch (_) {
                // ignore
            }
            state.rafId = null;
        }
    }

    function bumpBusy() {
        if (state.destroyed) return;
        state.wantBusy = true;
        updateVisibility();

        if (state.busyTimer) {
            clearTimeout(state.busyTimer);
            state.timers.delete(state.busyTimer);
            state.busyTimer = null;
        }

        state.busyTimer = setTimer(
            setTimeout(() => {
                state.wantBusy = false;
                state.busyTimer = null;
                updateVisibility();
            }, busyDecayMs)
        );
    }

    function startBusyDetection() {
        if (!enableBusyDetector) return;

        // 1) Long Task API (best signal when available)
        if (typeof window.PerformanceObserver === 'function') {
            try {
                const po = new window.PerformanceObserver(list => {
                    try {
                        for (const e of list.getEntries()) {
                            if (
                                e &&
                                typeof e.duration === 'number' &&
                                e.duration >= longTaskThresholdMs
                            ) {
                                bumpBusy();
                                break;
                            }
                        }
                    } catch (_) {
                        // ignore
                    }
                });
                po.observe({ entryTypes: ['longtask'] });
                state.perfObserver = po;
            } catch (_) {
                // ignore
            }
        }

        // 2) rAF gap detection (fallback)
        // Disabled by default because it runs continuously and can be costly on low-power devices.
        if (enableRafFreezeDetector && typeof window.requestAnimationFrame === 'function') {
            let last = 0;
            const tick = t => {
                if (state.destroyed) return;
                if (last && t - last >= freezeGapMs) {
                    bumpBusy();
                }
                last = t;
                state.rafId = window.requestAnimationFrame(tick);
            };
            state.rafId = window.requestAnimationFrame(tick);
        }
    }

    function startWatchers() {
        // Guard: don't keep observers/timers alive forever after the first poster shows.
        // On wallart/screensaver this can cause large mutation storms and make the page unresponsive.
        state.readyListener = () => handleReadyDetected();
        window.addEventListener('posterrama:content-ready', state.readyListener);

        const check = () => {
            if (looksLikeContentIsReady()) handleReadyDetected();
        };

        // Track window resizes while loading so the loader stays aligned with controls.
        if (!state.anchorListener) {
            state.anchorListener = () => {
                if (state.destroyed) return;
                if (!state.wantInitial && !state.wantBusy) return;
                if (state.anchorTimer) {
                    clearTimeout(state.anchorTimer);
                    state.timers.delete(state.anchorTimer);
                    state.anchorTimer = null;
                }
                state.anchorTimer = setTimer(
                    setTimeout(() => {
                        updateAnchorPosition();
                    }, 120)
                );
            };
            window.addEventListener('resize', state.anchorListener);
        }

        // Quick immediate checks
        setReadyTimer(setTimeout(check, 50));
        setReadyTimer(setTimeout(check, 200));

        // Observe only specific, relevant nodes (avoid document.body-wide observation)
        const roots = getCandidateRoots();
        for (const root of roots) {
            if (!root) continue;
            const obs = new MutationObserver(check);
            obs.observe(root, {
                childList: true,
                subtree: false,
                characterData: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'src'],
            });
            state.readyObservers.push(obs);
        }

        // Fallback polling (bounded + lightweight)
        setReadyTimer(setInterval(check, 750));

        // Safety: never hang forever
        setReadyTimer(
            setTimeout(() => {
                handleReadyDetected();
            }, timeoutMs)
        );
    }

    function boot() {
        const mode = getMode();
        if (!mode || !enabledModes.includes(mode)) return;

        // Busy detection is useful for heavy wallart options, but can be noisy/expensive on low-power
        // devices. Default: only enable it for wallart.
        if (enableBusyDetector && busyModes.includes(mode)) {
            startBusyDetection();
        }

        // If content is already there, don't show initial loader.
        if (!looksLikeContentIsReady()) {
            show('initial');
            startWatchers();
        }

        // Expose globally for mode scripts to explicitly signal readiness if they want.
        window.PosterramaLoader = window.PosterramaLoader || api;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    return api;
}
