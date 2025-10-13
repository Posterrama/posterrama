// Screensaver module: extracted helpers from script.js for screensaver-specific behavior
(function initScreensaverModule() {
    try {
        // Define a single namespace on window to avoid globals
        const _state = {
            ensureTimer: null,
            started: false,
            cycleTimer: null,
            idx: -1,
        };
        const api = {
            // Lifecycle: start screensaver helpers (idempotent)
            start() {
                try {
                    if (_state.started) return;
                    _state.started = true;
                    // Ensure visibility now and on interval in case config changes async
                    api.ensureVisibility();
                    if (_state.ensureTimer) clearInterval(_state.ensureTimer);
                    _state.ensureTimer = setInterval(() => {
                        try {
                            api.ensureVisibility();
                        } catch (_) {
                            /* noop */
                        }
                    }, 4000);
                    // Reinitialize background layers once on start
                    setTimeout(() => {
                        try {
                            api.reinitBackground();
                            api.startCycler();
                        } catch (_) {
                            /* noop */
                        }
                    }, 50);
                } catch (_) {
                    /* noop */
                }
            },
            // Lifecycle: stop screensaver helpers
            stop() {
                try {
                    if (_state.ensureTimer) {
                        clearInterval(_state.ensureTimer);
                        _state.ensureTimer = null;
                    }
                    if (_state.cycleTimer) {
                        clearInterval(_state.cycleTimer);
                        _state.cycleTimer = null;
                    }
                    _state.started = false;
                } catch (_) {
                    /* noop */
                }
            },
            // Start background cycling using appConfig.transitionEffect/transitionIntervalSeconds
            startCycler() {
                try {
                    if (_state.cycleTimer) {
                        clearInterval(_state.cycleTimer);
                        _state.cycleTimer = null;
                    }
                    // Determine interval and effect
                    const intervalMs = Math.max(
                        5000,
                        Math.floor((window.appConfig?.transitionIntervalSeconds || 10) * 1000)
                    );
                    _state.cycleTimer = setInterval(() => {
                        try {
                            api.showNextBackground();
                        } catch (_) {
                            /* noop */
                        }
                    }, intervalMs);
                    // Kick an immediate advance if we already have a background set
                    setTimeout(() => {
                        try {
                            api.showNextBackground();
                        } catch (_) {
                            /* noop: startCycler best-effort */
                        }
                    }, 10);
                } catch (_) {
                    /* noop */
                }
            },
            // Advance to next media item and transition layers
            showNextBackground() {
                try {
                    const la = document.getElementById('layer-a');
                    const lb = document.getElementById('layer-b');
                    if (!la || !lb) return;

                    const items = Array.isArray(window.mediaQueue) ? window.mediaQueue : [];
                    const total = items.length;
                    if (total === 0) return; // nothing to do

                    // Next index
                    _state.idx = (_state.idx + 1) % Math.max(total, 1);
                    const nextItem = items[_state.idx] || items[0];
                    const nextUrl = nextItem?.backgroundUrl || null;
                    if (!nextUrl || nextUrl === 'null' || nextUrl === 'undefined') return;

                    // Choose inactive/active layers from globals if present
                    const active = window.activeLayer || la;
                    const inactive = window.inactiveLayer || lb;

                    // Preload next image before switching
                    const img = new Image();
                    img.onload = () => {
                        try {
                            // Configure effect
                            const effect = String(
                                window.appConfig?.transitionEffect || 'kenburns'
                            ).toLowerCase();
                            const intervalMs = Math.max(
                                5000,
                                Math.floor(
                                    (window.appConfig?.transitionIntervalSeconds || 10) * 1000
                                )
                            );

                            // Reset styles on inactive before applying new bg/effect
                            inactive.style.animation = 'none';
                            inactive.removeAttribute('data-ken-burns');
                            inactive.style.transition = 'none';
                            inactive.style.transform = 'none';
                            inactive.style.opacity = '0';

                            // Set background on inactive layer
                            inactive.style.backgroundImage = `url('${nextUrl}')`;

                            if (effect === 'fade' || effect === 'none') {
                                // Simple crossfade
                                inactive.style.transition = 'opacity 1.5s ease-in-out';
                                // Start transition on next tick
                                requestAnimationFrame(() => {
                                    inactive.style.opacity = '1';
                                    active.style.opacity = '0';
                                });
                            } else if (
                                effect === 'slide' ||
                                effect === 'slideleft' ||
                                effect === 'slideup'
                            ) {
                                // Minimal slide: translate inactive in, active out
                                const isUp = effect.includes('up');
                                inactive.style.transition = 'transform 1s ease, opacity 1.2s ease';
                                active.style.transition = 'transform 1s ease, opacity 1.2s ease';
                                inactive.style.transform = isUp
                                    ? 'translateY(10vh)'
                                    : 'translateX(10vw)';
                                inactive.style.opacity = '0.001';
                                requestAnimationFrame(() => {
                                    inactive.style.transform = 'translate3d(0,0,0)';
                                    inactive.style.opacity = '1';
                                    active.style.transform = isUp
                                        ? 'translateY(-10vh)'
                                        : 'translateX(-10vw)';
                                    active.style.opacity = '0';
                                });
                            } else {
                                // Ken Burns: pick a random keyframe and duration ~= interval
                                const kbNames = [
                                    'kenburns-zoom-in-tl',
                                    'kenburns-zoom-in-tr',
                                    'kenburns-zoom-in-bl',
                                    'kenburns-zoom-in-br',
                                    'kenburns-zoom-out-tl',
                                    'kenburns-zoom-out-tr',
                                    'kenburns-zoom-out-bl',
                                    'kenburns-zoom-out-br',
                                ];
                                const name = kbNames[Math.floor(Math.random() * kbNames.length)];
                                const durSec = Math.max(5, Math.round(intervalMs / 1000));
                                inactive.setAttribute('data-ken-burns', 'true');
                                inactive.style.animation = `${name} ${durSec}s ease-in-out forwards`;
                                // Crossfade while KB plays
                                inactive.style.transition = 'opacity 1.5s ease-in-out';
                                requestAnimationFrame(() => {
                                    inactive.style.opacity = '1';
                                    active.style.opacity = '0';
                                });
                            }

                            // After transition, swap roles
                            setTimeout(() => {
                                try {
                                    window.activeLayer = inactive;
                                    window.inactiveLayer = active;
                                } catch (_) {
                                    /* noop: layer swap best-effort */
                                }
                            }, 1600);
                        } catch (_) {
                            /* noop */
                        }
                    };
                    img.src = nextUrl;
                } catch (_) {
                    /* noop */
                }
            },
            // Helper: in screensaver mode, re-assert visibility of poster/metadata/info container
            ensureVisibility() {
                try {
                    const isScreensaver =
                        !window.appConfig?.cinemaMode && !window.appConfig?.wallartMode?.enabled;
                    if (!isScreensaver) return;
                    const posterVisible = window.appConfig?.showPoster !== false;
                    const metaVisible = window.appConfig?.showMetadata !== false;

                    const infoContainer = document.getElementById('info-container');
                    const posterWrapper = document.getElementById('poster-wrapper');
                    const textWrapper = document.getElementById('text-wrapper');

                    // Toggle poster and metadata wrappers
                    if (posterWrapper) posterWrapper.classList.toggle('is-hidden', !posterVisible);
                    if (textWrapper) textWrapper.classList.toggle('is-hidden', !metaVisible);

                    // If any is visible, ensure the container is shown
                    if (posterVisible || metaVisible) {
                        if (infoContainer) {
                            infoContainer.classList.add('visible');
                            // Also guard against inline display:none from previous modes
                            if (infoContainer.style.display === 'none') {
                                infoContainer.style.display = 'flex';
                            }
                        }
                    } else if (infoContainer) {
                        // Hide the container when nothing should be shown
                        infoContainer.classList.remove('visible');
                    }
                } catch (_) {
                    /* noop: visibility update is best-effort */
                }
            },

            // Helper: detect if a Ken Burns animation is currently active on either layer
            isKenBurnsActive() {
                try {
                    // In admin live preview, pretend no Ken Burns is active
                    if (window.IS_PREVIEW) return false;
                    const la = document.getElementById('layer-a');
                    const lb = document.getElementById('layer-b');
                    if (!la || !lb) return false;
                    return (
                        (la.hasAttribute('data-ken-burns') &&
                            la.getAttribute('data-ken-burns') !== 'false') ||
                        (lb.hasAttribute('data-ken-burns') &&
                            lb.getAttribute('data-ken-burns') !== 'false')
                    );
                } catch (_) {
                    return false; // Return false if an error occurs
                }
            },

            // Helper: force-initialize background layers when returning to screensaver mode
            // NOTE: If Ken Burns is active, defer reinit to avoid visible transform snaps.
            reinitBackground() {
                try {
                    const isScreensaver =
                        !window.appConfig?.cinemaMode && !window.appConfig?.wallartMode?.enabled;
                    if (!isScreensaver) return;

                    // If Ken Burns is currently active on any layer, postpone reinit slightly.
                    if (api.isKenBurnsActive()) {
                        // Debounced retry to avoid stacking timers
                        if (window._reinitRetryTimer) {
                            clearTimeout(window._reinitRetryTimer);
                            window._reinitRetryTimer = null;
                        }
                        window._reinitRetryTimer = setTimeout(() => {
                            window._reinitRetryTimer = null;
                            try {
                                if (
                                    !api.isKenBurnsActive() &&
                                    !window.appConfig?.cinemaMode &&
                                    !window.appConfig?.wallartMode?.enabled
                                ) {
                                    api.reinitBackground();
                                }
                            } catch (_) {
                                /* noop: best-effort retry */
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
                    try {
                        if (Array.isArray(window.mediaQueue) && window.mediaQueue.length > 0) {
                            const idx =
                                typeof window.currentIndex === 'number' && window.currentIndex >= 0
                                    ? window.currentIndex
                                    : 0;
                            mediaItem = window.mediaQueue[idx] || window.mediaQueue[0];
                        }
                    } catch (_) {
                        /* noop: media queue best-effort */ void 0;
                    }

                    if (mediaItem && mediaItem.backgroundUrl) {
                        const bg = mediaItem.backgroundUrl;
                        if (bg && bg !== 'null' && bg !== 'undefined') {
                            la.style.backgroundImage = `url('${bg}')`;
                            // Preload lb with the same image as a safe fallback; it will be replaced on next cycle
                            lb.style.backgroundImage = `url('${bg}')`;
                        } else {
                            la.style.backgroundImage = '';
                            lb.style.backgroundImage = '';
                        }
                    }

                    // Make sure the visible layer shows immediately
                    la.style.transition = 'none';
                    lb.style.transition = 'none';
                    la.style.opacity = '1';
                    lb.style.opacity = '0';

                    // Reset references to a known state
                    window.activeLayer = la;
                    window.inactiveLayer = lb;
                    // Set initial index so the first advance picks the next item correctly
                    try {
                        const items = Array.isArray(window.mediaQueue) ? window.mediaQueue : [];
                        if (items.length > 0) {
                            const initialIdx =
                                typeof window.currentIndex === 'number' && window.currentIndex >= 0
                                    ? window.currentIndex
                                    : 0;
                            _state.idx = initialIdx;
                        }
                    } catch (_) {
                        /* noop: set initial index */
                    }
                } catch (_) {
                    /* noop: reinit is best-effort */ void 0;
                }
            },
        };

        // Attach to window; only on the screensaver page we actually use it, on others wrappers will no-op
        window.PosterramaScreensaver = api;

        if (
            document.body &&
            document.body.dataset.mode === 'screensaver' &&
            window.POSTERRAMA_DEBUG
        ) {
            console.log('[Screensaver] module loaded');
        }
    } catch (e) {
        if (window && window.console) console.debug('[Screensaver] module init error');
    }
})();
