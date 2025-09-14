/**
 * posterrama.app - Client-side logic
 *
 * Author: Mark Frelink
 * Last Modified: 2025-07-26
 * License: GPL-3.0-or-later - This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// Simple frontend logger to match backend logger interface
const logger = {
    debug: () => {}, // silenced for cleaner browser console
    info: () => {}, // silenced for cleaner browser console
    warn: (message, data) => console.warn(`[WARN] ${message}`, data || ''),
    error: (message, data) => console.error(`[ERROR] ${message}`, data || ''),
};

// Silence generic console noise on the public page (keep warn/error)
(() => {
    try {
        const noop = () => {};
        // Silence logs unconditionally (debug helpers removed)
        console.log = noop;
        console.info = noop;
        console.debug = noop;
    } catch (_) {
        // intentionally empty: silencing console in non-debug mode may fail in some environments
    }
})();

document.addEventListener('DOMContentLoaded', async () => {
    // (Ken Burns debug helpers removed)
    // --- iOS background behavior: lock to 'clip' mode ---
    (function () {
        const ua = navigator.userAgent || '';
        const isIOS = /iPhone|iPad|iPod/i.test(ua);
        if (!isIOS) return; // only apply on iOS
        // Force clip behavior consistently; ignore URL/localStorage
        document.body.classList.add('ios-bg-clip');
        document.body.classList.remove('ios-bg-full');
    })();
    // --- Element References ---
    const layerA = document.getElementById('layer-a');
    const layerB = document.getElementById('layer-b');
    const infoContainer = document.getElementById('info-container');
    const textWrapper = document.getElementById('text-wrapper');
    const posterWrapper = document.getElementById('poster-wrapper');
    const posterEl = document.getElementById('poster');
    const posterLink = document.getElementById('poster-link');
    const titleEl = document.getElementById('title');
    const taglineEl = document.getElementById('tagline');
    const yearEl = document.getElementById('year');
    const ratingEl = document.getElementById('rating');
    const clearlogoEl = document.getElementById('clearlogo');
    const timeHours = document.getElementById('time-hours');
    const timeMinutes = document.getElementById('time-minutes');
    const pauseButton = document.getElementById('pause-button');
    const nextButton = document.getElementById('next-button');
    const prevButton = document.getElementById('prev-button');
    const controlsContainer = document.getElementById('controls-container');
    const loader = document.getElementById('loader');

    // (Ken Burns monitor removed)

    // Prime background visibility very early in screensaver mode to prevent black flashes
    try {
        // We'll correct if modes change later
        if (layerA && layerB) {
            layerA.style.transition = 'none';
            layerB.style.transition = 'none';
            layerA.style.opacity = '1';
            layerB.style.opacity = '0';
        }
    } catch (_) {
        // intentionally empty: early priming is best-effort only
    }

    // --- Create and inject Rotten Tomatoes badge ---
    const rtBadge = document.createElement('div');
    rtBadge.id = 'rt-badge';

    const rtIcon = document.createElement('img');
    rtIcon.id = 'rt-icon';
    rtIcon.alt = 'Rotten Tomatoes';

    rtBadge.appendChild(rtIcon);
    posterEl.appendChild(rtBadge);

    // Helper: ensure the RT badge stays attached to the poster element, even if posterEl.innerHTML was reset
    function ensureRtBadgeAttached() {
        try {
            if (!rtBadge.isConnected || rtBadge.parentNode !== posterEl) {
                posterEl.appendChild(rtBadge);
            }
        } catch (_) {
            // no-op: conservative safety
        }
    }

    // Helper: in screensaver mode, re-assert visibility of poster/metadata/info container
    function ensureScreensaverVisibility() {
        try {
            const isScreensaver = !appConfig.cinemaMode && !appConfig.wallartMode?.enabled;
            if (!isScreensaver) return;
            const posterVisible = appConfig.showPoster !== false;
            const metaVisible = appConfig.showMetadata !== false;

            // Toggle poster and metadata wrappers
            if (posterWrapper) posterWrapper.classList.toggle('is-hidden', !posterVisible);
            if (textWrapper) textWrapper.classList.toggle('is-hidden', !metaVisible);

            // If any is visible, ensure the container is shown
            if (posterVisible || metaVisible) {
                infoContainer.classList.add('visible');
                // Also guard against inline display:none from previous modes
                if (infoContainer.style.display === 'none') {
                    infoContainer.style.display = 'flex';
                }
            } else {
                // Hide the container when nothing should be shown
                infoContainer.classList.remove('visible');
            }
        } catch (_) {
            // ignore
        }
    }

    // Helper: ensure at least one background layer is visible to avoid black screen
    function ensureBackgroundVisible() {
        try {
            const la = document.getElementById('layer-a');
            const lb = document.getElementById('layer-b');
            if (!la || !lb) return;
            const aOp = parseFloat(getComputedStyle(la).opacity || '1');
            const bOp = parseFloat(getComputedStyle(lb).opacity || '1');
            if (aOp <= 0.01 && bOp <= 0.01) {
                // Prefer the layer that already has a background image to avoid flashing black
                let target = activeLayer || la;
                try {
                    const aBg = getComputedStyle(la).backgroundImage;
                    const bBg = getComputedStyle(lb).backgroundImage;
                    const aHas = aBg && aBg !== 'none' && aBg !== 'initial';
                    const bHas = bBg && bBg !== 'none' && bBg !== 'initial';
                    if (aHas && !bHas) target = la;
                    else if (bHas && !aHas) target = lb;
                } catch (_) {
                    // best-effort; fall back to activeLayer
                }
                target.style.opacity = '1'; // Ensure the target layer is visible
            }
        } catch (_) {
            // ignore
        }
    }

    // Helper: detect if a Ken Burns animation is currently active on either layer
    function isKenBurnsActive() {
        try {
            // In admin live preview, pretend no Ken Burns is active
            if (window.IS_PREVIEW) return false;
            const la = document.getElementById('layer-a');
            const lb = document.getElementById('layer-b');
            if (!la || !lb) return false;
            return (
                (la.hasAttribute('data-ken-burns') &&
                    la.getAttribute('data-ken-burns') !== 'false') ||
                (lb.hasAttribute('data-ken-burns') && lb.getAttribute('data-ken-burns') !== 'false')
            );
        } catch (_) {
            return false; // Return false if an error occurs
        }
    }

    // Helper: force-initialize background layers when returning to screensaver mode
    // NOTE: If Ken Burns is active, defer reinit to avoid visible transform snaps.
    function reinitBackgroundForScreensaver() {
        try {
            const isScreensaver = !appConfig.cinemaMode && !appConfig.wallartMode?.enabled;
            if (!isScreensaver) return;

            // If Ken Burns is currently active on any layer, postpone reinit slightly.
            if (isKenBurnsActive && typeof isKenBurnsActive === 'function' && isKenBurnsActive()) {
                // Debounced retry to avoid stacking timers
                if (window._reinitRetryTimer) {
                    clearTimeout(window._reinitRetryTimer);
                    window._reinitRetryTimer = null;
                }
                window._reinitRetryTimer = setTimeout(() => {
                    window._reinitRetryTimer = null;
                    try {
                        if (
                            !isKenBurnsActive() &&
                            !appConfig.cinemaMode &&
                            !appConfig.wallartMode?.enabled
                        ) {
                            reinitBackgroundForScreensaver();
                        }
                    } catch (_) {
                        // best-effort
                    }
                }, 650);
                return; // Don't reset transforms mid-KB
            }

            const la = document.getElementById('layer-a');
            const lb = document.getElementById('layer-b');
            if (!la || !lb) return;

            // Reset styles (safe now because no active Ken Burns)
            [la, lb].forEach(el => {
                el.style.animation = 'none';
                el.style.transition = 'none';
                el.style.transform = 'none';
            });

            // Choose a media item
            let mediaItem = null;
            if (mediaQueue && mediaQueue.length > 0) {
                const idx = currentIndex >= 0 ? currentIndex : 0;
                mediaItem = mediaQueue[idx] || mediaQueue[0];
            }

            if (mediaItem && mediaItem.backgroundUrl) {
                la.style.backgroundImage = `url('${mediaItem.backgroundUrl}')`;
                // Preload lb with the same image as a safe fallback; it will be replaced on next cycle
                lb.style.backgroundImage = `url('${mediaItem.backgroundUrl}')`;
            }

            // Make sure the visible layer shows immediately
            la.style.transition = 'none';
            lb.style.transition = 'none';
            la.style.opacity = '1';
            lb.style.opacity = '0';

            // Reset references to a known state
            activeLayer = la;
            inactiveLayer = lb;

            ensureBackgroundVisible();
        } catch (_) {
            // ignore
        }
    }

    // --- State ---
    let mediaQueue = [];
    let currentIndex = -1;
    let activeLayer = layerA;
    let inactiveLayer = layerB;
    let isPaused = false;
    let timerId = null;
    let controlsTimer = null;
    let refreshTimerId = null;
    let configRefreshTimerId = null;
    let wallartTransitionTimer = null;
    let wallartRefreshTimeout = null;
    let wallartTitleTimer = null; // Timer to keep title as "Posterrama" in wallart mode
    let wallartInitializing = false; // Flag to prevent multiple initialization attempts
    // Wallart Phase 1 additions
    // Spotlight feature removed
    let wallartAmbientTweenTimer = null;
    let appConfig = {};

    const transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

    // Protect document.title from unwanted changes in wallart mode
    const originalTitleDescriptor =
        Object.getOwnPropertyDescriptor(Document.prototype, 'title') ||
        Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'title');

    if (originalTitleDescriptor && originalTitleDescriptor.set) {
        Object.defineProperty(document, 'title', {
            get: originalTitleDescriptor.get,
            set: function (value) {
                if (document.body && document.body.classList.contains('wallart-mode')) {
                    logger.debug(
                        `[WALLART] Title protection - blocked change from "${document.title}" to "${value}"`
                    );
                    return; // Block the change
                }
                originalTitleDescriptor.set.call(this, value);
            },
            configurable: true,
        });
    }

    function updateDocumentTitle(mediaItem) {
        // Force title to "Posterrama" in wallart mode, bypassing protection
        if (document.body.classList.contains('wallart-mode')) {
            // Temporarily remove wallart-mode to allow title change
            document.body.classList.remove('wallart-mode');
            document.title = 'Posterrama';
            document.body.classList.add('wallart-mode');
        } else if (mediaItem && mediaItem.title) {
            document.title = `${mediaItem.title} - posterrama.app`;
        } else {
            document.title = 'Posterrama';
        }
    }

    // Simple network status indicator
    function showNetworkStatus(status) {
        let indicator = document.getElementById('network-status');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'network-status';
            indicator.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 8px 16px;
                border-radius: 20px;
                color: white;
                font-size: 12px;
                font-weight: 500;
                z-index: 1000;
                transition: all 0.3s ease;
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                display: none;
            `;
            document.body.appendChild(indicator);
        }

        if (status === 'offline') {
            indicator.textContent = '⚠️ Offline Mode';
            indicator.style.background = 'rgba(255, 152, 0, 0.9)';
            indicator.style.display = 'block';
        } else if (status === 'online') {
            indicator.textContent = '✅ Connected';
            indicator.style.background = 'rgba(76, 175, 80, 0.9)';
            indicator.style.display = 'block';
            setTimeout(() => (indicator.style.display = 'none'), 3000);
        } else {
            indicator.style.display = 'none';
        }
    }

    function showError(message) {
        // Add fallback background to body
        document.body.classList.add('no-media-background');

        let errorMessageEl = document.getElementById('error-message');
        if (!errorMessageEl) {
            errorMessageEl = document.createElement('div');
            errorMessageEl.id = 'error-message';
            // Minimal safe defaults so it doesn't break layouts without CSS
            errorMessageEl.style.position = 'absolute';
            errorMessageEl.style.top = '50%';
            errorMessageEl.style.left = '50%';
            errorMessageEl.style.transform = 'translate(-50%, -50%)';
            errorMessageEl.style.color = '#fff';
            errorMessageEl.style.textAlign = 'center';
            errorMessageEl.style.maxWidth = '90vw';
            errorMessageEl.classList?.add?.('is-hidden');
            document.body.appendChild(errorMessageEl);
        }

        errorMessageEl.innerHTML = `
            <div class="error-icon">📺</div>
            <div class="error-brand">Posterrama</div>
            <div class="error-title">No Media Available</div>
            <div class="error-text">${message}</div>
            <div class="error-suggestions">
                <h4>Possible solutions:</h4>
                <ul>
                    <li>Check if your content source is enabled and configured</li>
                    <li>Verify the connection to your media server</li>
                    <li>Ensure there is media in your library</li>
                    <li>Review the configuration settings in the admin panel</li>
                </ul>
            </div>
        `;
        errorMessageEl.classList.remove('is-hidden');
        console.error('Posterrama Error:', message);
    }

    async function initialize() {
        try {
            // Enhanced cache-busting for initial config load
            const cacheBuster = `?_t=${Date.now()}&_r=${Math.random().toString(36).substring(7)}`;
            const configResponse = await fetch('/get-config' + cacheBuster, {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    Pragma: 'no-cache',
                    Expires: '0',
                },
            });
            appConfig = await configResponse.json();

            // Check for promo site config override (forced screensaver mode)
            if (window.CONFIG_OVERRIDE) {
                // console.log removed for cleaner browser console
                appConfig = { ...appConfig, ...window.CONFIG_OVERRIDE };
            }

            // Logic for the public site promo box.
            // The server injects `isPublicSite: true` into the config for the public-facing server.
            if (appConfig.isPublicSite) {
                // console.log removed for cleaner browser console

                // Add promo-site class to body for CSS targeting
                document.body.classList.add('promo-site');

                const promoBox = document.getElementById('promo-box');
                if (promoBox) {
                    promoBox.classList.remove('is-hidden');
                    promoBox.style.display = 'block';
                    // console.log removed for cleaner browser console
                } else {
                    logger.warn('[Promo Site] Promo box element not found');
                }

                // Force screensaver mode on promo site
                // console.log removed for cleaner browser console
                document.body.classList.add('screensaver-mode');

                // Ensure poster and info elements are visible
                const infoContainer = document.getElementById('info-container');
                const posterWrapper = document.getElementById('poster-wrapper');
                if (infoContainer) infoContainer.style.display = 'block';
                if (posterWrapper) posterWrapper.style.display = 'block';
            }
        } catch (e) {
            showError(e.message);
            console.error(e);
            return;
        }

        await fetchMedia(true);

        // Only apply visual element settings in screensaver mode (not cinema or wallart mode)
        const isScreensaverMode = !appConfig.cinemaMode && !appConfig.wallartMode?.enabled;

        if (isScreensaverMode) {
            // Poster visibility toggles only the poster area, not the entire container
            if (appConfig.showPoster === false) {
                posterWrapper?.classList.add('is-hidden');
            } else {
                posterWrapper?.classList.remove('is-hidden');
            }

            // Metadata visibility is independent
            if (appConfig.showMetadata === false) {
                textWrapper.classList.add('is-hidden');
            } else {
                textWrapper.classList.remove('is-hidden');
            }

            // Safety: ensure the main container itself isn't force-hidden
            infoContainer.classList.remove('is-hidden');
        }

        // Clock widget logic - only show in screensaver mode
        const shouldShowClock = appConfig.clockWidget && isScreensaverMode;

        if (shouldShowClock) {
            const widgetContainer = document.getElementById('clock-widget-container');
            if (widgetContainer) {
                widgetContainer.style.display = 'block';
                updateClock();
                setInterval(updateClock, 1000);
            }
        } else {
            const widgetContainer = document.getElementById('clock-widget-container');
            if (widgetContainer) {
                widgetContainer.style.display = 'none';
            }
        }

        if (appConfig.backgroundRefreshMinutes > 0) {
            if (refreshTimerId) clearInterval(refreshTimerId);
            refreshTimerId = setInterval(
                fetchMedia,
                appConfig.backgroundRefreshMinutes * 60 * 1000
            );
        }

        // Periodically refresh configuration to pick up admin changes
        // Check for config changes every 30 seconds for responsive updates
        if (configRefreshTimerId) clearInterval(configRefreshTimerId);
        configRefreshTimerId = setInterval(refreshConfig, 30 * 1000);

        // Also refresh config when window gains focus (returning from admin interface)
        window.addEventListener('focus', () => {
            // console.log removed for cleaner browser console
            setTimeout(refreshConfig, 1000); // Small delay to ensure any pending saves are complete
        });

        // Apply initial UI scaling (only for screensaver mode)
        if (!appConfig.cinemaMode && !appConfig.wallartMode?.enabled) {
            applyUIScaling(appConfig);
        }

        // Apply cinema mode
        applyCinemaMode(appConfig);

        // Apply wallart mode
        applyWallartMode(appConfig);
    }

    // --- Live Preview support ---
    // Apply a subset of settings at runtime without reload. No persistence here.
    function applySettings(partial) {
        try {
            if (!partial || typeof partial !== 'object') return;
            // Merge into current appConfig (shallow for top-level, deep for known groups)
            const next = { ...appConfig };
            let rerenderNeeded = false; // whether we should refresh current media display after commit
            let rerenderDeferred = false; // whether we intentionally skip rerender due to active Ken Burns
            let wallartNeedsApply = false; // track if wallart should be (re)applied
            if (partial.uiScaling) {
                next.uiScaling = { ...next.uiScaling, ...partial.uiScaling };
                applyUIScaling(next);
                // Reflect UI scaling safely; defer rerender if KB is active
                rerenderNeeded = true;
            }
            if (typeof partial.showPoster === 'boolean') {
                next.showPoster = partial.showPoster;
                const isScreensaverNow = !next.cinemaMode && !next.wallartMode?.enabled;
                if (isScreensaverNow) {
                    const pw = document.getElementById('poster-wrapper');
                    if (pw) pw.classList.toggle('is-hidden', !partial.showPoster);
                }
                // If poster is hidden, also hide metadata (requested coupling) - screensaver only
                if (isScreensaverNow) {
                    if (partial.showPoster === false) {
                        const tw = document.getElementById('text-wrapper');
                        if (tw) tw.classList.add('is-hidden');
                    } else {
                        // Restore metadata only when allowed by its own toggle
                        const canShowMeta = next.showMetadata !== false;
                        const tw = document.getElementById('text-wrapper');
                        if (tw) tw.classList.toggle('is-hidden', !canShowMeta);
                    }
                }
                // Info container visibility is handled by final ensure helper below
            }
            if (typeof partial.showMetadata === 'boolean') {
                next.showMetadata = partial.showMetadata;
                const isScreensaver = !next.cinemaMode && !next.wallartMode?.enabled;
                if (isScreensaver) {
                    const tw = document.getElementById('text-wrapper');
                    if (tw) tw.classList.toggle('is-hidden', !partial.showMetadata);
                    const posterVisible = next.showPoster !== false;
                    const metaVisible = partial.showMetadata !== false;
                    if (posterVisible || metaVisible) {
                        infoContainer.classList.add('visible');
                    } else {
                        infoContainer.classList.remove('visible');
                    }
                }
            }
            // ClearLogo and Rotten Tomatoes toggles affect the media display
            if (typeof partial.showClearLogo === 'boolean') {
                next.showClearLogo = partial.showClearLogo;
                rerenderNeeded = true;
            }
            if (typeof partial.showRottenTomatoes === 'boolean') {
                next.showRottenTomatoes = partial.showRottenTomatoes;
                rerenderNeeded = true;
            }
            if (typeof partial.rottenTomatoesMinimumScore === 'number') {
                next.rottenTomatoesMinimumScore = partial.rottenTomatoesMinimumScore;
                rerenderNeeded = true;
            }
            if (
                typeof partial.clockWidget === 'boolean' ||
                partial.clockFormat ||
                partial.clockTimezone
            ) {
                next.clockWidget =
                    typeof partial.clockWidget === 'boolean'
                        ? partial.clockWidget
                        : next.clockWidget;
                next.clockFormat = partial.clockFormat || next.clockFormat;
                next.clockTimezone = partial.clockTimezone || next.clockTimezone;
                // Re-render clock visibility
                const shouldShowClock =
                    next.clockWidget && !next.cinemaMode && !next.wallartMode?.enabled;
                const widgetContainer = document.getElementById('clock-widget-container');
                if (widgetContainer)
                    widgetContainer.style.display = shouldShowClock ? 'block' : 'none';
            }
            if (typeof partial.cinemaMode === 'boolean' || partial.cinemaOrientation) {
                next.cinemaMode =
                    typeof partial.cinemaMode === 'boolean' ? partial.cinemaMode : next.cinemaMode;
                if (partial.cinemaOrientation) next.cinemaOrientation = partial.cinemaOrientation;
                applyCinemaMode(next);
            }
            if (partial.wallartMode) {
                next.wallartMode = { ...next.wallartMode, ...partial.wallartMode };
                wallartNeedsApply = true;
            }
            // Map top-level hero controls into wallart layout settings when present
            if (
                typeof partial.heroSide === 'string' ||
                typeof partial.heroRotationMinutes !== 'undefined'
            ) {
                next.wallartMode = next.wallartMode || { enabled: false };
                next.wallartMode.layoutSettings = next.wallartMode.layoutSettings || {};
                next.wallartMode.layoutSettings.heroGrid =
                    next.wallartMode.layoutSettings.heroGrid || {};
                if (typeof partial.heroSide === 'string') {
                    next.wallartMode.layoutSettings.heroGrid.heroSide = partial.heroSide;
                }
                if (typeof partial.heroRotationMinutes !== 'undefined') {
                    const v = Number(partial.heroRotationMinutes);
                    if (Number.isFinite(v)) {
                        next.wallartMode.layoutSettings.heroGrid.heroRotationMinutes = v;
                    }
                }
                wallartNeedsApply = true;
            }
            if (
                typeof partial.transitionIntervalSeconds === 'number' ||
                partial.transitionEffect ||
                typeof partial.effectPauseTime === 'number'
            ) {
                next.transitionIntervalSeconds =
                    typeof partial.transitionIntervalSeconds === 'number'
                        ? partial.transitionIntervalSeconds
                        : next.transitionIntervalSeconds;
                next.transitionEffect = partial.transitionEffect || next.transitionEffect;
                next.effectPauseTime =
                    typeof partial.effectPauseTime === 'number'
                        ? partial.effectPauseTime
                        : next.effectPauseTime;
                // Restart slideshow to apply timing/effect changes smoothly
                if (timerId) clearInterval(timerId);
                timerId = null;
                // Trigger immediate update of current media to reflect effect if possible
                updateCurrentMediaDisplay();
                // Also re-apply poster/background effect right away in screensaver mode
                const isScreensaverNow = !next.cinemaMode && !next.wallartMode?.enabled;
                if (isScreensaverNow && currentIndex >= 0 && currentIndex < mediaQueue.length) {
                    try {
                        const currentMedia = mediaQueue[currentIndex];
                        if (currentMedia && currentMedia.posterUrl) {
                            applyPosterTransitionEffect(currentMedia.posterUrl);
                        }
                    } catch (_) {
                        // ignore
                    }
                }
            }
            // Commit the new config
            appConfig = next;
            // Apply wallart changes if needed (handles classic/hero, side, density, etc.)
            if (wallartNeedsApply) {
                applyWallartMode(appConfig);
            }
            // Rerender current media if necessary (e.g., clearlogo/RT changes)
            if (rerenderNeeded) {
                if (isKenBurnsActive()) {
                    // Defer rerender to avoid killing the in-flight transform; next transition will pick it up
                    rerenderDeferred = true;
                } else {
                    updateCurrentMediaDisplay();
                }
            }
            // Final visibility check for screensaver preview: ensure info-container is shown
            // when either poster or metadata is enabled (addresses first-toggle-not-showing)
            const isScreensaverFinal = !appConfig.cinemaMode && !appConfig.wallartMode?.enabled;
            if (isScreensaverFinal) {
                const posterVisibleFinal = appConfig.showPoster !== false;
                const metaVisibleFinal = appConfig.showMetadata !== false;
                if (posterVisibleFinal || metaVisibleFinal) {
                    infoContainer.classList.add('visible');
                }
            }
            // Persist helpers in case poster innerHTML resets or class toggles race with transitions
            ensureRtBadgeAttached();
            ensureScreensaverVisibility();
            // If we deferred a rerender, schedule a lightweight check after fade duration to apply when safe
            if (rerenderDeferred) {
                setTimeout(() => {
                    if (!isKenBurnsActive()) {
                        try {
                            updateCurrentMediaDisplay();
                        } catch (_) {
                            // intentionally empty: updateCurrentMediaDisplay may be unavailable briefly
                        }
                    }
                }, 1500);
            }
        } catch (e) {
            logger.warn('[Preview] Failed to apply settings', e);
        }
    }

    // Expose for previews
    window.applySettings = applySettings;

    // Listen for preview messages from admin iframe
    window.addEventListener('message', event => {
        try {
            // Only accept same-origin messages
            if (event.origin !== window.location.origin) return;
            const data = event.data || {};
            if (data && data.type === 'posterrama.preview.update' && data.payload) {
                applySettings(data.payload);
            }
        } catch (_) {
            // ignore
        }
    });

    // Export initialize function for external use (promo site)
    window.initializeApp = initialize;

    function applyUIScaling(config) {
        // Apply UI scaling from configuration
        if (!config.uiScaling) {
            return;
        }

        const root = document.documentElement;
        const scaling = config.uiScaling;

        // Calculate final scaling values (individual * global / 100)
        const globalScale = scaling.global || 100;
        const contentScale = ((scaling.content || 100) * globalScale) / 100;
        const clearlogoScale = ((scaling.clearlogo || 100) * globalScale) / 100;
        const clockScale = ((scaling.clock || 100) * globalScale) / 100;

        // Set CSS custom properties for scaling
        root.style.setProperty('--content-scale', contentScale / 100);
        root.style.setProperty('--clearlogo-scale', clearlogoScale / 100);
        root.style.setProperty('--clock-scale', clockScale / 100);
    }

    function applyCinemaMode(config) {
        const body = document.body;

        // Remove any existing cinema mode classes
        body.classList.remove(
            'cinema-mode',
            'cinema-auto',
            'cinema-portrait',
            'cinema-portrait-flipped'
        );

        const nextCinemaEnabled = !!config.cinemaMode;
        const lastCinemaEnabled = !!window._lastCinemaEnabled;
        window._lastCinemaEnabled = nextCinemaEnabled;

        if (nextCinemaEnabled) {
            // Add cinema mode base class
            body.classList.add('cinema-mode');

            // Remove wallart mode if active (mutual exclusivity)
            body.classList.remove('wallart-mode');

            // Clean up wallart resize listener when switching to cinema mode
            if (window.wallartResizeListener) {
                window.removeEventListener('resize', window.wallartResizeListener);
                window.wallartResizeListener = null;
            }

            // Add orientation-specific class
            const orientation = config.cinemaOrientation || 'auto';
            body.classList.add(`cinema-${orientation}`);

            // Force info container to be visible in cinema mode
            setTimeout(() => {
                infoContainer.classList.add('visible');
            }, 100);
        } else {
            // Cinema mode disabled: only reinitialize if we actually transitioned
            // from cinema (or wallart) to screensaver
            const wallartNow = !!config.wallartMode?.enabled;
            const wasCinema = lastCinemaEnabled === true;
            const wasWallart = !!window._lastWallartEnabled;
            if (!wallartNow && (wasCinema || wasWallart)) {
                setTimeout(() => {
                    reinitBackgroundForScreensaver();
                }, 50);
            }
        }
    }

    function applyWallartMode(config) {
        const body = document.body;

        const nextWallartEnabled = !!config.wallartMode?.enabled;
        window._lastWallartEnabled = nextWallartEnabled;
        if (nextWallartEnabled) {
            // Check if wallart mode is already active BEFORE removing the class
            const isAlreadyActive = body.classList.contains('wallart-mode');
            // Detect changes that require a restart of the wallart grid
            const prev = window._lastWallartConfig || {};
            const curr = config.wallartMode || {};
            const variantChanged = prev.layoutVariant !== curr.layoutVariant;
            const densityChanged = prev.density !== curr.density;
            const animChanged =
                (prev.animationType || prev.animationPack) !==
                (curr.animationType || curr.animationPack);
            const ambientChanged = !!prev.ambientGradient !== !!curr.ambientGradient;
            const layoutSettingsChanged =
                JSON.stringify(prev.layoutSettings || {}) !==
                JSON.stringify(curr.layoutSettings || {});
            const refreshChanged =
                (prev.refreshRate || prev.randomness) !== (curr.refreshRate || curr.randomness);
            const needsRestart =
                isAlreadyActive &&
                (variantChanged ||
                    densityChanged ||
                    animChanged ||
                    ambientChanged ||
                    layoutSettingsChanged ||
                    refreshChanged);

            if (needsRestart) {
                // Clear timers
                if (wallartTransitionTimer) {
                    clearInterval(wallartTransitionTimer);
                    wallartTransitionTimer = null;
                }
                if (window.wallartIndividualTimer) {
                    clearInterval(window.wallartIndividualTimer);
                    window.wallartIndividualTimer = null;
                }
                if (wallartRefreshTimeout) {
                    clearTimeout(wallartRefreshTimeout);
                    wallartRefreshTimeout = null;
                }
                if (window.wallartHeroTimer) {
                    clearInterval(window.wallartHeroTimer);
                    window.wallartHeroTimer = null;
                }
                if (wallartAmbientTweenTimer) {
                    clearInterval(wallartAmbientTweenTimer);
                    wallartAmbientTweenTimer = null;
                }
                // Remove existing grid and ambient overlay
                const wallartGrid = document.getElementById('wallart-grid');
                if (wallartGrid) wallartGrid.remove();
                const ambient = document.getElementById('wallart-ambient-overlay');
                if (ambient) ambient.remove();
                // Restart cycle with new settings without toggling body classes
                startWallartCycle(curr);
                window._lastWallartConfig = { ...curr };
                return;
            }

            // Add wallart mode class to body
            body.classList.add('wallart-mode');

            const elementsToHide = [
                'clock-widget-container',
                'clearlogo-container',
                'info-container',
                'controls-container',
                'branding-container',
                'poster-wrapper',
                'background-image',
                'loader',
                'layer-a',
                'layer-b',
            ];

            // Only hide promo-box if NOT on promo site
            if (!document.body.classList.contains('promo-site')) {
                elementsToHide.push('promo-box');
            }

            elementsToHide.forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    element.style.display = 'none';
                }
            });

            // Remove cinema mode if active (mutual exclusivity)
            body.classList.remove(
                'cinema-mode',
                'cinema-auto',
                'cinema-portrait',
                'cinema-portrait-flipped'
            );

            // Stop the normal slideshow timer (wallart has its own system)
            if (timerId) {
                clearInterval(timerId);
                timerId = null;
            }

            // Force info container to be hidden in wallart mode
            setTimeout(() => {
                infoContainer.classList.remove('visible');
            }, 100);

            // Set document title to Posterrama for wallart mode
            updateDocumentTitle(null);

            // Start a timer to ensure title stays as "Posterrama" in wallart mode
            if (wallartTitleTimer) {
                clearInterval(wallartTitleTimer);
            }
            wallartTitleTimer = setInterval(() => {
                if (
                    document.body.classList.contains('wallart-mode') &&
                    document.title !== 'Posterrama'
                ) {
                    // console.log removed for cleaner browser console
                    document.title = 'Posterrama';
                }
            }, 1000); // Check every second

            // Start the new wallart cycle system. In preview, if wallart was just enabled
            // and the current media list was capped at 12 (from screensaver preview),
            // fetch the full list first so the grid can populate properly.
            const shouldPrefetchFullList =
                typeof window !== 'undefined' &&
                window.IS_PREVIEW &&
                !isAlreadyActive &&
                Array.isArray(mediaQueue) &&
                mediaQueue.length > 0 &&
                mediaQueue.length <= 12;

            if (shouldPrefetchFullList) {
                try {
                    fetchMedia(false)
                        .catch(() => {
                            // Preview prefetch failed; grid will start with current list
                        })
                        .finally(() => {
                            try {
                                startWallartCycle(config.wallartMode);
                                window._lastWallartConfig = { ...config.wallartMode };
                            } catch (_) {
                                // Failed to start wallart cycle after prefetch; ignore
                            }
                        });
                } catch (_) {
                    // Fallback to immediate start if fetch throws synchronously
                    startWallartCycle(config.wallartMode);
                    window._lastWallartConfig = { ...config.wallartMode };
                }
            } else {
                startWallartCycle(config.wallartMode);
                window._lastWallartConfig = { ...config.wallartMode };
            }

            // Spotlight removed

            // Add resize listener for dynamic grid recalculation
            if (!window.wallartResizeListener) {
                window.wallartResizeListener = function () {
                    if (body.classList.contains('wallart-mode')) {
                        // Debounce resize events
                        clearTimeout(window.wallartResizeTimer);
                        window.wallartResizeTimer = setTimeout(() => {
                            startWallartCycle(config.wallartMode);
                        }, 300);
                    }
                };
                window.addEventListener('resize', window.wallartResizeListener);
            }
        } else {
            // Remove wallart mode classes and cleanup when disabled
            body.classList.remove('wallart-mode');

            // Clean up wallart resize listener when leaving wallart mode
            if (window.wallartResizeListener) {
                window.removeEventListener('resize', window.wallartResizeListener);
                window.wallartResizeListener = null;
            }

            // Clean up wallart grid if disabled
            if (wallartTransitionTimer) {
                clearInterval(wallartTransitionTimer);
                wallartTransitionTimer = null;
            }

            if (window.wallartIndividualTimer) {
                clearInterval(window.wallartIndividualTimer);
                window.wallartIndividualTimer = null;
            }

            if (wallartRefreshTimeout) {
                clearTimeout(wallartRefreshTimeout);
                wallartRefreshTimeout = null;
            }

            // Clear hero rotation timer if active
            if (window.wallartHeroTimer) {
                clearInterval(window.wallartHeroTimer);
                window.wallartHeroTimer = null;
            }

            // Clear ambient timers only (spotlight removed)
            if (wallartAmbientTweenTimer) {
                clearInterval(wallartAmbientTweenTimer);
                wallartAmbientTweenTimer = null;
            }

            // Clear wallart title timer
            if (wallartTitleTimer) {
                clearInterval(wallartTitleTimer);
                wallartTitleTimer = null;
            }

            const wallartGrid = document.getElementById('wallart-grid');
            if (wallartGrid) {
                wallartGrid.remove();
            }

            // Remove ambient overlay if present
            const ambient = document.getElementById('wallart-ambient-overlay');
            if (ambient) ambient.remove();

            // Remove resize listener
            if (window.wallartResizeListener) {
                window.removeEventListener('resize', window.wallartResizeListener);
                window.wallartResizeListener = null;
            }

            // Reset wallart initialization flag
            wallartInitializing = false;

            // Restore all hidden elements
            const elementsToShow = [
                'layer-a',
                'layer-b',
                'widget-container',
                'clearlogo-container',
                'info-container',
                'controls-container',
                'branding-container',
                'poster-wrapper',
                'background-image',
            ];

            // Handle promo-box separately for promo sites
            if (!document.body.classList.contains('promo-site')) {
                elementsToShow.push('promo-box');
            } else {
                // Ensure promo box stays visible on promo site
                const promoBox = document.getElementById('promo-box');
                if (promoBox) {
                    promoBox.style.display = 'block';
                }
            }

            elementsToShow.forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    element.style.display = '';
                }
            });

            // Re-apply clock visibility immediately after wallart is disabled
            try {
                const widgetContainer = document.getElementById('clock-widget-container');
                const shouldShowClock = appConfig.clockWidget && !appConfig.cinemaMode;
                if (widgetContainer) {
                    widgetContainer.style.display = shouldShowClock ? 'block' : 'none';
                    if (shouldShowClock) {
                        updateClock();
                        if (!document.clockUpdateInterval) {
                            document.clockUpdateInterval = setInterval(updateClock, 1000);
                        }
                    }
                }
            } catch (_) {
                // ignore
            }

            // Restore document title to current media when exiting wallart mode
            if (
                mediaQueue &&
                Array.isArray(mediaQueue) &&
                currentIndex >= 0 &&
                currentIndex < mediaQueue.length
            ) {
                const currentMedia = mediaQueue[currentIndex];
                if (currentMedia) {
                    updateDocumentTitle(currentMedia);
                }
            } else {
                updateDocumentTitle(null);
            }

            // Restart the normal slideshow timer when exiting wallart mode
            if (appConfig.transitionIntervalSeconds > 0) {
                startTimer();
            }

            // Reset background layers shortly after leaving wallart
            setTimeout(() => {
                reinitBackgroundForScreensaver();
            }, 50);
        }
    }

    function calculateWallartLayout(density = 'medium') {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const isPortrait = screenHeight > screenWidth;
        const isMobile = screenWidth <= 768; // Mobile breakpoint
        const isPromoSite = document.body.classList.contains('promo-site');

        // Standard movie poster aspect ratio - NEVER change this!
        const posterAspectRatio = 2 / 3; // width/height

        // Adjust available screen height for promo site when promo box is visible
        let availableHeight = screenHeight;
        if (isPromoSite) {
            const promoBox = document.getElementById('promo-box');
            if (promoBox && !document.body.classList.contains('wallart-mode')) {
                // Account for promo box height when calculating layout
                const promoBoxHeight = promoBox.offsetHeight || 120; // fallback height
                availableHeight = screenHeight - promoBoxHeight * 0.8; // Give some margin
            }
        }

        // Optimize for both desktop and mobile with different density factors
        let densityFactors;

        if (isMobile || isPortrait) {
            // Mobile/Portrait: smaller posters to fit more on screen
            densityFactors = {
                low: 0.25, // Posters take ~25% of screen width each (4 across)
                medium: 0.2, // Posters take ~20% of screen width each (5 across)
                high: 0.167, // Posters take ~16.7% of screen width each (6 across)
                ludicrous: 0.1, // ~10% of screen width each (~10 across)
            };
        } else {
            // Desktop/Landscape: original density factors
            densityFactors = {
                low: 0.15, // Posters take ~15% of screen width each
                medium: 0.12, // Posters take ~12% of screen width each
                high: 0.09, // Posters take ~9% of screen width each
                ludicrous: 0.06, // ~6% of screen width each (about 200% of medium)
            };
        }

        const densityFactor = densityFactors[density] || densityFactors['medium'];

        // Calculate optimal poster width based on screen width and density
        const optimalPosterWidth = Math.round(screenWidth * densityFactor);
        const optimalPosterHeight = Math.round(optimalPosterWidth / posterAspectRatio);

        // Calculate how many posters fit
        const cols = Math.floor(screenWidth / optimalPosterWidth);
        const rows = Math.floor(availableHeight / optimalPosterHeight);

        // Now optimize: stretch posters slightly to minimize black space
        // while maintaining aspect ratio
        const actualPosterWidth = Math.floor(screenWidth / cols);
        const actualPosterHeight = Math.round(actualPosterWidth / posterAspectRatio);

        // Check if we can fit the calculated height
        let finalRows = rows;
        let finalPosterHeight = actualPosterHeight;
        let finalPosterWidth = actualPosterWidth;

        const calculatedGridHeight = rows * actualPosterHeight;
        const remainingHeight = availableHeight - calculatedGridHeight;

        // If remaining height is significant, try different approaches
        if (remainingHeight > actualPosterHeight * 0.4) {
            // Try adding one more row
            const newRows = rows + 1;
            const heightPerRow = Math.floor(availableHeight / newRows);
            const widthForHeight = Math.round(heightPerRow * posterAspectRatio);

            if (widthForHeight * cols <= screenWidth) {
                // Height-constrained layout works
                finalRows = newRows;
                finalPosterHeight = heightPerRow;
                finalPosterWidth = widthForHeight;
            } else {
                // Width-constrained layout with stretched height
                finalPosterHeight = Math.floor(availableHeight / rows);
                finalPosterWidth = Math.round(finalPosterHeight * posterAspectRatio);

                // Ensure we don't exceed screen width
                if (finalPosterWidth * cols > screenWidth) {
                    finalPosterWidth = Math.floor(screenWidth / cols);
                    finalPosterHeight = Math.round(finalPosterWidth / posterAspectRatio);
                }
            }
        } else if (remainingHeight < 0) {
            // Grid is too tall, reduce height
            finalPosterHeight = Math.floor(availableHeight / rows);
            finalPosterWidth = Math.round(finalPosterHeight * posterAspectRatio);
        }

        // Final grid dimensions
        const gridWidth = cols * finalPosterWidth;
        const gridHeight = finalRows * finalPosterHeight;

        // Center the grid with minimal black bars
        // For portrait mode, try to fill full width if possible
        let gridLeft = Math.round((screenWidth - gridWidth) / 2);
        let gridTop = Math.round((availableHeight - gridHeight) / 2);

        // On promo sites, adjust top position to account for any space taken by promo elements
        if (isPromoSite) {
            const topOffset = (screenHeight - availableHeight) / 2;
            gridTop = Math.round(topOffset + (availableHeight - gridHeight) / 2);
        }

        // If in portrait mode and there's significant unused width, recalculate
        if (isPortrait && gridLeft > finalPosterWidth * 0.5) {
            // Recalculate to use full width
            const newPosterWidth = Math.floor(screenWidth / cols);
            const newPosterHeight = Math.round(newPosterWidth / posterAspectRatio);

            // Check if new height fits
            if (newPosterHeight * finalRows <= availableHeight) {
                finalPosterWidth = newPosterWidth;
                finalPosterHeight = newPosterHeight;
                gridLeft = 0; // Use full width
                gridTop = Math.round((availableHeight - newPosterHeight * finalRows) / 2);

                // Adjust for promo site again if needed
                if (isPromoSite) {
                    const topOffset = (screenHeight - availableHeight) / 2;
                    gridTop = Math.round(
                        topOffset + (availableHeight - newPosterHeight * finalRows) / 2
                    );
                }
            }
        }

        const posterCount = cols * finalRows;
        const bufferedCount = Math.ceil(posterCount * 1.5);

        // Calculate coverage percentage
        const coverage = ((gridWidth * gridHeight) / (screenWidth * availableHeight)) * 100;

        logger.debug(
            `Wallart Layout: ${cols}x${finalRows} = ${posterCount} posters, ${Math.round(coverage)}% coverage, ${finalPosterWidth}x${finalPosterHeight}px each`
        );

        return {
            minPosterWidth: finalPosterWidth,
            posterCount: posterCount,
            totalNeeded: bufferedCount,
            columns: cols,
            rows: finalRows,
            actualPosterWidth: finalPosterWidth,
            actualPosterHeight: finalPosterHeight,
            gridTop: gridTop,
            gridLeft: gridLeft,
            totalGridHeight: gridHeight,
            coverage: Math.round(coverage),
            shiftDistance: finalPosterHeight,
        };
    }

    function createLoadingGrid(_message = 'Loading posters...') {
        // Show the global centered spinner instead of textual loading message
        try {
            const loaderEl = document.getElementById('loader');
            if (loaderEl) {
                loaderEl.style.display = 'flex';
                loaderEl.style.opacity = '1';
            }
        } catch (e) {
            /* ignore: loader element not found */
        }

        // Ensure no stray loading grid with text remains
        const existingGrid = document.getElementById('wallart-grid');
        if (existingGrid && existingGrid.parentNode) {
            existingGrid.remove();
        }
    }

    function startWallartCycle(wallartConfig) {
        // Persist current config globally for helpers that read it
        try {
            window.wallartConfig = { ...(wallartConfig || {}) };
        } catch (_) {
            // ignore
        }
        // Remove existing wallart grid if it exists
        const existingGrid = document.getElementById('wallart-grid');
        if (existingGrid) {
            existingGrid.remove();
        }

        // Check if media is available
        if (mediaQueue.length === 0) {
            // Prevent multiple simultaneous initialization attempts
            if (wallartInitializing) {
                return;
            }

            wallartInitializing = true;
            // console.log removed for cleaner browser console

            // Try to fetch media first, then restart wallart cycle
            fetchMedia(true)
                .then(() => {
                    wallartInitializing = false;
                    if (mediaQueue.length > 0) {
                        logger.debug(
                            '[WALLART] Media fetched successfully, restarting wallart cycle...'
                        );
                        startWallartCycle(wallartConfig);
                    } else {
                        logger.debug(
                            '[WALLART] Still no media after fetch, showing loading message...'
                        );
                        // Show spinner overlay while waiting and retry after delay
                        createLoadingGrid('Loading posters...');
                        setTimeout(() => {
                            // console.log removed for cleaner browser console
                            startWallartCycle(wallartConfig);
                        }, 3000);
                    }
                })
                .catch(error => {
                    wallartInitializing = false;
                    console.error('[WALLART] Failed to fetch media:', error);
                    // Show spinner overlay while retrying after an error
                    createLoadingGrid('Failed to load posters. Retrying...');
                    // Retry after error
                    setTimeout(() => {
                        // console.log removed for cleaner browser console
                        startWallartCycle(wallartConfig);
                    }, 5000);
                });
            return;
        }

        // Create ambient overlay (optional)
        if (wallartConfig.ambientGradient) {
            ensureAmbientOverlay();
        }

        // Create wallart grid container
        const wallartGrid = document.createElement('div');
        wallartGrid.id = 'wallart-grid';
        wallartGrid.className = 'wallart-grid';

        // Calculate dynamic grid based on screen size and density
        const layoutInfo = calculateWallartLayout(wallartConfig.density);
        const layoutVariant = wallartConfig.layoutVariant || 'classic';
        const layoutSettings = wallartConfig.layoutSettings || {};

        // Apply dynamic grid styles with proper centering
        wallartGrid.style.cssText = `
            position: fixed !important;
            width: ${layoutInfo.columns * layoutInfo.actualPosterWidth}px !important;
            height: ${layoutInfo.totalGridHeight}px !important;
            z-index: 999999 !important;
            background: transparent !important;
            display: grid !important;
            grid-template-columns: repeat(${layoutInfo.columns}, ${layoutInfo.actualPosterWidth}px) !important;
            grid-template-rows: repeat(${layoutInfo.rows}, ${layoutInfo.actualPosterHeight}px) !important;
            gap: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            overflow: visible !important;
            opacity: 1 !important;
            align-content: start !important;
        `;

        // Set initial position with transform (this allows for smooth shifting)
        wallartGrid.style.transform = `translate(${layoutInfo.gridLeft}px, ${layoutInfo.gridTop}px)`;

        // Store calculated values for use in update cycle
        wallartGrid.dataset.minPosterWidth = layoutInfo.minPosterWidth;
        wallartGrid.dataset.posterCount = layoutInfo.posterCount;
        wallartGrid.dataset.totalNeeded = layoutInfo.totalNeeded;
        wallartGrid.dataset.columns = layoutInfo.columns;
        wallartGrid.dataset.rows = layoutInfo.rows;

        // Append directly to body
        document.body.appendChild(wallartGrid);

        // Initialize variables that will be used by initializeWallartGrid
        let currentPosters = []; // Track current posters for uniqueness
        const usedPosters = new Set(); // Track used poster IDs

        // Get dynamically calculated poster count - robust check for mediaQueue
        const posterCount = Math.min(layoutInfo.posterCount, mediaQueue?.length || 0);

        // Early exit if no media available
        if (posterCount === 0) {
            console.warn('[Wallart] No media available for wallart mode');
            return;
        }

        const animationType = wallartConfig.animationType || wallartConfig.animationPack || 'fade';

        // Initialize the grid with posters
        initializeWallartGrid(posterCount);

        // Get refresh rate and randomness settings separately
        const refreshRate = wallartConfig.refreshRate || wallartConfig.randomness || 5; // Use refreshRate, fallback to old randomness for compatibility
        const randomness = wallartConfig.randomness || 0; // Keep for randomness amount

        // Calculate base refresh interval from refresh rate (1=slow, 10=fast)
        const baseInterval = 25000; // 25 seconds base for slowest
        const minInterval = 2000; // 2 seconds minimum for fastest
        const refreshInterval = Math.max(minInterval, baseInterval - (refreshRate - 1) * 2555);

        // Calculate random variation based on both refresh rate and randomness setting
        // Key insight: faster refresh rates allow less variation to prevent chaos
        // Slower refresh rates can handle more variation
        let maxRandomVariation = 0;
        if (randomness > 0) {
            // Base variation scales with refresh interval (slower = more variation possible)
            const baseVariation = refreshInterval * 0.4; // 40% of refresh interval as base
            // Apply randomness multiplier (0-10 scale)
            const randomnessMultiplier = randomness / 10;
            maxRandomVariation = Math.round(baseVariation * randomnessMultiplier);
        }

        function createPosterElement(item, index) {
            const posterItem = document.createElement('div');
            posterItem.className = 'wallart-poster-item';
            posterItem.dataset.originalIndex = index;
            posterItem.dataset.posterId = item.id || item.title || index;

            // Mobile detection for optimized styling
            const isMobile =
                window.innerWidth <= 768 || /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);

            // Use grid cell dimensions but preserve poster proportions with object-fit
            posterItem.style.cssText = `
                background: #000;
                overflow: hidden;
                opacity: 1;
                display: block;
                width: 100%;
                height: 100%;
                position: relative;
                ${isMobile ? 'will-change: opacity;' : ''}
            `;

            const img = document.createElement('img');
            // Use custom lazy loading for better control
            if (item.posterUrl && window.makeLazy) {
                window.makeLazy(img, item.posterUrl);
            } else {
                img.src = item.posterUrl || transparentPixel;
            }
            img.alt = item.title || 'Movie Poster';

            // Always show full poster at 2:3 with letterboxing (no crop)
            img.style.cssText = `
                width: 100%;
                height: 100%;
                object-fit: contain;
                object-position: center;
                display: block;
                transform: none;
                background: #000;
                ${isMobile ? 'will-change: opacity;' : ''}
            `;

            posterItem.appendChild(img);
            return posterItem;
        }

        // Initialize shift offset for tracking
        if (!window.wallartShiftOffset) {
            window.wallartShiftOffset = 0;
        }

        // Special shift animation function that permanently moves posters
        function performShiftAnimation(animationType, _triggerItem, _triggerElement) {
            const wallartGrid = document.getElementById('wallart-grid');

            // Check if we're in wallart mode by looking at body class
            const isWallartMode = document.body && document.body.classList.contains('wallart-mode');

            if (!wallartGrid || !isWallartMode) return;

            // Get current density from wallartConfig or default to 'medium'
            const currentDensity = window.wallartConfig?.density || 'medium';
            const layout = calculateWallartLayout(currentDensity);
            const { actualPosterHeight } = layout;

            // console.log removed for cleaner browser console

            if (animationType === 'shiftUp') {
                // Move up by one poster height
                window.wallartShiftOffset -= actualPosterHeight;
            } else if (animationType === 'shiftDown') {
                // Move down by one poster height
                window.wallartShiftOffset += actualPosterHeight;
            }

            // Apply the shift
            const newTop = layout.gridTop + window.wallartShiftOffset;
            wallartGrid.style.transform = `translate(${layout.gridLeft}px, ${newTop}px)`;

            // Cleanup of residual layers handled in per-tile animations
            // console.log removed for cleaner browser console
        }

        function getUniqueRandomPoster(excludePosterId = null) {
            // Robust check: ensure mediaQueue exists and is an array
            if (!mediaQueue || !Array.isArray(mediaQueue) || mediaQueue.length === 0) {
                console.warn('[Wallart] mediaQueue is empty or invalid, returning null');
                return null;
            }

            // Collect currently visible ids to avoid immediate repeats in grid
            const visibleIds = new Set();
            currentPosters.forEach(p => {
                if (!p) return;
                const id = p.id || p.title || p.posterUrl;
                if (id) visibleIds.add(id);
            });

            // Primary pool: exclude current, visible, and recently used
            let pool = mediaQueue.filter(item => {
                const id = item.id || item.title || item.posterUrl;
                if (!id) return false;
                if (excludePosterId && id === excludePosterId) return false;
                if (visibleIds.has(id)) return false;
                if (usedPosters.has(id)) return false;
                return true;
            });

            // Secondary: allow used but still avoid current and visible
            if (pool.length === 0) {
                pool = mediaQueue.filter(item => {
                    const id = item.id || item.title || item.posterUrl;
                    if (!id) return false;
                    if (excludePosterId && id === excludePosterId) return false;
                    if (visibleIds.has(id)) return false;
                    return true;
                });
            }

            // Tertiary: only exclude current
            if (pool.length === 0) {
                pool = mediaQueue.filter(item => {
                    const id = item.id || item.title || item.posterUrl;
                    if (!id) return false;
                    if (excludePosterId && id === excludePosterId) return false;
                    return true;
                });
            }

            // Last resort: everything
            if (pool.length === 0) pool = mediaQueue.slice();

            const idx = Math.floor(Math.random() * pool.length);
            const selected = pool[idx];
            const selId = selected?.id || selected?.title || selected?.posterUrl;
            if (selId) usedPosters.add(selId);
            return selected || null;
        }

        function initializeWallartGrid(posterCount) {
            // Clear existing items
            wallartGrid.innerHTML = '';
            currentPosters = [];
            usedPosters.clear();

            // Recalculate layout based on actual poster count to use optimal space
            const optimalPosterCount = Math.min(posterCount, mediaQueue.length);
            let layoutInfo;

            if (optimalPosterCount < posterCount) {
                // Recalculate layout for fewer posters to maximize space usage

                // Calculate optimal columns and rows for available posters
                const screenWidth = window.innerWidth;
                const screenHeight = window.innerHeight;
                const posterAspectRatio = 2 / 3;

                // Try different column counts to find optimal layout
                let bestLayout = null;
                let bestCoverage = 0;

                for (let cols = 1; cols <= Math.min(optimalPosterCount, 15); cols++) {
                    const rows = Math.ceil(optimalPosterCount / cols);
                    const posterWidth = Math.floor(screenWidth / cols);
                    const posterHeight = Math.round(posterWidth / posterAspectRatio);

                    if (rows * posterHeight <= screenHeight) {
                        const coverage =
                            (cols * posterWidth * rows * posterHeight) /
                            (screenWidth * screenHeight);
                        if (coverage > bestCoverage) {
                            bestCoverage = coverage;
                            bestLayout = {
                                columns: cols,
                                rows: rows,
                                actualPosterWidth: posterWidth,
                                actualPosterHeight: posterHeight,
                                gridLeft: Math.round((screenWidth - cols * posterWidth) / 2),
                                gridTop: Math.round((screenHeight - rows * posterHeight) / 2),
                                posterCount: optimalPosterCount,
                            };
                        }
                    }
                }

                layoutInfo = bestLayout || calculateWallartLayout(wallartConfig.density);
            } else {
                layoutInfo = calculateWallartLayout(wallartConfig.density);
            }

            // Mobile detection for optimized grid CSS
            const isMobile =
                window.innerWidth <= 768 || /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);

            // Update CSS grid with proper centering and layout-variant aware sizing
            let gridCSS = '';
            let gridMeta = { columns: layoutInfo.columns, rows: layoutInfo.rows };
            {
                // Classic and HeroGrid share the same base grid cell sizing
                gridCSS = `
                    display: grid !important;
                    grid-template-columns: repeat(${layoutInfo.columns}, ${layoutInfo.actualPosterWidth}px) !important;
                    grid-template-rows: repeat(${layoutInfo.rows}, ${layoutInfo.actualPosterHeight}px) !important;
                    gap: 0 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    background: transparent !important;
                    width: ${layoutInfo.columns * layoutInfo.actualPosterWidth}px !important;
                    height: ${layoutInfo.rows * layoutInfo.actualPosterHeight}px !important;
                    position: fixed !important;
                    top: ${layoutInfo.gridTop}px !important;
                    left: ${layoutInfo.gridLeft}px !important;
                    z-index: 10000 !important;
                    overflow: visible !important;
                `;
                wallartGrid.dataset.columns = String(layoutInfo.columns);
                wallartGrid.dataset.rows = String(layoutInfo.rows);
                gridMeta = { columns: layoutInfo.columns, rows: layoutInfo.rows };
            }

            // Add mobile-specific optimizations
            if (isMobile) {
                gridCSS += `
                    will-change: auto !important;
                    transform: translateZ(0) !important;
                    -webkit-transform: translateZ(0) !important;
                    backface-visibility: hidden !important;
                    -webkit-backface-visibility: hidden !important;
                `;
            }

            wallartGrid.style.cssText = gridCSS;

            // Persist current grid dimensions for later use in refresh bursts
            // already set above per-variant

            // Check if we have enough media
            if (mediaQueue.length === 0) {
                // Show in-grid spinner (no text)
                const loadingItem = document.createElement('div');
                loadingItem.style.cssText = `
                    grid-column: 1 / -1 !important;
                    grid-row: 1 / -1 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                `;
                const spinner = document.createElement('div');
                spinner.className = 'poster-loader';
                loadingItem.appendChild(spinner);
                wallartGrid.appendChild(loadingItem);

                // Try to fetch media if not available
                // console.log removed for cleaner browser console
                fetchMedia(true)
                    .then(() => {
                        // After media is fetched, reinitialize the grid
                        if (mediaQueue.length > 0) {
                            initializeWallartGrid(layoutInfo.posterCount);
                        }
                    })
                    .catch(error => {
                        console.error('[WALLART] Failed to fetch media:', error);
                        loadingItem.textContent =
                            'Failed to load posters. Please refresh the page.';
                    });

                return;
            }

            // Fill grid with unique posters based on layout variant
            if (layoutVariant === 'heroGrid') {
                // Determine hero settings with sane clamps
                const heroCfg = layoutSettings.heroGrid || {};
                const rows = gridMeta.rows;
                const cols = gridMeta.columns;
                // Accept explicit 'left' or 'right'; default to left
                const rawHeroSideValue =
                    (heroCfg.heroSide || wallartConfig.heroSide || appConfig?.heroSide) ?? '';
                const rawHeroSide = rawHeroSideValue.toString().toLowerCase();
                const heroSide = rawHeroSide === 'right' ? 'right' : 'left';
                const heroRotValue =
                    heroCfg.heroRotationMinutes ??
                    wallartConfig.heroRotationMinutes ??
                    appConfig?.heroRotationMinutes;
                const heroRotationMinutes = Math.max(0, Number(heroRotValue) || 10);

                wallartGrid.dataset.layoutVariant = 'heroGrid';
                wallartGrid.dataset.heroGrid = 'true';
                wallartGrid.dataset.heroSide = heroSide;

                // Determine hero width to preserve 2:3 aspect fully visible
                // Base poster ratio is 2:3 (w:h). Our grid rows have fixed height.
                const baseCellW = layoutInfo.actualPosterWidth;
                const baseCellH = layoutInfo.actualPosterHeight;

                // Make hero poster exactly 16 small tiles (4x4)
                const portraitMode = window.innerHeight > window.innerWidth;
                let heroSpan;
                if (portraitMode) {
                    // In portrait mode: hero should be 4 tiles wide (16 tiles total = 4x4)
                    heroSpan = 4;
                    // Make sure we don't exceed available columns
                    heroSpan = Math.min(heroSpan, cols - 1);
                } else {
                    // Original landscape logic
                    const heroTargetW = Math.round((2 / 3) * (rows * baseCellH));
                    heroSpan = Math.max(1, Math.round(heroTargetW / baseCellW));
                    const minRemainingCols = Math.max(2, Math.ceil(cols * 0.25));
                    heroSpan = Math.min(heroSpan, cols - minRemainingCols);
                }

                // Ensure hero has a reasonable minimum width
                heroSpan = Math.max(2, heroSpan);
                // We'll make the hero tile span grid rows fully, and keep image object-fit: contain to ensure full poster visible inside

                // Clear any previous hero timer
                if (window.wallartHeroTimer) {
                    clearInterval(window.wallartHeroTimer);
                    window.wallartHeroTimer = null;
                }

                // OCCUPANCY GRID for playful quilt placement
                // Track occupied cells
                const occupied = Array.from({ length: rows }, () => Array(cols).fill(false));

                // Create hero poster first
                const firstHero = getUniqueRandomPoster();
                if (firstHero) {
                    currentPosters.push(firstHero);
                    const heroEl = createPosterElement(firstHero, 0);
                    // Position hero based on mode and orientation
                    const portraitMode = window.innerHeight > window.innerWidth;
                    const startCol = heroSide === 'left' ? 1 : cols - heroSpan + 1;

                    if (portraitMode) {
                        // In portrait mode: make hero exactly 4x4 tiles (16 total)
                        if (heroSide === 'left') {
                            // Hero spans 4 columns wide and 4 rows high
                            const heroHeight = 4; // 4 rows high
                            if (rows >= heroHeight + 2) {
                                // Enough rows: center the 4x4 hero with space above and below
                                const heroStartRow = Math.floor((rows - heroHeight) / 2) + 1; // Center it
                                const heroEndRow = heroStartRow + heroHeight;
                                heroEl.style.gridColumn = `${startCol} / span ${heroSpan}`;
                                heroEl.style.gridRow = `${heroStartRow} / ${heroEndRow}`;
                            } else if (rows >= heroHeight) {
                                // Just enough rows: hero takes exactly 4 rows
                                heroEl.style.gridColumn = `${startCol} / span ${heroSpan}`;
                                heroEl.style.gridRow = `1 / ${heroHeight + 1}`;
                            } else {
                                // Not enough rows: hero takes available height
                                heroEl.style.gridColumn = `${startCol} / span ${heroSpan}`;
                                heroEl.style.gridRow = `1 / -1`;
                            }
                        } else {
                            // Hero right: similar 4x4 approach
                            const heroHeight = 4;
                            heroEl.style.gridColumn = `${startCol} / span ${heroSpan}`;
                            if (rows >= heroHeight + 1) {
                                heroEl.style.gridRow = `1 / ${heroHeight + 1}`;
                            } else {
                                heroEl.style.gridRow = `1 / -1`;
                            }
                        }
                    } else {
                        // In landscape mode: hero spans full height as before
                        heroEl.style.gridColumn = `${startCol} / span ${heroSpan}`;
                        heroEl.style.gridRow = `1 / -1`;
                    }

                    heroEl.dataset.hero = 'true';

                    // Ensure full-poster visibility: object-fit contain, center, no crop.
                    const heroImg = heroEl.querySelector('img');
                    if (heroImg) {
                        heroImg.style.objectFit = 'contain';
                        heroImg.style.objectPosition = 'center';
                        heroImg.style.background = 'black';
                        // Remove the tiny scale used for grid tiles to avoid clipping
                        heroImg.style.transform = 'none';
                    }

                    // Initial subtle fade-in
                    heroEl.style.opacity = '0';
                    heroEl.style.transition = 'opacity 600ms ease';
                    setTimeout(() => (heroEl.style.opacity = '1'), 60);

                    wallartGrid.appendChild(heroEl);

                    // Mark hero area occupied - exactly 4x4 tiles (16 total)
                    const isPortraitOccupancy = window.innerHeight > window.innerWidth;

                    if (isPortraitOccupancy) {
                        // In portrait mode, mark exactly 4x4 hero area
                        if (heroSide === 'left') {
                            const heroHeight = 4;
                            let heroStartRow, heroEndRow;

                            if (rows >= heroHeight + 2) {
                                // Center the 4x4 hero
                                heroStartRow = Math.floor((rows - heroHeight) / 2);
                                heroEndRow = heroStartRow + heroHeight;
                            } else if (rows >= heroHeight) {
                                // Hero takes exactly 4 rows from top
                                heroStartRow = 0;
                                heroEndRow = heroHeight;
                            } else {
                                // Not enough rows: mark all available
                                heroStartRow = 0;
                                heroEndRow = rows;
                            }

                            for (let r = heroStartRow; r < heroEndRow; r++) {
                                for (let c = 0; c < heroSpan; c++) {
                                    const colIdx = (heroSide === 'left' ? 0 : cols - heroSpan) + c;
                                    occupied[r][colIdx] = true;
                                }
                            }
                        } else {
                            // Hero right: mark 4x4 area from top
                            const heroHeight = Math.min(4, rows);
                            for (let r = 0; r < heroHeight; r++) {
                                for (let c = 0; c < heroSpan; c++) {
                                    const colIdx = (heroSide === 'left' ? 0 : cols - heroSpan) + c;
                                    occupied[r][colIdx] = true;
                                }
                            }
                        }
                    } else {
                        // In landscape mode, mark entire hero area as before
                        for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < heroSpan; c++) {
                                const colIdx = (heroSide === 'left' ? 0 : cols - heroSpan) + c;
                                occupied[r][colIdx] = true;
                            }
                        }
                    }

                    // Setup periodic hero rotation (optional)
                    if (heroRotationMinutes > 0) {
                        const ms = heroRotationMinutes * 60 * 1000;
                        window.wallartHeroTimer = setInterval(() => {
                            const currentHero = currentPosters[0];
                            const excludeId = currentHero
                                ? currentHero.id || currentHero.title || currentHero.posterUrl
                                : null;
                            const next = getUniqueRandomPoster(excludeId);
                            if (!next) return;
                            currentPosters[0] = next;
                            animatePosterChange(heroEl, next, 'fade');
                        }, ms);
                    }
                }

                // Playful quilt: fill remaining grid with a mix of 1x1 and 2x2 tiles
                const placeTile = (r, c, hSpan, wSpan, poster, orderIndex) => {
                    const el = createPosterElement(poster, orderIndex);
                    el.style.gridRow = `${r + 1} / span ${hSpan}`;
                    el.style.gridColumn = `${c + 1} / span ${wSpan}`;

                    // Entry animation: light stagger based on position
                    el.style.opacity = '0';
                    el.style.transform = 'scale(0.96)';
                    el.style.transition = 'opacity 520ms ease, transform 600ms ease';
                    const delay = r * 70 + c * 55 + Math.floor(Math.random() * 50);
                    setTimeout(() => {
                        el.style.opacity = '1';
                        el.style.transform = 'scale(1)';
                    }, delay);
                    wallartGrid.appendChild(el);
                };

                // Strategy: tiers using only 2x2 and 1x1 cells (both maintain 2/3 ratio inside each cell)
                // - a few 2x2 tiles (medium)
                // - fill the rest with 1x1 (tiny)
                let counter = 0;

                // Helper: shuffle array
                const shuffle = arr => arr.sort(() => Math.random() - 0.5);
                const canPlace = (r, c, h, w) => {
                    if (r + h > rows || c + w > cols) return false;
                    for (let rr = 0; rr < h; rr++) {
                        for (let cc = 0; cc < w; cc++) {
                            if (occupied[r + rr][c + cc]) return false;
                        }
                    }
                    return true;
                };
                const mark = (r, c, h, w) => {
                    for (let rr = 0; rr < h; rr++) {
                        for (let cc = 0; cc < w; cc++) {
                            occupied[r + rr][c + cc] = true;
                        }
                    }
                };

                // Ensure 4 large tiles total visible (1 hero + 3 medium 2x2). If grid too small, use 2 medium.
                const heroArea = heroSpan * rows;
                const areaCells = Math.max(0, cols * rows - heroArea);
                // Default aim: 3 mediums; if area is very constrained, fall back to 2
                let targetMedium = 3;
                // If the remaining area can't reasonably fit 3 mediums plus a few singles, drop to 2
                const minCellsForThree = 3 * 4 + Math.max(2, Math.floor(areaCells * 0.1));
                if (areaCells < minCellsForThree) targetMedium = 2;

                // Place 2x2 mediums
                const mediumCandidates = [];
                for (let r = 0; r < rows - 1; r++) {
                    for (let c = 0; c < cols - 1; c++) mediumCandidates.push({ r, c });
                }
                shuffle(mediumCandidates);
                let placedMedium = 0;
                for (const { r, c } of mediumCandidates) {
                    if (placedMedium >= targetMedium) break;
                    if (!canPlace(r, c, 2, 2)) continue;
                    const poster = getUniqueRandomPoster();
                    if (!poster) continue;
                    currentPosters.push(poster);
                    placeTile(r, c, 2, 2, poster, ++counter);
                    mark(r, c, 2, 2);
                    placedMedium++;
                }

                // If we couldn't place enough mediums due to occupancy constraints, try scanning again
                if (placedMedium < targetMedium) {
                    const additionalCandidates = [];
                    for (let r = 0; r < rows - 1; r++) {
                        for (let c = 0; c < cols - 1; c++) additionalCandidates.push({ r, c });
                    }
                    shuffle(additionalCandidates);
                    for (const { r, c } of additionalCandidates) {
                        if (placedMedium >= targetMedium) break;
                        if (!canPlace(r, c, 2, 2)) continue;
                        const poster = getUniqueRandomPoster();
                        if (!poster) continue;
                        currentPosters.push(poster);
                        placeTile(r, c, 2, 2, poster, ++counter);
                        mark(r, c, 2, 2);
                        placedMedium++;
                    }
                }

                // Fill remainder with 1x1
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        if (occupied[r][c]) continue;
                        const poster = getUniqueRandomPoster();
                        if (!poster) continue;
                        currentPosters.push(poster);
                        placeTile(r, c, 1, 1, poster, ++counter);
                        occupied[r][c] = true;
                    }
                }
            } else {
                wallartGrid.dataset.layoutVariant = 'classic';
                // classic
                for (let i = 0; i < posterCount; i++) {
                    const poster = getUniqueRandomPoster();
                    if (poster) {
                        currentPosters.push(poster);
                        const posterItem = createPosterElement(poster, i);

                        // Animatie: staggered/ripple/scanline reveal (initial grid)
                        // Prefer explicit animationType from admin if it's a pack-style option
                        const pack = (
                            wallartConfig.animationPack ||
                            (['staggered', 'ripple', 'scanline'].includes(
                                (wallartConfig.animationType || '').toLowerCase()
                            )
                                ? wallartConfig.animationType
                                : null) ||
                            'staggered'
                        ).toLowerCase();
                        if (pack === 'staggered') {
                            posterItem.style.opacity = '0';
                            posterItem.style.transform = 'scale(0.96)';
                            posterItem.style.transition =
                                'opacity 500ms ease, transform 600ms ease';
                            const delay =
                                (i % layoutInfo.columns) * 60 +
                                Math.floor(i / layoutInfo.columns) * 40;
                            setTimeout(() => {
                                posterItem.style.opacity = '1';
                                posterItem.style.transform = 'scale(1)';
                            }, delay);
                        } else if (pack === 'ripple') {
                            // Compute distance from center for ripple delay
                            const col = i % layoutInfo.columns;
                            const row = Math.floor(i / layoutInfo.columns);
                            const cx = (layoutInfo.columns - 1) / 2;
                            const cy = (layoutInfo.rows - 1) / 2;
                            const dist = Math.hypot(col - cx, row - cy);
                            const delay = Math.round(dist * 90);
                            posterItem.style.opacity = '0';
                            posterItem.style.transform = 'scale(0.94)';
                            posterItem.style.transition =
                                'opacity 520ms ease, transform 620ms ease';
                            setTimeout(() => {
                                posterItem.style.opacity = '1';
                                posterItem.style.transform = 'scale(1)';
                            }, delay);
                        } else if (pack === 'scanline') {
                            // Reveal row-by-row with a gentle left->right cascade
                            const col = i % layoutInfo.columns;
                            const row = Math.floor(i / layoutInfo.columns);
                            posterItem.style.opacity = '0';
                            posterItem.style.transform = 'translateY(8px)';
                            posterItem.style.transition =
                                'opacity 420ms ease-out, transform 460ms ease-out';
                            const delay = row * 90 + col * 35 + Math.floor(Math.random() * 30);
                            setTimeout(() => {
                                posterItem.style.opacity = '1';
                                posterItem.style.transform = 'translateY(0)';
                            }, delay);
                        } else {
                            // fallback: simple fade-in
                            posterItem.style.animationDelay = `${i * 0.02}s`;
                            posterItem.style.animation = 'wallartFadeIn 0.6s ease-out forwards';
                        }

                        wallartGrid.appendChild(posterItem);
                    } else {
                        break; // Stop if no unique posters are available
                    }
                }
            }

            // After initial render, apply ambient colors and optionally spotlight
            if (wallartConfig.ambientGradient) {
                try {
                    // If heroGrid is active, prefer sampling from the hero area subtly
                    const isHero = wallartGrid?.dataset?.heroGrid === 'true';
                    if (isHero) {
                        const heroEl = wallartGrid.querySelector('[data-hero="true"] img');
                        if (heroEl) {
                            updateAmbientFromImage(heroEl);
                        } else {
                            updateAmbientFromGrid(wallartGrid);
                        }
                    } else {
                        updateAmbientFromGrid(wallartGrid);
                    }
                } catch (e) {
                    // noop: ambient overlay update can fail if images not ready
                }
            }
            // Spotlight removed
        }

        window.refreshSinglePoster = function refreshSinglePoster() {
            if (currentPosters.length === 0 || mediaQueue.length === 0) {
                return;
            }

            // If the selected animation is a pack-style (staggered/ripple/scanline), run a short burst each cycle
            const packType = (animationType || '').toLowerCase();
            if (packType === 'staggered' || packType === 'ripple' || packType === 'scanline') {
                // Helper to safely parse grid info
                const wallartGrid = document.getElementById('wallart-grid');
                let cols = parseInt(wallartGrid?.dataset?.columns || '0', 10);
                let rows = parseInt(wallartGrid?.dataset?.rows || '0', 10);
                if (!cols || !rows) {
                    // Fallback to calculated layout
                    const layout = calculateWallartLayout(wallartConfig.density);
                    cols = layout.columns;
                    rows = layout.rows;
                }

                const total = currentPosters.length;
                const tileEls = wallartGrid?.querySelectorAll('.wallart-poster-item') || [];
                if (!wallartGrid || tileEls.length === 0) return;

                // Decide burst size based on grid size and refresh rate
                const rr = wallartConfig.refreshRate || wallartConfig.randomness || 5;
                const base = 4 + Math.round(rr / 3); // 4..7
                let burstSize = Math.min(Math.max(base, Math.ceil(total * 0.06)), 12); // clamp 6%..12 items
                burstSize = Math.max(3, Math.min(burstSize, total));

                // Build list of candidate indices
                let indices = Array.from({ length: total }, (_, i) => i);
                // Exclude hero tile in heroGrid layout
                if (wallartGrid?.dataset?.heroGrid === 'true') {
                    indices = indices.filter(i => {
                        const el = tileEls[i];
                        return !(el && el.dataset && el.dataset.hero === 'true');
                    });
                }

                // Compute ordering and delays
                let ordered = [];
                const delays = new Map();
                // Cooldown: avoid hitting the same indices repeatedly across bursts
                const cooldownSets = Array.isArray(window._wallartRecentUpdates)
                    ? window._wallartRecentUpdates
                    : [];
                const cooldown = new Set();
                try {
                    for (const s of cooldownSets) {
                        if (s && typeof s.forEach === 'function') s.forEach(i => cooldown.add(i));
                    }
                } catch (_) {
                    /* noop */
                }

                if (packType === 'staggered') {
                    // Group tiles by diagonal (row + col)
                    const withDiag = indices.map(i => ({
                        i,
                        row: Math.floor(i / cols),
                        col: i % cols,
                        diag: Math.floor(i / cols) + (i % cols),
                    }));

                    const byDiag = new Map();
                    for (const item of withDiag) {
                        if (!byDiag.has(item.diag)) byDiag.set(item.diag, []);
                        byDiag.get(item.diag).push(item);
                    }

                    // Diagonal order: alternate direction per burst for variety
                    window._wallartDiagFlip = !window._wallartDiagFlip;
                    let diags = Array.from(byDiag.keys()).sort((a, b) => a - b);
                    if (window._wallartDiagFlip) diags.reverse();
                    // Random start offset to avoid favoring top-left
                    const startOffset = Math.floor(Math.random() * diags.length);
                    diags = diags.slice(startOffset).concat(diags.slice(0, startOffset));

                    // Quota per diagonal to avoid many updates in a single row/diag
                    const diagQuota = total >= 60 ? 2 : 1;
                    const picked = [];
                    for (const d of diags) {
                        const group = byDiag.get(d) || [];
                        // Shuffle within diagonal for variety
                        group.sort(() => Math.random() - 0.5);
                        for (let k = 0; k < Math.min(diagQuota, group.length); k++) {
                            picked.push(group[k]);
                            if (picked.length >= burstSize) break;
                        }
                        if (picked.length >= burstSize) break;
                    }

                    const chosen = picked.map(p => p.i);
                    // Apply cooldown filter; if too few remain, fill back from the original picked order
                    const filtered = chosen.filter(i => !cooldown.has(i));
                    if (filtered.length >= Math.max(3, Math.floor(burstSize * 0.7))) {
                        ordered = filtered.slice(0, burstSize);
                    } else {
                        ordered = filtered
                            .concat(chosen.filter(i => !filtered.includes(i)))
                            .slice(0, burstSize);
                    }

                    // Assign delays based on diagonal with jitter and checkerboard offset
                    for (const i of ordered) {
                        const r = Math.floor(i / cols);
                        const c = i % cols;
                        const diag = r + c;
                        const jitter = Math.floor(Math.random() * 90);
                        const checker = ((r + c) % 2) * 25;
                        delays.set(i, diag * 80 + jitter + checker);
                    }
                } else if (packType === 'ripple') {
                    // Ripple: choose a random origin inside the grid
                    const originIndex = Math.floor(Math.random() * total);
                    const oc = originIndex % cols;
                    const orow = Math.floor(originIndex / cols);

                    // Compute distance and ring for all tiles
                    const withDistance = indices.map(i => {
                        const row = Math.floor(i / cols);
                        const col = i % cols;
                        const dist = Math.hypot(col - oc, row - orow);
                        const ring = Math.max(0, Math.floor(dist)); // integer rings from origin
                        return { i, row, col, dist, ring };
                    });

                    // Determine larger burst size for ripple while keeping good staggering
                    const rr = wallartConfig.refreshRate || wallartConfig.randomness || 5;
                    let targetBurst = Math.ceil(total * 0.1) + Math.floor(rr / 2); // base ~10% + a bit from refresh rate
                    // Clamp to avoid overwhelming the device
                    targetBurst = Math.max(6, Math.min(targetBurst, Math.ceil(total * 0.22), 24));

                    // Group by rings and pick at most quota per ring to avoid many firing together
                    const byRing = new Map();
                    for (const item of withDistance) {
                        if (!byRing.has(item.ring)) byRing.set(item.ring, []);
                        byRing.get(item.ring).push(item);
                    }
                    const rings = Array.from(byRing.keys()).sort((a, b) => a - b);

                    // Ring quota: larger grids can take more per ring
                    const ringQuota = total >= 60 ? 3 : 2;

                    const picked = [];
                    for (const ring of rings) {
                        const group = byRing.get(ring) || [];
                        // Shuffle lightly for variety
                        group.sort(() => Math.random() - 0.5);
                        for (let k = 0; k < Math.min(ringQuota, group.length); k++) {
                            picked.push(group[k]);
                            if (picked.length >= targetBurst) break;
                        }
                        if (picked.length >= targetBurst) break;
                    }

                    // If not enough picked (very small grids), fallback to nearest-first until filled
                    if (picked.length < targetBurst) {
                        const remaining = withDistance
                            .filter(x => !picked.some(p => p.i === x.i))
                            .sort((a, b) => a.dist - b.dist)
                            .slice(0, targetBurst - picked.length);
                        picked.push(...remaining);
                    }

                    // Apply cooldown filtering similar to staggered
                    const chosen = picked.map(p => p.i);
                    const filtered = chosen.filter(i => !cooldown.has(i));
                    if (filtered.length >= Math.max(3, Math.floor(targetBurst * 0.7))) {
                        ordered = filtered.slice(0, targetBurst);
                    } else {
                        ordered = filtered
                            .concat(chosen.filter(i => !filtered.includes(i)))
                            .slice(0, targetBurst);
                    }
                    for (const p of picked) {
                        // Delay by ring with extra jitter and minor checkerboard offset to de-sync neighbors
                        const jitter = Math.floor(Math.random() * 120);
                        const checker = ((p.row + p.col) % 2) * 30;
                        delays.set(p.i, p.ring * 140 + jitter + checker);
                    }
                } else if (packType === 'scanline') {
                    // Scanline: sweep across rows as a band
                    // Maintain sweep state on window
                    if (typeof window._wallartScanline === 'undefined') {
                        window._wallartScanline = {
                            row: 0,
                            dir: 1, // 1 down, -1 up
                        };
                    }
                    const s = window._wallartScanline;

                    // Thickness: 1–2 rows depending on grid size
                    const thickness = rows >= 6 ? 2 : 1;
                    const rowsToUpdate = [];
                    for (let t = 0; t < thickness; t++) {
                        const r = s.row + t * s.dir;
                        if (r >= 0 && r < rows) rowsToUpdate.push(r);
                    }

                    // Advance sweep position for next cycle
                    s.row += s.dir;
                    if (s.row >= rows - 1 || s.row <= 0) {
                        s.dir *= -1; // bounce at edges
                        s.row = Math.max(0, Math.min(rows - 1, s.row));
                    }

                    // Build ordered indices for all cells in chosen rows
                    const chosen = [];
                    for (const r of rowsToUpdate) {
                        for (let c = 0; c < cols; c++) {
                            chosen.push(r * cols + c);
                        }
                    }

                    // Apply cooldown filtering but allow full band if needed
                    let chosenFiltered = chosen.filter(i => !cooldown.has(i));
                    if (chosenFiltered.length < Math.max(3, Math.floor(chosen.length * 0.6))) {
                        chosenFiltered = chosen; // ensure we still update a band
                    }
                    ordered = chosenFiltered;

                    // Delays: left→right cascade per row with light jitter; alternate direction for variety
                    window._wallartScanlineFlip = !window._wallartScanlineFlip;
                    for (const i of ordered) {
                        const r = Math.floor(i / cols);
                        const c = i % cols;
                        const base = window._wallartScanlineFlip ? c : cols - 1 - c;
                        const jitter = Math.floor(Math.random() * 40);
                        delays.set(i, base * 45 + (r % rows) * 10 + jitter);
                    }
                }

                // Execute the burst: schedule each tile update with its delay
                let maxDelay = 0;
                for (const idx of ordered) {
                    const delay = delays.get(idx) || 0;
                    if (delay > maxDelay) maxDelay = delay;

                    setTimeout(() => {
                        const targetElement = tileEls[idx];
                        if (!targetElement) return;

                        // Choose a new poster for this position
                        const currentPosterAtPosition = currentPosters[idx];
                        const currentPosterId = currentPosterAtPosition
                            ? currentPosterAtPosition.id ||
                              currentPosterAtPosition.title ||
                              currentPosterAtPosition.posterUrl
                            : null;
                        const newPoster = getUniqueRandomPoster(currentPosterId);
                        if (!newPoster) return;

                        // Free the old poster id and update tracking
                        if (currentPosterAtPosition && currentPosterId) {
                            usedPosters.delete(currentPosterId);
                        }
                        currentPosters[idx] = newPoster;
                        targetElement.dataset.posterId =
                            newPoster.id || newPoster.title || String(idx);

                        // For per-tile change use a simple effect; the pack provides the burst timing
                        animatePosterChange(targetElement, newPoster, 'fade');
                    }, delay);
                }

                // Record indices for cooldown to spread updates across bursts
                try {
                    window._wallartRecentUpdates = Array.isArray(window._wallartRecentUpdates)
                        ? window._wallartRecentUpdates
                        : [];
                    window._wallartRecentUpdates.push(new Set(ordered));
                    if (window._wallartRecentUpdates.length > 3) {
                        window._wallartRecentUpdates.shift();
                    }
                } catch (_) {
                    /* noop */
                }

                // Schedule next cycle after the burst completes (always on)
                const randomFactor = Math.random() * Math.random();
                const isNegative = Math.random() < 0.5;
                const randomVariation = (isNegative ? -1 : 1) * randomFactor * maxRandomVariation;
                const nextInterval = Math.max(200, refreshInterval + randomVariation);
                const padding = 250; // small padding after last animation
                wallartRefreshTimeout = setTimeout(
                    refreshSinglePoster,
                    nextInterval + maxDelay + padding
                );
                return; // handled burst this cycle
            }

            // Prevent the same position from being updated twice in a row
            let randomPosition;
            let attempts = 0;
            do {
                randomPosition = Math.floor(Math.random() * currentPosters.length);
                attempts++;
            } while (
                randomPosition === window.lastWallartPosition &&
                currentPosters.length > 1 &&
                attempts < 20
            );

            // In heroGrid, avoid selecting the hero tile for single updates
            if (wallartGrid?.dataset?.heroGrid === 'true') {
                const singleEls = wallartGrid.querySelectorAll('.wallart-poster-item');
                if (singleEls[randomPosition]?.dataset?.hero === 'true') {
                    // pick a different non-hero index
                    const candidates = Array.from(singleEls)
                        .map((_, i) => i)
                        .filter(i => singleEls[i]?.dataset?.hero !== 'true');
                    if (candidates.length > 0) {
                        randomPosition = candidates[Math.floor(Math.random() * candidates.length)];
                    }
                }
            }

            // Store last position to prevent immediate repeat
            window.lastWallartPosition = randomPosition;

            // Get current poster at this position to exclude it
            const currentPosterAtPosition = currentPosters[randomPosition];
            const currentPosterId = currentPosterAtPosition
                ? currentPosterAtPosition.id ||
                  currentPosterAtPosition.title ||
                  currentPosterAtPosition.posterUrl
                : null;

            // Get a new unique poster that's different from the current one at this position
            const newPoster = getUniqueRandomPoster(currentPosterId);
            if (!newPoster) {
                return;
            }

            // Remove old poster from used set (so it can be used again later)
            if (currentPosterAtPosition) {
                usedPosters.delete(currentPosterId);
            }

            // Update current poster tracking
            currentPosters[randomPosition] = newPoster;

            // Find the DOM element and animate the change
            const posterElements2 = wallartGrid.querySelectorAll('.wallart-poster-item');
            const targetElement = posterElements2[randomPosition];

            if (targetElement) {
                targetElement.dataset.posterId = newPoster.id || newPoster.title || randomPosition;
                animatePosterChange(targetElement, newPoster, animationType);
            }

            // Schedule next refresh (always on)
            // Use exponential random distribution for more natural, unpredictable timing
            const randomFactor = Math.random() * Math.random(); // Double random for exponential curve
            const isNegative = Math.random() < 0.5; // 50% chance negative variation
            const randomVariation = (isNegative ? -1 : 1) * randomFactor * maxRandomVariation;
            const nextInterval = Math.max(200, refreshInterval + randomVariation);

            wallartRefreshTimeout = setTimeout(refreshSinglePoster, nextInterval);
        };

        // Function to automatically detect all available animation types from the animatePosterChange function
        function getAvailableAnimationTypes() {
            // More robust approach: hardcoded list that's easy to maintain
            // This ensures reliability while still being easy to update
            const knownTypes = [
                'fade',
                'slideLeft',
                'slideUp',
                'zoom',
                'flip',
                'shiftUp',
                'shiftDown',
                'staggered',
                'ripple',
                'scanline',
                'parallax',
                'neonPulse',
                'chromaticShift',
                'mosaicShatter',
            ];

            return knownTypes;
        }

        // Function to get a random animation type from all available types
        function getRandomAnimationType() {
            const availableTypes = getAvailableAnimationTypes();
            if (availableTypes.length === 0) {
                logger.warn(`[WALLART] No animation types available, falling back to 'fade'`);
                return 'fade';
            }

            const randomIndex = Math.floor(Math.random() * availableTypes.length);
            const selectedType = availableTypes[randomIndex];
            logger.debug(
                `[WALLART] Random animation type selected: ${selectedType} (from: ${availableTypes.join(', ')})`
            );
            return selectedType;
        }

        function animatePosterChange(element, newItem, animationType, existingImgEl) {
            const img = existingImgEl || element.querySelector('img');
            if (!img) return;

            // Mobile detection for optimized animations
            const isMobile =
                window.innerWidth <= 768 || /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);

            // If animation type is 'random', select a random type from all available types
            if (animationType === 'random') {
                animationType = getRandomAnimationType();
            }

            // Map pack-style names to a tile-supported effect for per-item updates
            if (animationType === 'staggered' || animationType === 'ripple') {
                animationType = 'fade';
            }

            // Start with just a simple, reliable fade animation
            if (animationType === 'fade') {
                // Mobile optimized timing
                const fadeTime = isMobile ? '0.4s' : '0.5s';
                const waitTime = isMobile ? 400 : 500;

                // Step 1: Fade out current image
                img.style.transition = `opacity ${fadeTime} ease-in-out`;
                img.style.opacity = '0';

                // Step 2: After fade out, change image and fade in
                setTimeout(() => {
                    img.src =
                        newItem.posterUrl ||
                        '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                    img.alt = newItem.title || 'Movie Poster';

                    // Step 3: Fade in new image
                    setTimeout(() => {
                        img.style.opacity = '1';
                    }, 50);
                }, waitTime);
            } else if (animationType === 'slideLeft') {
                // Mobile optimized timings and transforms
                const slideScale = isMobile ? 'scale(1)' : 'scale(1.05)';
                const slideTime = isMobile ? '0.4s' : '0.6s';
                const waitTime = isMobile ? 400 : 600;
                const slideDistance = isMobile ? '50px' : '100px';

                // Reset any existing transition first
                img.style.transition = 'none';
                img.style.transform = `${slideScale} translateX(0px)`;

                // Force reflow
                img.offsetHeight;

                // Step 1: Slide out to the left with fade
                img.style.transition = `all ${slideTime} ease-in-out`;
                img.style.opacity = '0';
                img.style.transform = `${slideScale} translateX(-${slideDistance})`;

                // Step 2: Change image and slide in from right
                setTimeout(() => {
                    img.src =
                        newItem.posterUrl ||
                        '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                    img.alt = newItem.title || 'Movie Poster';

                    // Position image off-screen right (no transition)
                    img.style.transition = 'none';
                    img.style.transform = `${slideScale} translateX(${slideDistance})`;
                    img.style.opacity = '0';

                    // Force reflow
                    img.offsetHeight;

                    // Step 3: Slide in from right
                    img.style.transition = `all ${slideTime} ease-out`;
                    setTimeout(() => {
                        img.style.opacity = '1';
                        img.style.transform = `${slideScale} translateX(0px)`;
                    }, 50);
                }, waitTime);
            } else if (animationType === 'slideUp') {
                // Mobile optimized timings and transforms
                const slideScale = isMobile ? 'scale(1)' : 'scale(1.05)';
                const slideTime = isMobile ? '0.4s' : '0.6s';
                const waitTime = isMobile ? 400 : 600;
                const slideDistance = isMobile ? '50px' : '100px';

                // Reset any existing transition first
                img.style.transition = 'none';
                img.style.transform = `${slideScale} translateY(0px)`;

                // Force reflow
                img.offsetHeight;

                // Step 1: Slide up and fade out
                img.style.transition = `all ${slideTime} ease-in-out`;
                img.style.opacity = '0';
                img.style.transform = `${slideScale} translateY(-${slideDistance})`;

                // Step 2: Change image and slide in from bottom
                setTimeout(() => {
                    img.src =
                        newItem.posterUrl ||
                        '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                    img.alt = newItem.title || 'Movie Poster';

                    // Position image off-screen bottom (no transition)
                    img.style.transition = 'none';
                    img.style.transform = `${slideScale} translateY(${slideDistance})`;
                    img.style.opacity = '0';

                    // Force reflow
                    img.offsetHeight;

                    // Step 3: Slide in from bottom
                    img.style.transition = `all ${slideTime} ease-out`;
                    setTimeout(() => {
                        img.style.opacity = '1';
                        img.style.transform = `${slideScale} translateY(0px)`;
                    }, 50);
                }, waitTime);
            } else if (animationType === 'zoom') {
                // Reset any existing transition first
                img.style.transition = 'none';
                img.style.transform = 'scale(1.05)';

                // Force reflow
                img.offsetHeight;

                // Step 1: Scale down and fade out
                img.style.transition = 'all 0.5s ease-in';
                img.style.opacity = '0';
                img.style.transform = 'scale(0.7)';

                // Step 2: Change image and zoom in
                setTimeout(() => {
                    img.src =
                        newItem.posterUrl ||
                        '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                    img.alt = newItem.title || 'Movie Poster';

                    // Start very small (no transition)
                    img.style.transition = 'none';
                    img.style.transform = 'scale(0.3)';
                    img.style.opacity = '0';

                    // Force reflow
                    img.offsetHeight;

                    // Step 3: Zoom in with bounce effect
                    img.style.transition = 'all 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                    setTimeout(() => {
                        img.style.opacity = '1';
                        img.style.transform = 'scale(1.05)';
                    }, 50);
                }, 500);
            } else if (animationType === 'flip') {
                // Reset any existing transition first
                img.style.transition = 'none';
                img.style.transform = 'scale(1.05) rotateY(0deg)';

                // Force reflow
                img.offsetHeight;

                // Step 1: Flip away and fade out
                img.style.transition = 'all 0.4s ease-in';
                img.style.opacity = '0';
                img.style.transform = 'scale(1.05) rotateY(90deg)';

                // Step 2: Change image and flip in
                setTimeout(() => {
                    img.src =
                        newItem.posterUrl ||
                        '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                    img.alt = newItem.title || 'Movie Poster';

                    // Start flipped away (no transition)
                    img.style.transition = 'none';
                    img.style.transform = 'scale(1.05) rotateY(-90deg)';
                    img.style.opacity = '0';

                    // Force reflow
                    img.offsetHeight;

                    // Step 3: Flip in from other side
                    img.style.transition = 'all 0.5s ease-out';
                    setTimeout(() => {
                        img.style.opacity = '1';
                        img.style.transform = 'scale(1.05) rotateY(0deg)';
                    }, 50);
                }, 400);
            } else if (animationType === 'shiftUp' || animationType === 'shiftDown') {
                // Shift animations - move entire grid and update multiple posters
                performShiftAnimation(animationType, newItem, element);
            } else if (animationType === 'scanline') {
                // Horizontal sweep: blur + slideY slight, then in
                img.style.transition = 'none';
                img.style.filter = 'blur(6px) brightness(0.9)';
                img.style.transform = 'translateY(8px)';
                img.offsetHeight;
                // swap
                img.src =
                    newItem.posterUrl ||
                    '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                img.alt = newItem.title || 'Movie Poster';
                img.offsetHeight;
                img.style.transition =
                    'transform 420ms ease-out, filter 380ms ease-out, opacity 360ms ease-out';
                img.style.opacity = '1';
                setTimeout(() => {
                    img.style.filter = 'blur(0px) brightness(1)';
                    img.style.transform = 'translateY(0)';
                }, 30);
            } else if (animationType === 'parallax') {
                // Smooth single-poster parallax with preload, longer drift and gentle settle
                const url =
                    newItem.posterUrl ||
                    '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                const doAnim = () => {
                    img.style.transition = 'none';
                    // Derive offset from element's position in grid for directional drift
                    const parent = element.parentElement;
                    let dx = 6,
                        dy = -6;
                    try {
                        const cols = parseInt(parent?.dataset?.columns || '0', 10);
                        const rows = parseInt(parent?.dataset?.rows || '0', 10);
                        if (cols && rows) {
                            const idx = Array.from(
                                parent.querySelectorAll('.wallart-poster-item')
                            ).indexOf(element);
                            const c = idx % cols;
                            const r = Math.floor(idx / cols);
                            const cx = (cols - 1) / 2;
                            const cy = (rows - 1) / 2;
                            // Vector pointing from tile to center (so tile moves inward)
                            const vx = cx - c;
                            const vy = cy - r;
                            const len = Math.hypot(vx, vy) || 1;
                            const mag = Math.min(9, 5 + len * 0.6); // gentler offset
                            dx = (vx / len) * mag;
                            dy = (vy / len) * mag;
                        }
                    } catch (_) {
                        /* ignore: derive parallax offsets best-effort */
                    }

                    // Start slightly offset and a touch larger; subtle opacity ramp
                    img.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.045)`;
                    img.style.opacity = '0.96';
                    img.offsetHeight; // reflow
                    img.style.transition =
                        'transform 820ms cubic-bezier(0.22, 0.9, 0.2, 1), opacity 820ms ease-out';
                    img.style.transform = 'translate3d(0, 0, 0) scale(1.0)';
                    img.style.opacity = '1';

                    // settle slowly to 1.0 to avoid abrupt stop
                    // No extra settle; keep final at 1.0 to avoid end snaps across effects
                    setTimeout(() => {
                        img.style.transition = 'transform 680ms ease-out';
                        img.style.transform = 'translate3d(0, 0, 0) scale(1.0)';
                    }, 840);
                };

                // Preload image to avoid flicker before animating
                const preload = new Image();
                let fired = false;
                const start = () => {
                    if (fired) return;
                    fired = true;
                    img.src = url;
                    img.alt = newItem.title || 'Movie Poster';
                    // A tiny delay ensures layout/decoding is applied before animating
                    setTimeout(doAnim, 20);
                };
                preload.onload = start;
                preload.onerror = start;
                preload.src = url;
            } else if (animationType === 'neonPulse') {
                // Neon glow pulse using container glow + gentle scale bump on image
                const url =
                    newItem.posterUrl ||
                    '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                const neonPalette = [
                    'rgba(255, 0, 122, 0.85)', // pink
                    'rgba(0, 225, 255, 0.88)', // cyan
                    'rgba(170, 80, 255, 0.82)', // purple
                    'rgba(57, 255, 20, 0.78)', // lime
                    'rgba(255, 209, 0, 0.82)', // amber
                ];
                // Prefer white glow if ambient overlay exists (blends nicer), else pick neon
                const ambient = document.getElementById('wallart-ambient-overlay');
                // If ambient is on, prefer bright cyan which pops on dark backgrounds
                const color = ambient
                    ? 'rgba(0, 225, 255, 0.75)'
                    : neonPalette[Math.floor(Math.random() * neonPalette.length)];

                const startAnim = () => {
                    element.classList.add('animating', 'neon-pulse');
                    try {
                        element.style.setProperty('--neon-color', color);
                    } catch (_) {
                        /* ignore: CSS var not critical */
                    }

                    // Subtle glow only; avoid scale changes to prevent cross-effect snapping
                    img.style.transition = 'transform 0ms linear';
                    img.style.transform = 'scale(1.0)';

                    // Cleanup the glow class after animation ends
                    setTimeout(() => {
                        element.classList.remove('neon-pulse');
                        element.classList.remove('animating');
                    }, 2300);
                };

                // Preload to avoid any pop-in
                const preload = new Image();
                let fired = false;
                const begin = () => {
                    if (fired) return;
                    fired = true;
                    img.src = url;
                    img.alt = newItem.title || 'Movie Poster';
                    // small timeout ensures the src swap is committed before anim starts
                    setTimeout(startAnim, 20);
                };
                preload.onload = begin;
                preload.onerror = begin;
                preload.src = url;
            } else if (animationType === 'chromaticShift') {
                // RGB split layers that briefly offset then converge, then blur-fade smoothly out
                const url =
                    newItem.posterUrl ||
                    '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                const start = () => {
                    // Hard reset any previous transform/transition to avoid end-of-effect snap
                    img.style.transition = 'none';
                    img.style.transform = 'translate3d(0, 0, 0) scale(1.0)';
                    img.offsetHeight; // commit reset

                    // Swap base image first (no transform)
                    img.src = url;
                    img.alt = newItem.title || 'Movie Poster';

                    // Remove any lingering layers
                    element
                        .querySelectorAll('.layer-r, .layer-g, .layer-b')
                        .forEach(n => n.remove());

                    // Create overlay RGB layers above it
                    element.classList.add('animating', 'chromatic-shift');
                    const r = document.createElement('div');
                    const g = document.createElement('div');
                    const b = document.createElement('div');
                    r.className = 'layer-r';
                    g.className = 'layer-g';
                    b.className = 'layer-b';
                    r.style.backgroundImage = `url("${url}")`;
                    g.style.backgroundImage = `url("${url}")`;
                    b.style.backgroundImage = `url("${url}")`;
                    element.appendChild(r);
                    element.appendChild(g);
                    element.appendChild(b);

                    // Animate: offset -> converge -> blur-fade
                    const tDur = 1100; // transform duration
                    const fadeDur = 900; // opacity/blur duration
                    const kick = 12; // px
                    const easing = 'cubic-bezier(0.22, 0.9, 0.2, 1)';
                    const trans = `transform ${tDur}ms ${easing}, opacity ${fadeDur}ms ease-out, filter ${fadeDur}ms ease-out`;
                    r.style.transition = g.style.transition = b.style.transition = trans;
                    r.style.opacity = g.style.opacity = b.style.opacity = '1';
                    r.style.filter = g.style.filter = b.style.filter = 'blur(0px)';
                    r.style.transform = `translate3d(${kick}px, 0, 0)`;
                    g.style.transform = `translate3d(0, ${-kick}px, 0)`;
                    b.style.transform = `translate3d(${-kick}px, 0, 0)`;
                    // Converge a bit later for more glide
                    const convergeAt = Math.round(tDur * 0.3);
                    setTimeout(() => {
                        r.style.transform = 'translate3d(0, 0, 0)';
                        g.style.transform = 'translate3d(0, 0, 0)';
                        b.style.transform = 'translate3d(0, 0, 0)';
                    }, convergeAt);
                    // Fade + slight blur for a soft exit
                    const fadeStart = Math.round(tDur * 0.55);
                    setTimeout(() => {
                        r.style.opacity = g.style.opacity = b.style.opacity = '0';
                        r.style.filter = g.style.filter = b.style.filter = 'blur(2px)';
                    }, fadeStart);
                    setTimeout(
                        () => {
                            r.remove();
                            g.remove();
                            b.remove();
                            element.classList.remove('chromatic-shift');
                            element.classList.remove('animating');
                        },
                        fadeStart + fadeDur + 200
                    );
                };
                const preload = new Image();
                preload.onload = start;
                preload.onerror = start;
                preload.src = url;
            } else if (animationType === 'holoShimmer') {
                // Effect removed. Fallback to 'fade' for compatibility.
                animatePosterChange(element, newItem, 'fade');
            } else if (animationType === 'mosaicShatter') {
                // Two-phase effect: explode old poster shards outward, then assemble new poster shards inward
                const newUrl =
                    newItem.posterUrl ||
                    '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                const oldUrl = img.currentSrc || img.src;
                const run = () => {
                    element.classList.add('animating', 'mosaic-shatter');
                    // Lock current rendered size to avoid end snap due to fractional layout rounding
                    try {
                        const r = img.getBoundingClientRect();
                        const w = Math.round(r.width);
                        const h = Math.round(r.height);
                        element.style.setProperty('--lock-w', w + 'px');
                        element.style.setProperty('--lock-h', h + 'px');
                        element.classList.add('pixel-lock');
                    } catch (_) {
                        /* ignore: pixel-lock failures are non-fatal */
                    }
                    // Hard reset base image to avoid any leftover scale causing end-snap
                    img.style.transition = 'none';
                    img.style.transform = 'translate3d(0, 0, 0) scale(1.0)';
                    img.style.filter = '';
                    img.style.opacity = '1';
                    const rect = element.getBoundingClientRect();
                    // Slightly denser grid for more randomness while keeping perf OK
                    const cols = 5,
                        rows = 7; // 35 shards
                    const w = rect.width / cols;
                    const h = rect.height / rows;

                    // Helper to create shards for a given image URL
                    const makeShards = (url, zIndex = 3) => {
                        const arr = [];
                        for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                                const s = document.createElement('div');
                                s.className = 'shard';
                                s.style.width = `${w}px`;
                                s.style.height = `${h}px`;
                                s.style.left = `${c * w}px`;
                                s.style.top = `${r * h}px`;
                                s.style.backgroundImage = `url("${url}")`;
                                s.style.backgroundSize = `${rect.width}px ${rect.height}px`;
                                s.style.backgroundPosition = `${-c * w}px ${-r * h}px`;
                                s.style.zIndex = String(zIndex);
                                element.appendChild(s);
                                arr.push(s);
                            }
                        }
                        return arr;
                    };

                    // Phase 1: explode old shards outward and fade
                    const oldShards = makeShards(oldUrl, 4);
                    // Start at rest, then explode out
                    for (const s of oldShards) {
                        s.style.transition = 'none';
                        s.style.opacity = '1';
                        s.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
                    }
                    // Flush
                    element.offsetHeight;
                    // Compute explosion vectors relative to center
                    const cx = rect.width / 2;
                    const cy = rect.height / 2;
                    const explodeDur = 780;
                    for (const s of oldShards) {
                        const left = parseFloat(s.style.left) + w / 2;
                        const top = parseFloat(s.style.top) + h / 2;
                        const vx = left - cx;
                        const vy = top - cy;
                        const len = Math.hypot(vx, vy) || 1;
                        const nX = vx / len;
                        const nY = vy / len;
                        const spread = Math.max(80, Math.min(260, Math.round(rect.width * 0.18)));
                        const dx = nX * spread + (Math.random() * 36 - 18);
                        const dy = nY * spread + (Math.random() * 36 - 18);
                        const rz = Math.random() * 38 - 19;
                        const delay =
                            Math.round((len / Math.max(cx, cy)) * 220) +
                            Math.floor(Math.random() * 180);
                        const dur = explodeDur + Math.floor(Math.random() * 180) - 90; // slight per-shard variance
                        s.style.transition = `transform ${dur}ms cubic-bezier(0.22, 0.9, 0.2, 1), opacity ${dur}ms ease-out`;
                        setTimeout(() => {
                            s.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${rz}deg)`;
                            s.style.opacity = '0';
                        }, delay);
                    }

                    // Phase 2: assemble new shards inward while new image prepares underneath
                    // Prepare new image but keep transparent beneath shards
                    setTimeout(() => {
                        img.style.transition = 'none';
                        img.style.opacity = '0';
                        img.src = newUrl;
                        img.alt = newItem.title || 'Movie Poster';
                    }, explodeDur * 0.6);

                    setTimeout(() => {
                        // Remove old shards now that they're gone
                        oldShards.forEach(s => s.remove());

                        // Create incoming shards for the new image
                        const newShards = makeShards(newUrl, 4);
                        const assembleDur = 1480;
                        const spreadIn = Math.max(90, Math.min(320, Math.round(rect.width * 0.22)));
                        for (const s of newShards) {
                            // Start from scattered outside
                            const centerBias =
                                1 - Math.abs(0.5 - (parseFloat(s.style.left) + w / 2) / rect.width);
                            const dx = (Math.random() * 2 - 1) * spreadIn;
                            const dy = (Math.random() * 2 - 1) * spreadIn;
                            const rz = Math.random() * 24 - 12;
                            s.style.transition = 'none';
                            s.style.opacity = '0.0';
                            s.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${rz}deg)`;
                            // Stagger so central shards finish first
                            const delay =
                                Math.round((1 - centerBias) * 420) +
                                Math.floor(Math.random() * 240);
                            setTimeout(() => {
                                const dur = assembleDur + Math.floor(Math.random() * 240) - 120;
                                s.style.transition = `transform ${dur}ms cubic-bezier(0.22, 0.9, 0.2, 1), opacity ${dur}ms ease-out`;
                                s.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
                                s.style.opacity = '1.0';
                            }, delay);
                        }
                        // Reveal the new base image gently under the shards (midway) for smoother finish
                        setTimeout(
                            () => {
                                img.style.transition = 'opacity 520ms ease-out';
                                img.style.opacity = '1';
                            },
                            Math.round(assembleDur * 0.48)
                        );

                        // Cleanup and ensure final neutral transform
                        setTimeout(() => {
                            newShards.forEach(s => s.remove());
                            // Snap base image to exact tile bounds before releasing lock
                            img.style.transition = 'none';
                            img.style.transform = 'translate3d(0, 0, 0) scale(1.0)';
                            img.style.opacity = '1';
                            img.style.objectFit = 'cover';
                            img.style.objectPosition = 'center';
                            // remove classes after image is in final state
                            element.classList.remove('mosaic-shatter');
                            element.classList.remove('animating');
                            // release pixel lock after one frame to allow layout to settle
                            requestAnimationFrame(() => {
                                element.classList.remove('pixel-lock');
                                element.style.removeProperty('--lock-w');
                                element.style.removeProperty('--lock-h');
                                // clear any inline styles to return to CSS defaults
                                img.style.transition = '';
                                img.style.objectFit = '';
                                img.style.objectPosition = '';
                            });
                        }, assembleDur + 480);
                    }, explodeDur + 60);
                };
                const preload = new Image();
                preload.onload = run;
                preload.onerror = run;
                preload.src = newUrl;
            } else {
                // For now, fallback to instant change for other animation types
                img.src =
                    newItem.posterUrl ||
                    '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                img.alt = newItem.title || 'Movie Poster';
            }
        }

        // Add window resize listener for responsive grid adjustment
        let resizeTimeout;
        function handleWallartResize() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                // console.log removed for cleaner browser console
                const newLayoutInfo = calculateWallartLayout(wallartConfig.density);
                initializeWallartGrid(newLayoutInfo.posterCount);
            }, 250); // Debounce resize events
        }

        // Remove existing listener if any
        if (window.wallartResizeListener) {
            window.removeEventListener('resize', window.wallartResizeListener);
        }

        // Add new listener
        window.wallartResizeListener = handleWallartResize;
        window.addEventListener('resize', window.wallartResizeListener);

        // Start the initial refresh timer to begin the poster cycling (always on)
        wallartRefreshTimeout = setTimeout(window.refreshSinglePoster, refreshInterval);
    }

    // --- Wallart ambient overlay helpers ---
    function ensureAmbientOverlay() {
        let ambient = document.getElementById('wallart-ambient-overlay');
        if (!ambient) {
            ambient = document.createElement('div');
            ambient.id = 'wallart-ambient-overlay';
            document.body.appendChild(ambient);
        }
        return ambient;
    }

    // Compute a rough dominant color from visible posters (fast and simple)
    function updateAmbientFromGrid(gridEl) {
        const ambient = ensureAmbientOverlay();
        const imgs = Array.from(gridEl.querySelectorAll('img')).slice(0, 24); // sample first 24
        if (imgs.length === 0) return;

        // Simple average of mid-sample pixels to avoid heavy processing
        let r = 18,
            g = 23,
            b = 34; // dark baseline
        let count = 1;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = 8;
        canvas.height = 8; // tiny sample

        for (const img of imgs) {
            try {
                ctx.clearRect(0, 0, 8, 8);
                ctx.drawImage(img, 0, 0, 8, 8);
                const data = ctx.getImageData(2, 2, 4, 4).data; // sample center 4x4
                for (let i = 0; i < data.length; i += 4) {
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count++;
                }
            } catch (_) {
                /* cross-origin or not ready */
            }
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        // Compute a complementary color for gradient end
        const comp = [255 - r, 255 - g, 255 - b].map(v => Math.max(24, Math.min(220, v)));

        const start = `rgba(${r}, ${g}, ${b}, 0.9)`;
        const end = `rgba(${comp[0]}, ${comp[1]}, ${comp[2]}, 0.9)`;
        const nextBg = `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;

        // Smooth tween by cross-fading via opacity if background changes
        ambient.style.background = nextBg;
        ambient.style.opacity = '0.5';
    }

    // Compute ambient color from a single hero image
    function updateAmbientFromImage(img) {
        const ambient = ensureAmbientOverlay();
        if (!img) return;

        // Simple average of mid-sample pixels to avoid heavy processing
        let r = 18,
            g = 23,
            b = 34; // dark baseline
        let count = 1;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = 8;
        canvas.height = 8; // tiny sample

        try {
            ctx.clearRect(0, 0, 8, 8);
            ctx.drawImage(img, 0, 0, 8, 8);
            const data = ctx.getImageData(2, 2, 4, 4).data; // sample center 4x4
            for (let i = 0; i < data.length; i += 4) {
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
                count++;
            }
        } catch (_) {
            /* cross-origin or not ready */
        }

        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        // Compute a complementary color for gradient end
        const comp = [255 - r, 255 - g, 255 - b].map(v => Math.max(24, Math.min(220, v)));

        const start = `rgba(${r}, ${g}, ${b}, 0.9)`;
        const end = `rgba(${comp[0]}, ${comp[1]}, ${comp[2]}, 0.9)`;
        const nextBg = `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;

        // Smooth tween by cross-fading via opacity if background changes
        ambient.style.background = nextBg;
        ambient.style.opacity = '0.5';
    }

    // Spotlight helpers removed

    async function refreshConfig() {
        try {
            // In admin live preview, do not override local preview settings
            // with periodic server config refreshes.
            if (window.IS_PREVIEW) {
                return;
            }
            // Skip config refresh when offline
            if (!navigator.onLine) {
                return;
            }

            // Enhanced cache-busting with timestamp and random parameter
            const cacheBuster = `?_t=${Date.now()}&_r=${Math.random().toString(36).substring(7)}`;
            const configResponse = await fetch('/get-config' + cacheBuster, {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    Pragma: 'no-cache',
                    Expires: '0',
                },
            });

            if (!configResponse.ok) {
                throw new Error(`Config fetch failed: ${configResponse.status}`);
            }

            const newConfig = await configResponse.json();

            // Check if configuration has changed
            const configChanged = JSON.stringify(appConfig) !== JSON.stringify(newConfig);

            if (configChanged) {
                const oldConfig = { ...appConfig };
                appConfig = newConfig;

                // Apply configuration changes
                applyConfigurationChanges(oldConfig, newConfig);

                // Apply UI scaling changes (only for screensaver mode)
                if (!newConfig.cinemaMode && !newConfig.wallartMode?.enabled) {
                    applyUIScaling(newConfig);
                }

                // Apply cinema mode changes
                applyCinemaMode(newConfig);

                // Apply wallart mode changes
                applyWallartMode(newConfig);

                // If transition/effect timing changed, restart timer to take effect immediately
                if (
                    oldConfig.transitionIntervalSeconds !== newConfig.transitionIntervalSeconds ||
                    oldConfig.effectPauseTime !== newConfig.effectPauseTime ||
                    oldConfig.transitionEffect !== newConfig.transitionEffect
                ) {
                    if (!newConfig.cinemaMode && !newConfig.wallartMode?.enabled) {
                        restartTimer();
                    }
                }
            }
        } catch (error) {
            // Silent fail in offline mode - don't spam console
            if (navigator.onLine) {
                console.error('Failed to refresh configuration:', error);
            }
        }
    }

    function applyConfigurationChanges(oldConfig, newConfig) {
        // Only apply visual element changes in screensaver mode
        const isScreensaverMode = !newConfig.cinemaMode && !newConfig.wallartMode?.enabled;

        // Handle display changes
        if (oldConfig.showPoster !== newConfig.showPoster && isScreensaverMode) {
            const pw = document.getElementById('poster-wrapper');
            if (newConfig.showPoster === false) {
                pw && pw.classList.add('is-hidden');
            } else {
                pw && pw.classList.remove('is-hidden');
            }
        }

        // Handle clock widget changes
        if (oldConfig.clockWidget !== newConfig.clockWidget) {
            const widgetContainer = document.getElementById('clock-widget-container');
            if (newConfig.clockWidget) {
                widgetContainer.style.display = 'block';
                updateClock();
                if (!document.clockUpdateInterval) {
                    document.clockUpdateInterval = setInterval(updateClock, 1000);
                }
            } else {
                widgetContainer.style.display = 'none';
                if (document.clockUpdateInterval) {
                    clearInterval(document.clockUpdateInterval);
                    document.clockUpdateInterval = null;
                }
            }
        }

        // Handle clock timezone or format changes
        if (
            oldConfig.clockTimezone !== newConfig.clockTimezone ||
            oldConfig.clockFormat !== newConfig.clockFormat
        ) {
            updateClock(); // Update clock immediately with new settings
        }

        // Handle metadata display changes
        if (oldConfig.showMetadata !== newConfig.showMetadata && isScreensaverMode) {
            updateCurrentMediaDisplay();
        }

        // Handle clear logo display changes
        if (oldConfig.showClearLogo !== newConfig.showClearLogo && isScreensaverMode) {
            updateCurrentMediaDisplay();
        }

        // Handle Rotten Tomatoes display changes
        if (oldConfig.showRottenTomatoes !== newConfig.showRottenTomatoes) {
            updateCurrentMediaDisplay();
        }

        // Handle background refresh interval changes
        if (oldConfig.backgroundRefreshMinutes !== newConfig.backgroundRefreshMinutes) {
            if (refreshTimerId) clearInterval(refreshTimerId);
            if (newConfig.backgroundRefreshMinutes > 0) {
                refreshTimerId = setInterval(
                    fetchMedia,
                    newConfig.backgroundRefreshMinutes * 60 * 1000
                );
            }
        }

        // Handle cinema mode changes
        if (
            oldConfig.cinemaMode !== newConfig.cinemaMode ||
            oldConfig.cinemaOrientation !== newConfig.cinemaOrientation
        ) {
            applyCinemaMode(newConfig);
        }

        // Handle wallart mode changes
        if (JSON.stringify(oldConfig.wallartMode) !== JSON.stringify(newConfig.wallartMode)) {
            // console.log removed for cleaner browser console

            // Check specifically for animation type changes to force immediate restart
            if (oldConfig.wallartMode?.animationType !== newConfig.wallartMode?.animationType) {
                logger.debug(
                    `[CONFIG] Animation type changed from ${oldConfig.wallartMode?.animationType} to ${newConfig.wallartMode?.animationType}`
                );
            }

            applyWallartMode(newConfig);
        }
    }

    function updateCurrentMediaDisplay() {
        // Re-render the current media item with updated configuration
        if (currentIndex >= 0 && currentIndex < mediaQueue.length) {
            const currentMedia = mediaQueue[currentIndex];
            if (currentMedia) {
                renderMediaItem(currentMedia);
            }
        }
    }

    async function fetchMedia(isInitialLoad = false) {
        try {
            // Add a cache-busting query parameter to ensure the browser always fetches a fresh response.
            const cacheBuster = `?_=${Date.now()}`;
            const mediaResponse = await fetch('/get-media' + cacheBuster);

            if (mediaResponse.status === 202) {
                // Server is still building the playlist, let's wait and retry.
                const data = await mediaResponse.json();
                // Keep the loader visible if it's the initial load.
                if (isInitialLoad && loader && loader.style.opacity !== '1') {
                    loader.style.opacity = '1';
                }
                setTimeout(() => fetchMedia(isInitialLoad), data.retryIn || 2000);
                return; // Stop execution for this call
            }

            if (!mediaResponse.ok) {
                const errorData = await mediaResponse
                    .json()
                    .catch(() => ({ error: mediaResponse.statusText }));
                throw new Error(errorData.error || `Server error: ${mediaResponse.status}`);
            }

            let newMediaQueue = await mediaResponse.json();
            if (!Array.isArray(newMediaQueue) || newMediaQueue.length === 0) {
                console.warn('[Media] Received invalid or empty media queue:', newMediaQueue);
                showError('No media found. Check the library configuration.');
                if (loader && loader.style.opacity !== '0') loader.style.opacity = '0';
                // Ensure mediaQueue remains a valid empty array
                mediaQueue = [];
                return;
            }
            // In preview mode, keep full list for Wallart (needs many posters for the grid).
            // Retain a small cap for non-Wallart preview to keep it responsive.
            if (window.IS_PREVIEW) {
                const isWallart = appConfig?.wallartMode?.enabled;
                if (!isWallart) {
                    newMediaQueue = newMediaQueue.slice(0, 12);
                }
            }
            mediaQueue = newMediaQueue;

            // Clean up any existing preloaded images when playlist changes
            if (!isInitialLoad) {
                cleanupPreloadedImages();
            }

            if (isInitialLoad) {
                // Pick a random starting point instead of always starting at 0.
                // We set it to randomIndex - 1 because changeMedia increments it before use.
                const randomIndex = Math.floor(Math.random() * mediaQueue.length);
                currentIndex = randomIndex - 1;
                // Pre-prime background layers to avoid black screen while first image loads
                try {
                    const nextItem =
                        mediaQueue[(currentIndex + 1 + mediaQueue.length) % mediaQueue.length];
                    if (nextItem && nextItem.backgroundUrl) {
                        const la = document.getElementById('layer-a');
                        const lb = document.getElementById('layer-b');
                        if (la && lb) {
                            la.style.transition = 'none';
                            lb.style.transition = 'none';
                            la.style.opacity = '1';
                            lb.style.opacity = '0';
                            la.style.backgroundImage = `url('${nextItem.backgroundUrl}')`;
                            lb.style.backgroundImage = `url('${nextItem.backgroundUrl}')`;
                            activeLayer = la;
                            inactiveLayer = lb;
                        }
                    }
                } catch (_) {
                    // intentionally empty: best-effort visibility adjustment
                }
                changeMedia('next', true); // This will start the slideshow at `randomIndex`
            }

            // Start preloading images for smooth transitions
            preloadNextImages();
        } catch (e) {
            console.error('Failed to fetch media', e);
            showError(e.message || 'Could not load media. Check the server connection.');
            if (loader && loader.style.opacity !== '0') loader.style.opacity = '0';
            // Ensure mediaQueue remains a valid empty array on error
            mediaQueue = [];
        }
    }

    // Prefetch system for smooth transitions
    const preloadedImages = {
        backgrounds: new Map(),
        posters: new Map(),
    };
    const maxPreloadedImages = 5; // Preload next 5 items

    function preloadNextImages() {
        // Robust check for mediaQueue
        if (!mediaQueue || !Array.isArray(mediaQueue) || mediaQueue.length < 2) return;

        // Preload next few items for smooth transitions
        const itemsToPreload = Math.min(maxPreloadedImages, mediaQueue.length - 1);

        for (let i = 1; i <= itemsToPreload; i++) {
            const nextIndex = (currentIndex + i) % mediaQueue.length;
            const mediaItem = mediaQueue[nextIndex];

            if (!mediaItem) continue;

            // Preload background image
            if (
                mediaItem.backgroundUrl &&
                mediaItem.backgroundUrl !== 'null' &&
                mediaItem.backgroundUrl !== 'undefined' &&
                !preloadedImages.backgrounds.has(mediaItem.backgroundUrl)
            ) {
                const bgImg = new Image();
                bgImg.onload = () => {
                    // Background loaded successfully
                };
                bgImg.onerror = () => {
                    // Background failed to load
                };
                bgImg.src = mediaItem.backgroundUrl;
                preloadedImages.backgrounds.set(mediaItem.backgroundUrl, bgImg);
            }

            // Preload poster image
            if (!preloadedImages.posters.has(mediaItem.posterUrl)) {
                const posterImg = new Image();
                posterImg.onload = () => {
                    // Poster loaded successfully
                };
                posterImg.onerror = () => {
                    // Poster failed to load
                };
                posterImg.src = mediaItem.posterUrl;
                preloadedImages.posters.set(mediaItem.posterUrl, posterImg);
            }
        }

        // Clean up old preloaded images to avoid memory leaks
        cleanupPreloadedImages();
    }

    function cleanupPreloadedImages() {
        // Robust check for mediaQueue
        if (!mediaQueue || !Array.isArray(mediaQueue) || mediaQueue.length === 0) {
            // Clear all preloaded images if no media
            preloadedImages.backgrounds.clear();
            preloadedImages.posters.clear();
            return;
        }

        // Keep only images for current and next few items
        const currentUrls = new Set();
        const itemsToKeep = Math.min(maxPreloadedImages + 2, mediaQueue.length);

        for (let i = 0; i < itemsToKeep; i++) {
            const index = (currentIndex + i) % mediaQueue.length;
            const mediaItem = mediaQueue[index];
            if (mediaItem) {
                currentUrls.add(mediaItem.backgroundUrl);
                currentUrls.add(mediaItem.posterUrl);
            }
        }

        // Remove backgrounds not in current set
        for (const [url] of preloadedImages.backgrounds) {
            if (!currentUrls.has(url)) {
                preloadedImages.backgrounds.delete(url);
                // Background cleaned up
            }
        }

        // Remove posters not in current set
        for (const [url] of preloadedImages.posters) {
            if (!currentUrls.has(url)) {
                preloadedImages.posters.delete(url);
                // Poster cleaned up
            }
        }
    }

    function preloadNextImage() {
        // Legacy function - now use the enhanced preloadNextImages
        preloadNextImages();
    }

    /**
     * Renders the metadata for a single media item into the DOM.
     * This function is responsible for updating the poster, title, tagline, ratings, etc.
     * @param {object} mediaItem The media item object to render.
     */
    function renderMediaItem(mediaItem) {
        if (!mediaItem) {
            console.error('❌ renderMediaItem called with invalid mediaItem');
            return;
        }

        // Skip rendering individual media items in wallart mode
        // Wallart mode handles its own poster display
        if (document.body.classList.contains('wallart-mode')) {
            return;
        }

        // Apply transition effects only in screensaver mode (not cinema or wallart mode)
        if (!appConfig.cinemaMode && !appConfig.wallartMode?.enabled) {
            applyPosterTransitionEffect(mediaItem.posterUrl);
        } else if (appConfig.cinemaMode) {
            // In cinema mode, just show the poster directly without transitions
            posterEl.style.backgroundImage = `url('${mediaItem.posterUrl}')`;
            posterEl.innerHTML = '';

            // Also set on poster-a for backward compatibility (if it exists and is visible)
            const posterA = document.getElementById('poster-a');
            if (posterA) {
                posterA.style.backgroundImage = `url('${mediaItem.posterUrl}')`;
                posterA.style.opacity = '1';
            }
        } else {
            // Handle offline mode gracefully for posters
            if (!navigator.onLine && mediaItem.posterUrl) {
                // Test if poster is cached, otherwise use placeholder
                const testImg = new Image();
                testImg.onerror = () => {
                    // Poster not cached, use placeholder
                    posterEl.style.backgroundImage = 'none';
                    posterEl.style.backgroundColor = '#2a2a2a';
                    posterEl.innerHTML = `
                        <div style="
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            height: 100%;
                            color: #888;
                            font-size: 3rem;
                            text-align: center;
                            flex-direction: column;
                        ">
                            🎬
                            <div style="font-size: 0.8rem; margin-top: 0.5rem;">
                                ${mediaItem.title || 'Movie'}
                            </div>
                        </div>
                    `;
                };
                testImg.onload = () => {
                    // Poster is cached, use it
                    posterEl.style.backgroundImage = `url('${mediaItem.posterUrl}')`;
                    posterEl.innerHTML = '';
                };
                testImg.src = mediaItem.posterUrl;
            } else {
                posterEl.style.backgroundImage = `url('${mediaItem.posterUrl}')`;
                posterEl.innerHTML = '';
            }
        }

        // Check if poster should be shown (only in screensaver mode)
        if (!appConfig.cinemaMode && !appConfig.wallartMode?.enabled) {
            const pw = document.getElementById('poster-wrapper');
            if (appConfig.showPoster === false) {
                pw && pw.classList.add('is-hidden');
            } else {
                pw && pw.classList.remove('is-hidden');
            }
        }

        // In cinema mode, disable all poster links
        if (appConfig.cinemaMode) {
            posterLink.removeAttribute('href');
            posterLink.style.cursor = 'default';
        } else {
            // Normal mode - handle links as usual
            if (mediaItem.imdbUrl) {
                posterLink.href = mediaItem.imdbUrl;
                posterLink.style.cursor = 'pointer';
            } else {
                posterLink.removeAttribute('href');
                posterLink.style.cursor = 'default';
            }
        }
        titleEl.textContent = mediaItem.title || 'Unknown Title';
        taglineEl.textContent = mediaItem.tagline || '';
        yearEl.textContent = mediaItem.year || '';

        // Process rating and streaming provider info
        const ratingText = mediaItem.rating ? mediaItem.rating.toFixed(1) : '';
        let streamingProvider = '';

        // Check for streaming items and get provider name
        const isStreamingItem =
            (mediaItem.source && mediaItem.source.toLowerCase().includes('streaming')) ||
            (mediaItem.category && mediaItem.category.toLowerCase().includes('streaming'));

        if (isStreamingItem) {
            // Try to detect provider from streaming data first
            if (
                mediaItem.streaming &&
                mediaItem.streaming.providers &&
                mediaItem.streaming.providers.length > 0
            ) {
                const providers = mediaItem.streaming.providers;
                if (
                    providers.some(
                        p => p.provider_name && p.provider_name.toLowerCase().includes('netflix')
                    )
                ) {
                    streamingProvider = 'Netflix';
                } else if (
                    providers.some(
                        p => p.provider_name && p.provider_name.toLowerCase().includes('disney')
                    )
                ) {
                    streamingProvider = 'Disney+';
                } else if (
                    providers.some(
                        p => p.provider_name && p.provider_name.toLowerCase().includes('prime')
                    )
                ) {
                    streamingProvider = 'Prime Video';
                } else if (
                    providers.some(
                        p => p.provider_name && p.provider_name.toLowerCase().includes('hbo')
                    )
                ) {
                    streamingProvider = 'HBO Max';
                } else if (
                    providers.some(
                        p => p.provider_name && p.provider_name.toLowerCase().includes('apple')
                    )
                ) {
                    streamingProvider = 'Apple TV+';
                }
            }

            // Fallback: detect from source/category
            if (!streamingProvider) {
                const sourceText = (mediaItem.source || '').toLowerCase();
                const categoryText = (mediaItem.category || '').toLowerCase();

                if (sourceText.includes('netflix') || categoryText.includes('netflix')) {
                    streamingProvider = 'Netflix';
                } else if (sourceText.includes('disney') || categoryText.includes('disney')) {
                    streamingProvider = 'Disney+';
                } else if (sourceText.includes('prime') || categoryText.includes('prime')) {
                    streamingProvider = 'Prime Video';
                } else if (sourceText.includes('hbo') || categoryText.includes('hbo')) {
                    streamingProvider = 'HBO Max';
                } else if (sourceText.includes('apple') || categoryText.includes('apple')) {
                    streamingProvider = 'Apple TV+';
                } else if (sourceText.includes('new') || categoryText.includes('new')) {
                    streamingProvider = 'Streaming';
                }
            }
        }

        // Combine rating and streaming provider
        if (ratingText && streamingProvider) {
            ratingEl.textContent = `${ratingText} • ${streamingProvider}`;
        } else if (ratingText) {
            ratingEl.textContent = ratingText;
        } else if (streamingProvider) {
            ratingEl.textContent = streamingProvider;
        } else {
            ratingEl.textContent = '';
        }

        // Update document title using the dedicated function
        updateDocumentTitle(mediaItem);

        // Check if metadata should be shown (only in screensaver mode)
        if (!appConfig.cinemaMode && !appConfig.wallartMode?.enabled) {
            if (appConfig.showMetadata === false) {
                textWrapper.classList.add('is-hidden');
            } else {
                textWrapper.classList.remove('is-hidden');
                taglineEl.style.display = mediaItem.tagline ? 'block' : 'none';
                yearEl.style.display = mediaItem.year ? 'inline' : 'none';
                ratingEl.style.display = ratingText || streamingProvider ? 'inline' : 'none';
            }
        } else {
            // In cinema/wallart mode, always show metadata elements
            textWrapper.classList.remove('is-hidden');
            taglineEl.style.display = mediaItem.tagline ? 'block' : 'none';
            yearEl.style.display = mediaItem.year ? 'inline' : 'none';
            ratingEl.style.display = ratingText || streamingProvider ? 'inline' : 'none';
        }

        if (appConfig.showClearLogo && mediaItem.clearLogoUrl) {
            clearlogoEl.src = mediaItem.clearLogoUrl;
            clearlogoEl.classList.add('visible');
        } else {
            clearlogoEl.src = transparentPixel;
            clearlogoEl.classList.remove('visible');
        }

        // Update Rotten Tomatoes badge
        if (
            appConfig.showRottenTomatoes &&
            mediaItem.rottenTomatoes &&
            mediaItem.rottenTomatoes.score
        ) {
            const { icon } = mediaItem.rottenTomatoes;
            let iconUrl = '';
            // Use local SVG assets for reliability
            switch (icon) {
                case 'fresh':
                    iconUrl = '/icons/rt-fresh.svg';
                    break;
                case 'rotten':
                    iconUrl = '/icons/rt-rotten.svg';
                    break;
                case 'certified-fresh':
                    iconUrl = '/icons/rt-certified-fresh.svg';
                    break;
            }
            rtIcon.src = iconUrl;
            rtBadge.classList.add('visible');
            ensureRtBadgeAttached();
        } else {
            rtBadge.classList.remove('visible');
            ensureRtBadgeAttached(); // keep it mounted even when hidden
        }

        // After rendering, re-assert screensaver visibility to avoid flash->hide
        ensureScreensaverVisibility();
    }

    function updateInfo(direction, isFirstLoad = false) {
        // Robust check: ensure mediaQueue is valid and has content
        if (!mediaQueue || !Array.isArray(mediaQueue) || mediaQueue.length === 0) {
            console.warn('❌ mediaQueue is empty or invalid, cannot update info');
            return;
        }

        if (direction === 'next') {
            currentIndex = (currentIndex + 1) % mediaQueue.length;
        } else {
            // 'prev'
            currentIndex = (currentIndex - 1 + mediaQueue.length) % mediaQueue.length;
        }

        const currentMedia = mediaQueue[currentIndex];
        if (!currentMedia) {
            console.error(`❌ Invalid media item at index ${currentIndex}, skipping.`);
            changeMedia('next', false, true);
            return;
        }

        // Check if background URL is valid before loading
        if (!currentMedia.backgroundUrl) {
            console.warn('❌ No background image available, skipping to next item');
            // No background image available, skip to next item
            changeMedia('next', false, true);
            return;
        }

        // Check if current media has a valid background URL
        if (
            !currentMedia.backgroundUrl ||
            currentMedia.backgroundUrl === 'null' ||
            currentMedia.backgroundUrl === 'undefined'
        ) {
            console.warn('❌ Invalid background URL, skipping to next item');
            changeMedia('next', false, true);
            return;
        }

        const img = new Image();

        // Add timeout to prevent hanging on slow/failed image loads
        const imageTimeout = setTimeout(() => {
            console.error(`⏰ Image load TIMEOUT for: ${currentMedia.title}. Skipping to next.`);
            changeMedia('next', false, true);
        }, 10000); // 10 second timeout

        img.onerror = () => {
            clearTimeout(imageTimeout); // Clear timeout on error
            console.error(`❌ Image load ERROR for: ${currentMedia.title}`);

            // In offline mode, don't skip items - keep showing current content
            if (!navigator.onLine) {
                console.warn(
                    `📶 Background unavailable offline for: ${currentMedia.title}. Keeping current display.`
                );

                // Don't change anything - keep current content visible
                // Just update the text content if needed
                if (currentMedia.title !== titleEl.textContent) {
                    titleEl.textContent = currentMedia.title || 'Unknown Title';
                    taglineEl.textContent = currentMedia.tagline || '';
                    yearEl.textContent = currentMedia.year || '';
                }

                // IMPORTANT: Restart timer even in offline mode to prevent hanging
                if (!isPaused) {
                    restartTimer();
                }
                return;
            }

            console.error(
                `🚫 Could not load background for: ${currentMedia.title}. Skipping item.`
            );
            changeMedia('next', false, true);
        };
        img.src = currentMedia.backgroundUrl;
        img.onload = () => {
            clearTimeout(imageTimeout); // Clear timeout on successful load
            // Set the background image first
            if (inactiveLayer && inactiveLayer.style) {
                inactiveLayer.style.backgroundImage = `url('${currentMedia.backgroundUrl}')`;
            }

            // Update poster and metadata BEFORE starting background transition
            renderMediaItem(currentMedia);

            // First load: avoid any fade/kenburns to prevent black flashes
            if (isFirstLoad && inactiveLayer && activeLayer) {
                try {
                    // Mirror background to both layers for safety
                    if (activeLayer && activeLayer.style) {
                        activeLayer.style.backgroundImage = `url('${currentMedia.backgroundUrl}')`;
                    }
                    // Show the new (inactive) layer immediately
                    inactiveLayer.style.transition = 'none';
                    activeLayer.style.transition = 'none';
                    inactiveLayer.style.opacity = '1';
                    activeLayer.style.opacity = '0';
                    // Swap references so the visible one becomes the active layer
                    swapLayers(inactiveLayer, activeLayer, { preserveNewAnimation: false });
                    ensureBackgroundVisible();
                } catch (_) {
                    // intentionally empty: startup swap best-effort; proceed even on minor style errors
                }
            } else {
                // Apply transition effects with proper layering AFTER content is ready
                if (inactiveLayer && activeLayer) {
                    applyTransitionEffect(inactiveLayer, activeLayer, false);
                }
            }
            // Ensure a background is visible after scheduling transition
            ensureBackgroundVisible();
            // Extra guard: immediately show the layer with image if both are transparent
            try {
                const aOp = parseFloat(getComputedStyle(activeLayer).opacity || '1');
                const bOp = parseFloat(getComputedStyle(inactiveLayer).opacity || '1');
                if (aOp <= 0.01 && bOp <= 0.01) {
                    (inactiveLayer || activeLayer).style.opacity = '1';
                }
            } catch (_) {
                // intentionally empty: visibility guard is best-effort
            }

            if (loader && loader.style && loader.style.opacity !== '0') {
                loader.style.opacity = '0';
            }
            preloadNextImage();

            if (isFirstLoad) {
                const isScreensaver = !appConfig.cinemaMode && !appConfig.wallartMode?.enabled;
                if (isScreensaver) {
                    const posterVisible = appConfig.showPoster !== false;
                    const metaVisible = appConfig.showMetadata !== false;
                    if (posterVisible || metaVisible) {
                        infoContainer.classList.add('visible');
                    }
                } else {
                    infoContainer.classList.add('visible');
                }
            } else {
                setTimeout(() => {
                    // In screensaver mode, only show the container if at least one of poster or metadata is visible
                    const isScreensaver = !appConfig.cinemaMode && !appConfig.wallartMode?.enabled;
                    if (isScreensaver) {
                        const posterVisible = appConfig.showPoster !== false;
                        const metaVisible = appConfig.showMetadata !== false;
                        if (posterVisible || metaVisible) {
                            infoContainer.classList.add('visible');
                        }
                    } else {
                        infoContainer.classList.add('visible');
                    }

                    // Additional check for cinema mode
                    if (appConfig.cinemaMode) {
                        infoContainer.classList.add('visible');
                    }
                    // Persist visibility and badge attachment after async transition
                    ensureRtBadgeAttached();
                    ensureScreensaverVisibility();
                }, 500);
            }
            if (!isPaused) {
                // Don't restart timer here - it should already be running from changeMedia
                // startTimer(); // REMOVED - this was causing the race condition
            } else {
                // paused, do nothing
            }
        };
    }

    // Apply transition effects specifically for posters in cinema mode
    function applyPosterTransitionEffect(newPosterUrl) {
        // In admin live preview, use a smooth quick fade for posters
        if (window.IS_PREVIEW) {
            const posterA = document.getElementById('poster-a');
            const posterB = document.getElementById('poster-b');
            const layersVisible =
                posterA &&
                posterB &&
                getComputedStyle(posterA).display !== 'none' &&
                getComputedStyle(posterB).display !== 'none';

            if (!layersVisible) {
                const originalPoster = document.getElementById('poster');
                if (originalPoster) {
                    originalPoster.style.backgroundImage = `url('${newPosterUrl}')`;
                }
                return;
            }

            const currentLayer = posterA.style.opacity === '1' ? posterA : posterB;
            const newLayer = currentLayer === posterA ? posterB : posterA;
            newLayer.style.backgroundImage = `url('${newPosterUrl}')`;
            const fadeDuration = 0.45; // seconds
            newLayer.style.transition = 'none';
            currentLayer.style.transition = 'none';
            newLayer.style.opacity = '0';
            currentLayer.style.opacity = '1';
            newLayer.style.willChange = 'opacity';
            currentLayer.style.willChange = 'opacity';
            // Force reflow
            newLayer.offsetHeight;
            newLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;
            currentLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    newLayer.style.opacity = '1';
                    currentLayer.style.opacity = '0';
                });
            });
            setTimeout(() => {
                newLayer.style.transition = 'none';
                currentLayer.style.transition = 'none';
                newLayer.style.willChange = '';
                currentLayer.style.willChange = '';
            }, fadeDuration * 1000);
            return;
        }
        // Check if poster is already preloaded
        const isPreloaded = preloadedImages.posters.has(newPosterUrl);

        // Get poster layer elements
        const posterA = document.getElementById('poster-a');
        const posterB = document.getElementById('poster-b');

        // Check if layers exist and are visible (not hidden via CSS)
        const layersVisible =
            posterA &&
            posterB &&
            getComputedStyle(posterA).display !== 'none' &&
            getComputedStyle(posterB).display !== 'none';

        if (!layersVisible) {
            const originalPoster = document.getElementById('poster');

            if (originalPoster) {
                // Simplified: just set the poster immediately without complex transitions
                // This prevents timing issues with background transitions
                if (isPreloaded) {
                    // Image is preloaded, safe to set immediately
                    originalPoster.style.backgroundImage = `url('${newPosterUrl}')`;
                } else {
                    // Load image first but don't delay the update
                    const img = new Image();
                    img.onload = () => {
                        originalPoster.style.backgroundImage = `url('${newPosterUrl}')`;
                    };
                    img.onerror = () => {
                        // Keep existing poster on error
                    };
                    img.src = newPosterUrl;

                    // Set immediately anyway to prevent hanging
                    originalPoster.style.backgroundImage = `url('${newPosterUrl}')`;
                }
            }
            return;
        }

        // Get transition effect configuration
        const transitionEffect = appConfig.transitionEffect || 'none';
        const transitionInterval = appConfig.transitionIntervalSeconds || 15;
        const pauseTime =
            appConfig.effectPauseTime !== null && appConfig.effectPauseTime !== undefined
                ? appConfig.effectPauseTime
                : 2;

        // NEW LOGIC: effect duration = total interval - pause time
        const effectDuration = Math.max(1, transitionInterval - pauseTime);

        // Use same logic as screensaver mode for actual durations
        const actualDuration = effectDuration; // Use calculated effect duration
        const actualPauseTime = pauseTime; // Use full pause time

        // Determine which layer is currently active and which is new
        const currentLayer = posterA.style.opacity === '1' ? posterA : posterB;
        const newLayer = currentLayer === posterA ? posterB : posterA;

        // Set the new image on the new layer
        newLayer.style.backgroundImage = `url('${newPosterUrl}')`;

        // Clear any existing animations and reset to starting state
        newLayer.style.animation = 'none';
        newLayer.style.transition = 'none';
        newLayer.style.transform = 'none';
        newLayer.style.opacity = '0';

        // Force reflow to ensure styles are applied
        newLayer.offsetHeight;

        // Special case: if this is the first load and no layer is visible, show immediately
        if (currentLayer.style.opacity !== '1' && newLayer.style.opacity !== '1') {
            newLayer.style.opacity = '1';
            return;
        }

        if (transitionEffect === 'none') {
            newLayer.style.transition = 'opacity 0.8s ease-in-out';

            setTimeout(() => {
                newLayer.style.opacity = '1';
                currentLayer.style.opacity = '0';

                // Hold for pause time
                setTimeout(() => {
                    // Pause complete
                }, actualPauseTime * 1000);
            }, 100);
            return;
        }

        // Handle Ken Burns for posters - DISABLED for cinema mode
        if (
            transitionEffect === 'kenburns' ||
            (!appConfig.transitionEffect &&
                appConfig.kenBurnsEffect &&
                appConfig.kenBurnsEffect.enabled)
        ) {
            // Fall through to fade behavior
        }

        // Apply other effects to poster layers
        switch (transitionEffect) {
            case 'kenburns':
            // Ken Burns disabled for cinema mode - fall through to fade
            case 'fade': {
                const fadeDuration = 1.5; // Fixed short duration for fade

                // Fade in new layer while fading out old layer
                newLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;
                currentLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;

                setTimeout(() => {
                    newLayer.style.opacity = '1';
                    currentLayer.style.opacity = '0';
                }, 100);
                break;
            }

            case 'slide': {
                const slideDuration = actualDuration - actualPauseTime;

                // Only left/right slides for cinema mode with cinema-specific animations
                const slideDirections = ['cinema-slide-in-left', 'cinema-slide-in-right'];
                const slideDirection =
                    slideDirections[Math.floor(Math.random() * slideDirections.length)];

                // Set initial state for slide - new layer starts off-screen
                newLayer.style.opacity = '1';
                newLayer.style.transition = 'none';
                newLayer.style.transform = slideDirection.includes('left')
                    ? 'translateX(-100%)'
                    : 'translateX(100%)';
                newLayer.style.animation = 'none';

                // Current layer stays visible
                currentLayer.style.opacity = '1';
                currentLayer.style.transition = 'none';
                currentLayer.style.transform = 'translateX(0)';

                // Force reflow
                newLayer.offsetHeight;

                setTimeout(() => {
                    // Animate new layer sliding in
                    newLayer.style.animation = `${slideDirection} ${slideDuration}s ease-out forwards`;

                    // Animate old layer sliding out (opposite direction)
                    const slideOutDirection = slideDirection.includes('left')
                        ? 'cinema-slide-out-right'
                        : 'cinema-slide-out-left';
                    currentLayer.style.animation = `${slideOutDirection} ${slideDuration}s ease-out forwards`;

                    // After animation + pause
                    setTimeout(
                        () => {
                            newLayer.style.animation = 'none';
                            newLayer.style.transform = 'translateX(0)';
                            currentLayer.style.animation = 'none';
                            currentLayer.style.opacity = '0';
                            currentLayer.style.transform = 'translateX(0)';
                        },
                        (slideDuration + actualPauseTime) * 1000
                    );
                }, 100);
                break;
            }

            default: {
                // Fallback to fade for unimplemented effects
                newLayer.style.transition = 'opacity 1s ease-in-out';

                setTimeout(() => {
                    newLayer.style.opacity = '1';
                    currentLayer.style.opacity = '0';
                }, 100);
                break;
            }
        }
    }

    // Simple Ken Burns transition: smooth pan/zoom on newLayer with crossfade from oldLayer
    function applyKenBurnsTransition(newLayer, oldLayer, durationSec, fadeSec = 1.2) {
        // In preview, replace Ken Burns with a smooth crossfade
        if (window.IS_PREVIEW) {
            try {
                const fadeDuration = 0.7; // seconds
                if (oldLayer) {
                    oldLayer.style.transition = 'none';
                    oldLayer.style.animation = 'none';
                    oldLayer.style.opacity = 1;
                    oldLayer.style.zIndex = '1';
                    oldLayer.style.willChange = 'opacity';
                }
                newLayer.style.transition = 'none';
                newLayer.style.animation = 'none';
                newLayer.style.opacity = 0;
                newLayer.style.zIndex = '2';
                newLayer.style.willChange = 'opacity';
                newLayer.removeAttribute('data-ken-burns');
                // Force reflow
                newLayer.offsetHeight;
                newLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;
                if (oldLayer) oldLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        newLayer.style.opacity = 1;
                        if (oldLayer) oldLayer.style.opacity = 0;
                    });
                });
                setTimeout(() => {
                    newLayer.style.transition = 'none';
                    newLayer.style.zIndex = '';
                    newLayer.style.willChange = '';
                    if (oldLayer) {
                        oldLayer.style.transition = 'none';
                        oldLayer.style.zIndex = '';
                        oldLayer.style.willChange = '';
                    }
                    swapLayers(newLayer, oldLayer, { preserveNewAnimation: false });
                    ensureBackgroundVisible();
                }, fadeDuration * 1000);
            } catch (e) {
                // Intentionally empty: silencing transition errors
            }
            return;
        }
        // Prep layers
        if (oldLayer) {
            // Don't reset transform here; allow previous frame to remain until fade completes
            oldLayer.style.animation = 'none';
            oldLayer.style.opacity = 1;
            oldLayer.style.zIndex = '1';
            oldLayer.style.willChange = 'opacity, transform';
            oldLayer.style.transformOrigin = 'center center';
        }

        newLayer.style.transition = 'none';
        newLayer.style.animation = 'none';
        newLayer.style.opacity = 0; // start faded
        newLayer.style.zIndex = '2';
        newLayer.style.willChange = 'opacity, transform';
        newLayer.style.transformOrigin = 'center center';

        // Deterministic, smooth zoom-in with mild pan (avoid zoom-out illusions)
        const startScale = 1.0;
        // Read Ken Burns tuning from config with safe clamps
        const kbCfg =
            typeof appConfig !== 'undefined' && appConfig.kenBurnsEffect
                ? appConfig.kenBurnsEffect
                : {};
        const endScale = Math.max(
            1.01,
            Math.min(1.15, Number(kbCfg.endScale ?? kbCfg.zoom ?? 1.08))
        );
        // Small pan to keep motion noticeable but not jittery (percent)
        const panRange = Math.max(
            0,
            Math.min(6, Number(kbCfg.panPercentRange ?? kbCfg.pan ?? 2.0))
        );
        const rand = () => (Math.random() * panRange - panRange / 2).toFixed(2); // -1% .. 1%
        const startTx = rand();
        const startTy = rand();
        const endTx = rand();
        const endTy = rand();

        // Apply translate first, then scale to avoid translation being scaled (prevents end-of-motion snapping)
        newLayer.style.transform = `translate3d(${startTx}%, ${startTy}%, 0) scale(${startScale})`;

        // Force reflow
        newLayer.offsetHeight;

        // Guards and timers to ensure correct sequencing even under rAF throttling
        let started = false;
        let swapped = false;
        let cleaned = false;
        let swapTimer = null;
        let cleanupTimer = null;
        // Keep refs so we can remove event listeners if timeout path fires first
        let onNewFadeEndRef = null;
        let onNewTransformEndRef = null;

        function doSwap(/*trigger*/) {
            if (swapped) return;
            swapped = true;
            try {
                // Defer old layer transform reset until after it's fully faded out to prevent a visible snap
                swapLayers(newLayer, oldLayer, {
                    preserveNewAnimation: true,
                    deferOldTransformReset: true,
                    preserveOldFade: true,
                    oldFadeMs: Math.max(50, fadeSec * 1000),
                });
                if (oldLayer) {
                    oldLayer.style.zIndex = '';
                    oldLayer.style.willChange = '';
                    // Don't touch opacity here; we crossfaded earlier in startAnimation
                }
                ensureBackgroundVisible();
            } catch (e) {
                // Intentionally empty: silencing transition errors
            }
        }

        function doCleanup(/*trigger*/) {
            if (cleaned) return;
            cleaned = true;
            try {
                // Do minimal cleanup to avoid any visual snap; leave z-index and will-change as-is
                // and let the next cycle explicitly set what it needs.
                newLayer.removeAttribute('data-ken-burns');
            } catch (e) {
                // Intentionally empty: silencing transition errors
            }
        }

        const startAnimation = () => {
            if (started) return;
            started = true;
            // Mark layer as Ken Burns active so swapLayers doesn't reset its transform
            try {
                newLayer.setAttribute('data-ken-burns', 'true');
            } catch (e) {
                // Intentionally empty: silencing transition errors
            }

            // Use linear easing for constant motion and extend beyond interval with a safety tail
            const transformEasing = 'linear';
            const tailSec = Math.max(0.75, fadeSec); // ensure motion continues into the next cycle
            const motionDurationSec = durationSec + tailSec; // keeps movement during and past crossfade
            const transformTransition = `transform ${motionDurationSec}s ${transformEasing}`;
            const fadeTransition = `opacity ${fadeSec}s ease-in-out`;
            newLayer.style.transition = `${fadeTransition}, ${transformTransition}`;

            // 1) Apply end transform first (double rAF) so the new image is already moving
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    newLayer.style.transform = `translate3d(${endTx}%, ${endTy}%, 0) scale(${endScale})`;
                    // 2) On the next frame, start the crossfade; old keeps its motion, we only add opacity transition now
                    requestAnimationFrame(() => {
                        newLayer.style.opacity = 1;
                        if (oldLayer) {
                            const prev = oldLayer.style.transition || '';
                            const sep = prev && !/opacity/.test(prev) ? ', ' : '';
                            oldLayer.style.transition = `${prev}${sep}opacity ${fadeSec}s ease-in-out`;
                            oldLayer.style.opacity = 0;
                        }
                    });
                });
            });

            // Prefer event-driven swap on newLayer opacity end, with timeout fallback
            onNewFadeEndRef = ev => {
                // Accept when opacity finishes or when propertyName is empty (browser quirks)
                if (!ev || !ev.propertyName || ev.propertyName === 'opacity') {
                    if (swapTimer) {
                        clearTimeout(swapTimer);
                        swapTimer = null;
                    }
                    doSwap('transitionend(opacity)');
                }
            };
            newLayer.addEventListener('transitionend', onNewFadeEndRef, { once: true });
            // No timeout fallback for swap; we want to swap strictly on the fade end to avoid early snaps

            // Cleanup on transform end for newLayer, with timeout fallback
            onNewTransformEndRef = ev => {
                // Accept when transform finishes or when propertyName is empty (browser quirks)
                if (!ev || !ev.propertyName || ev.propertyName === 'transform') {
                    if (cleanupTimer) {
                        clearTimeout(cleanupTimer);
                        cleanupTimer = null;
                    }
                    doCleanup('transitionend(transform)');
                }
            };
            // Don't use once:true here because the first transitionend fired will be for opacity;
            // we only want to act when the transform transition finishes. We'll remove the
            // listener ourselves when that happens.
            newLayer.addEventListener('transitionend', onNewTransformEndRef);
            cleanupTimer = setTimeout(
                () => {
                    try {
                        if (onNewTransformEndRef)
                            newLayer.removeEventListener('transitionend', onNewTransformEndRef);
                    } catch (e) {
                        // Intentionally empty: silencing transition errors
                    }
                    doCleanup('timeout');
                },
                Math.max(100, motionDurationSec * 1000)
            );
        };

        // Transition with double rAF and a setTimeout fallback for background tabs
        requestAnimationFrame(() => {
            requestAnimationFrame(startAnimation);
        });
        setTimeout(() => {
            if (!started) {
                startAnimation();
            }
        }, 120);
    }

    // Apply transition effects based on configuration
    function applyTransitionEffect(newLayer, oldLayer, isPoster = false) {
        // Clear any existing animation classes
        newLayer.className = newLayer.className.replace(/\beffect-\w+\b/g, '');
        newLayer.style.animation = 'none';
        newLayer.style.transition = 'none';

        // In admin live preview, use a smoother crossfade for stability
        if (window.IS_PREVIEW) {
            try {
                const fadeDuration = 0.7; // seconds
                newLayer.style.willChange = 'opacity';
                newLayer.style.opacity = 0;
                newLayer.style.zIndex = '2';
                if (oldLayer) {
                    oldLayer.style.willChange = 'opacity';
                    oldLayer.style.opacity = 1;
                    oldLayer.style.zIndex = '1';
                }
                // Force reflow
                newLayer.offsetHeight;
                newLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;
                if (oldLayer) oldLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        newLayer.style.opacity = 1;
                        if (oldLayer) oldLayer.style.opacity = 0;
                    });
                });
                setTimeout(() => {
                    newLayer.style.transition = 'none';
                    newLayer.style.willChange = '';
                    newLayer.style.zIndex = '';
                    if (oldLayer) {
                        oldLayer.style.transition = 'none';
                        oldLayer.style.willChange = '';
                        oldLayer.style.zIndex = '';
                    }
                    swapLayers(newLayer, oldLayer, { preserveNewAnimation: false });
                    ensureBackgroundVisible();
                }, fadeDuration * 1000);
            } catch (e) {
                // Intentionally empty: silencing transition errors
            }
            return;
        }

        // Get transition effect configuration
        const transitionEffect = appConfig.transitionEffect || 'none';
        const transitionInterval = appConfig.transitionIntervalSeconds || 15;
        const pauseTime =
            appConfig.effectPauseTime !== null && appConfig.effectPauseTime !== undefined
                ? appConfig.effectPauseTime
                : 2;

        // NEW LOGIC: effect duration = total interval - pause time
        const effectDuration = Math.max(1, transitionInterval - pauseTime);

        // For posters in cinema mode, use shorter duration for better UX
        const actualDuration = isPoster ? effectDuration : effectDuration;
        const actualPauseTime = isPoster ? pauseTime : pauseTime;

        if (transitionEffect === 'none') {
            // For 'none', do a short, safe crossfade to avoid popping
            const fadeDuration = 0.5;
            newLayer.style.opacity = 0;
            newLayer.style.transition = 'none';
            newLayer.style.willChange = 'opacity, transform';
            newLayer.style.zIndex = '2';
            if (oldLayer) {
                oldLayer.style.willChange = 'opacity, transform';
                oldLayer.style.transition = 'none';
                oldLayer.style.opacity = 1;
                oldLayer.style.zIndex = '1';
            }

            // Force reflow
            newLayer.offsetHeight;

            requestAnimationFrame(() => {
                // Set transitions in a separate frame to ensure GPU compositing
                newLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;
                if (oldLayer) oldLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;

                requestAnimationFrame(() => {
                    newLayer.style.opacity = 1;
                    if (oldLayer) oldLayer.style.opacity = 0;

                    // Swap layers after transition + pause
                    setTimeout(
                        () => {
                            // Cleanup
                            newLayer.style.willChange = '';
                            newLayer.style.zIndex = '';
                            if (oldLayer) {
                                oldLayer.style.willChange = '';
                                oldLayer.style.zIndex = '';
                            }
                            swapLayers(newLayer, oldLayer);
                            ensureBackgroundVisible();
                        },
                        (fadeDuration + actualPauseTime) * 1000
                    );
                });
            });
            return;
        }

        // Ken Burns: modern simple path OR legacy flag -> use the same helper
        const kenBurnsRequested =
            transitionEffect === 'kenburns' ||
            (!appConfig.transitionEffect &&
                appConfig.kenBurnsEffect &&
                appConfig.kenBurnsEffect.enabled);
        if (kenBurnsRequested) {
            const durationSec = transitionInterval; // full interval for motion
            const fadeSec = 1.2; // crossfade duration
            applyKenBurnsTransition(newLayer, oldLayer, durationSec, fadeSec);
            return;
        }

        // Apply the selected effect with proper layering
        switch (transitionEffect) {
            case 'fade': {
                // Smooth crossfade with compositor-friendly hints
                const fadeDuration = 1.2; // slightly shorter for smoother feel
                newLayer.style.opacity = 0;
                newLayer.style.transition = 'none';
                newLayer.style.willChange = 'opacity, transform';
                newLayer.style.zIndex = '2';
                if (oldLayer) {
                    oldLayer.style.transition = 'none';
                    oldLayer.style.willChange = 'opacity, transform';
                    oldLayer.style.opacity = 1;
                    oldLayer.style.zIndex = '1';
                }

                // Force reflow
                newLayer.offsetHeight;

                requestAnimationFrame(() => {
                    newLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;
                    if (oldLayer)
                        oldLayer.style.transition = `opacity ${fadeDuration}s ease-in-out`;

                    requestAnimationFrame(() => {
                        newLayer.style.opacity = 1;
                        if (oldLayer) oldLayer.style.opacity = 0;

                        // Swap layers after short fade
                        setTimeout(() => {
                            // Cleanup and finalize
                            newLayer.style.willChange = '';
                            newLayer.style.zIndex = '';
                            if (oldLayer) {
                                oldLayer.style.willChange = '';
                                oldLayer.style.zIndex = '';
                            }
                            swapLayers(newLayer, oldLayer);
                            ensureBackgroundVisible();
                        }, fadeDuration * 1000);
                    });
                });
                break;
            }

            case 'slide': {
                // Slide using explicit transforms to avoid initial fullscreen flash
                const directions = ['left', 'right', 'up', 'down'];
                const dir = directions[Math.floor(Math.random() * directions.length)];

                // Ensure old layer is visible and positioned correctly as background
                if (oldLayer) {
                    oldLayer.style.transform = 'none';
                    oldLayer.style.animation = 'none';
                    oldLayer.style.transition = 'none';
                    oldLayer.style.opacity = 1;
                    oldLayer.style.willChange = 'opacity, transform';
                    oldLayer.style.zIndex = '1';
                }

                // Prepare new layer offscreen
                newLayer.style.opacity = 1; // Keep visible during slide
                newLayer.style.transition = 'none';
                const offscreen =
                    dir === 'left'
                        ? 'translateX(-100%)'
                        : dir === 'right'
                          ? 'translateX(100%)'
                          : dir === 'up'
                            ? 'translateY(-100%)'
                            : 'translateY(100%)';
                newLayer.style.transform = offscreen;
                newLayer.style.animation = 'none';
                newLayer.style.willChange = 'opacity, transform';
                newLayer.style.zIndex = '2';
                if (oldLayer) oldLayer.style.zIndex = '1';

                // Force reflow
                newLayer.offsetHeight;

                // Transition both layers with double rAF to ensure compositor-friendly start
                requestAnimationFrame(() => {
                    const easing = 'ease-out';
                    newLayer.style.transition = `transform ${actualDuration}s ${easing}, opacity ${actualDuration}s ${easing}`;
                    if (oldLayer) {
                        oldLayer.style.transition = `transform ${actualDuration}s ${easing}, opacity ${actualDuration}s ${easing}`;
                    }
                    requestAnimationFrame(() => {
                        // Slide new layer into place
                        newLayer.style.transform = 'translateX(0)';
                        if (dir === 'up' || dir === 'down') {
                            newLayer.style.transform = 'translateY(0)';
                        }
                        // Slide old layer slightly out and fade it
                        if (oldLayer) {
                            const out =
                                dir === 'left'
                                    ? 'translateX(20%)'
                                    : dir === 'right'
                                      ? 'translateX(-20%)'
                                      : dir === 'up'
                                        ? 'translateY(20%)'
                                        : 'translateY(-20%)';
                            oldLayer.style.transform = out;
                            oldLayer.style.opacity = 0;
                        }
                    });
                });

                // After animation completes, clean up
                setTimeout(() => {
                    // Reset new layer
                    newLayer.style.transition = 'none';
                    newLayer.style.animation = 'none';
                    newLayer.style.transform = 'none';
                    newLayer.style.opacity = 1;
                    newLayer.style.zIndex = '';
                    newLayer.style.willChange = '';

                    // Reset old layer
                    if (oldLayer) {
                        oldLayer.style.transition = 'none';
                        oldLayer.style.animation = 'none';
                        oldLayer.style.transform = 'none';
                        oldLayer.style.opacity = 0;
                        oldLayer.style.zIndex = '';
                        oldLayer.style.willChange = '';
                    }

                    // Swap global refs and ensure visibility
                    const tempLayer = activeLayer;
                    activeLayer = inactiveLayer;
                    inactiveLayer = tempLayer;
                    ensureBackgroundVisible();
                }, actualDuration * 1000);

                return; // Exit early to avoid the swapLayers call at the end
            }

            default: {
                logger.warn(`Unknown transition effect: ${transitionEffect}`);
                // Fallback to simple crossfade
                newLayer.style.opacity = 0;
                newLayer.style.transition = 'opacity 1s ease-in-out';

                requestAnimationFrame(() => {
                    newLayer.style.opacity = 1;
                    if (oldLayer) {
                        oldLayer.style.opacity = 0;
                    }

                    setTimeout(
                        () => {
                            swapLayers(newLayer, oldLayer);
                            ensureBackgroundVisible();
                        },
                        (1 + actualPauseTime) * 1000
                    );
                });
                break;
            }
        }
    }

    // Helper function to swap layers after transition
    function swapLayers(newLayer, oldLayer, options = {}) {
        const preserveNewAnimation = options.preserveNewAnimation === true;
        const deferOldTransformReset = options.deferOldTransformReset === true;
        const preserveOldFade = options.preserveOldFade === true;
        const oldFadeMs = typeof options.oldFadeMs === 'number' ? options.oldFadeMs : 200;
        if (oldLayer) {
            // Reset old layer completely
            oldLayer.style.animation = 'none';
            // Preserve ongoing opacity transition if requested, otherwise drop transitions
            if (!preserveOldFade) {
                oldLayer.style.transition = 'none';
            }
            // Don't force opacity here if it's already fading; leave as-is
            // Optionally defer transform reset to avoid a visible snap right at swap time
            if (!deferOldTransformReset) {
                oldLayer.style.transform = 'none'; // Reset any transforms from animations immediately
            } else {
                // Reset transform after the opacity transition actually ends
                const handler = ev => {
                    if (!ev || ev.propertyName === 'opacity') {
                        oldLayer.removeEventListener('transitionend', handler);
                        oldLayer.style.transform = 'none';
                        // Clear transition after fade is done to avoid lingering style
                        if (!preserveOldFade) oldLayer.style.transition = 'none';
                    }
                };
                oldLayer.addEventListener('transitionend', handler);
                // Fallback in case transitionend is missed
                setTimeout(() => {
                    oldLayer.removeEventListener('transitionend', handler);
                    oldLayer.style.transform = 'none';
                    if (!preserveOldFade) oldLayer.style.transition = 'none';
                }, oldFadeMs + 50);
            }
            oldLayer.removeAttribute('data-ken-burns'); // Clean up Ken Burns marker
        }

        // Reset new layer transitions but keep it visible ONLY if it's not faded out from Ken Burns
        if (!preserveNewAnimation) {
            newLayer.style.transition = 'none';
            newLayer.style.animation = 'none';
        }

        // Only reset transform if NOT a Ken Burns layer that's still animating
        const kbActiveOnNew =
            newLayer.hasAttribute('data-ken-burns') &&
            newLayer.getAttribute('data-ken-burns') !== 'false';
        if (!kbActiveOnNew && !preserveNewAnimation) {
            newLayer.style.transform = 'none'; // Reset any transforms from animations
        }

        // IMPORTANT: Don't force opacity to 1 if layer was intentionally faded out
        // This prevents the "flash back to visible" issue
        if (newLayer.style.opacity !== '0') {
            newLayer.style.opacity = 1; // Only ensure visibility if not faded out
        }

        // Update global layer references
        const tempLayer = activeLayer;
        activeLayer = inactiveLayer;
        inactiveLayer = tempLayer;
    }

    function changeMedia(direction = 'next', isFirstLoad = false, isErrorSkip = false) {
        if (mediaQueue.length === 0) {
            console.warn('❌ mediaQueue is empty');
            return;
        }

        // In offline mode, don't cycle through media unless it's the first load
        if (!navigator.onLine && !isFirstLoad) {
            console.warn('📶 Offline mode: Keeping current media displayed');
            return;
        }

        // Don't change media in wallart mode (wallart has its own system)
        if (document.body.classList.contains('wallart-mode') && !isFirstLoad) {
            return;
        }

        // Always clear timer when changing media to prevent timing conflicts
        if (timerId) {
            clearInterval(timerId);
            timerId = null;
        }

        // Hide info immediately to prepare for the new content
        if (!isErrorSkip) {
            // In cinema mode, don't hide the info container
            if (!appConfig.cinemaMode) {
                infoContainer.classList.remove('visible');
            }
            clearlogoEl.classList.remove('visible');
            rtBadge.classList.remove('visible'); // Hide RT badge
            ensureRtBadgeAttached();
        }
        if (isFirstLoad) {
            updateInfo(direction, true);
        } else {
            setTimeout(
                () => {
                    updateInfo(direction);
                    // Ensure timer is running after update
                    if (!isPaused && !timerId) {
                        startTimer();
                    }
                },
                isErrorSkip ? 0 : 300
            );
        }
    }

    function restartTimer() {
        // Always clear existing timer first
        if (timerId) {
            clearInterval(timerId);
            timerId = null;
        }
        startTimer();
    }

    function startTimer() {
        // Don't start slideshow timer in wallart mode
        if (document.body.classList.contains('wallart-mode')) {
            return;
        }

        // If a timer is already running and we're not explicitly restarting, don't interfere
        if (timerId) {
            return;
        }

        // Calculate total time including effect duration + pause time
        const transitionInterval = appConfig.transitionIntervalSeconds || 15;

        // Total interval should be: effect duration + pause time
        // But if user sets a specific interval, respect that as the total time
        const totalInterval = transitionInterval; // User sets total time
        const interval = totalInterval * 1000;

        timerId = setInterval(() => {
            try {
                changeMedia('next');
            } catch (error) {
                console.error(`❌ Error in timer callback:`, error);
                // Try to restart the timer
                timerId = null; // Clear the broken timer first
                startTimer();
            }
        }, interval);
        // Removed verbose timer logs to keep console clean
    }

    function updateClock() {
        // Check if clock elements exist
        if (!timeHours || !timeMinutes) {
            return;
        }

        const now = new Date();

        // Get timezone and format from config
        const timezone = appConfig.clockTimezone || 'auto';
        const format = appConfig.clockFormat || '24h';

        const timeOptions = {
            hour: '2-digit',
            minute: '2-digit',
            hour12: format === '12h',
        };

        // Apply timezone if not 'auto'
        if (timezone !== 'auto') {
            timeOptions.timeZone = timezone;
        }

        try {
            // Try primary method with browser compatibility check
            let timeString;
            if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
                // Use Intl.DateTimeFormat for better browser compatibility
                const formatter = new Intl.DateTimeFormat('en-US', timeOptions);
                timeString = formatter.format(now);
            } else {
                // Fallback to toLocaleTimeString
                timeString = now.toLocaleTimeString('en-US', timeOptions);
            }

            if (format === '12h') {
                // For 12h format, split time and AM/PM
                const parts = timeString.split(' ');
                const timePart = parts[0];
                const ampm = parts[1];

                const [hours, minutes] = timePart.split(':');
                timeHours.textContent = hours;
                timeMinutes.textContent = minutes;

                // Add AM/PM indicator if not already present
                let ampmElement = document.getElementById('time-ampm');
                if (!ampmElement) {
                    ampmElement = document.createElement('span');
                    ampmElement.id = 'time-ampm';
                    ampmElement.className = 'time-ampm';
                    document.getElementById('time-widget').appendChild(ampmElement);
                }
                ampmElement.textContent = ampm;
            } else {
                // For 24h format, just use hours and minutes
                const [hours, minutes] = timeString.split(':');
                timeHours.textContent = hours;
                timeMinutes.textContent = minutes;

                // Remove AM/PM indicator if present
                const ampmElement = document.getElementById('time-ampm');
                if (ampmElement) {
                    ampmElement.remove();
                }
            }
        } catch (error) {
            // Fallback to basic formatting if timezone is invalid
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            timeHours.textContent = hours;
            timeMinutes.textContent = minutes;
        }
    }

    if (pauseButton) {
        pauseButton.addEventListener('click', () => {
            isPaused = !isPaused;
            pauseButton.classList.toggle('is-paused', isPaused);
            if (isPaused) {
                clearInterval(timerId);
                if (activeLayer) activeLayer.style.animationPlayState = 'paused';
            } else {
                startTimer();
                if (activeLayer) activeLayer.style.animationPlayState = 'running';
            }
        });
    }

    if (nextButton) nextButton.addEventListener('click', () => changeMedia('next'));
    if (prevButton) prevButton.addEventListener('click', () => changeMedia('prev'));

    document.addEventListener('keydown', e => {
        showControls();
        if (e.key === 'ArrowRight') {
            changeMedia('next');
        } else if (e.key === 'ArrowLeft') {
            changeMedia('prev');
        } else if (e.key === ' ') {
            e.preventDefault();
            if (pauseButton) pauseButton.click();
        }
    });

    // Show controls on mouse movement or touch, and hide them after a few seconds.
    function showControls() {
        if (controlsContainer) {
            controlsContainer.classList.add('visible');
        }
        document.body.style.cursor = 'default';
        clearTimeout(controlsTimer);
        controlsTimer = setTimeout(() => {
            if (controlsContainer) {
                controlsContainer.classList.remove('visible');
            }
            document.body.style.cursor = 'none';
        }, 3000);
    }

    document.body.addEventListener('mousemove', showControls);
    document.body.addEventListener('touchstart', showControls, { passive: true });

    // Initialize network monitoring
    function initNetworkMonitoring() {
        window.addEventListener('online', () => {
            logger.info('Network connection restored');
            showNetworkStatus('online');
        });

        window.addEventListener('offline', () => {
            logger.warn('Network connection lost');
            showNetworkStatus('offline');
        });
    }

    // Initialize network monitoring
    initNetworkMonitoring();

    initialize();

    // --- Swipe functionality for touchscreens ---

    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    const swipeThreshold = 50; // Minimum *horizontal* distance in pixels for a swipe

    function handleSwipe() {
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;

        // Check if the movement is primarily horizontal
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // Check if the swipe is long enough
            if (Math.abs(deltaX) > swipeThreshold) {
                if (deltaX < 0) {
                    // Swipe left -> Next media
                    changeMedia('next');
                } else {
                    // Swipe right -> Previous media
                    changeMedia('prev');
                }
            }
        }
    }

    document.addEventListener(
        'touchend',
        e => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            handleSwipe();
        },
        { passive: true }
    );

    document.addEventListener(
        'touchstart',
        e => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        },
        { passive: true }
    );

    // Export updateClock function for promo site clock synchronization
    window.updateClock = updateClock;
});
