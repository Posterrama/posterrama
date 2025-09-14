/* eslint-disable no-empty, prettier/prettier */
/*
 * Posterrama Admin Panel - Version 2.2.0
 */

// --- Network helpers (restored) ---
function apiUrl(path) {
    if (!path) return '/';
    if (/^https?:\/\//i.test(path)) return path; // absolute URL passed through
    return path.startsWith('/') ? path : '/' + path;
}

function apiUrlWithCacheBust(path) {
    try {
        const u = new URL(apiUrl(path), window.location.origin);
        u.searchParams.set('cb', Date.now().toString());
        return u.toString();
    } catch (_) {
        // Fallback: naive query param appending
        const sep = String(path).includes('?') ? '&' : '?';
        return apiUrl(path) + sep + 'cb=' + Date.now();
    }
}

async function authenticatedFetch(url, options = {}) {
    const { noRedirectOn401, headers = {}, ...rest } = options || {};

    const defaultHeaders = { Accept: 'application/json' };
    // Only set Content-Type automatically when a body is provided and no explicit Content-Type is set
    if ('body' in rest && rest.body != null && !('Content-Type' in headers)) {
        defaultHeaders['Content-Type'] = 'application/json';
    }

    const defaultOptions = {
        credentials: 'include',
        headers: {
            ...defaultHeaders,
            ...headers,
        },
    };

    try {
        const response = await fetch(url, { ...defaultOptions, ...rest });
        if (response.status === 401) {
            if (!noRedirectOn401) {
                try {
                    window.location.href = '/admin/login';
                } catch (_) {}
            }
            const err = new Error('Authentication required');
            err.code = 'unauthorized';
            throw err;
        }
        return response;
    } catch (error) {
        console.error('🚨 Fetch error:', error.name, error.message);
        throw error;
    }
}

// Expose helpers globally (optional convenience)
window.apiUrl = apiUrl;
window.apiUrlWithCacheBust = apiUrlWithCacheBust;
window.authenticatedFetch = authenticatedFetch;

/**
 * Global setButtonState function - manages visual state of buttons during async operations
 * @param {HTMLButtonElement} button The button element
 * @param {'loading' | 'success' | 'error' | 'revert'} state The state to set
 * @param {object} [options] Options for text and classes
 */
window.setButtonState = function (button, state, options = {}) {
    if (!button) {
        logger.warn('setButtonState: button is null or undefined');
        return;
    }

    // Determine if this is an icon-only button (no separate text span)
    const textSpan = button.querySelector('span:not(.icon)');
    const isIconOnly = !textSpan;
    const icon = button.querySelector('.icon i');

    // Store original state if not already stored
    if (!button.dataset.originalStateSaved) {
        // Save only what we will need to restore
        button.dataset.originalText = isIconOnly
            ? ''
            : textSpan
              ? textSpan.textContent
              : button.textContent;
        button.dataset.originalIconClass = icon ? icon.className : '';
        button.dataset.originalButtonClass = button.className;
        button.dataset.originalStateSaved = '1';
    }

    switch (state) {
        case 'loading':
            button.disabled = true;
            if (!isIconOnly) {
                if (textSpan) textSpan.textContent = options.text || 'Working...';
                else button.textContent = options.text || 'Working...';
            }
            if (icon) icon.className = options.iconClass || 'fas fa-spinner fa-spin';
            button.className = button.dataset.originalButtonClass;
            break;
        case 'success':
        case 'error':
            button.disabled = true;
            if (!isIconOnly) {
                const msg = options.text || (state === 'success' ? 'Success!' : 'Failed');
                if (textSpan) textSpan.textContent = msg;
                else button.textContent = msg;
            }
            if (icon) {
                icon.className =
                    options.iconClass ||
                    (state === 'success' ? 'fas fa-check' : 'fas fa-exclamation-triangle');
            }
            button.className = `${button.dataset.originalButtonClass} ${
                options.buttonClass || (state === 'success' ? 'is-success' : 'is-danger')
            }`;
            break;
        case 'revert':
            button.disabled = false;
            if (!isIconOnly) {
                if (textSpan) textSpan.textContent = button.dataset.originalText || '';
                else button.textContent = button.dataset.originalText || '';
            }
            if (icon) icon.className = button.dataset.originalIconClass || '';
            button.className = button.dataset.originalButtonClass || button.className;
            break;
    }
};

// Small helpers expected elsewhere in the file
// 1) Provide a local alias for widespread bare references used throughout admin.js
const setButtonState = window.setButtonState;
// 2) Minimal prompt wrapper used by some flows
async function promptDialog(message, defaultValue = '') {
    // eslint-disable-next-line no-alert
    return window.prompt(message, defaultValue);
}
// 3) No-op slider background updater to satisfy references in legacy UI sections
function updateSliderBackground() {}

// --- Display Settings Live Preview ---
(function setupDisplayPreview() {
    const container = document.getElementById('display-preview-container');
    const frame = document.getElementById('display-preview-frame');
    const toggleBtn = document.getElementById('toggle-preview-mode');
    const zoomBtn = document.getElementById('toggle-preview-zoom');
    const peekBtn = document.querySelector('#display-preview-container .preview-peek-handle');
    let lastSettings = null;
    let resetInFlight = false;

    if (!container || !frame) return; // No-op if HTML not present

    // Move container to body so it never affects section layout
    if (container.parentElement && container.parentElement !== document.body) {
        document.body.appendChild(container);
    }

    // Preview should be visible only on the Display section
    function isDisplayActive() {
        const activeNav = document.querySelector('.sidebar .nav-item.active');
        if (activeNav && activeNav.dataset && activeNav.dataset.section) {
            return activeNav.dataset.section === 'display';
        }
        const displaySection = document.getElementById('display-section');
        if (displaySection) {
            const style = window.getComputedStyle(displaySection);
            return style.display !== 'none';
        }
        return false;
    }
    function setPreviewVisibility(visible) {
        container.classList.toggle('preview-hidden', !visible);
        container.style.display = visible ? 'block' : 'none';
        if (visible) {
            try {
                placePreviewAtAnchor();
                updateFrameScale();
            } catch (_) {
                /* noop */
            }
        }
    }
    // Start in PiP mode but only show when Display is active
    container.classList.add('pip-mode');
    setPreviewVisibility(isDisplayActive());

    // Restore collapsed state (mobile peek)
    const COLLAPSE_KEY = 'posterrama.preview.collapsed';
    const prefersCollapsed = (() => {
        try {
            return localStorage.getItem(COLLAPSE_KEY) === '1';
        } catch (_) {
            return false;
        }
    })();
    if (prefersCollapsed) container.classList.add('collapsed');

    // Restore position/size
    // Default size
    const startW = 320; // default 16:9 preview
    // Note: dynamic height is derived from DOM; no fixed start height constant needed here
    const headerHeightVar = getComputedStyle(document.documentElement).getPropertyValue(
        '--header-height'
    );
    const headerHeight = parseInt(headerHeightVar, 10) || 70;
    const margin = 12;
    container.style.left = 'auto';

    function updateFrameScale() {
        const isCinema = container.classList.contains('cinema-mode');
        const baseW = isCinema ? 1080 : 1920;
        const baseH = isCinema ? 1920 : 1080;
        // Use computed styles to get precise inner box including padding
        const style = getComputedStyle(container);
        const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const cw = Math.max(0, container.clientWidth - paddingX);
        const ch = Math.max(0, container.clientHeight - paddingY);
        const scale = Math.max(0.01, Math.min(cw / baseW, ch / baseH));
        frame.style.width = baseW + 'px';
        frame.style.height = baseH + 'px';
        frame.style.transform = `scale(${scale})`;
        // Center the scaled content within the padded inner area; padding itself stays uniform (8px)
        const offsetX = parseFloat(style.paddingLeft) + (cw - baseW * scale) / 2;
        const offsetY = parseFloat(style.paddingTop) + (ch - baseH * scale) / 2;
        frame.style.left = `${offsetX}px`;
        frame.style.top = `${offsetY}px`;
    }

    // Peek toggle handler
    function setCollapsed(next) {
        preserveTopRightAnchor(() => {
            container.classList.toggle('collapsed', next);
        });
        try {
            localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
        } catch (err) {
            void err; // ignore storage errors (private browsing, quotas, etc.)
        }
        // After transition, ensure scale still correct
        setTimeout(() => {
            if (container.style.display !== 'none' && typeof updateFrameScale === 'function')
                updateFrameScale();
        }, 240);
    }
    if (peekBtn) {
        peekBtn.addEventListener('click', e => {
            e.stopPropagation();
            const next = !container.classList.contains('collapsed');
            setCollapsed(next);
        });
    }

    function placePreviewAtAnchor() {
        // Align the preview to the top-right of the Display section content, within the content width
        const displaySection = document.getElementById('display-section');
        const titleEl = displaySection ? displaySection.querySelector('.section-title') : null;
        const sectionMain =
            document.querySelector('#display-section .section-main-content') || displaySection;
        const sectionRect = sectionMain
            ? sectionMain.getBoundingClientRect()
            : { left: 0, right: window.innerWidth, top: 0 };
        const titleRect = titleEl ? titleEl.getBoundingClientRect() : sectionRect;

        // Use current container size
        const cRect = container.getBoundingClientRect();
        const cw = Math.max(1, cRect.width || startW);

        // Top aligns with the section title top (viewport coordinates, since container is fixed)
        const marginInside = 8; // small padding from edges
        const topStartPadding = 12; // extra initial top padding requested
        const yBase = Math.max(headerHeight + marginInside, Math.round(titleRect.top));
        const y = yBase + topStartPadding;

        // Right-align inside the section content, but no further right than the section title width
        const minX = Math.round(sectionRect.left + marginInside);
        const titleRight = Math.round(titleRect.right);
        const sectionRight = Math.round(sectionRect.right);
        const maxInsideRight = Math.min(sectionRight, titleRight);
        const maxX = Math.round(maxInsideRight - cw - marginInside);
        const x = Math.max(minX, Math.min(window.innerWidth - cw, maxX));

        container.style.top = `${y}px`;
        // Compute right directly from target x + width to avoid reflow inconsistencies
        const intendedRight = Math.max(0, window.innerWidth - (x + cw));
        container.style.right = intendedRight + 'px';
        container.style.left = 'auto';
    }

    // Preserve current top-right anchor of the floating preview while mutating classes/sizes
    function preserveTopRightAnchor(mutator) {
        // Use computed styles to avoid subpixel drift across transitions
        const cs = getComputedStyle(container);
        let prevTop = parseFloat(cs.top);
        let prevRight = parseFloat(cs.right);
        if (!Number.isFinite(prevTop) || isNaN(prevTop)) {
            const rect = container.getBoundingClientRect();
            prevTop = Math.max(0, rect.top);
        }
        if (!Number.isFinite(prevRight) || isNaN(prevRight)) {
            const rect = container.getBoundingClientRect();
            prevRight = Math.max(0, window.innerWidth - rect.right);
        }
        if (typeof mutator === 'function') {
            mutator();
        }
        // Re-apply top/right to keep the same anchor position; disable left
        container.style.top = prevTop + 'px';
        // Clamp right within viewport
        const cw = container.getBoundingClientRect().width;
        const maxRight = Math.max(0, window.innerWidth - cw);
        container.style.right = Math.max(0, Math.min(maxRight, prevRight)) + 'px';
        container.style.left = 'auto';
    }

    // Initial placement (only if visible)
    if (container.style.display !== 'none') {
        placePreviewAtAnchor();
    }

    // No persistence: always reset on refresh per request

    // Make draggable
    (function enableDrag() {
        let dragging = false;
        let offsetFromRight = 0;
        let offsetFromTop = 0;
        let rafId = null;
        let nextPos = null;
        // Helper: avoid initiating drag on interactive controls inside the preview
        function isInteractiveTarget(target) {
            if (!target || !(target instanceof Element)) return false;
            return (
                target.closest('.pip-button') ||
                target.closest('.preview-controls') ||
                target.closest('.preview-peek-handle') ||
                target.closest('button, a, select, input, label')
            );
        }
        function onDown(e) {
            // Do not start drag when interacting with internal controls (fixes mobile taps on buttons)
            const tgt = e.target;
            if (isInteractiveTarget(tgt)) return;
            // Ignore multi-touch gestures
            if (e.touches && e.touches.length > 1) return;

            dragging = true;
            container.classList.add('dragging');
            container.style.cursor = 'grabbing';
            const rect = container.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            // Store offset relative to the right and top edges to maintain right-top anchoring
            offsetFromRight = rect.right - clientX;
            offsetFromTop = clientY - rect.top;
            // Prevent default only for actual drag to avoid suppressing click on touch devices
            if (e.cancelable) e.preventDefault();
        }
        // Minimal movement threshold to classify as drag (px)
        const DRAG_THRESHOLD = 4;
        let startedDragging = false;
        let startClientX = 0;
        let startClientY = 0;
        function onMove(e) {
            if (!dragging) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            if (!startedDragging) {
                const dx = Math.abs(clientX - startClientX);
                const dy = Math.abs(clientY - startClientY);
                if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
                startedDragging = true;
                try {
                    container.dataset.userMoved = '1';
                } catch (_) {}
            }
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const rect = container.getBoundingClientRect();
            // Compute right and top maintaining the original grab offsets
            let right = vw - (clientX + offsetFromRight);
            let top = clientY - offsetFromTop;
            // Clamp within viewport
            right = Math.max(0, Math.min(vw - rect.width, right));
            const minY = headerHeight + margin;
            top = Math.max(minY, Math.min(vh - rect.height, top));
            nextPos = { right, top };
            if (!rafId) {
                rafId = requestAnimationFrame(() => {
                    if (nextPos) {
                        container.style.right = nextPos.right + 'px';
                        container.style.left = 'auto';
                        container.style.top = nextPos.top + 'px';
                        nextPos = null;
                    }
                    rafId = null;
                });
            }
        }
        function onUp(e) {
            if (!dragging) return;
            const wasDragging = startedDragging;
            dragging = false;
            startedDragging = false;
            container.style.cursor = 'grab';
            container.classList.remove('dragging');
            // If it was an actual drag, prevent an accidental click; otherwise, let the tap/click fire
            if (wasDragging && e && e.cancelable) {
                e.preventDefault();
                e.stopPropagation();
                // Prevent click-through after drag
                container.style.pointerEvents = 'none';
                setTimeout(() => (container.style.pointerEvents = 'auto'), 0);
            }
        }
        container.addEventListener('mousedown', e => {
            // If collapsed, a simple left click expands without initiating drag
            if (container.classList.contains('collapsed') && e.button === 0) {
                setCollapsed(false);
            }
            startClientX = e.clientX;
            startClientY = e.clientY;
            onDown(e);
        });
        container.addEventListener(
            'touchstart',
            e => {
                // If collapsed, any tap expands
                if (container.classList.contains('collapsed')) {
                    setCollapsed(false);
                }
                startClientX = e.touches ? e.touches[0].clientX : 0;
                startClientY = e.touches ? e.touches[0].clientY : 0;
                onDown(e);
            },
            { passive: false }
        );
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
    })();

    // Initial scale and on-resize updates
    if (container.style.display !== 'none') updateFrameScale();
    window.addEventListener('resize', () => {
        if (container.style.display !== 'none') updateFrameScale();
    });
    // React to container size changes (mode/zoom transitions) and rescale content to fully fill space
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
            if (container.style.display !== 'none') updateFrameScale();
        });
        ro.observe(container);
    } else {
        // Fallback: listen for transition end on width/height
        container.addEventListener('transitionend', e => {
            if (
                e.propertyName === 'width' ||
                e.propertyName === 'height' ||
                e.propertyName === 'right' ||
                e.propertyName === 'left' ||
                e.propertyName === 'top'
            ) {
                if (container.style.display !== 'none') updateFrameScale();
            }
        });
    }
    window.addEventListener('resize', () => {
        // Keep current top-right anchor when viewport changes; then clamp within viewport
        if (container.style.display !== 'none') preserveTopRightAnchor();
        const rect = container.getBoundingClientRect();
        const vh = window.innerHeight;
        const minY = headerHeight + margin;
        const newTop = Math.max(minY, Math.min(vh - rect.height, rect.top));
        container.style.top = newTop + 'px';
    });

    // Toggle between screensaver/cinema preview classes
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            preserveTopRightAnchor(() => {
                const isCinema = container.classList.toggle('cinema-mode');
                container.classList.toggle('screensaver-mode', !isCinema);
                // Light fade for smoother visual switch; keep transitions enabled for smooth scale/size animations
                container.classList.add('mode-switching');
                if (frame) {
                    const prev = frame.style.transform;
                    frame.style.transform = 'none';
                    void frame.offsetHeight; // force reflow
                    frame.style.transform = prev;
                }
                if (typeof updateFrameScale === 'function') updateFrameScale();
                // After the transition completes, ensure final scale and re-apply anchor precisely
                const onEnd = ev => {
                    if (ev.target !== container) return;
                    container.removeEventListener('transitionend', onEnd);
                    preserveTopRightAnchor(() => {
                        if (typeof updateFrameScale === 'function') updateFrameScale();
                    });
                };
                container.addEventListener('transitionend', onEnd);
            });
            setTimeout(() => {
                container.classList.remove('mode-switching');
            }, 160);
        });
    }

    // Toggle 2x zoom (desktop-only via CSS visibility)
    if (zoomBtn) {
        zoomBtn.addEventListener('click', () => {
            preserveTopRightAnchor(() => {
                container.classList.toggle('zoom-2x');
                if (typeof updateFrameScale === 'function') updateFrameScale();
                // Re-check after transition ends
                const onEnd = ev => {
                    if (ev.target !== container) return;
                    container.removeEventListener('transitionend', onEnd);
                    preserveTopRightAnchor(() => {
                        if (typeof updateFrameScale === 'function') updateFrameScale();
                    });
                };
                container.addEventListener('transitionend', onEnd);
            });
        });
    }

    // Build a settings payload from the current form values
    function collectDisplaySettings() {
        const getBool = id => {
            const el = document.getElementById(id);
            return el ? !!el.checked : undefined;
        };
        const getNumber = id => {
            const el = document.getElementById(id);
            if (!el) return undefined;
            const v = Number(el.value);
            return Number.isFinite(v) ? v : undefined;
        };
        const getSelect = id => {
            const el = document.getElementById(id);
            return el ? el.value : undefined;
        };

        const payload = {
            cinemaMode: getBool('cinemaMode'),
            cinemaOrientation: getSelect('cinemaOrientation'),
            showClearLogo: getBool('showClearLogo'),
            showRottenTomatoes: getBool('showRottenTomatoes'),
            showPoster: getBool('showPoster'),
            showMetadata: getBool('showMetadata'),
            rottenTomatoesMinimumScore: getNumber('rottenTomatoesMinimumScore'),
            clockWidget: getBool('clockWidget'),
            clockTimezone: getSelect('clockTimezone'),
            clockFormat: getSelect('clockFormat'),
            // Wallart hero controls at top-level for preview mapping
            heroSide: getSelect('heroSide'),
            heroRotationMinutes: getNumber('heroRotationMinutes'),
            uiScaling: {
                content: getNumber('uiScaling.content'),
                clearlogo: getNumber('uiScaling.clearlogo'),
                clock: getNumber('uiScaling.clock'),
                global: getNumber('uiScaling.global'),
            },
            transitionEffect: getSelect('transitionEffect'),
            effectPauseTime: getNumber('effectPauseTime'),
            transitionIntervalSeconds: getNumber('transitionIntervalSeconds'),
            wallartMode: {
                enabled: getBool('wallartModeEnabled'),
                layoutVariant: getSelect('wallartLayoutVariant'),
                density: getSelect('wallartDensity'),
                refreshRate: getNumber('wallartRefreshRate'),
                randomness: getNumber('wallartRandomness'),
                animationType: getSelect('wallartAnimationType'),
                ambientGradient: getBool('wallartAmbientGradient'),
                layoutSettings: {
                    heroGrid: {
                        heroSide: getSelect('heroSide'),
                        heroRotationMinutes: getNumber('heroRotationMinutes'),
                    },
                },
            },
        };
        // Enforce: Ken Burns has no pause. Always store 0.
        if (payload.transitionEffect === 'kenburns') {
            payload.effectPauseTime = 0;
        }
        return payload;
    }

    let previewWindow = null;
    frame.addEventListener('load', () => {
        previewWindow = frame.contentWindow;
        // Initial sync after load or after a hard reset
        if (isDisplayActive()) sendPreviewUpdate();
        // After load, ensure visual classes are restored and placement/scaling are correct
        if (resetInFlight) {
            setTimeout(() => {
                container.classList.remove('no-transition');
                container.classList.remove('mode-switching');
                if (typeof updateFrameScale === 'function') updateFrameScale();
                // Keep current top-right anchor instead of re-placing relative to section
                if (typeof preserveTopRightAnchor === 'function') preserveTopRightAnchor();
                resetInFlight = false;
            }, 80);
        }
    });

    function sendPreviewUpdate() {
        if (!previewWindow) return;
        const payload = collectDisplaySettings();
        lastSettings = payload;
        // Reflect mode on container for correct aspect while preserving current anchor
        preserveTopRightAnchor(() => {
            const isCinema = !!payload.cinemaMode;
            container.classList.toggle('cinema-mode', isCinema);
            container.classList.toggle('screensaver-mode', !isCinema);
            if (container.style.display !== 'none' && typeof updateFrameScale === 'function')
                updateFrameScale();
        });
        previewWindow.postMessage(
            { type: 'posterrama.preview.update', payload },
            window.location.origin
        );
    }

    // Debounce helper
    let debounceTimer = null;
    function debouncedSend() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(sendPreviewUpdate, 120);
    }
    // Expose a safe global alias for out-of-scope callers (e.g., slider inputs wired elsewhere)
    window._debouncedPreviewSend = debouncedSend;

    function shouldHardReset(prev, next) {
        if (!prev) return false;
        // Only hard-reset when cinema mode or its orientation changes.
        // Wallart mode supports live switching and internal restarts without a full reload.
        if (prev.cinemaMode !== next.cinemaMode) return true;
        if (prev.cinemaOrientation !== next.cinemaOrientation) return true;
        return false;
    }

    function hardResetPreview() {
        // Fade out and reload the iframe to reset all state cleanly
        container.classList.add('no-transition');
        container.classList.add('mode-switching');
        resetInFlight = true;
        try {
            // Reload iframe; load handler will resync and clear classes
            if (frame && frame.contentWindow) {
                frame.contentWindow.location.reload();
            } else if (frame) {
                const original = frame.src;
                frame.src = 'about:blank';
                setTimeout(() => (frame.src = original), 0);
            }
        } catch (_) {
            // Fallback: if reload fails, at least try an immediate update
            sendPreviewUpdate();
        }
    }

    // Wire change listeners for display-related inputs
    const inputIds = [
        // Cinema mode + orientation
        'cinemaMode',
        'cinemaOrientation',
        // Visual toggles
        'showClearLogo',
        'showRottenTomatoes',
        'showPoster',
        'showMetadata',
        // Filters / numbers
        'rottenTomatoesMinimumScore',
        // Clock
        'clockWidget',
        'clockTimezone',
        'clockFormat',
        // UI scaling
        'uiScaling.content',
        'uiScaling.clearlogo',
        'uiScaling.clock',
        'uiScaling.global',
        // Effects
        'transitionEffect',
        'effectPauseTime',
        // Timing
        'transitionIntervalSeconds',
        // Wallart mode
        'wallartModeEnabled',
        'wallartLayoutVariant',
        'wallartDensity',
        'wallartRefreshRate',
        'wallartRandomness',
        'wallartAnimationType',
        'wallartAmbientGradient',
        // Hero grid settings (also surfaced at top-level for preview mapping)
        'heroSide',
        'heroRotationMinutes',
    ];

    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const handler = () => {
            const next = collectDisplaySettings();
            if (shouldHardReset(lastSettings, next)) {
                lastSettings = next;
                hardResetPreview(next);
            } else {
                debouncedSend();
            }
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
    });

    // Event delegation as a safety net: any control inside the Display section triggers an update
    const displaySectionEl = document.getElementById('display-section');
    if (displaySectionEl) {
        const delegated = e => {
            // Ignore events from outside form controls
            const target = e.target;
            if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement))
                return;
            const next = collectDisplaySettings();
            if (shouldHardReset(lastSettings, next)) {
                lastSettings = next;
                hardResetPreview(next);
            } else {
                debouncedSend();
            }
        };
        displaySectionEl.addEventListener('input', delegated, true);
        displaySectionEl.addEventListener('change', delegated, true);
    }

    // Keep preview visibility in sync with section changes (desktop, mobile, programmatic)
    (function syncPreviewWithSections() {
        // Desktop sidebar buttons
        const navButtons = document.querySelectorAll('.nav-item[data-section]');
        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.dataset.section;
                setTimeout(() => setPreviewVisibility(section === 'display'), 0);
            });
        });

        // Wrap global activateSection after it's defined (handles mobile and any programmatic calls)
        const tryWrap = () => {
            if (typeof window.activateSection === 'function' && !window._previewWrappedActivate) {
                const orig = window.activateSection;
                window.activateSection = function (section) {
                    const result = orig.apply(this, arguments);
                    setPreviewVisibility(section === 'display');
                    return result;
                };
                window._previewWrappedActivate = true;
            }
        };
        tryWrap();
        const id = setInterval(() => {
            if (window._previewWrappedActivate) return clearInterval(id);
            tryWrap();
        }, 100);
    })();

    // Keep visibility in sync when switching sidebar tabs
    const navButtons = document.querySelectorAll('.sidebar .nav-item[data-section]');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.section;
            // Defer until classes are updated by core nav code
            setTimeout(() => setPreviewVisibility(target === 'display'), 0);
        });
    });
})();

// (Groups routing hooks are integrated into the existing activateSection below)

// --- Groups Management ---
let __groupsCache = [];
async function fetchGroups() {
    const res = await authenticatedFetch(apiUrl('/api/groups'), { noRedirectOn401: true });
    if (!res.ok) throw new Error('Failed to load groups');
    const list = await res.json();
    __groupsCache = Array.isArray(list)
        ? list.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : [];
    return __groupsCache;
}

async function createGroup(payload) {
    const res = await authenticatedFetch(apiUrl('/api/groups'), {
        method: 'POST',
        body: JSON.stringify(payload || {}),
    });
    if (!res.ok) throw new Error('Create failed');
    return res.json();
}

async function patchGroup(id, payload) {
    const res = await authenticatedFetch(apiUrl(`/api/groups/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
    });
    if (!res.ok) throw new Error('Patch failed');
    return res.json();
}

async function deleteGroup(id) {
    const res = await authenticatedFetch(apiUrl(`/api/groups/${encodeURIComponent(id)}`), {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Delete failed');
    return res.json();
}

async function sendGroupCommand(id, type, payload) {
    const res = await authenticatedFetch(apiUrl(`/api/groups/${encodeURIComponent(id)}/command`), {
        method: 'POST',
        body: JSON.stringify({ type, payload }),
    });
    if (!res.ok) throw new Error('Command failed');
    return res.json();
}

async function fetchDevicesLight() {
    // Use existing endpoint and map into minimal data for counts and assignment UI
    const res = await authenticatedFetch(apiUrl('/api/devices'), { noRedirectOn401: true });
    if (!res.ok) throw new Error('Failed to load devices');
    const list = await res.json();
    return Array.isArray(list)
        ? list.map(d => ({
              id: d.id,
              name: d.name || d.id,
              groups: Array.isArray(d.groups) ? d.groups : [],
              wsConnected: !!d.wsConnected,
          }))
        : [];
}

async function patchDeviceGroups(id, groups) {
    await authenticatedFetch(apiUrl(`/api/devices/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        body: JSON.stringify({ groups: Array.isArray(groups) ? groups : [] }),
    });
}

// Groups creation is handled via the Devices toolbar menu only

// Debug function to test config save with different methods
window.testConfigSave = async function () {
    const testConfig = {
        transitionIntervalSeconds: 10,

        showMetadata: true,
        clockWidget: false,
        transitionEffect: 'slide',
        effectPauseTime: 3,
        mediaServers: [],
    };

    const testEnv = {
        DEBUG: 'false',
    };

    try {
        await authenticatedFetch(apiUrl('/api/admin/config'), {
            method: 'POST',
            body: JSON.stringify({ config: testConfig, env: testEnv }),
        });
        return 'Test passed with normal method';
    } catch (error1) {
        try {
            await fetch(apiUrl('/api/admin/config'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    Connection: 'close',
                    'HTTP-Version': '1.1',
                },
                body: JSON.stringify({ config: testConfig, env: testEnv }),
            });
            return 'Test passed with HTTP/1.1 fallback';
        } catch (error2) {
            return 'Both methods failed: ' + error2.message;
        }
    }
};

/*
 * Key Changes (chronological/high-level):
 * - Fixed historical layout issue where only 'general' & 'display' sections rendered: introduced portal container to prevent hidden/collapsed content.
 * - Removed legacy preview / PiP code (dead / debug-only) reducing script size & noise.
 * - Unified admin font stack to Roboto (no changes to public/logs pages per request).
 * - Added lazy-loading for Media (Plex libraries + background slideshow) on first Media tab activation instead of upfront.
 * - Hardened keyboard shortcut (Help panel 'H') against undefined e.key (prevented toLowerCase TypeError).
 * - Cinema Mode improvements:
 *   - Eliminated duplicate toggleCinemaModeSettings invocations.
 *   - Preserves Ken Burns selection; temporarily swaps to fade while hidden and restores afterwards.
 * - Password change form: removed duplicate mismatch checks (now single clear validation path).
 * - Restart button UX: shows progress, completion, then re-enables after delay (no forced page refresh requirement).
 * - Background slideshow:
 *   - Logging drastically reduced; gated behind defaults.DEBUG flag (light heartbeat only otherwise).
 *   - Timer cleared when leaving Media section (prevents leaks / duplicate intervals).
 * - Auto-save mechanism:
 *   - Replaced fixed 200ms retry delay with microtask + requestAnimationFrame scheduling for responsiveness.
 *   - UI scaling auto-save no longer overwrites values with 100 when slider empty; ignores blank input.
 * - UI scaling manual submit logic: preserves explicit zero, uses defaults only when value truly absent.
 * - Added Ken Burns + cinema mode state memory & restoration semantics.
 * - Plex token security: replaced fragile placeholder text parsing with data-token-set attribute.
 * - Clean form submission sanitizer (cleanNulls) now also strips empty strings (prevents overwriting server config with '').
 * - Rotten Tomatoes badge logic clarified with inline comment; minimum score persists but only applied if badge enabled.
 * - General logging scrubs: background rotation & restart flow now concise; removed obsolete debug helpers & mutation observers.
 * - Memory / global hygiene: removed old preview globals, prevented accumulating timers, minimized window namespace surface.
 *
 * Outstanding / Future (not performed here):
 * - Potential modular split of this file (config, media, ui, helpers) for maintainability.
 * - Accessibility pass (ARIA roles, focus management, reduced motion preference for transitions).
 * - Design token centralization (colors, spacing, radii) for easier theming.
 * - Additional debounce/coalesce for rapid config slider changes (current approach acceptable but could batch network posts).
 *
 * NOTE: This comment block documents the refactor session; retain until next major version bump or migrate to CHANGELOG.
 */
// Simple help panel toggle - rebuilt from scratch with original styling
function toggleHelpPanel() {
    // Get current active section
    const activeNavItem = document.querySelector('.nav-item.active');
    const sectionName = activeNavItem ? activeNavItem.dataset.section : 'general';

    // Use existing help panel from HTML
    const helpPanel = document.getElementById('quick-help-panel');
    if (!helpPanel) {
        return;
    }

    // Toggle visibility using CSS classes
    helpPanel.classList.toggle('open');

    // Update content based on active section - do this AFTER opening
    if (helpPanel.classList.contains('open')) {
        updateHelpContent(sectionName);
    }
    if (helpPanel.classList.contains('open')) {
        updateHelpContent(sectionName);
    }
}

function updateHelpContent(sectionId) {
    const helpPanel = document.getElementById('quick-help-panel');
    if (!helpPanel) {
        return;
    }

    // Only update if the help panel is currently open/visible
    if (!helpPanel.classList.contains('open')) {
        return;
    }

    // Call the forced update function
    updateHelpContentForced(sectionId);
}

function updateRefreshRateLabel(value) {
    const label = document.querySelector('.slider-percentage[data-target="wallartRefreshRate"]');
    if (label) {
        const descriptions = {
            1: 'Very slow (25 seconds)',
            2: 'Slow (22 seconds)',
            3: 'Relaxed (19 seconds)',
            4: 'Moderate (16 seconds)',
            5: 'Medium (13 seconds)',
            6: 'Active (10 seconds)',
            7: 'Quick (7 seconds)',
            8: 'Fast (5 seconds)',
            9: 'Very fast (3 seconds)',
            10: 'Chaos mode',
        };
        label.textContent = descriptions[value] || descriptions[5];
    }
}

function updateRandomnessLabel(value) {
    const label = document.querySelector('.slider-percentage[data-target="wallartRandomness"]');
    if (label) {
        const descriptions = {
            0: 'No randomness (exact timing)',
            1: 'Minimal variation',
            2: 'Slight variation',
            3: 'Low randomness',
            4: 'Moderate randomness',
            5: 'Medium randomness',
            6: 'High randomness',
            7: 'Very random',
            8: 'Highly unpredictable',
            9: 'Maximum variation',
            10: 'Extremely fast (2 seconds)',
        };
        label.textContent = descriptions[value] || descriptions[3];
    }
}

function updateHelpContentForced(sectionId) {
    const helpPanel = document.getElementById('quick-help-panel');
    if (!helpPanel) {
        return;
    }

    // Map section names to section IDs for help content lookup
    const sectionMap = {
        general: 'general-section',
        display: 'display-section',
        media: 'media-section',
        authentication: 'authentication-section',
        management: 'management-section',
    };

    const mappedSectionId = sectionMap[sectionId] || 'general-section';

    const helpContent = getHelpContentForSection(mappedSectionId);

    const newHTML = `
        <div class="help-header">
            <h3>${helpContent.title}</h3>
            <button class="help-close btn btn-icon" onclick="toggleHelpPanel()" aria-label="Close help panel">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="help-content">
            ${helpContent.sections
                .map(
                    section => `
                <div class="help-section">
                    <h4>${section.title}</h4>
                    <p>${section.description}</p>
                    ${section.details ? `<ul>${section.details.map(detail => `<li>${detail}</li>`).join('')}</ul>` : ''}
                </div>
            `
                )
                .join('')}
        </div>
    `;

    helpPanel.innerHTML = newHTML;
}

function getHelpContentForSection(sectionId) {
    const helpContent = {
        'general-section': {
            title: '<i class="fas fa-cog"></i>&nbsp;&nbsp;General Settings',
            sections: [
                {
                    title: 'Transition Interval (seconds)',
                    description:
                        'How long each poster is displayed before switching to the next one.',
                    details: [
                        'Set between 1 and 300 seconds',
                        'Short intervals (1-5 sec): Dynamic slideshow for entertainment',
                        'Medium intervals (10-30 sec): Good balance between variety and readability',
                        'Long intervals (60+ sec): Calm display, ideal for reading information',
                    ],
                },
                {
                    title: 'Background Refresh (minutes)',
                    description:
                        'How often the system fetches new content from your content sources.',
                    details: [
                        'Set to 0 to disable automatic refresh',
                        'Recommended: 60-180 minutes for most users',
                        'Short intervals: New content appears faster, but more server load',
                        'Long intervals: Less server load, but new movies/shows appear later',
                        'Maximum: 1440 minutes (24 hours)',
                    ],
                },
                {
                    title: 'Application Port',
                    description:
                        'The port number on which the admin interface and screensaver are accessible.',
                    details: [
                        'Default port is usually 4000',
                        'Valid range: 1024-65535',
                        'Make sure the port is not used by other programs',
                        'Application restart required after change',
                        'Update your bookmarks after port change',
                    ],
                },
                {
                    title: 'Debug Mode',
                    description: 'Enable detailed logging for troubleshooting problems.',
                    details: [
                        'Shows extensive information in logs',
                        'Useful for diagnosing connection problems',
                        'May impact performance when enabled',
                        'Enable only when troubleshooting, then disable again',
                        'Check the logs section to view debug information',
                    ],
                },
                {
                    title: 'Troubleshooting & Error Recovery',
                    description: 'Common issues and solutions for smooth operation.',
                    details: [
                        '<strong>Connection Issues</strong>: Check network connectivity, firewall settings, and API key validity',
                        '<strong>Media Not Loading</strong>: Verify source configurations and run "Refresh Media" in Management section',
                        '<strong>Performance Problems</strong>: Use Performance Monitor to identify bottlenecks, clear cache if needed',
                        '<strong>Login Problems</strong>: Check 2FA status, verify password, or use backup codes if available',
                        '<strong>Update Failures</strong>: Use backup system to restore previous working version',
                        '<strong>Cache Issues</strong>: Clear cache and run cleanup in Management section',
                        '<strong>Debug Information</strong>: Enable debug mode and check live logs for detailed error information',
                        'Always create backups before making major configuration changes',
                    ],
                },
                {
                    title: 'Keyboard Shortcuts',
                    description: 'Quick keyboard shortcuts to improve your workflow.',
                    details: [
                        '<strong>H</strong> - Open/close help panel (works in any section)',
                        '<strong>Ctrl+S</strong> / <strong>Cmd+S</strong> - Save all settings quickly',
                        '<strong>Escape</strong> - Close any open modal dialogs',
                        'Shortcuts work when not typing in input fields',
                        'Perfect for faster navigation and saving time',
                    ],
                },
                {
                    title: 'Mobile Interface & Touch Controls',
                    description: 'Optimized interface features for tablets and mobile devices.',
                    details: [
                        '<strong>Mobile Navigation</strong>: Tap navigation menu for easy section switching on mobile',
                        '<strong>Touch Gestures</strong>: Optimized touch targets and swipe-friendly interface',
                        '<strong>Responsive Design</strong>: Interface automatically adapts to screen size and orientation',
                        '<strong>Mobile Help</strong>: Help panel optimized for smaller screens with touch-friendly controls',
                        '<strong>Quick Actions</strong>: Easily accessible buttons for common tasks on mobile devices',
                        '<strong>Text Scaling</strong>: Automatic text scaling for better readability on various devices',
                        'Full admin functionality available on tablets and smartphones',
                    ],
                },
                {
                    title: 'Development & Debug',
                    description: 'Development tools and debugging features for troubleshooting.',
                    details: [
                        'Live Logs: View real-time system messages and activity as they happen',
                        'Monitor application status, errors, and performance information',
                        'Useful for troubleshooting connection issues and system problems',
                        'Debug information helps identify configuration or connectivity issues',
                    ],
                },
            ],
        },
        'display-section': {
            title: '<i class="fas fa-tv"></i>&nbsp;&nbsp;Display Settings',
            sections: [
                {
                    title: 'Cinema Mode - Digital Movie Poster',
                    description:
                        'Transform your display into a professional Digital Movie Poster for theaters, lobbies, or home cinema.',
                    details: [
                        'Digital Movie Poster: Creates an immersive, professional poster display experience',
                        'Perfect for movie theaters, cinema lobbies, media rooms, or home theater setups',
                        'Automatically cycles through your movie collection with high-quality posters and metadata',
                        'Orientation options: Portrait (theater-style), Portrait-flipped, or Auto-detect',
                        'Removes UI elements for clean, uninterrupted poster presentation',
                        'Ideal for: Digital signage, theater displays, home cinema ambiance, or media showcases',
                    ],
                },
                {
                    title: 'Wallart Mode - Multi-Poster Grid',
                    description:
                        'Display multiple posters in a dynamic grid layout that automatically fills your screen.',
                    details: [
                        'Wallart Mode intelligently calculates the perfect poster grid to completely fill your screen with zero wasted space, automatically adjusting for any screen size or orientation',
                        'Poster Density: Controls the relative number of posters - Few (60% of optimal, larger posters), Medium (100% of optimal, balanced), Many (150% of optimal, smaller posters)',
                        'Screen-Filling Algorithm: Automatically determines the best grid layout (columns × rows) to eliminate empty space while maintaining poster proportions',
                        'Poster Refresh Rate: Controls how fast posters change - from very slow (25 seconds) to extremely fast (2 seconds)',
                        'Timing Randomness: Adds variation to the refresh timing - 0 means exact timing, higher values add more unpredictability. Smart scaling prevents chaos at high refresh rates.',
                        'Animation Type: Choose between Random (uses all animation types), Fade (smooth opacity transition), Slide Left/Up (directional movement), Zoom (scale in effect), or Flip (3D flip effect)',
                        'Auto Refresh: Automatically cycles through your entire poster collection',
                        'Responsive Design: Automatically recalculates grid layout when window is resized',
                        'Perfect for: Art galleries, waiting rooms, digital wallpaper, or ambient displays',
                    ],
                },
                {
                    title: 'Wallart Mode - Hero Grid Layout',
                    description:
                        'Advanced layout combining a large hero poster with a grid of smaller posters.',
                    details: [
                        '<strong>Hero + Grid Layout</strong>: Features one large "hero" poster alongside a grid of smaller posters',
                        '<strong>Hero Side</strong>: Position the hero poster on Left, Right, Top, or Bottom of the screen',
                        '<strong>Hero Rotation</strong>: Set how often the hero poster changes (1-60 minutes)',
                        '<strong>Perfect Balance</strong>: Combines the impact of a large poster with variety of a grid',
                        'Hero poster draws attention while grid provides content diversity',
                        'Ideal for: Feature displays, promotional setups, or mixed content showcases',
                        'Grid automatically adjusts size and layout to complement the hero poster',
                    ],
                },
                {
                    title: 'Wallart Mode - Ambient Features',
                    description:
                        'Enhanced visual effects and atmospheric improvements for Wallart displays.',
                    details: [
                        '<strong>Ambient Gradient</strong>: Subtle background gradient effect that enhances poster visibility',
                        'Intelligent color extraction from posters to create harmonious background effects',
                        'Reduces eye strain during extended viewing sessions',
                        'Provides visual depth and professional appearance',
                        'Automatically adjusts based on poster colors and content',
                        'Can be enabled/disabled independently of other Wallart features',
                    ],
                },
                {
                    title: 'Visual Elements',
                    description: 'Choose which visual elements to display on screen.',
                    details: [
                        'ClearLogo: Show high-quality transparent logos for movies and TV shows',
                        'Rotten Tomatoes Badge: Display critic ratings and freshness badges',
                        'Show Poster: Display movie/TV show poster images as main visual element',
                        'Show Metadata: Display titles, descriptions, cast, genres and other information',
                        'Clock Widget: Enable/disable clock display with timezone support (auto-detect or manual selection)',
                        'Visual elements can be combined for rich information display or minimized for clean poster presentation',
                    ],
                },
                {
                    title: 'Content Quality Filtering',
                    description: 'Filter content based on rating quality.',
                    details: [
                        'Minimum Rotten Tomatoes Score (0-10): Only show movies/shows with RT ratings above this threshold',
                        'Setting applies only when Rotten Tomatoes badges are enabled',
                        'Lower values include more content, higher values show only highly-rated content',
                    ],
                },
                {
                    title: 'Effects & Transitions',
                    description: 'Configure visual effects and transitions between content.',
                    details: [
                        'Ken Burns: Slow zoom and pan effect on images',
                        'Fade In/Out: Smooth fading transitions between content',
                        'Slide Transition: Content slides in from different directions',
                        'Effect Pause Time: How long effects pause between transitions (0-10 seconds)',
                    ],
                },
                {
                    title: 'UI Element Scaling',
                    description:
                        'Fine-tune individual interface elements for optimal display on your screen.',
                    details: [
                        'Content Scaling: Adjust size of movie/show information text and metadata (50%-200%)',
                        'Clearlogo Scaling: Scale movie/show logos independently (50%-200%)',
                        'Clock Scaling: Adjust clock widget size (50%-200%)',
                        'Global Scaling: Apply overall scaling to all interface elements (50%-200%)',
                        'Quick Templates: 4K TV (larger elements), Full HD (standard size), Tablet (smaller), Phone (compact)',
                        'Perfect for: Custom screen sizes, projectors, ultra-wide monitors, or accessibility needs',
                    ],
                },
                {
                    title: 'Scale Settings',
                    description: 'Adapt the interface to different screen sizes.',
                    details: [
                        'Full HD (1920x1080): Optimal for most TVs',
                        '4K (3840x2160): For large 4K screens and displays',
                        'Widescreen: For ultrawide monitors and projector screens',
                        'Custom: Manually adjust for specific setup',
                    ],
                },
            ],
        },
        'media-section': {
            title: '<i class="fas fa-database"></i>&nbsp;&nbsp;Content Sources',
            sections: [
                {
                    title: 'Plex Media Server',
                    description:
                        'Configure your local Plex server with hostname/IP, port (usually 32400), and authentication token.',
                    details: [
                        'Server URL: The IP address or domain name of your Plex server (e.g. http://192.168.1.100:32400)',
                        'Plex Token: Get your authentication token from <a href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/" target="_blank" rel="noopener">Plex Support</a>',
                        'Choose which libraries to include and test connection before saving',
                        'Enable as content source to include in rotation',
                    ],
                },
                {
                    title: 'TMDB External Source',
                    description: 'Use The Movie Database as an external content source.',
                    details: [
                        'Get a free API key from TMDB website (developers section)',
                        'Choose from many categories and enable advanced filtering by genre, year, and rating',
                        'API keys are securely stored and preserved when making other changes',
                        'Test connection validates your key and shows available genres',
                    ],
                },
                {
                    title: 'Streaming Releases (TMDB)',
                    description:
                        'Access latest releases from popular streaming platforms using TMDB streaming provider data.',
                    details: [
                        '🎬 Streaming Platforms: Netflix, Disney+, Amazon Prime Video, Apple TV+, HBO Max, Hulu, and more',
                        '🌍 Regional Content: Select your region (US, UK, DE, etc.) to get locally available content',
                        '📱 Provider Selection: Choose specific streaming services you have subscriptions to',
                        '🆕 Latest Releases: Automatically finds newest content added to streaming platforms',
                        '🔄 Auto-Refresh: Content updates as streaming platforms add new movies and shows',
                        'Requires TMDB API key (same as regular TMDB source)',
                        'Perfect for discovering new content available on your streaming subscriptions',
                    ],
                },
                {
                    title: 'TMDB Categories & Configuration',
                    description: 'Extensive category options and multi-select genre filtering.',
                    details: [
                        '🎬 Movies: Popular, Top Rated, Now Playing, Upcoming, Latest, Trending Daily/Weekly',
                        '📺 TV: Popular Shows, Top Rated, Currently Airing, Airing Today, Latest, Trending Daily/Weekly',
                        '🔍 Discover: Advanced filtering with all options combined',
                        'Select multiple genres using the dropdown or clear all selections with the clear button',
                    ],
                },
                {
                    title: 'TVDB External Source',
                    description: 'Use The TV Database as an external content source.',
                    details: [
                        'No API key required - TVDB integration works out of the box for all users',
                        'Comprehensive database of TV shows, movies, and metadata',
                        'Professional artwork and high-quality background images',
                        'Test connection validates TVDB API access and shows sample data',
                    ],
                },
                {
                    title: 'TVDB Categories & Configuration',
                    description: 'Wide variety of sorting and discovery options.',
                    details: [
                        '🏆 By Rating: Top Rated (highest ratings), Most Popular (popularity scores)',
                        '📅 By Date: Recently Updated, Newest Releases, Classic Content',
                        '📊 By Activity: Trending Now, Recently Added to TVDB',
                        '🔤 Alphabetical: A-Z sorted content for easy browsing',
                    ],
                },
                {
                    title: 'Content Filtering & Limits',
                    description: 'Filter content and set performance limits.',
                    details: [
                        'Filter by rating, genre, quality, or recently added date',
                        'Plex filters use your server metadata while TMDB and TVDB use their rating and year filters',
                        'Genre filtering supports multi-select for all sources (Plex, TMDB, TVDB)',
                        'Set reasonable limits for movies and shows to maintain good performance',
                        'TMDB has daily API limits, so moderate requests',
                        'TVDB has no API key limitations but respects reasonable request limits',
                    ],
                },
                {
                    title: 'Content Source Integration Tips',
                    description:
                        'Best practices for optimal content source configuration and management.',
                    details: [
                        '<strong>Multiple Sources</strong>: Combine Plex (personal library) + TMDB (discovery) + TVDB (metadata) for best results',
                        '<strong>API Rate Limits</strong>: TMDB has daily API limits - moderate your refresh intervals',
                        '<strong>Content Quality</strong>: Use genre filtering and rating thresholds to curate high-quality content',
                        '<strong>Performance Balance</strong>: More sources = more content variety but longer refresh times',
                        '<strong>Regional Settings</strong>: Match TMDB region settings to your location for relevant streaming content',
                        '<strong>Testing</strong>: Always test connections after configuration changes',
                        '<strong>Backup Strategy</strong>: Keep API keys secure and backed up separately',
                        'Regular content refresh ensures fresh, up-to-date poster displays',
                    ],
                },
            ],
        },
        'authentication-section': {
            title: '<i class="fas fa-shield-alt"></i>&nbsp;&nbsp;Authentication & Security',
            sections: [
                {
                    title: 'Admin Password',
                    description: 'Manage the password for access to this admin interface.',
                    details: [
                        'Use a strong password with at least 8 characters',
                        'Combine uppercase, lowercase, numbers and symbols',
                        'Change the password regularly for optimal security',
                        'Store the password in a safe place',
                    ],
                },
                {
                    title: 'Two-Factor Authentication (2FA) - Complete Guide',
                    description:
                        'Comprehensive setup and management of 2FA security for your admin account.',
                    details: [
                        '<strong>Supported Apps</strong>: Google Authenticator, Authy, Microsoft Authenticator, 1Password, LastPass Authenticator',
                        '<strong>Setup Process</strong>: Enable 2FA → Scan QR code with your app → Enter verification code → Save backup codes',
                        '<strong>Backup Codes</strong>: Write down and store backup codes safely - they can restore access if you lose your phone',
                        "<strong>Daily Use</strong>: After entering password, you'll need the 6-digit code from your authenticator app",
                        '<strong>Disabling 2FA</strong>: Requires current password verification for security',
                        '<strong>Lost Device</strong>: Use backup codes to regain access, then set up 2FA again with new device',
                        'Strongly recommended for all admin accounts to prevent unauthorized access',
                    ],
                },
                {
                    title: 'API Keys - Developer Integration',
                    description:
                        'Advanced API access for external applications and custom integrations.',
                    details: [
                        '<strong>Generate API Keys</strong>: Create secure keys for external applications to access Posterrama',
                        '<strong>Bearer Token Authentication</strong>: Use API keys as Bearer tokens in Authorization header',
                        '<strong>Example Usage</strong>: <code>Authorization: Bearer your-api-key-here</code>',
                        '<strong>Available Endpoints</strong>: Access configuration, media data, and admin functions programmatically',
                        '<strong>Security</strong>: API keys provide same access level as admin login - treat them as passwords',
                        '<strong>Management</strong>: Revoke unused or compromised API keys immediately',
                        '<strong>Documentation</strong>: Full API reference available via "API Docs" button in top navigation',
                        'Perfect for custom integrations, mobile apps, or automated systems',
                    ],
                },
            ],
        },

        'management-section': {
            title: '<i class="fas fa-tools"></i>&nbsp;&nbsp;Management & Tools',
            sections: [
                {
                    title: 'Cache Management',
                    description:
                        'Monitor and manage cached poster images and data to optimize performance and disk usage.',
                    details: [
                        'Cache Storage: View disk space used by cached poster images',
                        'Memory Cache: Monitor the number of cached items in memory',
                        'Refresh Stats: Update cache statistics display',
                        'Run Cleanup: Remove old or unused cache files automatically',
                        'Clear Cache: Delete all cached data to free up disk space',
                    ],
                },
                {
                    title: 'Media Management',
                    description:
                        'Control how media content is fetched and refreshed from your sources.',
                    details: [
                        'Refresh Media: Manually trigger a refresh of all media from configured sources',
                        'Updates poster collection from Plex, TMDB, TVDB, and other configured sources',
                        "Useful when you've added new content or changed source configurations",
                    ],
                },
                {
                    title: 'Application Controls',
                    description: 'Monitor system health and control the Posterrama application.',
                    details: [
                        'Restart Application: Safely restart Posterrama to apply changes or fix issues',
                        'Status Check: View detailed system health including memory usage, uptime, and API status',
                        'Performance Monitor: Real-time performance metrics including CPU and memory usage',
                    ],
                },
                {
                    title: 'Automatic Updates',
                    description:
                        'Manage automatic updates and backups for the Posterrama application.',
                    details: [
                        'Start Auto-Update: Check for and install the latest Posterrama version automatically',
                        'Rollback: Restore to a previous version if issues occur after an update',
                        'View Backups: Browse available backup versions with timestamps',
                        'Update Status: Monitor update progress with real-time progress indicators',
                        'Automatic backup creation before updates for safe rollback capability',
                    ],
                },
                {
                    title: 'Server Settings',
                    description: 'Configure the application server port.',
                    details: [
                        'Application Port: The port number where the admin interface and app are available',
                        'Valid range: 1024-65535; default is typically 4000',
                        'Ensure the port is free and not used by other services',
                        'A restart is required after changing the port',
                    ],
                },
                {
                    title: 'Performance Monitor - Advanced Diagnostics',
                    description: 'Real-time system monitoring and performance analysis tools.',
                    details: [
                        '<strong>CPU Usage</strong>: Monitor processor utilization in real-time',
                        '<strong>Memory Usage</strong>: Track RAM consumption and identify memory leaks',
                        '<strong>Performance Metrics</strong>: Response times, API call durations, and system load',
                        '<strong>Resource Monitoring</strong>: Disk usage, network activity, and cache performance',
                        '<strong>Performance Impact</strong>: Monitor how different settings affect system performance',
                        '<strong>Troubleshooting</strong>: Identify bottlenecks and performance issues',
                        'Updates in real-time to provide immediate feedback on system health',
                    ],
                },
                {
                    title: 'Backup Management - Complete Guide',
                    description:
                        'Comprehensive backup system for safe updates and disaster recovery.',
                    details: [
                        '<strong>Automatic Backups</strong>: Created automatically before each update process',
                        '<strong>Backup Contents</strong>: Complete application state, configuration, and database',
                        '<strong>Timestamp Format</strong>: Backups labeled with date/time for easy identification',
                        '<strong>Restore Process</strong>: Select specific backup and restore to that exact state',
                        '<strong>Storage Location</strong>: Backups stored securely in application backup directory',
                        '<strong>Backup Validation</strong>: Each backup verified for integrity before storage',
                        '<strong>Cleanup</strong>: Older backups automatically removed to manage disk space',
                        'Essential for safe updates and recovering from configuration issues',
                    ],
                },
                {
                    title: 'Debug & Logging - Live Monitoring',
                    description:
                        'Advanced logging system with real-time monitoring and troubleshooting capabilities.',
                    details: [
                        '<strong>Debug Mode</strong>: Enable verbose logging for detailed troubleshooting information',
                        '<strong>Live Logs Viewer</strong>: Access real-time logs via "View live logs" button or <a href="/admin/logs" target="_blank">/admin/logs</a>',
                        '<strong>Performance Impact</strong>: Debug mode may affect performance - use temporarily for troubleshooting',
                        '<strong>Log Categories</strong>: Authentication, media processing, API calls, and system events',
                        '<strong>Error Tracking</strong>: Detailed error messages with stack traces for developers',
                        '<strong>Connection Diagnostics</strong>: Specific logs for Plex, TMDB, and TVDB connection issues',
                        '<strong>Auto-Refresh</strong>: Live logs update automatically without page refresh',
                        'Essential tool for diagnosing configuration problems and system issues',
                    ],
                },
                {
                    title: 'Promobox Site',
                    description: 'Manage the optional Promobox Site server.',
                    details: [
                        'Enable Site: Starts an additional web server for the promotional website',
                        'Port Number: Configure the port (1024-65535), default 4001',
                        'Site Status: Shows the access URL when enabled; updates automatically with your server IP and port',
                        'After changing the port, use the new URL to access the site',
                        'Security: Enabling exposes an extra endpoint on your network—ensure your firewall rules are appropriate',
                    ],
                },
                {
                    title: 'Project & Support',
                    description: 'Access project resources and community support for Posterrama.',
                    details: [
                        'View on GitHub: Access the official Posterrama repository for source code and documentation',
                        'Report Issue: Submit bug reports or feature requests directly to the development team',
                        'Open source project: Posterrama is free software that welcomes community contributions',
                        'Direct links to GitHub issues and project pages for easy access to support resources',
                    ],
                },
                {
                    title: 'Developer Resources',
                    description:
                        'Access technical documentation and API references for integration and development.',
                    details: [
                        '<strong>API Documentation</strong>: Interactive Swagger/OpenAPI documentation for all REST endpoints',
                        'Complete API reference with request/response examples and authentication details',
                        'Test API endpoints directly from the documentation interface',
                        'Perfect for developers building integrations or external applications',
                        'Access via "API Docs" button in the top navigation bar',
                        'Covers all public and admin endpoints with full technical specifications',
                    ],
                },
            ],
        },
    };

    return helpContent[sectionId] || helpContent['general-section'];
}
// Expose globally
window.toggleHelpPanel = toggleHelpPanel;

document.addEventListener('DOMContentLoaded', () => {
    // Add event listener to help button as backup
    const helpButton = document.getElementById('toggle-help-panel');
    if (helpButton) {
        helpButton.addEventListener('click', function (e) {
            e.preventDefault(); // Prevent any default behavior
            // Use the EXACT same call as the 'H' key
            if (window.toggleHelpPanel) {
                window.toggleHelpPanel();
            }
        });
    }

    // Register Service Worker for caching
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker
            .register('/sw.js')
            .then(_registration => {
                // Service worker registered successfully
            })
            .catch(_error => {
                // Service worker registration failed
            });
    }

    // Performance monitoring
    if ('performance' in window) {
        window.addEventListener('load', () => {
            performance.getEntriesByType('navigation')[0];
            // Performance data collected but not logged in production
        });
    }

    // Global runtime error capture overlay (diagnostic aid)
    (function installGlobalErrorHandler() {
        if (window.__ADMIN_ERROR_HANDLER_INSTALLED) return;
        window.__ADMIN_ERROR_HANDLER_INSTALLED = true;
        function showRuntimeError(title, msg) {
            let box = document.getElementById('admin-runtime-error-box');
            if (!box) {
                box = document.createElement('div');
                box.id = 'admin-runtime-error-box';
                box.style.cssText =
                    'position:fixed;top:8px;left:50%;transform:translateX(-50%);max-width:860px;width:90%;background:#300;border:2px solid #f33;color:#fff;font:12px monospace;z-index:70000;padding:10px;white-space:pre-wrap;overflow:auto;max-height:70vh;';
                document.body.appendChild(box);
            }
            const ts = new Date().toISOString();
            box.innerHTML = `[${ts}] ${title}\n${msg}\n` + box.innerHTML;
        }
        window.addEventListener('error', e => {
            showRuntimeError(
                'JS Error',
                `${e.message}\nSource:${e.filename}:${e.lineno}:${e.colno}`
            );
        });
        window.addEventListener('unhandledrejection', e => {
            showRuntimeError(
                'Unhandled Promise Rejection',
                String((e.reason && e.reason.stack) || e.reason)
            );
        });
        window.__showRuntimeError = showRuntimeError;
    })();
    // (Removed old sentinel overlay & transient debug badges)
    // Sidebar functionality
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const navItems = document.querySelectorAll('.nav-item');
    let sections = document.querySelectorAll('.section-content');

    const expectedSectionKeys = [
        'general',
        'display',
        'media',
        'authentication',
        'management',
        'devices',
        'logs',
    ];

    // Mobile detection and initialization
    function isMobile() {
        return window.innerWidth <= 768;
    }

    // Initialize mobile state
    function initializeMobileState() {
        if (isMobile()) {
            // On mobile, sidebar should ALWAYS be collapsed by default
            sidebar.classList.add('collapsed');
            sidebar.classList.remove('mobile-open');
            // Remove any saved state that might override this on mobile
            if (localStorage.getItem('sidebarCollapsed')) {
                localStorage.removeItem('sidebarCollapsed');
            }

            // PHYSICALLY remove ALL desktop sidebar toggles on mobile (more aggressive)
            const desktopToggle = document.getElementById('sidebar-toggle');
            if (desktopToggle) {
                desktopToggle.remove();
            }

            // Remove any remaining desktop toggles (BUT NOT the help button!)
            const allDesktopToggles = document.querySelectorAll(
                '.sidebar-toggle, .sidebar-header button, #sidebar-toggle, button[class*="toggle"]:not(#toggle-help-panel)'
            );
            allDesktopToggles.forEach(toggle => {
                // Double check we're not removing the help button
                if (toggle.id !== 'toggle-help-panel') {
                    toggle.remove();
                }
            });

            // Remove the entire sidebar header to prevent any lingering event handlers
            const sidebarHeader = document.querySelector('.sidebar-header');
            if (sidebarHeader) {
                sidebarHeader.remove();
            }

            // REMOVED: Mobile menu button creation
            // We no longer create a hamburger menu on mobile
            // The sidebar is completely hidden on mobile via CSS and HTML changes
        } else {
            // On tablet/desktop, ensure sidebar is NEVER collapsed
            sidebar.classList.remove('collapsed');
            sidebar.classList.add('sidebar-always-open');

            // Clear any saved collapsed state for tablets/desktop
            if (localStorage.getItem('sidebarCollapsed')) {
                localStorage.removeItem('sidebarCollapsed');
            }

            // Remove mobile menu button on desktop (cleanup)
            const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
            if (mobileMenuBtn) {
                mobileMenuBtn.remove();
            }
        }
    }

    // Handle window resize
    function handleResize() {
        const wasMobile = false; // No mobile menu anymore
        const nowMobile = isMobile();

        if (wasMobile !== nowMobile) {
            if (nowMobile) {
                // Switching to mobile - remove desktop toggle and force collapsed
                sidebar.classList.add('collapsed');
                sidebar.classList.remove('sidebar-always-open');
                const desktopToggle = document.getElementById('sidebar-toggle');
                if (desktopToggle) {
                    desktopToggle.remove();
                }

                // Remove all desktop sidebar toggles
                const allDesktopToggles = document.querySelectorAll('.sidebar-toggle');
                allDesktopToggles.forEach(toggle => {
                    toggle.remove();
                });
            } else {
                // Switching to tablet/desktop - ensure sidebar is open
                sidebar.classList.remove('collapsed');
                sidebar.classList.add('sidebar-always-open');

                // Clear any saved collapsed state
                if (localStorage.getItem('sidebarCollapsed')) {
                    localStorage.removeItem('sidebarCollapsed');
                }
            }

            initializeMobileState();
        }
    }

    // Initialize mobile state on load
    initializeMobileState();

    // Listen for window resize
    window.addEventListener('resize', handleResize);

    function ensureAllSectionsPresent() {
        sections = document.querySelectorAll('.section-content');
        const presentIds = Array.from(sections).map(s => s.id);
        const missing = expectedSectionKeys.filter(key => !presentIds.includes(`${key}-section`));
        if (missing.length) {
            logger.warn(
                '[ADMIN] Missing section DOM nodes detected, creating placeholders for:',
                missing
            );
            const form = document.getElementById('config-form');
            if (form) {
                missing.forEach(key => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'section-content';
                    wrapper.id = `${key}-section`;
                    wrapper.innerHTML = `\n<div class="section-main-content">\n  <div class="section-title">${key.charAt(0).toUpperCase() + key.slice(1)} (placeholder injected)</div>\n  <div class="form-section">\n    <p style="padding:8px 4px;margin:0;color:#fff;font-family:monospace;font-size:14px;">Original HTML for this section was not delivered by the server. Placeholder injected client-side.</p>\n  </div>\n</div>`;
                    form.appendChild(wrapper);
                });
                sections = document.querySelectorAll('.section-content');
            }
        }
    }

    // Run once at startup
    ensureAllSectionsPresent();

    // (Removed legacy layout fallback interval – no longer required after portal approach)

    // Restore sidebar state from localStorage (only for mobile devices)
    if (isMobile()) {
        const savedSidebarState = localStorage.getItem('sidebarCollapsed');
        if (savedSidebarState === 'true') {
            sidebar.classList.add('collapsed');
        }
    } else {
        // On tablet/desktop, always ensure sidebar is open
        sidebar.classList.remove('collapsed');
        sidebar.classList.add('sidebar-always-open');
        // Clear any lingering collapsed state
        if (localStorage.getItem('sidebarCollapsed')) {
            localStorage.removeItem('sidebarCollapsed');
        }
    }

    // Set initial ARIA state
    if (sidebarToggle) {
        const isExpanded = !sidebar.classList.contains('collapsed');
        sidebarToggle.setAttribute('aria-expanded', isExpanded);
    }

    // Toggle sidebar - DISABLED for tablets/desktop (always open)
    if (sidebarToggle && isMobile()) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');

            // Update ARIA attributes (true when sidebar is expanded/visible)
            const isExpanded = !sidebar.classList.contains('collapsed');
            sidebarToggle.setAttribute('aria-expanded', isExpanded);

            // Save the new state to localStorage (only on mobile)
            localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        });
    } else if (sidebarToggle && !isMobile()) {
        // Remove toggle button on tablets/desktop since sidebar is always open
        sidebarToggle.remove();
    }

    // Mobile overlay and click outside functionality
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.add('collapsed');
            sidebar.classList.remove('mobile-open');
        });
    }

    // Click outside to close mobile sidebar
    document.addEventListener('click', _e => {
        // Mobile sidebar is now completely hidden via CSS
        // No click handling needed for mobile menu
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        // Quick Help shortcut: Press 'H' key (defensive for browsers/events without key)
        const key = e && typeof e.key === 'string' ? e.key.toLowerCase() : '';

        if (key === 'h' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            // Only activate if we're not typing in an input field
            const activeElement = document.activeElement;
            const isInputField =
                activeElement &&
                (activeElement.tagName === 'INPUT' ||
                    activeElement.tagName === 'TEXTAREA' ||
                    activeElement.contentEditable === 'true');

            if (!isInputField) {
                e.preventDefault();
                // Use globally attached function (set later) to avoid scope issues
                if (window.toggleHelpPanel) {
                    window.toggleHelpPanel();
                }
            }
        }

        // Close help panel with Escape key
        if (key === 'escape') {
            const helpPanel = document.getElementById('quick-help-panel');
            if (helpPanel && helpPanel.classList.contains('open')) {
                e.preventDefault();
                window.toggleHelpPanel();
            }
        }
    });

    // Store original section content before any modifications
    window.originalSectionContent = {};

    // Store all section content at page load
    const allSections = document.querySelectorAll('.section-content');
    allSections.forEach(section => {
        window.originalSectionContent[section.id] = section.innerHTML;
    });

    // Default values for settings (moved up to precede any timer cleanup calls)
    const defaults = {
        transitionIntervalSeconds: 15,

        showClearLogo: true,
        showRottenTomatoes: true,
        rottenTomatoesMinimumScore: 0,
        showPoster: true,
        showMetadata: true,
        clockWidget: true,
        clockTimezone: 'auto',
        clockFormat: '24h',
        cinemaMode: false,
        cinemaOrientation: 'auto',
        transitionEffect: 'kenburns',
        effectPauseTime: 2,
        uiScaling: {
            content: 100,
            clearlogo: 100,
            clock: 100,
            global: 100,
        },
        mediaServers: [
            {
                enabled: true,
                hostname: '',
                port: 32400,
                movieLibraryNames: ['Movies'],
                showLibraryNames: ['TV Shows'],
                ratingFilter: '',
                genreFilter: '',
                recentlyAddedOnly: false,
                recentlyAddedDays: 30,
                qualityFilter: '',
            },
        ],
        tmdbSource: {
            enabled: false,
            apiKey: '',
            category: 'popular',
            minRating: 0,
            yearFilter: null,
            genreFilter: '',
        },
        siteServer: {
            enabled: false,
            port: 4001,
        },
        SERVER_PORT: 4000,
        DEBUG: false,
    };

    // --- Admin Background Slideshow State ---
    let adminBgQueue = [];
    let adminBgIndex = -1;
    let adminBgTimer = null;
    let activeAdminLayer = null;
    let inactiveAdminLayer = null;

    // (Preview system removed)
    let isCinemaMode = false; // retained only for display settings toggling until rewrite

    let sectionNodes = Array.from(document.querySelectorAll('.section-content'));

    // Mutation observer diagnostics to detect unexpected child removals / empties
    // (Removed mutation observers & legacy debug toggles – simplifying production build)

    function activateSection(targetSection) {
        if (!targetSection) return;
        // Remove the logic that stops background slideshow - fanart should always run
        sectionNodes = Array.from(document.querySelectorAll('.section-content'));
        ensureAllSectionsPresent();
        // Simple show/hide logic for sections
        sectionNodes.forEach(sec => {
            const isTarget = sec.id === `${targetSection}-section`;
            if (isTarget) {
                sec.classList.add('active');
                sec.style.display = 'block';
            } else {
                sec.classList.remove('active');
                sec.style.display = 'none';
            }
        });

        // Scroll to top of main content so section title is immediately visible
        const main = document.querySelector('.main-content');
        if (main) {
            // Prefer direct property for maximum compatibility
            main.scrollTop = 0;
            main.scrollLeft = 0;
        } else {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }

        // Always update help content when section changes
        updateHelpContent(targetSection);

        // When switching sections, clear any config status warning if moving away from config edits
        const statusMessage = document.getElementById('config-status');
        const saveButton = document.getElementById('save-config-button');
        if (statusMessage && saveButton) {
            if (targetSection === 'devices') {
                statusMessage.textContent = 'Ready to save';
                statusMessage.className = 'status-message';
                saveButton.classList.remove('has-changes');
                // Reset form change tracking baseline when entering Devices to avoid false warnings
                if (typeof window.resetFormChangeTracking === 'function') {
                    try {
                        window.resetFormChangeTracking();
                    } catch (_) {}
                }
            }
        }

        // If help panel is open, make sure it updates immediately
        const helpPanel = document.getElementById('quick-help-panel');
        if (helpPanel && helpPanel.classList.contains('open')) {
            // Force update by calling with forceUpdate parameter
            updateHelpContentForced(targetSection);
        }

        // Load cache stats when Management section is activated
        if (targetSection === 'management') {
            setTimeout(() => {
                loadCacheStats();
                loadCacheConfig();

                // Also ensure cache config event listeners are attached
                setupCacheConfigEventListeners();
            }, 100); // Small delay to ensure DOM is ready
        }

        // Initialize Devices panel when Devices section is activated
        if (targetSection === 'devices') {
            setTimeout(() => {
                try {
                    initDevicesPanel();
                } catch (e) {
                    // ignore
                }
            }, 50);
        }

        // No standalone Groups section

        // Libraries are now loaded during config load, no need for lazy loading here
    }

    // Make activateSection globally available
    window.activateSection = activateSection;

    // Smooth scroll to a subsection within the Content Sources section
    function scrollToSubsection(id) {
        const run = () => {
            const target = document.getElementById(id);
            if (!target) return;
            // Scroll the nearest scrollable ancestor reliably
            try {
                target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
            } catch (_) {
                target.scrollIntoView();
            }
        };

        const media = document.getElementById('media-section');
        if (!media || !media.classList.contains('active')) {
            if (typeof window.activateSection === 'function') {
                window.activateSection('media');
                // Delay slightly to allow layout to update before measuring
                setTimeout(run, 160);
            } else {
                run();
            }
        } else {
            run();
        }
    }
    window.scrollToSubsection = scrollToSubsection;

    navItems.forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            const targetSection = item.dataset.section;

            // Update ARIA attributes and classes for tab navigation
            navItems.forEach(nav => {
                nav.classList.remove('active');
                nav.setAttribute('aria-selected', 'false');
            });

            item.classList.add('active');
            item.setAttribute('aria-selected', 'true');

            activateSection(targetSection);
        });
    });

    // Initialize help content after definitions
    updateHelpContent('general');

    // Ensure only first (or currently expected) section is visible at start (after timers defined)
    if (navItems.length > 0) {
        const initial = navItems[0].dataset.section;
        const firstItem = navItems[0];

        // Only set ARIA and class, don't override existing inline styles
        firstItem.classList.add('active');
        firstItem.setAttribute('aria-selected', 'true');

        // Reset other items (but not the first one)
        navItems.forEach((nav, index) => {
            if (index !== 0) {
                nav.classList.remove('active');
                nav.setAttribute('aria-selected', 'false');
            }
        });

        activateSection(initial);
    }

    // Legacy debug helpers removed

    window.addEventListener('resize', handleResize);
    handleResize();

    // (defaults & state moved earlier)

    function populateGeneralSettings(config, env, defaults) {
        // Normalize env values to predictable runtime types (strings for ports, booleans for flags)
        const normalizedEnv = {
            SERVER_PORT:
                env.SERVER_PORT != null ? String(env.SERVER_PORT) : String(defaults.SERVER_PORT),
            DEBUG:
                env.DEBUG != null ? env.DEBUG === true || env.DEBUG === 'true' : !!defaults.DEBUG,
            PLEX_HOSTNAME: env.PLEX_HOSTNAME != null ? String(env.PLEX_HOSTNAME) : undefined,
            PLEX_PORT: env.PLEX_PORT != null ? String(env.PLEX_PORT) : undefined,
            PLEX_TOKEN: env.PLEX_TOKEN === true, // server already sends boolean for token presence
        };
        // Persist normalized version for other functions (read-only usage)
        window.__normalizedEnv = normalizedEnv;

        // Update the defaults object with server DEBUG value so console.log conditions work
        defaults.DEBUG = normalizedEnv.DEBUG;

        document.getElementById('transitionIntervalSeconds').value =
            config.transitionIntervalSeconds ?? defaults.transitionIntervalSeconds;

        document.getElementById('SERVER_PORT').value = normalizedEnv.SERVER_PORT;
        document.getElementById('DEBUG').checked = normalizedEnv.DEBUG;

        // Debug cache action removed from UI
        // Site server settings are populated after server meta (IP) is available in loadConfig.
        // (Avoid early call with placeholder IP to prevent inconsistent link text.)
    }

    function populateSiteServerSettings(config, server = {}) {
        const siteServer = config.siteServer || {};
        const serverIP = server.ipAddress; // Only use real IP when provided
        const enabledCheckbox = document.getElementById('siteServer.enabled');
        const portInput = document.getElementById('siteServer.port');
        const portGroup = document.getElementById('siteServerPortGroup');
        const statusIndicator = document.getElementById('siteServerStatus');

        if (enabledCheckbox) {
            enabledCheckbox.checked = siteServer.enabled || false;
        }

        if (portInput) {
            portInput.value = siteServer.port || 4001;
        }

        // Show/hide port input based on enabled state
        if (portGroup) {
            portGroup.style.display = siteServer.enabled ? 'block' : 'none';
        }

        // Show/hide status indicator based on enabled state
        if (statusIndicator) {
            statusIndicator.style.display = siteServer.enabled ? 'block' : 'none';
            if (siteServer.enabled) {
                const port = siteServer.port || 4001;
                const statusLink = statusIndicator.querySelector('.status-link');
                if (statusLink) {
                    if (serverIP) {
                        statusLink.href = `http://${serverIP}:${port}`;
                        statusLink.textContent = `http://${serverIP}:${port}`;
                    } else {
                        statusLink.removeAttribute('href');
                        statusLink.textContent = `(waiting for server IP...)`;
                    }
                }
            }
        }

        // Add event listener for site server checkbox
        if (enabledCheckbox) {
            enabledCheckbox.addEventListener('change', function () {
                const isEnabled = this.checked;
                if (portGroup) {
                    portGroup.style.display = isEnabled ? 'block' : 'none';
                }
                if (statusIndicator) {
                    statusIndicator.style.display = isEnabled ? 'block' : 'none';
                    if (isEnabled) {
                        const port = portInput ? portInput.value || 4001 : 4001;
                        const statusLink = statusIndicator.querySelector('.status-link');
                        if (statusLink) {
                            if (serverIP) {
                                statusLink.href = `http://${serverIP}:${port}`;
                                statusLink.textContent = `http://${serverIP}:${port}`;
                            } else {
                                statusLink.removeAttribute('href');
                                statusLink.textContent = `(waiting for server IP...)`;
                            }
                        }
                    }
                }
            });
        }

        // Add event listener for port input
        if (portInput && statusIndicator && serverIP) {
            portInput.addEventListener('input', function () {
                const port = this.value || 4001;
                const statusLink = statusIndicator.querySelector('.status-link');
                if (statusLink) {
                    statusLink.href = `http://${serverIP}:${port}`;
                    statusLink.textContent = `http://${serverIP}:${port}`;
                }
            });
        }
    }

    // Setup real-time input validation
    function setupInputValidation() {
        // Add validation for numeric fields
        const numericFields = [
            { id: 'transitionIntervalSeconds', min: 1, max: 300, label: 'Transition Interval' },

            { id: 'SERVER_PORT', min: 1024, max: 65535, label: 'Application Port' },
            { id: 'siteServer.port', min: 1024, max: 65535, label: 'Port Number' },
            { id: 'rottenTomatoesMinimumScore', min: 0, max: 10, label: 'Rotten Tomatoes Score' },
            { id: 'mediaServers[0].port', min: 1, max: 65535, label: 'Plex Port' },

            { id: 'effectPauseTime', min: 0, max: 10, label: 'Effect Pause Time' },
        ];

        numericFields.forEach(field => {
            const element = document.getElementById(field.id);
            if (element) {
                // Add input event listener for real-time validation
                element.addEventListener('input', function () {
                    validateNumericInput(element, field);
                });

                // Add blur event for more thorough validation
                element.addEventListener('blur', function () {
                    validateNumericInput(element, field);
                });
            }
        });

        // Add validation for password confirmation
        const newPasswordInput = document.getElementById('newPassword');
        const confirmPasswordInput = document.getElementById('confirmPassword');

        if (newPasswordInput && confirmPasswordInput) {
            const validatePasswords = () => {
                const newPassword = newPasswordInput.value;
                const confirmPassword = confirmPasswordInput.value;

                // Clear previous validation state
                confirmPasswordInput.setCustomValidity('');

                if (confirmPassword && newPassword !== confirmPassword) {
                    confirmPasswordInput.setCustomValidity('Passwords do not match');
                } else if (newPassword && newPassword.length < 8) {
                    newPasswordInput.setCustomValidity(
                        'Password must be at least 8 characters long'
                    );
                } else {
                    newPasswordInput.setCustomValidity('');
                }
            };

            newPasswordInput.addEventListener('input', validatePasswords);
            confirmPasswordInput.addEventListener('input', validatePasswords);
        }

        // Add validation for hostname/IP format
        const hostnameInput = document.getElementById('mediaServers[0].hostname');
        if (hostnameInput) {
            hostnameInput.addEventListener('input', function () {
                const value = this.value.trim();
                if (value && !/^[a-zA-Z0-9.-]+$/.test(value)) {
                    this.setCustomValidity(
                        'Hostname must contain only letters, numbers, dots, and hyphens'
                    );
                } else {
                    this.setCustomValidity('');
                }
            });
        }
    }

    function validateNumericInput(element, field) {
        const value = element.value.trim();

        // Clear previous validation state
        element.setCustomValidity('');

        if (value === '') {
            // Empty is allowed for most fields
            return;
        }

        const numValue = Number(value);

        if (!Number.isFinite(numValue)) {
            element.setCustomValidity(`${field.label} must be a valid number`);
            return;
        }

        if (field.min !== undefined && numValue < field.min) {
            element.setCustomValidity(`${field.label} must be at least ${field.min}`);
            return;
        }

        if (field.max !== undefined && numValue > field.max) {
            element.setCustomValidity(`${field.label} must be at most ${field.max}`);
            return;
        }
    }

    // Setup form change tracking for better UX
    // Enhanced form change tracking (singleton)
    let formTrackingInitialized = false;
    function setupFormChangeTracking() {
        if (formTrackingInitialized) return; // prevent duplicate listeners
        const configForm = document.getElementById('config-form');
        const statusMessage = document.getElementById('config-status');
        const saveButton = document.getElementById('save-config-button');
        if (!configForm || !statusMessage || !saveButton) return;

        formTrackingInitialized = true;
        let hasChanges = false;
        let originalFormData = null;

        const captureFormState = () => {
            const state = {};
            // Build a deterministic snapshot of named controls, excluding anything inside the Devices section
            const controls = configForm.querySelectorAll(
                'input[name], select[name], textarea[name]'
            );
            controls.forEach(el => {
                // Skip controls inside the Devices section entirely
                if (typeof el.closest === 'function' && el.closest('#devices-section')) return;
                // Skip disabled controls to match FormData behavior
                if (el.disabled) return;
                const name = el.name;
                if (!name) return;
                const type = (el.type || '').toLowerCase();
                if (type === 'checkbox') {
                    state[name] = el.checked;
                } else if (type === 'radio') {
                    if (el.checked) state[name] = el.value;
                } else if (el.tagName === 'SELECT' && el.multiple) {
                    state[name] = Array.from(el.options)
                        .filter(o => o.selected)
                        .map(o => o.value);
                } else {
                    state[name] = el.value;
                }
            });
            return state;
        };

        const formHasChanged = () => {
            if (!originalFormData) return false;
            return JSON.stringify(originalFormData) !== JSON.stringify(captureFormState());
        };

        // Expose a global checker so critical actions (like Restart) can enforce "save first"
        // Use the debounced, event-driven tracker instead of recomputing raw diffs to avoid false positives
        window.hasUnsavedChanges = () => {
            try {
                return !!hasChanges;
            } catch (_) {
                return false;
            }
        };

        const updateStatus = (message, className = '') => {
            statusMessage.textContent = message;
            statusMessage.className = `status-message ${className}`;
        };

        let initializingSnapshotDone = false;
        const handleFormChange = debounce(() => {
            if (!initializingSnapshotDone) return; // ignore noise during initial population
            if (formHasChanged()) {
                if (!hasChanges) {
                    hasChanges = true;
                    updateStatus('Unsaved changes detected', 'warning');
                    saveButton.classList.add('has-changes');
                }
            } else if (hasChanges) {
                hasChanges = false;
                updateStatus('All changes saved', 'success');
                saveButton.classList.remove('has-changes');
            }
        }, 400);

        // Initial snapshot after UI population; allow extra time for async-populated fields
        setTimeout(() => {
            originalFormData = captureFormState();
            // One more micro-baseline after next frame for late async injections
            requestAnimationFrame(() => {
                originalFormData = captureFormState();
                initializingSnapshotDone = true;
            });
        }, 250);

        const onFormEvent = e => {
            // If Devices section is active, ignore form dirty tracking events entirely
            const devicesActive = !!document.querySelector(
                '#devices-section.section-content.active'
            );
            if (devicesActive) return;
            // Ignore events originating from the Devices panel or its nested UI
            if (e && e.target && typeof e.target.closest === 'function') {
                if (e.target.closest('#devices-section')) return;
                if (e.target.closest('#device-settings-modal')) return;
                if (e.target.closest('.devices-toolbar')) return;
            }
            handleFormChange();
        };

        configForm.addEventListener('input', onFormEvent);
        configForm.addEventListener('change', onFormEvent);

        document.addEventListener('configSaved', () => {
            originalFormData = captureFormState();
            hasChanges = false;
            updateStatus('Configuration saved successfully', 'success');
            saveButton.classList.remove('has-changes');

            // Update saved library selections after successful save
            const movieLibraries = getSelectedLibraries('movie');
            const showLibraries = getSelectedLibraries('show');
            window.__savedMovieLibs = movieLibraries;
            window.__savedShowLibs = showLibraries;
        });

        window.addEventListener('beforeunload', e => {
            if (hasChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });

        // Expose helper to manually reset tracking (e.g., after external save)
        window.resetFormChangeTracking = () => {
            originalFormData = captureFormState();
            hasChanges = false;
            updateStatus('All changes saved', 'success');
            saveButton.classList.remove('has-changes');
        };
    }

    // Setup keyboard shortcuts for improved accessibility
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', e => {
            // Ctrl+S or Cmd+S to save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                const saveButton = document.getElementById('save-config-button');
                if (saveButton && !saveButton.disabled) {
                    saveButton.click();
                }
            }

            // Escape to close modals
            if (e.key === 'Escape') {
                const modals = document.querySelectorAll('.modal');
                modals.forEach(modal => {
                    modal.classList.add('is-hidden');
                    modal.classList.remove('modal-open', 'force-show');
                });
                document.body.classList.remove('modal-open');
                document.documentElement.classList.remove('modal-open');
            }
        });

        // Add keyboard shortcuts help tooltip
        const saveButton = document.getElementById('save-config-button');
        if (saveButton) {
            saveButton.title = 'Save all settings (Ctrl+S)';
        }
    }

    function populateDisplaySettings(config, defaults) {
        document.getElementById('showClearLogo').checked =
            config.showClearLogo ?? defaults.showClearLogo;
        document.getElementById('showRottenTomatoes').checked =
            config.showRottenTomatoes ?? defaults.showRottenTomatoes;
        document.getElementById('rottenTomatoesMinimumScore').value =
            config.rottenTomatoesMinimumScore ?? defaults.rottenTomatoesMinimumScore;
        document.getElementById('showPoster').checked = config.showPoster ?? defaults.showPoster;
        document.getElementById('showMetadata').checked =
            config.showMetadata ?? defaults.showMetadata;
        document.getElementById('clockWidget').checked = config.clockWidget ?? defaults.clockWidget;
        document.getElementById('clockTimezone').value =
            config.clockTimezone ?? defaults.clockTimezone;
        document.getElementById('clockFormat').value = config.clockFormat ?? defaults.clockFormat;

        // Sync settings
        const syncEnabledEl = document.getElementById('syncEnabled');
        if (syncEnabledEl)
            syncEnabledEl.checked =
                config.syncEnabled !== undefined
                    ? config.syncEnabled
                    : defaults.syncEnabled !== undefined
                      ? defaults.syncEnabled
                      : true;
        const syncDelayEl = document.getElementById('syncAlignMaxDelayMs');
        if (syncDelayEl)
            syncDelayEl.value = config.syncAlignMaxDelayMs ?? defaults.syncAlignMaxDelayMs ?? 1200;

        // Wallart Mode (object-based)
        const wallartMode = config.wallartMode ??
            defaults.wallartMode ?? {
                enabled: false,
                density: 'medium',
                refreshRate: 5,
                randomness: 3,
                animationType: 'fade',
                ambientGradient: false,
            };
        document.getElementById('wallartModeEnabled').checked = wallartMode.enabled;
        document.getElementById('wallartDensity').value = wallartMode.density ?? 'medium';
        const layoutVariantEl = document.getElementById('wallartLayoutVariant');
        if (layoutVariantEl) layoutVariantEl.value = wallartMode.layoutVariant ?? 'classic';
        // Populate layout settings (safe defaults)
        const ls = wallartMode.layoutSettings || {};
        const hero = ls.heroGrid || {};
        const heroSide = document.getElementById('heroSide');
        const heroRot = document.getElementById('heroRotationMinutes');
        if (heroSide) heroSide.value = hero.heroSide || 'left';
        if (heroRot) heroRot.value = hero.heroRotationMinutes || 10;
        // Micro-tiles removed from UI and config; no-op
        // Masonry Light removed
        document.getElementById('wallartRefreshRate').value =
            wallartMode.refreshRate ?? wallartMode.randomness ?? 5; // Backward compatibility
        document.getElementById('wallartRandomness').value = wallartMode.randomness ?? 3;
        document.getElementById('wallartAnimationType').value = wallartMode.animationType ?? 'fade';
        const ambientEl = document.getElementById('wallartAmbientGradient');
        if (ambientEl) ambientEl.checked = wallartMode.ambientGradient === true;
        // Spotlight option removed
        // autoRefresh removed (always on)

        // Update slider labels
        updateRefreshRateLabel(wallartMode.refreshRate ?? wallartMode.randomness ?? 5);
        updateRandomnessLabel(wallartMode.randomness ?? 3);

        // Handle backward compatibility: convert old kenBurnsEffect to new transitionEffect
        let transitionEffect = config.transitionEffect ?? defaults.transitionEffect;

        if (!transitionEffect && config.kenBurnsEffect) {
            transitionEffect = config.kenBurnsEffect.enabled ? 'kenburns' : 'none';
        }

        document.getElementById('transitionEffect').value = transitionEffect;
        document.getElementById('effectPauseTime').value =
            config.effectPauseTime ?? defaults.effectPauseTime;
        // If Ken Burns is selected at load time, force the visible value to 0 and hide the control
        if (transitionEffect === 'kenburns') {
            // Force visible pause to 0 when Ken Burns is selected
            const ept = document.getElementById('effectPauseTime');
            if (ept) ept.value = '0';
        }
        document.getElementById('cinemaMode').checked = config.cinemaMode ?? defaults.cinemaMode;
        document.getElementById('cinemaOrientation').value =
            config.cinemaOrientation ?? defaults.cinemaOrientation;

        // Set cinema mode state from config
        isCinemaMode = config.cinemaMode ?? defaults.cinemaMode;

        // Set wallart mode state from config
        const wallartModeState = config.wallartMode ?? defaults.wallartMode ?? { enabled: false };
        const isWallartMode = wallartModeState.enabled;

        // Show/hide effect pause time based on transition effect
        toggleEffectPauseTime();

        // Show/hide wallart settings based on wallart mode
        const wallartSettingsGroup = document.getElementById('wallartSettingsGroup');
        const wallartControlsGroup = document.getElementById('wallartControlsGroup');
        if (wallartSettingsGroup) {
            wallartSettingsGroup.style.display = isWallartMode ? 'block' : 'none';
            if (isWallartMode) {
                wallartSettingsGroup.classList.remove('hidden');
            } else {
                wallartSettingsGroup.classList.add('hidden');
            }
        }
        if (wallartControlsGroup) {
            wallartControlsGroup.style.display = isWallartMode ? 'block' : 'none';
            if (isWallartMode) {
                wallartControlsGroup.classList.remove('hidden');
            } else {
                wallartControlsGroup.classList.add('hidden');
            }
        }
        if (wallartSettingsGroup) {
            // Toggle layout settings subsections
            const layoutVariant =
                document.getElementById('wallartLayoutVariant')?.value || 'classic';
            const heroGrp = document.getElementById('layoutSettings-heroGrid');
            if (heroGrp) heroGrp.style.display = layoutVariant === 'heroGrid' ? 'block' : 'none';
            // Masonry Light group removed

            // React to layout variant change to toggle groups live
            const layoutVariantElLive = document.getElementById('wallartLayoutVariant');
            if (layoutVariantElLive && !layoutVariantElLive._hasToggleHandler) {
                layoutVariantElLive.addEventListener('change', () => {
                    const v = layoutVariantElLive.value || 'classic';
                    const hero = document.getElementById('layoutSettings-heroGrid');
                    if (hero) hero.style.display = v === 'heroGrid' ? 'block' : 'none';
                    // no masonry light
                });
                layoutVariantElLive._hasToggleHandler = true;
            }
        }

        // Show/hide cinema orientation settings based on cinema mode
        const cinemaOrientationGroup = document.getElementById('cinemaOrientationGroup');
        if (cinemaOrientationGroup) {
            cinemaOrientationGroup.style.display = isCinemaMode ? 'block' : 'none';
        }

        // Handle mutual exclusivity between Cinema Mode and Wallart Mode
        const cinemaModeCheckbox = document.getElementById('cinemaMode');
        const wallartModeCheckbox = document.getElementById('wallartModeEnabled');

        if (isCinemaMode && wallartModeCheckbox) {
            // If Cinema Mode is enabled, disable and hide Wallart Mode subsection
            wallartModeCheckbox.checked = false;
            wallartModeCheckbox.disabled = true;

            // Find and hide the Wallart Mode subsection (header + content)
            const wallartHeaders = document.querySelectorAll('.subsection-header');
            wallartHeaders.forEach(header => {
                if (header.textContent.includes('Wallart Mode')) {
                    header.style.display = 'none';
                    const wallartContent = header.nextElementSibling;
                    if (wallartContent && wallartContent.classList.contains('subsection-content')) {
                        wallartContent.style.display = 'none';
                    }
                }
            });

            // Also hide wallart settings submenu
            const wallartSettingsGroup = document.getElementById('wallartSettingsGroup');
            if (wallartSettingsGroup) {
                wallartSettingsGroup.classList.add('hidden');
                wallartSettingsGroup.style.display = 'none';
            }
        } else if (isWallartMode && cinemaModeCheckbox) {
            // If Wallart Mode is enabled, disable and hide Cinema Mode subsection
            cinemaModeCheckbox.checked = false;
            cinemaModeCheckbox.disabled = true;
            isCinemaMode = false;

            // Find and hide the Cinema Mode subsection (header + content)
            const cinemaHeaders = document.querySelectorAll('.subsection-header');
            cinemaHeaders.forEach(header => {
                if (header.textContent.includes('Cinema Mode')) {
                    header.style.display = 'none';
                    const cinemaContent = header.nextElementSibling;
                    if (cinemaContent && cinemaContent.classList.contains('subsection-content')) {
                        cinemaContent.style.display = 'none';
                    }
                }
            });

            // Hide cinema orientation settings
            if (cinemaOrientationGroup) {
                cinemaOrientationGroup.style.display = 'none';
            }
        }

        // Apply cinema mode settings (including Ken Burns dropdown handling) - single invocation
        toggleCinemaModeSettings(isCinemaMode);

        // Apply wallart mode settings
        toggleWallartModeSettings(isWallartMode);

        // Hide Effects & Transitions when Wallart mode is enabled
        const effectsHeader = document.getElementById('effectsHeader');
        const effectsContent = document.getElementById('effectsContent');
        if (effectsHeader && effectsContent) {
            const display = isWallartMode ? 'none' : 'block';
            effectsHeader.style.display = display;
            effectsContent.style.display = display;
        }

        // Hide UI Element Scaling when Wallart mode is enabled
        const scalingHeaders = document.querySelectorAll('.subsection-header');
        scalingHeaders.forEach(header => {
            if (header.textContent.includes('UI Element Scaling')) {
                const display = isWallartMode ? 'none' : 'block';
                header.style.display = display;
                const scalingContent = header.nextElementSibling;
                if (scalingContent && scalingContent.classList.contains('subsection-content')) {
                    scalingContent.style.display = display;
                }
            }
        });

        // Hide Playback Timing when Wallart mode is enabled
        const timingHeaders = document.querySelectorAll('.subsection-header');
        timingHeaders.forEach(header => {
            if (header.textContent.includes('Playback Timing')) {
                const display = isWallartMode ? 'none' : 'block';
                header.style.display = display;
                const timingContent = header.nextElementSibling;
                if (timingContent && timingContent.classList.contains('subsection-content')) {
                    timingContent.style.display = display;
                }
            }
        });

        // Hide sections that don't apply to Cinema Mode when initially enabled
        if (isCinemaMode) {
            const sectionsToHide = [
                'Visual Elements',
                'UI Element Scaling',
                'Effects & Transitions',
                'Playback Timing',
            ];
            sectionsToHide.forEach(sectionName => {
                const headers = document.querySelectorAll('.subsection-header');
                headers.forEach(header => {
                    if (header.textContent.includes(sectionName)) {
                        header.style.display = 'none';
                        const content = header.nextElementSibling;
                        if (content && content.classList.contains('subsection-content')) {
                            content.style.display = 'none';
                        }
                    }
                });
            });

            // Also handle Effects & Transitions by ID (fallback)
            const effectsHeader = document.getElementById('effectsHeader');
            const effectsContent = document.getElementById('effectsContent');
            if (effectsHeader && effectsContent) {
                effectsHeader.style.display = 'none';
                effectsContent.style.display = 'none';
            }
        }

        // Update spacing for first visible subsection
        updateFirstVisibleSubsectionSpacing();

        // Set up real-time input validation
        setupInputValidation();

        // Set up form change tracking
        setupFormChangeTracking();

        // Set up keyboard shortcuts
        setupKeyboardShortcuts();

        // (Removed duplicate toggleCinemaModeSettings call)

        // Populate UI scaling settings
        populateUIScalingSettings(config, defaults);

        // Show/hide timezone settings based on clockWidget state
        toggleClockSettings();

        // Show/hide recently added days field based on checkbox state
        toggleRecentlyAddedDays();
    }

    // Function to update slider background based on value
    function updateSliderBackground(slider) {
        const value = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
        slider.style.background = `linear-gradient(to right, #667eea 0%, #667eea ${value}%, rgba(255, 255, 255, 0.15) ${value}%, rgba(255, 255, 255, 0.15) 100%)`;
    }

    function populateUIScalingSettings(config, defaults) {
        const scalingConfig = config.uiScaling || defaults.uiScaling;

        // Populate range sliders and their value displays
        const scalingFields = ['content', 'clearlogo', 'clock', 'global'];
        scalingFields.forEach(field => {
            const slider = document.getElementById(`uiScaling.${field}`);
            const percentageDisplay = document.querySelector(
                `.slider-percentage[data-target="uiScaling.${field}"]`
            );

            if (slider && percentageDisplay) {
                let raw = scalingConfig[field];
                if (raw === undefined || raw === null || raw === '') {
                    raw = defaults.uiScaling[field];
                }
                const value = Number(raw);
                slider.value = value;
                percentageDisplay.textContent = `${value}%`;

                // Update slider background to show progress
                updateSliderBackground(slider);

                // Add event listener to update display and preview in real-time
                slider.addEventListener('input', () => {
                    percentageDisplay.textContent = `${slider.value}%`;
                    updateSliderBackground(slider);
                    // Push a debounced preview update so scaling reflects immediately
                    if (typeof window._debouncedPreviewSend === 'function') {
                        window._debouncedPreviewSend();
                    }
                });

                // Add event listener for live preview updates
                slider.addEventListener('change', async () => {
                    // Save the individual slider value to backend
                    const configKey = `uiScaling.${field}`;
                    try {
                        const value = parseInt(slider.value);

                        await fetch('/api/config', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ [configKey]: value }),
                        });

                        logger.debug(`Saved ${configKey}: ${value}`);
                    } catch (error) {
                        console.error(`Failed to save ${configKey}:`, error);
                        showNotification('Failed to save setting', 'error');
                    }
                });

                // Add keyboard support for fine control
                slider.addEventListener('keydown', e => {
                    const currentValue = parseInt(slider.value);
                    let newValue = currentValue;

                    switch (e.key) {
                        case 'ArrowLeft':
                        case 'ArrowDown':
                            newValue = Math.max(parseInt(slider.min), currentValue - 1);
                            break;
                        case 'ArrowRight':
                        case 'ArrowUp':
                            newValue = Math.min(parseInt(slider.max), currentValue + 1);
                            break;
                        case 'PageDown':
                            newValue = Math.max(parseInt(slider.min), currentValue - 10);
                            break;
                        case 'PageUp':
                            newValue = Math.min(parseInt(slider.max), currentValue + 10);
                            break;
                        case 'Home':
                            newValue = parseInt(slider.min);
                            break;
                        case 'End':
                            newValue = parseInt(slider.max);
                            break;
                        default:
                            return; // Don't prevent default for other keys
                    }

                    if (newValue !== currentValue) {
                        e.preventDefault();
                        slider.value = newValue;
                        percentageDisplay.textContent = `${newValue}%`;
                        updateSliderBackground(slider);
                        // Live preview update for keyboard-driven changes
                        if (typeof window._debouncedPreviewSend === 'function') {
                            window._debouncedPreviewSend();
                        }
                    }
                });
            }
        });

        // Setup reset button
        setupUIScalingResetButton();

        // Setup preset buttons
        setupUIScalingPresets();
    }

    function setupUIScalingResetButton() {
        const resetButton = document.getElementById('reset-ui-scaling');
        if (!resetButton) return;

        resetButton.addEventListener('click', async () => {
            // Visual feedback - disable button temporarily
            resetButton.disabled = true;
            resetButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';

            // Reset all sliders to default values (100%)
            const scalingFields = ['content', 'clearlogo', 'clock', 'global'];

            scalingFields.forEach(field => {
                const slider = document.getElementById(`uiScaling.${field}`);
                const percentageDisplay = document.querySelector(
                    `.slider-percentage[data-target="uiScaling.${field}"]`
                );

                if (slider && percentageDisplay) {
                    slider.value = 100;
                    percentageDisplay.textContent = '100%';
                    updateSliderBackground(slider);
                }
            });

            // Live preview update for reset action
            if (typeof window._debouncedPreviewSend === 'function') {
                window._debouncedPreviewSend();
            }

            try {
                // Save all values as 100 using the standard config save
                const resetConfig = {
                    'uiScaling.content': 100,
                    'uiScaling.text': 100,
                    'uiScaling.clearlogo': 100,
                    'uiScaling.clock': 100,
                    'uiScaling.global': 100,
                };

                // Save using single config call
                await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(resetConfig),
                });

                // Show success notification
                showNotification('UI scaling reset to defaults', 'success');
            } catch (error) {
                console.error('Failed to save reset values:', error);
                showNotification('Failed to save reset values', 'error');
            } finally {
                // Restore button state
                setTimeout(() => {
                    resetButton.disabled = false;
                    resetButton.innerHTML = '<i class="fas fa-undo"></i> Reset';
                }, 1000);
            }
        });
    }

    function setupDisplaySettingListeners() {
        const showPosterCheckbox = document.getElementById('showPoster');
        const showMetadataCheckbox = document.getElementById('showMetadata');
        const clockWidgetCheckbox = document.getElementById('clockWidget');

        const syncMetadataState = () => {
            if (!showPosterCheckbox.checked) {
                showMetadataCheckbox.checked = false;
                showMetadataCheckbox.disabled = true;
            } else {
                showMetadataCheckbox.disabled = false;
            }
        };

        showPosterCheckbox.addEventListener('change', syncMetadataState);
        showMetadataCheckbox.addEventListener('change', () => {
            if (showMetadataCheckbox.checked) {
                showPosterCheckbox.checked = true;
                syncMetadataState(); // Re-enable metadata checkbox if it was disabled
            }
        });

        // Setup clock widget toggle
        clockWidgetCheckbox.addEventListener('change', toggleClockSettings);

        // Setup recently added toggle
        const recentlyAddedCheckbox = document.getElementById('mediaServers[0].recentlyAddedOnly');
        if (recentlyAddedCheckbox) {
            recentlyAddedCheckbox.addEventListener('change', toggleRecentlyAddedDays);
        }

        // Setup Jellyfin recently added toggle
        const jellyfinRecentlyAddedCheckbox = document.getElementById(
            'mediaServers[1].recentlyAddedOnly'
        );
        if (jellyfinRecentlyAddedCheckbox) {
            jellyfinRecentlyAddedCheckbox.addEventListener(
                'change',
                toggleJellyfinRecentlyAddedDays
            );
        }

        // Setup transition effect change to toggle effect pause time visibility
        const transitionEffectSelect = document.getElementById('transitionEffect');
        if (transitionEffectSelect) {
            transitionEffectSelect.addEventListener('change', toggleEffectPauseTime);
        }

        // Initial state
        syncMetadataState();
        toggleClockSettings();
        toggleRecentlyAddedDays();
        toggleJellyfinRecentlyAddedDays();
    }

    function toggleClockSettings() {
        const clockWidget = document.getElementById('clockWidget');
        const timezoneGroup = document.getElementById('clockTimezoneGroup');
        const formatGroup = document.getElementById('clockFormatGroup');

        if (clockWidget.checked) {
            timezoneGroup.style.display = 'block';
            formatGroup.style.display = 'block';
        } else {
            timezoneGroup.style.display = 'none';
            formatGroup.style.display = 'none';
        }
    }

    function toggleRecentlyAddedDays() {
        const recentlyAddedCheckbox = document.getElementById('mediaServers[0].recentlyAddedOnly');
        const daysContainer = document.getElementById('recentlyAddedDaysContainer');

        if (daysContainer) {
            daysContainer.style.display = recentlyAddedCheckbox.checked ? 'block' : 'none';
        }
    }

    function toggleJellyfinRecentlyAddedDays() {
        const recentlyAddedCheckbox = document.getElementById('mediaServers[1].recentlyAddedOnly');
        const daysContainer = document.getElementById('jellyfinRecentlyAddedDaysContainer');

        if (daysContainer) {
            daysContainer.style.display = recentlyAddedCheckbox.checked ? 'block' : 'none';
        }
    }

    function populateSecuritySettings(security) {
        const is2FAEnabled = security.is2FAEnabled || false;
        update2FAStatusText(is2FAEnabled);
    }

    async function populatePlexSettings(config, env, defaults) {
        // Prefer normalized env if available
        const nEnv = window.__normalizedEnv || {};
        const plexServerConfig =
            config.mediaServers && config.mediaServers[0] ? config.mediaServers[0] : {};
        const plexDefaults = defaults.mediaServers[0];

        document.getElementById('mediaServers[0].enabled').checked =
            plexServerConfig.enabled ?? plexDefaults.enabled;
        document.getElementById('mediaServers[0].hostname').value =
            nEnv.PLEX_HOSTNAME ?? env.PLEX_HOSTNAME ?? plexDefaults.hostname;
        document.getElementById('mediaServers[0].port').value =
            nEnv.PLEX_PORT ?? env.PLEX_PORT ?? plexDefaults.port;
        // For security, don't display the token. Show a placeholder if it's set.
        const tokenInput = document.getElementById('mediaServers[0].token');
        tokenInput.value = ''; // Always clear the value on load
        // env.PLEX_TOKEN is now a boolean indicating if the token is set on the server
        const tokenIsSet = nEnv.PLEX_TOKEN || env.PLEX_TOKEN === true;
        tokenInput.dataset.tokenSet = tokenIsSet ? 'true' : 'false';
        tokenInput.placeholder = tokenIsSet ? '******** (token stored)' : 'Enter new token...';

        const savedMovieLibs = plexServerConfig.movieLibraryNames || plexDefaults.movieLibraryNames;
        const savedShowLibs = plexServerConfig.showLibraryNames || plexDefaults.showLibraryNames;

        // Removed movie/show count inputs from UI

        // Content Filtering settings
        document.getElementById('mediaServers[0].ratingFilter').value =
            plexServerConfig.ratingFilter ?? plexDefaults.ratingFilter;

        // Load genres first, then set selected values
        await loadPlexGenres();
        setGenreFilterValues(plexServerConfig.genreFilter ?? plexDefaults.genreFilter);

        document.getElementById('mediaServers[0].recentlyAddedOnly').checked =
            plexServerConfig.recentlyAddedOnly ?? plexDefaults.recentlyAddedOnly;
        document.getElementById('mediaServers[0].recentlyAddedDays').value =
            plexServerConfig.recentlyAddedDays ?? plexDefaults.recentlyAddedDays;
        document.getElementById('mediaServers[0].qualityFilter').value =
            plexServerConfig.qualityFilter ?? plexDefaults.qualityFilter;

        return { savedMovieLibs, savedShowLibs };
    }

    async function populateJellyfinSettings(config, defaults, env) {
        // Prefer normalized env if available
        const nEnv = window.__normalizedEnv || {};
        const jellyfinServerConfig =
            config.mediaServers && config.mediaServers[1] ? config.mediaServers[1] : {};
        const jellyfinDefaults = defaults.mediaServers[1] || {
            enabled: false,
            hostname: '',
            port: 8096,
            movieLibraryNames: [],
            showLibraryNames: [],
            ratingFilter: '',
            genreFilter: '',
            recentlyAddedOnly: false,
            recentlyAddedDays: 30,
            qualityFilter: '',
        };

        document.getElementById('mediaServers[1].enabled').checked =
            jellyfinServerConfig.enabled ?? jellyfinDefaults.enabled;
        document.getElementById('mediaServers[1].hostname').value =
            nEnv.JELLYFIN_HOSTNAME ?? env.JELLYFIN_HOSTNAME ?? jellyfinDefaults.hostname;
        document.getElementById('mediaServers[1].port').value =
            nEnv.JELLYFIN_PORT ?? env.JELLYFIN_PORT ?? jellyfinDefaults.port;

        // For security, don't display the API key. Show a placeholder if it's set.
        const apiKeyInput = document.getElementById('mediaServers[1].apiKey');
        apiKeyInput.value = ''; // Always clear the value on load
        // env.JELLYFIN_API_KEY is now a boolean indicating if the API key is set on the server
        const apiKeyIsSet = nEnv.JELLYFIN_API_KEY || env.JELLYFIN_API_KEY === true;
        apiKeyInput.dataset.tokenSet = apiKeyIsSet ? 'true' : 'false';
        apiKeyInput.placeholder = apiKeyIsSet
            ? '******** (API key stored)'
            : 'Enter new API key...';

        const savedMovieLibs =
            jellyfinServerConfig.movieLibraryNames || jellyfinDefaults.movieLibraryNames;
        const savedShowLibs =
            jellyfinServerConfig.showLibraryNames || jellyfinDefaults.showLibraryNames;

        // Content Filtering settings - handle both string and array values
        const ratingFilterValue =
            jellyfinServerConfig.ratingFilter ?? jellyfinDefaults.ratingFilter;
        const ratingFilterElement = document.getElementById('mediaServers[1].ratingFilter');
        const ratingFilterHidden = document.getElementById('mediaServers[1].ratingFilter-hidden');

        if (ratingFilterElement) {
            if (ratingFilterElement.tagName === 'SELECT') {
                // Traditional select dropdown
                ratingFilterElement.value = ratingFilterValue;
            } else if (
                ratingFilterElement.classList.contains('multi-select-checkboxes') &&
                ratingFilterHidden
            ) {
                // Multi-select checkboxes - set hidden field value
                if (Array.isArray(ratingFilterValue)) {
                    ratingFilterHidden.value = ratingFilterValue.join(',');
                } else {
                    ratingFilterHidden.value = ratingFilterValue || '';
                }
            }
        }

        // Load genres only if we have basic connection details configured
        const hostname =
            nEnv.JELLYFIN_HOSTNAME ?? env.JELLYFIN_HOSTNAME ?? jellyfinDefaults.hostname;
        const port = nEnv.JELLYFIN_PORT ?? env.JELLYFIN_PORT ?? jellyfinDefaults.port;
        const hasBasicConfig = hostname && port;

        try {
            if (hasBasicConfig) {
                // Load libraries first with saved selections
                await fetchAndDisplayJellyfinLibraries(savedMovieLibs, savedShowLibs);

                // Then load genres
                await loadJellyfinGenres();
                setJellyfinGenreFilterValues(
                    jellyfinServerConfig.genreFilter ?? jellyfinDefaults.genreFilter
                );
            } else {
                // Just set up the default option without loading
                const genreSelect = document.getElementById('mediaServers[1].genreFilter');
                if (genreSelect) {
                    genreSelect.innerHTML =
                        '<option value="">Configure Jellyfin connection to load genres</option>';
                }
            }
        } catch (error) {
            logger.warn('Failed to load Jellyfin libraries/genres during setup:', error);
        }

        document.getElementById('mediaServers[1].recentlyAddedOnly').checked =
            jellyfinServerConfig.recentlyAddedOnly ?? jellyfinDefaults.recentlyAddedOnly;
        document.getElementById('mediaServers[1].recentlyAddedDays').value =
            jellyfinServerConfig.recentlyAddedDays ?? jellyfinDefaults.recentlyAddedDays;
        document.getElementById('mediaServers[1].qualityFilter').value =
            jellyfinServerConfig.qualityFilter ?? jellyfinDefaults.qualityFilter;

        return { savedMovieLibs, savedShowLibs };
    }

    function setJellyfinGenreFilterValues(genreFilterString) {
        const hiddenField = document.getElementById('mediaServers[1].genreFilter-hidden');
        if (!hiddenField) return;

        // Set the hidden field value
        hiddenField.value = genreFilterString || '';

        // Update checkboxes if they exist
        const genreContainer = document.getElementById('mediaServers[1].genreFilter');
        if (genreContainer) {
            const selectedGenres = genreFilterString
                ? genreFilterString
                      .split(',')
                      .map(g => g.trim())
                      .filter(g => g)
                : [];

            const checkboxes = genreContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = selectedGenres.includes(checkbox.value);
            });
        }
    }

    async function loadPlexGenres() {
        const genreContainer = document.getElementById('mediaServers[0].genreFilter');
        if (!genreContainer) return;

        // Get current value from hidden field
        const hiddenField = document.getElementById('mediaServers[0].genreFilter-hidden');
        const currentValue = hiddenField ? hiddenField.value : '';

        try {
            // Show loading state
            genreContainer.innerHTML = '<div class="loading-indicator">Loading genres...</div>';

            // Get connection parameters for testing (same as libraries)
            const hostname = document.getElementById('mediaServers[0].hostname').value;
            const port = document.getElementById('mediaServers[0].port').value;
            const token = document.getElementById('mediaServers[0].token').value;

            // If we have test parameters, use the test endpoint with counts, otherwise use the regular endpoint with counts
            let response;
            if (hostname && port) {
                response = await fetch('/api/admin/plex-genres-with-counts-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        hostname: hostname || undefined,
                        port: port || undefined,
                        token: token || undefined,
                    }),
                });
            } else {
                response = await fetch('/api/admin/plex-genres-with-counts');
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch genres: ${response.status}`);
            }

            const data = await response.json();
            const genres = data.genres || [];

            // Use the new checkbox population function with counts
            populateGenreFilterCheckboxes(genres, genreContainer, currentValue);
        } catch (error) {
            console.error('Error loading Plex genres:', error);
            genreContainer.innerHTML = '<div class="loading-indicator">Error loading genres</div>';
        }
    }

    function setGenreFilterValues(genreFilterString) {
        const hiddenField = document.getElementById('mediaServers[0].genreFilter-hidden');
        if (!hiddenField) return;

        // Set the hidden field value
        hiddenField.value = genreFilterString || '';

        // Update checkboxes if they exist
        const genreContainer = document.getElementById('mediaServers[0].genreFilter');
        if (genreContainer) {
            const selectedGenres = genreFilterString
                ? genreFilterString
                      .split(',')
                      .map(g => g.trim())
                      .filter(g => g)
                : [];

            const checkboxes = genreContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = selectedGenres.includes(checkbox.value);
            });
        }
    }

    function getGenreFilterValues() {
        const hiddenField = document.getElementById('mediaServers[0].genreFilter-hidden');
        return hiddenField ? hiddenField.value : '';
    }

    function getJellyfinGenreFilterValues() {
        const hiddenField = document.getElementById('mediaServers[1].genreFilter-hidden');
        return hiddenField ? hiddenField.value : '';
    }

    // Make loadPlexGenres globally accessible
    window.loadPlexGenres = loadPlexGenres;

    /**
     * Loads and populates Jellyfin genres in the genre filter dropdown
     */
    async function loadJellyfinGenres() {
        const genreContainer = document.getElementById('mediaServers[1].genreFilter');
        if (!genreContainer) {
            logger.warn('[Admin] loadJellyfinGenres: genre container element not found');
            return;
        }

        // Get current value from hidden field
        const hiddenField = document.getElementById('mediaServers[1].genreFilter-hidden');
        const currentValue = hiddenField ? hiddenField.value : '';

        try {
            const hostname = document.getElementById('mediaServers[1].hostname').value;
            const port = document.getElementById('mediaServers[1].port').value;
            const apiKeyInput = document.getElementById('mediaServers[1].apiKey');
            const apiKey = apiKeyInput.value;
            const apiKeyIsSet = apiKeyInput.dataset.tokenSet === 'true';
            const movieLibraries = getSelectedJellyfinLibraries('movie');
            const showLibraries = getSelectedJellyfinLibraries('show');

            // If no connection details, show default message without error
            // For API key, check if it's set in dataset OR if a new value is provided
            if (!hostname || !port || (!apiKey && !apiKeyIsSet)) {
                genreContainer.innerHTML =
                    '<div class="loading-indicator">Configure Jellyfin connection to load genres</div>';
                return;
            }

            // Show loading state only when we have connection details
            genreContainer.innerHTML = '<div class="loading-indicator">Loading genres...</div>';

            if (movieLibraries.length === 0 && showLibraries.length === 0) {
                genreContainer.innerHTML =
                    '<div class="loading-indicator">No libraries selected</div>';
                return;
            }

            const response = await fetch('/api/admin/jellyfin-genres-with-counts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hostname,
                    port,
                    apiKey: apiKey || null, // Send null if no new key provided
                    movieLibraries,
                    showLibraries,
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Failed to load genres');
            }

            const genres = result.genres || [];

            // Use the new checkbox population function with counts
            populateGenreFilterCheckboxes(genres, genreContainer, currentValue);

            logger.info(`[Admin] Loaded ${genres.length} Jellyfin genres successfully`);
        } catch (error) {
            logger.error('[Admin] Failed to load Jellyfin genres:', error);
            genreContainer.innerHTML = '<div class="loading-indicator">Error loading genres</div>';
            // Only show notification if user actually has connection details configured
            const hostname = document.getElementById('mediaServers[1].hostname').value;
            const port = document.getElementById('mediaServers[1].port').value;
            const apiKey = document.getElementById('mediaServers[1].apiKey').value;

            if (hostname && port && apiKey) {
                showNotification(`Failed to load Jellyfin genres: ${error.message}`, 'error');
            }
        }
    }

    // Make loadJellyfinGenres globally accessible
    window.loadJellyfinGenres = loadJellyfinGenres;

    // TMDB Genre Loading Function
    async function loadTmdbGenres() {
        const genreContainer = document.getElementById('tmdbSource.genreFilter');
        if (!genreContainer) {
            logger.warn('[Admin] loadTmdbGenres: genre container element not found');
            return;
        }

        try {
            genreContainer.innerHTML = '<div class="loading-indicator">Loading genres...</div>';

            const response = await fetch('/api/admin/tmdb-genres');
            if (!response.ok) {
                throw new Error(`Failed to fetch TMDB genres: ${response.status}`);
            }

            const data = await response.json();
            const genres = data.genres || [];

            // Get current value from hidden field
            const hiddenField = document.getElementById('tmdbSource.genreFilter-hidden');
            const currentValue = hiddenField ? hiddenField.value : '';

            // Use the checkbox population function
            populateGenreFilterCheckboxes(genres, genreContainer, currentValue);
        } catch (error) {
            console.error('Error loading TMDB genres:', error);
            genreContainer.innerHTML = '<div class="loading-indicator">Error loading genres</div>';
        }
    }

    // Make loadTmdbGenres globally accessible
    window.loadTmdbGenres = loadTmdbGenres;

    function populateTMDBSettings(config) {
        const tmdbConfig = config.tmdbSource || {};
        const tmdbDefaults = {
            enabled: false,
            apiKey: '',
            category: 'popular',
            movieCount: 50,
            showCount: 25,
            minRating: 0,
            yearFilter: null,
        };

        // Populate TMDB form fields
        const enabledField = document.getElementById('tmdbSource.enabled');
        const apiKeyField = document.getElementById('tmdbSource.apiKey');
        const categoryField = document.getElementById('tmdbSource.category');
        // Removed TMDB count inputs
        const minRatingField = document.getElementById('tmdbSource.minRating');
        const yearFilterField = document.getElementById('tmdbSource.yearFilter');

        if (enabledField) enabledField.checked = tmdbConfig.enabled ?? tmdbDefaults.enabled;
        if (apiKeyField) {
            // For security, don't display the API key. Show a placeholder if it's set.
            apiKeyField.value = '';
            const apiKeyIsSet = tmdbConfig.apiKey && tmdbConfig.apiKey.length > 0;
            apiKeyField.placeholder = apiKeyIsSet
                ? '******** (API key stored)'
                : 'Enter TMDB API key...';
            apiKeyField.dataset.apiKeySet = apiKeyIsSet ? 'true' : 'false';
        }
        if (categoryField) categoryField.value = tmdbConfig.category ?? tmdbDefaults.category;

        if (minRatingField) minRatingField.value = tmdbConfig.minRating ?? tmdbDefaults.minRating;
        if (yearFilterField) yearFilterField.value = tmdbConfig.yearFilter || '';

        // Load TMDB genres and set selected values
        if (tmdbConfig.enabled && tmdbConfig.apiKey) {
            loadTMDBGenres().then(() => {
                setTMDBGenreFilterValues(tmdbConfig.genreFilter || '');
            });
        }

        // Setup TMDB test button
        setupTMDBTestButton();

        // Setup Streaming configuration
        populateStreamingSettings(config);

        // Setup TVDB configuration
        const tvdbConfig = config.tvdbSource || {};
        const tvdbEnabledField = document.getElementById('tvdbSource.enabled');
        const tvdbCategoryField = document.getElementById('tvdbSource.category');
        // Removed TVDB count inputs
        const tvdbMinRatingField = document.getElementById('tvdbSource.minRating');
        const tvdbYearFilterField = document.getElementById('tvdbSource.yearFilter');

        if (tvdbEnabledField) tvdbEnabledField.checked = tvdbConfig.enabled || false;
        if (tvdbCategoryField) tvdbCategoryField.value = tvdbConfig.category || 'popular';

        if (tvdbMinRatingField) tvdbMinRatingField.value = tvdbConfig.minRating || 0;
        if (tvdbYearFilterField) tvdbYearFilterField.value = tvdbConfig.yearFilter || '';
    }

    // Updated TMDB Genre Functions (use new checkbox system)
    async function loadTMDBGenres() {
        return await loadTmdbGenres();
    }

    // Make loadTMDBGenres globally accessible
    window.loadTMDBGenres = loadTMDBGenres;

    function setTMDBGenreFilterValues(genreFilterString) {
        const hiddenField = document.getElementById('tmdbSource.genreFilter-hidden');
        if (!hiddenField) return;

        hiddenField.value = genreFilterString || '';

        const genreContainer = document.getElementById('tmdbSource.genreFilter');
        if (genreContainer) {
            const selectedGenres = genreFilterString
                ? genreFilterString
                      .split(',')
                      .map(g => g.trim())
                      .filter(g => g)
                : [];

            const checkboxes = genreContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = selectedGenres.includes(checkbox.value);
            });
        }
    }

    // Genre Filter Value Functions for Form Submission
    function getTMDBGenreFilterValues() {
        const hiddenField = document.getElementById('tmdbSource.genreFilter-hidden');
        return hiddenField ? hiddenField.value : '';
    }

    function setupTMDBTestButton() {
        const testButton = document.getElementById('test-tmdb-button');
        const statusElement = document.getElementById('tmdb-connection-status');

        if (!testButton) return;

        testButton.addEventListener('click', async () => {
            const apiKeyField = document.getElementById('tmdbSource.apiKey');
            const categoryField = document.getElementById('tmdbSource.category');

            // Check if API key is entered or already stored
            let apiKey = apiKeyField?.value?.trim() || '';
            const isApiKeyStored = apiKeyField?.dataset?.apiKeySet === 'true';
            const category = categoryField?.value || 'popular';

            // If no API key entered but one is stored, use a placeholder to indicate we should test with stored key
            if (!apiKey && isApiKeyStored) {
                apiKey = 'stored_key'; // This will trigger the server to use the stored key
            }

            if (!apiKey && !isApiKeyStored) {
                showNotification('Please enter an API key first.', 'error');
                return;
            }

            // Show loading state
            testButton.disabled = true;
            testButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            if (statusElement) {
                const keySource =
                    isApiKeyStored && !apiKeyField?.value?.trim()
                        ? 'stored API key'
                        : 'provided API key';
                statusElement.textContent = `Testing TMDB connection with ${keySource}...`;
                statusElement.style.color = '#ffd93d';
            }

            try {
                const response = await fetch('/api/admin/test-tmdb', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey, category }),
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    if (statusElement) {
                        statusElement.textContent = `✅ Connection successful! Found ${result.count || 0} ${category} items.`;
                        statusElement.style.color = '#51cf66';
                    }

                    // Automatically load TMDB genres after successful connection
                    try {
                        await loadTMDBGenres();
                        showNotification('TMDB connection successful and genres loaded', 'success');
                    } catch (genreError) {
                        logger.warn('Failed to load TMDB genres:', genreError);
                        showNotification(
                            'TMDB connection successful, but genres could not be loaded',
                            'error'
                        );
                    }
                } else {
                    if (statusElement) {
                        statusElement.textContent = `❌ Connection failed: ${result.error || 'Unknown error'}`;
                        statusElement.style.color = '#ff6b6b';
                    }
                    showNotification(
                        `TMDB connection failed: ${result.error || 'Unknown error'}`,
                        'error'
                    );
                }
            } catch (error) {
                if (statusElement) {
                    statusElement.textContent = `❌ Test failed: ${error.message}`;
                    statusElement.style.color = '#ff6b6b';
                }
                showNotification(`TMDB connection failed: ${error.message}`, 'error');
            } finally {
                // Restore button state
                testButton.disabled = false;
                testButton.innerHTML =
                    '<i class="fas fa-plug icon"></i><span>Test TMDB Connection</span>';
            }
        });
    }

    function populateStreamingSettings(config) {
        const streamingConfig = config.streamingSources || {};
        const streamingDefaults = {
            enabled: false,
            region: 'US',
            maxItems: 20,
            minRating: 6.0,
            netflix: false,
            disney: false,
            prime: false,
            hbo: false,
        };
        const enabledField = document.getElementById('streamingSources.enabled');
        const regionField = document.getElementById('streamingSources.region');
        const minRatingField = document.getElementById('streamingSources.minRating');
        const netflixField = document.getElementById('streamingSources.netflix');
        const disneyField = document.getElementById('streamingSources.disney');
        const primeField = document.getElementById('streamingSources.prime');
        const hboField = document.getElementById('streamingSources.hbo');
        const newReleasesField = document.getElementById('streamingSources.newReleases');

        if (enabledField)
            enabledField.checked = streamingConfig.enabled ?? streamingDefaults.enabled;
        if (regionField) regionField.value = streamingConfig.region ?? streamingDefaults.region;

        if (minRatingField)
            minRatingField.value = streamingConfig.minRating ?? streamingDefaults.minRating;

        // Set provider checkboxes
        if (netflixField)
            netflixField.checked = streamingConfig.netflix ?? streamingDefaults.netflix;
        if (disneyField) disneyField.checked = streamingConfig.disney ?? streamingDefaults.disney;
        if (primeField) primeField.checked = streamingConfig.prime ?? streamingDefaults.prime;
        if (hboField) hboField.checked = streamingConfig.hbo ?? streamingDefaults.hbo;
        if (newReleasesField)
            newReleasesField.checked = streamingConfig.newReleases ?? streamingDefaults.newReleases;

        // Setup streaming test button
        setupStreamingTestButton();
    }

    function setupStreamingTestButton() {
        const testButton = document.getElementById('test-streaming-button');
        if (!testButton) return;

        testButton.addEventListener('click', async () => {
            const statusElement = document.getElementById('streaming-connection-status');

            // Disable button and show loading state
            testButton.disabled = true;
            testButton.innerHTML =
                '<i class="fas fa-spinner fa-spin icon"></i><span>Testing...</span>';

            if (statusElement) {
                statusElement.textContent = 'Testing streaming connection...';
                statusElement.style.color = '#94a3b8';
            }

            try {
                // Get streaming configuration
                const enabledField = document.getElementById('streamingSources.enabled');
                const regionField = document.getElementById('streamingSources.region');

                if (!enabledField?.checked) {
                    if (statusElement) {
                        statusElement.textContent = '⚠️ Streaming sources are disabled';
                        statusElement.style.color = '#f59e0b';
                    }
                    return;
                }

                const region = regionField?.value || 'US';

                // Check if TMDB API key is available (streaming uses TMDB)
                const apiKeyField = document.getElementById('tmdbSource.apiKey');
                const isApiKeyStored = apiKeyField?.dataset?.apiKeySet === 'true';
                const apiKey = apiKeyField?.value?.trim() || '';

                if (!apiKey && !isApiKeyStored) {
                    showNotification('Please enter a TMDB API key first.', 'error');
                    return;
                }

                // Test TMDB API (streaming uses TMDB)
                const response = await fetch('/api/admin/test-tmdb', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        testType: 'streaming',
                        region: region,
                        apiKey: 'stored_key',
                    }),
                });

                const result = await response.json();

                if (result.success) {
                    if (statusElement) {
                        statusElement.textContent = `✅ Streaming API ready! Region: ${region}`;
                        statusElement.style.color = '#51cf66';
                    }
                    showNotification(
                        `Streaming connection successful! Region: ${region}`,
                        'success'
                    );
                } else {
                    if (statusElement) {
                        statusElement.textContent = `❌ Connection failed: ${result.error || 'Unknown error'}`;
                        statusElement.style.color = '#ff6b6b';
                    }
                    showNotification(
                        `Streaming connection failed: ${result.error || 'Unknown error'}`,
                        'error'
                    );
                }
            } catch (error) {
                if (statusElement) {
                    statusElement.textContent = `❌ Test failed: ${error.message}`;
                    statusElement.style.color = '#ff6b6b';
                }
                showNotification(`Streaming test failed: ${error.message}`, 'error');
            } finally {
                // Restore button state
                testButton.disabled = false;
                testButton.innerHTML =
                    '<i class="fas fa-stream icon"></i><span>Test Streaming Connection</span>';
            }
        });
    }

    async function loadConfig() {
        try {
            const response = await authenticatedFetch(apiUrlWithCacheBust('/api/admin/config'));
            if (!response.ok) {
                throw new Error(
                    `Could not load configuration from the server. Status: ${response.status} ${response.statusText}`
                );
            }
            const { config = {}, env = {}, security = {}, server = {} } = await response.json();

            // Make config globally available for rating filter checks
            window.currentConfig = config;

            populateGeneralSettings(config, env, defaults);
            populateDisplaySettings(config, defaults);
            setupDisplaySettingListeners();
            // (preview timers removed)
            setupCinemaModeListeners();
            setupWallartModeListeners();
            populateSecuritySettings(security);
            const { savedMovieLibs, savedShowLibs } = await populatePlexSettings(
                config,
                env,
                defaults
            );
            window.__savedMovieLibs = savedMovieLibs;
            window.__savedShowLibs = savedShowLibs;

            // Populate Jellyfin settings
            try {
                const { savedMovieLibs: jellyfinMovieLibs, savedShowLibs: jellyfinShowLibs } =
                    await populateJellyfinSettings(config, defaults, env);
                window.__savedJellyfinMovieLibs = jellyfinMovieLibs;
                window.__savedJellyfinShowLibs = jellyfinShowLibs;
            } catch (error) {
                logger.warn('Failed to populate Jellyfin settings:', error);
            }

            // Populate TMDB settings
            populateTMDBSettings(config, env, defaults);

            // Pass server info to site server settings
            populateSiteServerSettings(config, server);

            // If Plex is configured, fetch libraries and start background slideshow
            const nEnv = window.__normalizedEnv || {};
            const isNonEmpty = v =>
                v !== undefined &&
                v !== null &&
                String(v).trim() !== '' &&
                String(v).toLowerCase() !== 'null' &&
                String(v).toLowerCase() !== 'undefined';
            const hasPlexHost = isNonEmpty(nEnv.PLEX_HOSTNAME ?? env.PLEX_HOSTNAME);
            const rawPort = nEnv.PLEX_PORT ?? env.PLEX_PORT;
            const portNum = Number(rawPort);
            // Accept only numeric port within valid range (1-65535). Port '0' is invalid for Plex.
            const hasPlexPort = Number.isFinite(portNum) && portNum >= 1 && portNum <= 65535;
            const rawToken = nEnv.PLEX_TOKEN !== undefined ? nEnv.PLEX_TOKEN : env.PLEX_TOKEN;
            const hasPlexToken =
                rawToken === true ||
                rawToken === 'true' ||
                (typeof rawToken === 'string' && rawToken.length > 0);
            window.__plexReady = hasPlexHost && hasPlexPort && hasPlexToken;
            if (!window.__plexReady) {
                const missing = [];
                if (!hasPlexHost) missing.push('PLEX_HOSTNAME');
                if (!hasPlexPort) missing.push('PLEX_PORT(valid)');
                if (!hasPlexToken) missing.push('PLEX_TOKEN');
                if (missing.length < 3)
                    logger.warn('Plex not initialized — missing:', missing.join(', '));
            } else {
                // Load Plex libraries immediately when config is loaded
                const movieContainer = document.getElementById('movie-libraries-container');
                const showContainer = document.getElementById('show-libraries-container');
                if (movieContainer)
                    movieContainer.innerHTML = '<small>Loading libraries...</small>';
                if (showContainer) showContainer.innerHTML = '<small>Loading libraries...</small>';

                // Load libraries with saved selections - only if Plex is properly configured
                setTimeout(() => {
                    try {
                        const hostname = document.getElementById('mediaServers[0].hostname')?.value;
                        const port = document.getElementById('mediaServers[0].port')?.value;
                        const tokenInput = document.getElementById('mediaServers[0].token');
                        const tokenIsSet = tokenInput?.dataset.tokenSet === 'true';

                        // Only fetch libraries if we have valid Plex configuration
                        if (hostname && hostname.trim() && port && port.trim() && tokenIsSet) {
                            fetchAndDisplayPlexLibraries(
                                window.__savedMovieLibs || [],
                                window.__savedShowLibs || []
                            );
                        } else {
                            // Show placeholder message instead of trying to connect
                            if (movieContainer)
                                movieContainer.innerHTML =
                                    '<small>Configure Plex connection to load libraries</small>';
                            if (showContainer)
                                showContainer.innerHTML =
                                    '<small>Configure Plex connection to load libraries</small>';
                        }
                        window.__mediaLazyLoaded = true; // Mark as loaded
                    } catch (e) {
                        // ignore
                        if (movieContainer)
                            movieContainer.innerHTML = '<small>Failed to load libraries</small>';
                        if (showContainer)
                            showContainer.innerHTML = '<small>Failed to load libraries</small>';
                    }
                }, 100);
            }

            // Forcefully remove focus from any element that the browser might have auto-focused.
            if (document.activeElement) document.activeElement.blur();

            // Always initialize fanart background regardless of active section
            initializeAdminBackground();

            // Initialize dynamic rating filters now that config is loaded
            if (typeof initDynamicRatingFilters === 'function') {
                initDynamicRatingFilters();
            }
            if (typeof initDynamicGenreFilters === 'function') {
                initDynamicGenreFilters();
            }
            if (typeof initDynamicQualityFilters === 'function') {
                initDynamicQualityFilters();
            }

            // Initialize conditional visibility after config is loaded
            if (typeof initSourceConditionalVisibility === 'function') {
                initSourceConditionalVisibility();
            }

            // After the UI has been fully populated, capture a fresh baseline
            // so restart detection compares against the actual loaded values.
            try {
                if (typeof captureFormState === 'function') {
                    originalConfigValues = captureFormState();
                }
            } catch (e) {
                // ignore
                logger && logger.warn && logger.warn('Could not capture baseline form state', e);
            }
        } catch (error) {
            console.error('Failed to load config:', error);
            showNotification('Failed to load settings. Please try refreshing the page.', 'error');
        }
    }

    /**
     * Initializes and starts the admin background slideshow.
     * Fetches the media list if not already present and starts a timer.
     */
    async function initializeAdminBackground() {
        // Clear any existing timer
        if (adminBgTimer) {
            clearInterval(adminBgTimer);
            adminBgTimer = null;
        }

        // Initialize layers
        if (!activeAdminLayer) {
            activeAdminLayer = document.getElementById('admin-background-a');
            inactiveAdminLayer = document.getElementById('admin-background-b');
        }

        if (!activeAdminLayer || !inactiveAdminLayer) {
            logger.warn('Admin background layers not found');
            return;
        }

        // Reset layers
        activeAdminLayer.style.opacity = 0;
        inactiveAdminLayer.style.opacity = 0;
        activeAdminLayer.style.backgroundImage = '';
        inactiveAdminLayer.style.backgroundImage = '';

        if (adminBgQueue.length === 0) {
            try {
                const response = await fetch(`/get-media?_=${Date.now()}`);
                if (!response.ok) {
                    logger.warn(
                        'Could not fetch media for admin background, server might be starting up.'
                    );
                    setGradientBackground();
                    return;
                }
                adminBgQueue = await response.json();
                if (adminBgQueue.length === 0) {
                    logger.warn('Admin background queue is empty. Using gradient background.');
                    setGradientBackground();
                    return;
                }
                // Start at random index instead of -1 for random fanart on refresh
                adminBgIndex = Math.floor(Math.random() * adminBgQueue.length) - 1;
            } catch (error) {
                logger.warn('Failed to fetch admin background media:', error);
                setGradientBackground();
                return;
            }
        }

        if (defaults.DEBUG)
            logger.debug(`[AdminBG] Starting slideshow with ${adminBgQueue.length} images`);

        // Show first image immediately
        changeAdminBackground();

        // Set up regular interval
        adminBgTimer = setInterval(changeAdminBackground, 30000); // Change every 30 seconds
    }

    /**
     * Changes the background image on the admin page with a fade effect.
     */
    function changeAdminBackground() {
        if (!defaults.DEBUG) {
            // Light heartbeat every few cycles only
            if (adminBgIndex % 10 === 0 && defaults.DEBUG) console.debug('[AdminBG] rotate');
        } else {
            if (defaults.DEBUG) logger.debug('[AdminBG] tick');
        }

        if (adminBgQueue.length === 0 || !activeAdminLayer || !inactiveAdminLayer) {
            return;
        }

        adminBgIndex = (adminBgIndex + 1) % adminBgQueue.length;
        const currentItem = adminBgQueue[adminBgIndex];

        if (defaults.DEBUG) {
            // Debug background index change
        }

        if (!currentItem || !currentItem.backgroundUrl) {
            return;
        }

        if (defaults.DEBUG) {
            // Debug background change
        }

        // Log current layer states
        if (defaults.DEBUG) {
            logger.debug('[AdminBG] BEFORE', {
                activeOpacity: window.getComputedStyle(activeAdminLayer).opacity,
                inactiveOpacity: window.getComputedStyle(inactiveAdminLayer).opacity,
            });
        }

        const img = new Image();
        img.onload = () => {
            if (defaults.DEBUG) logger.debug('[AdminBG] image loaded');

            // Show the overlay again when fanart is available (it darkens the fanart for better readability)
            const overlay = document.querySelector('.admin-background-overlay');
            if (overlay) {
                overlay.style.opacity = '1';
                if (defaults.DEBUG) logger.debug('Admin background overlay restored for fanart');
            }

            // Set new image on inactive layer and make it visible
            inactiveAdminLayer.style.backgroundImage = `url('${currentItem.backgroundUrl}')`;
            inactiveAdminLayer.style.opacity = 0;

            if (defaults.DEBUG) logger.debug('[AdminBG] inactive layer prepared');

            // Start fade transition immediately
            setTimeout(() => {
                if (defaults.DEBUG) logger.debug('[AdminBG] fade start');

                // Fade out current active layer
                activeAdminLayer.style.opacity = 0;
                // Fade in new layer
                inactiveAdminLayer.style.opacity = 0.7;

                if (defaults.DEBUG) logger.debug('[AdminBG] transition props applied');

                // After transition, swap the layer references
                // The inactive layer (which now has the new image and is visible) becomes active
                setTimeout(() => {
                    if (defaults.DEBUG) logger.debug('[AdminBG] swapping layers');

                    const tempLayer = activeAdminLayer;
                    activeAdminLayer = inactiveAdminLayer; // The one with the new image becomes active
                    inactiveAdminLayer = tempLayer; // The old active becomes inactive

                    // DO NOT clear the background image - keep it for debugging
                    // inactiveAdminLayer.style.backgroundImage = 'none';

                    if (defaults.DEBUG)
                        logger.debug('[AdminBG] swap complete', {
                            active: activeAdminLayer.id,
                            inactive: inactiveAdminLayer.id,
                        });

                    // Log final states
                    if (defaults.DEBUG)
                        logger.debug('[AdminBG] AFTER', {
                            activeOpacity: window.getComputedStyle(activeAdminLayer).opacity,
                            inactiveOpacity: window.getComputedStyle(inactiveAdminLayer).opacity,
                        });
                }, 1100); // Wait a bit longer for CSS transition to complete
            }, 50); // Small delay to ensure image is set
        };

        img.onerror = () => {
            logger.warn(`Failed to load admin background image: ${currentItem.backgroundUrl}`);
            // Try next image
            setTimeout(() => {
                changeAdminBackground();
            }, 1000);
        };

        if (defaults.DEBUG) logger.debug('[AdminBG] loading image');
        img.src = currentItem.backgroundUrl;
    }

    /**
     * Sets a beautiful gradient background when no fanart is available
     */
    function setGradientBackground() {
        if (!activeAdminLayer || !inactiveAdminLayer) {
            logger.warn('Background layers not found for gradient');
            return;
        }

        // Use the same static gradient as the admin login for consistency
        const staticGradient =
            'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 25%, #16213e 50%, #0f3460 75%, #533483 100%)';

        // Clear any existing background images and animations
        activeAdminLayer.style.backgroundImage = staticGradient;
        inactiveAdminLayer.style.backgroundImage = '';

        // Ensure active layer is visible
        activeAdminLayer.style.opacity = '1';
        inactiveAdminLayer.style.opacity = '0';

        // Remove animation for a calm, stable background
        activeAdminLayer.style.backgroundSize = '100% 100%';
        activeAdminLayer.style.animation = 'none';

        // Hide the dark overlay when showing gradient fallback so it's clearly visible
        const overlay = document.querySelector('.admin-background-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
        }

        // Clear any existing rotation timer since we want a static background
        if (adminBgTimer) {
            clearInterval(adminBgTimer);
            adminBgTimer = null;
        }
    }

    /**
     * Adds a "Test Connection" button for the Plex server settings.
     */
    function addPlexTestButton() {
        const testButton = document.getElementById('test-plex-button');
        if (!testButton) return;

        testButton.addEventListener('click', async () => {
            const hostname = document.getElementById('mediaServers[0].hostname').value;
            const port = document.getElementById('mediaServers[0].port').value;
            const tokenInput = document.getElementById('mediaServers[0].token');
            const token = tokenInput.value;
            const isTokenSetOnServer = tokenInput.dataset.tokenSet === 'true';

            setButtonState(testButton, 'loading', { text: 'Testing...' });

            try {
                if (!hostname || !port) {
                    throw new Error('Hostname and port are required to run a test.');
                }
                if (!token && !isTokenSetOnServer) {
                    throw new Error(
                        'A new token is required to test the connection, as none is set yet.'
                    );
                }

                const response = await fetch('/api/admin/test-plex', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hostname, port, token: token || undefined }), // Send token only if it has a value
                });
                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Unknown error');
                }

                setButtonState(testButton, 'success', { text: 'Connection successful' });

                // Enable the "Refresh Media" button
                const refreshButton = document.getElementById('refresh-media-button');
                if (refreshButton) refreshButton.disabled = false;

                // On success, fetch and display libraries, preserving current selections
                const currentMovieLibs = getSelectedLibraries('movie');
                const currentShowLibs = getSelectedLibraries('show');
                fetchAndDisplayPlexLibraries(currentMovieLibs, currentShowLibs);

                // Load genres after successful connection test
                try {
                    await window.loadPlexGenres();
                    showNotification('Plex connection successful and genres loaded', 'success');
                } catch (genreError) {
                    logger.warn('Failed to load genres after connection test:', genreError);
                    showNotification(
                        'Plex connection successful, but genres could not be loaded',
                        'warning'
                    );
                }

                adminBgQueue = []; // Force a re-fetch of the media queue
                initializeAdminBackground();
            } catch (error) {
                setButtonState(testButton, 'error', { text: 'Connection failed' });
                showNotification(`Plex connection failed: ${error.message}`, 'error');

                // Disable the "Refresh Media" button
                const refreshButton = document.getElementById('refresh-media-button');
                if (refreshButton) refreshButton.disabled = true;
            }
            // Revert to original state after a delay
            setTimeout(() => {
                setButtonState(testButton, 'revert');
            }, 2500);
        });
    }

    addPlexTestButton();

    /**
     * Adds a "Test Connection" button for the Jellyfin server settings.
     */
    function addJellyfinTestButton() {
        const testButton = document.getElementById('test-jellyfin-button');
        if (!testButton) return;

        testButton.addEventListener('click', async () => {
            const hostname = document.getElementById('mediaServers[1].hostname').value;
            const port = document.getElementById('mediaServers[1].port').value;
            const apiKeyInput = document.getElementById('mediaServers[1].apiKey');
            const apiKey = apiKeyInput.value;
            const isApiKeySetOnServer = apiKeyInput.dataset.tokenSet === 'true';

            setButtonState(testButton, 'loading', { text: 'Testing...' });

            try {
                if (!hostname || !port) {
                    throw new Error('Hostname and port are required to run a test.');
                }
                if (!apiKey && !isApiKeySetOnServer) {
                    throw new Error(
                        'A new API key is required to test the connection, as none is set yet.'
                    );
                }

                const response = await fetch('/api/admin/test-jellyfin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hostname, port, apiKey: apiKey || undefined }), // Send API key only if it has a value
                });
                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Unknown error');
                }

                setButtonState(testButton, 'success', { text: 'Connection successful' });

                // On success, fetch and display libraries, preserving current selections
                const currentMovieLibs = getSelectedJellyfinLibraries('movie');
                const currentShowLibs = getSelectedJellyfinLibraries('show');
                await fetchAndDisplayJellyfinLibraries(currentMovieLibs, currentShowLibs);

                // Load genres after successful connection test and library population
                try {
                    await window.loadJellyfinGenres();
                    showNotification('Jellyfin connection successful and genres loaded', 'success');
                } catch (genreError) {
                    logger.warn('Failed to load genres after connection test:', genreError);
                    showNotification(
                        'Jellyfin connection successful, but genres could not be loaded',
                        'warning'
                    );
                }

                adminBgQueue = []; // Force a re-fetch of the media queue
                initializeAdminBackground();
            } catch (error) {
                setButtonState(testButton, 'error', { text: 'Connection failed' });
                showNotification(`Jellyfin connection failed: ${error.message}`, 'error');
            }
            // Revert to original state after a delay
            setTimeout(() => {
                setButtonState(testButton, 'revert');
            }, 2500);
        });
    }

    addJellyfinTestButton();

    /**
     * Fetches Plex libraries from the server and populates checkbox lists.
     * @param {string[]} preSelectedMovieLibs - Array of movie library names to pre-check.
     * @param {string[]} preSelectedShowLibs - Array of show library names to pre-check.
     */
    async function fetchAndDisplayPlexLibraries(
        preSelectedMovieLibs = [],
        preSelectedShowLibs = []
    ) {
        const movieContainer = document.getElementById('movie-libraries-container');
        const showContainer = document.getElementById('show-libraries-container');
        const refreshButton = document.getElementById('refresh-media-button');

        movieContainer.innerHTML = '<small>Fetching libraries...</small>';
        showContainer.innerHTML = '<small>Fetching libraries...</small>';

        try {
            const hostname = document.getElementById('mediaServers[0].hostname').value;
            const port = document.getElementById('mediaServers[0].port').value;
            const token = document.getElementById('mediaServers[0].token').value;

            const response = await fetch('/api/admin/plex-libraries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hostname: hostname || undefined,
                    port: port || undefined,
                    token: token || undefined,
                }),
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to fetch libraries.');

            const libraries = result.libraries || [];
            const movieLibraries = libraries.filter(lib => lib.type === 'movie');
            const showLibraries = libraries.filter(lib => lib.type === 'show');

            movieContainer.innerHTML = '';
            showContainer.innerHTML = '';

            if (movieLibraries.length === 0) {
                movieContainer.innerHTML = '<small>No movie libraries found.</small>';
            } else {
                movieLibraries.forEach(lib => {
                    const isChecked = preSelectedMovieLibs.includes(lib.name);
                    movieContainer.appendChild(
                        createLibraryCheckbox(lib.name, 'movie', isChecked, lib.itemCount)
                    );
                });
            }

            if (showLibraries.length === 0) {
                showContainer.innerHTML = '<small>No show libraries found.</small>';
            } else {
                showLibraries.forEach(lib => {
                    const isChecked = preSelectedShowLibs.includes(lib.name);
                    showContainer.appendChild(
                        createLibraryCheckbox(lib.name, 'show', isChecked, lib.itemCount)
                    );
                });
            }

            // Enable refresh button on successful library fetch
            if (refreshButton) refreshButton.disabled = false;
        } catch (error) {
            console.error('Failed to fetch Plex libraries:', error);
            const errorMessage = `<small class="error-text">Error: ${error.message}</small>`;
            movieContainer.innerHTML = errorMessage;
            showContainer.innerHTML = errorMessage;
            // Disable refresh button on failure
            if (refreshButton) refreshButton.disabled = true;
        }
    }

    function createLibraryCheckbox(name, type, isChecked, itemCount = 0) {
        const container = document.createElement('div');
        container.className = 'checkbox-group';
        const id = `lib-${type}-${name.replace(/\s+/g, '-')}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.name = `${type}Library`;
        input.value = name;
        input.checked = isChecked;

        // Add change listener to automatically load genres when a library is selected
        input.addEventListener('change', async () => {
            const hasAnyLibrarySelected =
                getSelectedLibraries('movie').length > 0 || getSelectedLibraries('show').length > 0;
            if (hasAnyLibrarySelected) {
                // Load genres immediately when a library is selected
                try {
                    await loadPlexGenres();
                    showNotification('Genres updated based on selected libraries', 'success');
                } catch (error) {
                    logger.warn('Failed to load genres after library selection:', error);
                }
            }
        });

        const label = document.createElement('label');
        label.htmlFor = id;

        // Create a span for the name and count
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;

        const countSpan = document.createElement('span');
        countSpan.className = 'count';
        countSpan.textContent = itemCount > 0 ? ` (${itemCount})` : '';

        label.appendChild(nameSpan);
        label.appendChild(countSpan);
        container.appendChild(input);
        container.appendChild(label);
        return container;
    }

    function getSelectedLibraries(type) {
        const container = document.getElementById(`${type}-libraries-container`);
        if (!container) {
            logger.warn(`[Admin] getSelectedLibraries: container not found for type='${type}'`);
            return [];
        }
        try {
            const checkedBoxes = container.querySelectorAll(`input[name="${type}Library"]:checked`);
            return Array.from(checkedBoxes).map(cb => cb.value);
        } catch (err) {
            console.error('[Admin] getSelectedLibraries failed:', err);
            return [];
        }
    }

    /**
     * Fetches Jellyfin libraries from the server and populates checkbox lists.
     * @param {string[]} preSelectedMovieLibs - Array of movie library names to pre-check.
     * @param {string[]} preSelectedShowLibs - Array of show library names to pre-check.
     */
    async function fetchAndDisplayJellyfinLibraries(
        preSelectedMovieLibs = [],
        preSelectedShowLibs = []
    ) {
        const movieContainer = document.getElementById('jellyfin-movie-libraries-container');
        const showContainer = document.getElementById('jellyfin-show-libraries-container');

        movieContainer.innerHTML = '<small>Fetching libraries...</small>';
        showContainer.innerHTML = '<small>Fetching libraries...</small>';

        try {
            const hostname = document.getElementById('mediaServers[1].hostname').value;
            const port = document.getElementById('mediaServers[1].port').value;
            const apiKey = document.getElementById('mediaServers[1].apiKey').value;

            const response = await fetch('/api/admin/jellyfin-libraries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hostname: hostname || undefined,
                    port: port || undefined,
                    apiKey: apiKey || undefined,
                }),
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to fetch libraries.');

            const libraries = result.libraries || [];
            const movieLibraries = libraries.filter(lib => lib.type === 'movie');
            const showLibraries = libraries.filter(lib => lib.type === 'show');

            movieContainer.innerHTML = '';
            showContainer.innerHTML = '';

            if (movieLibraries.length === 0) {
                movieContainer.innerHTML = '<small>No movie libraries found.</small>';
            } else {
                movieLibraries.forEach(lib => {
                    const isChecked = preSelectedMovieLibs.includes(lib.name);
                    movieContainer.appendChild(
                        createJellyfinLibraryCheckbox(lib.name, 'movie', isChecked, lib.itemCount)
                    );
                });
            }

            if (showLibraries.length === 0) {
                showContainer.innerHTML = '<small>No show libraries found.</small>';
            } else {
                showLibraries.forEach(lib => {
                    const isChecked = preSelectedShowLibs.includes(lib.name);
                    showContainer.appendChild(
                        createJellyfinLibraryCheckbox(lib.name, 'show', isChecked, lib.itemCount)
                    );
                });
            }
        } catch (error) {
            console.error('Failed to fetch Jellyfin libraries:', error);
            const errorMessage = `<small class="error-text">Error: ${error.message}</small>`;
            movieContainer.innerHTML = errorMessage;
            showContainer.innerHTML = errorMessage;
        }
    }

    function createJellyfinLibraryCheckbox(name, type, isChecked, itemCount = 0) {
        const container = document.createElement('div');
        container.className = 'checkbox-group';
        const id = `jellyfin-lib-${type}-${name.replace(/\s+/g, '-')}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.name = `jellyfin${type.charAt(0).toUpperCase() + type.slice(1)}Library`;
        input.value = name;
        input.checked = isChecked;

        // Add change listener to automatically load genres when a library is selected
        input.addEventListener('change', async () => {
            const hasAnyLibrarySelected =
                getSelectedJellyfinLibraries('movie').length > 0 ||
                getSelectedJellyfinLibraries('show').length > 0;
            if (hasAnyLibrarySelected) {
                // Load genres immediately when a library is selected
                try {
                    await loadJellyfinGenres();
                    showNotification(
                        'Jellyfin genres updated based on selected libraries',
                        'success'
                    );
                } catch (error) {
                    logger.warn('Failed to load Jellyfin genres after library selection:', error);
                }
            }
        });

        const label = document.createElement('label');
        label.htmlFor = id;

        // Create a span for the name and count
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;

        const countSpan = document.createElement('span');
        countSpan.className = 'count';
        countSpan.textContent = itemCount > 0 ? ` (${itemCount})` : '';

        label.appendChild(nameSpan);
        label.appendChild(countSpan);
        container.appendChild(input);
        container.appendChild(label);
        return container;
    }

    function getSelectedJellyfinLibraries(type) {
        const container = document.getElementById(`jellyfin-${type}-libraries-container`);
        if (!container) {
            logger.warn(
                `[Admin] getSelectedJellyfinLibraries: container not found for type='${type}'`
            );
            return [];
        }
        try {
            const checkedBoxes = container.querySelectorAll(
                `input[name="jellyfin${type.charAt(0).toUpperCase() + type.slice(1)}Library"]:checked`
            );
            return Array.from(checkedBoxes).map(cb => cb.value);
        } catch (err) {
            console.error('[Admin] getSelectedJellyfinLibraries failed:', err);
            return [];
        }
    }

    // --- 2FA Management ---

    const twoFaCheckbox = document.getElementById('enable2FA');
    const twoFaStatusText = document.getElementById('2fa-status-text');
    const twoFaModal = document.getElementById('2fa-modal');
    const twoFaVerifyForm = document.getElementById('2fa-verify-form');
    const cancel2faButton = document.getElementById('cancel-2fa-button');
    const qrCodeContainer = document.getElementById('qr-code-container');

    // New elements for the disable modal
    const disable2FAModal = document.getElementById('disable-2fa-modal');
    const disable2FAForm = document.getElementById('disable-2fa-form');
    const cancelDisable2FAButton = document.getElementById('cancel-disable-2fa-button');

    function show2FAModal() {
        // NUCLEAR OPTION: Create a completely new modal element

        // Remove any existing custom modal
        const existingCustomModal = document.getElementById('custom-2fa-modal');
        if (existingCustomModal) {
            existingCustomModal.remove();
        }

        // Create completely new modal
        const customModal = document.createElement('div');
        customModal.id = 'custom-2fa-modal';
        customModal.innerHTML = `
            <div style="
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                z-index: 99999999 !important;
                background: rgba(0, 0, 0, 0.7) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin: 0 !important;
                padding: 0 !important;
                backdrop-filter: blur(5px) !important;
            ">
                <div style="
                    background: linear-gradient(135deg, rgba(30, 30, 30, 0.95) 0%, rgba(20, 20, 20, 0.95) 100%) !important;
                    border: 1px solid rgba(102, 126, 234, 0.3) !important;
                    border-radius: 16px !important;
                    padding: 2rem !important;
                    max-width: 500px !important;
                    width: 90% !important;
                    text-align: center !important;
                    backdrop-filter: blur(20px) !important;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 8px 32px rgba(102, 126, 234, 0.2) !important;
                ">
                    <h2 style="
                        color: #ffffff !important; 
                        font-size: 1.5rem !important;
                        font-weight: 600 !important;
                        margin-bottom: 1rem !important;
                        text-align: center !important;
                    ">
                        Setup Two-Factor Authentication
                    </h2>
                    <ol style="
                        color: #b3b3b3 !important; 
                        margin: 1rem 0 !important; 
                        padding-left: 1.5rem !important;
                        text-align: left !important;
                    ">
                        <li>Install an authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.)</li>
                        <li>Scan the QR code below with your authenticator app</li>
                        <li>Enter the 6-digit code from your app to complete setup</li>
                    </ol>
                    <div id="custom-qr-container" style="
                        text-align: center !important;
                        margin: 1.5rem 0 !important;
                    ">
                        <!-- QR code will be inserted here -->
                    </div>

                    <style id="ds-inline-style">
                        /* Scoped layout tweaks for Device Settings modal */
                        #device-settings-modal .ds-form .form-grid-3 {
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                            gap: 12px;
                        }
                        #device-settings-modal .ds-form .form-grid-2 {
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                            gap: 12px;
                        }
                        #device-settings-modal .ds-form .slider-wrapper {
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            position: relative; /* for absolute bubble positioning */
                        }
                        /* Thumb-following value bubble (above the thumb) */
                        #device-settings-modal .ds-form .slider-wrapper.modern-slider .slider-percentage {
                            position: absolute;
                            bottom: auto;
                            top: auto;
                            left: 50%; /* default thumb-follow; overridden by .bubble-br */
                            transform: translateX(-50%);
                            background: rgba(0,0,0,0.85);
                            color: #fff;
                            padding: 4px 8px;
                            border-radius: 10px;
                            font-size: 0.75rem;
                            font-weight: 600;
                            border: 1px solid rgba(255,255,255,0.2);
                            box-shadow: 0 2px 8px rgba(0,0,0,0.35);
                            pointer-events: none;
                            white-space: nowrap;
                            z-index: 2;
                        }
                        /* Place value bubbles for Refresh Rate and Randomness at bottom-left of their slider */
                        #device-settings-modal .ds-form .form-group:has([data-key='wallartMode.refreshRate']) .slider-wrapper.modern-slider,
                        #device-settings-modal .ds-form .form-group:has([data-key='wallartMode.randomness']) .slider-wrapper.modern-slider {
                            margin-bottom: 1.25rem; /* room for bubble below */
                        }
                        #device-settings-modal .ds-form .form-group:has([data-key='wallartMode.refreshRate']) .slider-wrapper.modern-slider .slider-percentage,
                        #device-settings-modal .ds-form .form-group:has([data-key='wallartMode.randomness']) .slider-wrapper.modern-slider .slider-percentage {
                            top: calc(100% + 8px);
                            bottom: auto;
                            left: 0;
                            right: auto;
                            transform: none;
                        }
                        #device-settings-modal .ds-form .slider-wrapper input[type='range'] {
                            width: 100%;
                            max-width: none;
                        }
                    </style>
                    <input type="text" id="custom-2fa-token" placeholder="000000" maxlength="6" style="
                        display: block !important;
                        width: 200px !important;
                        margin: 1rem auto !important;
                        padding: 10px !important;
                        text-align: center !important;
                        font-size: 1.2rem !important;
                        letter-spacing: 0.2rem !important;
                        border: 2px solid rgba(102, 126, 234, 0.3) !important;
                        border-radius: 8px !important;
                        background: rgba(40, 40, 40, 0.8) !important;
                        color: #ffffff !important;
                        outline: none !important;
                    ">
                    <div style="margin-top: 1.5rem !important;">
                        <button id="custom-cancel-2fa" style="
                            margin-right: 10px !important;
                            padding: 12px 24px !important;
                            background: rgba(60, 60, 60, 0.8) !important;
                            color: #ffffff !important;
                            border: 1px solid rgba(102, 126, 234, 0.3) !important;
                            border-radius: 8px !important;
                            cursor: pointer !important;
                            font-size: 1rem !important;
                            transition: all 0.3s ease !important;
                        ">Cancel Setup</button>
                        <button id="custom-verify-2fa" style="
                            padding: 12px 24px !important;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                            color: white !important;
                            border: none !important;
                            border-radius: 8px !important;
                            cursor: pointer !important;
                            font-size: 1rem !important;
                            font-weight: 600 !important;
                            transition: all 0.3s ease !important;
                        ">Complete Setup</button>
                    </div>
                </div>
            </div>
            <style>
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
            </style>
        `;

        // Add to body directly
        document.body.appendChild(customModal);

        // Add QR code to custom modal
        const customQrContainer = document.getElementById('custom-qr-container');
        if (customQrContainer && qrCodeContainer && qrCodeContainer.innerHTML) {
            // Copy QR code with better styling
            const qrImg = qrCodeContainer.querySelector('img');
            if (qrImg) {
                const styledQrCode = `
                    <img src="${qrImg.src}" alt="2FA QR Code" style="
                        max-width: 200px !important;
                        border: 1px solid rgba(102, 126, 234, 0.3) !important;
                        border-radius: 8px !important;
                        padding: 10px !important;
                        background: white !important;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
                    ">
                `;
                customQrContainer.innerHTML = styledQrCode;
            } else {
                customQrContainer.innerHTML = qrCodeContainer.innerHTML;
            }
        }

        // Add event listeners
        const cancelBtn = document.getElementById('custom-cancel-2fa');
        const verifyBtn = document.getElementById('custom-verify-2fa');
        const tokenInput = document.getElementById('custom-2fa-token');

        // Add hover effects
        if (cancelBtn) {
            cancelBtn.addEventListener('mouseenter', () => {
                cancelBtn.style.background = 'rgba(80, 80, 80, 0.9)';
            });
            cancelBtn.addEventListener('mouseleave', () => {
                cancelBtn.style.background = 'rgba(60, 60, 60, 0.8)';
            });
            cancelBtn.addEventListener('click', () => {
                customModal.remove();
                update2FAStatusText(false);
            });
        }

        if (verifyBtn) {
            verifyBtn.addEventListener('mouseenter', () => {
                verifyBtn.style.transform = 'translateY(-2px)';
                verifyBtn.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.3)';
            });
            verifyBtn.addEventListener('mouseleave', () => {
                verifyBtn.style.transform = 'translateY(0)';
                verifyBtn.style.boxShadow = 'none';
            });
        }

        // Add input focus effects
        if (tokenInput) {
            tokenInput.addEventListener('focus', () => {
                tokenInput.style.borderColor = 'rgba(102, 126, 234, 0.8)';
                tokenInput.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.2)';
            });
            tokenInput.addEventListener('blur', () => {
                tokenInput.style.borderColor = 'rgba(102, 126, 234, 0.3)';
                tokenInput.style.boxShadow = 'none';
            });
            // Auto-format input (digits only)
            tokenInput.addEventListener('input', e => {
                e.target.value = e.target.value.replace(/\D/g, '').substring(0, 6);
            });
        }

        if (verifyBtn && tokenInput) {
            verifyBtn.addEventListener('click', async () => {
                const token = tokenInput.value;
                if (token.length === 6) {
                    // Show loading state
                    const originalText = verifyBtn.innerHTML;
                    verifyBtn.innerHTML =
                        '<span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span> Verifying...';
                    verifyBtn.disabled = true;
                    verifyBtn.style.opacity = '0.7';

                    // Use the existing verification logic
                    try {
                        const response = await authenticatedFetch('/api/admin/2fa/verify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token }),
                        });
                        const result = await response.json();

                        if (response.status === 401) {
                            throw new Error('Your session has expired. Please log in again.');
                        }
                        if (!response.ok) throw new Error(result.error || 'Verification failed.');

                        customModal.remove();
                        showNotification(
                            '🎉 Two-Factor Authentication enabled successfully!',
                            'success'
                        );
                        update2FAStatusText(true);
                    } catch (error) {
                        showNotification(`❌ ${error.message}`, 'error');
                        tokenInput.value = '';
                        tokenInput.focus();

                        // Reset button state
                        verifyBtn.innerHTML = originalText;
                        verifyBtn.disabled = false;
                        verifyBtn.style.opacity = '1';
                    }
                } else {
                    // Simple validation feedback
                    tokenInput.style.borderColor = '#ff4757';
                    tokenInput.style.animation = 'shake 0.5s ease-in-out';
                    setTimeout(() => {
                        tokenInput.style.borderColor = 'rgba(102, 126, 234, 0.3)';
                        tokenInput.style.animation = '';
                        tokenInput.focus();
                    }, 500);
                }
            });

            // Allow Enter key to submit
            tokenInput.addEventListener('keypress', e => {
                if (e.key === 'Enter' && tokenInput.value.length === 6) {
                    verifyBtn.click();
                }
            });
        }

        // Focus on input
        if (tokenInput) {
            setTimeout(() => tokenInput.focus(), 100);
        }
    }

    function hide2FAModal() {
        // Hide original modal
        if (twoFaModal) {
            twoFaModal.classList.add('is-hidden');
            twoFaModal.setAttribute('aria-hidden', 'true');
        }
        if (qrCodeContainer) qrCodeContainer.innerHTML = '';
        const tokenInput = document.getElementById('2fa-token');
        if (tokenInput) tokenInput.value = '';

        // Also remove custom modal if it exists
        const customModal = document.getElementById('custom-2fa-modal');
        if (customModal) {
            customModal.remove();
        }
    }

    // New functions for the disable modal
    function showDisable2FAModal() {
        // Remove any existing custom disable modal
        const existingCustomModal = document.getElementById('ultra-protected-disable-2fa-modal');
        if (existingCustomModal) {
            existingCustomModal.remove();
        }

        // Create completely new disable modal with ULTRA protection
        const customDisableModal = document.createElement('div');
        customDisableModal.id = 'ultra-protected-disable-2fa-modal';

        // Make it nearly impossible to remove accidentally
        Object.defineProperty(customDisableModal, 'remove', {
            value: function () {
                // Only allow removal if explicitly called with the secret key
                if (arguments[0] === 'ALLOW_REMOVE_SECRET_KEY_2FA_DISABLE') {
                    Element.prototype.remove.call(this);
                } else {
                    // Default behavior without explicit permission
                    return;
                }
            },
            writable: false,
            configurable: false,
        });

        customDisableModal.innerHTML = `
            <div style="
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                z-index: 2147483647 !important;
                background: rgba(0, 0, 0, 0.7) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin: 0 !important;
                padding: 0 !important;
                backdrop-filter: blur(5px) !important;
            ">
                <div style="
                    background: linear-gradient(135deg, rgba(30, 30, 30, 0.95) 0%, rgba(20, 20, 20, 0.95) 100%) !important;
                    border: 1px solid rgba(239, 68, 68, 0.3) !important;
                    border-radius: 16px !important;
                    padding: 2rem !important;
                    max-width: 500px !important;
                    width: 90% !important;
                    text-align: center !important;
                    backdrop-filter: blur(20px) !important;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 8px 32px rgba(239, 68, 68, 0.2) !important;
                ">
                    <h2 style="
                        color: #ffffff !important; 
                        font-size: 1.5rem !important;
                        font-weight: 600 !important;
                        margin-bottom: 1rem !important;
                        text-align: center !important;
                    ">
                        Disable Two-Factor Authentication
                    </h2>
                    <div style="
                        color: #ff6b6b !important;
                        background: rgba(239, 68, 68, 0.1) !important;
                        border: 1px solid rgba(239, 68, 68, 0.3) !important;
                        border-radius: 8px !important;
                        padding: 1rem !important;
                        margin-bottom: 1.5rem !important;
                        text-align: left !important;
                    ">
                        <strong>⚠️ Warning:</strong> Disabling 2FA will make your account less secure.
                    </div>
                    <p style="
                        color: #b3b3b3 !important; 
                        margin-bottom: 1.5rem !important;
                        text-align: center !important;
                    ">
                        Please enter your current password to confirm this change:
                    </p>
                    <input type="password" id="ultra-disable-password" placeholder="Current Password" style="
                        display: block !important;
                        width: 100% !important;
                        max-width: 300px !important;
                        margin: 1rem auto !important;
                        padding: 12px !important;
                        text-align: center !important;
                        font-size: 1rem !important;
                        border: 2px solid rgba(239, 68, 68, 0.3) !important;
                        border-radius: 8px !important;
                        background: rgba(40, 40, 40, 0.8) !important;
                        color: #ffffff !important;
                        outline: none !important;
                        transition: border-color 0.3s ease !important;
                    ">
                    <div id="ultra-disable-error" style="
                        display: none !important;
                        color: #ff6b6b !important;
                        background: rgba(239, 68, 68, 0.1) !important;
                        border: 1px solid rgba(239, 68, 68, 0.3) !important;
                        border-radius: 8px !important;
                        padding: 0.75rem !important;
                        margin: 1rem auto !important;
                        max-width: 300px !important;
                        font-size: 0.9rem !important;
                        text-align: center !important;
                    "></div>
                    <div style="margin-top: 1.5rem !important;">
                        <button id="ultra-cancel-disable" style="
                            margin-right: 10px !important;
                            padding: 12px 24px !important;
                            background: rgba(60, 60, 60, 0.8) !important;
                            color: #ffffff !important;
                            border: 1px solid rgba(102, 126, 234, 0.3) !important;
                            border-radius: 8px !important;
                            cursor: pointer !important;
                            font-size: 1rem !important;
                            transition: all 0.3s ease !important;
                        ">Keep 2FA Enabled</button>
                        <button id="ultra-confirm-disable" style="
                            padding: 12px 24px !important;
                            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%) !important;
                            color: white !important;
                            border: none !important;
                            border-radius: 8px !important;
                            cursor: pointer !important;
                            font-size: 1rem !important;
                            font-weight: 600 !important;
                            transition: all 0.3s ease !important;
                        ">Disable 2FA</button>
                    </div>
                </div>
            </div>
            <style>
                #ultra-disable-password:focus {
                    border-color: rgba(239, 68, 68, 0.6) !important;
                    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1) !important;
                }
                #ultra-cancel-disable:hover {
                    background: rgba(80, 80, 80, 0.9) !important;
                    transform: translateY(-1px) !important;
                }
                #ultra-confirm-disable:hover {
                    background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%) !important;
                    transform: translateY(-1px) !important;
                    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3) !important;
                }
            </style>
        `;

        // Inject into body
        document.body.appendChild(customDisableModal);

        // Prevent accidental closing - even more aggressive
        customDisableModal.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
        });

        // Get elements from the new modal
        const passwordInput = document.getElementById('ultra-disable-password');
        const cancelBtn = document.getElementById('ultra-cancel-disable');
        const confirmBtn = document.getElementById('ultra-confirm-disable');
        const errorDiv = document.getElementById('ultra-disable-error');

        // Add event listeners
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                // Use the secret key to allow removal
                customDisableModal.remove('ALLOW_REMOVE_SECRET_KEY_2FA_DISABLE');
                // Reset checkbox to enabled state
                update2FAStatusText(true);
            });
        }

        if (confirmBtn && passwordInput) {
            confirmBtn.addEventListener('click', async () => {
                const password = passwordInput.value;
                if (!password) {
                    passwordInput.style.borderColor = '#ff4757';
                    passwordInput.style.animation = 'shake 0.5s ease-in-out';
                    setTimeout(() => {
                        passwordInput.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                        passwordInput.style.animation = '';
                        passwordInput.focus();
                    }, 500);
                    return;
                }

                // HIDE modal from querySelector/getElementById during request
                const originalId = customDisableModal.id;
                customDisableModal.id = 'hidden-during-request-' + Date.now();

                // Show loading state
                const originalText = confirmBtn.innerHTML;
                confirmBtn.innerHTML =
                    '<span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span> Disabling...';
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.7';

                // Hide any previous error
                if (errorDiv) {
                    errorDiv.style.display = 'none';
                }

                try {
                    // Use pure fetch to avoid any side effects from authenticatedFetch
                    const response = await fetch('/api/admin/2fa/disable', {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json',
                            'Cache-Control': 'no-cache',
                        },
                        body: JSON.stringify({ password }),
                    });

                    const result = await response.json();

                    // Handle different types of 401 errors
                    if (response.status === 401) {
                        if (result.error && result.error.includes('Authentication required')) {
                            throw new Error(
                                'Your session has expired. Please refresh the page and log in again.'
                            );
                        } else if (result.error && result.error.includes('Incorrect password')) {
                            throw new Error('Incorrect password');
                        } else {
                            throw new Error(result.error || 'Authentication failed');
                        }
                    }
                    if (!response.ok) throw new Error(result.error || 'Failed to disable 2FA');

                    // Restore modal ID before removing
                    customDisableModal.id = originalId;

                    // Use secret key to allow removal on success
                    customDisableModal.remove('ALLOW_REMOVE_SECRET_KEY_2FA_DISABLE');
                    update2FAStatusText(false);
                    showNotification(
                        '🔓 Two-Factor Authentication disabled successfully.',
                        'success'
                    );
                } catch (error) {
                    // RESTORE modal ID immediately in error case
                    customDisableModal.id = originalId;

                    // Reset button state IMMEDIATELY
                    confirmBtn.innerHTML = originalText;
                    confirmBtn.disabled = false;
                    confirmBtn.style.opacity = '1';

                    // Handle error WITHOUT any external calls that might close modal
                    let errorMessage = error.message;

                    // Customize error messages for better UX
                    if (errorMessage.includes('Incorrect password')) {
                        errorMessage = '❌ Incorrect password. Please try again.';
                    } else if (
                        errorMessage.includes('session has expired') ||
                        errorMessage.includes('Authentication required')
                    ) {
                        errorMessage =
                            '⚠️ Your session has expired. Please refresh the page and log in again.';
                        // For session expiry, we should probably close the modal and redirect
                        setTimeout(() => {
                            window.location.reload();
                        }, 3000);
                    } else if (errorMessage.includes('Failed to disable 2FA')) {
                        errorMessage =
                            '❌ Failed to disable 2FA. Please check your password and try again.';
                    } else {
                        errorMessage = `❌ ${errorMessage}`;
                    }

                    // Show error ONLY in modal - NO external calls whatsoever
                    if (errorDiv) {
                        errorDiv.textContent = errorMessage;
                        errorDiv.style.display = 'block';
                        // Hide error after 8 seconds
                        setTimeout(() => {
                            if (errorDiv && document.body.contains(errorDiv)) {
                                errorDiv.style.display = 'none';
                            }
                        }, 8000);
                    }

                    // Clear password and focus for retry
                    passwordInput.value = '';
                    passwordInput.style.borderColor = '#ff4757';
                    passwordInput.focus();

                    // Reset border color after animation
                    setTimeout(() => {
                        if (passwordInput && document.body.contains(passwordInput)) {
                            passwordInput.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                        }
                    }, 1000);

                    // Prevent any further error propagation
                    return false;
                }
            });

            // Allow Enter key to submit
            passwordInput.addEventListener('keypress', e => {
                if (e.key === 'Enter' && passwordInput.value) {
                    confirmBtn.click();
                }
            });

            // Hide error message when user starts typing
            passwordInput.addEventListener('input', () => {
                if (errorDiv && errorDiv.style.display === 'block') {
                    errorDiv.style.display = 'none';
                }
                // Reset border color when typing
                passwordInput.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            });
        }

        // Focus on password input
        if (passwordInput) {
            setTimeout(() => passwordInput.focus(), 100);
        }
    }

    function hideDisable2FAModal() {
        // Hide original modal if it exists
        if (disable2FAModal) disable2FAModal.classList.add('is-hidden');
        if (disable2FAForm) disable2FAForm.reset();

        // Remove ultra protected modal if it exists
        const ultraProtectedModal = document.getElementById('ultra-protected-disable-2fa-modal');
        if (ultraProtectedModal) {
            // Use secret key to allow removal
            ultraProtectedModal.remove('ALLOW_REMOVE_SECRET_KEY_2FA_DISABLE');
        }

        // Also try to remove old custom modal if it exists
        const customDisableModal = document.getElementById('custom-disable-2fa-modal');
        if (customDisableModal) {
            customDisableModal.remove();
        }

        // Always restore the checkbox to enabled state when modal is hidden
        // (unless 2FA was actually successfully disabled)
        const actuallyEnabled = twoFaCheckbox && twoFaCheckbox.dataset.actuallyEnabled === 'true';
        if (actuallyEnabled && twoFaCheckbox.checked === false) {
            // User cancelled the disable process, restore the enabled state
            update2FAStatusText(true);
        }
    }

    function update2FAStatusText(isEnabled) {
        if (!twoFaStatusText) return;

        // Update the visual status
        if (isEnabled) {
            twoFaStatusText.innerHTML =
                '<i class="fas fa-shield-alt" style="color: #28a745;"></i> Two-Factor Authentication is <strong>enabled</strong> and protecting your account.';
            twoFaStatusText.className = 'status-text enabled';
        } else {
            twoFaStatusText.innerHTML =
                '<i class="fas fa-shield-alt" style="color: #6c757d;"></i> Two-Factor Authentication is <strong>disabled</strong>. Click above to set it up.';
            twoFaStatusText.className = 'status-text disabled';
        }

        // Update checkbox state and store actual status
        if (twoFaCheckbox) {
            twoFaCheckbox.checked = isEnabled;
            twoFaCheckbox.dataset.actuallyEnabled = isEnabled.toString();
        }
    }

    async function handleEnable2FA() {
        // Show loading notification
        const loadingNotification = showNotification('🔄 Generating 2FA setup...', 'info');

        try {
            const response = await authenticatedFetch('/api/admin/2fa/generate', {
                method: 'POST',
            });
            const result = await response.json();

            if (response.status === 401) {
                throw new Error('Your session has expired. Please log in again.');
            }
            if (!response.ok) throw new Error(result.error || 'Could not generate QR code.');

            // Hide loading notification immediately
            if (loadingNotification) {
                loadingNotification.classList.remove('show');
                setTimeout(() => {
                    if (loadingNotification && loadingNotification.parentNode) {
                        loadingNotification.remove();
                    }
                }, 300); // Give time for transition
            }

            qrCodeContainer.innerHTML = `<img src="${result.qrCodeDataUrl}" alt="QR Code" style="max-width: 200px; border: 1px solid #ddd; padding: 10px; background: white;">`;

            show2FAModal();

            // Focus is now handled in show2FAModal function
        } catch (error) {
            // Hide loading notification immediately
            if (loadingNotification) {
                loadingNotification.classList.remove('show');
                setTimeout(() => {
                    if (loadingNotification && loadingNotification.parentNode) {
                        loadingNotification.remove();
                    }
                }, 300);
            }
            showNotification(`❌ Error enabling 2FA: ${error.message}`, 'error');
            // Reset checkbox to original state on error
            update2FAStatusText(false);
        }
    }

    async function handleDisable2FA() {
        // First check if we're still authenticated
        try {
            const testResponse = await fetch('/api/admin/config', {
                method: 'GET',
                credentials: 'include',
                headers: { 'Cache-Control': 'no-cache' },
            });

            if (testResponse.status === 401) {
                showNotification(
                    '⚠️ Your session has expired. Please refresh the page and log in again.',
                    'error'
                );
                setTimeout(() => window.location.reload(), 2000);
                return;
            }
        } catch (error) {
            logger.warn('Failed to test authentication:', error);
            // Continue anyway, the actual request will handle auth errors
        }

        // This function now just shows the modal. The logic is moved to the form submit handler.
        showDisable2FAModal();
    }

    if (twoFaCheckbox) {
        twoFaCheckbox.addEventListener('click', event => {
            // Prevent the default checkbox behavior
            event.preventDefault();

            // Check current actual state from server
            const currentlyEnabled = twoFaCheckbox.dataset.actuallyEnabled === 'true';
            const clickedToEnable = !currentlyEnabled;

            if (clickedToEnable) {
                // User wants to enable 2FA - start wizard
                handleEnable2FA();
            } else {
                // User wants to disable 2FA - immediately update visual state and show confirmation
                // Temporarily update the checkbox to show unchecked state
                twoFaCheckbox.checked = false;
                twoFaStatusText.innerHTML =
                    '<i class="fas fa-shield-alt" style="color: #ffc107;"></i> Two-Factor Authentication is being <strong>disabled</strong>... Please confirm below.';
                twoFaStatusText.className = 'status-text warning';

                handleDisable2FA();
            }
        });
    }

    if (cancel2faButton) {
        cancel2faButton.addEventListener('click', () => {
            hide2FAModal();
            // Reset to actual current state (disabled)
            update2FAStatusText(false);
        });
    }

    if (twoFaVerifyForm) {
        twoFaVerifyForm.addEventListener('submit', async event => {
            event.preventDefault();
            const tokenInput = document.getElementById('2fa-token');
            const submitButton = event.target.querySelector('button[type="submit"]');
            const token = tokenInput.value;

            // Show loading state
            const originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
            submitButton.disabled = true;

            try {
                const response = await authenticatedFetch('/api/admin/2fa/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token }),
                });
                const result = await response.json();

                if (response.status === 401) {
                    throw new Error('Your session has expired. Please log in again.');
                }
                if (!response.ok) throw new Error(result.error || 'Verification failed.');

                hide2FAModal();
                showNotification('🎉 Two-Factor Authentication enabled successfully!', 'success');
                update2FAStatusText(true);
            } catch (error) {
                showNotification(`❌ ${error.message}`, 'error');
                tokenInput.value = '';
                tokenInput.focus();
            } finally {
                // Reset button state
                submitButton.innerHTML = originalText;
                submitButton.disabled = false;
            }
        });
    }

    if (disable2FAForm) {
        disable2FAForm.addEventListener('submit', async event => {
            event.preventDefault();
            const passwordInput = document.getElementById('disable-2fa-password');
            const submitButton = event.target.querySelector('button[type="submit"]');
            const password = passwordInput.value;

            // Show loading state
            const originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Disabling...';
            submitButton.disabled = true;

            try {
                const response = await authenticatedFetch('/api/admin/2fa/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                });
                const result = await response.json();

                if (response.status === 401) {
                    throw new Error('Your session has expired. Please log in again.');
                }
                if (!response.ok) throw new Error(result.error || 'Disable failed.');

                // Update status first before hiding modal
                update2FAStatusText(false);
                hideDisable2FAModal();
                showNotification('🔓 Two-Factor Authentication disabled successfully.', 'success');
                update2FAStatusText(false);
            } catch (error) {
                showNotification(`❌ Error disabling 2FA: ${error.message}`, 'error');
                // Don't hide the modal on error, so the user can try again.
                passwordInput.value = '';
                passwordInput.focus();
            } finally {
                // Reset button state
                submitButton.innerHTML = originalText;
                submitButton.disabled = false;
            }
        });
    }

    if (cancelDisable2FAButton) {
        cancelDisable2FAButton.addEventListener('click', () => {
            hideDisable2FAModal();
        });
    }

    /**
     * Attaches a click handler to a button that requires a second confirmation click.
     * This provides a better user experience than a native confirm() dialog.
     * @param {HTMLButtonElement} button The button element.
     * @param {string} confirmText The text to display on the button for confirmation.
     * @param {function} onConfirm The async function to execute upon confirmation.
     */
    function addConfirmClickHandler(button, confirmText, onConfirm) {
        let confirmTimeout = null;
        const textSpan = button.querySelector('span:last-child');
        // If there's no text span, the button likely doesn't have an icon. Fallback to full textContent.
        const originalText = textSpan ? textSpan.textContent : button.textContent;

        const revertButton = () => {
            if (confirmTimeout) clearTimeout(confirmTimeout);
            if (!button) return;
            button.dataset.confirming = 'false';
            if (textSpan) {
                textSpan.textContent = originalText;
            } else {
                button.textContent = originalText;
            }
            button.classList.remove('is-warning');
        };

        button.addEventListener('click', event => {
            if (button.disabled) return;

            if (button.dataset.confirming === 'true') {
                revertButton();
                onConfirm(event);
            } else {
                button.dataset.confirming = 'true';
                if (textSpan) {
                    textSpan.textContent = confirmText;
                } else {
                    button.textContent = confirmText;
                }
                button.classList.add('is-warning');
                confirmTimeout = setTimeout(revertButton, 4000);
            }
        });
    }

    // --- API Key Management ---
    const apiKeyStatusText = document.getElementById('api-key-status-text');
    const apiKeyDisplayContainer = document.getElementById('api-key-display-container');
    const apiKeyInput = document.getElementById('api-key-input');
    const copyApiKeyButton = document.getElementById('copy-api-key-button');
    const toggleApiKeyVisibilityButton = document.getElementById(
        'toggle-api-key-visibility-button'
    );
    const generateApiKeyButton = document.getElementById('generate-api-key-button');
    const revokeApiKeyButton = document.getElementById('revoke-api-key-button');

    async function updateApiKeyStatus() {
        try {
            const response = await fetch('/api/admin/api-key/status');
            if (!response.ok) throw new Error('Could not fetch status.');
            const { hasKey } = await response.json();

            if (hasKey) {
                apiKeyStatusText.textContent = 'Active';
                apiKeyStatusText.className = 'status-text enabled';
                revokeApiKeyButton.disabled = false;

                // Fetch the key and display it
                const keyResponse = await fetch('/api/admin/api-key');
                if (!keyResponse.ok) throw new Error('Could not fetch API key.');
                const { apiKey } = await keyResponse.json();

                if (apiKey) {
                    apiKeyInput.value = apiKey;
                    apiKeyDisplayContainer.classList.remove('is-hidden');
                } else {
                    apiKeyDisplayContainer.classList.add('is-hidden');
                }
            } else {
                apiKeyStatusText.textContent = 'No key configured';
                apiKeyStatusText.className = 'status-text disabled';
                revokeApiKeyButton.disabled = true;
                apiKeyDisplayContainer.classList.add('is-hidden');
                apiKeyInput.value = '';
            }
        } catch (error) {
            apiKeyStatusText.textContent = `Error: ${error.message}`;
            apiKeyStatusText.className = 'status-text error';
        }
    }

    if (generateApiKeyButton) {
        addConfirmClickHandler(generateApiKeyButton, 'Are you sure? Click again', async () => {
            try {
                const response = await fetch('/api/admin/api-key/generate', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Genereren mislukt.');

                apiKeyInput.value = result.apiKey;
                apiKeyDisplayContainer.classList.remove('is-hidden');
                showNotification(result.message, 'success');
                updateApiKeyStatus();
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
        });
    }

    if (revokeApiKeyButton) {
        addConfirmClickHandler(revokeApiKeyButton, 'Are you sure? Click again', async () => {
            try {
                const response = await fetch('/api/admin/api-key/revoke', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Revoke failed.');

                showNotification(result.message, 'success');
                apiKeyDisplayContainer.classList.add('is-hidden'); // Hide the key display after revoking
                apiKeyInput.value = '';
                updateApiKeyStatus();
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
        });
    }

    if (copyApiKeyButton) {
        copyApiKeyButton.addEventListener('click', () => {
            navigator.clipboard.writeText(apiKeyInput.value).then(
                () => {
                    showNotification('API key copied to clipboard!', 'success');
                },
                () => {
                    showNotification('Copy failed.', 'error');
                }
            );
        });
    }

    if (toggleApiKeyVisibilityButton) {
        toggleApiKeyVisibilityButton.addEventListener('click', () => {
            const icon = toggleApiKeyVisibilityButton.querySelector('i');
            if (apiKeyInput.type === 'password') {
                apiKeyInput.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                apiKeyInput.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    }

    // --- Initialization ---

    loadConfig();

    // Load cache configuration on page load with multiple attempts
    setTimeout(() => {
        loadCacheConfig();
    }, 500); // Small delay to ensure main config is loaded first

    // Additional attempt when management section is first viewed
    setTimeout(() => {
        loadCacheConfig();
    }, 2000); // Longer delay as backup

    // Track original form values to detect actual changes
    let originalConfigValues = {};

    // Function to capture current form state
    function captureFormState() {
        const form = document.getElementById('config-form');
        if (!form) return {};

        const values = {};

        // Get all form inputs
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (input.type === 'checkbox') {
                values[input.id || input.name] = input.checked;
            } else if (input.type === 'radio') {
                if (input.checked) {
                    values[input.name] = input.value;
                }
            } else {
                values[input.id || input.name] = input.value;
            }
        });

        return values;
    }

    // Capture initial state after config loads
    setTimeout(() => {
        originalConfigValues = captureFormState();
    }, 1000);

    // hasFormChanged utility removed (unused)

    // Determine if the specific set of settings that require a restart have changed
    function needsRestartChange(originalValues, currentValues) {
        try {
            const toNum = v => (Number.isFinite(Number(v)) ? Number(v) : null);
            const toBool = v => v === true || v === 'true';

            // Normalize relevant fields
            const origServerPort = toNum(originalValues?.['SERVER_PORT']);
            const currServerPort = toNum(currentValues?.['SERVER_PORT']);

            const origDebug = toBool(originalValues?.['DEBUG']);
            const currDebug = toBool(currentValues?.['DEBUG']);

            const origSiteEnabled = toBool(originalValues?.['siteServer.enabled']);
            const currSiteEnabled = toBool(currentValues?.['siteServer.enabled']);

            const origSitePort = toNum(originalValues?.['siteServer.port']);
            const currSitePort = toNum(currentValues?.['siteServer.port']);

            // Content source enable/disable toggles (require restart)
            const origPlexEnabled = toBool(originalValues?.['mediaServers[0].enabled']);
            const currPlexEnabled = toBool(currentValues?.['mediaServers[0].enabled']);

            const origJellyfinEnabled = toBool(originalValues?.['mediaServers[1].enabled']);
            const currJellyfinEnabled = toBool(currentValues?.['mediaServers[1].enabled']);

            const origTmdbEnabled = toBool(originalValues?.['tmdbSource.enabled']);
            const currTmdbEnabled = toBool(currentValues?.['tmdbSource.enabled']);

            const origTvdbEnabled = toBool(originalValues?.['tvdbSource.enabled']);
            const currTvdbEnabled = toBool(currentValues?.['tvdbSource.enabled']);

            const origStreamingEnabled = toBool(originalValues?.['streamingSources.enabled']);
            const currStreamingEnabled = toBool(currentValues?.['streamingSources.enabled']);

            if (origServerPort !== currServerPort) return true;
            if (origDebug !== currDebug) return true;
            if (origSiteEnabled !== currSiteEnabled) return true;
            // Only consider siteServer.port when enabled in either snapshot
            if ((origSiteEnabled || currSiteEnabled) && origSitePort !== currSitePort) return true;

            // Any content source toggle change requires a restart
            if (origPlexEnabled !== currPlexEnabled) return true;
            if (origJellyfinEnabled !== currJellyfinEnabled) return true;
            if (origTmdbEnabled !== currTmdbEnabled) return true;
            if (origTvdbEnabled !== currTvdbEnabled) return true;
            if (origStreamingEnabled !== currStreamingEnabled) return true;

            return false;
        } catch (e) {
            // ignore
            return false;
        }
    }

    // Remove automatic background initialization - it will be handled by section switching

    // Cleanup timers when page unloads
    window.addEventListener('beforeunload', () => {
        clearAllPreviewTimers();
        if (adminBgTimer) {
            clearInterval(adminBgTimer);
            adminBgTimer = null;
        }
    });

    // Removed: debug cache action toggle (button removed from UI)

    const configForm = document.getElementById('config-form');
    if (configForm) {
        configForm.addEventListener('submit', async event => {
            event.preventDefault();
            const button = document.getElementById('save-config-button'); // Direct ID selector instead
            if (!button) return;

            const buttonTextSpan = button.querySelector('span:last-child');
            const originalButtonText = buttonTextSpan.textContent;

            button.disabled = true;
            buttonTextSpan.textContent = 'Saving...';

            /**
             * Recursively creates a deep copy of an object, excluding any keys with a null value.
             * This prevents empty form fields from overwriting existing settings with null.
             * @param {object} obj The object to clean.
             * @returns {object} A new object with null values removed.
             */
            const cleanNulls = obj => {
                // Primitive handling: convert empty strings to undefined sentinel (drop later)
                if (obj === '') return undefined;
                if (obj === null || typeof obj !== 'object') {
                    return obj;
                }
                if (Array.isArray(obj)) {
                    return obj.map(cleanNulls).filter(item => item !== null && item !== undefined);
                }
                const newObj = {};
                for (const key in obj) {
                    const cleaned = cleanNulls(obj[key]);
                    if (cleaned !== null && cleaned !== undefined) {
                        newObj[key] = cleaned;
                    }
                }
                return newObj;
            };

            try {
                // --- Validation ---
                // Only validate Plex library selection if we're actively configuring in the media section
                const mediaSection = document.getElementById('media-section');
                const isMediaSectionActive =
                    mediaSection && mediaSection.classList.contains('active');
                const isPlexEnabled = document.getElementById('mediaServers[0].enabled')?.checked;

                // Only require library selection if user is actually in media section configuring Plex
                if (isPlexEnabled && isMediaSectionActive) {
                    const selectedMovieLibs = getSelectedLibraries('movie');
                    const selectedShowLibs = getSelectedLibraries('show');

                    if (selectedMovieLibs.length === 0 && selectedShowLibs.length === 0) {
                        throw new Error(
                            'When configuring Plex in the Media section, you must select at least one movie or show library.'
                        );
                    }
                }

                // Allow Plex to be saved even from other sections for fanart functionality

                // --- Numeric Field Validation ---
                const numericFieldIds = [
                    'transitionIntervalSeconds',

                    'SERVER_PORT',
                    'rottenTomatoesMinimumScore',
                    'effectPauseTime',
                    'wallartItemsPerScreen',
                    'wallartColumns',
                    'wallartTransitionInterval',
                    'siteServer.port',
                ];

                for (const id of numericFieldIds) {
                    const element = document.getElementById(id);
                    if (element && element.value.trim() !== '') {
                        // Use Number.isFinite to ensure the value is a valid, finite number.
                        // This correctly handles cases like "123a" which parseFloat would partially parse.
                        if (!Number.isFinite(Number(element.value))) {
                            const label = document.querySelector(`label[for="${id}"]`);
                            const fieldName = label ? label.textContent : id;
                            throw new Error(`The field "${fieldName}" must be a valid number.`);
                        }

                        // Additional range validation for specific fields
                        const value = Number(element.value);
                        if (id === 'transitionIntervalSeconds' && (value < 1 || value > 300)) {
                            throw new Error(
                                'Transition Interval must be between 1 and 300 seconds.'
                            );
                        }

                        if (
                            (id === 'SERVER_PORT' || id === 'siteServer.port') &&
                            (value < 1024 || value > 65535)
                        ) {
                            throw new Error('Port numbers must be between 1024 and 65535.');
                        }
                        if (id === 'rottenTomatoesMinimumScore' && (value < 0 || value > 10)) {
                            throw new Error('Rotten Tomatoes score must be between 0 and 10.');
                        }

                        if (id === 'wallartItemsPerScreen' && (value < 4 || value > 100)) {
                            throw new Error('Wallart items per screen must be between 4 and 100.');
                        }
                        if (id === 'wallartColumns' && (value < 2 || value > 12)) {
                            throw new Error('Wallart columns must be between 2 and 12.');
                        }
                        if (id === 'wallartTransitionInterval' && (value < 5 || value > 300)) {
                            throw new Error(
                                'Wallart transition interval must be between 5 and 300 seconds.'
                            );
                        }
                    }
                }

                // Helper to get form values and parse them
                const getValue = (id, type = 'string') => {
                    const element = document.getElementById(id);
                    if (!element) return null;

                    if (element.type === 'checkbox') {
                        return element.checked;
                    }

                    const value = element.value;
                    if (type === 'number') {
                        return value === '' ? null : parseFloat(value);
                    }
                    return value;
                };

                // Helper to get rating filter value (can be from hidden field for multi-select)
                const getRatingFilterValue = baseId => {
                    // First try to get from hidden field (multi-select checkboxes)
                    const hiddenField = document.getElementById(baseId + '-hidden');
                    if (hiddenField && hiddenField.value) {
                        // Convert comma-separated string to array if multiple values
                        const values = hiddenField.value
                            .split(',')
                            .map(v => v.trim())
                            .filter(v => v);
                        return values.length > 1 ? values : values[0] || '';
                    }

                    // Fall back to regular element (traditional select)
                    return getValue(baseId);
                };

                const newConfig = {
                    transitionIntervalSeconds: getValue('transitionIntervalSeconds', 'number'),
                    syncEnabled: getValue('syncEnabled'),
                    syncAlignMaxDelayMs: getValue('syncAlignMaxDelayMs', 'number'),

                    showClearLogo: getValue('showClearLogo'),
                    // Rotten Tomatoes: minimum score applied only if badge enabled; when disabled we still send value for persistence.
                    showRottenTomatoes: getValue('showRottenTomatoes'),
                    rottenTomatoesMinimumScore: getValue('rottenTomatoesMinimumScore', 'number'),
                    showPoster: getValue('showPoster'),
                    showMetadata: getValue('showMetadata'),
                    clockWidget: getValue('clockWidget'),
                    clockTimezone: getValue('clockTimezone'),
                    clockFormat: getValue('clockFormat'),
                    wallartMode: {
                        enabled: getValue('wallartModeEnabled'),
                        density: getValue('wallartDensity'),
                        refreshRate: getValue('wallartRefreshRate', 'number'),
                        randomness: getValue('wallartRandomness', 'number'),
                        animationType: getValue('wallartAnimationType'),
                        layoutVariant: getValue('wallartLayoutVariant'),
                        layoutSettings: {
                            heroGrid: {
                                heroSide: getValue('heroSide'),
                                heroRotationMinutes: getValue('heroRotationMinutes', 'number'),
                            },
                            // masonryLight removed
                        },
                        ambientGradient: getValue('wallartAmbientGradient'),
                        // spotlight removed
                        // autoRefresh removed (always on)
                    },
                    cinemaMode: getValue('cinemaMode'),
                    cinemaOrientation: getValue('cinemaOrientation'),
                    transitionEffect: getValue('transitionEffect'),
                    effectPauseTime: getValue('effectPauseTime', 'number'),
                    uiScaling: {
                        content: (() => {
                            const v = getValue('uiScaling.content', 'number');
                            return Number.isFinite(v) ? v : defaults.uiScaling.content || 100;
                        })(),
                        clearlogo: (() => {
                            const v = getValue('uiScaling.clearlogo', 'number');
                            return Number.isFinite(v) ? v : defaults.uiScaling.clearlogo;
                        })(),
                        clock: (() => {
                            const v = getValue('uiScaling.clock', 'number');
                            return Number.isFinite(v) ? v : defaults.uiScaling.clock;
                        })(),
                        global: (() => {
                            const v = getValue('uiScaling.global', 'number');
                            return Number.isFinite(v) ? v : defaults.uiScaling.global;
                        })(),
                    },
                    mediaServers: [
                        {
                            name: 'Plex Server', // This is not editable in the UI
                            type: 'plex', // This is not editable in the UI
                            enabled: getValue('mediaServers[0].enabled'),
                            hostnameEnvVar: 'PLEX_HOSTNAME',
                            portEnvVar: 'PLEX_PORT',
                            tokenEnvVar: 'PLEX_TOKEN',
                            movieLibraryNames: getSelectedLibraries('movie'),
                            showLibraryNames: getSelectedLibraries('show'),
                            // Fixed limits now; don't submit counts from UI
                            ratingFilter: getRatingFilterValue('mediaServers[0].ratingFilter'),
                            genreFilter: getGenreFilterValues(),
                            recentlyAddedOnly: getValue('mediaServers[0].recentlyAddedOnly'),
                            recentlyAddedDays: getValue(
                                'mediaServers[0].recentlyAddedDays',
                                'number'
                            ),
                            qualityFilter: getValue('mediaServers[0].qualityFilter'),
                        },
                        {
                            name: 'Jellyfin Server', // This is not editable in the UI
                            type: 'jellyfin', // This is not editable in the UI
                            enabled: getValue('mediaServers[1].enabled'),
                            hostnameEnvVar: 'JELLYFIN_HOSTNAME',
                            portEnvVar: 'JELLYFIN_PORT',
                            tokenEnvVar: 'JELLYFIN_API_KEY',
                            movieLibraryNames: getSelectedJellyfinLibraries('movie'),
                            showLibraryNames: getSelectedJellyfinLibraries('show'),
                            ratingFilter: getRatingFilterValue('mediaServers[1].ratingFilter'),
                            genreFilter: getJellyfinGenreFilterValues(),
                            recentlyAddedOnly: getValue('mediaServers[1].recentlyAddedOnly'),
                            recentlyAddedDays: getValue(
                                'mediaServers[1].recentlyAddedDays',
                                'number'
                            ),
                            qualityFilter: getValue('mediaServers[1].qualityFilter'),
                        },
                    ],
                    tmdbSource: {
                        enabled: getValue('tmdbSource.enabled'),
                        apiKey: (() => {
                            const apiKeyField = document.getElementById('tmdbSource.apiKey');
                            const enteredKey = apiKeyField ? apiKeyField.value : '';
                            const apiKeyIsSet = apiKeyField
                                ? apiKeyField.dataset.apiKeySet === 'true'
                                : false;

                            // If user entered a new key, use it
                            if (enteredKey && enteredKey.trim() !== '') {
                                return enteredKey.trim();
                            }

                            // If field is empty but there's an existing key, preserve it by returning null
                            // (null means "don't change the existing value" in the backend)
                            if (apiKeyIsSet) {
                                return null;
                            }

                            // If field is empty and no key was set, use empty string
                            return '';
                        })(),
                        category: getValue('tmdbSource.category'),
                        // Fixed limits; omit from payload
                        minRating: getValue('tmdbSource.minRating', 'number'),
                        yearFilter: getValue('tmdbSource.yearFilter', 'number'),
                        genreFilter: getTMDBGenreFilterValues(),
                    },
                    tvdbSource: {
                        enabled: getValue('tvdbSource.enabled'),
                        category: getValue('tvdbSource.category'),
                        // Fixed limits; omit from payload
                        minRating: getValue('tvdbSource.minRating', 'number'),
                        yearFilter: getValue('tvdbSource.yearFilter', 'number'),
                    },
                    streamingSources: {
                        enabled: getValue('streamingSources.enabled'),
                        region: getValue('streamingSources.region'),
                        // Fixed per-provider; omit from payload
                        minRating: getValue('streamingSources.minRating', 'number'),
                        netflix: getValue('streamingSources.netflix'),
                        disney: getValue('streamingSources.disney'),
                        prime: getValue('streamingSources.prime'),
                        hbo: getValue('streamingSources.hbo'),
                        newReleases: getValue('streamingSources.newReleases'),
                    },
                    siteServer: {
                        enabled: getValue('siteServer.enabled'),
                        port: getValue('siteServer.port', 'number') || 4001,
                    },
                };

                const newEnv = {
                    SERVER_PORT: getValue('SERVER_PORT'),
                    DEBUG: String(getValue('DEBUG')), // .env values must be strings
                    PLEX_HOSTNAME: getValue('mediaServers[0].hostname'),
                    PLEX_PORT: getValue('mediaServers[0].port'),
                };

                // Only include the token if the user has entered a new one.
                // This prevents overwriting the existing token with an empty string.
                const plexToken = getValue('mediaServers[0].token');
                if (plexToken) {
                    newEnv.PLEX_TOKEN = plexToken;
                }

                // Create a version of the config that doesn't include null values.
                const cleanedConfig = cleanNulls(newConfig);

                // Coordinate with auto-save to avoid race
                window.__saveCoordinator = window.__saveCoordinator || {
                    manualInProgress: false,
                    lastRequestAt: 0,
                    lastManualAt: 0,
                };
                window.__saveCoordinator.manualInProgress = true;
                // Don't set lastRequestAt for manual saves - only auto-saves use this for rate limiting

                // Debug: Log request data
                logger.debug('🔍 Saving config with data:', {
                    configSize: JSON.stringify(cleanedConfig).length,
                    envSize: JSON.stringify(newEnv).length,
                    totalSize: JSON.stringify({ config: cleanedConfig, env: newEnv }).length,
                });

                const requestBody = JSON.stringify({ config: cleanedConfig, env: newEnv });

                // If request is large, add additional headers to help with HTTP/2 issues
                const requestOptions = {
                    method: 'POST',
                    body: requestBody,
                };

                if (requestBody.length > 50000) {
                    logger.warn('⚠️ Large request detected, adding HTTP/2 compatibility headers');
                    requestOptions.headers = {
                        'Content-Length': requestBody.length.toString(),
                        'Transfer-Encoding': 'chunked',
                    };
                }

                // Retry mechanism for network errors
                let lastError;
                let retryCount = 0;
                const maxRetries = 3;

                while (retryCount <= maxRetries) {
                    try {
                        if (retryCount > 0) {
                            buttonTextSpan.textContent = `Retrying... (${retryCount}/${maxRetries})`;
                            await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
                        }

                        const response = await authenticatedFetch(
                            apiUrl('/api/admin/config'),
                            requestOptions
                        );

                        if (!response.ok) {
                            // Try to get error message from response
                            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                            try {
                                const errorResult = await response.json();
                                if (errorResult.error) {
                                    errorMessage = errorResult.error;
                                }
                            } catch (jsonError) {
                                // If response is not JSON, use status text
                                logger.warn('Response is not JSON, using status text as error');
                            }

                            // Retry on 502 Bad Gateway or 503 Service Unavailable
                            if (
                                (response.status === 502 || response.status === 503) &&
                                retryCount < maxRetries
                            ) {
                                lastError = new Error(errorMessage);
                                retryCount++;
                                continue;
                            }

                            throw new Error(errorMessage);
                        }

                        await response.json();

                        // Config saved successfully - check if restart is needed
                        showNotification('Settings saved successfully!', 'success');

                        // Refresh rating filters in case server enabled/disabled status changed
                        if (typeof refreshRatingFilters === 'function') {
                            await refreshRatingFilters();
                        }

                        // Compute restart requirement against snapshot-before-save
                        const preSaveValues = { ...originalConfigValues };
                        const postSaveValues = captureFormState();

                        // Persist restart requirement: if it was already visible, keep it visible after save
                        const wasVisible =
                            sessionStorage.getItem('restartButtonVisible') === 'true';
                        if (needsRestartChange(preSaveValues, postSaveValues) || wasVisible) {
                            showRestartButton();
                        } else {
                            hideRestartButton();
                        }

                        // Update original values after successful save
                        originalConfigValues = postSaveValues;

                        if (window.__saveCoordinator) {
                            window.__saveCoordinator.lastManualAt = Date.now();
                        }
                        // Notify form tracking listeners
                        document.dispatchEvent(new CustomEvent('configSaved'));
                        return; // Success - exit retry loop
                    } catch (error) {
                        lastError = error;

                        // Check if this is a retryable error
                        const isRetryable =
                            error.message.includes('502') ||
                            error.message.includes('503') ||
                            error.message.includes('Failed to fetch') ||
                            error.message.includes('ERR_HTTP2_PROTOCOL_ERROR');

                        if (isRetryable && retryCount < maxRetries) {
                            retryCount++;
                            continue;
                        }

                        // Not retryable or max retries reached
                        break;
                    }
                }

                // If we get here, all retries failed
                throw lastError;
            } catch (error) {
                console.error('Failed to save config:', error);
                showNotification(`Error saving settings: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
                buttonTextSpan.textContent = originalButtonText;
                if (window.__saveCoordinator) {
                    window.__saveCoordinator.manualInProgress = false;
                }
            }
        });
    }

    /**
     * Force-enables the refresh media button.
     * This is a workaround to enable it even if the connection test fails,
     * allowing users to trigger a refresh manually.
     */
    const changePasswordButton = document.getElementById('change-password-button');
    if (changePasswordButton) {
        addConfirmClickHandler(changePasswordButton, 'Change password?', async () => {
            setButtonState(changePasswordButton, 'loading', { text: 'Changing...' });
            const currentPasswordInput = document.getElementById('currentPassword');
            const newPasswordInput = document.getElementById('newPassword');
            const confirmPasswordInput = document.getElementById('confirmPassword');

            try {
                const data = {
                    currentPassword: currentPasswordInput.value,
                    newPassword: newPasswordInput.value,
                    confirmPassword: confirmPasswordInput.value,
                };

                // Client-side validation
                if (!data.currentPassword || !data.newPassword || !data.confirmPassword) {
                    throw new Error('All password fields are required.');
                }

                if (data.newPassword.length < 8) {
                    throw new Error('New password must be at least 8 characters long.');
                }

                if (data.newPassword !== data.confirmPassword) {
                    throw new Error('New password and confirmation do not match.');
                }
                if (data.currentPassword === data.newPassword) {
                    throw new Error('New password must be different from the current password.');
                }

                const response = await fetch('/api/admin/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to change password.');

                setButtonState(changePasswordButton, 'success', { text: 'Changed!' });
                showNotification('Password changed successfully!', 'success');
                if (currentPasswordInput) currentPasswordInput.value = '';
                if (newPasswordInput) newPasswordInput.value = '';
                if (confirmPasswordInput) confirmPasswordInput.value = '';
            } catch (error) {
                setButtonState(changePasswordButton, 'error', { text: 'Failed' });
                showNotification(`Error: ${error.message}`, 'error');
            } finally {
                // Revert button state after a short delay
                setTimeout(() => setButtonState(changePasswordButton, 'revert'), 3000);
            }
        });
    }

    /**
     * Manages the visual state of a button during an async operation.
     * Stores the original state in data attributes to easily revert.
     * @param {HTMLButtonElement} button The button element.
     * @param {'loading' | 'success' | 'error' | 'revert'} state The state to set.
     * @param {object} [options] Options for text and classes.
     * @param {string} [options.text] Text for the new state.
     * @param {string} [options.iconClass] FontAwesome class for the new state.
     * @param {string} [options.buttonClass] Bulma class for the new state (e.g., 'is-success').
     */
    function setButtonState(button, state, options = {}) {
        const buttonTextSpan = button.querySelector('span:last-child');
        const icon = button.querySelector('.icon i');

        // Store original state if not already stored
        if (!button.dataset.originalText) {
            button.dataset.originalText = buttonTextSpan
                ? buttonTextSpan.textContent
                : button.textContent;
            button.dataset.originalIconClass = icon ? icon.className : '';
            button.dataset.originalButtonClass = button.className;
        }

        switch (state) {
            case 'loading':
                button.disabled = true;
                if (buttonTextSpan) {
                    buttonTextSpan.textContent = options.text || 'Working...';
                } else {
                    button.textContent = options.text || 'Working...';
                }
                if (icon) {
                    icon.className = options.iconClass || 'fas fa-spinner fa-spin';
                }
                button.className = button.dataset.originalButtonClass;
                break;
            case 'success':
            case 'error':
                button.disabled = true; // Keep disabled until revert
                if (buttonTextSpan) {
                    buttonTextSpan.textContent =
                        options.text || (state === 'success' ? 'Success!' : 'Failed');
                } else {
                    button.textContent =
                        options.text || (state === 'success' ? 'Success!' : 'Failed');
                }
                if (icon) {
                    icon.className =
                        options.iconClass ||
                        (state === 'success' ? 'fas fa-check' : 'fas fa-exclamation-triangle');
                }
                button.className = `${button.dataset.originalButtonClass} ${options.buttonClass || (state === 'success' ? 'is-success' : 'is-danger')}`;
                break;
            case 'revert':
                button.disabled = false;
                if (buttonTextSpan) {
                    buttonTextSpan.textContent = button.dataset.originalText;
                } else {
                    button.textContent = button.dataset.originalText;
                }
                if (icon) {
                    icon.className = button.dataset.originalIconClass;
                }
                button.className = button.dataset.originalButtonClass;
                break;
        }
    }

    const restartButton = document.getElementById('restart-app-button');
    if (restartButton) {
        addConfirmClickHandler(restartButton, 'Are you sure? Click again', async () => {
            // Block restart if there are unsaved changes
            if (typeof window.hasUnsavedChanges === 'function' && window.hasUnsavedChanges()) {
                showNotification('Please save your changes first, then restart.', 'warning');
                return;
            }
            setButtonState(restartButton, 'loading', { text: 'Restarting...' });

            const handleRestartInitiated = message => {
                showNotification(message || 'Restart initiated.', 'success');
                // After a short delay, show completion and then re-enable for another attempt without full page reload.
                setTimeout(() => {
                    showNotification(
                        'Restart complete (refresh page if UI seems stale).',
                        'success'
                    );
                    setButtonState(restartButton, 'success', { text: 'Restart Complete' });
                    // Revert after a further delay so user can restart again later if needed.
                    setTimeout(() => setButtonState(restartButton, 'revert'), 4000);
                }, 2500);
            };

            try {
                const response = await fetch('/api/admin/restart-app', { method: 'POST' });
                const result = await response.json();

                if (!response.ok) {
                    // This will now catch genuine errors returned by the server before the restart is attempted.
                    throw new Error(
                        result.error || 'Could not send restart command to the server.'
                    );
                }
                // The server now guarantees a response before restarting, so we can trust the result.
                handleRestartInitiated(result.message);
            } catch (error) {
                // Any error here is now a real error, not an expected one.
                console.error('[Admin] Error during restart request:', error);
                showNotification(`Error restarting: ${error.message}`, 'error');
                setButtonState(restartButton, 'revert');
            }
        });
    }

    // Status Check Button
    const statusCheckButton = document.getElementById('status-check-button');
    if (statusCheckButton) {
        statusCheckButton.addEventListener('click', async () => {
            setButtonState(statusCheckButton, 'loading', { text: 'Checking...' });

            try {
                await performStatusCheck();
                setButtonState(statusCheckButton, 'success', { text: 'Status Checked' });
                setTimeout(() => setButtonState(statusCheckButton, 'revert'), 2000);
            } catch (error) {
                console.error('[Admin] Error during status check:', error);
                showNotification(`Error checking status: ${error.message}`, 'error');
                setButtonState(statusCheckButton, 'revert');
            }
        });
    }

    // Update Check Button - REMOVED (functionality moved to Automatic Updates section)
    // const updateCheckButton = document.getElementById('update-check-button');
    // Button removed from HTML to avoid duplication with Automatic Updates

    // Performance Monitor Button
    const performanceMonitorButton = document.getElementById('performance-monitor-button');
    if (performanceMonitorButton) {
        performanceMonitorButton.addEventListener('click', async () => {
            setButtonState(performanceMonitorButton, 'loading', { text: 'Loading...' });

            try {
                await loadPerformanceMonitor();
                setButtonState(performanceMonitorButton, 'success', { text: 'Monitor Loaded' });
                setTimeout(() => setButtonState(performanceMonitorButton, 'revert'), 2000);
            } catch (error) {
                console.error('[Admin] Error loading performance monitor:', error);
                showNotification(`Error loading performance data: ${error.message}`, 'error');
                setButtonState(performanceMonitorButton, 'revert');
            }
        });
    }

    // Auto-Update: Start Auto-Update Button - NUCLEAR OPTION: Clear all existing listeners
    const startAutoUpdateButton = document.getElementById('start-auto-update-button');
    if (startAutoUpdateButton) {
        // Remove any existing event listeners by cloning the element
        const newButton = startAutoUpdateButton.cloneNode(true);
        startAutoUpdateButton.parentNode.replaceChild(newButton, startAutoUpdateButton);

        // Add single clean event listener
        newButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            // Check if button is in updating state
            if (newButton.getAttribute('data-updating') === 'true') {
                return;
            }

            // Open the confirmation modal
            openUpdateConfirmationModal();
        });
    }

    // Auto-Update: Rollback Button
    const rollbackUpdateButton = document.getElementById('rollback-update-button');
    if (rollbackUpdateButton) {
        rollbackUpdateButton.addEventListener('click', rollbackUpdate);
    }

    // Auto-Update: List Backups Button
    const listBackupsButton = document.getElementById('list-backups-button');
    if (listBackupsButton) {
        listBackupsButton.addEventListener('click', async () => {
            setButtonState(listBackupsButton, 'loading', { text: 'Loading...' });

            try {
                await loadBackupList();
                setButtonState(listBackupsButton, 'success', { text: 'Backups Loaded' });
                setTimeout(() => setButtonState(listBackupsButton, 'revert'), 2000);
            } catch (error) {
                console.error('[Admin] Error loading backups:', error);
                showNotification(`Error loading backups: ${error.message}`, 'error');
                setButtonState(listBackupsButton, 'revert');
            }
        });
    }

    const refreshMediaButton = document.getElementById('refresh-media-button');
    if (refreshMediaButton) {
        refreshMediaButton.addEventListener('click', async () => {
            setButtonState(refreshMediaButton, 'loading', { text: 'Refreshing...' });

            logger.debug(
                '[Admin Debug] "Refresh Media" button clicked. Preparing to call API endpoint.'
            );

            try {
                logger.debug('[Admin Debug] Sending POST request to /api/admin/refresh-media');
                const response = await fetch('/api/admin/refresh-media', { method: 'POST' });

                if (!response.ok) {
                    console.error(
                        `[Admin Debug] API call failed. Status: ${response.status} ${response.statusText}`
                    );
                    let errorMsg = `HTTP error! Status: ${response.status}`;
                    try {
                        const errorResult = await response.json();
                        errorMsg = errorResult.error || errorMsg;
                    } catch (e) {
                        // Fallback if response is not JSON (e.g., HTML error page)
                        errorMsg = response.statusText || errorMsg;
                    }

                    if (response.status === 401) {
                        showNotification(
                            'Your session has expired. You will be redirected to the login page.',
                            'error'
                        );
                        setTimeout(() => (window.location.href = '/admin/login'), 2500);
                    }
                    throw new Error(errorMsg);
                }

                logger.debug('[Admin Debug] API call successful. Refreshing background.');
                const result = await response.json();
                showNotification(result.message, 'success');

                // Also refresh the admin background to show new items
                adminBgQueue = [];
                initializeAdminBackground();
            } catch (error) {
                console.error('[Admin] Error during media refresh:', error);
                showNotification(`Error refreshing: ${error.message}`, 'error');
            } finally {
                // Restore button state after a short delay to show completion
                setTimeout(() => {
                    setButtonState(refreshMediaButton, 'revert');
                }, 1000);
            }
        });
    }

    const clearCacheButton = document.getElementById('clear-cache-button');
    if (clearCacheButton) {
        addConfirmClickHandler(clearCacheButton, 'Are you sure? Click again', async () => {
            setButtonState(clearCacheButton, 'loading', { text: 'Clearing...' });
            try {
                const response = await fetch('/api/admin/clear-image-cache', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to clear cache.');
                showNotification(result.message, 'success');
                // Refresh cache stats after clearing
                refreshCacheStats();
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
            setTimeout(() => setButtonState(clearCacheButton, 'revert'), 2000);
        });
    }

    // Cache stats refresh button
    const refreshCacheStatsButton = document.getElementById('refresh-cache-stats');
    if (refreshCacheStatsButton) {
        refreshCacheStatsButton.addEventListener('click', async () => {
            setButtonState(refreshCacheStatsButton, 'loading', { text: 'Refreshing...' });
            await refreshCacheStats();
            setTimeout(() => setButtonState(refreshCacheStatsButton, 'revert'), 1000);
        });
    }

    // Cache cleanup button
    const cleanupCacheButton = document.getElementById('cleanup-cache-button');
    if (cleanupCacheButton) {
        cleanupCacheButton.addEventListener('click', async () => {
            setButtonState(cleanupCacheButton, 'loading', { text: 'Cleaning...' });
            try {
                const response = await fetch('/api/admin/cleanup-cache', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to cleanup cache.');
                showNotification(result.message, 'success');
                // Refresh cache stats after cleanup
                refreshCacheStats();
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
            setTimeout(() => setButtonState(cleanupCacheButton, 'revert'), 2000);
        });
    }

    /**
     * Setup event listeners for cache configuration inputs
     */
    function setupCacheConfigEventListeners() {
        logger.debug('[Cache Config] Cache configuration fields have been removed from UI');

        // Since cache configuration fields have been removed, just log that cache is auto-managed
        logger.debug(
            '[Cache Config] Cache is auto-managed with fixed settings: 2GB max, 500MB min free space'
        );

        // Clean up any existing auto-managed notices (user requested removal)
        const existingNotices = document.querySelectorAll('.auto-managed-notice');
        existingNotices.forEach(notice => notice.remove());
    }

    // Load cache stats when Management section is first accessed
    // Test: Also load stats on page load for debugging
    setTimeout(() => {
        // Also test if DOM elements exist
        const diskUsageElement = document.getElementById('cache-disk-usage');
        const itemCountElement = document.getElementById('cache-item-count');
        if (diskUsageElement && itemCountElement) {
            loadCacheStats();
        }
    }, 2000);

    updateApiKeyStatus();

    // Preview functionality removed

    function updatePreviewOrientation() {
        /* removed */
    }

    // Removed preview timer logic

    function clearAllPreviewTimers() {
        /* removed */
    }

    function setupCinemaModeListeners() {
        const cinemaModeCheckbox = document.getElementById('cinemaMode');
        const cinemaOrientationGroup = document.getElementById('cinemaOrientationGroup');
        const cinemaOrientationSelect = document.getElementById('cinemaOrientation');

        if (cinemaModeCheckbox) {
            cinemaModeCheckbox.addEventListener('change', () => {
                isCinemaMode = cinemaModeCheckbox.checked;

                // Handle mutual exclusivity with Wallart Mode
                const wallartModeCheckbox = document.getElementById('wallartModeEnabled');

                if (isCinemaMode) {
                    // Disable and hide Wallart Mode subsection when Cinema Mode is enabled
                    if (wallartModeCheckbox) {
                        wallartModeCheckbox.checked = false;
                        wallartModeCheckbox.disabled = true;

                        // Hide wallart settings if they were visible
                        const wallartSettingsGroup =
                            document.getElementById('wallartSettingsGroup');
                        if (wallartSettingsGroup) {
                            wallartSettingsGroup.classList.add('hidden');
                            wallartSettingsGroup.style.display = 'none';
                        }
                    }
                    // Find and hide the Wallart Mode subsection (header + content)
                    const wallartHeaders = document.querySelectorAll('.subsection-header');
                    wallartHeaders.forEach(header => {
                        if (header.textContent.includes('Wallart Mode')) {
                            header.style.display = 'none';
                            const wallartContent = header.nextElementSibling;
                            if (
                                wallartContent &&
                                wallartContent.classList.contains('subsection-content')
                            ) {
                                wallartContent.style.display = 'none';
                            }
                        }
                    });
                } else {
                    // Re-enable and show Wallart Mode subsection when Cinema Mode is disabled
                    if (wallartModeCheckbox) {
                        wallartModeCheckbox.disabled = false;
                    }
                    // Find and show the Wallart Mode subsection again
                    const wallartHeaders = document.querySelectorAll('.subsection-header');
                    wallartHeaders.forEach(header => {
                        if (header.textContent.includes('Wallart Mode')) {
                            header.style.display = 'block';
                            const wallartContent = header.nextElementSibling;
                            if (
                                wallartContent &&
                                wallartContent.classList.contains('subsection-content')
                            ) {
                                wallartContent.style.display = 'block';
                            }
                        }
                    });
                    // Don't automatically show wallart settings - let the checkbox state control it
                }

                // Hide/Show sections that don't apply to Cinema Mode
                const sectionsToHide = [
                    'Visual Elements',
                    'UI Element Scaling',
                    'Effects & Transitions',
                    'Playback Timing',
                ];
                sectionsToHide.forEach(sectionName => {
                    const headers = document.querySelectorAll('.subsection-header');
                    headers.forEach(header => {
                        if (header.textContent.includes(sectionName)) {
                            const display = isCinemaMode ? 'none' : 'block';
                            header.style.display = display;
                            const content = header.nextElementSibling;
                            if (content && content.classList.contains('subsection-content')) {
                                content.style.display = display;
                            }
                        }
                    });
                });

                // Also handle Effects & Transitions by ID (fallback)
                const effectsHeader = document.getElementById('effectsHeader');
                const effectsContent = document.getElementById('effectsContent');
                if (effectsHeader && effectsContent) {
                    const display = isCinemaMode ? 'none' : 'block';
                    effectsHeader.style.display = display;
                    effectsContent.style.display = display;
                }

                // Update spacing for first visible subsection
                updateFirstVisibleSubsectionSpacing();

                // Show/hide orientation settings
                if (cinemaOrientationGroup) {
                    cinemaOrientationGroup.style.display = isCinemaMode ? 'block' : 'none';
                }

                // Show/hide irrelevant display settings for cinema mode
                toggleCinemaModeSettings(isCinemaMode);

                // Update preview orientation
                updatePreviewOrientation();

                logger.debug('Cinema mode toggled:', isCinemaMode ? 'enabled' : 'disabled');
            });

            // Initial state handled once inside populateDisplaySettings to avoid duplicate invocation here.
        }

        // Add event listener for Wallart Mode mutual exclusivity
        const wallartModeCheckbox = document.getElementById('wallartModeEnabled');
        if (wallartModeCheckbox) {
            wallartModeCheckbox.addEventListener('change', () => {
                const isWallartMode = wallartModeCheckbox.checked;

                // Handle mutual exclusivity with Cinema Mode
                const cinemaModeCheckbox = document.getElementById('cinemaMode');

                if (isWallartMode) {
                    // Disable and hide Cinema Mode subsection when Wallart Mode is enabled
                    if (cinemaModeCheckbox) {
                        cinemaModeCheckbox.checked = false;
                        cinemaModeCheckbox.disabled = true;
                        isCinemaMode = false;

                        // Hide cinema settings if they were visible
                        const cinemaOrientationGroup =
                            document.getElementById('cinemaOrientationGroup');
                        if (cinemaOrientationGroup) {
                            cinemaOrientationGroup.style.display = 'none';
                        }

                        // Reset cinema mode settings
                        toggleCinemaModeSettings(false);
                        updatePreviewOrientation();
                    }
                    // Find and hide the Cinema Mode subsection (header + content)
                    const cinemaHeaders = document.querySelectorAll('.subsection-header');
                    cinemaHeaders.forEach(header => {
                        if (header.textContent.includes('Cinema Mode')) {
                            header.style.display = 'none';
                            const cinemaContent = header.nextElementSibling;
                            if (
                                cinemaContent &&
                                cinemaContent.classList.contains('subsection-content')
                            ) {
                                cinemaContent.style.display = 'none';
                            }
                        }
                    });
                } else {
                    // Re-enable and show Cinema Mode subsection when Wallart Mode is disabled
                    if (cinemaModeCheckbox) {
                        cinemaModeCheckbox.disabled = false;
                    }
                    // Find and show the Cinema Mode subsection again
                    const cinemaHeaders = document.querySelectorAll('.subsection-header');
                    cinemaHeaders.forEach(header => {
                        if (header.textContent.includes('Cinema Mode')) {
                            header.style.display = 'block';
                            const cinemaContent = header.nextElementSibling;
                            if (
                                cinemaContent &&
                                cinemaContent.classList.contains('subsection-content')
                            ) {
                                cinemaContent.style.display = 'block';
                            }
                        }
                    });
                }

                // Hide/Show UI Element Scaling when Wallart mode is toggled
                const scalingHeaders = document.querySelectorAll('.subsection-header');
                scalingHeaders.forEach(header => {
                    if (header.textContent.includes('UI Element Scaling')) {
                        const display = isWallartMode ? 'none' : 'block';
                        header.style.display = display;
                        const scalingContent = header.nextElementSibling;
                        if (
                            scalingContent &&
                            scalingContent.classList.contains('subsection-content')
                        ) {
                            scalingContent.style.display = display;
                        }
                    }
                });

                // Hide/Show Playback Timing when Wallart mode is toggled
                const timingHeaders = document.querySelectorAll('.subsection-header');
                timingHeaders.forEach(header => {
                    if (header.textContent.includes('Playback Timing')) {
                        const display = isWallartMode ? 'none' : 'block';
                        header.style.display = display;
                        const timingContent = header.nextElementSibling;
                        if (
                            timingContent &&
                            timingContent.classList.contains('subsection-content')
                        ) {
                            timingContent.style.display = display;
                        }
                    }
                });

                // Update spacing for first visible subsection
                updateFirstVisibleSubsectionSpacing();

                logger.debug('Wallart mode toggled:', isWallartMode ? 'enabled' : 'disabled');
            });
        }

        // Add event listener for cinema orientation changes
        if (cinemaOrientationSelect) {
            cinemaOrientationSelect.addEventListener('change', () => {
                logger.debug('Cinema orientation changed:', cinemaOrientationSelect.value);
                updatePreviewOrientation();
            });
        }
    }

    function setupWallartModeListeners() {
        const wallartModeCheckbox = document.getElementById('wallartModeEnabled');
        const wallartSettingsGroup = document.getElementById('wallartSettingsGroup');
        const randomnessSlider = document.getElementById('wallartRandomness');

        if (wallartModeCheckbox) {
            wallartModeCheckbox.addEventListener('change', () => {
                const isWallartMode = wallartModeCheckbox.checked;

                // Show/hide wallart settings
                const wallartControlsGroup = document.getElementById('wallartControlsGroup');
                if (wallartSettingsGroup) {
                    wallartSettingsGroup.style.display = isWallartMode ? 'block' : 'none';
                    if (isWallartMode) {
                        wallartSettingsGroup.classList.remove('hidden');
                    } else {
                        wallartSettingsGroup.classList.add('hidden');
                    }
                }
                if (wallartControlsGroup) {
                    wallartControlsGroup.style.display = isWallartMode ? 'block' : 'none';
                    if (isWallartMode) {
                        wallartControlsGroup.classList.remove('hidden');
                    } else {
                        wallartControlsGroup.classList.add('hidden');
                    }
                }

                // Show/hide cinema mode and visual elements when wallart mode is active
                toggleWallartModeSettings(isWallartMode);

                // Also hide/show Effects & Transitions subsection
                const effectsHeader = document.getElementById('effectsHeader');
                const effectsContent = document.getElementById('effectsContent');
                if (effectsHeader && effectsContent) {
                    const display = isWallartMode ? 'none' : 'block';
                    effectsHeader.style.display = display;
                    effectsContent.style.display = display;
                }

                logger.debug('Wallart mode toggled:', isWallartMode ? 'enabled' : 'disabled');
            });
        }

        // Setup randomness slider
        if (randomnessSlider) {
            // Initialize background
            updateSliderBackground(randomnessSlider);
            updateRandomnessLabel(randomnessSlider.value);

            randomnessSlider.addEventListener('input', () => {
                updateRandomnessLabel(randomnessSlider.value);
                updateSliderBackground(randomnessSlider);
            });
        }

        // Setup refresh rate slider
        const refreshRateSlider = document.getElementById('wallartRefreshRate');
        if (refreshRateSlider) {
            // Initialize background
            updateSliderBackground(refreshRateSlider);
            updateRefreshRateLabel(refreshRateSlider.value);

            refreshRateSlider.addEventListener('input', () => {
                updateRefreshRateLabel(refreshRateSlider.value);
                updateSliderBackground(refreshRateSlider);
            });
        }
    }

    function toggleWallartModeSettings(isWallartMode) {
        // Hide Cinema Mode section when wallart mode is active
        const cinemaModeHeader = document.getElementById('cinemaModeHeader');
        const cinemaModeContent = document.getElementById('cinemaModeContent');

        if (cinemaModeHeader && cinemaModeContent) {
            cinemaModeHeader.style.display = isWallartMode ? 'none' : 'block';
            cinemaModeContent.style.display = isWallartMode ? 'none' : 'block';
        }

        // Hide Visual Elements section when wallart mode is active
        const visualElementsHeader = document.getElementById('visualElementsHeader');
        const visualElementsContent = document.getElementById('visualElementsContent');

        if (visualElementsHeader && visualElementsContent) {
            visualElementsHeader.style.display = isWallartMode ? 'none' : 'block';
            visualElementsContent.style.display = isWallartMode ? 'none' : 'block';
        }

        // If wallart mode is enabled, disable cinema mode
        if (isWallartMode) {
            const cinemaModeCheckbox = document.getElementById('cinemaMode');
            if (cinemaModeCheckbox && cinemaModeCheckbox.checked) {
                cinemaModeCheckbox.checked = false;
                // Reset cinema mode settings
                toggleCinemaModeSettings(false);
            }
        }
    }

    function toggleCinemaModeSettings(isCinemaMode) {
        // Preserve user preference for Ken Burns effect when toggling cinema mode
        const transitionEffectSelect = document.getElementById('transitionEffect');
        if (
            !isCinemaMode &&
            transitionEffectSelect &&
            transitionEffectSelect.value === 'kenburns'
        ) {
            window.__wantedKenBurnsBeforeCinema = true;
        }
        // Elements to hide in cinema mode (these are not applicable)
        const elementsToHide = [
            'showClearLogo',
            'showRottenTomatoes',
            'rottenTomatoesMinimumScore',
            'showPoster',
            'showMetadata',
        ];

        // Hide/show individual form groups
        elementsToHide.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                const formGroup = element.closest('.form-group');
                if (formGroup) {
                    formGroup.style.display = isCinemaMode ? 'none' : 'block';
                }
            }
        });

        // Handle Ken Burns option with restoration after exiting cinema mode
        if (transitionEffectSelect) {
            const kenBurnsOption = transitionEffectSelect.querySelector('option[value="kenburns"]');
            if (kenBurnsOption) {
                if (isCinemaMode) {
                    kenBurnsOption.style.display = 'none';
                    if (transitionEffectSelect.value === 'kenburns') {
                        window.__wantedKenBurnsBeforeCinema = true; // remember preference
                        transitionEffectSelect.value = 'fade';
                        logger.debug('[CinemaMode] Temporarily switched Ken Burns to Fade');
                    }
                } else {
                    kenBurnsOption.style.display = 'block';
                    if (window.__wantedKenBurnsBeforeCinema) {
                        transitionEffectSelect.value = 'kenburns';
                        delete window.__wantedKenBurnsBeforeCinema;
                    }
                }
            }
        }

        // Hide entire UI Scaling section in cinema mode
        const uiScalingSections = document.querySelectorAll('.form-section h3');
        let uiScalingSection = null;
        uiScalingSections.forEach(h3 => {
            if (h3.textContent.includes('UI Element Scaling')) {
                uiScalingSection = h3;
            }
        });
        if (uiScalingSection) {
            const scalingSection = uiScalingSection.closest('.form-section');
            if (scalingSection) {
                scalingSection.style.display = isCinemaMode ? 'none' : 'block';
            }
        }

        // Add visual indication for cinema mode
        const displaySettingsHeaders = document.querySelectorAll('h2');
        let displaySettingsHeader = null;
        displaySettingsHeaders.forEach(header => {
            if (header.textContent.includes('Display Settings')) {
                displaySettingsHeader = header;
            }
        });

        if (displaySettingsHeader) {
            const existingIndicator =
                displaySettingsHeader.parentNode.querySelector('.cinema-mode-subtitle');

            if (isCinemaMode) {
                if (!existingIndicator) {
                    // Create subtitle element
                    const subtitle = document.createElement('div');
                    subtitle.className = 'cinema-mode-subtitle';
                    subtitle.textContent = 'Cinema Mode Active';
                    subtitle.style.cssText = `
                        color: #e28743;
                        font-size: 0.9em;
                        font-weight: 500;
                        margin-top: -8px;
                        margin-bottom: 16px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        opacity: 0.9;
                    `;

                    // Insert after the h2 header
                    displaySettingsHeader.parentNode.insertBefore(
                        subtitle,
                        displaySettingsHeader.nextSibling
                    );
                }
            } else {
                if (existingIndicator) {
                    existingIndicator.remove();
                }
            }
        }
    }

    function updateFirstVisibleSubsectionSpacing() {
        // Only target Wallart Mode and Cinema Mode subsection headers specifically
        const wallartHeader =
            document.querySelector(
                '.subsection-header:has(+ .subsection-content [id="wallartModeEnabled"])'
            ) ||
            document.querySelector('[id="wallartModeHeader"]') ||
            Array.from(document.querySelectorAll('.subsection-header')).find(h =>
                h.textContent.includes('Wallart Mode')
            );

        const cinemaHeader =
            document.querySelector(
                '.subsection-header:has(+ .subsection-content [id="cinemaMode"])'
            ) ||
            document.querySelector('[id="cinemaModeHeader"]') ||
            Array.from(document.querySelectorAll('.subsection-header')).find(h =>
                h.textContent.includes('Cinema Mode')
            );

        // Reset both headers first
        [wallartHeader, cinemaHeader].forEach(header => {
            if (header) {
                header.classList.remove('first-visible');
                header.style.marginTop = '';
            }
        });

        // Find which one is visible and should be first
        const headers = [wallartHeader, cinemaHeader].filter(h => h);
        const visibleHeaders = headers.filter(header => {
            const displayStyle = header.style.display;
            const computedStyle = window.getComputedStyle(header);
            const isVisible =
                (displayStyle !== 'none' && computedStyle.display !== 'none') ||
                displayStyle === 'block';
            return isVisible;
        });

        if (visibleHeaders.length > 0) {
            const firstVisible = visibleHeaders[0];
            firstVisible.style.setProperty('margin-top', '0px', 'important');
            firstVisible.classList.add('first-visible');
        }
    }

    function toggleEffectPauseTime() {
        const transitionEffectSelect = document.getElementById('transitionEffect');
        const effectPauseTimeElement = document.getElementById('effectPauseTime');

        if (transitionEffectSelect && effectPauseTimeElement) {
            const isKenBurns = transitionEffectSelect.value === 'kenburns';
            const formGroup = effectPauseTimeElement.closest('.form-group');

            if (formGroup) {
                formGroup.style.display = isKenBurns ? 'none' : 'block';
            }
            // Force the value to 0 when Ken Burns is selected so saves/preview reflect it immediately
            if (isKenBurns) {
                effectPauseTimeElement.value = '0';
            }
        }
    }

    // applyScalingToPreview removed (no preview UI)

    // Save configuration without showing notifications and clear cache
    window.saveConfigurationSilently = async function saveConfigurationSilently() {
        // Coordinated auto-save to avoid race with manual save
        window.__saveCoordinator = window.__saveCoordinator || {
            manualInProgress: false,
            autoInProgress: false,
            pending: false,
            lastManualAt: 0,
            lastAutoAt: 0,
            lastRequestAt: 0,
        };
        const state = window.__saveCoordinator;

        // Add rate limiting: don't allow AUTO-SAVE requests more than once per second
        // (Manual saves should not be rate limited)
        const now = Date.now();
        if (now - state.lastRequestAt < 1000) {
            logger.debug('⏳ Rate limiting: skipping auto-save (too soon since last request)');
            return;
        }

        // If a manual save just happened (<2s), skip auto-save
        if (now - state.lastManualAt < 2000) {
            logger.debug('⏳ Skipping auto-save: manual save happened recently');
            return;
        }
        // If another auto save is running, mark pending and exit
        if (state.autoInProgress || state.manualInProgress) {
            state.pending = true;
            return;
        }
        state.autoInProgress = true;
        state.pending = false;
        state.lastRequestAt = now;

        try {
            // Fetch latest to merge safely
            const currentConfigResponse = await fetch('/api/admin/config');
            if (!currentConfigResponse.ok) {
                console.error('Auto-save: failed to fetch current config for merge');
                return;
            }
            const currentData = await currentConfigResponse.json();
            const configData = JSON.parse(JSON.stringify(currentData.config));
            const envData = { ...currentData.env };

            const displayInputs = [
                'showClearLogo',
                'showRottenTomatoes',
                'rottenTomatoesMinimumScore',
                'showPoster',
                'showMetadata',
                'clockWidget',
                'clockTimezone',
                'clockFormat',
            ];
            const uiScalingInputs = [
                'uiScaling.content',
                'uiScaling.clearlogo',
                'uiScaling.clock',
                'uiScaling.global',
            ];
            const updates = {};

            displayInputs.forEach(fieldName => {
                const input = document.querySelector(`[name="${fieldName}"]`);
                if (!input) return;
                let newValue;
                if (input.type === 'checkbox') newValue = input.checked;
                else if (input.type === 'number') newValue = parseFloat(input.value) || 0;
                else newValue = input.value;
                if (configData[fieldName] !== newValue) {
                    configData[fieldName] = newValue;
                    updates[fieldName] = newValue;
                }
            });
            if (!configData.uiScaling) configData.uiScaling = {};
            uiScalingInputs.forEach(path => {
                const field = path.split('.')[1];
                const input = document.getElementById(path);
                if (!input) return;
                const trimmed = (input.value || '').trim();
                if (trimmed === '') return; // don't overwrite with default if user cleared
                const parsed = Number(trimmed);
                if (!Number.isFinite(parsed)) return;
                if (configData.uiScaling[field] !== parsed) {
                    configData.uiScaling[field] = parsed;
                    updates[path] = parsed;
                }
            });

            if (Object.keys(updates).length === 0) {
                return; // nothing changed
            }

            const resp = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: configData, env: envData }),
            });
            if (resp.ok) {
                state.lastAutoAt = Date.now();
                document.dispatchEvent(new CustomEvent('configSaved'));
            } else {
                const t = await resp.text();
                console.error('Auto-save failed:', resp.status, resp.statusText, t);
            }
        } catch (err) {
            console.error('Auto-save error:', err);
        } finally {
            state.autoInProgress = false;
            if (state.pending) {
                // Schedule next cycle with microtask + rAF for responsiveness instead of fixed 200ms
                state.pending = false;
                queueMicrotask(() => requestAnimationFrame(() => saveConfigurationSilently()));
            }
        }
    };

    // Debounce function to prevent too many updates
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // (Preview initialization removed)

    function setupUIScalingPresets() {
        // Define preset configurations
        const presets = {
            '4k-tv': {
                name: '4K TV',
                content: 150,
                clearlogo: 140,
                clock: 140,
                global: 100,
            },
            'full-hd': {
                name: 'Full HD',
                content: 100,
                clearlogo: 100,
                clock: 100,
                global: 100,
            },
            ultrawide: {
                name: 'Ultrawide',
                content: 115,
                clearlogo: 120,
                clock: 110,
                global: 100,
            },
        };

        // Setup click handlers for preset buttons (scoped to main Display Settings only)
        const presetButtons = document.querySelectorAll('#display-section .preset-button');
        presetButtons.forEach(button => {
            button.addEventListener('click', async () => {
                const presetKey = button.dataset.preset;
                const preset = presets[presetKey];

                if (!preset) return;

                // Visual feedback
                button.disabled = true;
                const originalHTML = button.innerHTML;
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying...';

                try {
                    // Apply preset values to sliders and prepare config
                    const configUpdate = {
                        'uiScaling.content': preset.content || 100,
                        'uiScaling.clearlogo': preset.clearlogo,
                        'uiScaling.clock': preset.clock,
                        'uiScaling.global': preset.global,
                    };

                    Object.keys(preset).forEach(field => {
                        if (field === 'name') return;

                        const slider = document.getElementById(`uiScaling.${field}`);
                        const percentageDisplay = document.querySelector(
                            `.slider-percentage[data-target="uiScaling.${field}"]`
                        );

                        if (slider && percentageDisplay) {
                            slider.value = preset[field];
                            percentageDisplay.textContent = `${preset[field]}%`;
                            updateSliderBackground(slider);
                        }
                    });

                    // Live preview update for preset application
                    if (typeof window._debouncedPreviewSend === 'function') {
                        window._debouncedPreviewSend();
                    }

                    // Save all preset values using single config call
                    await fetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(configUpdate),
                    });

                    // Show success notification
                    showNotification(`Applied ${preset.name} preset`, 'success');

                    logger.debug(`Applied ${preset.name} preset:`, preset);
                } catch (error) {
                    console.error('Failed to apply preset:', error);
                    showNotification('Failed to apply preset', 'error');
                } finally {
                    // Restore button state
                    setTimeout(() => {
                        button.disabled = false;
                        button.innerHTML = originalHTML;
                    }, 1000);
                }
            });
        });
        // Note: Admin background slideshow is now initialized from loadSettings() when Plex is configured
    }

    // Initialize range slider value displays
    const rangeInputs = document.querySelectorAll('input[type="range"]');
    rangeInputs.forEach(input => {
        const valueDisplay = document.getElementById(input.id + '-value');
        if (valueDisplay) {
            // Update display on input
            input.addEventListener('input', () => {
                valueDisplay.textContent = input.value + '%';
            });
            // Initialize display
            valueDisplay.textContent = input.value + '%';
        }
    });
});

// UI Scaling Template Functions
function applyScalingTemplate(template) {
    const templates = {
        fullhd: {
            poster: 100,
            text: 100,
            clearlogo: 100,
            clock: 100,
            global: 100,
        },
        '4k': {
            poster: 150,
            text: 130,
            clearlogo: 140,
            clock: 120,
            global: 130,
        },
        widescreen: {
            poster: 120,
            text: 110,
            clearlogo: 125,
            clock: 110,
            global: 115,
        },
    };

    const values = templates[template];
    if (values) {
        Object.keys(values).forEach(key => {
            const input = document.getElementById(`uiScaling.${key}`);
            const valueDisplay = document.querySelector(`[data-target="uiScaling.${key}"]`);

            if (input && valueDisplay) {
                input.value = values[key];
                valueDisplay.textContent = values[key] + '%';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }
}

function resetScalingToDefaults() {
    applyScalingTemplate('fullhd');
}

// Custom Number Input Controls
function incrementValue(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const currentValue = parseInt(input.value) || 0;
    const step = parseInt(input.step) || 1;
    const max = parseInt(input.max);

    let newValue = currentValue + step;
    if (max && newValue > max) {
        newValue = max;
    }

    input.value = newValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function decrementValue(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const currentValue = parseInt(input.value) || 0;
    const step = parseInt(input.step) || 1;
    const min = parseInt(input.min);

    let newValue = currentValue - step;
    if (min !== undefined && newValue < min) {
        newValue = min;
    }

    input.value = newValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

// End cleanup: preview/PiP code fully removed

// Event listeners for inline event handler replacements
document.addEventListener('DOMContentLoaded', () => {
    // Number input increment/decrement buttons
    const incrementButtons = document.querySelectorAll('[id^="increment-"]');
    const decrementButtons = document.querySelectorAll('[id^="decrement-"]');

    incrementButtons.forEach(button => {
        button.addEventListener('click', () => {
            const fieldName = button.id.replace('increment-', '');
            incrementValue(fieldName);
        });
    });

    decrementButtons.forEach(button => {
        button.addEventListener('click', () => {
            const fieldName = button.id.replace('decrement-', '');
            decrementValue(fieldName);
        });
    });

    // Scaling template buttons
    const fullhdTemplateBtn = document.getElementById('apply-fullhd-template');
    const fourKTemplateBtn = document.getElementById('apply-4k-template');
    const widescreenTemplateBtn = document.getElementById('apply-widescreen-template');
    const resetScalingBtn = document.getElementById('reset-scaling-defaults');

    if (fullhdTemplateBtn) {
        fullhdTemplateBtn.addEventListener('click', () => applyScalingTemplate('fullhd'));
    }
    if (fourKTemplateBtn) {
        fourKTemplateBtn.addEventListener('click', () => applyScalingTemplate('4k'));
    }
    if (widescreenTemplateBtn) {
        widescreenTemplateBtn.addEventListener('click', () => applyScalingTemplate('widescreen'));
    }
    if (resetScalingBtn) {
        resetScalingBtn.addEventListener('click', () => resetScalingToDefaults());
    }

    // Simple help panel - no complex event listeners needed
    // Button has onclick="toggleHelpPanel()" in HTML
});

// TVDB Connection Test
async function testTVDBConnection() {
    const testButton = document.getElementById('test-tvdb-connection');
    const statusElement = document.getElementById('tvdb-connection-status');

    if (!testButton || !statusElement) return;

    // Disable button and show loading state
    testButton.disabled = true;
    testButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
    statusElement.textContent = 'Testing TVDB connection...';
    statusElement.style.color = '#ffd93d';

    try {
        const response = await fetch('/api/admin/test-tvdb', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const result = await response.json();

        if (response.ok && result.success) {
            statusElement.textContent = `✅ Connection successful! Found ${result.sampleData?.length || 0} sample items.`;
            statusElement.style.color = '#51cf66';
            showNotification('TVDB connection successful', 'success');
        } else {
            showNotification(
                `TVDB connection failed: ${result.error || 'Connection test failed'}`,
                'error'
            );
            return; // Don't show success status, just the toast
        }
    } catch (error) {
        showNotification(`TVDB connection failed: ${error.message}`, 'error');
    } finally {
        // Re-enable button
        testButton.disabled = false;
        testButton.innerHTML = '<i class="fas fa-plug icon"></i><span>Test TVDB Connection</span>';
    }
}

// Add event listener for TVDB test button
document.addEventListener('DOMContentLoaded', () => {
    const testButton = document.getElementById('test-tvdb-connection');
    if (testButton) {
        testButton.addEventListener('click', testTVDBConnection);
    }
});

// ===================================
// Cache Statistics Functions
// ===================================

/**
 * Format bytes into human readable format
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Load cache statistics
 */
async function loadCacheStats() {
    try {
        await refreshCacheStats();
    } catch (error) {
        console.error('Error loading cache stats:', error);
        updateCacheStatsDisplay(
            {
                diskUsage: { total: 0 },
                itemCount: { total: 0 },
            },
            true
        );
    }
}

/**
 * Refresh cache statistics from server
 */
async function refreshCacheStats() {
    try {
        const response = await authenticatedFetch(apiUrlWithCacheBust('/api/admin/cache-stats'), {
            method: 'GET',
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        updateCacheStatsDisplay(data);
    } catch (error) {
        console.error('Error refreshing cache stats:', error);
        updateCacheStatsDisplay(
            {
                diskUsage: { total: 0 },
                itemCount: { total: 0 },
            },
            true
        );
    }
}

/**
 * Update cache statistics display
 */
function updateCacheStatsDisplay(data, isError = false) {
    const diskUsageElement = document.getElementById('cache-disk-usage');
    const itemCountElement = document.getElementById('cache-item-count');

    if (!diskUsageElement || !itemCountElement) {
        // Retry after a delay in case DOM isn't ready
        setTimeout(() => {
            const retryDiskUsage = document.getElementById('cache-disk-usage');
            const retryItemCount = document.getElementById('cache-item-count');
            if (retryDiskUsage && retryItemCount) {
                updateCacheStatsDisplay(data, isError);
            }
        }, 1000);
        return;
    }

    if (isError) {
        diskUsageElement.innerHTML = '<span class="error">Error loading</span>';
        itemCountElement.innerHTML = '<span class="error">Error loading</span>';
        return;
    }

    // Update disk usage with combined format: "1.2 GB / 2.0 GB (24%)"
    const totalSize = data.diskUsage?.total || 0;
    const imageCacheSize = data.diskUsage?.imageCache || 0;
    const logSize = data.diskUsage?.logFiles || 0;

    // Use hardcoded max cache size (2GB)
    const maxSizeGB = 2;
    const maxSizeBytes = maxSizeGB * 1024 * 1024 * 1024; // Convert GB to bytes

    // Calculate usage percentage
    const usagePercentage =
        maxSizeBytes > 0 ? Math.round((imageCacheSize / maxSizeBytes) * 100) : 0;

    diskUsageElement.innerHTML = `
        <div>${formatBytes(imageCacheSize)} / ${formatBytes(maxSizeBytes)} (${usagePercentage}%)</div>
        <div class="size-bytes">Logs: ${formatBytes(logSize)} | Total: ${formatBytes(totalSize)}</div>
    `;

    // Update item count (Memory cache items)
    const totalItems = data.itemCount?.total || 0;

    itemCountElement.innerHTML = `
        <div>${totalItems.toLocaleString()}</div>
        <div class="size-bytes">Active in RAM</div>
    `;
}

/**
 * Load hardcoded cache configuration
 * Cache limits are now fixed and hidden from the UI
 */
async function loadCacheConfig() {
    // Cache configuration fields have been removed from the UI
    // Configuration is now hardcoded in the backend
}

// ===================================
// Global Test Functions for Debugging
// ===================================
// Management Section Observer
// ===================================

// Watch for management section becoming visible
const managementObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const managementSection = document.getElementById('management-section');
            if (managementSection && managementSection.style.display !== 'none') {
                logger.debug(
                    'Management section is now visible, loading cache stats and update status...'
                );
                loadCacheStats();
                loadUpdateStatus();
            }
        }
    });
});

// Start observing when DOM is ready
setTimeout(() => {
    const managementSection = document.getElementById('management-section');
    if (managementSection) {
        managementObserver.observe(managementSection, {
            attributes: true,
            attributeFilter: ['style', 'class'],
        });

        // Check if management section is already visible
        if (
            managementSection.style.display !== 'none' &&
            managementSection.classList.contains('active')
        ) {
            logger.debug(
                'Management section is already visible, loading cache stats and update status...'
            );
            loadCacheStats();
            loadUpdateStatus();
        }
    }
}, 1000);

// ===================================
// System Control Functions
// ===================================

/**
 * Hide all status displays
 */
function hideAllStatusDisplays() {
    // Stop any running auto-refresh when switching displays
    stopAutoRefresh();

    const displays = ['status-display', 'update-display', 'performance-display'];
    displays.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.style.display = 'none';
        }
    });
}

/**
 * Perform system status check
 */
async function performStatusCheck() {
    hideAllStatusDisplays(); // Hide other displays first

    const statusDisplay = document.getElementById('status-display');
    const statusContent = document.getElementById('status-content');

    if (!statusDisplay || !statusContent) return;

    statusDisplay.style.display = 'block';
    statusContent.innerHTML = '<div class="loading">Checking system status...</div>';

    try {
        const response = await fetch('/api/admin/status', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        displayStatusResults(data);

        // Start auto-refresh for status check
        startAutoRefresh('status', 30); // Refresh every 30 seconds
    } catch (error) {
        console.error('Status check failed:', error);
        statusContent.innerHTML = `<div class="status-error">Failed to check system status: ${error.message}</div>`;
    }
}

/**
 * Display status check results
 */
function displayStatusResults(data) {
    const statusContent = document.getElementById('status-content');
    if (!statusContent) return;

    const statusItems = [
        {
            label: 'Application',
            value: data.app?.status || 'Unknown',
            icon: 'fas fa-cog',
            status: data.app?.status === 'running' ? 'success' : 'error',
        },
        {
            label: 'Database',
            value: data.database?.status || 'Unknown',
            icon: 'fas fa-database',
            status: data.database?.status === 'connected' ? 'success' : 'error',
        },
        {
            label: 'Cache',
            value: data.cache?.status || 'Unknown',
            icon: 'fas fa-memory',
            status: data.cache?.status === 'active' ? 'success' : 'warning',
        },
        {
            label: 'Disk Space',
            value: data.disk?.available || 'Unknown',
            icon: 'fas fa-hdd',
            status: data.disk?.status || 'info',
        },
        {
            label: 'Memory Usage',
            value: data.memory?.usage || 'Unknown',
            icon: 'fas fa-microchip',
            status: data.memory?.status || 'info',
        },
        { label: 'Uptime', value: data.uptime || 'Unknown', icon: 'fas fa-clock', status: 'info' },
    ];

    statusContent.innerHTML = `
        <div class="status-grid">
            ${statusItems
                .map(
                    item => `
                <div class="status-item">
                    <div class="status-item-header">
                        <i class="${item.icon}"></i>
                        ${item.label}
                    </div>
                    <div class="status-item-value status-${item.status}">
                        ${item.value}
                    </div>
                </div>
            `
                )
                .join('')}
        </div>
    `;
}

/**
 * Load performance monitoring data
 */
async function loadPerformanceMonitor() {
    hideAllStatusDisplays(); // Hide other displays first

    const performanceDisplay = document.getElementById('performance-display');
    const performanceContent = document.getElementById('performance-content');

    if (!performanceDisplay || !performanceContent) return;

    performanceDisplay.style.display = 'block';
    performanceContent.innerHTML = '<div class="loading">Loading performance data...</div>';

    try {
        const response = await fetch('/api/admin/performance', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        displayPerformanceResults(data);

        // Start auto-refresh for performance monitor
        startAutoRefresh('performance', 5); // Refresh every 5 seconds
    } catch (error) {
        console.error('Performance monitoring failed:', error);
        performanceContent.innerHTML = `<div class="status-error">Failed to load performance data: ${error.message}</div>`;
    }
}

/**
 * Display performance monitoring results
 */
function displayPerformanceResults(data) {
    const performanceContent = document.getElementById('performance-content');
    if (!performanceContent) return;

    const cpu = data.cpu || {};
    const memory = data.memory || {};
    const disk = data.disk || {};

    performanceContent.innerHTML = `
        <div class="performance-metric">
            <div class="metric-label">
                <span><i class="fas fa-microchip"></i> CPU Usage</span>
                <span>${cpu.usage || '0'}%</span>
            </div>
            <div class="metric-bar">
                <div class="metric-fill ${getMetricClass(cpu.usage)}" style="width: ${cpu.usage || 0}%"></div>
            </div>
        </div>
        
        <div class="performance-metric">
            <div class="metric-label">
                <span><i class="fas fa-memory"></i> Memory Usage</span>
                <span>${memory.usage || '0'}% (${memory.used || '0 MB'} / ${memory.total || '0 MB'})</span>
            </div>
            <div class="metric-bar">
                <div class="metric-fill ${getMetricClass(memory.usage)}" style="width: ${memory.usage || 0}%"></div>
            </div>
        </div>
        
        <div class="performance-metric">
            <div class="metric-label">
                <span><i class="fas fa-hdd"></i> Disk Usage</span>
                <span>${disk.usage || '0'}% (${disk.used || '0 GB'} / ${disk.total || '0 GB'})</span>
            </div>
            <div class="metric-bar">
                <div class="metric-fill ${getMetricClass(disk.usage)}" style="width: ${disk.usage || 0}%"></div>
            </div>
        </div>
        
        <div class="status-grid" style="margin-top: 1.5rem;">
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-chart-line"></i>
                    Load Average
                </div>
                <div class="status-item-value status-info">
                    ${cpu.loadAverage || 'N/A'}
                </div>
                <div style="font-size: 0.8rem; color: #b0b0b0; margin-top: 0.5rem;">
                    1min, 5min, 15min averages<br>
                    <span style="color: #4caf50;">< 1.0 = Good</span> | 
                    <span style="color: #ff9800;">1.0-2.0 = Busy</span> | 
                    <span style="color: #f44336;">> 2.0 = Overloaded</span>
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-clock"></i>
                    Uptime
                </div>
                <div class="status-item-value status-info">
                    ${data.uptime || 'N/A'}
                </div>
            </div>
        </div>
    `;
}

/**
 * Get metric class based on usage percentage
 */
function getMetricClass(usage) {
    const usageNum = parseFloat(usage) || 0;
    if (usageNum >= 90) return 'danger';
    if (usageNum >= 70) return 'warning';
    return '';
}

// ===================================
// Auto-refresh functionality
// ===================================

let autoRefreshInterval = null;
let currentAutoRefreshType = null;

/**
 * Start auto-refresh for a specific monitor type
 */
function startAutoRefresh(type, intervalSeconds = 5) {
    // Stop any existing auto-refresh
    stopAutoRefresh();

    currentAutoRefreshType = type;

    autoRefreshInterval = setInterval(() => {
        const display = document.getElementById(`${type}-display`);
        if (display && display.style.display === 'block') {
            logger.debug(`Auto-refreshing ${type} data...`);

            switch (type) {
                case 'performance':
                    loadPerformanceMonitorSilent();
                    break;
                case 'status':
                    performStatusCheckSilent();
                    break;
            }
        } else {
            // Display is no longer visible, stop auto-refresh
            stopAutoRefresh();
        }
    }, intervalSeconds * 1000);

    logger.debug(`Started auto-refresh for ${type} every ${intervalSeconds} seconds`);
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        logger.debug(`Stopped auto-refresh for ${currentAutoRefreshType}`);
        currentAutoRefreshType = null;
    }
}

/**
 * Silent version of loadPerformanceMonitor (no loading state change)
 */
async function loadPerformanceMonitorSilent() {
    try {
        const response = await fetch('/api/admin/performance', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        displayPerformanceResults(data);
    } catch (error) {
        console.error('Performance monitor auto-refresh failed:', error);
        // Don't show error in UI for silent refresh
    }
}

/**
 * Silent version of performStatusCheck (no loading state change)
 */
async function performStatusCheckSilent() {
    try {
        const response = await fetch('/api/admin/status', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        displayStatusResults(data);
    } catch (error) {
        console.error('Status check auto-refresh failed:', error);
        // Don't show error in UI for silent refresh
    }
}

/**
 * Displays a notification message on the screen.
 * @param {string} message The message to display.
 * @param {string} type The type of notification ('success' or 'error').
 */
function showNotification(message, type = 'success') {
    const container = document.getElementById('notification-area');
    if (!container) return;

    const notification = document.createElement('div');
    // Special styling for setup complete message
    if (message.includes('Setup complete!')) {
        notification.className = `notification ${type} setup-complete`;
        notification.innerHTML = `<i class='fas fa-rocket'></i> <strong>${message}</strong>`;
    } else {
        notification.className = `notification ${type}`;
        notification.textContent = message;
    }

    container.appendChild(notification);

    // Trigger the transition for appearing
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    // Setup complete message stays longer (8s), others 5s
    const timeout = notification.classList.contains('setup-complete') ? 8000 : 5000;
    setTimeout(() => {
        notification.classList.remove('show');
        notification.addEventListener('transitionend', () => notification.remove());
    }, timeout);

    // Return the notification element so it can be managed externally
    return notification;
}

// Restart Button Management
function showRestartButton() {
    const restartBtn = document.getElementById('restart-now-btn');

    if (restartBtn) {
        // Force show the button by removing all hiding styles
        restartBtn.removeAttribute('style');
        restartBtn.removeAttribute('hidden');
        restartBtn.classList.remove('hidden');

        // Add specific show styles
        restartBtn.style.setProperty('display', 'inline-flex', 'important');
        restartBtn.style.setProperty('visibility', 'visible', 'important');
        restartBtn.style.setProperty('opacity', '1', 'important');

        // Store in sessionStorage so button persists across page navigation
        sessionStorage.setItem('restartButtonVisible', 'true');

        // Force a reflow to ensure changes are applied
        restartBtn.offsetHeight;
    } else {
        logger.warn('⚠️ Restart button element not found when trying to show!');
    }
}

function hideRestartButton() {
    const restartBtn = document.getElementById('restart-now-btn');

    if (restartBtn) {
        // Force hide with multiple methods to override any CSS
        restartBtn.style.setProperty('display', 'none', 'important');
        restartBtn.style.setProperty('visibility', 'hidden', 'important');
        restartBtn.style.setProperty('opacity', '0', 'important');
        restartBtn.setAttribute('hidden', 'true');
        restartBtn.classList.add('hidden');

        // Remove from sessionStorage
        sessionStorage.removeItem('restartButtonVisible');

        // Force a reflow to ensure changes are applied
        restartBtn.offsetHeight;
    } else {
        logger.warn('⚠️ Restart button element not found!');
    }
}

function performRestart() {
    const restartBtn = document.getElementById('restart-now-btn');
    const originalText = restartBtn.innerHTML;

    // Guard: require saving changes before allowing restart
    if (typeof window.hasUnsavedChanges === 'function' && window.hasUnsavedChanges()) {
        if (typeof showNotification === 'function') {
            showNotification('Please save your changes first, then restart.', 'warning');
        }
        return;
    }

    // Show loading state
    restartBtn.disabled = true;
    restartBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Restarting...';

    // Trigger restart
    fetch('/api/admin/restart-app', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    })
        .then(() => {
            hideRestartButton();
            sessionStorage.removeItem('restartButtonVisible'); // Verwijder flag zodat knop niet terugkomt na reload

            // Show notification and auto-refresh
            if (typeof showNotification === 'function') {
                showNotification(
                    'Server is restarting... Please refresh the page in a few seconds.',
                    'success'
                );
            }

            // Auto-refresh na 3 seconden
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        })
        .catch(error => {
            console.error('Restart failed:', error);
            if (typeof showNotification === 'function') {
                showNotification(
                    'Could not restart server automatically. Please restart manually if needed.',
                    'error'
                );
            }
            // Restore button state
            restartBtn.disabled = false;
            restartBtn.innerHTML = originalText;
        });
}

// Initialize restart button functionality
document.addEventListener('DOMContentLoaded', function () {
    // Check if restart button should be visible (from sessionStorage)
    const shouldShowRestart = sessionStorage.getItem('restartButtonVisible') === 'true';

    if (shouldShowRestart) {
        // Show the button because restart is still needed
        showRestartButton();
    } else {
        // Make sure button is hidden
        hideRestartButton();
    }

    // Restart now button handler
    const restartNowBtn = document.getElementById('restart-now-btn');
    if (restartNowBtn) {
        restartNowBtn.addEventListener('click', performRestart);
    }
});

// Update status monitoring
let updateStatusInterval = null;

/**
 * Start monitoring update status
 */
function startUpdateStatusMonitoring() {
    if (updateStatusInterval) {
        clearInterval(updateStatusInterval);
    }

    updateStatusInterval = setInterval(async () => {
        try {
            await updateProgressBar();
        } catch (error) {
            console.error('[Admin] Error monitoring update status:', error);
        }
    }, 2000); // Check every 2 seconds
}

/**
 * Stop monitoring update status
 */
function stopUpdateStatusMonitoring() {
    if (updateStatusInterval) {
        clearInterval(updateStatusInterval);
        updateStatusInterval = null;
    }
}

/**
 * Update the progress bar with current status
 */
async function updateProgressBar() {
    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/update/status'));

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const status = await response.json();

        const progressContainer = document.getElementById('update-progress-container');
        const progressLabel = document.getElementById('update-progress-label');
        const progressPercentage = document.getElementById('update-progress-percentage');
        const progressFill = document.getElementById('update-progress-fill');

        if (!progressContainer) return;

        // Update progress bar
        if (progressLabel) progressLabel.textContent = status.message || 'Update in progress...';
        if (progressPercentage) progressPercentage.textContent = `${status.progress || 0}%`;
        if (progressFill) progressFill.style.width = `${status.progress || 0}%`;

        // Apply phase-specific styling
        progressLabel.className = `update-phase-${status.phase || 'idle'}`;

        // Stop monitoring if update is complete or failed
        if (status.phase === 'completed' || status.phase === 'error' || !status.isUpdating) {
            stopUpdateStatusMonitoring();

            if (status.phase === 'completed') {
                showNotification('Update completed successfully!', 'success');
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                }, 5000);
            } else if (status.phase === 'error') {
                showNotification(`Update failed: ${status.error}`, 'error');
            }
        }
    } catch (error) {
        console.error('[Admin] Error updating progress bar:', error);
        stopUpdateStatusMonitoring();
    }
}

/**
 * Load update status data
 */
async function loadUpdateStatus() {
    hideAllStatusDisplays();

    const updateStatusDisplay = document.getElementById('update-status-display');
    const updateStatusContent = document.getElementById('update-status-content');

    if (!updateStatusDisplay || !updateStatusContent) return;

    updateStatusDisplay.style.display = 'block';
    updateStatusContent.innerHTML = '<div class="loading">Loading update status...</div>';

    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/update/status'));

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const status = await response.json();
        displayUpdateStatus(status);
    } catch (error) {
        console.error('Update status loading failed, showing idle status:', error);
        // If the update status API fails, show idle status by default
        displayIdleUpdateStatus({ isUpdating: false });
    }
}

/**
 * Display update status information
 */
function displayUpdateStatus(status) {
    const updateStatusContent = document.getElementById('update-status-content');
    if (!updateStatusContent) return;

    // If not updating, show version info and update check
    if (!status.isUpdating) {
        displayIdleUpdateStatus(status);
        return;
    }

    const startTime = status.startTime
        ? new Date(status.startTime).toLocaleString()
        : 'Not started';
    const duration = status.startTime
        ? Math.floor((Date.now() - new Date(status.startTime)) / 1000)
        : 0;

    updateStatusContent.innerHTML = `
        <div class="status-grid">
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-info-circle"></i>
                    Current Phase
                </div>
                <div class="status-item-value update-phase-${status.phase}">
                    ${status.phase ? status.phase.charAt(0).toUpperCase() + status.phase.slice(1) : 'Idle'}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-percentage"></i>
                    Progress
                </div>
                <div class="status-item-value status-info">
                    ${status.progress || 0}%
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-play"></i>
                    Status
                </div>
                <div class="status-item-value ${status.isUpdating ? 'status-warning' : 'status-success'}">
                    ${status.isUpdating ? 'In Progress' : 'Idle'}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-clock"></i>
                    Start Time
                </div>
                <div class="status-item-value status-info">
                    ${startTime}
                </div>
            </div>
        </div>
        ${
            status.message
                ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(255, 255, 255, 0.02); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">
                <h4 style="margin: 0 0 0.5rem 0; color: #fff; font-size: 0.95rem;">
                    <i class="fas fa-comment"></i> Current Message
                </h4>
                <p style="margin: 0; color: #ccc; font-size: 0.85rem;">
                    ${status.message}
                </p>
            </div>
        `
                : ''
        }
        ${
            status.error
                ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 6px;">
                <h4 style="margin: 0 0 0.5rem 0; color: #f44336; font-size: 0.95rem;">
                    <i class="fas fa-exclamation-triangle"></i> Error Details
                </h4>
                <p style="margin: 0; color: #f44336; font-size: 0.85rem;">
                    ${status.error}
                </p>
            </div>
        `
                : ''
        }
        ${
            status.backupPath
                ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(103, 126, 234, 0.1); border: 1px solid rgba(103, 126, 234, 0.3); border-radius: 6px;">
                <h4 style="margin: 0 0 0.5rem 0; color: #667eea; font-size: 0.95rem;">
                    <i class="fas fa-archive"></i> Backup Information
                </h4>
                <p style="margin: 0; color: #ccc; font-size: 0.85rem; word-break: break-all;">
                    Backup location: ${status.backupPath}
                </p>
            </div>
        `
                : ''
        }
        ${
            duration > 0
                ? `
            <div style="margin-top: 1rem; color: #b3b3b3; font-size: 0.85rem; text-align: center;">
                Duration: ${Math.floor(duration / 60)}m ${duration % 60}s
            </div>
        `
                : ''
        }
    `;
}

/**
 * Display idle update status with version information
 */
async function displayIdleUpdateStatus(_status) {
    const updateStatusContent = document.getElementById('update-status-content');
    if (!updateStatusContent) return;

    // Show loading state first with current version if available
    updateStatusContent.innerHTML = `
        <div class="status-grid">
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-tag"></i>
                    Current Version
                </div>
                <div class="status-item-value status-info">
                    v${window.POSTERRAMA_VERSION || 'Loading...'}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-cloud-download-alt"></i>
                    Update Status
                </div>
                <div class="status-item-value status-info">
                    <i class="fas fa-spinner fa-spin"></i> Checking for updates...
                </div>
            </div>
        </div>
    `;

    try {
        // Check for available updates
        const updateCheckResponse = await authenticatedFetch(apiUrl('/api/admin/update-check'));
        const updateInfo = await updateCheckResponse.json();

        const hasUpdate = updateInfo.hasUpdate;
        const currentVersion = updateInfo.currentVersion;
        const latestVersion = updateInfo.latestVersion;
        const releaseNotes = updateInfo.releaseNotes;

        updateStatusContent.innerHTML = `
            <div class="status-grid">
                <div class="status-item">
                    <div class="status-item-header">
                        <i class="fas fa-tag"></i>
                        Current Version
                    </div>
                    <div class="status-item-value status-info">
                        v${currentVersion}
                    </div>
                </div>
                ${
                    hasUpdate
                        ? `
                    <div class="status-item">
                        <div class="status-item-header">
                            <i class="fas fa-download"></i>
                            Available Version
                        </div>
                        <div class="status-item-value status-warning">
                            v${latestVersion}
                        </div>
                    </div>
                    <div class="status-item">
                        <div class="status-item-header">
                            <i class="fas fa-chart-line"></i>
                            Update Type
                        </div>
                        <div class="status-item-value status-info">
                            ${updateInfo.updateType || 'Unknown'}
                        </div>
                    </div>
                    <div class="status-item">
                        <div class="status-item-header">
                            <i class="fas fa-check-circle"></i>
                            Status
                        </div>
                        <div class="status-item-value status-warning">
                            Update Available
                        </div>
                    </div>
                `
                        : `
                    <div class="status-item">
                        <div class="status-item-header">
                            <i class="fas fa-check-circle"></i>
                            Status
                        </div>
                        <div class="status-item-value status-success">
                            Up to Date
                        </div>
                    </div>
                `
                }
            </div>
            ${
                hasUpdate && releaseNotes
                    ? `
                <div style="margin-top: 1rem; padding: 1rem; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #4caf50; font-size: 0.95rem;">
                        <i class="fas fa-list"></i> Release Notes for v${latestVersion}
                    </h4>
                    <div style="color: #ccc; font-size: 0.85rem; white-space: pre-wrap; max-height: 200px; overflow-y: auto;">${releaseNotes}</div>
                </div>
            `
                    : ''
            }
            ${
                !hasUpdate
                    ? `
                <div style="margin-top: 1rem; padding: 1rem; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px; text-align: center;">
                    <i class="fas fa-check-circle" style="color: #4caf50; font-size: 2rem; margin-bottom: 0.5rem;"></i>
                    <p style="margin: 0; color: #4caf50; font-weight: 600;">Your installation is up to date!</p>
                    <p style="margin: 0.5rem 0 0 0; color: #ccc; font-size: 0.85rem;">Running the latest version v${currentVersion}</p>
                </div>
            `
                    : ''
            }
        `;
    } catch (error) {
        console.error('Failed to check for updates:', error);
        updateStatusContent.innerHTML = `
            <div class="status-grid">
                <div class="status-item">
                    <div class="status-item-header">
                        <i class="fas fa-exclamation-triangle"></i>
                        Status
                    </div>
                    <div class="status-item-value status-error">
                        Unable to check for updates
                    </div>
                </div>
            </div>
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 6px;">
                <p style="margin: 0; color: #f44336; font-size: 0.85rem;">
                    <i class="fas fa-exclamation-triangle"></i> Error: ${error.message}
                </p>
            </div>
        `;
    }
}

/**
 * Show version information in update status
 */
function showVersion(currentVersion, availableVersion = null) {
    const updateStatusDisplay = document.getElementById('update-status-display');
    if (!updateStatusDisplay) return;

    updateStatusDisplay.innerHTML = `
        <div class="status-card">
            <div class="status-header">
                <i class="fas fa-info-circle"></i>
                <span>Version Information</span>
            </div>
            <div class="status-content">
                <div style="margin-bottom: 1rem;">
                    <strong>Current Version:</strong> <span class="version-tag">${currentVersion}</span>
                </div>
                ${
                    availableVersion
                        ? `
                    <div style="margin-bottom: 1rem;">
                        <strong>Available Version:</strong> <span class="version-tag">${availableVersion}</span>
                    </div>
                `
                        : ''
                }
                <div style="color: #b3b3b3; font-size: 0.85rem; margin-top: 1rem;">
                    Click "Check for Updates" to check for new versions
                </div>
            </div>
        </div>
    `;
}

/**
 * Auto-Update Functionality
 */

/**
 * Initialize auto-update functionality
 */
function initializeAutoUpdate() {
    // Start monitoring update status
    startUpdateStatusMonitoring();

    // Initial status check
    checkUpdateStatus();

    // Show current version info initially
    fetch('/api/v1/config')
        .then(response => response.json())
        .then(data => {
            if (data && data.version) {
                showVersion(data.version);
            }
        })
        .catch(error => {
            logger.debug('Could not load version info:', error.message);
        });
}

/**
 * Check current update status
 */
async function checkUpdateStatus() {
    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/update/status'));

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const status = await response.json();
        updateStatusDisplay(status);

        // Stop monitoring if update is complete or idle
        if (status.phase === 'completed' || status.phase === 'idle' || status.phase === 'error') {
            stopUpdateStatusMonitoring();
        }
    } catch (error) {
        console.error('Failed to check update status:', error);
        // Continue monitoring even on error
    }
}

/**
 * Update the status display
 */
function updateStatusDisplay(status) {
    const idleState = document.getElementById('update-idle-state');
    const progressState = document.getElementById('update-progress-state');
    const phaseText = document.getElementById('update-phase-text');
    const progressPercent = document.getElementById('update-progress-percent');
    const progressBar = document.getElementById('update-progress-bar');
    const messageText = document.getElementById('update-message');
    const startButton = document.getElementById('start-auto-update-button');
    const rollbackButton = document.getElementById('rollback-update-button');

    if (!idleState || !progressState) return;

    // Update button states
    const isUpdating =
        status.phase !== 'idle' && status.phase !== 'completed' && status.phase !== 'error';

    if (startButton) {
        startButton.setAttribute('data-updating', isUpdating.toString());
        if (isUpdating) {
            startButton.querySelector('span').textContent = 'Updating...';
            startButton.querySelector('i').className = 'fas fa-spinner icon';
        } else {
            startButton.querySelector('span').textContent = 'Start Auto-Update';
            startButton.querySelector('i').className = 'fas fa-download icon';
        }
    }

    if (rollbackButton) {
        rollbackButton.style.display = status.backupPath ? 'block' : 'none';
    }

    if (status.phase === 'idle' || status.phase === 'completed') {
        // Show idle state
        idleState.style.display = 'block';
        progressState.style.display = 'none';

        if (status.phase === 'completed') {
            const statusValue = idleState.querySelector('.status-item-value');
            if (statusValue) {
                statusValue.textContent = status.message || 'Update completed';
                statusValue.className = 'status-item-value status-success';
            }
        }
    } else {
        // Show progress state
        idleState.style.display = 'none';
        progressState.style.display = 'block';

        // Update progress elements
        if (phaseText) {
            phaseText.textContent = getPhaseDisplayText(status.phase);
        }

        if (progressPercent) {
            progressPercent.textContent = `${status.progress || 0}%`;
        }

        if (progressBar) {
            progressBar.style.width = `${status.progress || 0}%`;

            // Update progress bar class based on phase
            progressBar.className = 'progress-fill';
            if (status.phase === 'error') {
                progressBar.classList.add('error');
            } else if (status.phase === 'completed') {
                progressBar.classList.add('success');
            }
        }

        if (messageText) {
            messageText.textContent = status.message || 'Processing...';
            messageText.className = 'update-message';

            if (status.error) {
                messageText.classList.add('error');
                messageText.textContent = status.error;
            } else if (status.phase === 'completed') {
                messageText.classList.add('success');
            }

            // Add phase-specific class
            messageText.classList.add(`update-phase-${status.phase}`);
        }
    }
}

/**
 * Get display text for update phase
 */
function getPhaseDisplayText(phase) {
    const phaseTexts = {
        checking: 'Checking for Updates',
        backup: 'Creating Backup',
        download: 'Downloading Update',
        validation: 'Validating Download',
        stopping: 'Stopping Services',
        applying: 'Applying Update',
        dependencies: 'Updating Dependencies',
        starting: 'Starting Services',
        verification: 'Verifying Update',
        completed: 'Update Completed',
        error: 'Update Failed',
        rollback: 'Rolling Back',
    };

    return phaseTexts[phase] || phase;
}

/**
 * Start automatic update
 */
async function startAutoUpdate(targetVersion = null) {
    try {
        const startButton = document.getElementById('start-auto-update-button');
        setButtonState(startButton, 'loading', { text: 'Starting...' });

        // Server accepts both `version` and `targetVersion`, send `version`
        const force = false;
        const requestBody = targetVersion ? { version: targetVersion, force } : { force };

        const response = await authenticatedFetch(apiUrl('/api/admin/update/start'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Failed to start update (HTTP ${response.status})`);
        }

        const result = await response.json();
        showNotification(`Update started: ${result.message}`, 'success');

        // Start monitoring
        startUpdateStatusMonitoring();

        // Initial status check
        setTimeout(checkUpdateStatus, 1000);
    } catch (error) {
        console.error('Failed to start update:', error);
        showNotification(`Failed to start update: ${error.message}`, 'error');

        const startButton = document.getElementById('start-auto-update-button');
        setButtonState(startButton, 'revert');
    }
}

// Helper to trigger an update with force=true (used by modal Force Update button)
async function startAutoUpdateWithForce(targetVersion = null) {
    try {
        const startButton = document.getElementById('start-auto-update-button');
        if (startButton) setButtonState(startButton, 'loading', { text: 'Starting...' });

        const requestBody = targetVersion
            ? { version: targetVersion, force: true }
            : { force: true };

        const response = await authenticatedFetch(apiUrl('/api/admin/update/start'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Failed to start update (HTTP ${response.status})`);
        }

        const result = await response.json();
        showNotification(`Update started: ${result.message}`, 'success');

        // Start monitoring
        startUpdateStatusMonitoring();
        setTimeout(checkUpdateStatus, 1000);
    } catch (error) {
        console.error('Failed to start forced update:', error);
        showNotification(`Failed to start forced update: ${error.message}`, 'error');
    } finally {
        const startButton = document.getElementById('start-auto-update-button');
        if (startButton) setButtonState(startButton, 'revert');
        // Close the modal after initiating
        closeUpdateConfirmationModal();
    }
}

/**
 * Show rollback modal with backup selection
 */
async function rollbackUpdate() {
    try {
        // Load backup list first
        const response = await authenticatedFetch(apiUrl('/api/admin/update/backups'));

        if (!response.ok) {
            throw new Error(`Failed to load backups: HTTP ${response.status}`);
        }

        const backups = await response.json();

        if (!backups || backups.length === 0) {
            showNotification('No backups available for rollback', 'warning');
            return;
        }

        // Show modal with backup selection
        showRollbackModal(backups);
    } catch (error) {
        console.error('Failed to load backups for rollback:', error);
        showNotification(`Failed to load backups: ${error.message}`, 'error');
    }
}

/**
 * Show rollback modal with backup selection
 */
function showRollbackModal(backups) {
    // Create modal HTML
    const modalHTML = `
        <div id="rollback-modal" class="modal" style="display: block;">
            <div class="modal-content" style="max-width: 700px;">
                <span class="close" onclick="closeRollbackModal()">&times;</span>
                <h3><i class="fas fa-undo"></i> Select Backup to Restore</h3>
                <p style="color: #ccc; margin-bottom: 1.5rem;">Choose a backup to rollback to. This will replace your current installation with the selected backup.</p>
                
                <div id="backup-selection-list" style="max-height: 400px; overflow-y: auto; margin-bottom: 1.5rem;">
                    ${backups
                        .map(
                            (backup, index) => `
                        <div class="backup-selection-item" data-backup-path="${backup.path}" data-backup-version="${backup.version}" 
                             style="margin-bottom: 1rem; padding: 1rem; background: rgba(255, 255, 255, 0.05); border: 2px solid transparent; border-radius: 6px; cursor: pointer; transition: all 0.2s;"
                             onclick="selectBackupForRollback(this)">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <div style="font-weight: 600; color: #fff;">
                                    <i class="fas fa-archive" style="color: #667eea; margin-right: 0.5rem;"></i>
                                    ${backup.name}
                                </div>
                                <div style="background: rgba(103, 126, 234, 0.2); color: #667eea; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">
                                    v${backup.version}
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; font-size: 0.85rem; color: #ccc;">
                                <div>
                                    <i class="fas fa-calendar"></i> 
                                    ${backup.created ? new Date(backup.created).toLocaleDateString() : 'Unknown date'}
                                </div>
                                <div>
                                    <i class="fas fa-clock"></i> 
                                    ${backup.created ? new Date(backup.created).toLocaleTimeString() : ''}
                                </div>
                                <div>
                                    <i class="fas fa-database"></i> 
                                    ${backup.size ? (backup.size > 1024 * 1024 ? (backup.size / (1024 * 1024)).toFixed(1) + ' MB' : Math.round(backup.size / 1024) + ' KB') : 'Unknown size'}
                                </div>
                            </div>
                            ${
                                index === 0
                                    ? `
                                <div style="margin-top: 0.5rem; color: #4caf50; font-size: 0.8rem; font-weight: 600;">
                                    <i class="fas fa-star"></i> Most Recent Backup
                                </div>
                            `
                                    : ''
                            }
                        </div>
                    `
                        )
                        .join('')}
                </div>
                
                <div style="padding: 1rem; background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 6px; margin-bottom: 1.5rem;">
                    <p style="margin: 0; color: #ffc107; font-size: 0.85rem;">
                        <i class="fas fa-exclamation-triangle"></i> 
                        <strong>Warning:</strong> Rolling back will stop the current application, restore the selected backup, and restart. This process cannot be undone.
                    </p>
                </div>
                
                <div class="form-actions">
                    <button type="button" id="confirm-rollback-button" class="btn btn-danger" onclick="confirmRollback()" disabled>
                        <i class="fas fa-undo icon"></i>
                        <span>Rollback to Selected Backup</span>
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="closeRollbackModal()">
                        <i class="fas fa-times icon"></i>
                        <span>Cancel</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if present
    const existingModal = document.getElementById('rollback-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Add click outside to close
    const modal = document.getElementById('rollback-modal');
    modal.addEventListener('click', function (event) {
        if (event.target === modal) {
            closeRollbackModal();
        }
    });
}

/**
 * Select backup for rollback
 * Note: Used as onclick handler in dynamically generated HTML
 */
window.selectBackupForRollback = function selectBackupForRollback(element) {
    // Remove selection from all items
    document.querySelectorAll('.backup-selection-item').forEach(item => {
        item.style.border = '2px solid transparent';
        item.style.background = 'rgba(255, 255, 255, 0.05)';
    });

    // Select current item
    element.style.border = '2px solid #667eea';
    element.style.background = 'rgba(103, 126, 234, 0.1)';

    // Enable confirm button
    const confirmButton = document.getElementById('confirm-rollback-button');
    if (confirmButton) {
        confirmButton.disabled = false;

        const version = element.getAttribute('data-backup-version');
        confirmButton.querySelector('span').textContent = `Rollback to v${version}`;

        // Store selected backup info
        confirmButton.setAttribute('data-backup-path', element.getAttribute('data-backup-path'));
        confirmButton.setAttribute('data-backup-version', version);
    }
};

/**
 * Confirm rollback with selected backup
 * Note: Used as onclick handler in dynamically generated HTML
 */
window.confirmRollback = async function confirmRollback() {
    const confirmButton = document.getElementById('confirm-rollback-button');
    const backupPath = confirmButton.getAttribute('data-backup-path');
    const backupVersion = confirmButton.getAttribute('data-backup-version');

    if (!backupPath) {
        showNotification('Please select a backup first', 'warning');
        return;
    }

    closeRollbackModal();

    try {
        setButtonState(confirmButton, 'loading', { text: 'Rolling back...' });

        const response = await authenticatedFetch(apiUrl('/api/admin/update/rollback'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                backupPath: backupPath,
                version: backupVersion,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        await response.json(); // Consume response but don't use result
        showNotification(`Rollback to v${backupVersion} completed successfully`, 'success');

        // Refresh page after rollback
        setTimeout(() => {
            window.location.reload();
        }, 2000);
    } catch (error) {
        console.error('Rollback failed:', error);
        showNotification(`Rollback failed: ${error.message}`, 'error');
    }
};

/**
 * Close rollback modal
 */
function closeRollbackModal() {
    const modal = document.getElementById('rollback-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * Load and display backup list
 */
async function loadBackupList() {
    hideAllStatusDisplays(); // Hide other displays first

    const backupsDisplay = document.getElementById('backups-display');
    const backupsContent = document.getElementById('backups-content');

    if (!backupsDisplay || !backupsContent) return;

    backupsDisplay.style.display = 'block';
    backupsContent.innerHTML = '<div class="loading">Loading backups...</div>';

    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/update/backups'));

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const backups = await response.json();
        displayBackupList(backups);
    } catch (error) {
        console.error('Failed to load backups:', error);
        backupsContent.innerHTML = `<div class="status-error">Failed to load backups: ${error.message}</div>`;
    }
}

/**
 * Display backup list
 */
function displayBackupList(backups) {
    const backupsContent = document.getElementById('backups-content');
    if (!backupsContent) return;

    if (!backups || backups.length === 0) {
        backupsContent.innerHTML = '<div class="status-info">No backups found.</div>';
        return;
    }

    const backupsHtml = backups
        .map(backup => {
            const createdDate = new Date(backup.timestamp).toLocaleDateString();
            const createdTime = new Date(backup.timestamp).toLocaleTimeString();
            const sizeMB = (backup.size / (1024 * 1024)).toFixed(1) + ' MB';

            return `
            <div class="backup-item">
                <div class="backup-info">
                    <div class="backup-name">
                        <i class="fas fa-archive" style="color: #667eea; margin-right: 0.5rem;"></i>
                        ${backup.name}
                    </div>
                    <div class="backup-details">
                        <span class="backup-version">v${backup.version}</span> • 
                        ${createdDate} ${createdTime} • 
                        ${sizeMB}
                    </div>
                </div>
                <div class="backup-actions">
                    <button class="btn btn-secondary btn-sm" onclick="restoreFromBackup('${backup.path}', '${backup.version}')" title="Restore this backup">
                        <i class="fas fa-undo"></i> Restore
                    </button>
                </div>
            </div>
        `;
        })
        .join('');

    backupsContent.innerHTML = `
        <div style="margin-bottom: 1rem; color: #b3b3b3; font-size: 0.9rem;">
            <i class="fas fa-info-circle"></i> 
            Found ${backups.length} backup${backups.length !== 1 ? 's' : ''} (sorted by date, newest first)
        </div>
        ${backupsHtml}
        <div style="margin-top: 1rem; padding: 1rem; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px;">
            <div style="color: #f59e0b; font-weight: 500; margin-bottom: 0.5rem;">
                <i class="fas fa-exclamation-triangle"></i> Backup Management
            </div>
            <p style="margin: 0; color: #fef3c7; font-size: 0.85rem;">
                Backups are automatically created before each update. You can restore any backup or clean up old ones to save disk space.
            </p>
        </div>
    `;
}

/**
 * Restore from a specific backup
 * Note: Used as onclick handler in dynamically generated HTML
 */
window.restoreFromBackup = async function restoreFromBackup(backupPath, version) {
    if (
        !confirm(
            `Are you sure you want to restore from backup version ${version}? This will replace the current installation.`
        )
    ) {
        return;
    }

    try {
        showNotification('Restoring from backup...', 'info');

        // Note: This would require a new API endpoint for restoring specific backups
        // For now, we'll show a message that this feature is coming soon
        showNotification(
            'Specific backup restoration is not yet implemented. Use the general rollback function instead.',
            'warning'
        );
    } catch (error) {
        console.error('Failed to restore backup:', error);
        showNotification(`Failed to restore backup: ${error.message}`, 'error');
    }
};

// Initialize auto-update functionality when the page loads
document.addEventListener('DOMContentLoaded', function () {
    // Initialize auto-update monitoring
    initializeAutoUpdate();
});

/**
 * Modal functions for update confirmation
 */
async function openUpdateConfirmationModal() {
    logger.debug('📂 Opening update confirmation modal');

    const modal = document.getElementById('update-confirmation-modal');
    const content = document.getElementById('update-confirmation-content');
    const confirmButton = document.getElementById('confirm-update-button');

    logger.debug('🔍 Modal elements:', {
        modal: modal ? 'found' : 'NOT FOUND',
        content: content ? 'found' : 'NOT FOUND',
        confirmButton: confirmButton ? 'found' : 'NOT FOUND',
    });

    if (!modal || !content) {
        console.error('❌ Modal elements not found!');
        return;
    }

    // NUCLEAR FIX: Move modal to body if it's not already there
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }

    modal.classList.remove('is-hidden');
    modal.style.display = 'flex'; // Use flex as per CSS
    confirmButton.disabled = true;

    // Prevent body scrolling when modal is open - use CSS classes
    document.body.classList.add('modal-open');
    document.documentElement.classList.add('modal-open');
    modal.classList.add('modal-open');

    // Load update information
    try {
        const updateCheckResponse = await authenticatedFetch(apiUrl('/api/admin/update-check'));

        const updateInfo = await updateCheckResponse.json();

        const hasUpdate = updateInfo.hasUpdate;
        const currentVersion = updateInfo.currentVersion;
        const latestVersion = updateInfo.latestVersion;
        const releaseNotes = updateInfo.releaseNotes;

        if (!hasUpdate) {
            content.innerHTML = `
                <div style="text-align: center; padding: 1rem;">
                    <i class="fas fa-check-circle" style="color: #4caf50; font-size: 3rem; margin-bottom: 1rem;"></i>
                    <h4 style="color: #4caf50; margin: 0 0 0.5rem 0;">Already Up to Date</h4>
                    <p style="margin: 0; color: #ccc;">You are already running the latest version v${currentVersion}</p>
                </div>
                <div style="margin-top: 1rem; padding: 1rem; background: rgba(255, 193, 7, 0.08); border: 1px solid rgba(255, 193, 7, 0.25); border-radius: 6px; text-align: left;">
                    <div style="color: #ffc107; font-weight: 600; margin-bottom: 0.5rem;">
                        <i class="fas fa-tools"></i> Repair / Force Reinstall
                    </div>
                    <p style="margin: 0 0 0.75rem 0; color: #e6e6e6; font-size: 0.9rem;">
                        Need to repair your installation or re-run the installer even though you're on the latest version? Use Force Update.
                    </p>
                    <button type="button" id="force-reinstall-button" class="btn btn-warning">
                        <i class="fas fa-hammer icon"></i>
                        <span>Force Update (Repair)</span>
                    </button>
                </div>
            `;

            // Wire up the force button to call startAutoUpdate with force=true
            const forceBtn = document.getElementById('force-reinstall-button');
            if (forceBtn) {
                forceBtn.addEventListener('click', async e => {
                    e.preventDefault();
                    setButtonState(forceBtn, 'loading', { text: 'Starting...' });
                    try {
                        await startAutoUpdateWithForce();
                        setButtonState(forceBtn, 'success', { text: 'Started' });
                        setTimeout(() => setButtonState(forceBtn, 'revert'), 1200);
                    } catch (err) {
                        setButtonState(forceBtn, 'error', { text: 'Failed' });
                        setTimeout(() => setButtonState(forceBtn, 'revert'), 1500);
                    }
                });
            }

            // Keep the confirm button disabled since no normal update is available
            confirmButton.disabled = true;
            confirmButton.querySelector('span').textContent = 'No Update Needed';
        } else {
            content.innerHTML = `
                <div style="margin-bottom: 1.5rem;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div style="text-align: center; padding: 1rem; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                            <div style="color: #ccc; font-size: 0.85rem; margin-bottom: 0.5rem;">Current Version</div>
                            <div style="font-size: 1.2rem; font-weight: 600; color: #667eea;">v${currentVersion}</div>
                        </div>
                        <div style="text-align: center; padding: 1rem; background: rgba(76, 175, 80, 0.1); border-radius: 6px; border: 1px solid rgba(76, 175, 80, 0.3);">
                            <div style="color: #4caf50; font-size: 0.85rem; margin-bottom: 0.5rem;">Available Version</div>
                            <div style="font-size: 1.2rem; font-weight: 600; color: #4caf50;">v${latestVersion}</div>
                        </div>
                    </div>
                    ${
                        releaseNotes
                            ? `
                        <div style="margin-bottom: 1.5rem; padding: 1rem; background: rgba(255, 255, 255, 0.02); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">
                            <h4 style="margin: 0 0 0.5rem 0; color: #fff; font-size: 0.95rem;">
                                <i class="fas fa-list"></i> What's New in v${latestVersion}
                            </h4>
                            <div style="color: #ccc; font-size: 0.85rem; white-space: pre-wrap; max-height: 150px; overflow-y: auto;">${releaseNotes}</div>
                        </div>
                    `
                            : ''
                    }
                </div>
                <div style="margin-bottom: 1rem;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #fff; font-size: 0.95rem;">
                        <i class="fas fa-info-circle"></i> Update Process
                    </h4>
                    <p style="margin: 0 0 0.5rem 0; color: #ccc; font-size: 0.85rem;">The update will automatically:</p>
                    <ul style="margin: 0; padding-left: 1.5rem; color: #ccc; font-size: 0.85rem;">
                        <li>Create a backup of your current installation</li>
                        <li>Download version v${latestVersion} from GitHub</li>
                        <li>Stop the application safely</li>
                        <li>Install the new version</li>
                        <li>Update dependencies</li>
                        <li>Restart the application</li>
                    </ul>
                    <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 4px;">
                        <p style="margin: 0; color: #ffc107; font-size: 0.85rem;">
                            <i class="fas fa-exclamation-triangle"></i> 
                            <strong>Important:</strong> The process may take several minutes. Do not close this page or stop the server during the update.
                        </p>
                    </div>
                </div>
            `;
            confirmButton.disabled = false;
            confirmButton.querySelector('span').textContent = `Update to v${latestVersion}`;
        }
    } catch (error) {
        console.error('❌ Failed to load update info for modal:', error);
        content.innerHTML = `
            <div style="text-align: center; padding: 1rem;">
                <i class="fas fa-exclamation-triangle" style="color: #f44336; font-size: 2rem; margin-bottom: 1rem;"></i>
                <h4 style="color: #f44336; margin: 0 0 0.5rem 0;">Update Check Failed</h4>
                <p style="margin: 0; color: #ccc;">Failed to load update information: ${error.message}</p>
                <p style="margin: 0.5rem 0 0 0; color: #999; font-size: 0.85rem;">Please check your internet connection and try again.</p>
            </div>
        `;
        confirmButton.disabled = true;
        confirmButton.querySelector('span').textContent = 'Unable to Check';
    }

    // Add event listener for clicking outside modal
    modal.addEventListener('click', function (event) {
        if (event.target === modal) {
            closeUpdateConfirmationModal();
        }
    });
}

function closeUpdateConfirmationModal() {
    const modal = document.getElementById('update-confirmation-modal');
    if (modal) {
        modal.classList.add('is-hidden');
        modal.style.display = 'none';

        // Re-enable body scrolling when modal closes - remove CSS classes
        document.body.classList.remove('modal-open');
        document.documentElement.classList.remove('modal-open');
        modal.classList.remove('modal-open');
    }
}

/**
 * Confirm auto update - used as onclick handler in HTML
 */
window.confirmAutoUpdate = function confirmAutoUpdate() {
    closeUpdateConfirmationModal();
    // Call the actual update function
    startAutoUpdate();
};

// Mobile Navigation Panel Management
function initMobileNavPanel() {
    const mobileNavToggle = document.getElementById('mobile-nav-toggle');
    const mobileNavPanel = document.getElementById('mobile-nav-panel');
    const closeMobileNav = document.getElementById('close-mobile-nav');
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');

    if (!mobileNavToggle || !mobileNavPanel) return;

    // Open mobile nav panel
    mobileNavToggle.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        mobileNavPanel.classList.add('open');
    });

    // Close mobile nav panel
    if (closeMobileNav) {
        closeMobileNav.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            mobileNavPanel.classList.remove('open');
        });
    }

    // Handle navigation item clicks
    mobileNavItems.forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            const sectionId = item.getAttribute('data-section');

            // Remove active class from all mobile nav items
            mobileNavItems.forEach(navItem => navItem.classList.remove('active'));

            // Add active class to clicked mobile nav item
            item.classList.add('active');

            // Also update desktop nav items
            const desktopNavItems = document.querySelectorAll('.nav-item');
            desktopNavItems.forEach(nav => {
                nav.classList.remove('active');
                nav.setAttribute('aria-selected', 'false');
            });

            const correspondingDesktopItem = document.querySelector(
                `.nav-item[data-section="${sectionId}"]`
            );
            if (correspondingDesktopItem) {
                correspondingDesktopItem.classList.add('active');
                correspondingDesktopItem.setAttribute('aria-selected', 'true');
            }

            // Switch to the selected section (same logic as desktop sidebar)
            if (window.activateSection) {
                window.activateSection(sectionId);
            }

            // Close the mobile nav panel
            mobileNavPanel.classList.remove('open');
        });
    });

    // Close mobile nav when clicking outside
    document.addEventListener('click', e => {
        if (
            mobileNavPanel.classList.contains('open') &&
            !mobileNavPanel.contains(e.target) &&
            !mobileNavToggle.contains(e.target)
        ) {
            mobileNavPanel.classList.remove('open');
        }
    });
}

// Initialize mobile nav panel when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileNavPanel);
} else {
    initMobileNavPanel();
}

// ============================================================================
// Devices (beta) – list + actions
// Debug logging: enable via ?devicesDebug=1 or localStorage.setItem('devicesDebug','1')
const __devicesDebugFlag = (() => {
    try {
        const qs = new URLSearchParams(location.search);
        if (qs.get('devicesDebug') === '1') localStorage.setItem('devicesDebug', '1');
        if (qs.get('devicesDebug') === '0') localStorage.removeItem('devicesDebug');
        return () => localStorage.getItem('devicesDebug') === '1';
    } catch (_) {
        return () => true; // if storage fails, keep logs on
    }
})();
function devLog(...args) {
    try {
        if (__devicesDebugFlag()) console.log('[Devices]', ...args);
    } catch (_) {
        console.log('[Devices]', ...args);
    }
}
devLog('Debug logging enabled');
async function fetchDevices() {
    const res = await authenticatedFetch(apiUrl('/api/devices'), { noRedirectOn401: true });
    if (res.status === 401) {
        const err = new Error('unauthorized');
        err.code = 'unauthorized';
        throw err;
    }
    if (!res.ok) throw new Error('Failed to load devices');
    const data = await res.json();
    try {
        devLog('fetchDevices:', Array.isArray(data) ? data.length : 'n/a', 'device(s)');
    } catch (_) {
        // ignore debug logging errors
    }
    return data;
}

function confirmDialog(message, triggerEl = null) {
    devLog('confirmDialog: open', { message, triggerEl });
    // Feature flag: allow forcing native confirm via ?devicesNative=1 or localStorage.devicesNative='1'
    try {
        const qs = new URLSearchParams(location.search);
        const forceNative =
            qs.get('devicesNative') === '1' || localStorage.getItem('devicesNative') === '1';
        if (forceNative) {
            devLog('confirmDialog: forced native confirm via flag');
            return window.confirm(message);
        }
    } catch (_) {
        // ignore URLSearchParams/localStorage errors
    }
    // Always re-inject a fresh modal to avoid stale/hidden DOM or duplicate IDs
    try {
        const existing = document.getElementById('confirm-modal');
        if (existing) {
            existing.remove();
            devLog('confirmDialog: removed existing #confirm-modal');
        }
        const div = document.createElement('div');
        div.innerHTML =
            '<div id="confirm-modal" class="modal is-hidden" aria-hidden="true" role="dialog" aria-labelledby="confirm-modal-title" tabindex="-1"><div class="modal-background" data-confirm-cancel></div><div class="modal-content"><span class="close" data-confirm-cancel>&times;</span><h3 id="confirm-modal-title"><i class="fas fa-question-circle"></i> Confirm</h3><p data-confirm-message></p><div class="form-actions" style="margin-top: 1rem; display:flex; gap:.5rem; justify-content:flex-end;"><button type="button" class="btn btn-secondary" data-confirm-cancel>Cancel</button><button type="button" class="btn btn-danger" data-confirm-ok>Delete</button></div></div></div>';
        const injected = div.firstChild;
        document.body.appendChild(injected);
        devLog('confirmDialog: injected fresh modal');
    } catch (e) {
        console.error('[Devices] confirmDialog: inject error', e);
        return window.confirm(message);
    }
    // Admin-styled modal confirm; returns a Promise<boolean>
    const modal = document.getElementById('confirm-modal');
    devLog('confirmDialog: modal present?', !!modal);
    if (!modal) {
        devLog('confirmDialog: no modal element, fallback to native confirm');
        return window.confirm(message);
    }
    const msgEl = modal.querySelector('[data-confirm-message]');
    const okBtn = modal.querySelector('[data-confirm-ok]');
    const cancelEls = modal.querySelectorAll('[data-confirm-cancel]');
    devLog('confirmDialog: structure', {
        hasMsg: !!msgEl,
        hasOk: !!okBtn,
        cancelCount: cancelEls ? cancelEls.length : 0,
    });
    // If modal structure is incomplete, fallback to native confirm
    if (!msgEl || !okBtn || !cancelEls || cancelEls.length === 0) {
        devLog('confirmDialog: incomplete modal structure, native confirm');
        return window.confirm(message);
    }

    msgEl.textContent = message || 'Are you sure?';

    return new Promise(resolve => {
        function cleanup() {
            // Hide modal visuals
            try {
                modal.setAttribute('aria-hidden', 'true');
                modal.classList.add('is-hidden');
                modal.classList.remove('modal-open', 'force-show');
                document.body.classList.remove('modal-open');
                document.documentElement.classList.remove('modal-open');
            } catch (_) {}
            // Move focus out of modal before hiding (avoid aria-hidden focus conflict)
            try {
                if (document.activeElement && typeof document.activeElement.blur === 'function') {
                    document.activeElement.blur();
                }
                if (triggerEl && typeof triggerEl.focus === 'function') {
                    triggerEl.focus();
                }
            } catch (_) {}
            // Detach listeners
            try {
                okBtn.removeEventListener('click', onOk);
                cancelEls.forEach(el => el.removeEventListener('click', onCancel));
                document.removeEventListener('keydown', onEsc);
            } catch (_) {}
        }
        const onOk = () => {
            cleanup();
            devLog('confirmDialog: OK');
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            devLog('confirmDialog: Cancel');
            resolve(false);
        };
        const onEsc = e => {
            if (e.key === 'Escape') onCancel();
        };

        try {
            // Ensure modal interactions don't bubble to underlying forms/buttons
            okBtn.addEventListener('click', onOk);
            okBtn.addEventListener('click', ev => ev.stopPropagation());
            cancelEls.forEach(el => {
                el.addEventListener('click', onCancel);
                el.addEventListener('click', ev => ev.stopPropagation());
            });
            document.addEventListener('keydown', onEsc);
        } catch (e) {
            console.error('[Devices] confirmDialog: listener attach error', e);
            // If anything goes wrong, fallback immediately
            return resolve(window.confirm(message));
        }

        try {
            // Mark visible before any focus changes to avoid aria-hidden conflict
            modal.setAttribute('aria-hidden', 'false');
            modal.classList.remove('is-hidden');
            modal.classList.add('modal-open');
            // Force show in case CSS specificity or states interfere
            modal.classList.add('force-show');
            document.body.classList.add('modal-open');
            document.documentElement.classList.add('modal-open');
            // Focus the dialog or OK button
            setTimeout(() => {
                try {
                    (modal.focus && modal.focus()) || okBtn.focus();
                } catch (_) {
                    // ignore modal visibility check errors
                }
            }, 0);

            // Immediate visibility check (same tick) to preserve user gesture for native confirm fallback
            try {
                // Force reflow to apply styles immediately
                // eslint-disable-next-line no-unused-expressions
                modal.offsetHeight;
                const stylesNow = window.getComputedStyle(modal);
                const displayedNow = stylesNow.display !== 'none';
                const visibleNow = stylesNow.visibility !== 'hidden' && stylesNow.opacity !== '0';
                const rectNow = modal.getBoundingClientRect();
                const sizedNow = rectNow.width > 0 && rectNow.height > 0;
                const openNow =
                    modal.classList.contains('modal-open') &&
                    !modal.classList.contains('is-hidden') &&
                    modal.getAttribute('aria-hidden') === 'false' &&
                    displayedNow &&
                    visibleNow &&
                    sizedNow;
                if (!openNow) {
                    // Clean up listeners before fallback
                    okBtn.removeEventListener('click', onOk);
                    cancelEls.forEach(el => el.removeEventListener('click', onCancel));
                    document.removeEventListener('keydown', onEsc);
                    devLog('confirmDialog: immediate fallback to native confirm');
                    return resolve(window.confirm(message));
                }
            } catch (_) {
                // ignore aria-hidden set errors
            }

            // Safety fallback: if for any reason the modal isn't open after 200ms, use native confirm
            setTimeout(() => {
                try {
                    const styles = window.getComputedStyle(modal);
                    const isDisplayed = styles.display !== 'none';
                    const isVisible = styles.visibility !== 'hidden' && styles.opacity !== '0';
                    const rect = modal.getBoundingClientRect();
                    const hasSize = rect.width > 0 && rect.height > 0;
                    const isOpen =
                        modal.classList.contains('modal-open') &&
                        !modal.classList.contains('is-hidden') &&
                        modal.getAttribute('aria-hidden') === 'false' &&
                        isDisplayed &&
                        isVisible &&
                        hasSize;
                    if (!isOpen) {
                        // Clean up listeners before fallback
                        okBtn.removeEventListener('click', onOk);
                        cancelEls.forEach(el => el.removeEventListener('click', onCancel));
                        document.removeEventListener('keydown', onEsc);
                        devLog('confirmDialog: modal did not open, native confirm');
                        try {
                            // Visual banner to indicate fallback
                            const banner = document.createElement('div');
                            banner.textContent =
                                'Could not open confirmation dialog; falling back to system confirm.';
                            banner.style.cssText =
                                'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#c53030;color:#fff;padding:8px 12px;border-radius:6px;z-index:10000002;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.3)';
                            document.body.appendChild(banner);
                            setTimeout(() => banner.remove(), 2000);
                        } catch (_) {
                            // ignore banner removal errors
                        }
                        resolve(window.confirm(message));
                    }
                } catch (_) {
                    // ignore immediate visibility check errors
                }
            }, 200);
        } catch (e) {
            console.error('[Devices] confirmDialog: open error', e);
            return resolve(window.confirm(message));
        }
    });
}

async function sendDeviceCommand(id, type, payload = undefined, { wait = false } = {}) {
    const url = apiUrl(
        `/api/devices/${encodeURIComponent(id)}/command` + (wait ? '?wait=true' : '')
    );
    const res = await authenticatedFetch(url, {
        method: 'POST',
        body: JSON.stringify(payload ? { type, payload } : { type }),
        noRedirectOn401: true,
    });
    if (res.status === 401) {
        const err = new Error('unauthorized');
        err.code = 'unauthorized';
        throw err;
    }
    if (!res.ok) throw new Error('Failed to send command');
    // Some commands (notably power.toggle when queued) may return 202/204 with no body
    // Be tolerant to empty responses and treat them as a generic queued result
    const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (res.status === 204) return { ok: true, live: false };
    try {
        if (ct.includes('application/json')) return await res.json();
        const txt = await res.text();
        if (!txt) return { ok: true, live: false };
        try {
            return JSON.parse(txt);
        } catch (_) {
            // Non-JSON body; fallback to a generic ok response
            return { ok: true, live: false };
        }
    } catch (_) {
        // If parsing fails, still consider it queued
        return { ok: true, live: false };
    }
}

// Small popover to send ad-hoc device commands (e.g., source.switch)
function showSendCommandPopover(anchorEl, deviceId) {
    try {
        // Remove any existing popover
        document.querySelectorAll('.send-command-popover').forEach(el => el.remove());

        const pop = document.createElement('div');
        pop.className = 'send-command-popover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Send command');
        Object.assign(pop.style, {
            position: 'absolute',
            zIndex: 10000,
            background: '#1f2937',
            color: '#fff',
            border: '1px solid #374151',
            padding: '10px',
            borderRadius: '8px',
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
            minWidth: '240px',
        });
        pop.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:8px;">
                <div style="font-weight:600;font-size:13px;">Send command</div>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
                    <span>Command</span>
                    <select class="sc-cmd" style="padding:6px;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;">
                        <option value="playback.prev">playback.prev</option>
                        <option value="playback.next">playback.next</option>
                        <option value="playback.pause">playback.pause</option>
                        <option value="playback.resume">playback.resume</option>
                        <option value="playback.pinPoster">playback.pinPoster</option>
                        <option value="power.on">power.on</option>
                        <option value="power.off">power.off</option>
                        <option value="power.toggle">power.toggle</option>
                        <option value="source.switch">source.switch</option>
                        <option disabled>──────────</option>
                        <option value="core.mgmt.reload">core.mgmt.reload</option>
                        <option value="core.mgmt.reset">core.mgmt.reset</option>
                        <option value="core.mgmt.clearCache">core.mgmt.clearCache</option>
                        <option value="core.mgmt.swUnregister">core.mgmt.swUnregister</option>
                    </select>
                </label>
                <div class="sc-payload sc-payload-source" style="display:none;">
                    <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
                        <span>Source key</span>
                        <input class="sc-source" placeholder="plex | jellyfin | tmdb | tvdb | all" style="padding:6px;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;" />
                    </label>
                </div>
                <div class="sc-payload sc-payload-pin" style="display:none;">
                    <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
                        <span>Pin duration (seconds, optional)</span>
                        <input class="sc-pin-seconds" type="number" min="0" step="1" placeholder="e.g. 60" style="padding:6px;border-radius:6px;background:#111827;color:#e5e7eb;border:1px solid #374151;" />
                    </label>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
                    <button type="button" class="btn sc-cancel">Cancel</button>
                    <button type="button" class="btn is-primary sc-send"><span class="icon"><i class="fas fa-paper-plane"></i></span><span>Send</span></button>
                </div>
            </div>
        `;
        // Position near anchor
        const rect = anchorEl.getBoundingClientRect();
        pop.style.top = `${window.scrollY + rect.bottom + 8}px`;
        pop.style.left = `${window.scrollX + rect.left}px`;
        document.body.appendChild(pop);

        const select = pop.querySelector('.sc-cmd');
        const payloadSource = pop.querySelector('.sc-payload-source');
        const payloadPin = pop.querySelector('.sc-payload-pin');
        const sourceInput = pop.querySelector('.sc-source');
        const pinSecondsInput = pop.querySelector('.sc-pin-seconds');
        const updatePayloadVisibility = () => {
            payloadSource.style.display = select.value === 'source.switch' ? 'block' : 'none';
            payloadPin.style.display = select.value === 'playback.pinPoster' ? 'block' : 'none';
        };
        select.addEventListener('change', updatePayloadVisibility);
        updatePayloadVisibility();

        pop.querySelector('.sc-cancel').addEventListener('click', () => pop.remove());
        pop.querySelector('.sc-send').addEventListener('click', async () => {
            const type = select.value;
            let payload;
            if (type === 'source.switch') {
                const v = (sourceInput.value || '').trim();
                if (!v) {
                    sourceInput.focus();
                    return;
                }
                payload = { sourceKey: v };
            } else if (type === 'playback.pinPoster') {
                const secs = parseInt((pinSecondsInput.value || '0').trim(), 10);
                if (!isNaN(secs) && secs > 0) payload = { durationMs: secs * 1000 };
            }
            try {
                setButtonState(anchorEl, 'loading', { text: 'Queuing…' });
                await sendDeviceCommand(deviceId, type, payload);
                setButtonState(anchorEl, 'success', { text: 'Queued' });
                const status = document.getElementById('devices-status');
                if (status) status.textContent = 'Command queued. It will run on next heartbeat.';
                setTimeout(() => setButtonState(anchorEl, 'revert'), 1200);
            } catch (e) {
                setButtonState(anchorEl, 'error', { text: 'Failed' });
                setTimeout(() => setButtonState(anchorEl, 'revert'), 1500);
            } finally {
                pop.remove();
            }
        });

        // Close on outside click
        const onDocDown = ev => {
            if (!pop.contains(ev.target) && ev.target !== anchorEl) {
                pop.remove();
                document.removeEventListener('mousedown', onDocDown, true);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
    } catch (_) {
        // ignore popover errors
    }
}

// Pairing modal utilities
function __ensurePairingModal() {
    let el = document.getElementById('pairing-modal');
    if (el) return el;
    const wrapper = document.createElement('div');
    wrapper.innerHTML =
        '<div id="pairing-modal" class="modal is-hidden" role="dialog" aria-modal="true" aria-labelledby="pairing-modal-title" tabindex="-1"><div class="modal-background" data-pairing-close></div><div class="modal-content"><button type="button" class="close" data-pairing-close aria-label="Close dialog">&times;</button><h3 id="pairing-modal-title"><i class="fas fa-link"></i> Pairing code</h3><div class="pairing-body"><div class="pairing-code" data-pairing-code>—</div><div class="pairing-exp" data-pairing-exp></div><div class="pairing-qr"><img data-pairing-qr alt="QR"/></div><div class="pairing-actions"><button type="button" class="btn is-primary" data-pairing-copy>Copy claim URL</button><button type="button" class="btn" data-pairing-open>Open URL</button><button type="button" class="btn" data-pairing-close>Close</button></div></div></div></div>';
    el = wrapper.firstChild;
    document.body.appendChild(el);
    el.querySelectorAll('[data-pairing-close]').forEach(c =>
        c.addEventListener('click', () => {
            try {
                el.classList.add('is-hidden');
                el.classList.remove('modal-open');
                // Return focus to the trigger if we stored it
                const lastTrigger = el.__lastTrigger || null;
                if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
            } catch (_) {
                // ignore focus restoration errors
            }
        })
    );
    return el;
}
function showPairingModal({ code, expiresAt, claimUrl }) {
    const el = __ensurePairingModal();
    const codeEl = el.querySelector('[data-pairing-code]');
    const expEl = el.querySelector('[data-pairing-exp]');
    const qrImg = el.querySelector('[data-pairing-qr]');
    const copyBtn = el.querySelector('[data-pairing-copy]');
    codeEl.textContent = code;
    expEl.textContent = expiresAt ? `Expires: ${new Date(expiresAt).toLocaleString()}` : '';
    const qrUrl = apiUrl(`/api/qr?format=svg&text=${encodeURIComponent(claimUrl)}`);
    qrImg.src = qrUrl;
    copyBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(claimUrl);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => (copyBtn.textContent = 'Copy claim URL'), 1200);
        } catch (_) {
            window.prompt('Copy this URL', claimUrl);
        }
    };
    const openBtn = el.querySelector('[data-pairing-open]');
    if (openBtn)
        openBtn.onclick = () => {
            try {
                window.open(claimUrl, '_blank', 'noopener,noreferrer');
            } catch (_) {
                // ignore
            }
        };
    try {
        // Remember current focused element to restore after close
        const active = document.activeElement;
        if (active && active !== document.body) el.__lastTrigger = active;
        el.classList.remove('is-hidden');
        el.classList.add('modal-open');
        // Focus the first interactive element for accessibility
        const firstFocusable =
            el.querySelector('[data-pairing-copy]') ||
            el.querySelector('[data-pairing-close]') ||
            el;
        setTimeout(() => firstFocusable.focus && firstFocusable.focus(), 0);
    } catch (_) {
        // ignore focus get/set errors
    }
}

// Remote Control modal utilities
function __ensureRemoteModal() {
    let el = document.getElementById('remote-modal');
    if (el) return el;
    const wrapper = document.createElement('div');
    wrapper.innerHTML =
        '<div id="remote-modal" class="modal is-hidden" role="dialog" aria-modal="true" aria-labelledby="remote-modal-title" tabindex="-1"><div class="modal-background" data-remote-close></div><div class="modal-content"><button type="button" class="close" data-remote-close aria-label="Close dialog">&times;</button><h3 id="remote-modal-title"><i class="fas fa-gamepad"></i> Remote Control</h3><div class="remote-body"><div class="remote-grid"><button class="btn" data-remote="up" title="Up"><i class="fas fa-arrow-up"></i></button><div class="remote-center"><button class="btn is-primary" data-remote="select" title="Select"><i class="fas fa-dot-circle"></i></button></div><button class="btn" data-remote="right" title="Right"><i class="fas fa-arrow-right"></i></button><button class="btn" data-remote="left" title="Left"><i class="fas fa-arrow-left"></i></button><button class="btn" data-remote="down" title="Down"><i class="fas fa-arrow-down"></i></button></div><div class="remote-row"><button class="btn" data-remote="back" title="Back"><i class="fas fa-arrow-circle-left"></i></button><button class="btn" data-remote="home" title="Home"><i class="fas fa-home"></i></button><button class="btn" data-remote="menu" title="Menu"><i class="fas fa-bars"></i></button></div><div class="remote-media"><button class="btn" data-remote="playpause" title="Play/Pause"><i class="fas fa-play"></i>/<i class="fas fa-pause"></i></button><button class="btn" data-remote="prev" title="Previous"><i class="fas fa-step-backward"></i></button><button class="btn" data-remote="next" title="Next"><i class="fas fa-step-forward"></i></button></div><div class="remote-system"><button class="btn" data-remote="reload" title="Reload device"><i class="fas fa-sync-alt"></i> Reload</button> <button class="btn" data-remote="clearcache" title="Clear device cache"><i class="fas fa-broom"></i> Clear cache</button></div></div></div></div>';
    el = wrapper.firstChild;
    document.body.appendChild(el);
    el.querySelectorAll('[data-remote-close]').forEach(c =>
        c.addEventListener('click', () => {
            try {
                el.classList.add('is-hidden');
                el.classList.remove('modal-open');
                const lastTrigger = el.__lastTrigger || null;
                if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
            } catch (_) {}
        })
    );
    return el;
}
function showRemoteModal(deviceId) {
    const el = __ensureRemoteModal();
    try {
        const active = document.activeElement;
        if (active && active !== document.body) el.__lastTrigger = active;
        el.classList.remove('is-hidden');
        el.classList.add('modal-open');
        const handler = async action => {
            try {
                const setStatus = msg => {
                    try {
                        const status = document.getElementById('devices-status');
                        if (status) status.textContent = msg;
                    } catch (_) {}
                };
                switch (action) {
                    case 'up':
                    case 'down':
                    case 'left':
                    case 'right':
                    case 'select':
                    case 'back':
                    case 'home':
                    case 'menu': {
                        const r = await sendDeviceCommand(
                            deviceId,
                            'remote.key',
                            { key: action },
                            { wait: true }
                        );
                        setStatus(r && r.ack ? `Ack: ${r.ack.status}` : 'Sent');
                        break;
                    }
                    case 'playpause': {
                        const r2 = await sendDeviceCommand(deviceId, 'playback.toggle', undefined, {
                            wait: true,
                        });
                        setStatus(r2 && r2.ack ? `Ack: ${r2.ack.status}` : 'Sent');
                        break;
                    }
                    case 'prev': {
                        const r3 = await sendDeviceCommand(deviceId, 'playback.prev', undefined, {
                            wait: true,
                        });
                        setStatus(r3 && r3.ack ? `Ack: ${r3.ack.status}` : 'Sent');
                        break;
                    }
                    case 'next': {
                        const r4 = await sendDeviceCommand(deviceId, 'playback.next', undefined, {
                            wait: true,
                        });
                        setStatus(r4 && r4.ack ? `Ack: ${r4.ack.status}` : 'Sent');
                        break;
                    }
                    case 'reload': {
                        const r5 = await sendDeviceCommand(
                            deviceId,
                            'core.mgmt.reload',
                            undefined,
                            { wait: true }
                        );
                        setStatus(r5 && r5.ack ? `Ack: ${r5.ack.status}` : 'Sent');
                        break;
                    }
                    case 'clearcache': {
                        const r6 = await sendDeviceCommand(
                            deviceId,
                            'core.mgmt.clearCache',
                            undefined,
                            { wait: true }
                        );
                        setStatus(r6 && r6.ack ? `Ack: ${r6.ack.status}` : 'Sent');
                        break;
                    }
                }
            } catch (_) {}
        };
        el.querySelectorAll('[data-remote]').forEach(btn => {
            btn.onclick = () => handler(btn.getAttribute('data-remote'));
        });
        setTimeout(() => el.querySelector('[data-remote="select"]').focus(), 0);
    } catch (_) {}
}

// Simple in-memory cache for presets loaded from admin config
let __devicePresets = [];

async function loadDevicePresets() {
    try {
        const res = await authenticatedFetch(apiUrl('/api/admin/device-presets'), {
            method: 'GET',
            noRedirectOn401: true,
        });
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        setDevicePresets(Array.isArray(data) ? data : []);
        populateBulkPresetPicker();
    } catch (e) {
        // leave empty list on failure
        setDevicePresets([]);
        populateBulkPresetPicker();
    }
}

// ---------------------------------------------------------------------------
// Devices table helpers: IDs, HTML builders, and in-place reconciliation
// ---------------------------------------------------------------------------

function getDeviceId(d) {
    return (d && (d.id || d.installId)) || '';
}

function deviceModeInfo(d) {
    try {
        const overridesObj =
            d && d.settingsOverride && typeof d.settingsOverride === 'object'
                ? d.settingsOverride
                : {};
        if (overridesObj && typeof overridesObj === 'object') {
            const ow = overridesObj.wallartMode || {};
            const oc = overridesObj.cinemaMode;
            if (ow && ow.enabled === true)
                return { label: 'Wallart', cls: 'is-mode-wallart', src: 'override' };
            if (oc === true) return { label: 'Cinema', cls: 'is-mode-cinema', src: 'override' };
            if (ow && ow.enabled === false && oc === false)
                return { label: 'Screensaver', cls: 'is-mode-screensaver', src: 'override' };
        }
        const cm = (d.clientInfo?.mode || '').toLowerCase();
        if (cm === 'cinema') return { label: 'Cinema', cls: 'is-mode-cinema', src: 'client' };
        if (cm === 'wallart') return { label: 'Wallart', cls: 'is-mode-wallart', src: 'client' };
        if (cm === 'screensaver' || cm === 'slideshow' || cm === 'default')
            return { label: 'Screensaver', cls: 'is-mode-screensaver', src: 'client' };
    } catch (_) {}
    return { label: 'Screensaver', cls: 'is-mode-screensaver', src: 'fallback' };
}

function deviceOverridesBadgeHTML(d) {
    try {
        const overridesObj =
            d && d.settingsOverride && typeof d.settingsOverride === 'object'
                ? d.settingsOverride
                : {};
        const count = Object.keys(overridesObj || {}).length;
        return count
            ? `<span class="badge is-primary" title="Per-device display overrides active">Overrides: ${count}</span>`
            : '';
    } catch (_) {
        return '';
    }
}

function deviceDetailsHTML(d) {
    try {
        const esc = s => (s == null ? '' : String(s));
        const id = d.id || d.installId || '';
        const ci = d.clientInfo || {};
        const sc = ci.screen || {};
        const ua = ci.userAgent || ci.ua || '';
        const kv = [
            ['Device ID', id],
            ['Resolution', sc.w && sc.h ? `${sc.w}×${sc.h}` : '—'],
            ['Pixel Ratio', sc.dpr != null ? String(sc.dpr) : '—'],
            ['Orientation', sc.orientation || '—'],
            [
                'Mode',
                ci.mode ? String(ci.mode).charAt(0).toUpperCase() + String(ci.mode).slice(1) : '—',
            ],
            ['Platform', ci.platform || '—'],
            ['User Agent', ua ? ua.substring(0, 180) + (ua.length > 180 ? '…' : '') : '—'],
        ];
        const rows = kv
            .filter(([_, v]) => v && v !== '—')
            .map(
                ([k, v]) =>
                    `<span class="tip-k">${esc(k)}:</span><span class="tip-v">${esc(v)}</span>`
            )
            .join('');
        return `<div class="tip-title">Device details</div><div class="tip-grid">${rows || '<span class="tip-k">No details</span><span class="tip-v"></span>'}</div>`;
    } catch (_) {
        return '<div class="tip-title">Device details</div><div class="tip-grid"><span class="tip-k">No details</span><span class="tip-v"></span></div>';
    }
}

function deviceStatusBadgesHTML(d) {
    const esc = s => (s == null ? '' : String(s));
    const last = d.lastSeenAt
        ? (() => {
              const dt = new Date(d.lastSeenAt);
              return {
                  date: dt.toLocaleDateString(),
                  time: dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              };
          })()
        : null;
    const mode = deviceModeInfo(d);
    const cellMode = `<span class="badge ${mode.cls}" title="Mode source: ${esc(mode.src)}">${esc(
        mode.label
    )}</span>`;
    const groups = Array.isArray(window.__groupsCache) ? window.__groupsCache : [];
    const ids = Array.isArray(d.groups) ? d.groups.filter(Boolean) : [];
    const names = ids
        .map(id => {
            const g = groups.find(x => x && (x.id === id || x.key === id));
            return g ? g.name || g.id || id : id;
        })
        .filter(Boolean);
    const groupsBadge = ids.length
        ? `<span class="badge badge-groups" title="Groups: ${names
              .map(n => String(n).replace(/</g, '&lt;'))
              .join(', ')}">Groups: ${ids.length}</span>`
        : '';
    const hasWs = !!d.wsConnected;
    const synced = !!(hasWs && window.currentConfig && window.currentConfig.syncEnabled !== false);
    const syncedBadge = synced
        ? '<span class="badge is-online badge-synced" title="Device will align to sync ticks">Synced</span>'
        : '';

    // Compute Dupes badge using globally prepared maps (populated during render/reconcile)
    const dupesBadge = (() => {
        try {
            const maps = (typeof window !== 'undefined' && window.__dupMaps) || {};
            const hwMap = maps.hwMap || {};
            const iidMap = maps.iidMap || {};
            const uaScMap = maps.uaScMap || {};
            // Helper to match UA+screen like initial render
            const uaScKey = dev => {
                try {
                    const ci = dev && dev.clientInfo ? dev.clientInfo : {};
                    const ua = (ci.userAgent || ci.ua || '').trim();
                    const sc = ci.screen || {};
                    const w = Number(sc.w || sc.width || 0) || 0;
                    const h = Number(sc.h || sc.height || 0) || 0;
                    const dpr = Number(sc.dpr || sc.scale || 1) || 1;
                    if (!ua || !w || !h) return '';
                    return `${ua}|${w}x${h}@${dpr}x`;
                } catch (_) {
                    return '';
                }
            };
            const reasonsById = Object.create(null);
            const add = (x, reason) => {
                if (!x || x.id === d.id) return;
                const entry = reasonsById[x.id] || { dev: x, reasons: new Set() };
                entry.reasons.add(reason);
                reasonsById[x.id] = entry;
            };
            if (d.hardwareId && hwMap[d.hardwareId] && hwMap[d.hardwareId].length > 1) {
                for (const x of hwMap[d.hardwareId]) add(x, 'hardwareId');
            }
            if (d.installId && iidMap[d.installId] && iidMap[d.installId].length > 1) {
                for (const x of iidMap[d.installId]) add(x, 'installId');
            }
            const key = uaScKey(d);
            if (key && uaScMap[key] && uaScMap[key].length > 1) {
                for (const x of uaScMap[key]) add(x, 'UA+screen');
            }
            const list = Object.values(reasonsById).map(v => ({
                dev: v.dev,
                reasons: Array.from(v.reasons),
            }));
            if (!list.length) return '';
            const listIds = list.map(x => x.dev && x.dev.id).filter(Boolean);
            const tipList = list
                .map(x => {
                    const nm =
                        (x.dev && x.dev.name && String(x.dev.name).slice(0, 40)) ||
                        (x.dev && x.dev.id ? x.dev.id.slice(0, 8) : '(unnamed)');
                    const sid = (x.dev && x.dev.id ? x.dev.id : '').slice(0, 8);
                    const rsn = x.reasons && x.reasons.length ? ` [${x.reasons.join(', ')}]` : '';
                    return `${nm} — ${sid}${rsn}`;
                })
                .join('\n');
            const title = `Likely duplicates (reasons per item):\n${tipList}`;
            const safeTitle = title.replace(/"/g, '&quot;');
            const safeIds = listIds.join(',').replace(/"/g, '&quot;');
            return `<span class="badge badge-dup" title="${safeTitle}" data-dupes="${safeIds}" tabindex="0" role="button">Dupes: ${list.length}</span>`;
        } catch (_) {
            return '';
        }
    })();

    const raw = (d.status || 'unknown').toLowerCase();
    let label = 'Unknown';
    let cls = 'is-unknown';
    let explain = 'Device status is unknown.';
    if (raw === 'offline' || (d.currentState && d.currentState.poweredOff === true)) {
        label = 'Offline';
        cls = 'is-unknown';
        explain =
            d.currentState && d.currentState.poweredOff
                ? 'Device is powered off (blackout mode).'
                : 'Device is not connected. No recent heartbeat detected.';
    } else if (raw === 'online' && hasWs) {
        label = 'Live';
        cls = 'is-live';
        explain = 'Best state: live WebSocket connected for instant control and sync.';
    } else if (raw === 'online' && !hasWs) {
        label = 'Online';
        cls = 'is-online';
        explain = 'Client is online but no live WebSocket is connected.';
    }
    const statusTip = `
        <div class="tip-title">Status</div>
        <div class="tip-grid">
            <span class="tip-k">State</span><span class="tip-v">${esc(label)}</span>
            <span class="tip-k">WebSocket</span><span class="tip-v">${hasWs ? 'Connected' : 'Not connected'}</span>
            ${last ? `<span class="tip-k">Last Seen</span><span class="tip-v">${esc(last.date)} ${esc(last.time)}</span>` : ''}
        </div>`;
    const detailsHtml = deviceDetailsHTML(d);
    const statusBadge = `<span class="badge ${cls}" data-device-tip="1" title="${esc(
        explain
    )}">${esc(label)}<div class="device-tip">${statusTip}${detailsHtml}</div></span>`;
    // Add Overrides badge into the status cell, but not as the first item
    const overridesBadge = deviceOverridesBadgeHTML(d);
    const together = [statusBadge, cellMode, overridesBadge, groupsBadge, dupesBadge, syncedBadge]
        .filter(Boolean)
        .join(' ');
    return `<div class="status-badges">${together}</div>`;
}

function deviceRowHTML(d) {
    const esc = s => (s == null ? '' : String(s));
    const isOffline = (d.status || 'unknown').toLowerCase() === 'offline';
    const isPoweredOff = !!(d.currentState && d.currentState.poweredOff === true);
    const isPaused = !!(d.currentState && d.currentState.paused === true);
    window.__devicesPinned = window.__devicesPinned || Object.create(null);
    const isPinnedFromState = !!(
        d.currentState &&
        (d.currentState.pinned === true || d.currentState.pin === true)
    );
    const isPinnedUI = !!window.__devicesPinned[d.id];
    const isPinned = isPinnedFromState || isPinnedUI;
    return `
        <td class="cell-select"></td>
        <td class="cell-name">
            <div class="actions-inline">
                <div class="btn-group icon-only">
                    <button type="button" class="btn power-toggle${
                        isPoweredOff
                            ? ' is-danger is-off'
                            : isOffline
                              ? ' is-danger'
                              : ' is-success is-on'
                    }" data-cmd="power.toggle" data-id="${d.id}" title="Power on/off (black screen)">
                        <span class="icon"><i class="fas fa-power-off"></i></span>
                    </button>
                    <button type="button" class="btn is-primary" data-cmd="reload" data-id="${d.id}" title="Reload this device">
                        <span class="icon"><i class="fas fa-redo"></i></span>
                    </button>
                    <button type="button" class="btn" data-cmd="reset" data-id="${d.id}" title="Clear caches + unregister SW + reload on device">
                        <span class="icon"><i class="fas fa-broom"></i></span>
                    </button>
                    <button type="button" class="btn" data-cmd="pair" data-id="${d.id}" title="Generate pairing code (admin)">
                        <span class="icon"><i class="fas fa-link"></i></span>
                    </button>
                    <button type="button" class="btn" data-cmd="remote" data-id="${d.id}" title="Open Remote Control" ${isOffline || isPoweredOff ? 'disabled' : ''}>
                        <span class="icon"><i class="fas fa-gamepad"></i></span>
                    </button>
                    <button type="button" class="btn" data-cmd="overrides" data-id="${d.id}" title="Edit display settings override">
                        <span class="icon"><i class="fas fa-sliders-h"></i></span>
                    </button>
                    <button type="button" class="btn" data-cmd="send-command" data-id="${d.id}" title="Send command (e.g., source.switch)" ${
                        isOffline || isPoweredOff ? 'disabled' : ''
                    }>
                        <span class="icon"><i class="fas fa-paper-plane"></i></span>
                    </button>
                    <button type="button" class="btn playback-toggle${
                        d.currentState && d.currentState.paused === false
                            ? ' is-primary is-playing'
                            : isPaused
                              ? ' is-paused'
                              : ''
                    }" data-cmd="playback.toggle" data-id="${d.id}" title="Play/Pause" ${
                        isOffline || isPoweredOff ? 'disabled' : ''
                    }>
                        <span class="icon"><i class="fas ${
                            d.currentState && d.currentState.paused === false
                                ? 'fa-pause'
                                : 'fa-play'
                        }"></i></span>
                    </button>
                    <button type="button" class="btn pin-btn${
                        isPinned ? ' is-pinned' : ''
                    }" data-cmd="playback.pinPoster" data-id="${d.id}" title="Pin current poster" aria-pressed="${
                        isPinned ? 'true' : 'false'
                    }" ${isOffline || isPoweredOff ? 'disabled' : ''}>
                        <span class="icon"><i class="fas ${
                            isPinned ? 'fa-map-pin' : 'fa-thumbtack'
                        }" aria-hidden="true"></i></span>
                    </button>
                    <button type="button" class="btn btn-danger" data-cmd="delete" data-id="${d.id}" title="Delete this device">
                        <span class="icon"><i class="fas fa-trash"></i></span>
                    </button>
                </div>
            </div>
            <div class="row-top inputs-line">
                <div class="field field-select-inline">
                    <input type="checkbox" class="row-select" data-id="${d.id}" aria-label="Select device" />
                </div>
                <div class="field">
                    <div class="field-label">Name</div>
                    <input class="inline-edit name-input" data-field="name" data-id="${d.id}" value="${esc(
                        d.name
                    )}" placeholder="Name" />
                </div>
                <div class="field">
                    <div class="field-label">Location</div>
                    <input class="inline-edit location-input" data-field="location" data-id="${d.id}" value="${esc(
                        d.location
                    )}" placeholder="Location" />
                </div>
            </div>
            <div class="row-bottom meta-line"></div>
        </td>
        <td class="cell-status">${deviceStatusBadgesHTML(d)}</td>`;
}

function reconcileDevicesTable(devices) {
    const tbody = document.querySelector('#devices-table tbody');
    if (!tbody) return;
    // Apply client-side filter if present (prefer in-memory term for immediacy)
    const term = (
        (typeof window !== 'undefined' && window.__devicesSearchTerm) ||
        localStorage.getItem('devices.ui.search') ||
        ''
    )
        .trim()
        .toLowerCase();
    const matches = d => {
        if (!term) return true;
        try {
            const fields = [d.name, d.location, d.id, d.installId, d.hardwareId]
                .filter(Boolean)
                .map(x => String(x).toLowerCase());
            if (fields.some(s => s.includes(term))) return true;
            const ua = d.clientInfo && (d.clientInfo.userAgent || d.clientInfo.ua);
            if (ua && String(ua).toLowerCase().includes(term)) return true;
        } catch (_) {}
        return false;
    };
    const tbodyEl = document.querySelector('#devices-table tbody');
    const active = document.activeElement;
    // Consider "editing" only when focus is inside a row input/select, not when in header search
    const isRowEditor = !!(
        active &&
        tbodyEl &&
        tbodyEl.contains(active) &&
        (active.matches?.('input.inline-edit, select.inline-edit') ||
            active.classList?.contains('inline-edit'))
    );
    const editing = isRowEditor;
    const byId = new Map();
    const filtered = (devices || []).filter(matches);
    // Recompute duplicate maps for current filtered set and expose globally
    const hwMap = Object.create(null);
    const iidMap = Object.create(null);
    const uaScMap = Object.create(null);
    const uaScKey = d => {
        try {
            const ci = d && d.clientInfo ? d.clientInfo : {};
            const ua = (ci.userAgent || ci.ua || '').trim();
            const sc = ci.screen || {};
            const w = Number(sc.w || sc.width || 0) || 0;
            const h = Number(sc.h || sc.height || 0) || 0;
            const dpr = Number(sc.dpr || sc.scale || 1) || 1;
            if (!ua || !w || !h) return '';
            return `${ua}|${w}x${h}@${dpr}x`;
        } catch (_) {
            return '';
        }
    };
    try {
        filtered.forEach(d => {
            const hw = d && d.hardwareId;
            if (hw) (hwMap[hw] = hwMap[hw] || []).push(d);
            const iid = d && d.installId;
            if (iid) (iidMap[iid] = iidMap[iid] || []).push(d);
            const key = uaScKey(d);
            if (key) (uaScMap[key] = uaScMap[key] || []).push(d);
        });
        window.__dupMaps = { hwMap, iidMap, uaScMap };
    } catch (_) {}
    filtered.forEach(d => byId.set(getDeviceId(d), d));

    // Update existing rows and mark seen
    const seen = new Set();
    tbody.querySelectorAll('tr').forEach(tr => {
        const id = tr.getAttribute('data-id') || '';
        const d = byId.get(id);
        if (!d) return; // handled in removal phase
        seen.add(id);
        // Keep device object attached for batch operations
        try {
            tr.__deviceData = d;
        } catch (_) {}
        // If user is editing inside this row, preserve inputs; update status only
        const isRowActive = tr.contains(document.activeElement);
        // Update status badges (includes Overrides now)
        const statusCell = tr.querySelector('td.cell-status');
        if (statusCell) statusCell.innerHTML = deviceStatusBadgesHTML(d);
        // Update duplicate row marker
        try {
            const hw = d && d.hardwareId;
            const iid = d && d.installId;
            const key = uaScKey(d);
            const hasHw = hw && hwMap[hw] && hwMap[hw].length > 1;
            const hasIid = iid && iidMap[iid] && iidMap[iid].length > 1;
            const hasUaSc = key && uaScMap[key] && uaScMap[key].length > 1;
            tr.classList.toggle('row-dup-suspect', !!(hasHw || hasIid || hasUaSc));
        } catch (_) {}
        // Meta line remains empty (no overrides badge here)
        // Update buttons state conservatively
        try {
            const isOffline = (d.status || 'unknown').toLowerCase() === 'offline';
            const isPoweredOff = !!(d.currentState && d.currentState.poweredOff === true);
            const powerBtn = tr.querySelector('button.power-toggle');
            if (powerBtn) {
                powerBtn.classList.toggle('is-off', isPoweredOff);
                powerBtn.classList.toggle('is-danger', isPoweredOff || isOffline);
                powerBtn.classList.toggle('is-success', !isPoweredOff && !isOffline);
                powerBtn.classList.toggle('is-on', !isPoweredOff && !isOffline);
            }
            const disable = isOffline || isPoweredOff;
            const sendBtn = tr.querySelector('button[data-cmd="send-command"]');
            const playBtn = tr.querySelector('button.playback-toggle');
            const pinBtn = tr.querySelector('button.pin-btn');
            const remoteBtn = tr.querySelector('button[data-cmd="remote"]');
            if (sendBtn) sendBtn.disabled = disable;
            if (playBtn) playBtn.disabled = disable;
            if (pinBtn) pinBtn.disabled = disable;
            if (remoteBtn) remoteBtn.disabled = disable;
            // Pin/play states
            if (playBtn) {
                const isPlaying = d.currentState && d.currentState.paused === false;
                playBtn.classList.toggle('is-playing', !!isPlaying);
                playBtn.classList.toggle('is-primary', !!isPlaying);
                playBtn.classList.toggle('is-paused', !isPlaying);
                const icon = playBtn.querySelector('i');
                if (icon) icon.className = `fas ${isPlaying ? 'fa-pause' : 'fa-play'}`;
            }
            if (pinBtn) {
                const pinned = !!(
                    (d.currentState &&
                        (d.currentState.pinned === true || d.currentState.pin === true)) ||
                    (window.__devicesPinned && window.__devicesPinned[d.id])
                );
                pinBtn.classList.toggle('is-pinned', pinned);
                pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
                const icon = pinBtn.querySelector('i');
                if (icon) icon.className = `fas ${pinned ? 'fa-map-pin' : 'fa-thumbtack'}`;
            }
        } catch (_) {}
        // Update inputs only if not actively editing this row
        if (!isRowActive) {
            const nameInput = tr.querySelector('input.name-input');
            const locInput = tr.querySelector('input.location-input');
            if (nameInput && nameInput !== document.activeElement) {
                const nv = d.name == null ? '' : String(d.name);
                if (nameInput.value !== nv) nameInput.value = nv;
            }
            if (locInput && locInput !== document.activeElement) {
                const lv = d.location == null ? '' : String(d.location);
                if (locInput.value !== lv) locInput.value = lv;
            }
        }
    });

    // Add missing rows (skip while user is editing an inline field to avoid layout jumps)
    if (!editing) {
        filtered.forEach(d => {
            const id = getDeviceId(d);
            if (seen.has(id)) return;
            const tr = document.createElement('tr');
            tr.setAttribute('data-id', id);
            try {
                tr.__deviceData = d;
            } catch (_) {}
            tr.innerHTML = deviceRowHTML(d);
            tbody.appendChild(tr);
            try {
                // Bind inline edit handlers for new row inputs
                bindInlineEditHandlers(tr);
            } catch (_) {}
            try {
                const cb = tr.querySelector('.row-select');
                if (cb) cb.addEventListener('change', updateBulkSelectionState);
            } catch (_) {}
        });
    }

    // Remove rows for devices that disappeared (skip while editing an inline field)
    if (!editing) {
        tbody.querySelectorAll('tr').forEach(tr => {
            const id = tr.getAttribute('data-id') || '';
            if (!byId.has(id)) tr.remove();
        });
    }
    // Restore persisted selection
    try {
        const sel = JSON.parse(localStorage.getItem('devices.ui.selected') || '[]');
        if (Array.isArray(sel) && sel.length) {
            tbody.querySelectorAll('.row-select').forEach(cb => {
                const id = cb.getAttribute('data-id');
                cb.checked = sel.includes(id);
            });
            updateBulkSelectionState();
        }
    } catch (_) {}
}

// Attach inline edit handlers within a root element (tbody or single row)
function bindInlineEditHandlers(root) {
    const scope = root || document;
    scope.querySelectorAll('input.inline-edit, select.inline-edit').forEach(input => {
        const submit = async () => {
            const id = input.getAttribute('data-id');
            const field = input.getAttribute('data-field');
            const value = input.value;
            const payload = {};
            payload[field] = value;
            try {
                input.disabled = true;
                input.classList.add('saving');
                const res = await authenticatedFetch(
                    apiUrl(`/api/devices/${encodeURIComponent(id)}`),
                    {
                        method: 'PATCH',
                        body: JSON.stringify(payload),
                        noRedirectOn401: true,
                    }
                );
                if (!res.ok) throw new Error('Failed to save');
                input.classList.remove('saving');
                input.classList.add('saved');
                setTimeout(() => input.classList.remove('saved'), 800);
                // Soft refresh: reconcile to avoid focus loss
                const list = await fetchDevices();
                if (tbodyHasRows()) reconcileDevicesTable(list);
                else renderDevicesTable(list);
            } catch (e) {
                input.classList.add('error');
                setTimeout(() => input.classList.remove('error'), 1200);
            } finally {
                input.disabled = false;
            }
        };
        input.addEventListener('change', submit);
        input.addEventListener('blur', submit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
        });
    });
}

function updateBulkSelectionState() {
    try {
        const tbody = document.querySelector('#devices-table tbody');
        if (!tbody) return;
        const selectAll = document.getElementById('devices-select-all');
        const bulkDeleteBtn = document.getElementById('devices-delete-selected');
        const bulkAssignBtn = document.getElementById('devices-assign-preset');
        const selected = tbody.querySelectorAll('.row-select:checked');
        try {
            const ids = Array.from(selected).map(cb => cb.getAttribute('data-id'));
            localStorage.setItem('devices.ui.selected', JSON.stringify(ids));
        } catch (_) {}
        if (bulkDeleteBtn) bulkDeleteBtn.disabled = selected.length === 0;
        if (bulkAssignBtn) bulkAssignBtn.disabled = selected.length === 0;
        if (selectAll)
            selectAll.checked =
                selected.length > 0 &&
                selected.length === tbody.querySelectorAll('.row-select').length;
    } catch (_) {}
}

function populateBulkPresetPicker() {
    try {
        const sel = document.getElementById('bulk-preset-select');
        if (!sel) return;
        const presets = getDevicePresets();
        sel.innerHTML = ['<option value="">(none)</option>']
            .concat(
                presets.map(
                    p =>
                        `<option value="${(p.key || '').replace(/"/g, '&quot;')}">${(
                            p.name ||
                            p.key ||
                            ''
                        ).replace(/</g, '&lt;')}</option>`
                )
            )
            .join('');
    } catch (_) {}
}

function getDevicePresets() {
    return Array.isArray(__devicePresets) ? __devicePresets : [];
}

function setDevicePresets(presets) {
    __devicePresets = Array.isArray(presets) ? presets : [];
}

function renderDevicesTable(devices) {
    const tbody = document.querySelector('#devices-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
        const ids = (devices || []).map(d => d && (d.id || d.installId)).filter(Boolean);
        devLog('renderDevicesTable:', ids.length, 'device(s)', ids.slice(0, 10));
    } catch (_) {
        /* ignore debug log errors */ void 0;
    }
    // Apply client-side filter on initial render as well
    const term = (localStorage.getItem('devices.ui.search') || '').trim().toLowerCase();
    const matches = d => {
        if (!term) return true;
        try {
            const fields = [d.name, d.location, d.id, d.installId, d.hardwareId]
                .filter(Boolean)
                .map(x => String(x).toLowerCase());
            if (fields.some(s => s.includes(term))) return true;
            const ua = d.clientInfo && (d.clientInfo.userAgent || d.clientInfo.ua);
            if (ua && String(ua).toLowerCase().includes(term)) return true;
        } catch (_) {}
        return false;
    };

    // Precompute duplicate candidates by hardwareId, installId, and UA+screen
    const hwMap = Object.create(null);
    const iidMap = Object.create(null);
    const uaScMap = Object.create(null);
    const uaScKey = d => {
        try {
            const ci = d && d.clientInfo ? d.clientInfo : {};
            const ua = (ci.userAgent || ci.ua || '').trim();
            const sc = ci.screen || {};
            const w = Number(sc.w || sc.width || 0) || 0;
            const h = Number(sc.h || sc.height || 0) || 0;
            const dpr = Number(sc.dpr || sc.scale || 1) || 1;
            if (!ua || !w || !h) return '';
            return `${ua}|${w}x${h}@${dpr}x`;
        } catch (_) {
            return '';
        }
    };
    const filtered = (devices || []).filter(matches);
    try {
        filtered.forEach(d => {
            const hw = d && d.hardwareId;
            if (hw) (hwMap[hw] = hwMap[hw] || []).push(d);
            const iid = d && d.installId;
            if (iid) (iidMap[iid] = iidMap[iid] || []).push(d);
            const key = uaScKey(d);
            if (key) (uaScMap[key] = uaScMap[key] || []).push(d);
        });
    } catch (_) {}
    // Expose maps globally for status badge computation during periodic refresh
    try {
        window.__dupMaps = { hwMap, iidMap, uaScMap };
    } catch (_) {}

    // Format last-seen into separate date/time lines for compact layout
    const fmtParts = ts => {
        if (!ts) return null;
        const d = new Date(ts);
        return {
            date: d.toLocaleDateString(),
            time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
    };
    const esc = s => (s == null ? '' : String(s));
    // (Removed unused preset helpers)

    filtered.forEach(d => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', getDeviceId(d));
        try {
            tr.__deviceData = d;
        } catch (_) {}
        // (unused) const currentPresetKey = d.preset || '';
        // const screen = d.clientInfo?.screen || {};
        // const dims =
        //     screen.w && screen.h ? `${screen.w}×${screen.h} @${screen.dpr || 1}x` : '';
        const last = fmtParts(d.lastSeenAt);
        // const cellScreen = dims ? `<span class="badge is-unknown">${esc(dims)}</span>` : '—';
        // Determine effective mode: overrides take priority, then client-reported, else default
        const overridesObj =
            d && d.settingsOverride && typeof d.settingsOverride === 'object'
                ? d.settingsOverride
                : {};
        const modeInfo = (() => {
            try {
                // 1) Per-device overrides (explicit choice)
                if (overridesObj && typeof overridesObj === 'object') {
                    const ow = overridesObj.wallartMode || {};
                    const oc = overridesObj.cinemaMode;
                    if (ow && ow.enabled === true) {
                        return { label: 'Wallart', cls: 'is-mode-wallart', src: 'override' };
                    }
                    if (oc === true) {
                        return { label: 'Cinema', cls: 'is-mode-cinema', src: 'override' };
                    }
                    if (ow && ow.enabled === false && oc === false) {
                        return {
                            label: 'Screensaver',
                            cls: 'is-mode-screensaver',
                            src: 'override',
                        };
                    }
                }
                // 2) Client-reported mode (best available runtime state)
                const cm = (d.clientInfo?.mode || '').toLowerCase();
                if (cm === 'cinema')
                    return { label: 'Cinema', cls: 'is-mode-cinema', src: 'client' };
                if (cm === 'wallart')
                    return { label: 'Wallart', cls: 'is-mode-wallart', src: 'client' };
                if (cm === 'screensaver' || cm === 'slideshow' || cm === 'default')
                    return { label: 'Screensaver', cls: 'is-mode-screensaver', src: 'client' };
            } catch (_) {}
            // 3) Fallback
            return { label: 'Screensaver', cls: 'is-mode-screensaver', src: 'fallback' };
        })();
        const cellMode = `<span class="badge ${modeInfo.cls}" title="Mode source: ${modeInfo.src}">${esc(
            modeInfo.label
        )}</span>`;
        // overridesObj kept above for overrides badge calculation
        const overridesCount = (() => {
            try {
                return Object.keys(overridesObj || {}).length;
            } catch (_) {
                return 0;
            }
        })();
        const overridesBadge = overridesCount
            ? `<span class="badge is-primary" title="Per-device display overrides active">Overrides: ${overridesCount}</span>`
            : '';
        const details = (() => {
            const id = d.id || d.installId || '';
            const ci = d.clientInfo || {};
            const sc = ci.screen || {};
            const ua = ci.userAgent || ci.ua || '';
            const kv = [
                ['Device ID', id],
                ['Resolution', sc.w && sc.h ? `${sc.w}×${sc.h}` : '—'],
                ['Pixel Ratio', sc.dpr != null ? String(sc.dpr) : '—'],
                ['Orientation', sc.orientation || '—'],
                [
                    'Mode',
                    ci.mode
                        ? String(ci.mode).charAt(0).toUpperCase() + String(ci.mode).slice(1)
                        : '—',
                ],
                ['Platform', ci.platform || '—'],
                ['User Agent', ua ? ua.substring(0, 180) + (ua.length > 180 ? '…' : '') : '—'],
            ];
            const rows = kv
                .filter(([_, v]) => v && v !== '—')
                .map(
                    ([k, v]) =>
                        `<span class="tip-k">${esc(k)}:</span><span class="tip-v">${esc(v)}</span>`
                )
                .join('');
            return `<div class="tip-title">Device details</div><div class="tip-grid">${rows || '<span class="tip-k">No details</span><span class="tip-v"></span>'}</div>`;
        })();

        // Compute status flags for control availability
        const rawStatus = (d.status || 'unknown').toLowerCase();
        const isOffline = rawStatus === 'offline';
        const isPaused = !!(d.currentState && d.currentState.paused === true);
        const isPoweredOff = !!(d.currentState && d.currentState.poweredOff === true);
        // Local UI-pinned memory (decoupled from paused)
        window.__devicesPinned = window.__devicesPinned || Object.create(null);
        const isPinnedFromState = !!(
            d.currentState &&
            (d.currentState.pinned === true || d.currentState.pin === true)
        );
        const isPinnedUI = !!window.__devicesPinned[d.id];
        const isPinned = isPinnedFromState || isPinnedUI;

        tr.innerHTML = `
            <td class="cell-select"></td>
            <td class="cell-name">
                <div class="actions-inline">
                    <div class="btn-group icon-only">
            <button type="button" class="btn power-toggle${
                isPoweredOff ? ' is-danger is-off' : isOffline ? ' is-danger' : ' is-success is-on'
            }" data-cmd="power.toggle" data-id="${d.id}" title="Power on/off (black screen)">
                            <span class="icon"><i class="fas fa-power-off"></i></span>
                        </button>
            <button type="button" class="btn is-primary" data-cmd="reload" data-id="${d.id}" title="Reload this device">
                            <span class="icon"><i class="fas fa-redo"></i></span>
                        </button>
            <button type="button" class="btn" data-cmd="reset" data-id="${d.id}" title="Clear caches + unregister SW + reload on device">
                            <span class="icon"><i class="fas fa-broom"></i></span>
                        </button>
            <button type="button" class="btn" data-cmd="pair" data-id="${d.id}" title="Generate pairing code (admin)">
                            <span class="icon"><i class="fas fa-link"></i></span>
                        </button>
            <button type="button" class="btn" data-cmd="remote" data-id="${d.id}" title="Open Remote Control" ${isOffline || isPoweredOff ? 'disabled' : ''}>
                            <span class="icon"><i class="fas fa-gamepad"></i></span>
                        </button>
            <button type="button" class="btn" data-cmd="overrides" data-id="${d.id}" title="Edit display settings override">
                            <span class="icon"><i class="fas fa-sliders-h"></i></span>
                        </button>
            <button type="button" class="btn" data-cmd="send-command" data-id="${d.id}" title="Send command (e.g., source.switch)" ${isOffline || isPoweredOff ? 'disabled' : ''}>
                            <span class="icon"><i class="fas fa-paper-plane"></i></span>
                        </button>
            <button type="button" class="btn playback-toggle${d.currentState && d.currentState.paused === false ? ' is-primary is-playing' : isPaused ? ' is-paused' : ''}" data-cmd="playback.toggle" data-id="${d.id}" title="Play/Pause" ${isOffline || isPoweredOff ? 'disabled' : ''}>
                            <span class="icon"><i class="fas ${d.currentState && d.currentState.paused === false ? 'fa-pause' : 'fa-play'}"></i></span>
                        </button>
            <button type="button" class="btn pin-btn${isPinned ? ' is-pinned' : ''}" data-cmd="playback.pinPoster" data-id="${d.id}" title="Pin current poster" aria-pressed="${isPinned ? 'true' : 'false'}" ${isOffline || isPoweredOff ? 'disabled' : ''}>
                            <span class="icon"><i class="fas ${isPinned ? 'fa-map-pin' : 'fa-thumbtack'}" aria-hidden="true"></i></span>
                        </button>
            <button type="button" class="btn btn-danger" data-cmd="delete" data-id="${d.id}" title="Delete this device">
                            <span class="icon"><i class="fas fa-trash"></i></span>
                        </button>
                    </div>
                </div>
                <div class="row-top inputs-line">
                    <div class="field field-select-inline">
                        <input type="checkbox" class="row-select" data-id="${d.id}" aria-label="Select device" />
                    </div>
                    <div class="field">
                        <div class="field-label">Name</div>
                        <input class="inline-edit name-input" data-field="name" data-id="${d.id}" value="${esc(d.name)}" placeholder="Name" />
                    </div>
                    <div class="field">
                        <div class="field-label">Location</div>
                        <input class="inline-edit location-input" data-field="location" data-id="${d.id}" value="${esc(d.location)}" placeholder="Location" />
                    </div>
                    
                    
                </div>
                <div class="row-bottom meta-line"></div>
            </td>
    <td class="cell-status">${(() => {
        const raw = (d.status || 'unknown').toLowerCase();
        const hasWs = !!d.wsConnected;
        // Determine unified status
        let label = 'Unknown';
        let cls = 'is-unknown';
        let explain = 'Device status is unknown.';
        if (raw === 'offline' || (d.currentState && d.currentState.poweredOff === true)) {
            label = 'Offline';
            cls = 'is-unknown'; // gray
            explain =
                d.currentState && d.currentState.poweredOff
                    ? 'Device is powered off (blackout mode).'
                    : 'Device is not connected. No recent heartbeat detected.';
        } else if (raw === 'online' && hasWs) {
            label = 'Live';
            cls = 'is-live'; // standout styling for best status
            explain = 'Best state: live WebSocket connected for instant control and sync.';
        } else if (raw === 'online' && !hasWs) {
            label = 'Online';
            cls = 'is-online'; // green
            explain = 'Client is online but no live WebSocket is connected.';
        }

        const statusTip = `
                    <div class="tip-title">Status</div>
                    <div class="tip-grid">
                        <span class="tip-k">State</span><span class="tip-v">${esc(label)}</span>
                        <span class="tip-k">WebSocket</span><span class="tip-v">${hasWs ? 'Connected' : 'Not connected'}</span>
                        ${last ? `<span class="tip-k">Last Seen</span><span class="tip-v">${esc(last.date)} ${esc(last.time)}</span>` : ''}
                    </div>
                `;

        const detailsHtml =
            details || '<div class="tip-row"><span class="tip-k">No details</span></div>';
        const statusBadge = `<span class="badge ${cls}" data-device-tip="1" title="${esc(explain)}">${esc(label)}<div class="device-tip">${statusTip}${detailsHtml}</div></span>`;
        // Build mode/groups/synced badges here so they sit next to the status badge
        const modeBadge = cellMode;
        // Groups badge (only when member of at least one group)
        const ids = Array.isArray(d.groups) ? d.groups.filter(Boolean) : [];
        const groups = Array.isArray(window.__groupsCache) ? window.__groupsCache : [];
        const names = ids
            .map(id => {
                const g = groups.find(x => x && (x.id === id || x.key === id));
                return g ? g.name || g.id || id : id;
            })
            .filter(Boolean);
        const count = ids.length;
        const groupsBadge =
            count > 0
                ? `<span class="badge badge-groups" title="Groups: ${names.map(n => String(n).replace(/</g, '&lt;')).join(', ')}">Groups: ${count}</span>`
                : '';
        const synced = !!(
            hasWs &&
            window.currentConfig &&
            window.currentConfig.syncEnabled !== false
        );
        const dupesBadge = (() => {
            try {
                const reasonsById = Object.create(null);
                const add = (x, reason) => {
                    if (!x || x.id === d.id) return;
                    const entry = reasonsById[x.id] || { dev: x, reasons: new Set() };
                    entry.reasons.add(reason);
                    reasonsById[x.id] = entry;
                };
                // HardwareId reason
                if (d.hardwareId && hwMap[d.hardwareId] && hwMap[d.hardwareId].length > 1) {
                    for (const x of hwMap[d.hardwareId]) add(x, 'hardwareId');
                }
                // InstallId reason
                if (d.installId && iidMap[d.installId] && iidMap[d.installId].length > 1) {
                    for (const x of iidMap[d.installId]) add(x, 'installId');
                }
                // UA+screen reason
                const key = uaScKey(d);
                if (key && uaScMap[key] && uaScMap[key].length > 1) {
                    for (const x of uaScMap[key]) add(x, 'UA+screen');
                }
                // Build list from reasons map
                const list = Object.values(reasonsById).map(v => ({
                    dev: v.dev,
                    reasons: Array.from(v.reasons),
                }));
                if (!list.length) return '';
                const listIds = list.map(x => x.dev && x.dev.id).filter(Boolean);
                const tipList = list
                    .map(x => {
                        const nm =
                            (x.dev && x.dev.name && String(x.dev.name).slice(0, 40)) ||
                            (x.dev && x.dev.id ? x.dev.id.slice(0, 8) : '(unnamed)');
                        const sid = (x.dev && x.dev.id ? x.dev.id : '').slice(0, 8);
                        const rsn =
                            x.reasons && x.reasons.length ? ` [${x.reasons.join(', ')}]` : '';
                        return `${nm} — ${sid}${rsn}`;
                    })
                    .join('\n');
                const title = `Likely duplicates (reasons per item):\n${tipList}`;
                const safeTitle = title.replace(/"/g, '&quot;');
                const safeIds = listIds.join(',').replace(/"/g, '&quot;');
                return `<span class="badge badge-dup" title="${safeTitle}" data-dupes="${safeIds}" tabindex="0" role="button">Dupes: ${list.length}</span>`;
            } catch (_) {
                return '';
            }
        })();
        // Merge suggested button removed per UX request; Dupes badge remains clickable
        const syncedBadge = synced
            ? '<span class="badge is-online badge-synced" title="Device will align to sync ticks">Synced</span>'
            : '';
        const together = [
            statusBadge,
            modeBadge,
            overridesBadge,
            groupsBadge,
            dupesBadge,
            syncedBadge,
        ]
            .filter(Boolean)
            .join(' ');
        return `<div class="status-badges">${together}</div>`;
    })()}</td>`;
        // Mark rows that have duplicates (no background highlight in CSS per UX)
        try {
            const hasHw = d && d.hardwareId && hwMap[d.hardwareId]?.length > 1;
            const hasIid = d && d.installId && iidMap[d.installId]?.length > 1;
            const key2 = uaScKey(d);
            const hasUaSc = key2 && uaScMap[key2] && uaScMap[key2].length > 1;
            tr.classList.toggle('row-dup-suspect', !!(hasHw || hasIid || hasUaSc));
        } catch (_) {}
        tbody.appendChild(tr);
    });

    // Bind inline-edit handlers for newly rendered rows
    try {
        bindInlineEditHandlers(tbody);
    } catch (_) {}

    // Restore persisted selection (if any) and update bulk controls
    try {
        const sel = JSON.parse(localStorage.getItem('devices.ui.selected') || '[]');
        if (Array.isArray(sel) && sel.length) {
            tbody.querySelectorAll('.row-select').forEach(cb => {
                const id = cb.getAttribute('data-id');
                cb.checked = sel.includes(id);
            });
        }
    } catch (_) {}

    // Bulk selection controls
    const selectAll = document.getElementById('devices-select-all');
    const bulkDeleteBtn = document.getElementById('devices-delete-selected');
    const bulkAssignBtn = document.getElementById('devices-assign-preset');
    const bulkPresetSelect = document.getElementById('bulk-preset-select');
    const updateBulkState = updateBulkSelectionState;
    tbody
        .querySelectorAll('.row-select')
        .forEach(cb => cb.addEventListener('change', updateBulkState));
    if (selectAll) {
        selectAll.addEventListener('change', () => {
            tbody.querySelectorAll('.row-select').forEach(cb => (cb.checked = selectAll.checked));
            updateBulkState();
        });
    }
    // Initialize the state so bulk button is disabled until something is selected
    updateBulkState();
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', async () => {
            devLog('bulkDeleteBtn: click');
            const ids = Array.from(tbody.querySelectorAll('.row-select:checked')).map(cb =>
                cb.getAttribute('data-id')
            );
            devLog('bulkDeleteBtn: selected ids', ids);
            if (!ids.length) return;
            const ok = await confirmDialog(`Delete ${ids.length} device(s)?`, bulkDeleteBtn);
            devLog('bulkDeleteBtn: confirm result', ok);
            if (!ok) return;
            for (const id of ids) {
                try {
                    await authenticatedFetch(apiUrl(`/api/devices/${encodeURIComponent(id)}`), {
                        method: 'DELETE',
                        noRedirectOn401: true,
                    });
                    devLog('bulkDeleteBtn: deleted', id);
                } catch (_) {
                    // ignore per-id delete errors
                }
            }
            const list = await fetchDevices();
            renderDevicesTable(list);
            try {
                if (typeof showNotification === 'function') {
                    showNotification(`Deleted ${ids.length} device(s)`, 'success');
                }
            } catch (_) {}
        });
    }
    // Bulk assign preset
    if (bulkAssignBtn && bulkPresetSelect) {
        bulkAssignBtn.addEventListener('click', async () => {
            const key = bulkPresetSelect.value;
            const ids = Array.from(tbody.querySelectorAll('.row-select:checked')).map(cb =>
                cb.getAttribute('data-id')
            );
            if (!ids.length) return;
            const status = document.getElementById('devices-status');
            if (status) status.textContent = 'Assigning preset...';
            for (const id of ids) {
                try {
                    await authenticatedFetch(apiUrl(`/api/devices/${encodeURIComponent(id)}`), {
                        method: 'PATCH',
                        body: JSON.stringify({ preset: key }),
                        noRedirectOn401: true,
                    });
                } catch (_) {}
            }
            const list = await fetchDevices();
            renderDevicesTable(list);
            if (status) status.textContent = 'Preset assigned to selected device(s).';
            try {
                if (typeof showNotification === 'function') {
                    const name = (() => {
                        const opt = bulkPresetSelect.options[bulkPresetSelect.selectedIndex];
                        return opt ? opt.textContent.trim() : key || '(none)';
                    })();
                    showNotification(
                        `Applied preset "${name}" to ${ids.length} device(s)`,
                        'success'
                    );
                }
            } catch (_) {}
        });
    }
    // Removed "delete offline" functionality by request.

    // Inline edit handlers
    tbody.querySelectorAll('input.inline-edit, select.inline-edit').forEach(input => {
        const submit = async () => {
            const id = input.getAttribute('data-id');
            const field = input.getAttribute('data-field');
            const value = input.value;
            const payload = {};
            payload[field] = value;
            try {
                input.disabled = true;
                input.classList.add('saving');
                const res = await authenticatedFetch(
                    apiUrl(`/api/devices/${encodeURIComponent(id)}`),
                    {
                        method: 'PATCH',
                        body: JSON.stringify(payload),
                        noRedirectOn401: true,
                    }
                );
                if (!res.ok) throw new Error('Failed to save');
                input.classList.remove('saving');
                input.classList.add('saved');
                setTimeout(() => input.classList.remove('saved'), 800);
                // Re-render to reflect preset badge
                const list = await fetchDevices();
                renderDevicesTable(list);
            } catch (e) {
                input.classList.add('error');
                setTimeout(() => input.classList.remove('error'), 1200);
            } finally {
                input.disabled = false;
            }
        };
        input.addEventListener('change', submit);
        input.addEventListener('blur', submit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
        });
    });

    tbody.querySelectorAll('button[data-cmd]').forEach(btn => {
        btn.addEventListener('click', async e => {
            // Prevent submitting the surrounding config form
            e.preventDefault();
            e.stopPropagation();
            if (btn.disabled) return;
            // Proactively blur the trigger to avoid focus remaining inside aria-hidden region
            try {
                btn.blur();
            } catch (_) {
                // ignore pairing modal close errors
            }
            const id = btn.getAttribute('data-id');
            const cmd = btn.getAttribute('data-cmd');
            const status = document.getElementById('devices-status');
            devLog('row action click', { cmd, id });
            try {
                const commandMap = {
                    reload: 'core.mgmt.reload',
                    reset: 'core.mgmt.reset',
                    'power.toggle': 'power.toggle',
                    'playback.prev': 'playback.prev',
                    'playback.next': 'playback.next',
                    'playback.pause': 'playback.pause',
                    'playback.resume': 'playback.resume',
                    'playback.pinPoster': 'playback.pinPoster',
                    'playback.toggle': 'playback.toggle',
                    'source.switch': 'source.switch',
                };
                const type = commandMap[cmd] || null;
                if (cmd === 'overrides') {
                    // Load current device details for prefill
                    const res = await authenticatedFetch(
                        apiUrl(`/api/devices/${encodeURIComponent(id)}`),
                        {
                            method: 'GET',
                            noRedirectOn401: true,
                        }
                    );
                    if (!res.ok) throw new Error('Failed to load device');
                    const device = await res.json();
                    showDeviceSettingsModal(device);
                    return;
                }
                // If device is powered off and a non-power command is requested, wake first
                if (type && !type.startsWith('power.')) {
                    const group = btn.closest('.btn-group');
                    const powerBtn = group && group.querySelector('.power-toggle');
                    const isOff = powerBtn && powerBtn.classList.contains('is-off');
                    if (isOff) {
                        setButtonState(btn, 'loading', { text: 'Waking…' });
                        await sendDeviceCommand(id, 'power.on');
                        // Flip power button UI to on
                        powerBtn.classList.remove('is-off', 'is-danger');
                        powerBtn.classList.add('is-on', 'is-success');
                        // small grace period
                        await new Promise(r => setTimeout(r, 200));
                        setButtonState(btn, 'revert');
                    }
                }
                if (cmd === 'send-command') {
                    showSendCommandPopover(btn, id);
                    return;
                }
                if (cmd === 'remote') {
                    showRemoteModal(id);
                    return;
                }
                if (cmd === 'delete') {
                    devLog('row delete: opening confirm');
                    const ok = await confirmDialog('Delete this device?', btn);
                    devLog('row delete: confirm result', ok);
                    if (!ok) {
                        setButtonState(btn, 'revert');
                        return;
                    }
                    setButtonState(btn, 'loading', { text: 'Deleting…' });
                    const res = await authenticatedFetch(
                        apiUrl(`/api/devices/${encodeURIComponent(id)}`),
                        {
                            method: 'DELETE',
                            noRedirectOn401: true,
                        }
                    );
                    if (!res.ok) throw new Error('Failed to delete');
                    if (status) status.textContent = 'Device deleted.';
                    devLog('row delete: deleted', id);
                    // Refresh the list after delete
                    const list = await fetchDevices();
                    renderDevicesTable(list);
                    setButtonState(btn, 'revert');
                    return;
                }
                if (cmd === 'pair') {
                    setButtonState(btn, 'loading', { text: 'Pairing…' });
                    const res = await authenticatedFetch(
                        apiUrl(`/api/devices/${encodeURIComponent(id)}/pairing-code`),
                        {
                            method: 'POST',
                            body: JSON.stringify({ ttlMs: 10 * 60 * 1000 }),
                            noRedirectOn401: true,
                        }
                    );
                    if (res.status === 404) {
                        if (status) status.textContent = 'Device no longer exists; list refreshed.';
                        const list = await fetchDevices();
                        renderDevicesTable(list);
                        setButtonState(btn, 'revert');
                        return;
                    }
                    if (!res.ok) throw new Error('Failed to get code');
                    const data = await res.json();
                    setButtonState(btn, 'success', { text: 'Code' });
                    const claimUrl = `${location.origin}/?pair=${encodeURIComponent(data.code)}${
                        data.token ? `&pairToken=${encodeURIComponent(data.token)}` : ''
                    }`;
                    showPairingModal({ code: data.code, expiresAt: data.expiresAt, claimUrl });
                    setTimeout(() => setButtonState(btn, 'revert'), 1500);
                } else if (type) {
                    setButtonState(btn, 'loading', { text: 'Queuing…' });
                    // Power toggle: flip UI immediately so Online (no-WS) devices show feedback
                    if (type === 'power.toggle') {
                        try {
                            await sendDeviceCommand(id, 'power.toggle');
                            // Flip UI state
                            btn.classList.toggle('is-off');
                            const isNowOff = btn.classList.contains('is-off');
                            btn.classList.toggle('is-success', !isNowOff);
                            btn.classList.toggle('is-danger', isNowOff);
                            btn.classList.toggle('is-on', !isNowOff);
                            setButtonState(btn, 'success', { text: 'OK' });
                            setTimeout(() => setButtonState(btn, 'revert'), 900);
                        } catch (e) {
                            setButtonState(btn, 'error', { text: 'Failed' });
                            setTimeout(() => setButtonState(btn, 'revert'), 1200);
                        }
                        return;
                    }
                    // Special handling for toggle: infer from button state
                    if (type === 'playback.toggle') {
                        const isPlaying = btn.classList.contains('is-playing');
                        const nextType = isPlaying ? 'playback.pause' : 'playback.resume';
                        await sendDeviceCommand(id, nextType);
                        // Update visual state
                        btn.classList.toggle('is-playing', !isPlaying);
                        const icon = btn.querySelector('i');
                        if (icon) icon.className = `fas ${!isPlaying ? 'fa-pause' : 'fa-play'}`;
                        btn.classList.toggle('is-primary', !isPlaying); // green when playing
                        // If we just resumed (now playing), clear pin state in sibling pin button
                        if (!isPlaying) {
                            // we toggled from paused->playing
                            const group = btn.closest('.btn-group');
                            const pinBtn = group && group.querySelector('.pin-btn');
                            if (pinBtn) {
                                pinBtn.classList.remove('is-pinned');
                                pinBtn.setAttribute('aria-pressed', 'false');
                                const pinIcon = pinBtn.querySelector('i');
                                if (pinIcon) pinIcon.className = 'fas fa-thumbtack';
                            }
                            // update local memory
                            const id = btn.getAttribute('data-id');
                            if (id && window.__devicesPinned) delete window.__devicesPinned[id];
                        }
                    } else if (type === 'playback.pinPoster') {
                        const currentlyPinned = btn.classList.contains('is-pinned');
                        const nextType = currentlyPinned ? 'playback.resume' : 'playback.pinPoster';
                        await sendDeviceCommand(id, nextType);
                        const group = btn.closest('.btn-group');
                        const toggleBtn = group && group.querySelector('.playback-toggle');
                        const tIcon = toggleBtn && toggleBtn.querySelector('i');
                        if (currentlyPinned) {
                            // Unpin: revert UI and set playback to playing
                            btn.classList.remove('is-pinned');
                            btn.setAttribute('aria-pressed', 'false');
                            const pinIcon = btn.querySelector('i');
                            if (pinIcon) pinIcon.className = 'fas fa-thumbtack';
                            if (toggleBtn) {
                                toggleBtn.classList.remove('is-paused');
                                toggleBtn.classList.add('is-playing', 'is-primary');
                                if (tIcon) tIcon.className = 'fas fa-pause';
                            }
                            // local memory
                            const id = btn.getAttribute('data-id');
                            if (id) {
                                window.__devicesPinned =
                                    window.__devicesPinned || Object.create(null);
                                delete window.__devicesPinned[id];
                            }
                        } else {
                            // Pin: apply UI and set playback to paused
                            btn.classList.add('is-pinned');
                            btn.setAttribute('aria-pressed', 'true');
                            const pinIcon = btn.querySelector('i');
                            if (pinIcon) pinIcon.className = 'fas fa-map-pin';
                            if (toggleBtn) {
                                toggleBtn.classList.remove('is-playing', 'is-primary');
                                toggleBtn.classList.add('is-paused');
                                if (tIcon) tIcon.className = 'fas fa-play';
                            }
                            const id2 = btn.getAttribute('data-id');
                            if (id2) {
                                window.__devicesPinned =
                                    window.__devicesPinned || Object.create(null);
                                window.__devicesPinned[id2] = true;
                            }
                        }
                    } else {
                        var __result = await sendDeviceCommand(id, type);
                    }
                    const live = (__result && __result.live) === true;
                    setButtonState(btn, 'success', { text: live ? 'Live' : 'Queued' });
                    if (status)
                        status.textContent = live
                            ? 'Live: command delivered via WebSocket.'
                            : 'Queued: will run on next heartbeat.';
                    setTimeout(() => setButtonState(btn, 'revert'), 1200);
                }
                devLog('row command queued', { cmd, id, type });
            } catch (err) {
                setButtonState(btn, 'error', { text: 'Failed' });
                if (status) status.textContent = 'Failed to queue command (are you logged in?)';
                setTimeout(() => setButtonState(btn, 'revert'), 1500);
                console.error('[Devices] row action error', err);
            }
        });
    });
}

function tbodyHasRows() {
    try {
        const tbody = document.querySelector('#devices-table tbody');
        return !!(tbody && tbody.querySelector('tr'));
    } catch (_) {
        return false;
    }
}

function initDevicesPanel() {
    const container = document.getElementById('devices-subsection');
    if (!container) return;
    const refreshBtn = document.getElementById('devices-refresh');
    const status = document.getElementById('devices-status');
    let liveTimer = null;
    devLog('initDevicesPanel: start');

    // Attach delegated handlers once for reliability (works across re-renders)
    if (!container.dataset.delegatedBound) {
        container.dataset.delegatedBound = '1';
        const table = container.querySelector('#devices-table');
        if (table) {
            table.addEventListener('click', async ev => {
                const btn = ev.target && ev.target.closest && ev.target.closest('button[data-cmd]');
                const applyBtn =
                    ev.target && ev.target.closest && ev.target.closest('.apply-preset-btn');
                const actionBtn = btn || applyBtn;
                if (!actionBtn) return;
                ev.preventDefault();
                ev.stopPropagation();
                if (actionBtn.disabled) return;
                try {
                    actionBtn.blur?.();
                } catch (_) {
                    // ignore blur errors
                }
                if (applyBtn) {
                    const id = applyBtn.getAttribute('data-id');
                    const key = applyBtn.getAttribute('data-preset');
                    const presets = getDevicePresets();
                    const found = presets.find(p => p.key === key);
                    if (!found || !found.overrides) return;
                    const status = document.getElementById('devices-status');
                    try {
                        if (status) status.textContent = 'Applying preset...';
                        await authenticatedFetch(apiUrl(`/api/devices/${encodeURIComponent(id)}`), {
                            method: 'PATCH',
                            body: JSON.stringify({ settingsOverride: found.overrides }),
                            noRedirectOn401: true,
                        });
                        const list = await fetchDevices();
                        renderDevicesTable(list);
                        if (status) status.textContent = 'Preset applied.';
                    } catch (e) {
                        if (status) status.textContent = 'Failed to apply preset.';
                    }
                    return;
                }
                const id = btn.getAttribute('data-id');
                const cmd = btn.getAttribute('data-cmd');
                devLog('delegated table click', { cmd, id });
                const commandMap = {
                    reload: 'core.mgmt.reload',
                    reset: 'core.mgmt.reset',
                    'power.toggle': 'power.toggle',
                    'playback.prev': 'playback.prev',
                    'playback.next': 'playback.next',
                    'playback.pause': 'playback.pause',
                    'playback.resume': 'playback.resume',
                    'playback.pinPoster': 'playback.pinPoster',
                    'playback.toggle': 'playback.toggle',
                    'source.switch': 'source.switch',
                };
                const type = commandMap[cmd] || null;
                try {
                    // If device is powered off and a non-power command is requested, wake first
                    if (type && !type.startsWith('power.')) {
                        const group = btn.closest('.btn-group');
                        const powerBtn = group && group.querySelector('.power-toggle');
                        const isOff = powerBtn && powerBtn.classList.contains('is-off');
                        if (isOff) {
                            setButtonState(btn, 'loading', { text: 'Waking…' });
                            await sendDeviceCommand(id, 'power.on');
                            // Flip power button UI to on
                            powerBtn.classList.remove('is-off', 'is-danger');
                            powerBtn.classList.add('is-on', 'is-success');
                            await new Promise(r => setTimeout(r, 200));
                            setButtonState(btn, 'revert');
                        }
                    }
                    if (cmd === 'overrides') {
                        const res = await authenticatedFetch(
                            apiUrl(`/api/devices/${encodeURIComponent(id)}`),
                            { method: 'GET', noRedirectOn401: true }
                        );
                        if (!res.ok) throw new Error('Failed to load device');
                        const device = await res.json();
                        showDeviceSettingsModal(device);
                        return;
                    }
                    if (cmd === 'send-command') {
                        showSendCommandPopover(btn, id);
                        return;
                    }
                    if (cmd === 'remote') {
                        showRemoteModal(id);
                        return;
                    }
                    if (cmd === 'delete') {
                        devLog('delegated delete: confirm open');
                        const ok = await confirmDialog('Delete this device?', btn);
                        devLog('delegated delete: confirm result', ok);
                        if (!ok) return;
                        setButtonState(btn, 'loading', { text: 'Deleting…' });
                        const res = await authenticatedFetch(
                            apiUrl(`/api/devices/${encodeURIComponent(id)}`),
                            { method: 'DELETE', noRedirectOn401: true }
                        );
                        if (!res.ok) throw new Error('Failed to delete');
                        if (status) status.textContent = 'Device deleted.';
                        const list = await fetchDevices();
                        renderDevicesTable(list);
                        setButtonState(btn, 'revert');
                        return;
                    }
                    if (type === 'power.toggle') {
                        setButtonState(btn, 'loading', { text: 'Power…' });
                        await sendDeviceCommand(id, 'power.toggle');
                        // Flip UI state
                        btn.classList.toggle('is-off');
                        const isNowOff = btn.classList.contains('is-off');
                        btn.classList.toggle('is-success', !isNowOff);
                        btn.classList.toggle('is-danger', isNowOff);
                        btn.classList.toggle('is-on', !isNowOff);
                        setButtonState(btn, 'success', { text: 'OK' });
                        setTimeout(() => setButtonState(btn, 'revert'), 900);
                        return;
                    }
                    if (cmd === 'pair') {
                        setButtonState(btn, 'loading', { text: 'Pairing…' });
                        const res = await authenticatedFetch(
                            apiUrl(`/api/devices/${encodeURIComponent(id)}/pairing-code`),
                            {
                                method: 'POST',
                                body: JSON.stringify({ ttlMs: 10 * 60 * 1000 }),
                                noRedirectOn401: true,
                            }
                        );
                        if (res.status === 404) {
                            if (status)
                                status.textContent = 'Device no longer exists; list refreshed.';
                            const list = await fetchDevices();
                            renderDevicesTable(list);
                            setButtonState(btn, 'revert');
                            return;
                        }
                        if (!res.ok) throw new Error('Failed to get code');
                        const data = await res.json();
                        setButtonState(btn, 'success', { text: 'Code' });
                        const claimUrl = `${location.origin}/?pair=${encodeURIComponent(
                            data.code
                        )}${data.token ? `&pairToken=${encodeURIComponent(data.token)}` : ''}`;
                        showPairingModal({ code: data.code, expiresAt: data.expiresAt, claimUrl });
                        setTimeout(() => setButtonState(btn, 'revert'), 1500);
                    } else if (type) {
                        setButtonState(btn, 'loading', { text: 'Queuing…' });
                        let payload;
                        if (type === 'source.switch') {
                            const srcKey = prompt(
                                'Enter source key to switch to (e.g., plex, jellyfin, tmdb, tvdb):'
                            );
                            if (!srcKey) {
                                setButtonState(btn, 'revert');
                                return;
                            }
                            payload = { sourceKey: srcKey };
                        } else if (type === 'playback.toggle') {
                            const isPlaying = btn.classList.contains('is-playing');
                            const nextType = isPlaying ? 'playback.pause' : 'playback.resume';
                            await sendDeviceCommand(id, nextType);
                            btn.classList.toggle('is-playing', !isPlaying);
                            const icon = btn.querySelector('i');
                            if (icon) icon.className = `fas ${!isPlaying ? 'fa-pause' : 'fa-play'}`;
                            btn.classList.toggle('is-primary', !isPlaying);
                            if (!isPlaying) {
                                // transitioned to playing, clear pin
                                const group = btn.closest('.btn-group');
                                const pinBtn = group && group.querySelector('.pin-btn');
                                if (pinBtn) {
                                    pinBtn.classList.remove('is-pinned');
                                    pinBtn.setAttribute('aria-pressed', 'false');
                                    const pinIcon = pinBtn.querySelector('i');
                                    if (pinIcon) pinIcon.className = 'fas fa-thumbtack';
                                }
                                // update local memory
                                const id2 = btn.getAttribute('data-id');
                                if (id2 && window.__devicesPinned)
                                    delete window.__devicesPinned[id2];
                            }
                        } else if (type === 'playback.pinPoster') {
                            const currentlyPinned = btn.classList.contains('is-pinned');
                            const nextType = currentlyPinned
                                ? 'playback.resume'
                                : 'playback.pinPoster';
                            await sendDeviceCommand(id, nextType);
                            const group = btn.closest('.btn-group');
                            const toggleBtn = group && group.querySelector('.playback-toggle');
                            const tIcon = toggleBtn && toggleBtn.querySelector('i');
                            if (currentlyPinned) {
                                btn.classList.remove('is-pinned');
                                btn.setAttribute('aria-pressed', 'false');
                                const pinIcon = btn.querySelector('i');
                                if (pinIcon) pinIcon.className = 'fas fa-thumbtack';
                                if (toggleBtn) {
                                    toggleBtn.classList.remove('is-paused');
                                    toggleBtn.classList.add('is-playing', 'is-primary');
                                    if (tIcon) tIcon.className = 'fas fa-pause';
                                }
                                const id2 = btn.getAttribute('data-id');
                                if (id2) {
                                    window.__devicesPinned =
                                        window.__devicesPinned || Object.create(null);
                                    delete window.__devicesPinned[id2];
                                }
                            } else {
                                btn.classList.add('is-pinned');
                                btn.setAttribute('aria-pressed', 'true');
                                const pinIcon = btn.querySelector('i');
                                if (pinIcon) pinIcon.className = 'fas fa-map-pin';
                                if (toggleBtn) {
                                    toggleBtn.classList.remove('is-playing', 'is-primary');
                                    toggleBtn.classList.add('is-paused');
                                    if (tIcon) tIcon.className = 'fas fa-play';
                                }
                                const id3 = btn.getAttribute('data-id');
                                if (id3) {
                                    window.__devicesPinned =
                                        window.__devicesPinned || Object.create(null);
                                    window.__devicesPinned[id3] = true;
                                }
                            }
                        }
                        let __result2;
                        if (type !== 'playback.toggle')
                            __result2 = await sendDeviceCommand(id, type, payload);
                        const live2 = __result2 && __result2.live === true;
                        setButtonState(btn, 'success', { text: live2 ? 'Live' : 'Queued' });
                        if (status)
                            status.textContent = live2
                                ? 'Live: command delivered via WebSocket.'
                                : 'Queued: will run on next heartbeat.';
                        setTimeout(() => setButtonState(btn, 'revert'), 1200);
                        devLog('delegated command queued', { cmd, id, type });
                    }
                } catch (err) {
                    setButtonState(btn, 'error', { text: 'Failed' });
                    setTimeout(() => setButtonState(btn, 'revert'), 1500);
                    console.error('[Devices] delegated table click error', err);
                }
            });
            devLog('initDevicesPanel: delegated table handler bound');
        }
        // Persist search box state and filter
        const searchEl = container.querySelector('#devices-search');
        if (searchEl) {
            try {
                const saved = localStorage.getItem('devices.ui.search') || '';
                if (saved) searchEl.value = saved;
            } catch (_) {}
            // Live-filter on input and on native 'search' (clear button in type=search)
            const doFilter = async () => {
                try {
                    const val = (searchEl.value || '').trim();
                    if (typeof window !== 'undefined') {
                        window.__devicesSearchTerm = val;
                    }
                    localStorage.setItem('devices.ui.search', val);
                } catch (_) {}
                // Optimistic client-side filter of existing rows first (snappier)
                try {
                    const existing = Array.from(
                        document.querySelectorAll('#devices-table tbody tr')
                    )
                        .map(tr => tr.__deviceData)
                        .filter(Boolean);
                    if (existing.length) reconcileDevicesTable(existing);
                } catch (_) {}
                // Then fetch fresh list to reflect server changes
                const list = await fetchDevices();
                if (tbodyHasRows()) reconcileDevicesTable(list);
                else renderDevicesTable(list);
            };
            // Prevent Enter from submitting the surrounding form and trigger filter
            searchEl.addEventListener('keydown', ev => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    doFilter();
                }
            });
            searchEl.addEventListener('input', doFilter);
            searchEl.addEventListener('search', doFilter);
            searchEl.addEventListener('keyup', ev => {
                // Trigger on character keys; prevent double-trigger when Enter already handled
                if (ev.key === 'Enter') return;
                doFilter();
            });
            searchEl.addEventListener('compositionend', doFilter);
            // If a saved search is present on load, run once to filter initial table
            if ((searchEl.value || '').trim()) {
                doFilter();
            }
        }
        const bulkDeleteBtn = container.querySelector('#devices-delete-selected');
        const managePresetsBtn = container.querySelector('#manage-device-presets');
        // Manage Presets access via menu item now; keep handler if present (back-compat)
        if (managePresetsBtn) {
            managePresetsBtn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                showManagePresetsModal();
            });
        }
        // Presets compact menu
        const menuBtn = container.querySelector('#presets-menu-button');
        const menu = container.querySelector('#presets-menu');
        const menuList = container.querySelector('#presets-menu-list');
        const menuManage = container.querySelector('#menu-manage-presets');
        if (menuBtn && menu && menuList && menuManage) {
            const closeMenu = () => {
                menu.classList.remove('open');
                menuBtn.setAttribute('aria-expanded', 'false');
                menu.setAttribute('aria-hidden', 'true');
                try {
                    localStorage.setItem('devices.ui.menu.presets.open', '0');
                } catch (_) {}
            };
            const openMenu = () => {
                // Populate items
                const presets = getDevicePresets();
                menuList.innerHTML = '';
                if (!presets.length) {
                    const empty = document.createElement('div');
                    empty.className = 'menu-item';
                    empty.textContent = 'No presets defined';
                    empty.setAttribute('role', 'menuitem');
                    empty.disabled = true;
                    menuList.appendChild(empty);
                } else {
                    // Add an item for "(none)" to clear preset key
                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'menu-item';
                    clearBtn.innerHTML =
                        '<i class="fas fa-ban"></i><span>Assign (none) to selected</span>';
                    clearBtn.addEventListener('click', async () => {
                        await bulkAssignPreset('');
                        closeMenu();
                    });
                    menuList.appendChild(clearBtn);
                    // Divider
                    const div = document.createElement('div');
                    div.className = 'menu-divider';
                    menuList.appendChild(div);
                    presets.forEach(p => {
                        const btn = document.createElement('button');
                        btn.className = 'menu-item';
                        btn.setAttribute('role', 'menuitem');
                        btn.innerHTML = `<i class="fas fa-tag"></i><span>${(p.name || p.key || '').replace(/</g, '&lt;')}</span>`;
                        btn.addEventListener('click', async () => {
                            await bulkAssignPreset(p.key || '');
                            closeMenu();
                        });
                        menuList.appendChild(btn);
                    });
                }
                menu.classList.add('open');
                menuBtn.setAttribute('aria-expanded', 'true');
                menu.setAttribute('aria-hidden', 'false');
                try {
                    localStorage.setItem('devices.ui.menu.presets.open', '1');
                } catch (_) {}
            };
            const bulkAssignPreset = async key => {
                const tbody = container.querySelector('#devices-table tbody');
                const ids = Array.from(tbody.querySelectorAll('.row-select:checked')).map(cb =>
                    cb.getAttribute('data-id')
                );
                if (!ids.length) return;
                const status = document.getElementById('devices-status');
                if (status) status.textContent = 'Assigning preset...';
                for (const id of ids) {
                    try {
                        await authenticatedFetch(apiUrl(`/api/devices/${encodeURIComponent(id)}`), {
                            method: 'PATCH',
                            body: JSON.stringify({ preset: key }),
                            noRedirectOn401: true,
                        });
                    } catch (_) {}
                }
                const list = await fetchDevices();
                renderDevicesTable(list);
                if (status) status.textContent = 'Preset assigned to selected device(s).';
            };
            menuBtn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                if (menu.classList.contains('open')) closeMenu();
                else openMenu();
            });
            // Hydrate open state
            try {
                if (localStorage.getItem('devices.ui.menu.presets.open') === '1') {
                    openMenu();
                }
            } catch (_) {}
            menuManage.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                closeMenu();
                showManagePresetsModal();
            });
            document.addEventListener('click', e => {
                if (!menu.contains(e.target) && e.target !== menuBtn) closeMenu();
            });
        }
        if (bulkDeleteBtn) {
            bulkDeleteBtn.addEventListener('click', async ev => {
                ev.preventDefault();
                ev.stopPropagation();
                const tbody = container.querySelector('#devices-table tbody');
                const ids = Array.from(tbody.querySelectorAll('.row-select:checked')).map(cb =>
                    cb.getAttribute('data-id')
                );
                devLog('init bulk delete: ids', ids);
                if (!ids.length) return;
                const ok = await confirmDialog(`Delete ${ids.length} device(s)?`, bulkDeleteBtn);
                devLog('init bulk delete: confirm result', ok);
                if (!ok) return;
                for (const id of ids) {
                    try {
                        await authenticatedFetch(apiUrl(`/api/devices/${encodeURIComponent(id)}`), {
                            method: 'DELETE',
                            noRedirectOn401: true,
                        });
                        devLog('init bulk delete: deleted', id);
                    } catch (_) {
                        // ignore per-id delete errors
                    }
                }
                const list = await fetchDevices();
                renderDevicesTable(list);
            });
            devLog('initDevicesPanel: bulk delete handler bound');
        }

        // Merge compact menu
        const mergeMenuBtn = container.querySelector('#merge-menu-button');
        const mergeMenu = container.querySelector('#merge-menu');
        const mergeSelectedBtn = container.querySelector('#menu-merge-selected');
        if (mergeMenuBtn && mergeMenu && mergeSelectedBtn) {
            const closeMenu = () => {
                mergeMenu.classList.remove('open');
                mergeMenuBtn.setAttribute('aria-expanded', 'false');
                mergeMenu.setAttribute('aria-hidden', 'true');
                try {
                    localStorage.setItem('devices.ui.menu.merge.open', '0');
                } catch (_) {}
            };
            const openMenu = () => {
                mergeMenu.classList.add('open');
                mergeMenuBtn.setAttribute('aria-expanded', 'true');
                mergeMenu.setAttribute('aria-hidden', 'false');
                try {
                    localStorage.setItem('devices.ui.menu.merge.open', '1');
                } catch (_) {}
            };
            mergeMenuBtn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                if (mergeMenu.classList.contains('open')) closeMenu();
                else openMenu();
            });
            // Hydrate open state
            try {
                if (localStorage.getItem('devices.ui.menu.merge.open') === '1') {
                    openMenu();
                }
            } catch (_) {}
            document.addEventListener('click', e => {
                if (!mergeMenu.contains(e.target) && e.target !== mergeMenuBtn) closeMenu();
            });

            // Lightweight toast helper for status feedback
            const showToast = (message, type = 'info', timeout = 3500) => {
                try {
                    let container = document.getElementById('toast-container');
                    if (!container) {
                        container = document.createElement('div');
                        container.id = 'toast-container';
                        container.setAttribute('aria-live', 'polite');
                        container.setAttribute('role', 'status');
                        document.body.appendChild(container);
                    }
                    const t = document.createElement('div');
                    t.className = `toast toast-${type}`;
                    t.textContent = message;
                    container.appendChild(t);
                    // Force reflow to enable CSS animation on insert
                    // eslint-disable-next-line no-unused-expressions
                    t.offsetHeight;
                    t.classList.add('show');
                    const remove = () => {
                        t.classList.remove('show');
                        t.addEventListener('transitionend', () => t.remove(), { once: true });
                        setTimeout(() => t.remove(), 500);
                    };
                    setTimeout(remove, Math.max(1500, timeout | 0));
                } catch (_) {
                    /* no-op */
                }
            };

            const openMergeModal = ids => {
                if (!ids || ids.length < 2) return;
                const existing = document.getElementById('merge-devices-modal');
                if (existing) existing.remove();
                const tbody = container.querySelector('#devices-table tbody');
                const entries = ids.map(id => {
                    const row = tbody.querySelector(`tr[data-id="${id}"]`);
                    // Prefer attached device data, then the inline name input, else fallback to ID
                    const d = row && row.__deviceData;
                    let name = (d && d.name) || '';
                    if (!name && row) {
                        const input = row.querySelector('input.name-input');
                        if (input && typeof input.value === 'string') name = input.value.trim();
                    }
                    if (!name) name = id;
                    return { id, name };
                });
                const radios = entries
                    .map(
                        (e, idx) => `
                        <label class="merge-target" style="display:flex;align-items:flex-start;gap:8px;margin:6px 0;">
                            <input type="radio" name="merge-target" value="${e.id}" ${idx === 0 ? 'checked' : ''} />
                            <span class="merge-text" style="display:flex;flex-direction:column;line-height:1.2;">
                                <span class="merge-name" style="font-weight:600;">${(e.name || '').replace(/</g, '&lt;')}</span>
                                <span class="merge-id" style="opacity:0.85;font-family:monospace;">${e.id.slice(0, 8)}</span>
                            </span>
                        </label>`
                    )
                    .join('');
                const html = `
                    <div id="merge-devices-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="merge-devices-title">
                        <div class="modal-background" data-close></div>
                        <div class="modal-content" style="max-width: 680px;">
                            <span class="close" data-close>&times;</span>
                            <h3 id="merge-devices-title" class="section-title modal-section-title">
                                <i class="fas fa-compress-arrows-alt"></i>
                                <span>Merge devices</span>
                            </h3>
                            <div class="form-section unified-section">
                                <div class="subsection-content">
                                    <p>Select the device to keep. Others will be merged into it and removed.</p>
                                    <div class="merge-list">${radios}</div>
                                    <div class="actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
                                        <button type="button" class="btn" data-close>Cancel</button>
                                        <button type="button" class="btn is-primary" id="merge-do">Merge</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>`;
                const wrap = document.createElement('div');
                wrap.innerHTML = html;
                const modal = wrap.firstElementChild;
                document.body.appendChild(modal);
                // Accessibility and focus management
                const activeBefore = document.activeElement;
                const focusables = () =>
                    Array.from(
                        modal.querySelectorAll(
                            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                        )
                    ).filter(el => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
                // Helpers return arrays; compute first/last inline to avoid unused vars lint
                // compute first/last on demand within key handlers; no persistent helpers needed

                const close = () => {
                    if (!modal) return;
                    modal.remove();
                    try {
                        // restore focus to the element that opened the modal
                        if (activeBefore && typeof activeBefore.focus === 'function')
                            activeBefore.focus();
                    } catch (_) {}
                };
                modal
                    .querySelectorAll('[data-close]')
                    .forEach(el => el.addEventListener('click', close));
                modal.addEventListener('click', e => {
                    if (e.target === modal) close();
                });
                // Keyboard handling: trap focus and close on Esc
                modal.addEventListener('keydown', e => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        close();
                        return;
                    }
                    if (e.key === 'Tab') {
                        const f = focusables();
                        if (!f.length) return;
                        const first = f[0];
                        const last = f[f.length - 1];
                        if (e.shiftKey) {
                            if (document.activeElement === first) {
                                e.preventDefault();
                                last.focus();
                            }
                        } else {
                            if (document.activeElement === last) {
                                e.preventDefault();
                                first.focus();
                            }
                        }
                    }
                });
                // Set initial focus to primary action
                setTimeout(() => {
                    const primary = modal.querySelector('#merge-do');
                    if (primary) primary.focus();
                }, 0);
                const doBtn = modal.querySelector('#merge-do');
                doBtn.addEventListener('click', async () => {
                    try {
                        const sel = modal.querySelector('input[name="merge-target"]:checked');
                        const target = sel && sel.value;
                        if (!target || !ids.includes(target)) return;
                        const sources = ids.filter(id => id !== target);
                        // Loading state
                        doBtn.disabled = true;
                        doBtn.textContent = 'Merging…';
                        doBtn.classList.add('is-loading');
                        const res = await authenticatedFetch(
                            apiUrl(`/api/devices/${encodeURIComponent(target)}/merge`),
                            {
                                method: 'POST',
                                body: JSON.stringify({ sourceIds: sources }),
                                noRedirectOn401: true,
                            }
                        );
                        if (!res.ok) throw new Error('merge failed');
                        showToast(`Merged ${sources.length} device(s)`, 'success');
                    } catch (e) {
                        showToast('Merge failed. Try again.', 'error');
                    } finally {
                        doBtn.disabled = false;
                        doBtn.textContent = 'Merge';
                        doBtn.classList.remove('is-loading');
                        close();
                        const list = await fetchDevices();
                        renderDevicesTable(list);
                    }
                });
            };

            mergeSelectedBtn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                closeMenu();
                const tbody = container.querySelector('#devices-table tbody');
                const ids = Array.from(tbody.querySelectorAll('.row-select:checked')).map(cb =>
                    cb.getAttribute('data-id')
                );
                if (ids.length < 2) return;
                openMergeModal(ids);
            });

            // Allow clicking on Dupes badge to open modal with that set preselected
            container.addEventListener('click', ev => {
                const b = ev.target.closest && ev.target.closest('.badge.badge-dup');
                if (!b) return;
                ev.preventDefault();
                ev.stopPropagation();
                const list = (b.getAttribute('data-dupes') || '').split(',').filter(Boolean);
                const selfRow = b.closest('tr');
                const selfId = selfRow && selfRow.getAttribute('data-id');
                const ids = selfId ? [selfId, ...list] : list;
                if (ids.length < 2) return;
                openMergeModal(Array.from(new Set(ids)));
            });

            // Merge suggested button removed; Dupes badge remains for opening merge modal
        }
    }

    let __devicesRefreshInhibitUntil = 0;
    const inhibit = (ms = 800) => {
        __devicesRefreshInhibitUntil = Date.now() + ms;
    };
    // Inhibit on common interactions inside the devices table
    container.addEventListener('focusin', () => inhibit(2000));
    container.addEventListener('pointerdown', () => inhibit(1500));
    container.addEventListener('keydown', () => inhibit(2000));

    async function refresh() {
        // Skip refresh if user is interacting (focus within or recent interaction)
        try {
            const now = Date.now();
            if (now < __devicesRefreshInhibitUntil) {
                devLog('initDevicesPanel: refresh inhibited');
                return;
            }
            if (container.matches && container.matches(':focus-within')) {
                devLog('initDevicesPanel: refresh skipped due to focus');
                return;
            }
        } catch (_) {}
        try {
            if (status) status.textContent = 'Loading devices...';
            // Load presets in parallel, but don't block devices render if it fails
            await loadDevicePresets();
            const list = await fetchDevices();
            if (tbodyHasRows()) {
                reconcileDevicesTable(list);
            } else {
                renderDevicesTable(list);
            }
            if (status) status.textContent = `${list.length} device(s)`;
            devLog('initDevicesPanel: refresh complete', list.length);
        } catch (e) {
            if (status) {
                status.textContent =
                    e && (e.code === 'unauthorized' || e.message === 'unauthorized')
                        ? 'Not signed in: please login again to manage devices.'
                        : 'Failed to load devices.';
            }
            console.error('[Devices] refresh error', e);
        }
    }

    if (refreshBtn) refreshBtn.addEventListener('click', refresh);
    // Auto-load on first open
    refresh();

    // While the devices section is visible, periodically refresh to reflect Live status.
    try {
        const section = document.getElementById('devices-section');
        const onVis = () => {
            const visible = section && section.offsetParent !== null;
            if (visible && !liveTimer)
                liveTimer = setInterval(() => {
                    try {
                        // Avoid background refresh when page/tab not focused to reduce churn
                        if (
                            document.visibilityState === 'hidden' ||
                            document.hasFocus?.() === false
                        )
                            return;
                    } catch (_) {}
                    refresh();
                }, 7000);
            if (!visible && liveTimer) {
                clearInterval(liveTimer);
                liveTimer = null;
            }
        };
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('hashchange', onVis);
        onVis();
    } catch (_) {
        /* ignore live refresh errors */
    }
}

// Simple modal editor for JSON presets
function showManagePresetsModal() {
    const existing = document.getElementById('manage-presets-modal');
    if (existing) existing.remove();
    const presets = getDevicePresets();
    const escHtml = s => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    const html = `
        <div id="manage-presets-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="presets-title">
            <div class="modal-background" data-close></div>
            <div class="modal-content" style="max-width: 960px;">
                <span class="close" data-close>&times;</span>
                <h3 id="presets-title" class="section-title modal-section-title">
                    <i class="fas fa-cog"></i>
                    <span>Device Presets</span>
                </h3>
                <div class="form-section unified-section">
                    <div class="subsection-content">
                        <div class="preset-manager-grid" style="display:grid;grid-template-columns: 280px 1fr;gap:12px;align-items:start;">
                            <div class="left">
                                <div class="field">
                                    <div class="field-label">Select preset</div>
                                    <select id="presets-select-list" size="10" style="width:100%;min-height:240px;">
                                        ${presets
                                            .map(
                                                p =>
                                                    `<option value="${escHtml(p.key || '')}">${escHtml(
                                                        p.name || p.key || ''
                                                    )}</option>`
                                            )
                                            .join('')}
                                    </select>
                                </div>
                                <div class="form-actions" style="display:flex;gap:8px;margin-top:8px;">
                                    <button type="button" id="preset-delete" class="btn btn-danger"><span class="icon"><i class="fas fa-trash"></i></span><span>Delete</span></button>
                                    <button type="button" id="preset-save-as-new" class="btn is-primary"><span class="icon"><i class="fas fa-save"></i></span><span>Save as new…</span></button>
                                    <button type="button" class="btn" data-close><span class="icon"><i class="fas fa-times"></i></span><span>Close</span></button>
                                </div>
                            </div>
                            <div class="right">
                                <div class="field">
                                    <div class="field-label">Preset JSON</div>
                                    <textarea id="preset-json-view" style="width:100%;height:320px;font-family:monospace;white-space:pre;">
${escHtml(presets.length ? JSON.stringify(presets[0], null, 2) : '')}
                                    </textarea>
                                    <div class="hint">Wijzig de JSON indien gewenst; "Save as new" gebruikt deze inhoud.</div>
                                </div>
                            </div>
                        </div>
                        <div id="presets-status" class="hint" style="margin-top:6px;"></div>
                    </div>
                </div>
            </div>
        </div>`;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const el = wrap.firstElementChild;
    document.body.appendChild(el);
    const status = el.querySelector('#presets-status');
    const listEl = el.querySelector('#presets-select-list');
    const jsonEl = el.querySelector('#preset-json-view');
    const saveAsBtn = el.querySelector('#preset-save-as-new');
    const closeEls = el.querySelectorAll('[data-close]');
    closeEls.forEach(c => c.addEventListener('click', () => el.remove()));
    el.classList.add('modal-open');

    const getPresets = () => getDevicePresets();
    const tryParseJson = txt => {
        try {
            return { ok: true, value: JSON.parse(txt) };
        } catch (e) {
            return {
                ok: false,
                error: 'Invalid JSON: ' + (e && e.message ? e.message : 'parse error'),
            };
        }
    };
    // Minimal schema/type validation for known override keys; unknown keys are allowed but ignored for strict checks
    const getByPath = (obj, path) => {
        return path
            .split('.')
            .reduce((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), obj);
    };
    const validators = [
        { path: 'wallartMode.enabled', type: 'boolean' },
        { path: 'wallartMode.refreshRate', type: 'number', min: 1, max: 10 },
        { path: 'wallartMode.randomness', type: 'number', min: 0, max: 10 },
        {
            path: 'wallartMode.layoutSettings.heroGrid.heroRotationMinutes',
            type: 'number',
            min: 1,
            max: 60,
        },
        { path: 'wallartMode.ambientGradient', type: 'boolean' },
        { path: 'cinemaMode', type: 'boolean' },
        {
            path: 'cinemaOrientation',
            type: 'enum',
            values: ['auto', 'portrait', 'portrait-flipped', ''],
        },
        { path: 'showPoster', type: 'boolean' },
        { path: 'showMetadata', type: 'boolean' },
        { path: 'showClearLogo', type: 'boolean' },
        { path: 'showRottenTomatoes', type: 'boolean' },
        { path: 'rottenTomatoesMinimumScore', type: 'number', min: 0, max: 10 },
        { path: 'uiScaling.content', type: 'number', min: 50, max: 200 },
        { path: 'uiScaling.clearlogo', type: 'number', min: 50, max: 200 },
        { path: 'uiScaling.clock', type: 'number', min: 50, max: 200 },
        { path: 'uiScaling.global', type: 'number', min: 50, max: 200 },
        { path: 'wallartMode.layoutVariant', type: 'string' },
        {
            path: 'wallartMode.layoutSettings.heroGrid.heroSide',
            type: 'enum',
            values: ['left', 'right', ''],
        },
    ];
    const validatePresetObject = obj => {
        const errs = [];
        if (typeof obj !== 'object' || obj == null) errs.push('Preset must be an object');
        const key = obj && obj.key;
        if (!key || typeof key !== 'string' || !key.trim())
            errs.push('Key is required and must be a non-empty string');
        if (obj && obj.name != null && typeof obj.name !== 'string')
            errs.push('Name must be a string');
        if (obj && obj.description != null && typeof obj.description !== 'string')
            errs.push('Description must be a string');
        if (obj && obj.overrides != null && typeof obj.overrides !== 'object')
            errs.push('Overrides must be an object');
        // Strict top-level keys check
        const allowedTop = new Set(['key', 'name', 'description', 'overrides']);
        if (obj && typeof obj === 'object') {
            Object.keys(obj).forEach(k => {
                if (!allowedTop.has(k)) errs.push(`Unknown top-level property: ${k}`);
            });
        }
        const ov = obj && obj.overrides;
        if (ov && typeof ov === 'object') {
            validators.forEach(v => {
                const val = getByPath(ov, v.path);
                if (val === undefined) return; // optional, skip
                if (v.type === 'boolean' && typeof val !== 'boolean')
                    errs.push(`${v.path} must be boolean`);
                if (v.type === 'number') {
                    if (typeof val !== 'number' || Number.isNaN(val))
                        errs.push(`${v.path} must be a number`);
                    if (v.min != null && val < v.min) errs.push(`${v.path} must be >= ${v.min}`);
                    if (v.max != null && val > v.max) errs.push(`${v.path} must be <= ${v.max}`);
                }
                if (v.type === 'enum') {
                    if (typeof val !== 'string') errs.push(`${v.path} must be a string`);
                    else if (!v.values.includes(val))
                        errs.push(`${v.path} must be one of: ${v.values.join(', ')}`);
                }
                if (v.type === 'string' && typeof val !== 'string')
                    errs.push(`${v.path} must be a string`);
            });
        }
        return errs;
    };
    const validatePresetsArray = arr => {
        const errs = [];
        if (!Array.isArray(arr)) return ['Presets payload must be an array'];
        const seen = new Set();
        arr.forEach((p, idx) => {
            const per = validatePresetObject(p);
            if (per.length) errs.push(`Item ${idx + 1}: ` + per.join('; '));
            const k = p && p.key;
            if (k && seen.has(k)) errs.push(`Duplicate key: ${k}`);
            if (k) seen.add(k);
        });
        return errs;
    };
    const putPresets = async next => {
        const res = await authenticatedFetch(apiUrl('/api/admin/device-presets'), {
            method: 'PUT',
            body: JSON.stringify(next),
            noRedirectOn401: true,
        });
        if (!res.ok) throw new Error('Failed to save');
        setDevicePresets(next);
        populateBulkPresetPicker();
        const list = await fetchDevices();
        renderDevicesTable(list);
    };

    // Update JSON view on selection
    const refreshJsonFromSelection = () => {
        try {
            const key = listEl && listEl.value;
            const p = getPresets().find(pp => (pp.key || '') === (key || ''));
            jsonEl.value = p ? JSON.stringify(p, null, 2) : '';
        } catch (_) {
            jsonEl.value = '';
        }
    };
    if (listEl) {
        listEl.addEventListener('change', refreshJsonFromSelection);
        // Select first item by default
        if (listEl.options.length) listEl.selectedIndex = 0;
        refreshJsonFromSelection();
    }

    // Delete selected preset
    const delBtn = el.querySelector('#preset-delete');
    if (delBtn && listEl) {
        delBtn.addEventListener('click', async () => {
            const key = listEl.value;
            if (!key) return;
            const ok = await confirmDialog(`Delete preset "${key}"?`, delBtn);
            if (!ok) return;
            try {
                status.textContent = 'Deleting...';
                const next = getPresets().filter(p => (p.key || '') !== key);
                await putPresets(next);
                // Rebuild list
                listEl.innerHTML = next
                    .map(
                        p =>
                            `<option value="${escHtml(p.key || '')}">${escHtml(p.name || p.key || '')}</option>`
                    )
                    .join('');
                if (listEl.options.length) listEl.selectedIndex = 0;
                refreshJsonFromSelection();
                status.textContent = 'Deleted.';
                setTimeout(() => (status.textContent = ''), 1200);
            } catch (e) {
                status.textContent = 'Failed: ' + (e && e.message ? e.message : 'unknown');
            }
        });
    }

    // Save as new preset
    if (saveAsBtn) {
        saveAsBtn.addEventListener('click', async () => {
            try {
                const src = jsonEl.value || '{}';
                const parsed = tryParseJson(src);
                if (!parsed.ok) {
                    status.textContent = parsed.error;
                    return;
                }
                const obj = parsed.value;
                const perr = validatePresetObject(obj).filter(
                    e => !e.startsWith('Key is required')
                );
                if (perr.length) {
                    status.textContent = 'Invalid: ' + perr.join(' | ');
                    return;
                }
                // Ask for new key and optional name
                const newKey = await promptDialog(
                    'New preset key (unique, required):',
                    '',
                    saveAsBtn
                );
                if (!newKey) return;
                const trimmedKey = String(newKey).trim();
                if (!trimmedKey) return;
                const exists = getPresets().some(p => (p.key || '') === trimmedKey);
                if (exists) {
                    status.textContent = 'Failed: key already exists';
                    setTimeout(() => (status.textContent = ''), 1500);
                    return;
                }
                const newName = await promptDialog(
                    'Display name (optional):',
                    obj.name || obj.key || trimmedKey,
                    saveAsBtn
                );
                const nextPreset = {
                    ...obj,
                    key: trimmedKey,
                    name: newName || obj.name || trimmedKey,
                };
                // Ensure global validation on full list
                const next = getPresets().concat([nextPreset]);
                const aerr = validatePresetsArray(next);
                if (aerr.length) {
                    status.textContent = 'Invalid: ' + aerr.join(' | ');
                    return;
                }
                status.textContent = 'Saving...';
                await putPresets(next);
                // Update UI selection
                listEl.innerHTML = next
                    .map(
                        p =>
                            `<option value="${escHtml(p.key || '')}">${escHtml(p.name || p.key || '')}</option>`
                    )
                    .join('');
                // Select the new one
                for (let i = 0; i < listEl.options.length; i++) {
                    if (listEl.options[i].value === trimmedKey) {
                        listEl.selectedIndex = i;
                        break;
                    }
                }
                refreshJsonFromSelection();
                status.textContent = 'Saved new preset.';
                setTimeout(() => (status.textContent = ''), 1200);
            } catch (e) {
                status.textContent = 'Failed: ' + (e && e.message ? e.message : 'unknown');
            }
        });
    }

    // Live validation on JSON edits
    const updateValidationUI = () => {
        if (!saveAsBtn) return;
        const src = jsonEl.value || '{}';
        const parsed = tryParseJson(src);
        if (!parsed.ok) {
            saveAsBtn.disabled = true;
            status.textContent = parsed.error;
            return;
        }
        const errs = validatePresetObject(parsed.value).filter(
            e => !e.startsWith('Key is required')
        );
        if (errs.length) {
            saveAsBtn.disabled = true;
            status.textContent = 'Invalid: ' + errs.join(' | ');
        } else {
            saveAsBtn.disabled = false;
            status.textContent = '';
        }
    };
    if (jsonEl) {
        jsonEl.addEventListener('input', updateValidationUI);
        // Initial validation
        updateValidationUI();
    }
}

// Bind Groups menu in Devices toolbar
(function bindGroupsMenu() {
    try {
        const container = document.getElementById('devices-subsection');
        if (!container) return;
        const btn = container.querySelector('#groups-menu-button');
        const menu = container.querySelector('#groups-menu');
        const manageBtn = container.querySelector('#menu-manage-groups');
        const sendBtn = container.querySelector('#menu-group-send');
        const addBtn = container.querySelector('#menu-group-add');
        const removeBtn = container.querySelector('#menu-group-remove');
        if (!btn || !menu || !manageBtn) return;
        const setOpen = open => {
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            menu.setAttribute('aria-hidden', open ? 'false' : 'true');
            menu.style.display = open ? 'block' : 'none';
            try {
                localStorage.setItem('devices.ui.menu.groups.open', open ? '1' : '0');
            } catch (_) {}
        };
        let open = false;
        btn.addEventListener('click', ev => {
            ev.stopPropagation();
            open = !open;
            setOpen(open);
        });
        // Hydrate open state
        try {
            if (localStorage.getItem('devices.ui.menu.groups.open') === '1') {
                open = true;
                setOpen(true);
            }
        } catch (_) {}
        manageBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            setOpen(false);
            showManageGroupsModal();
        });
        if (sendBtn) {
            sendBtn.addEventListener('click', async ev => {
                ev.stopPropagation();
                setOpen(false);
                try {
                    const groups = await fetchGroups();
                    showQuickGroupCommandModal(groups);
                } catch (_) {
                    // no-op
                }
            });
        }
        // Batch add/remove selected devices to group
        const openBatchGroupModal = async mode => {
            try {
                const tbody = container.querySelector('#devices-table tbody');
                const ids = Array.from(tbody.querySelectorAll('.row-select:checked')).map(cb =>
                    cb.getAttribute('data-id')
                );
                if (!ids.length) return;
                const groups = await fetchGroups();
                const existing = document.getElementById('batch-group-modal');
                if (existing) existing.remove();
                const esc = s => (s == null ? '' : String(s).replace(/</g, '&lt;'));
                const html = `
                    <div id="batch-group-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="batch-group-title">
                        <div class="modal-background" data-close></div>
                        <div class="modal-content" style="max-width:560px;">
                            <span class="close" data-close>&times;</span>
                            <h3 id="batch-group-title" class="section-title modal-section-title">
                                <i class="fas fa-object-group"></i>
                                <span>${mode === 'add' ? 'Add to Group' : 'Remove from Group'}</span>
                            </h3>
                            <div class="form-section unified-section">
                                <div class="subsection-content">
                                    <p>${ids.length} device(s) selected.</p>
                                    <div class="form-group">
                                        <label>Group</label>
                                        <select id="batch-group-select" style="min-width:240px;">
                                            ${groups.map(g => `<option value="${esc(g.id)}">${esc(g.name || g.id)}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
                                        <button type="button" class="btn" data-close>Cancel</button>
                                        <button type="button" class="btn is-primary" id="batch-group-apply">Apply</button>
                                    </div>
                                    <div class="hint" id="batch-group-status" style="margin-top:6px;"></div>
                                </div>
                            </div>
                        </div>
                    </div>`;
                const wrap = document.createElement('div');
                wrap.innerHTML = html;
                const el = wrap.firstElementChild;
                document.body.appendChild(el);
                el.querySelectorAll('[data-close]').forEach(c =>
                    c.addEventListener('click', () => el.remove())
                );
                const select = el.querySelector('#batch-group-select');
                const apply = el.querySelector('#batch-group-apply');
                const status = el.querySelector('#batch-group-status');
                apply.addEventListener('click', async () => {
                    const gid = select.value;
                    if (!gid) return;
                    apply.disabled = true;
                    apply.textContent = 'Applying…';
                    try {
                        for (const id of ids) {
                            try {
                                const row = tbody.querySelector(`tr[data-id="${id}"]`);
                                const current =
                                    row &&
                                    row.__deviceData &&
                                    Array.isArray(row.__deviceData.groups)
                                        ? row.__deviceData.groups.slice()
                                        : [];
                                const set = new Set(current);
                                if (mode === 'add') set.add(gid);
                                else set.delete(gid);
                                await patchDeviceGroups(id, Array.from(set));
                            } catch (_) {}
                        }
                        // Refresh list and reconcile/restore selection
                        const list = await fetchDevices();
                        renderDevicesTable(list);
                        if (typeof showNotification === 'function') {
                            showNotification(
                                `Group ${mode === 'add' ? 'added to' : 'removed from'} ${ids.length} device(s)`,
                                'success'
                            );
                        }
                        el.remove();
                    } catch (e) {
                        status.textContent = 'Failed to apply to some devices';
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update groups', 'error');
                        }
                    } finally {
                        apply.disabled = false;
                        apply.textContent = 'Apply';
                    }
                });
            } catch (_) {}
        };
        if (addBtn)
            addBtn.addEventListener('click', ev => {
                ev.stopPropagation();
                setOpen(false);
                openBatchGroupModal('add');
            });
        if (removeBtn)
            removeBtn.addEventListener('click', ev => {
                ev.stopPropagation();
                setOpen(false);
                openBatchGroupModal('remove');
            });
        document.addEventListener('click', e => {
            if (!open) return;
            if (!menu.contains(e.target) && e.target !== btn) {
                open = false;
                setOpen(false);
            }
        });
    } catch (_) {}
})();

// Manage Groups modal (under Devices section)
function showManageGroupsModal() {
    const existing = document.getElementById('manage-groups-modal');
    if (existing) existing.remove();
    const escHtml = s => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    const buildHtml = groups => `
        <div id="manage-groups-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="groups-title">
            <div class="modal-background" data-close></div>
            <div class="modal-content" style="max-width: 1024px;">
                <span class="close" data-close>&times;</span>
                <h3 id="groups-title" class="section-title modal-section-title">
                    <i class="fas fa-object-group"></i>
                    <span>Device Groups</span>
                </h3>
                <div class="form-section unified-section">
                    <div class="subsection-content">
                        <div class="preset-manager-grid" style="display:grid;grid-template-columns: 320px 1fr;gap:12px;align-items:start;">
                            <div class="left">
                                <div class="field">
                                    <div class="field-label">Groups</div>
                                    <select id="groups-select-list" size="12" style="width:100%;min-height:280px;">
                                        ${groups
                                            .map(
                                                g =>
                                                    `<option value="${escHtml(g.id)}">${escHtml(
                                                        g.name || g.id
                                                    )}</option>`
                                            )
                                            .join('')}
                                    </select>
                                </div>
                                <div class="form-actions" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                                    <button type="button" id="group-create" class="btn is-primary"><span class="icon"><i class="fas fa-plus"></i></span><span>New</span></button>
                                    <button type="button" id="group-rename" class="btn"><span class="icon"><i class="fas fa-pen"></i></span><span>Rename</span></button>
                                    <button type="button" id="group-delete" class="btn btn-danger"><span class="icon"><i class="fas fa-trash"></i></span><span>Delete</span></button>
                                    <button type="button" class="btn" data-close><span class="icon"><i class="fas fa-times"></i></span><span>Close</span></button>
                                </div>
                            </div>
                            <div class="right">
                                <div class="field">
                                    <div class="field-label">Members</div>
                                    <div id="group-members-box" style="border:1px solid rgba(255,255,255,0.1);padding:8px;border-radius:8px;max-height:360px;overflow:auto;">
                                        <div class="hint">Select a group to manage its members.</div>
                                    </div>
                                </div>
                                <div class="field" style="margin-top:12px;">
                                    <div class="field-label">Template (JSON)</div>
                                    <textarea id="group-template-json" rows="8" placeholder='{"transitionIntervalSeconds": 12}' style="width:100%;"></textarea>
                                    <div class="hint small" id="group-template-hint" style="margin-top:4px;opacity:.85;"></div>
                                </div>
                                <div class="form-grid-3" style="margin-top:8px;gap:8px;">
                                    <div class="form-group">
                                        <label for="group-order-input">Order</label>
                                        <input id="group-order-input" type="number" min="0" step="1" style="width:120px" />
                                    </div>
                                    <div class="form-group">
                                        <label>&nbsp;</label>
                                        <button type="button" id="group-save-template" class="btn is-primary"><i class="fas fa-save icon"></i><span>Save Template</span></button>
                                    </div>
                                    <div class="form-group">
                                        <label>&nbsp;</label>
                                        <button type="button" id="group-save-order" class="btn"><i class="fas fa-list-ol icon"></i><span>Save Order</span></button>
                                    </div>
                                </div>
                                <div class="field" style="margin-top:12px;">
                                    <div class="field-label">Send Command</div>
                                    <div class="form-grid-3" style="gap:8px;align-items:end;">
                                        <div class="form-group">
                                            <label for="group-cmd-type">Command</label>
                                            <select id="group-cmd-type" style="min-width:180px">
                                                <option value="playback.next">Next Poster</option>
                                                <option value="playback.prev">Previous Poster</option>
                                                <option value="playback.toggle">Toggle Pause/Resume</option>
                                                <option value="source.switch">Switch Source</option>
                                                <option value="power.off">Power Off</option>
                                                <option value="power.on">Power On</option>
                                                <option value="reload">Reload</option>
                                            </select>
                                        </div>
                                        <div class="form-group">
                                            <label for="group-cmd-payload">Payload (JSON)</label>
                                            <input id="group-cmd-payload" type="text" placeholder='{"sourceKey":"plex"}' />
                                        </div>
                                        <div class="form-group">
                                            <button type="button" id="group-cmd-send" class="btn"><i class="fas fa-paper-plane icon"></i><span>Send</span></button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="hint" style="margin-top:6px;"></div>
                    </div>
                </div>
            </div>
        </div>`;

    const loadAndRender = async () => {
        const [groups, devices] = await Promise.all([fetchGroups(), fetchDevicesLight()]);
        const wrap = document.createElement('div');
        wrap.innerHTML = buildHtml(groups);
        const el = wrap.firstElementChild;
        document.body.appendChild(el);
        const status = el.querySelector('.hint');
        const listEl = el.querySelector('#groups-select-list');
        const membersBox = el.querySelector('#group-members-box');
        const tplEl = el.querySelector('#group-template-json');
        const tplHint = el.querySelector('#group-template-hint');
        const orderInput = el.querySelector('#group-order-input');
        const saveTplBtn = el.querySelector('#group-save-template');
        const saveOrderBtn = el.querySelector('#group-save-order');
        const cmdTypeEl = el.querySelector('#group-cmd-type');
        const cmdPayloadEl = el.querySelector('#group-cmd-payload');
        const cmdSendBtn = el.querySelector('#group-cmd-send');
        el.classList.add('modal-open');
        el.classList.remove('is-hidden');
        // Close handlers
        el.querySelectorAll('[data-close]').forEach(c =>
            c.addEventListener('click', () => el.remove())
        );

        const renderMembers = gid => {
            if (!gid) {
                membersBox.innerHTML =
                    '<div class="hint">Select a group to manage its members.</div>';
                if (tplEl) tplEl.value = '';
                if (orderInput) orderInput.value = '';
                if (tplHint) tplHint.textContent = '';
                return;
            }
            const g = groups.find(x => x.id === gid) || {};
            const set = new Set(
                devices
                    .filter(d => Array.isArray(d.groups) && d.groups.includes(gid))
                    .map(d => d.id)
            );
            membersBox.innerHTML = devices
                .map(d => {
                    const safe = s => (s == null ? '' : String(s).replace(/</g, '&lt;'));
                    const checked = set.has(d.id) ? 'checked' : '';
                    return `<label class="checkbox-label" style="display:block;margin:.25rem 0;">
                        <input type="checkbox" data-did="${safe(d.id)}" ${checked} />
                        <span>${safe(d.name || d.id)}</span>
                    </label>`;
                })
                .join('');
            if (tplEl) {
                try {
                    tplEl.value = g.settingsTemplate
                        ? JSON.stringify(g.settingsTemplate, null, 2)
                        : '';
                    tplHint.textContent =
                        'Group templates override device defaults. Known keys: transitionIntervalSeconds, cinemaMode, cinemaOrientation, wallartMode.*';
                } catch (_) {
                    tplEl.value = '';
                }
            }
            if (orderInput) {
                orderInput.value = Number.isFinite(g.order) ? g.order : 0;
            }
        };

        listEl.addEventListener('change', () => {
            renderMembers(listEl.value);
        });

        // Save template
        if (saveTplBtn && tplEl) {
            saveTplBtn.addEventListener('click', async () => {
                const gid = listEl.value;
                if (!gid) return;
                let parsed = {};
                const txt = (tplEl.value || '').trim();
                if (txt) {
                    try {
                        parsed = JSON.parse(txt);
                    } catch (e) {
                        tplHint.textContent =
                            'Invalid JSON: ' + (e && e.message ? e.message : 'parse error');
                        return;
                    }
                }
                // Warn on unknown top-level keys (non-blocking)
                try {
                    const allowedTop = new Set([
                        'transitionIntervalSeconds',
                        'cinemaMode',
                        'cinemaOrientation',
                        'wallartMode',
                    ]);
                    const unknown = Object.keys(parsed || {}).filter(k => !allowedTop.has(k));
                    if (unknown.length) {
                        tplHint.textContent = `Note: unknown keys [${unknown.join(', ')}]`; // not an error
                    }
                } catch (_) {
                    // ignore hint errors
                }
                try {
                    await patchGroup(gid, { settingsTemplate: parsed });
                    tplHint.textContent = 'Template saved';
                    // Toast: group template saved and live-applied to members
                    if (typeof showNotification === 'function') {
                        showNotification('Group template saved and applied to members', 'success');
                    }
                } catch (_) {
                    tplHint.textContent = 'Failed to save template';
                    if (typeof showNotification === 'function') {
                        showNotification('Failed to save group template', 'error');
                    }
                }
            });
        }

        // Save order
        if (saveOrderBtn && orderInput) {
            saveOrderBtn.addEventListener('click', async () => {
                const gid = listEl.value;
                if (!gid) return;
                const val = Number(orderInput.value || 0);
                try {
                    await patchGroup(gid, { order: val });
                    if (status) status.textContent = 'Order saved';
                    if (typeof showNotification === 'function') {
                        showNotification('Group order saved', 'success');
                    }
                } catch (_) {
                    if (status) status.textContent = 'Failed to save order';
                    if (typeof showNotification === 'function') {
                        showNotification('Failed to save group order', 'error');
                    }
                }
            });
        }

        // Send command
        if (cmdSendBtn && cmdTypeEl) {
            cmdSendBtn.addEventListener('click', async () => {
                const gid = listEl.value;
                if (!gid) return;
                const type = cmdTypeEl.value;
                let payload = undefined;
                const txt = ((cmdPayloadEl && cmdPayloadEl.value) || '').trim();
                if (txt) {
                    try {
                        payload = JSON.parse(txt);
                    } catch (e) {
                        if (status) status.textContent = 'Invalid payload JSON';
                        return;
                    }
                }
                try {
                    await sendGroupCommand(gid, type, payload);
                    if (status) status.textContent = 'Command sent to group';
                    if (typeof showNotification === 'function') {
                        showNotification('Group command sent', 'success');
                    }
                } catch (_) {
                    if (status) status.textContent = 'Failed to send command';
                    if (typeof showNotification === 'function') {
                        showNotification('Failed to send group command', 'error');
                    }
                }
            });
        }

        // Create group
        el.querySelector('#group-create').addEventListener('click', async () => {
            const name = prompt('New group name');
            if (!name) return;
            try {
                await createGroup({ name });
                if (status) status.textContent = 'Group created.';
                if (typeof showNotification === 'function') {
                    showNotification('Group created', 'success');
                }
                el.remove();
                loadAndRender();
            } catch (e) {
                if (status) status.textContent = 'Failed to create group.';
                if (typeof showNotification === 'function') {
                    showNotification('Failed to create group', 'error');
                }
            }
        });

        // Rename
        el.querySelector('#group-rename').addEventListener('click', async () => {
            const id = listEl.value;
            if (!id) return;
            const current = groups.find(g => g.id === id);
            const name = prompt('Rename group', current && current.name ? current.name : id);
            if (!name) return;
            try {
                await patchGroup(id, { name });
                if (status) status.textContent = 'Group renamed.';
                if (typeof showNotification === 'function') {
                    showNotification('Group renamed', 'success');
                }
                el.remove();
                loadAndRender();
            } catch (e) {
                if (status) status.textContent = 'Failed to rename group.';
                if (typeof showNotification === 'function') {
                    showNotification('Failed to rename group', 'error');
                }
            }
        });

        // Delete
        el.querySelector('#group-delete').addEventListener('click', async () => {
            const id = listEl.value;
            if (!id) return;
            if (!confirm('Delete this group?')) return;
            try {
                await deleteGroup(id);
                if (status) status.textContent = 'Group deleted.';
                if (typeof showNotification === 'function') {
                    showNotification('Group deleted', 'success');
                }
                el.remove();
                loadAndRender();
            } catch (e) {
                if (status) status.textContent = 'Failed to delete group.';
                if (typeof showNotification === 'function') {
                    showNotification('Failed to delete group', 'error');
                }
            }
        });

        // Toggle member assignment
        membersBox.addEventListener('change', async ev => {
            const cb = ev.target;
            if (!(cb && cb.matches('input[type="checkbox"][data-did]'))) return;
            const gid = listEl.value;
            const did = cb.getAttribute('data-did');
            try {
                const d = devices.find(x => x.id === did) || { id: did, groups: [] };
                const next = new Set(Array.isArray(d.groups) ? d.groups : []);
                if (cb.checked) next.add(gid);
                else next.delete(gid);
                await patchDeviceGroups(did, Array.from(next));
                if (status) status.textContent = 'Updated group membership.';
                if (typeof showNotification === 'function') {
                    showNotification('Group membership updated and applied', 'success');
                }
            } catch (_) {
                if (status) status.textContent = 'Failed to update group membership.';
                cb.checked = !cb.checked;
                if (typeof showNotification === 'function') {
                    showNotification('Failed to update group membership', 'error');
                }
            }
        });
    };

    loadAndRender();
}

// Lightweight modal for quick group command send
function showQuickGroupCommandModal(groups) {
    try {
        const existing = document.getElementById('group-quick-cmd-modal');
        if (existing) existing.remove();
    } catch (_) {}
    const esc = s => (s == null ? '' : String(s).replace(/</g, '&lt;'));
    const html = `
        <div id="group-quick-cmd-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="group-quick-title">
            <div class="modal-background" data-close></div>
            <div class="modal-content" style="max-width:640px;">
                <span class="close" data-close>&times;</span>
                <h3 id="group-quick-title" class="section-title modal-section-title"><i class="fas fa-paper-plane"></i> <span>Send Group Command</span></h3>
                <div class="form-section unified-section">
                    <div class="subsection-content">
                        <div class="form-grid-3" style="gap:8px;align-items:end;">
                            <div class="form-group"><label>Group</label>
                                <select id="gqc-group" style="min-width:200px;">
                                    ${groups.map(g => `<option value="${esc(g.id)}">${esc(g.name || g.id)}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group"><label>Command</label>
                                <select id="gqc-type" style="min-width:180px">
                                    <option value="playback.next">Next Poster</option>
                                    <option value="playback.prev">Previous Poster</option>
                                    <option value="playback.toggle">Toggle Pause/Resume</option>
                                    <option value="source.switch">Switch Source</option>
                                    <option value="power.off">Power Off</option>
                                    <option value="power.on">Power On</option>
                                    <option value="reload">Reload</option>
                                </select>
                            </div>
                            <div class="form-group"><label>Payload (JSON)</label>
                                <input id="gqc-payload" type="text" placeholder='{"sourceKey":"plex"}' />
                            </div>
                            <div class="form-group"><button id="gqc-send" class="btn"><i class="fas fa-paper-plane icon"></i><span>Send</span></button></div>
                        </div>
                        <div class="hint" id="gqc-status" style="margin-top:6px;"></div>
                    </div>
                </div>
            </div>
        </div>`;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const el = wrap.firstElementChild;
    document.body.appendChild(el);
    el.querySelectorAll('[data-close]').forEach(c =>
        c.addEventListener('click', () => el.remove())
    );
    const gidEl = el.querySelector('#gqc-group');
    const typeEl = el.querySelector('#gqc-type');
    const payloadEl = el.querySelector('#gqc-payload');
    const sendBtn = el.querySelector('#gqc-send');
    const status = el.querySelector('#gqc-status');
    sendBtn.addEventListener('click', async () => {
        const gid = gidEl.value;
        const type = typeEl.value;
        let payload;
        const txt = (payloadEl.value || '').trim();
        if (txt) {
            try {
                payload = JSON.parse(txt);
            } catch (e) {
                status.textContent = 'Invalid payload JSON';
                return;
            }
        }
        try {
            await sendGroupCommand(gid, type, payload);
            status.textContent = 'Command sent';
            if (typeof showNotification === 'function') {
                showNotification('Group command sent', 'success');
            }
        } catch (_) {
            status.textContent = 'Failed to send';
            if (typeof showNotification === 'function') {
                showNotification('Failed to send group command', 'error');
            }
        }
    });
}

// Device Settings Override Modal
// --------------------------------------------------------------------------
function showDeviceSettingsModal(device) {
    try {
        const existing = document.getElementById('device-settings-modal');
        if (existing) existing.remove();
    } catch (_) {
        /* ignore remove errors */
    }

    const d = device || {};
    const id = d.id || '';
    const name = d.name || '';
    const loc = d.location || '';
    const overrides =
        d.settingsOverride && typeof d.settingsOverride === 'object' ? d.settingsOverride : {};
    const escapeHtml = s =>
        String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    // no JSON view; modal uses the same GUI as main Display Settings

    const cacheBust = Date.now();
    const previewSrc = `/preview?cb=${cacheBust}`;
    const html = `
        <div id="device-settings-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="device-settings-title">
            <div class="modal-background" data-close></div>
            <div class="modal-content" style="max-width: 980px;">
                <span class="close" data-close>&times;</span>
                <h3 id="device-settings-title" class="section-title modal-section-title">
                    <i class="fas fa-tv"></i>
                    <span>Display Settings</span>
                </h3>
                <div class="device-meta">
                    <span class="device-name"><i class="fas fa-display"></i> ${
                        name ? escapeHtml(name) : 'Unnamed device'
                    }</span>
                    ${loc ? `<span class="device-loc"><i class="fas fa-location-dot"></i> ${escapeHtml(loc)}</span>` : ''}
                    <span class="device-id" title="Device ID"><i class="fas fa-hashtag"></i> ${escapeHtml(
                        id
                    )}</span>
                </div>

                        <div class="ds-grid" style="display:block; gap:12px; align-items:start;">
                    <div id="modal-preview-container" class="preview-container pip-mode screensaver-mode compact" style="display:block;">
                        <button type="button" class="preview-peek-handle" aria-label="Toggle preview visibility" title="Hide/Show Preview"></button>
                        <button type="button" id="modal-toggle-preview-zoom" class="pip-button preview-zoom-btn" title="Toggle Preview Size (1.5x)">
                            <i class="fas fa-expand"></i>
                        </button>
                        <div class="preview-controls">
                            <button type="button" id="modal-toggle-preview-mode" class="pip-button" title="Toggle Preview Mode">
                                <i class="fas fa-desktop"></i>
                            </button>
                        </div>
                        <iframe id="modal-preview-frame" class="preview-frame" title="Display Settings Live Preview" src="${previewSrc}"></iframe>
                    </div>

                                        <form id="device-settings-form" class="ds-form" autocomplete="off">
                                            <div class="form-section unified-section">
                                                <!-- Wallart and Cinema at the top -->
                                                <div class="subsection-header" id="ovr-wallart-header"><i class="fas fa-images"></i> Wallart Mode</div>
                                                <div class="subsection-content" id="ovr-wallart-content">
                                                    <div class="form-group checkbox-group"><input type="checkbox" data-key="wallartMode.enabled" id="ovr-wallart"><label for="ovr-wallart">Enable Wallart Mode</label></div>
                                                    <div class="form-grid-3">
                                                        <div class="form-group"><label>Layout variant</label><select data-key="wallartMode.layoutVariant"><option value="">(inherit)</option><option value="classic">Classic Grid</option><option value="heroGrid">Hero + Grid</option></select></div>
                                                        <div class="form-group"><label>Poster Density</label><select data-key="wallartMode.density"><option value="">(inherit)</option><option value="low">Few - 60% of screen-optimal (larger posters)</option><option value="medium">Medium - 100% screen-optimal (balanced)</option><option value="high">Many - 150% of screen-optimal (smaller posters)</option><option value="ludicrous">Ludicrous - 200% of screen-optimal (tiny posters)</option></select></div>
                                                        <div class="form-group full-width"><label>Animation Type</label><select data-key="wallartMode.animationType"><option value="">(inherit)</option><option value="random">Random</option><option value="fade">Fade</option><option value="slideLeft">Slide Left</option><option value="slideUp">Slide Up</option><option value="zoom">Zoom</option><option value="flip">Flip</option><option value="staggered">Staggered</option><option value="ripple">Ripple</option><option value="scanline">Scanline</option><option value="parallax">Parallax</option><option value="neonPulse">Neon Pulse</option><option value="chromaticShift">Chromatic Shift</option><option value="mosaicShatter">Mosaic Shatter</option></select></div>
                                                    </div>
                                                    <div class="form-grid-2">
                                                        <div class="form-group"><label>Poster Refresh Rate</label><div class="slider-wrapper modern-slider"><input type="range" min="1" max="10" step="1" data-key="wallartMode.refreshRate"></div></div>
                                                        <div class="form-group"><label>Timing Randomness</label><div class="slider-wrapper modern-slider"><input type="range" min="0" max="10" step="1" data-key="wallartMode.randomness"></div></div>
                                                    </div>
                                                    <div class="form-grid-2" id="ovr-hero-grid">
                                                        <div class="form-group"><label>Hero side</label><select data-key="wallartMode.layoutSettings.heroGrid.heroSide"><option value="">(inherit)</option><option value="left">Left</option><option value="right">Right</option></select></div>
                                                        <div class="form-group"><label>Hero rotation (minutes)</label><input type="number" min="1" max="60" step="1" data-key="wallartMode.layoutSettings.heroGrid.heroRotationMinutes"></div>
                                                    </div>
                                                    <div class="form-group checkbox-group"><input type="checkbox" data-key="wallartMode.ambientGradient" id="ovr-ambient"><label for="ovr-ambient">Ambient gradient background</label></div>
                                                </div>

                        <div class="subsection-header" id="ovr-cinema-header"><i class="fas fa-film"></i> Cinema Mode</div>
                                                <div class="subsection-content" id="ovr-cinema-content">
                                                    <div class="form-grid-2">
                            <div class="form-group checkbox-group"><input type="checkbox" data-key="cinemaMode" id="ovr-cinema"><label for="ovr-cinema">Enable Cinema Mode</label></div>
                                                        <div class="form-group"><label>Orientation</label><select data-key="cinemaOrientation"><option value="">(inherit)</option><option value="auto">Auto</option><option value="portrait">Portrait</option><option value="portrait-flipped">Portrait flipped</option></select></div>
                                                    </div>
                                                </div>

                                                <div class="subsection-header" id="ovr-visual-header"><i class="fas fa-eye"></i> Visual elements</div>
                                                <div class="subsection-content" id="ovr-visual-content">
                                                    <div class="checkbox-row">
                                                        <div class="form-group checkbox-group"><input type="checkbox" data-key="showPoster" id="ovr-showPoster"><label for="ovr-showPoster">Show poster</label></div>
                                                        <div class="form-group checkbox-group"><input type="checkbox" data-key="showMetadata" id="ovr-showMetadata"><label for="ovr-showMetadata">Show metadata</label></div>
                                                        <div class="form-group checkbox-group"><input type="checkbox" data-key="showClearLogo" id="ovr-showClearLogo"><label for="ovr-showClearLogo">ClearLogo</label></div>
                                                        <div class="form-group checkbox-group"><input type="checkbox" data-key="showRottenTomatoes" id="ovr-showRT"><label for="ovr-showRT">Rotten Tomatoes</label></div>
                                                    </div>
                                                    <div class="form-grid-2">
                                                        <div class="form-group"><label>RT min score</label><input type="number" min="0" max="10" step="0.5" data-key="rottenTomatoesMinimumScore"></div>
                                                    </div>
                                                </div>

                                                <div class="subsection-header" id="ovr-uiscaling-header"><i class="fas fa-expand-arrows-alt"></i> UI Element Scaling</div>
                                                <div class="subsection-content" id="ovr-uiscaling-content">
                                                    <div class="scaling-grid">
                                                        <div class="scaling-item">
                                                            <label>Content</label>
                                                            <div class="slider-wrapper modern-slider">
                                                                <input type="range" min="50" max="200" step="5" data-key="uiScaling.content" value="100">
                                                                <div class="slider-percentage" data-target="uiScaling.content">100%</div>
                                                            </div>
                                                        </div>
                                                        <div class="scaling-item">
                                                            <label>Clearlogo</label>
                                                            <div class="slider-wrapper modern-slider">
                                                                <input type="range" min="50" max="200" step="5" data-key="uiScaling.clearlogo" value="100">
                                                                <div class="slider-percentage" data-target="uiScaling.clearlogo">100%</div>
                                                            </div>
                                                        </div>
                                                        <div class="scaling-item">
                                                            <label>Clock</label>
                                                            <div class="slider-wrapper modern-slider">
                                                                <input type="range" min="50" max="200" step="5" data-key="uiScaling.clock" value="100">
                                                                <div class="slider-percentage" data-target="uiScaling.clock">100%</div>
                                                            </div>
                                                        </div>
                                                        <div class="scaling-item">
                                                            <label>Global</label>
                                                            <div class="slider-wrapper modern-slider">
                                                                <input type="range" min="50" max="200" step="5" data-key="uiScaling.global" value="100">
                                                                <div class="slider-percentage" data-target="uiScaling.global">100%</div>
                                                            </div>
                                                        </div>
                                                        <div class="scaling-presets">
                                                            <div class="preset-buttons">
                                                                <button type="button" class="preset-button ovr-preset-button" data-preset="4k-tv">
                                                                    <i class="fas fa-tv"></i> 4K TV
                                                                </button>
                                                                <button type="button" class="preset-button ovr-preset-button" data-preset="full-hd">
                                                                    <i class="fas fa-desktop"></i> Full HD
                                                                </button>
                                                                <button type="button" class="preset-button ovr-preset-button" data-preset="ultrawide">
                                                                    <i class="fas fa-expand-arrows-alt"></i> Ultrawide
                                                                </button>
                                                                <button type="button" id="ovr-reset-scaling" class="reset-button">
                                                                    <i class="fas fa-undo"></i> Reset
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div class="subsection-header" id="ovr-slideshow-header"><i class="fas fa-magic"></i> Effects & Transitions</div>
                                                <div class="subsection-content" id="ovr-slideshow-content">
                                                    <div class="form-grid-3">
                                                        <div class="form-group"><label>Effect</label><select data-key="transitionEffect"><option value="">(inherit)</option><option value="none">None</option><option value="fade">Fade</option><option value="slide">Slide</option><option value="kenburns">Ken Burns</option></select></div>
                                                        <div class="form-group"><label>Interval (s)</label><input type="number" min="1" max="600" step="1" data-key="transitionIntervalSeconds"></div>
                                                        <div class="form-group" id="ovr-pause-group"><label>Pause time (s)</label><input type="number" min="0" max="10" step="0.5" data-key="effectPauseTime"></div>
                                                    </div>
                                                </div>

                                                <div class="subsection-header" id="ovr-clock-header"><i class="fas fa-clock"></i> Clock</div>
                                                <div class="subsection-content" id="ovr-clock-content">
                                                    <div class="form-group checkbox-group"><input type="checkbox" data-key="clockWidget" id="ovr-clock"><label for="ovr-clock">Show clock</label></div>
                                                    <div class="form-grid-2">
                                                        <div class="form-group"><label>Format</label><select data-key="clockFormat"><option value="">(inherit)</option><option value="24h">24h</option><option value="12h">12h</option></select></div>
                                                        <div class="form-group" id="ovr-timezone-group"><label>Timezone</label><select data-key="clockTimezone" id="ovr-clockTimezone"><option value="">(inherit)</option><option value="auto">Auto</option></select></div>
                                                    </div>
                                                </div>
                                            </div>

                                                <div class="form-actions" style="display:flex; gap: 8px; align-items:center;">
                                                    <button type="button" class="btn is-primary" id="device-settings-save">Save & apply</button>
                                                    <button type="button" class="btn" id="device-settings-clear">Clear overrides</button>
                                                    <div class="hint" id="device-settings-status"></div>
                                                </div>
                    </form>

                    
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    const modal = document.getElementById('device-settings-modal');
    const form = modal.querySelector('#device-settings-form');
    const btnSave = modal.querySelector('#device-settings-save');
    const btnClear = modal.querySelector('#device-settings-clear');
    const status = modal.querySelector('#device-settings-status');
    const previewContainerEl = modal.querySelector('#modal-preview-container');
    const previewFrame = modal.querySelector('#modal-preview-frame');
    const previewToggleMode = modal.querySelector('#modal-toggle-preview-mode');
    const previewToggleZoom = modal.querySelector('#modal-toggle-preview-zoom');
    const modalContentEl = modal.querySelector('.modal-content');

    // Ensure identical starting classes/visibility as main preview
    if (previewContainerEl) {
        // Detach from modal content so it cannot affect layout; make it global
        try {
            document.body.appendChild(previewContainerEl);
        } catch (_) {
            /* ignore append failure */
        }
        previewContainerEl.classList.add('pip-mode');
        previewContainerEl.classList.add('screensaver-mode');
        previewContainerEl.classList.remove('cinema-mode');
        previewContainerEl.style.display = 'block';
        // Clear any previous explicit side so we can compute left based on modal position (force over CSS !important)
        try {
            previewContainerEl.style.setProperty('right', 'auto', 'important');
        } catch (_) {
            previewContainerEl.style.right = 'auto';
        }
        try {
            previewContainerEl.style.setProperty('left', 'auto', 'important');
        } catch (_) {
            previewContainerEl.style.left = 'auto';
        }
        // Align and pin preview to the right side of the modal until the user moves it
        (function alignPreviewWithModal() {
            if (!modalContentEl) return;
            const align = () => {
                if (!previewContainerEl || !modalContentEl) return;
                if (previewContainerEl.dataset.userMoved === '1') return;
                const rect = modalContentEl.getBoundingClientRect();
                const gutter = 16; // px between modal and preview
                const top = Math.max(12, Math.round(rect.top));
                const desiredLeft = Math.round(rect.right + gutter);
                // Clamp within viewport so preview stays visible
                const pcRect = previewContainerEl.getBoundingClientRect();
                const maxLeft = Math.max(12, window.innerWidth - pcRect.width - 12);
                const left = Math.max(12, Math.min(maxLeft, desiredLeft));
                try {
                    previewContainerEl.style.setProperty('top', top + 'px', 'important');
                } catch (_) {
                    previewContainerEl.style.top = top + 'px';
                }
                try {
                    previewContainerEl.style.setProperty('left', left + 'px', 'important');
                } catch (_) {
                    previewContainerEl.style.left = left + 'px';
                }
                try {
                    previewContainerEl.style.setProperty('right', 'auto', 'important');
                } catch (_) {
                    previewContainerEl.style.right = 'auto';
                }
                // Mark pinned mode
                previewContainerEl.dataset.pinned = '1';
            };
            try {
                align();
            } catch (_) {
                /* ignore once */
            }
            let ro = null;
            try {
                if (window.ResizeObserver) {
                    ro = new ResizeObserver(() => align());
                    ro.observe(modalContentEl);
                }
            } catch (_) {
                /* no ResizeObserver */
            }
            const onWinResize = () => align();
            const onWinScroll = () => align();
            window.addEventListener('resize', onWinResize);
            window.addEventListener('scroll', onWinScroll, { passive: true });
            previewContainerEl.__alignCleanup = () => {
                try {
                    if (ro) ro.disconnect();
                } catch (_) {
                    /* ignore */
                }
                try {
                    window.removeEventListener('resize', onWinResize);
                } catch (_) {
                    /* ignore */
                }
                try {
                    window.removeEventListener('scroll', onWinScroll);
                } catch (_) {
                    /* ignore */
                }
            };
        })();

        // Enable drag to unpin for the modal preview (left/top anchored)
        (function enableModalPreviewDrag() {
            const el = previewContainerEl;
            if (!el) return;
            let dragging = false;
            let started = false;
            let startX = 0;
            let startY = 0;
            let offsetX = 0; // distance from left edge
            let offsetY = 0; // distance from top edge
            let raf = null;
            let nextPos = null;
            const DRAG_THRESHOLD = 4;
            function isInteractiveTarget(target) {
                if (!target || !(target instanceof Element)) return false;
                return (
                    target.closest('.pip-button') ||
                    target.closest('.preview-controls') ||
                    target.closest('.preview-peek-handle') ||
                    target.closest('button, a, select, input, label')
                );
            }
            function onDown(e) {
                const tgt = e.target;
                if (isInteractiveTarget(tgt)) return;
                if (e.touches && e.touches.length > 1) return;
                const rect = el.getBoundingClientRect();
                const cx = e.touches ? e.touches[0].clientX : e.clientX;
                const cy = e.touches ? e.touches[0].clientY : e.clientY;
                startX = cx;
                startY = cy;
                offsetX = cx - rect.left;
                offsetY = cy - rect.top;
                dragging = true;
                started = false;
                el.classList.add('dragging');
                el.style.cursor = 'grabbing';
                if (e.cancelable) e.preventDefault();
            }
            function onMove(e) {
                if (!dragging) return;
                const cx = e.touches ? e.touches[0].clientX : e.clientX;
                const cy = e.touches ? e.touches[0].clientY : e.clientY;
                if (!started) {
                    const dx = Math.abs(cx - startX);
                    const dy = Math.abs(cy - startY);
                    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
                    started = true;
                    try {
                        el.dataset.userMoved = '1';
                    } catch (_) {
                        /* ignore */
                    }
                    try {
                        el.dataset.pinned = '0';
                    } catch (_) {
                        /* ignore */
                    }
                }
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const rect = el.getBoundingClientRect();
                let left = cx - offsetX;
                let top = cy - offsetY;
                // clamp within viewport
                left = Math.max(0, Math.min(vw - rect.width, left));
                top = Math.max(0, Math.min(vh - rect.height, top));
                nextPos = { left, top };
                if (!raf) {
                    raf = requestAnimationFrame(() => {
                        if (nextPos) {
                            try {
                                el.style.setProperty('left', nextPos.left + 'px', 'important');
                            } catch (_) {
                                el.style.left = nextPos.left + 'px';
                            }
                            try {
                                el.style.setProperty('top', nextPos.top + 'px', 'important');
                            } catch (_) {
                                el.style.top = nextPos.top + 'px';
                            }
                            try {
                                el.style.setProperty('right', 'auto', 'important');
                            } catch (_) {
                                el.style.right = 'auto';
                            }
                            nextPos = null;
                        }
                        raf = null;
                    });
                }
                if (e.cancelable) e.preventDefault();
            }
            function onUp(e) {
                if (!dragging) return;
                const wasDragging = started;
                dragging = false;
                started = false;
                el.style.cursor = 'grab';
                el.classList.remove('dragging');
                if (wasDragging && e && e.cancelable) {
                    e.preventDefault();
                    e.stopPropagation();
                    el.style.pointerEvents = 'none';
                    setTimeout(() => (el.style.pointerEvents = 'auto'), 0);
                }
            }
            const onMouseDown = e => onDown(e);
            const onTouchStart = e => onDown(e);
            el.addEventListener('mousedown', onMouseDown);
            el.addEventListener('touchstart', onTouchStart, { passive: false });
            window.addEventListener('mousemove', onMove, { passive: false });
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('mouseup', onUp, { passive: false });
            window.addEventListener('touchend', onUp, { passive: false });
            previewContainerEl.__dragCleanup = () => {
                try {
                    el.removeEventListener('mousedown', onMouseDown);
                } catch (_) {
                    /* ignore */
                }
                try {
                    el.removeEventListener('touchstart', onTouchStart);
                } catch (_) {
                    /* ignore */
                }
                try {
                    window.removeEventListener('mousemove', onMove);
                } catch (_) {
                    /* ignore */
                }
                try {
                    window.removeEventListener('touchmove', onMove);
                } catch (_) {
                    /* ignore */
                }
                try {
                    window.removeEventListener('mouseup', onUp);
                } catch (_) {
                    /* ignore */
                }
                try {
                    window.removeEventListener('touchend', onUp);
                } catch (_) {
                    /* ignore */
                }
            };
        })();
    }

    // Helper: set/get deep values by path like "wallartMode.layoutSettings.heroGrid.heroSide"
    function setDeep(obj, path, value) {
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i];
            if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
            cur = cur[k];
        }
        cur[parts[parts.length - 1]] = value;
        return obj;
    }
    function getDeep(obj, path) {
        const parts = path.split('.');
        let cur = obj;
        for (const k of parts) {
            if (!cur || typeof cur !== 'object') return undefined;
            cur = cur[k];
        }
        return cur;
    }

    // Presets removed per request

    function deepMerge(target, source) {
        if (!source || typeof source !== 'object') return target;
        const out = Array.isArray(target) ? target.slice() : { ...(target || {}) };
        for (const k of Object.keys(source)) {
            const sv = source[k];
            if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
                out[k] = deepMerge(out[k] && typeof out[k] === 'object' ? out[k] : {}, sv);
            } else {
                out[k] = sv;
            }
        }
        return out;
    }
    // GUI: bind values, track dirty state, preview on change
    const dirty = new Set();
    function getEffective(path) {
        // Prefer device override; otherwise inherit from current admin config
        const ov = getDeep(overrides, path);
        if (ov !== undefined) return ov;
        try {
            const cfg = window.currentConfig || {};
            return getDeep(cfg, path);
        } catch (_) {
            return undefined;
        }
    }
    function formatSliderLabel(key, value) {
        const v = Number(value);
        if (key === 'wallartMode.refreshRate') {
            const map = {
                1: 'Very slow (25s)',
                2: 'Slow (22s)',
                3: 'Relaxed (19s)',
                4: 'Moderate (16s)',
                5: 'Medium (13s)',
                6: 'Active (10s)',
                7: 'Quick (7s)',
                8: 'Fast (5s)',
                9: 'Very fast (3s)',
                10: 'Chaos mode',
            };
            return map[v] || 'Medium (13s)';
        }
        if (key === 'wallartMode.randomness') {
            const map = {
                0: 'No randomness',
                1: 'Minimal variation',
                2: 'Slight variation',
                3: 'Low randomness',
                4: 'Moderate randomness',
                5: 'Medium randomness',
                6: 'High randomness',
                7: 'Very random',
                8: 'Highly unpredictable',
                9: 'Maximum variation',
                10: 'Extreme',
            };
            return map[v] || 'Low randomness';
        }
        return String(v);
    }
    function bindInitialValues() {
        const inputs = form.querySelectorAll('[data-key]');
        inputs.forEach(el => {
            const key = el.getAttribute('data-key');
            // Show effective value (override -> admin config) without marking dirty
            const eff = getEffective(key);
            if (el.type === 'checkbox') {
                el.checked = !!eff;
            } else if (el.type === 'range' || el.type === 'number') {
                el.value =
                    eff === undefined || eff === null || Number.isNaN(eff) ? '' : String(eff);
            } else if (el.tagName === 'SELECT' || el.type === 'text') {
                el.value = eff === undefined || eff === null ? '' : String(eff);
            } else {
                el.value = eff === undefined ? '' : String(eff);
            }
            if (el.type === 'range') {
                const out = null; // no dedicated bubble for refreshRate/randomness in modal
                if (out) out.textContent = formatSliderLabel(key, el.value);
                try {
                    // Visual polish
                    updateSliderBackground?.(el);
                    if (out) positionSliderBubble?.(el, out);
                } catch (_) {}
            }
        });
    }
    function payloadFromInputs(onlyDirty = true) {
        const payload = {};
        const inputs = form.querySelectorAll('[data-key]');
        inputs.forEach(el => {
            const keyPath = el.getAttribute('data-key');
            if (onlyDirty && !dirty.has(keyPath)) return;
            let v;
            if (el.type === 'checkbox') v = !!el.checked;
            else if (el.type === 'number' || el.type === 'range')
                v = el.value === '' ? undefined : Number(el.value);
            else v = el.value;
            if (v === '' || v === undefined || Number.isNaN(v)) return; // omit unset
            setDeep(payload, keyPath, v);
        });
        return payload;
    }
    function postPreview(partial) {
        try {
            const win = previewFrame && previewFrame.contentWindow;
            if (!win) return;
            win.postMessage(
                { type: 'posterrama.preview.update', payload: partial || {} },
                window.location.origin
            );
        } catch (_) {}
    }
    function setStatus(text, asButton = false) {
        if (!status) return;
        status.textContent = text || '';
        status.classList.toggle('btn', !!asButton);
        status.classList.toggle('btn-info', !!asButton);
        status.classList.toggle('is-ready', !!asButton);
        // Accessibility and interaction
        if (asButton) {
            status.setAttribute('role', 'button');
            status.setAttribute('tabindex', '0');
            status.title = 'Click to save changes';
        } else {
            status.removeAttribute('role');
            status.removeAttribute('tabindex');
            status.removeAttribute('title');
        }
    }
    function onChanged(el) {
        const key = el.getAttribute('data-key');
        if (!key) return;
        dirty.add(key);
        if (el.type === 'range') {
            const out = null; // bubbles removed
            if (out) out.textContent = formatSliderLabel(key, el.value);
            try {
                updateSliderBackground?.(el);
                if (out) positionSliderBubble?.(el, out);
            } catch (_) {}
        }
        // live preview just for this field
        const partial = {};
        let v;
        if (el.type === 'checkbox') v = !!el.checked;
        else if (el.type === 'number' || el.type === 'range')
            v = el.value === '' ? undefined : Number(el.value);
        else v = el.value;
        if (v !== undefined && v !== '' && !Number.isNaN(v)) setDeep(partial, key, v);
        // When enabling Wallart, explicitly disable Cinema in the preview to avoid conflicts
        if (key === 'wallartMode.enabled' && v === true) {
            partial.cinemaMode = false;
        }
        postPreview(partial);
        setStatus('Edited (unsaved)', true);
    }
    function wireInputs() {
        const inputs = form.querySelectorAll('[data-key]');
        inputs.forEach(el => {
            el.addEventListener('change', () => onChanged(el));
            if (el.type === 'range') el.addEventListener('input', () => onChanged(el));
        });
        // Make status actionable when it shows "Edited (unsaved)"
        if (status) {
            const triggerSave = () => {
                // Only trigger when showing as button (unsaved)
                if (!status.classList.contains('btn')) return;
                if (btnSave && !btnSave.disabled) btnSave.click();
            };
            status.addEventListener('click', triggerSave);
            status.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    triggerSave();
                }
            });
        }
    }

    // Slider bubble helpers (thumb-following)
    function sliderPercent(el) {
        const min = Number(el.min ?? 0);
        const max = Number(el.max ?? 100);
        const val = Number(el.value ?? min);
        if (max === min) return 0;
        return ((val - min) / (max - min)) * 100;
    }
    function positionSliderBubble(inputEl, bubbleEl) {
        if (!inputEl || !bubbleEl || !inputEl.parentElement) return;
        // Default: thumb-following above track for sliders that still use bubbles
        const pct = sliderPercent(inputEl);
        // Position within the slider track width
        const track = inputEl;
        const rect = track.getBoundingClientRect();
        const padL = parseFloat(getComputedStyle(track).paddingLeft) || 0;
        const padR = parseFloat(getComputedStyle(track).paddingRight) || 0;
        const usable = Math.max(0, rect.width - padL - padR);
        const x = (pct / 100) * usable + padL;
        // Set as left relative to wrapper
        const wrapperRect = inputEl.parentElement.getBoundingClientRect();
        const rel = Math.max(0, Math.min(wrapperRect.width, x));
        bubbleEl.style.left = rel + 'px';
        bubbleEl.style.transform = 'translateX(-50%)';
        // Always render bubble above the slider for consistency
        bubbleEl.style.top = 'auto';
        bubbleEl.style.bottom = 'calc(100% + 8px)';
    }
    function wireSliderBubbles(scopeEl) {
        const scope = scopeEl || form;
        scope.querySelectorAll('.slider-wrapper.modern-slider').forEach(wrapper => {
            const input = wrapper.querySelector('input[type="range"]');
            const bubble = wrapper.querySelector('.slider-percentage');
            if (!input || !bubble) return; // most wrappers may not have bubbles now
            // key retained in DOM via data-key if needed; avoid unused variable
            // Initial position
            positionSliderBubble(input, bubble);
            // On input and change
            input.addEventListener('input', () => positionSliderBubble(input, bubble));
            input.addEventListener('change', () => positionSliderBubble(input, bubble));
        });
        // Reposition on modal resize
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => {
                scope.querySelectorAll('.slider-wrapper.modern-slider').forEach(wrapper => {
                    const input = wrapper.querySelector('input[type="range"]');
                    const bubble = wrapper.querySelector('.slider-percentage');
                    if (input && bubble) positionSliderBubble(input, bubble);
                });
            });
            ro.observe(scope);
        } else {
            window.addEventListener('resize', () => wireSliderBubbles(scope));
        }
    }

    function close() {
        try {
            modal.remove();
        } catch (_) {
            /* ignore errors */
        }
        // Remove orphaned modal preview if it was moved to <body>
        try {
            const orphan = document.getElementById('modal-preview-container');
            if (orphan && orphan.parentElement === document.body) {
                orphan.remove();
            }
        } catch (_) {}
        // Cleanup preview alignment observers/listeners
        try {
            if (previewContainerEl && previewContainerEl.__alignCleanup) {
                previewContainerEl.__alignCleanup();
            }
            if (previewContainerEl && previewContainerEl.__dragCleanup) {
                previewContainerEl.__dragCleanup();
            }
        } catch (_) {}
    }

    modal.addEventListener('click', ev => {
        if (ev.target && (ev.target.getAttribute('data-close') != null || ev.target === modal)) {
            close();
        }
    });

    // Initial preview: apply existing overrides when preview iframe is ready
    try {
        const sendInitial = () => {
            if (!previewFrame || !previewFrame.contentWindow) return;
            const initial = { ...(overrides || {}) };
            try {
                if (initial && initial.wallartMode && initial.wallartMode.enabled === true) {
                    initial.cinemaMode = false;
                }
            } catch (_) {}
            postPreview(initial);
        };
        if (previewFrame) {
            previewFrame.addEventListener('load', sendInitial, { once: true });
            // Fallback if it was already loaded
            setTimeout(sendInitial, 150);
        }
    } catch (_) {
        /* ignore preview init errors */
    }
    // Initialize GUI after ensuring admin config is available to inherit from
    (async function initModalUI() {
        try {
            if (!window.currentConfig) {
                const res = await authenticatedFetch('/api/admin/config', { method: 'GET' });
                if (res && res.ok) {
                    const data = await res.json();
                    if (data && data.config) window.currentConfig = data.config;
                }
            }
        } catch (_) {
            // ignore; we'll just bind what we can
        }
        bindInitialValues();
        // Ensure slider bubbles are positioned initially
        wireSliderBubbles(form);
        wireInputs();
        applyModeVisibility();
        // If effective Wallart is enabled, explicitly assert it in preview (and disable cinema)
        try {
            const effWallart = !!getEffective('wallartMode.enabled');
            if (effWallart) {
                postPreview({ wallartMode: { enabled: true }, cinemaMode: false });
            }
        } catch (_) {}
        // Populate timezone dropdown and wire clock toggle
        try {
            const tzSelect = modal.querySelector('#ovr-clockTimezone');
            if (tzSelect && tzSelect.options.length < 3) {
                const zones = [
                    'Europe/Amsterdam',
                    'Europe/London',
                    'Europe/Berlin',
                    'Europe/Paris',
                    'UTC',
                    'America/New_York',
                    'America/Los_Angeles',
                    'Asia/Tokyo',
                    'Asia/Singapore',
                    'Australia/Sydney',
                ];
                zones.forEach(z => {
                    const opt = document.createElement('option');
                    opt.value = z;
                    opt.textContent = z;
                    tzSelect.appendChild(opt);
                });
                const effTz = getEffective('clockTimezone');
                if (effTz) tzSelect.value = effTz;
            }
            const clockCb = form.querySelector('#ovr-clock');
            const tzGroup = form.querySelector('#ovr-timezone-group');
            const syncTz = () => {
                if (!clockCb || !tzGroup) return;
                tzGroup.style.display = clockCb.checked ? 'block' : 'none';
            };
            if (clockCb && tzGroup) {
                clockCb.addEventListener('change', syncTz);
                syncTz();
            }
        } catch (_) {}
        // Hide pause time when Ken Burns is selected
        try {
            const effectSel = form.querySelector('[data-key="transitionEffect"]');
            const pauseGroup = form.querySelector('#ovr-pause-group');
            const updatePauseVis = () => {
                if (!effectSel || !pauseGroup) return;
                const val = effectSel.value || '';
                pauseGroup.style.display = val === 'kenburns' ? 'none' : 'block';
            };
            if (effectSel && pauseGroup) {
                effectSel.addEventListener('change', updatePauseVis);
                updatePauseVis();
            }
        } catch (_) {}
    })();

    // Mode-based visibility like main Display Settings
    // Ensure Wallart sub-options follow the state of the override checkbox only
    function syncWallartSubOptions() {
        try {
            const content = modal.querySelector('#ovr-wallart-content');
            if (!content) return;
            const enabled = !!modal.querySelector('#ovr-wallart')?.checked;
            const amb = content.querySelector('#ovr-ambient')?.closest('.form-group');
            const heroGridGroup = content.querySelector('#ovr-hero-grid');
            const display = enabled ? '' : 'none';
            if (amb) amb.style.display = display;
            if (heroGridGroup) {
                // Only show hero controls when layoutVariant is heroGrid
                const variantSel = content.querySelector('[data-key="wallartMode.layoutVariant"]');
                const variant = variantSel
                    ? variantSel.value
                    : getEffective('wallartMode.layoutVariant');
                heroGridGroup.style.display =
                    enabled && (variant === 'heroGrid' || variant === '') ? '' : 'none';
            }
            // Responsive tweak: ensure grids render optimally when container width changes
            const grids = content.querySelectorAll('.form-grid-2, .form-grid-3');
            grids.forEach(g => {
                g.style.gridAutoRows = 'minmax(40px, auto)';
            });
            // Reposition bubbles after layout/visibility changes
            try {
                wireSliderBubbles(content);
            } catch (_) {}
        } catch (_) {
            /* ignore */
        }
    }
    function applyModeVisibility() {
        const cbCinemaNow = modal.querySelector('#ovr-cinema');
        const cbWallartNow = modal.querySelector('#ovr-wallart');
        const cinema = cbCinemaNow ? !!cbCinemaNow.checked : !!getEffective('cinemaMode');
        const wallart = cbWallartNow
            ? !!cbWallartNow.checked
            : !!getEffective('wallartMode.enabled');

        const sections = {
            visual: [
                modal.querySelector('#ovr-visual-header'),
                modal.querySelector('#ovr-visual-content'),
            ],
            clock: [
                modal.querySelector('#ovr-clock-header'),
                modal.querySelector('#ovr-clock-content'),
            ],
            slideshow: [
                modal.querySelector('#ovr-slideshow-header'),
                modal.querySelector('#ovr-slideshow-content'),
            ],
            cinema: [
                modal.querySelector('#ovr-cinema-header'),
                modal.querySelector('#ovr-cinema-content'),
            ],
            uiscale: [
                modal.querySelector('#ovr-uiscaling-header'),
                modal.querySelector('#ovr-uiscaling-content'),
            ],
            wallart: [
                modal.querySelector('#ovr-wallart-header'),
                modal.querySelector('#ovr-wallart-content'),
            ],
        };

        function showPair([h, c], show) {
            if (!h || !c) return;
            h.style.display = show ? 'block' : 'none';
            c.style.display = show ? 'block' : 'none';
        }

        // Helpers for selective content visibility
        function showAllWithin(el) {
            if (!el) return;
            el.querySelectorAll('*').forEach(node => {
                if (node && node.style) node.style.display = '';
            });
        }
        function showOnlyToggle(contentEl, toggleSelector) {
            if (!contentEl) return;
            const toggleEl = contentEl.querySelector(toggleSelector);
            // Hide all form-grids and checkbox groups first
            contentEl
                .querySelectorAll('.form-grid-2, .form-grid-3, .form-grid, .form-group')
                .forEach(node => {
                    if (node && node.style) node.style.display = 'none';
                });
            // Then reveal just the checkbox group that contains the toggle
            if (toggleEl) {
                const grp = toggleEl.closest('.form-group');
                if (grp) {
                    grp.style.display = 'block';
                    const grid = grp.closest('.form-grid-2, .form-grid-3, .form-grid');
                    if (grid) grid.style.display = 'grid';
                }
            }
        }

        if (cinema) {
            // Show full cinema settings
            if (sections.cinema[0]) sections.cinema[0].style.display = 'block';
            if (sections.cinema[1]) {
                sections.cinema[1].style.display = 'block';
                showAllWithin(sections.cinema[1]);
            }
            // When Cinema is enabled, hide Wallart entirely (no toggle, no subsection)
            if (sections.wallart[0]) sections.wallart[0].style.display = 'none';
            if (sections.wallart[1]) sections.wallart[1].style.display = 'none';
            // Hide non-cinema sections to match main behavior
            showPair(sections.visual, false);
            showPair(sections.clock, false);
            showPair(sections.slideshow, false);
            showPair(sections.uiscale, false);
            // preview in cinema layout
            if (previewContainerEl) {
                previewContainerEl.classList.add('cinema-mode');
                previewContainerEl.classList.remove('screensaver-mode');
                updateModalPreviewScale();
            }
        } else if (wallart) {
            // Show full Wallart settings
            if (sections.wallart[0]) sections.wallart[0].style.display = 'block';
            if (sections.wallart[1]) {
                sections.wallart[1].style.display = 'block';
                showAllWithin(sections.wallart[1]);
                // Ensure ambient and bias are visible when enabled
                syncWallartSubOptions();
            }
            // When Wallart is enabled, hide Cinema entirely (no toggle, no subsection)
            if (sections.cinema[0]) sections.cinema[0].style.display = 'none';
            if (sections.cinema[1]) sections.cinema[1].style.display = 'none';
            // Hide other non-wallart sections
            showPair(sections.visual, false);
            showPair(sections.clock, false);
            showPair(sections.slideshow, false);
            // UI scaling is hidden when wallart is active in main UI
            showPair(sections.uiscale, false);
            // preview stays screensaver layout
            if (previewContainerEl) {
                previewContainerEl.classList.remove('cinema-mode');
                previewContainerEl.classList.add('screensaver-mode');
                updateModalPreviewScale();
            }
        } else {
            // Default screensaver: hide cinema & wallart sections, show others
            // Show headers and only the enable toggles for cinema/wallart
            const cinemaHeader = sections.cinema[0];
            const cinemaContent = sections.cinema[1];
            const wallartHeader = sections.wallart[0];
            const wallartContent = sections.wallart[1];
            if (cinemaHeader) cinemaHeader.style.display = 'block';
            if (cinemaContent) {
                cinemaContent.style.display = 'block';
                showOnlyToggle(cinemaContent, '#ovr-cinema');
            }
            if (wallartHeader) wallartHeader.style.display = 'block';
            if (wallartContent) {
                wallartContent.style.display = 'block';
                showOnlyToggle(wallartContent, '#ovr-wallart');
                // Explicitly hide ambient and bias when wallart not enabled
                syncWallartSubOptions();
            }
            showPair(sections.visual, true);
            showPair(sections.clock, true);
            showPair(sections.slideshow, true);
            showPair(sections.uiscale, true);
            if (previewContainerEl) {
                previewContainerEl.classList.remove('cinema-mode');
                previewContainerEl.classList.add('screensaver-mode');
                updateModalPreviewScale();
            }
        }

        // Mutual exclusivity in UI like main page
        const cbCinema = cbCinemaNow;
        const cbWallart = cbWallartNow;
        if (cbCinema && cbWallart) {
            if (cinema) {
                cbWallart.checked = false;
                cbWallart.disabled = true;
                cbCinema.disabled = false;
            } else if (wallart) {
                cbCinema.checked = false;
                cbCinema.disabled = true;
                cbWallart.disabled = false;
            } else {
                cbCinema.disabled = false;
                cbWallart.disabled = false;
            }
        }
        // Final safeguard to keep sub-options in sync with the override checkbox
        syncWallartSubOptions();
    }

    // Initial visibility is applied in initModalUI once config is ready

    // React to user toggles
    const cbCinemaEl = modal.querySelector('#ovr-cinema');
    const cbWallartEl = modal.querySelector('#ovr-wallart');
    if (cbCinemaEl) {
        cbCinemaEl.addEventListener('change', () => {
            // Mark as dirty and update effective value for subsequent reads
            dirty.add('cinemaMode');
            // When enabling cinema, clear wallart checkbox UI state
            if (cbCinemaEl.checked && cbWallartEl) {
                cbWallartEl.checked = false;
                dirty.add('wallartMode.enabled');
            }
            if (previewContainerEl) {
                previewContainerEl.classList.toggle('cinema-mode', cbCinemaEl.checked);
                previewContainerEl.classList.toggle('screensaver-mode', !cbCinemaEl.checked);
                updateModalPreviewScale();
            }
            applyModeVisibility();
            syncWallartSubOptions();
            try {
                wireSliderBubbles(form);
            } catch (_) {}
        });
    }
    if (cbWallartEl) {
        cbWallartEl.addEventListener('change', () => {
            dirty.add('wallartMode.enabled');
            if (cbWallartEl.checked && cbCinemaEl) {
                cbCinemaEl.checked = false;
                dirty.add('cinemaMode');
            }
            if (previewContainerEl) {
                previewContainerEl.classList.remove('cinema-mode');
                previewContainerEl.classList.add('screensaver-mode');
                updateModalPreviewScale();
            }
            applyModeVisibility();
            syncWallartSubOptions();
            try {
                wireSliderBubbles(form);
            } catch (_) {}
        });
    }

    // React when layout variant is changed inside device settings form
    (function wireLayoutVariantWatcher() {
        try {
            const variantSel = form.querySelector('[data-key="wallartMode.layoutVariant"]');
            if (!variantSel) return;
            variantSel.addEventListener('change', () => {
                syncWallartSubOptions();
            });
        } catch (_) {}
    })();

    // Modal preview: same scaling logic as main preview
    function updateModalPreviewScale() {
        if (!previewContainerEl || !previewFrame) return;
        const isCinema = previewContainerEl.classList.contains('cinema-mode');
        const baseW = isCinema ? 1080 : 1920;
        const baseH = isCinema ? 1920 : 1080;
        const style = getComputedStyle(previewContainerEl);
        const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const cw = Math.max(0, previewContainerEl.clientWidth - paddingX);
        const ch = Math.max(0, previewContainerEl.clientHeight - paddingY);
        const scale = Math.max(0.01, Math.min(cw / baseW, ch / baseH));
        previewFrame.style.width = baseW + 'px';
        previewFrame.style.height = baseH + 'px';
        previewFrame.style.transform = `scale(${scale})`;
        const offsetX = parseFloat(style.paddingLeft) + (cw - baseW * scale) / 2;
        const offsetY = parseFloat(style.paddingTop) + (ch - baseH * scale) / 2;
        previewFrame.style.left = `${offsetX}px`;
        previewFrame.style.top = `${offsetY}px`;
    }
    // Wire modal preview controls to mimic Display Settings preview
    if (previewToggleMode && previewContainerEl) {
        const syncModeIcon = () => {
            const isCinema = previewContainerEl.classList.contains('cinema-mode');
            const icon = previewToggleMode.querySelector('i');
            if (icon) icon.className = `fas ${isCinema ? 'fa-mobile-screen' : 'fa-desktop'}`;
        };
        syncModeIcon();
        previewToggleMode.addEventListener('click', () => {
            const isCinema = previewContainerEl.classList.contains('cinema-mode');
            previewContainerEl.classList.toggle('cinema-mode', !isCinema);
            previewContainerEl.classList.toggle('screensaver-mode', isCinema);
            updateModalPreviewScale();
            syncModeIcon();
        });
    }
    if (previewToggleZoom && previewContainerEl) {
        previewToggleZoom.addEventListener('click', () => {
            // Use the same class name as main preview for 1.5x/2x zoom
            previewContainerEl.classList.toggle('zoom-2x');
            updateModalPreviewScale();
        });
    }

    // Make the preview draggable within the viewport bounds (top-right by default)
    (function enableModalDrag() {
        if (!previewContainerEl) return;
        let dragging = false;
        let offsetFromRight = 0;
        let offsetFromTop = 0;
        let rafId = null;
        let nextPos = null;
        const getViewportRect = () => ({
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
            width: window.innerWidth,
            height: window.innerHeight,
        });
        function isInteractive(target) {
            if (!target || !(target instanceof Element)) return false;
            return (
                target.closest('.pip-button') ||
                target.closest('.preview-controls') ||
                target.closest('.preview-peek-handle') ||
                target.closest('button, a, select, input, label')
            );
        }
        function onDown(e) {
            const tgt = e.target;
            if (isInteractive(tgt)) return;
            if (
                previewContainerEl &&
                previewContainerEl.dataset &&
                previewContainerEl.dataset.pinned === '1'
            )
                return;
            if (e.touches && e.touches.length > 1) return;
            dragging = true;
            previewContainerEl.classList.add('dragging');
            previewContainerEl.style.cursor = 'grabbing';
            try {
                if (previewFrame) previewFrame.style.pointerEvents = 'none';
            } catch (_) {}
            const rect = previewContainerEl.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            offsetFromRight = rect.right - clientX;
            offsetFromTop = clientY - rect.top;
            if (e.cancelable) e.preventDefault();
        }
        const DRAG_THRESHOLD = 4;
        let startedDragging = false;
        let startClientX = 0;
        let startClientY = 0;
        function onMove(e) {
            if (!dragging) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            if (!startedDragging) {
                const dx = Math.abs(clientX - startClientX);
                const dy = Math.abs(clientY - startClientY);
                if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
                startedDragging = true;
                try {
                    previewContainerEl.dataset.userMoved = '1';
                    previewContainerEl.dataset.pinned = '0';
                } catch (_) {}
            }
            const vp = getViewportRect();
            const rect = previewContainerEl.getBoundingClientRect();
            // Constrain within viewport with small margins
            const right = Math.max(
                0,
                Math.min(vp.width - rect.width, vp.right - (clientX + offsetFromRight))
            );
            let top = clientY - offsetFromTop; // viewport-relative
            const minTop = 12;
            const maxTop = Math.max(minTop, vp.height - rect.height - 12);
            top = Math.max(minTop, Math.min(maxTop, top));
            nextPos = { right, top };
            if (!rafId) {
                rafId = requestAnimationFrame(() => {
                    if (nextPos) {
                        previewContainerEl.style.right = nextPos.right + 'px';
                        previewContainerEl.style.left = 'auto';
                        previewContainerEl.style.top = nextPos.top + 'px';
                        nextPos = null;
                    }
                    rafId = null;
                });
            }
        }
        function onUp(e) {
            if (!dragging) return;
            const wasDragging = startedDragging;
            dragging = false;
            startedDragging = false;
            previewContainerEl.style.cursor = 'grab';
            previewContainerEl.classList.remove('dragging');
            try {
                if (previewFrame) previewFrame.style.pointerEvents = '';
            } catch (_) {}
            if (wasDragging && e && e.cancelable) {
                e.preventDefault();
                e.stopPropagation();
                previewContainerEl.style.pointerEvents = 'none';
                setTimeout(() => (previewContainerEl.style.pointerEvents = 'auto'), 0);
            }
        }
        previewContainerEl.addEventListener('mousedown', e => {
            startClientX = e.clientX;
            startClientY = e.clientY;
            onDown(e);
        });
        previewContainerEl.addEventListener(
            'touchstart',
            e => {
                startClientX = e.touches ? e.touches[0].clientX : 0;
                startClientY = e.touches ? e.touches[0].clientY : 0;
                onDown(e);
            },
            { passive: false }
        );
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
    })();

    // Initial collapsed state + scale, peek handle toggler, and keep scaled on size changes
    if (previewContainerEl) {
        // Expanded by default and slightly lower to align with first subsection
        previewContainerEl.classList.remove('collapsed');
        // For sticky preview the CSS controls vertical offset; just recalc scale
        requestAnimationFrame(() => {
            try {
                updateModalPreviewScale();
            } catch (_) {}
        });
        const peekHandle = previewContainerEl.querySelector('.preview-peek-handle');
        if (peekHandle) {
            peekHandle.addEventListener('click', e => {
                e.stopPropagation();
                previewContainerEl.classList.toggle('collapsed');
                updateModalPreviewScale();
            });
        }
    }
    if (window.ResizeObserver && previewContainerEl) {
        const ro = new ResizeObserver(() => updateModalPreviewScale());
        ro.observe(previewContainerEl);
    }

    // Also allow clicking the left side of the preview to toggle peek, unless interacting with controls
    if (previewContainerEl) {
        previewContainerEl.addEventListener('click', e => {
            const tgt = e.target;
            // Don't toggle if clicking interactive controls
            if (
                tgt.closest &&
                (tgt.closest('.pip-button') ||
                    tgt.closest('.preview-controls') ||
                    tgt.closest('.preview-peek-handle'))
            ) {
                return;
            }
            const rect = previewContainerEl.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x <= Math.max(40, rect.width * 0.2)) {
                previewContainerEl.classList.toggle('collapsed');
                updateModalPreviewScale();
            }
        });
    }

    // No presets UI

    btnSave.addEventListener('click', async () => {
        const dirtyPayload = payloadFromInputs(true); // only dirty fields
        // Avoid clearing existing overrides if nothing changed
        if (
            !dirtyPayload ||
            (typeof dirtyPayload === 'object' && Object.keys(dirtyPayload).length === 0)
        ) {
            status.textContent = 'No changes to save';
            return;
        }
        // Merge with current overrides so server replacement keeps others intact
        const payload = deepMerge(overrides || {}, dirtyPayload);
        try {
            btnSave.disabled = true;
            btnClear.disabled = true;
            status.textContent = 'Saving…';
            const res = await authenticatedFetch(apiUrl(`/api/devices/${encodeURIComponent(id)}`), {
                method: 'PATCH',
                body: JSON.stringify({ settingsOverride: payload }),
                noRedirectOn401: true,
            });
            if (!res.ok) throw new Error('Save failed');
            status.textContent = 'Saved. Applying…';
            // Refresh table to reflect overrides badge
            try {
                const list = await fetchDevices();
                renderDevicesTable(list);
            } catch (_) {
                /* ignore refresh errors */
            }
            setTimeout(close, 300);
        } catch (e) {
            status.textContent = 'Failed to save';
        } finally {
            btnSave.disabled = false;
            btnClear.disabled = false;
        }
    });

    btnClear.addEventListener('click', async () => {
        try {
            const ok = await confirmDialog('Clear overrides for this device?');
            if (!ok) return;
            btnSave.disabled = true;
            btnClear.disabled = true;
            status.textContent = 'Clearing…';
            const res = await authenticatedFetch(apiUrl(`/api/devices/${encodeURIComponent(id)}`), {
                method: 'PATCH',
                body: JSON.stringify({ settingsOverride: {} }),
                noRedirectOn401: true,
            });
            if (!res.ok) throw new Error('Clear failed');
            // Reset GUI fields
            const inputs = form.querySelectorAll('[data-key]');
            inputs.forEach(el => {
                if (el.type === 'checkbox') el.checked = false;
                else el.value = '';
                const key = el.getAttribute('data-key');
                if (el.type === 'range') {
                    const out = form.querySelector(`[data-out="${key}"]`);
                    if (out) out.textContent = '';
                }
            });
            dirty.clear?.();
            postPreview({});
            try {
                const list = await fetchDevices();
                renderDevicesTable(list);
            } catch (_) {
                /* ignore refresh errors */
            }
            setTimeout(close, 200);
        } catch (e) {
            status.textContent = 'Failed to clear';
        } finally {
            btnSave.disabled = false;
            btnClear.disabled = false;
        }
    });

    // no-op focus for GUI
    // Per-device UI scaling presets inside modal
    (function wireOverrideScalingPresets() {
        const map = {
            'full-hd': { content: 100, clearlogo: 100, clock: 100, global: 100 },
            '4k-tv': { content: 150, clearlogo: 140, clock: 140, global: 100 },
            ultrawide: { content: 115, clearlogo: 120, clock: 110, global: 100 },
        };
        const applyPreset = tpl => {
            const vals = map[tpl];
            if (!vals) return;
            Object.entries(vals).forEach(([k, v]) => {
                const input = form.querySelector(`[data-key="uiScaling.${k}"]`);
                if (input) {
                    input.value = String(v);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        };
        form.querySelectorAll('.ovr-preset-button, .preset-button').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-preset');
                applyPreset(key);
            });
        });
        const resetBtn = form.querySelector('#ovr-reset-scaling');
        if (resetBtn) resetBtn.addEventListener('click', () => applyPreset('full-hd'));
    })();
}

// DYNAMIC RATING FILTER FUNCTIONALITY
// ============================================================================

// As an extra safety net, bind global delegated click handlers once so device actions
// always work even if section-specific init didn't run for some reason.
(function bindDevicesDelegatedHandlersOnce() {
    if (window.__devicesDelegatedHandlersBound) return;
    window.__devicesDelegatedHandlersBound = true;
    const getStatusEl = () => document.getElementById('devices-status');
    devLog('bindDevicesDelegatedHandlersOnce: binding global handlers');

    // Capture-phase: only consume the event if we actually handle the command here.
    document.addEventListener(
        'click',
        async ev => {
            const withinDevices =
                ev.target && ev.target.closest && ev.target.closest('#devices-section');
            if (!withinDevices) return;
            const btn = ev.target.closest && ev.target.closest('button[data-cmd]');
            if (!btn) return;
            if (btn.disabled) return;
            try {
                btn.blur?.();
            } catch (_) {
                // ignore blur errors
            }
            const id = btn.getAttribute('data-id');
            const cmd = btn.getAttribute('data-cmd');
            const status = getStatusEl();
            try {
                (window.devLog || console.debug).call(console, 'global: action click', { cmd, id });
            } catch (_) {}
            const commandMap = {
                reload: 'core.mgmt.reload',
                reset: 'core.mgmt.reset',
                'power.toggle': 'power.toggle',
                'playback.prev': 'playback.prev',
                'playback.next': 'playback.next',
                'playback.pause': 'playback.pause',
                'playback.resume': 'playback.resume',
                'playback.pinPoster': 'playback.pinPoster',
                'playback.toggle': 'playback.toggle',
                'source.switch': 'source.switch',
            };
            const type = commandMap[cmd] || null;
            try {
                if (cmd === 'overrides') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    // Open overrides modal with fresh device data
                    try {
                        const res = await authenticatedFetch(
                            apiUrl(`/api/devices/${encodeURIComponent(id)}`),
                            { method: 'GET', noRedirectOn401: true }
                        );
                        if (!res.ok) throw new Error('Failed to load device');
                        const device = await res.json();
                        showDeviceSettingsModal(device);
                    } catch (e) {
                        if (status) status.textContent = 'Failed to open overrides editor';
                    }
                    return;
                }
                if (cmd === 'send-command') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    showSendCommandPopover(btn, id);
                    return;
                }
                if (cmd === 'delete') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    devLog('global: delete confirm open');
                    const ok = await confirmDialog('Delete this device?', btn);
                    devLog('global: delete confirm result', ok);
                    if (!ok) return;
                    setButtonState(btn, 'loading', { text: 'Deleting…' });
                    const res = await authenticatedFetch(
                        apiUrl(`/api/devices/${encodeURIComponent(id)}`),
                        { method: 'DELETE', noRedirectOn401: true }
                    );
                    if (!res.ok) throw new Error('Failed to delete');
                    if (status) status.textContent = 'Device deleted.';
                    const list = await fetchDevices();
                    renderDevicesTable(list);
                    setButtonState(btn, 'revert');
                    return;
                }
                if (cmd === 'pair') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    setButtonState(btn, 'loading', { text: 'Pairing…' });
                    const res = await authenticatedFetch(
                        apiUrl(`/api/devices/${encodeURIComponent(id)}/pairing-code`),
                        {
                            method: 'POST',
                            body: JSON.stringify({ ttlMs: 10 * 60 * 1000 }),
                            noRedirectOn401: true,
                        }
                    );
                    if (res.status === 404) {
                        if (status) status.textContent = 'Device no longer exists; list refreshed.';
                        const list = await fetchDevices();
                        renderDevicesTable(list);
                        setButtonState(btn, 'revert');
                        return;
                    }
                    if (!res.ok) throw new Error('Failed to get code');
                    const data = await res.json();
                    setButtonState(btn, 'success', { text: 'Code' });
                    const claimUrl = `${location.origin}/?pair=${encodeURIComponent(data.code)}${
                        data.token ? `&pairToken=${encodeURIComponent(data.token)}` : ''
                    }`;
                    showPairingModal({ code: data.code, expiresAt: data.expiresAt, claimUrl });
                    setTimeout(() => setButtonState(btn, 'revert'), 1500);
                } else if (type) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    setButtonState(btn, 'loading', { text: 'Queuing…' });
                    let payload;
                    if (type === 'source.switch') {
                        const srcKey = prompt(
                            'Enter source key to switch to (e.g., plex, jellyfin, tmdb, tvdb):'
                        );
                        if (!srcKey) {
                            setButtonState(btn, 'revert');
                            return;
                        }
                        payload = { sourceKey: srcKey };
                    } else if (type === 'playback.toggle') {
                        const isPlaying = btn.classList.contains('is-playing');
                        const nextType = isPlaying ? 'playback.pause' : 'playback.resume';
                        await sendDeviceCommand(id, nextType);
                        btn.classList.toggle('is-playing', !isPlaying);
                        const icon = btn.querySelector('i');
                        if (icon) icon.className = `fas ${!isPlaying ? 'fa-pause' : 'fa-play'}`;
                        btn.classList.toggle('is-primary', !isPlaying);
                    }
                    let __result3;
                    if (type !== 'playback.toggle')
                        __result3 = await sendDeviceCommand(id, type, payload);
                    const live3 = __result3 && __result3.live === true;
                    setButtonState(btn, 'success', { text: live3 ? 'Live' : 'Queued' });
                    if (status)
                        status.textContent = live3
                            ? 'Live: command delivered via WebSocket.'
                            : 'Queued: will run on next heartbeat.';
                    setTimeout(() => setButtonState(btn, 'revert'), 1200);
                    try {
                        (window.devLog || console.debug).call(console, 'global: command queued', {
                            cmd,
                            id,
                            type,
                        });
                    } catch (_) {}
                }
            } catch (err) {
                setButtonState(btn, 'error', { text: 'Failed' });
                if (status) status.textContent = 'Action failed.';
                setTimeout(() => setButtonState(btn, 'revert'), 1500);
                console.error('[Devices] global action error', err);
            }
        },
        true
    );

    // Bulk delete (capture-phase), restricted to Devices section
    document.addEventListener(
        'click',
        async ev => {
            const bulkBtn = ev.target.closest && ev.target.closest('#devices-delete-selected');
            if (!bulkBtn) return;
            if (!bulkBtn.closest('#devices-section')) return;
            ev.preventDefault();
            ev.stopPropagation();
            const container = document.getElementById('devices-subsection');
            const tbody = container && container.querySelector('#devices-table tbody');
            if (!tbody) return;
            const ids = Array.from(tbody.querySelectorAll('.row-select:checked')).map(cb =>
                cb.getAttribute('data-id')
            );
            devLog('global: bulk delete click', { count: ids.length, ids: ids.slice(0, 10) });
            if (!ids.length) return;
            const ok = await confirmDialog(`Delete ${ids.length} device(s)?`, bulkBtn);
            devLog('global: bulk confirm result', ok);
            if (!ok) return;
            for (const id of ids) {
                try {
                    await authenticatedFetch(apiUrl(`/api/devices/${encodeURIComponent(id)}`), {
                        method: 'DELETE',
                        noRedirectOn401: true,
                    });
                    devLog('global: bulk deleted', id);
                } catch (_) {
                    // ignore showPairingModal focus errors
                }
            }
            const list = await fetchDevices();
            renderDevicesTable(list);
        },
        true
    );
})();

/**
 * Load available ratings from a specific source
 * @param {string} sourceType - The source type (jellyfin, plex, etc.)
 * @returns {Promise<Array>} Array of available ratings
 */
async function loadAvailableRatings(sourceType) {
    try {
        const response = await authenticatedFetch(`/api/sources/${sourceType}/ratings`);
        const data = await response.json();

        if (data.success) {
            return data.data || [];
        } else {
            console.warn(`Failed to load ratings for ${sourceType}:`, data.error);
            return [];
        }
    } catch (error) {
        console.error(`Error loading ratings for ${sourceType}:`, error);
        return [];
    }
}

/**
 * Populate a rating filter dropdown with dynamic values
 * @param {HTMLSelectElement|HTMLDivElement} element - The element to populate (select or div for checkboxes)
 * @param {string} sourceType - The source type to get ratings for
 * @param {string|Array} currentValue - The currently selected value(s)
 */
async function populateRatingFilter(element, sourceType, currentValue = '') {
    try {
        // Check if this is a multi-select checkbox container
        const isMultiSelect = element.classList.contains('multi-select-checkboxes');

        if (isMultiSelect) {
            return await populateRatingFilterCheckboxes(element, sourceType, currentValue);
        }

        // Traditional select dropdown logic
        element.innerHTML = '<option value="">Loading...</option>';
        element.disabled = true;

        // Load available ratings
        const ratings = await loadAvailableRatings(sourceType);

        // Clear the select
        element.innerHTML = '';

        // Add default "All Ratings" option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'All Ratings';
        element.appendChild(defaultOption);

        // Add rating options
        ratings.forEach(rating => {
            const option = document.createElement('option');
            option.value = rating;
            option.textContent = rating;
            if (rating === currentValue) {
                option.selected = true;
            }
            element.appendChild(option);
        });

        // Re-enable the select
        element.disabled = false;

        // If no ratings found, show a message
        if (ratings.length === 0) {
            const noRatingsOption = document.createElement('option');
            noRatingsOption.value = '';
            noRatingsOption.textContent = 'No ratings available';
            noRatingsOption.disabled = true;
            element.appendChild(noRatingsOption);
        }

        console.log(
            `Populated rating filter for ${sourceType} with ${ratings.length} ratings:`,
            ratings
        );
    } catch (error) {
        console.error(`Error populating rating filter for ${sourceType}:`, error);

        // Show error state
        if (element.tagName === 'SELECT') {
            element.innerHTML = '<option value="">Error loading ratings</option>';
            element.disabled = false;
        } else {
            element.innerHTML = '<div class="loading-indicator">Error loading ratings</div>';
        }
    }
}

/**
 * Populate a rating filter with multi-select checkboxes
 * @param {HTMLDivElement} container - The container div element
 * @param {string} sourceType - The source type to get ratings for
 * @param {string|Array} currentValue - The currently selected value(s)
 */
async function populateRatingFilterCheckboxes(container, sourceType, currentValue = '') {
    try {
        // Show loading state
        container.innerHTML = '<div class="loading-indicator">Loading ratings...</div>';

        // Load available ratings with counts
        const response = await fetch(`/api/sources/${sourceType}/ratings-with-counts`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to load ratings');
        }

        // Check if server is disabled
        if (data.message && data.message.includes('disabled')) {
            container.innerHTML =
                '<div class="loading-indicator">Server disabled - no ratings available</div>';

            // Clear hidden field
            const hiddenFieldId = container.id + '-hidden';
            const hiddenField = document.getElementById(hiddenFieldId);
            if (hiddenField) {
                hiddenField.value = '';
            }
            return;
        }

        const ratingsWithCounts = data.data;

        // Clear the container
        container.innerHTML = '';

        // If no ratings available, show message
        if (ratingsWithCounts.length === 0) {
            container.innerHTML = '<div class="loading-indicator">No ratings available</div>';
            return;
        }

        // Parse current values (could be string or array)
        let selectedRatings = [];
        if (currentValue) {
            if (Array.isArray(currentValue)) {
                selectedRatings = currentValue;
            } else if (typeof currentValue === 'string') {
                selectedRatings = currentValue
                    .split(',')
                    .map(r => r.trim())
                    .filter(r => r);
            }
        }

        // Create checkboxes for each rating
        ratingsWithCounts.forEach(({ rating, count }) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'rating-checkbox-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `rating-${sourceType}-${rating}`;
            checkbox.value = rating;
            checkbox.checked = selectedRatings.includes(rating);

            const label = document.createElement('label');
            label.setAttribute('for', checkbox.id);
            label.textContent = rating;

            const countSpan = document.createElement('span');
            countSpan.className = 'rating-count';
            countSpan.textContent = `(${count})`;

            // Add event listener to update hidden field
            checkbox.addEventListener('change', () => {
                updateHiddenRatingField(container, sourceType);
            });

            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(label);
            itemDiv.appendChild(countSpan);
            container.appendChild(itemDiv);
        });

        // Update the hidden field with current selection
        updateHiddenRatingField(container, sourceType);

        // Update initial clear button visibility
        updateClearButtonVisibilityByContainer(container);

        console.log(
            `Populated rating filter checkboxes for ${sourceType} with ${ratingsWithCounts.length} ratings:`,
            ratingsWithCounts
        );
    } catch (error) {
        console.error(`Error populating rating filter checkboxes for ${sourceType}:`, error);
        container.innerHTML = '<div class="loading-indicator">Error loading ratings</div>';
    }
}

/**
 * Update the hidden field with selected rating values
 * @param {HTMLDivElement} container - The checkbox container
 * @param {string} sourceType - The source type
 */
function updateHiddenRatingField(container, _sourceType) {
    const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    const selectedValues = Array.from(checkboxes).map(cb => cb.value);

    // Find the corresponding hidden field by looking for the one that matches the container's ID pattern
    const containerId = container.id;
    const hiddenFieldId = containerId + '-hidden';
    const hiddenField = document.getElementById(hiddenFieldId);

    if (hiddenField) {
        hiddenField.value = selectedValues.length > 0 ? selectedValues.join(',') : '';
        console.log(`Updated hidden field ${hiddenFieldId} with:`, selectedValues);
    } else {
        console.warn(`Could not find hidden field with ID: ${hiddenFieldId}`);
    }

    // Update clear button visibility
    updateClearButtonVisibilityByContainer(container);
}

/**
 * Populates genre filter checkboxes for a source
 * @param {Array} genres - Array of genre strings
 * @param {HTMLDivElement} container - The checkbox container element
 * @param {string} currentValue - Currently selected genres as comma-separated string
 */
function populateGenreFilterCheckboxes(genres, container, currentValue = '') {
    if (!container) {
        console.warn('populateGenreFilterCheckboxes: Container element not found');
        return;
    }

    try {
        // Clear the container
        container.innerHTML = '';

        if (!genres || genres.length === 0) {
            container.innerHTML = '<div class="loading-indicator">No genres found</div>';
            return;
        }

        // Parse currently selected genres
        const selectedGenres = currentValue
            ? currentValue
                  .split(',')
                  .map(g => g.trim())
                  .filter(g => g)
            : [];

        // Create checkbox for each genre
        genres.forEach(genreItem => {
            // Handle both string genres and genre objects with counts
            const genre =
                typeof genreItem === 'string' ? genreItem : genreItem.genre || genreItem.name;
            const count = typeof genreItem === 'object' && genreItem.count ? genreItem.count : null;

            // Create container for this checkbox item
            const itemDiv = document.createElement('div');
            itemDiv.className = 'genre-checkbox-item';

            // Create checkbox input
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `genre_${Math.random().toString(36).substr(2, 9)}`;
            checkbox.value = genre;
            checkbox.checked = selectedGenres.includes(genre);

            // Create label with genre name
            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.className = 'genre-text';
            label.textContent = genre;

            // Add event listener to update hidden field
            checkbox.addEventListener('change', () => {
                updateHiddenGenreField(container);
            });

            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(label);

            // Add count span if available (as separate element like ratings)
            if (count !== null) {
                const countSpan = document.createElement('span');
                countSpan.className = 'genre-count';
                countSpan.textContent = `(${count})`;
                itemDiv.appendChild(countSpan);
            }

            container.appendChild(itemDiv);
        });

        // Update the hidden field with current selection
        updateHiddenGenreField(container);

        // Update initial clear button visibility
        updateClearButtonVisibilityByContainer(container);

        console.log(`Populated genre filter checkboxes with ${genres.length} genres:`, genres);
    } catch (error) {
        console.error('Error populating genre filter checkboxes:', error);
        container.innerHTML = '<div class="loading-indicator">Error loading genres</div>';
    }
}

/**
 * Update the hidden field with selected genre values
 * @param {HTMLDivElement} container - The checkbox container
 */
function updateHiddenGenreField(container) {
    const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    const selectedValues = Array.from(checkboxes).map(cb => cb.value);

    // Find the corresponding hidden field by looking for the one that matches the container's ID pattern
    const containerId = container.id;
    const hiddenFieldId = containerId + '-hidden';
    const hiddenField = document.getElementById(hiddenFieldId);

    if (hiddenField) {
        hiddenField.value = selectedValues.length > 0 ? selectedValues.join(',') : '';
        console.log(`Updated hidden field ${hiddenFieldId} with:`, selectedValues);
    } else {
        console.warn(`Could not find hidden field with ID: ${hiddenFieldId}`);
    }

    // Update clear button visibility based on the container
    updateClearButtonVisibilityByContainer(container);
}

// Generic function to clear any filter
function clearFilterSelection(containerId, buttonId) {
    const hiddenField = document.getElementById(containerId + '-hidden');
    if (hiddenField) {
        hiddenField.value = '';
    }

    const container = document.getElementById(containerId);
    if (container) {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
    }

    // Hide the clear button
    updateClearButtonVisibility(buttonId, container);
}

function clearGenreSelection() {
    // Clear Plex genre selection
    const plexHiddenField = document.getElementById('mediaServers[0].genreFilter-hidden');
    if (plexHiddenField) {
        plexHiddenField.value = '';
    }

    const plexGenreContainer = document.getElementById('mediaServers[0].genreFilter');
    if (plexGenreContainer) {
        const checkboxes = plexGenreContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
    }

    // Hide the clear button
    updateClearButtonVisibility('clearGenresBtn', plexGenreContainer);
}

function clearJellyfinGenreSelection() {
    // Clear Jellyfin genre selection
    const jellyfinHiddenField = document.getElementById('mediaServers[1].genreFilter-hidden');
    if (jellyfinHiddenField) {
        jellyfinHiddenField.value = '';
    }

    const jellyfinGenreContainer = document.getElementById('mediaServers[1].genreFilter');
    if (jellyfinGenreContainer) {
        const checkboxes = jellyfinGenreContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
    }

    // Hide the clear button
    updateClearButtonVisibility('clearJellyfinGenresBtn', jellyfinGenreContainer);
}

// Generic clear functions for rating and quality filters
function clearPlexRatingSelection() {
    clearFilterSelection('mediaServers[0].ratingFilter', 'clearPlexRatingsBtn');
}

function clearJellyfinRatingSelection() {
    clearFilterSelection('mediaServers[1].ratingFilter', 'clearJellyfinRatingsBtn');
}

function clearPlexQualitySelection() {
    clearFilterSelection('mediaServers[0].qualityFilter', 'clearPlexQualitiesBtn');
}

function clearJellyfinQualitySelection() {
    clearFilterSelection('mediaServers[1].qualityFilter', 'clearJellyfinQualitiesBtn');
}

function clearTMDBGenreSelection() {
    clearFilterSelection('tmdbSource.genreFilter', 'clearTMDBGenresBtn');
}

/**
 * Function to show/hide clear button based on selection
 * @param {string} buttonId - The ID of the clear button
 * @param {HTMLDivElement} container - The checkbox container
 */
function updateClearButtonVisibility(buttonId, container) {
    const button = document.getElementById(buttonId);
    if (!button || !container) return;

    const checkedBoxes = container.querySelectorAll('input[type="checkbox"]:checked');
    if (checkedBoxes.length > 0) {
        button.classList.add('visible');
    } else {
        button.classList.remove('visible');
    }
}

/**
 * Update clear button visibility based on container ID
 * @param {HTMLDivElement} container - The checkbox container
 */
function updateClearButtonVisibilityByContainer(container) {
    if (!container) return;

    const containerId = container.id;

    // Map container IDs to their corresponding clear button IDs
    const buttonMapping = {
        'mediaServers[0].genreFilter': 'clearGenresBtn',
        'mediaServers[1].genreFilter': 'clearJellyfinGenresBtn',
        'mediaServers[0].ratingFilter': 'clearPlexRatingsBtn',
        'mediaServers[1].ratingFilter': 'clearJellyfinRatingsBtn',
        'mediaServers[0].qualityFilter': 'clearPlexQualitiesBtn',
        'mediaServers[1].qualityFilter': 'clearJellyfinQualitiesBtn',
        'tmdbSource.genreFilter': 'clearTMDBGenresBtn',
    };

    const buttonId = buttonMapping[containerId];
    if (buttonId) {
        updateClearButtonVisibility(buttonId, container);
    }
}

/**
 * Populate quality filter checkboxes
 * @param {Array} qualities - Array of quality strings or objects with counts
 * @param {HTMLDivElement} container - The checkbox container element
 * @param {string} currentValue - Currently selected qualities as comma-separated string
 */
function populateQualityFilterCheckboxes(qualities, container, currentValue = '') {
    if (!container) {
        console.warn('populateQualityFilterCheckboxes: Container element not found');
        return;
    }

    try {
        // Clear the container
        container.innerHTML = '';

        if (!qualities || qualities.length === 0) {
            container.innerHTML = '<div class="loading-indicator">No qualities found</div>';
            return;
        }

        // Parse currently selected qualities
        const selectedQualities = currentValue
            ? currentValue
                  .split(',')
                  .map(q => q.trim())
                  .filter(q => q)
            : [];

        // Create checkbox for each quality
        qualities.forEach(qualityItem => {
            // Handle both string qualities and quality objects with counts
            const quality = typeof qualityItem === 'string' ? qualityItem : qualityItem.quality;
            const count =
                typeof qualityItem === 'object' && qualityItem.count ? qualityItem.count : null;

            // Create container for this checkbox item
            const itemDiv = document.createElement('div');
            itemDiv.className = 'quality-checkbox-item';

            // Create checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `${container.id}-${quality}`;
            checkbox.value = quality;
            checkbox.checked = selectedQualities.includes(quality);

            // Create label
            const label = document.createElement('label');
            label.htmlFor = checkbox.id;

            if (count !== null) {
                // Create label text and count span for right alignment
                const labelText = document.createElement('span');
                labelText.textContent = quality;

                const countSpan = document.createElement('span');
                countSpan.textContent = `(${count})`;
                countSpan.style.opacity = '0.7';

                label.appendChild(labelText);
                label.appendChild(countSpan);
            } else {
                label.textContent = quality;
            }

            // Add change listener to update hidden field
            checkbox.addEventListener('change', () => {
                updateHiddenQualityField(container);
            });

            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(label);
            container.appendChild(itemDiv);
        });

        // Update the hidden field with current selection
        updateHiddenQualityField(container);

        // Update initial clear button visibility
        updateClearButtonVisibilityByContainer(container);

        console.log(
            `Populated quality filter checkboxes with ${qualities.length} qualities:`,
            qualities
        );
    } catch (error) {
        console.error('Error populating quality filter checkboxes:', error);
        container.innerHTML = '<div class="loading-indicator">Error loading qualities</div>';
    }
}

/**
 * Update the hidden field with selected quality values
 * @param {HTMLDivElement} container - The checkbox container
 */
function updateHiddenQualityField(container) {
    const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    const selectedValues = Array.from(checkboxes).map(cb => cb.value);

    // Find the corresponding hidden field by looking for the one that matches the container's ID pattern
    const containerId = container.id;
    const hiddenFieldId = containerId + '-hidden';
    const hiddenField = document.getElementById(hiddenFieldId);

    if (hiddenField) {
        hiddenField.value = selectedValues.length > 0 ? selectedValues.join(',') : '';
        console.log(`Updated hidden field ${hiddenFieldId} with:`, selectedValues);
    } else {
        console.warn(`Could not find hidden field with ID: ${hiddenFieldId}`);
    }

    // Update clear button visibility
    updateClearButtonVisibilityByContainer(container);
}

/**
 * Initialize dynamic rating filters for all server configurations
 */
function initDynamicRatingFilters() {
    // Find all rating filter elements with dynamic-rating-filter class (both selects and divs)
    const ratingElements = document.querySelectorAll('.dynamic-rating-filter');

    ratingElements.forEach(async element => {
        const sourceType = element.dataset.source;
        let currentValue = '';

        // Check if the corresponding server is enabled
        const isServerEnabled = checkIfServerEnabled(sourceType);

        if (!isServerEnabled) {
            // Show disabled state instead of loading ratings
            showDisabledRatingFilter(element, sourceType);
            return;
        }

        // Get current value differently based on element type
        if (element.tagName === 'SELECT') {
            currentValue = element.value;
        } else if (element.classList.contains('multi-select-checkboxes')) {
            // For multi-select, get value from hidden field
            const hiddenFieldId = element.id + '-hidden';
            const hiddenField = document.getElementById(hiddenFieldId);
            if (hiddenField) {
                currentValue = hiddenField.value;
            }
        }

        if (sourceType) {
            await populateRatingFilter(element, sourceType, currentValue);
        } else {
            console.warn('Rating filter element missing data-source attribute:', element);
        }
    });
}

/**
 * Check if a server type is enabled in the current configuration
 * @param {string} sourceType - The source type to check
 * @returns {boolean} True if server is enabled
 */
function checkIfServerEnabled(sourceType) {
    // Get the current config from the page (assuming it's available globally)
    const configData = window.currentConfig;
    if (!configData) {
        return false;
    }

    // Check media servers (Plex, Jellyfin)
    if (sourceType === 'plex' || sourceType === 'jellyfin') {
        if (!configData.mediaServers) {
            return false;
        }
        const server = configData.mediaServers.find(s => s.type === sourceType);
        return server && server.enabled === true;
    }

    // Check external sources (TMDB, TVDB)
    if (sourceType === 'tmdb') {
        return configData.tmdbSource && configData.tmdbSource.enabled === true;
    }

    if (sourceType === 'tvdb') {
        return configData.tvdbSource && configData.tvdbSource.enabled === true;
    }

    return false;
}

/**
 * Show disabled state for rating filter
 * @param {HTMLElement} element - The rating filter element
 * @param {string} sourceType - The source type
 */
function showDisabledRatingFilter(element, _sourceType) {
    if (element.tagName === 'SELECT') {
        element.innerHTML = '<option value="">Server disabled</option>';
        element.disabled = true;
    } else if (element.classList.contains('multi-select-checkboxes')) {
        element.innerHTML =
            '<div class="loading-indicator">Server disabled - no ratings available</div>';

        // Clear hidden field
        const hiddenFieldId = element.id + '-hidden';
        const hiddenField = document.getElementById(hiddenFieldId);
        if (hiddenField) {
            hiddenField.value = '';
        }
    }
}

/**
 * Refresh rating filters (useful after server configuration changes)
 */
async function refreshRatingFilters() {
    // Refresh the current config first
    try {
        const response = await authenticatedFetch(apiUrlWithCacheBust('/api/admin/config'));
        if (response.ok) {
            const { config = {} } = await response.json();
            window.currentConfig = config;
        }
    } catch (error) {
        console.warn('Failed to refresh config for rating filters:', error);
    }

    // Re-initialize rating filters with fresh config
    initDynamicRatingFilters();

    // Re-initialize genre filters with fresh config
    if (typeof initDynamicGenreFilters === 'function') {
        initDynamicGenreFilters();
    }

    // Re-initialize quality filters with fresh config
    if (typeof initDynamicQualityFilters === 'function') {
        initDynamicQualityFilters();
    }
}

// Note: Rating filters are now initialized after config is loaded in loadConfig()
// instead of on DOMContentLoaded to ensure window.currentConfig is available

/**
 * Initialize all clear button listeners
 */
function initClearButtonListeners() {
    // Setup all clear button listeners
    const clearButtons = [
        { id: 'clearGenresBtn', handler: clearGenreSelection },
        { id: 'clearJellyfinGenresBtn', handler: clearJellyfinGenreSelection },
        { id: 'clearPlexRatingsBtn', handler: clearPlexRatingSelection },
        { id: 'clearJellyfinRatingsBtn', handler: clearJellyfinRatingSelection },
        { id: 'clearPlexQualitiesBtn', handler: clearPlexQualitySelection },
        { id: 'clearJellyfinQualitiesBtn', handler: clearJellyfinQualitySelection },
        { id: 'clearTMDBGenresBtn', handler: clearTMDBGenreSelection },
    ];

    clearButtons.forEach(({ id, handler }) => {
        const button = document.getElementById(id);
        if (button) {
            button.addEventListener('click', handler);
        }
    });

    // Also update visibility for all containers on initial load
    updateAllClearButtonVisibility();
}

/**
 * Update visibility for all clear buttons based on current selections
 */
function updateAllClearButtonVisibility() {
    const containers = [
        'mediaServers[0].genreFilter',
        'mediaServers[1].genreFilter',
        'mediaServers[0].ratingFilter',
        'mediaServers[1].ratingFilter',
        'mediaServers[0].qualityFilter',
        'mediaServers[1].qualityFilter',
        'tmdbSource.genreFilter',
    ];

    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container) {
            updateClearButtonVisibilityByContainer(container);
        }
    });
}

/**
 * Initialize dynamic genre filters for all server configurations
 */
function initDynamicGenreFilters() {
    // Find all genre filter elements with dynamic-genre-filter class
    const genreElements = document.querySelectorAll('.dynamic-genre-filter');

    genreElements.forEach(async element => {
        // Determine source type from element ID or data attribute
        let sourceType = element.dataset.source;
        if (!sourceType) {
            // Extract from ID pattern mediaServers[0].genreFilter -> plex, mediaServers[1].genreFilter -> jellyfin
            const idMatch = element.id.match(/mediaServers\[(\d+)\]\.genreFilter/);
            if (idMatch) {
                const serverIndex = parseInt(idMatch[1]);
                sourceType = serverIndex === 0 ? 'plex' : 'jellyfin';
            }
        }

        if (!sourceType) {
            console.warn('Genre filter element missing source identification:', element);
            return;
        }

        // Check if the corresponding server is enabled
        const isServerEnabled = checkIfServerEnabled(sourceType);

        if (!isServerEnabled) {
            // Show disabled state
            element.innerHTML =
                '<div class="loading-indicator">Server disabled - no genres available</div>';

            // Clear hidden field
            const hiddenFieldId = element.id + '-hidden';
            const hiddenField = document.getElementById(hiddenFieldId);
            if (hiddenField) {
                hiddenField.value = '';
            }
            return;
        }

        // Load genres based on source type
        try {
            if (sourceType === 'plex') {
                await window.loadPlexGenres?.();
            } else if (sourceType === 'jellyfin') {
                await window.loadJellyfinGenres?.();
            } else if (sourceType === 'tmdb') {
                await window.loadTmdbGenres?.();
            }
        } catch (error) {
            console.warn(`Failed to load ${sourceType} genres:`, error);
            element.innerHTML = '<div class="loading-indicator">Error loading genres</div>';
        }
    });
}

/**
 * Initialize dynamic quality filters for all server configurations
 */
function initDynamicQualityFilters() {
    // Find all quality filter elements with dynamic-quality-filter class
    const qualityElements = document.querySelectorAll('.dynamic-quality-filter');

    qualityElements.forEach(async element => {
        // Determine source type from element ID or data attribute
        let sourceType = element.dataset.source;
        if (!sourceType) {
            // Extract from ID pattern mediaServers[0].qualityFilter -> plex, mediaServers[1].qualityFilter -> jellyfin
            const idMatch = element.id.match(/mediaServers\[(\d+)\]\.qualityFilter/);
            if (idMatch) {
                const serverIndex = parseInt(idMatch[1]);
                sourceType = serverIndex === 0 ? 'plex' : 'jellyfin';
            }
        }

        if (!sourceType) {
            console.warn('Quality filter element missing source identification:', element);
            return;
        }

        // Check if the corresponding server is enabled
        const isServerEnabled = checkIfServerEnabled(sourceType);

        if (!isServerEnabled) {
            // Show disabled state
            element.innerHTML =
                '<div class="loading-indicator">Server disabled - no qualities available</div>';

            // Clear hidden field
            const hiddenFieldId = element.id + '-hidden';
            const hiddenField = document.getElementById(hiddenFieldId);
            if (hiddenField) {
                hiddenField.value = '';
            }
            return;
        }

        // Get current value from hidden field
        const hiddenFieldId = element.id + '-hidden';
        const hiddenField = document.getElementById(hiddenFieldId);
        const currentValue = hiddenField ? hiddenField.value : '';

        try {
            // Set loading state
            element.innerHTML = '<div class="loading-indicator">Loading qualities...</div>';

            // Fetch qualities from the appropriate API endpoint
            let apiUrl;
            if (sourceType === 'plex') {
                apiUrl = '/api/admin/plex-qualities-with-counts';
            } else if (sourceType === 'jellyfin') {
                apiUrl = '/api/admin/jellyfin-qualities-with-counts';
            } else {
                throw new Error(`Unknown source type: ${sourceType}`);
            }

            const response = await authenticatedFetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const qualities = data.qualities || [];

            populateQualityFilterCheckboxes(qualities, element, currentValue);
        } catch (error) {
            console.warn(`Failed to load ${sourceType} qualities:`, error);
            element.innerHTML = '<div class="loading-indicator">Error loading qualities</div>';
        }
    });
}

// Content source conditional visibility
function initSourceConditionalVisibility() {
    // One-time init guard to avoid duplicate listeners/notifications
    if (initSourceConditionalVisibility.__initialized) {
        return;
    }
    initSourceConditionalVisibility.__initialized = true;

    // Function to toggle visibility for Plex
    function togglePlexConfig() {
        const plexEnabledCheckbox = document.getElementById('mediaServers[0].enabled');
        const plexConfigContainer = document.getElementById('plex-config-container');
        if (plexEnabledCheckbox && plexConfigContainer) {
            if (plexEnabledCheckbox.checked) {
                plexConfigContainer.classList.remove('hidden');
                console.log('Plex config shown (checkbox is checked)');
            } else {
                plexConfigContainer.classList.add('hidden');
                console.log('Plex config hidden (checkbox is unchecked)');
            }
        }
    }

    // Function to toggle visibility for Jellyfin
    function toggleJellyfinConfig() {
        const jellyfinEnabledCheckbox = document.getElementById('mediaServers[1].enabled');
        const jellyfinConfigContainer = document.getElementById('jellyfin-config-container');
        if (jellyfinEnabledCheckbox && jellyfinConfigContainer) {
            if (jellyfinEnabledCheckbox.checked) {
                jellyfinConfigContainer.classList.remove('hidden');
                console.log('Jellyfin config shown (checkbox is checked)');
            } else {
                jellyfinConfigContainer.classList.add('hidden');
                console.log('Jellyfin config hidden (checkbox is unchecked)');
            }
        }
    }

    // Function to toggle visibility for TMDB
    function toggleTmdbConfig() {
        const tmdbEnabledCheckbox = document.getElementById('tmdbSource.enabled');
        const tmdbConfigContainer = document.getElementById('tmdb-config-container');
        if (tmdbEnabledCheckbox && tmdbConfigContainer) {
            if (tmdbEnabledCheckbox.checked) {
                tmdbConfigContainer.classList.remove('hidden');
                console.log('TMDB config shown (checkbox is checked)');
            } else {
                tmdbConfigContainer.classList.add('hidden');
                console.log('TMDB config hidden (checkbox is unchecked)');
            }
        }
    }

    // Function to toggle visibility for TVDB
    function toggleTvdbConfig() {
        const tvdbEnabledCheckbox = document.getElementById('tvdbSource.enabled');
        const tvdbConfigContainer = document.getElementById('tvdb-config-container');
        if (tvdbEnabledCheckbox && tvdbConfigContainer) {
            if (tvdbEnabledCheckbox.checked) {
                tvdbConfigContainer.classList.remove('hidden');
                console.log('TVDB config shown (checkbox is checked)');
            } else {
                tvdbConfigContainer.classList.add('hidden');
                console.log('TVDB config hidden (checkbox is unchecked)');
            }
        }
    }

    // Plex enable checkbox handler
    const plexEnabledCheckbox = document.getElementById('mediaServers[0].enabled');
    const plexConfigContainer = document.getElementById('plex-config-container');

    if (plexEnabledCheckbox && plexConfigContainer) {
        // Set initial state immediately
        togglePlexConfig();

        // Also set state after a short delay to handle config loading timing
        setTimeout(() => {
            togglePlexConfig();
            console.log('Plex conditional visibility re-initialized after delay');
        }, 100);

        // Listen for changes (visibility + restart required)
        // Debounced notifier to avoid duplicate toasts if anything else reacts too
        let plexNotifyTimer;
        plexEnabledCheckbox.addEventListener('change', () => {
            togglePlexConfig();
            // Show restart banner when toggling content sources
            showRestartButton();
            clearTimeout(plexNotifyTimer);
            plexNotifyTimer = setTimeout(() => {
                showNotification('Restart required to apply Plex source change.', 'warning');
            }, 50);
        });

        console.log('Plex conditional visibility initialized');
    } else {
        console.warn('Plex checkbox or container not found', {
            checkbox: !!plexEnabledCheckbox,
            container: !!plexConfigContainer,
        });
    }

    // Jellyfin enable checkbox handler
    const jellyfinEnabledCheckbox = document.getElementById('mediaServers[1].enabled');
    const jellyfinConfigContainer = document.getElementById('jellyfin-config-container');

    if (jellyfinEnabledCheckbox && jellyfinConfigContainer) {
        // Set initial state immediately
        toggleJellyfinConfig();

        // Also set state after a short delay to handle config loading timing
        setTimeout(() => {
            toggleJellyfinConfig();
            console.log('Jellyfin conditional visibility re-initialized after delay');
        }, 100);

        // Listen for changes (visibility + restart required)
        let jellyfinNotifyTimer;
        jellyfinEnabledCheckbox.addEventListener('change', () => {
            toggleJellyfinConfig();
            showRestartButton();
            clearTimeout(jellyfinNotifyTimer);
            jellyfinNotifyTimer = setTimeout(() => {
                showNotification('Restart required to apply Jellyfin source change.', 'warning');
            }, 50);
        });

        console.log('Jellyfin conditional visibility initialized');
    } else {
        console.warn('Jellyfin checkbox or container not found', {
            checkbox: !!jellyfinEnabledCheckbox,
            container: !!jellyfinConfigContainer,
        });
    }

    // TMDB enable checkbox handler
    const tmdbEnabledCheckbox = document.getElementById('tmdbSource.enabled');
    const tmdbConfigContainer = document.getElementById('tmdb-config-container');

    if (tmdbEnabledCheckbox && tmdbConfigContainer) {
        // Set initial state immediately
        toggleTmdbConfig();

        // Also set state after a short delay to handle config loading timing
        setTimeout(() => {
            toggleTmdbConfig();
            console.log('TMDB conditional visibility re-initialized after delay');
        }, 100);

        // Listen for changes (visibility + restart required)
        let tmdbNotifyTimer;
        tmdbEnabledCheckbox.addEventListener('change', () => {
            toggleTmdbConfig();
            showRestartButton();
            clearTimeout(tmdbNotifyTimer);
            tmdbNotifyTimer = setTimeout(() => {
                showNotification('Restart required to apply TMDB source change.', 'warning');
            }, 50);
        });

        console.log('TMDB conditional visibility initialized');
    } else {
        console.warn('TMDB checkbox or container not found', {
            checkbox: !!tmdbEnabledCheckbox,
            container: !!tmdbConfigContainer,
        });
    }

    // TVDB enable checkbox handler
    const tvdbEnabledCheckbox = document.getElementById('tvdbSource.enabled');
    const tvdbConfigContainer = document.getElementById('tvdb-config-container');

    if (tvdbEnabledCheckbox && tvdbConfigContainer) {
        // Set initial state immediately
        toggleTvdbConfig();

        // Also set state after a short delay to handle config loading timing
        setTimeout(() => {
            toggleTvdbConfig();
            console.log('TVDB conditional visibility re-initialized after delay');
        }, 100);

        // Listen for changes (visibility + restart required)
        let tvdbNotifyTimer;
        tvdbEnabledCheckbox.addEventListener('change', () => {
            toggleTvdbConfig();
            showRestartButton();
            clearTimeout(tvdbNotifyTimer);
            tvdbNotifyTimer = setTimeout(() => {
                showNotification('Restart required to apply TVDB source change.', 'warning');
            }, 50);
        });

        console.log('TVDB conditional visibility initialized');
    } else {
        console.warn('TVDB checkbox or container not found', {
            checkbox: !!tvdbEnabledCheckbox,
            container: !!tvdbConfigContainer,
        });
    }

    // Streaming Sources enable checkbox handler (no dedicated container to toggle)
    const streamingEnabledCheckbox = document.getElementById('streamingSources.enabled');
    if (streamingEnabledCheckbox) {
        // Initialize notification state based on current checkbox (no UI to toggle)
        setTimeout(() => {
            // No-op: keep for symmetry; could add container toggles in future
        }, 100);

        let streamingNotifyTimer;
        streamingEnabledCheckbox.addEventListener('change', () => {
            showRestartButton();
            clearTimeout(streamingNotifyTimer);
            streamingNotifyTimer = setTimeout(() => {
                showNotification('Restart required to apply Streaming Sources change.', 'warning');
            }, 50);
        });

        console.log('Streaming Sources restart requirement initialized');
    } else {
        console.warn('Streaming Sources checkbox not found');
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initSourceConditionalVisibility();
    initClearButtonListeners();
});

// Make functions globally available
window.loadAvailableRatings = loadAvailableRatings;
window.populateRatingFilter = populateRatingFilter;
window.refreshRatingFilters = refreshRatingFilters;
window.initDynamicGenreFilters = initDynamicGenreFilters;
window.initDynamicQualityFilters = initDynamicQualityFilters;
window.initSourceConditionalVisibility = initSourceConditionalVisibility;
window.initClearButtonListeners = initClearButtonListeners;

// Clear button functions
window.clearGenreSelection = clearGenreSelection;
window.clearJellyfinGenreSelection = clearJellyfinGenreSelection;
window.clearPlexRatingSelection = clearPlexRatingSelection;
window.clearJellyfinRatingSelection = clearJellyfinRatingSelection;
window.clearPlexQualitySelection = clearPlexQualitySelection;
window.clearJellyfinQualitySelection = clearJellyfinQualitySelection;
window.clearTMDBGenreSelection = clearTMDBGenreSelection;
window.clearFilterSelection = clearFilterSelection;

// Visibility functions
window.updateClearButtonVisibility = updateClearButtonVisibility;
window.updateClearButtonVisibilityByContainer = updateClearButtonVisibilityByContainer;
