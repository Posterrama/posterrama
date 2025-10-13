// Screensaver module: extracted helpers from script.js for screensaver-specific behavior
(function initScreensaverModule() {
    try {
        // Define a single namespace on window to avoid globals
        const _state = {
            ensureTimer: null,
            started: false,
            cycleTimer: null,
            idx: -1,
            paused: false,
        };
        // Small helpers for DOM access
        const $ = sel => document.getElementById(sel);
        const setText = (id, val) => {
            try {
                const el = $(id);
                if (!el) return;
                el.textContent = val || '';
            } catch (_) {
                /* noop */
            }
        };
        const showEl = (id, show, display = 'block') => {
            try {
                const el = $(id);
                if (!el) return;
                el.style.display = show ? display : 'none';
                el.classList.toggle('is-hidden', !show);
            } catch (_) {
                /* noop */
            }
        };
        const setPoster = url => {
            try {
                const a = $('poster-a');
                const b = $('poster-b');
                if (!a || !b) return;
                // Choose which is inactive by opacity
                const aVisible = (a.style.opacity || '') === '1';
                const inactive = aVisible ? b : a;
                const active = aVisible ? a : b;
                if (!url) {
                    a.style.backgroundImage = '';
                    b.style.backgroundImage = '';
                    return;
                }
                inactive.style.transition = 'opacity 0.8s ease-in-out';
                active.style.transition = 'opacity 0.8s ease-in-out';
                inactive.style.backgroundImage = `url('${url}')`;
                // Start crossfade on next frame
                requestAnimationFrame(() => {
                    inactive.style.opacity = '1';
                    active.style.opacity = '0';
                });
            } catch (_) {
                /* noop */
            }
        };
        const setClearlogo = url => {
            try {
                const el = $('clearlogo');
                if (!el) return;
                if (url) {
                    el.src = url;
                    el.style.opacity = '1';
                } else {
                    el.removeAttribute('src');
                    el.style.opacity = '0';
                }
            } catch (_) {
                /* noop */
            }
        };
        const updateInfo = item => {
            try {
                const metaVisible = window.appConfig?.showMetadata !== false;
                const posterVisible = window.appConfig?.showPoster !== false;
                // Title and tagline
                setText('title', item?.title || '');
                setText('tagline', item?.tagline || '');
                setText('year', item?.year ? String(item.year) : '');
                setText('rating', item?.contentRating || item?.officialRating || '');
                // Poster
                if (posterVisible && item?.posterUrl) {
                    setPoster(item.posterUrl);
                    showEl('poster-wrapper', true, 'block');
                } else {
                    showEl('poster-wrapper', false);
                }
                // Clearlogo
                setClearlogo(item?.clearLogoUrl || item?.clearlogo || '');
                // Container visibility
                const infoContainer = $('info-container');
                if (infoContainer) {
                    const show = metaVisible || (posterVisible && !!item?.posterUrl);
                    infoContainer.classList.toggle('visible', show);
                    infoContainer.style.display = show ? 'flex' : 'none';
                }
            } catch (_) {
                /* noop */
            }
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
                    // Playback exposure for device mgmt
                    try {
                        window.__posterramaPlayback = {
                            next: () => {
                                try {
                                    _state.paused = false;
                                    api.showNextBackground({ forceNext: true });
                                } catch (_) {
                                    /* noop */
                                }
                            },
                            prev: () => {
                                try {
                                    _state.paused = false;
                                    const items = Array.isArray(window.mediaQueue)
                                        ? window.mediaQueue
                                        : [];
                                    if (items.length) {
                                        _state.idx = (_state.idx - 1 + items.length) % items.length;
                                    }
                                    api.showNextBackground({ keepIndex: true });
                                } catch (_) {
                                    /* noop */
                                }
                            },
                            pause: () => {
                                _state.paused = true;
                                try {
                                    window.__posterramaPaused = true;
                                } catch (_) {
                                    /* noop */
                                }
                            },
                            resume: () => {
                                _state.paused = false;
                                try {
                                    window.__posterramaPaused = false;
                                } catch (_) {
                                    /* noop */
                                }
                                api.showNextBackground({ forceNext: true });
                            },
                        };
                    } catch (_) {
                        /* noop */
                    }
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
                            if (_state.paused) return;
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
            showNextBackground(opts = {}) {
                try {
                    const la = document.getElementById('layer-a');
                    const lb = document.getElementById('layer-b');
                    if (!la || !lb) return;

                    const items = Array.isArray(window.mediaQueue) ? window.mediaQueue : [];
                    const total = items.length;
                    if (total === 0) return; // nothing to do

                    // Next index
                    if (opts.keepIndex) {
                        _state.idx = Math.max(0, Math.min(_state.idx, total - 1));
                    } else if (opts.forceNext) {
                        _state.idx = (_state.idx + 1) % Math.max(total, 1);
                    } else {
                        _state.idx = (_state.idx + 1) % Math.max(total, 1);
                    }
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
                            // Update metadata/poster/clearlogo
                            updateInfo(nextItem);
                            // Expose current media for device-mgmt
                            try {
                                window.__posterramaCurrentMedia = nextItem;
                                window.__posterramaCurrentMediaId =
                                    nextItem?.id || nextItem?.title || nextItem?.posterUrl || null;
                                window.__posterramaPaused = !!_state.paused;
                            } catch (_) {
                                /* noop */
                            }
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
                            // Initialize info from initial item
                            updateInfo(items[_state.idx] || items[0]);
                            try {
                                const curr = items[_state.idx] || items[0];
                                window.__posterramaCurrentMedia = curr;
                                window.__posterramaCurrentMediaId =
                                    curr?.id || curr?.title || curr?.posterUrl || null;
                                window.__posterramaPaused = !!_state.paused;
                            } catch (_) {
                                /* noop */
                            }
                        }
                    } catch (_) {
                        /* noop: set initial index */
                    }
                } catch (_) {
                    /* noop: reinit is best-effort */
                }
            },
            // Live settings apply (from device-mgmt WS)
            applySettings(patch = {}) {
                try {
                    const cfg = Object.assign({}, window.appConfig || {});
                    // Only pick screensaver-related knobs
                    const allowed = [
                        'showPoster',
                        'showMetadata',
                        'transitionEffect',
                        'transitionIntervalSeconds',
                    ];
                    let changed = false;
                    for (const k of allowed) {
                        if (Object.prototype.hasOwnProperty.call(patch, k)) {
                            cfg[k] = patch[k];
                            changed = true;
                        }
                    }
                    if (!changed) return;
                    window.appConfig = cfg;
                    // Apply visibility and restart cycler with new interval/effect
                    api.ensureVisibility();
                    api.startCycler();
                } catch (_) {
                    /* noop */
                }
            },
        };

        // Attach to window; only on the screensaver page we actually use it, on others wrappers will no-op
        window.PosterramaScreensaver = api;

        // Provide global applySettings hook consumed by device-mgmt
        try {
            if (document.body && document.body.dataset.mode === 'screensaver') {
                window.applySettings = patch => {
                    try {
                        api.applySettings(patch || {});
                    } catch (_) {
                        /* noop */
                    }
                };
            }
        } catch (_) {
            /* noop */
        }

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
