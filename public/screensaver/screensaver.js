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
            order: null,
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
            // In the refactored screensaver, we render the poster on the single #poster element
            try {
                const poster = $('poster');
                if (!poster) return;
                if (url) {
                    poster.style.backgroundImage = `url('${url}')`;
                } else {
                    poster.style.backgroundImage = '';
                }
            } catch (_) {
                /* noop */
            }
        };
        // Rotten Tomatoes badge helpers (mirrors legacy behavior)
        let _rtBadge = null;
        let _rtIcon = null;
        const ensureRtBadgeAttached = () => {
            try {
                const poster = $('poster');
                if (!poster) return null;
                if (!_rtBadge) {
                    _rtBadge = document.createElement('div');
                    _rtBadge.id = 'rt-badge';
                }
                if (!_rtIcon) {
                    _rtIcon = document.createElement('img');
                    _rtIcon.id = 'rt-icon';
                    _rtIcon.alt = 'Rotten Tomatoes';
                }
                if (!_rtIcon.isConnected) _rtBadge.appendChild(_rtIcon);
                if (!_rtBadge.isConnected || _rtBadge.parentNode !== poster) {
                    poster.appendChild(_rtBadge);
                }
                return _rtBadge;
            } catch (_) {
                return null;
            }
        };
        const setClearlogo = url => {
            try {
                const el = $('clearlogo');
                if (!el) return;

                // Just set/clear the src - visibility is controlled by ensureVisibility()
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
        // Heartbeat: throttle immediate beats to avoid spamming during rapid updates
        const triggerLiveBeat = () => {
            try {
                const dev = window.PosterramaDevice;
                if (!dev || typeof dev.beat !== 'function') return;
                const now = Date.now();
                const until = window.__posterramaBeatCooldownUntil || 0;
                if (now < until) return; // still in cooldown window
                window.__posterramaBeatCooldownUntil = now + 1500; // 1.5s throttle
                dev.beat();
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
                // IMDb link handling (disabled in cinema mode)
                try {
                    const posterLink = $('poster-link');
                    const cinemaOn = !!window.appConfig?.cinemaMode;
                    if (posterLink) {
                        if (cinemaOn) {
                            posterLink.removeAttribute('href');
                            posterLink.style.cursor = 'default';
                        } else {
                            // Prefer explicit imdbUrl; fallback to imdbId when available
                            const imdbUrl =
                                (item?.imdbUrl && item.imdbUrl !== 'null' && item.imdbUrl) ||
                                (item?.imdbId ? `https://www.imdb.com/title/${item.imdbId}` : null);
                            if (imdbUrl) {
                                posterLink.href = imdbUrl;
                            } else {
                                posterLink.removeAttribute('href');
                                posterLink.style.cursor = 'default';
                            }
                            posterLink.style.cursor = 'pointer';
                        }
                    }
                } catch (_) {
                    /* noop */
                }
                // Rotten Tomatoes badge/icon
                try {
                    const allowRt = !window.IS_PREVIEW && window.appConfig?.showRottenTomatoes;
                    const badge = ensureRtBadgeAttached();
                    if (
                        allowRt &&
                        item?.rottenTomatoes &&
                        (item.rottenTomatoes.score || item.rottenTomatoes.icon) &&
                        badge &&
                        _rtIcon
                    ) {
                        // Optional minimum score filter
                        const min = Number(window.appConfig?.rottenTomatoesMinimumScore || 0);
                        const score = Number(item.rottenTomatoes.score || 0);
                        if (!Number.isFinite(min) || score >= min) {
                            const icon = String(item.rottenTomatoes.icon || '').toLowerCase();
                            let iconUrl = '';
                            switch (icon) {
                                case 'fresh':
                                    iconUrl = '/icons/rt-fresh.svg';
                                    break;
                                case 'certified-fresh':
                                case 'certified':
                                    iconUrl = '/icons/rt-certified-fresh.svg';
                                    break;
                                case 'rotten':
                                default:
                                    iconUrl = '/icons/rt-rotten.svg';
                                    break;
                            }
                            _rtIcon.src = iconUrl;
                            badge.classList.add('visible');
                        } else {
                            badge.classList.remove('visible');
                        }
                    } else if (badge) {
                        badge.classList.remove('visible');
                    }
                } catch (_) {
                    /* noop */
                }
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

        // Global clock update function that can be called from anywhere
        let _clockUpdateFn = null;

        const api = {
            // Lifecycle: start screensaver helpers (idempotent)
            start() {
                try {
                    if (_state.started) return;
                    _state.started = true;

                    // Initialize clock widget
                    try {
                        const updateClock = () => {
                            try {
                                const config = window.appConfig || {};
                                const format = config.clockFormat || '24h';
                                const timezone = config.clockTimezone || 'auto';

                                console.log(
                                    '[Clock] Updating clock with format:',
                                    format,
                                    'timezone:',
                                    timezone
                                );

                                // Get current time in the specified timezone
                                let now;
                                const isLocalTimezone =
                                    timezone === 'local' ||
                                    timezone === 'auto' ||
                                    timezone === 'Auto' ||
                                    !timezone;

                                if (isLocalTimezone) {
                                    now = new Date();
                                } else {
                                    // Use Intl API for timezone support
                                    const timeString = new Date().toLocaleString('en-US', {
                                        timeZone: timezone,
                                    });
                                    now = new Date(timeString);
                                }

                                let hours = now.getHours();
                                const minutes = String(now.getMinutes()).padStart(2, '0');

                                console.log('[Clock] Raw hours:', hours, 'format:', format);

                                // Apply 12h/24h format
                                if (format === '12h') {
                                    hours = hours % 12 || 12; // Convert 0 to 12 for midnight
                                    console.log('[Clock] Converted to 12h:', hours);
                                }

                                const hoursStr = String(hours).padStart(2, '0');
                                const hoursEl = document.getElementById('time-hours');
                                const minutesEl = document.getElementById('time-minutes');

                                console.log('[Clock] Setting time:', hoursStr + ':' + minutes);

                                if (hoursEl) hoursEl.textContent = hoursStr;
                                if (minutesEl) minutesEl.textContent = minutes;
                            } catch (e) {
                                console.error('[Clock] Error in updateClock:', e);
                                // Fallback to simple local time on error - but respect format!
                                try {
                                    const config = window.appConfig || {};
                                    const format = config.clockFormat || '24h';
                                    const now = new Date();
                                    let hours = now.getHours();

                                    if (format === '12h') {
                                        hours = hours % 12 || 12;
                                    }

                                    const hoursStr = String(hours).padStart(2, '0');
                                    const minutes = String(now.getMinutes()).padStart(2, '0');
                                    const hoursEl = document.getElementById('time-hours');
                                    const minutesEl = document.getElementById('time-minutes');
                                    if (hoursEl) hoursEl.textContent = hoursStr;
                                    if (minutesEl) minutesEl.textContent = minutes;
                                } catch (fallbackErr) {
                                    console.error('[Clock] Fallback also failed:', fallbackErr);
                                }
                            }
                        };
                        _clockUpdateFn = updateClock; // Store for later use
                        updateClock(); // Initial update
                        setInterval(updateClock, 1000); // Update every second
                    } catch (_) {
                        /* clock update is optional */
                    }

                    // Seed a random starting index so refresh doesn't always begin at same item
                    try {
                        const items = Array.isArray(window.mediaQueue) ? window.mediaQueue : [];
                        if (items.length > 0 && (_state.idx === -1 || _state.idx == null)) {
                            _state.idx = Math.floor(Math.random() * items.length) - 1;
                        }
                        // Build a shuffled traversal order without mutating mediaQueue
                        const n = items.length;
                        if (n > 0) {
                            _state.order = Array.from({ length: n }, (_, i) => i);
                            for (let i = n - 1; i > 0; i--) {
                                const j = Math.floor(Math.random() * (i + 1));
                                const t = _state.order[i];
                                _state.order[i] = _state.order[j];
                                _state.order[j] = t;
                            }
                        } else {
                            _state.order = null;
                        }
                    } catch (_) {
                        /* noop */
                    }
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
                    // Controls: wire buttons and transient visibility on user interaction
                    try {
                        const container = document.getElementById('controls-container');
                        const prevBtn = document.getElementById('prev-button');
                        const nextBtn = document.getElementById('next-button');
                        const pauseBtn = document.getElementById('pause-button');
                        let hideTimer = null;
                        const showControls = () => {
                            if (!container) return;
                            container.classList.add('visible');
                            try {
                                document.body.style.cursor = 'default';
                            } catch (_) {
                                /* noop */
                            }
                            if (hideTimer) clearTimeout(hideTimer);
                            hideTimer = setTimeout(() => {
                                try {
                                    container.classList.remove('visible');
                                    document.body.style.cursor = 'none';
                                } catch (_) {
                                    /* noop */
                                }
                            }, 2500);
                        };
                        const onInteract = () => showControls();
                        // Bind to body for faster response similar to legacy behavior
                        if (document && document.body) {
                            document.body.addEventListener('mousemove', onInteract, {
                                passive: true,
                            });
                            document.body.addEventListener('touchstart', onInteract, {
                                passive: true,
                            });
                        } else {
                            ['mousemove', 'touchstart'].forEach(evt => {
                                window.addEventListener(evt, onInteract, { passive: true });
                            });
                        }
                        if (prevBtn)
                            prevBtn.onclick = () => {
                                try {
                                    window.__posterramaPlayback &&
                                        window.__posterramaPlayback.prev &&
                                        window.__posterramaPlayback.prev();
                                } catch (_) {
                                    /* noop */
                                }
                                showControls();
                            };
                        if (nextBtn)
                            nextBtn.onclick = () => {
                                try {
                                    window.__posterramaPlayback &&
                                        window.__posterramaPlayback.next &&
                                        window.__posterramaPlayback.next();
                                } catch (_) {
                                    /* noop */
                                }
                                // Note: triggerLiveBeat() removed - playback hooks already send it
                                showControls();
                            };
                        if (pauseBtn)
                            pauseBtn.onclick = () => {
                                try {
                                    if (_state.paused) {
                                        window.__posterramaPlayback &&
                                            window.__posterramaPlayback.resume &&
                                            window.__posterramaPlayback.resume();
                                        pauseBtn.classList.remove('is-paused');
                                    } else {
                                        window.__posterramaPlayback &&
                                            window.__posterramaPlayback.pause &&
                                            window.__posterramaPlayback.pause();
                                        pauseBtn.classList.add('is-paused');
                                    }
                                } catch (_) {
                                    /* noop */
                                }
                                // Prompt a fast live update after pause toggle
                                try {
                                    triggerLiveBeat();
                                } catch (_) {
                                    /* noop */
                                }
                                showControls();
                            };
                        // Keyboard controls to match legacy
                        document.addEventListener('keydown', e => {
                            try {
                                showControls();
                            } catch (_) {
                                /* noop */
                            }
                            if (e.key === 'ArrowRight') {
                                try {
                                    window.__posterramaPlayback &&
                                        window.__posterramaPlayback.next &&
                                        window.__posterramaPlayback.next();
                                } catch (_) {
                                    /* noop */
                                }
                            } else if (e.key === 'ArrowLeft') {
                                try {
                                    window.__posterramaPlayback &&
                                        window.__posterramaPlayback.prev &&
                                        window.__posterramaPlayback.prev();
                                } catch (_) {
                                    /* noop */
                                }
                            } else if (e.key === ' ') {
                                e.preventDefault();
                                try {
                                    if (_state.paused) {
                                        window.__posterramaPlayback &&
                                            window.__posterramaPlayback.resume &&
                                            window.__posterramaPlayback.resume();
                                        if (pauseBtn) pauseBtn.classList.remove('is-paused');
                                    } else {
                                        window.__posterramaPlayback &&
                                            window.__posterramaPlayback.pause &&
                                            window.__posterramaPlayback.pause();
                                        if (pauseBtn) pauseBtn.classList.add('is-paused');
                                    }
                                } catch (_) {
                                    /* noop */
                                }
                                // Note: triggerLiveBeat() removed - playback hooks already send it
                            }
                        });
                    } catch (_) {
                        /* noop */
                    }
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
                                try {
                                    triggerLiveBeat();
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
                                // Note: triggerLiveBeat() removed - showNextBackground sends it
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

                    // Only advance immediately if no background is currently shown
                    // (prevents skipping the first media item on fresh load)
                    const layerA = document.getElementById('layer-a');
                    const layerB = document.getElementById('layer-b');
                    const hasBackground =
                        (layerA &&
                            layerA.style.backgroundImage &&
                            layerA.style.backgroundImage !== 'none') ||
                        (layerB &&
                            layerB.style.backgroundImage &&
                            layerB.style.backgroundImage !== 'none');

                    console.log('[Screensaver.startCycler] hasBackground check:', {
                        hasBackground,
                        layerABg: layerA?.style.backgroundImage,
                        layerBBg: layerB?.style.backgroundImage,
                    });

                    if (!hasBackground) {
                        // No background yet, show first one immediately
                        console.log(
                            '[Screensaver.startCycler] No background detected, showing first image immediately'
                        );
                        setTimeout(() => {
                            try {
                                api.showNextBackground();
                            } catch (_) {
                                /* noop: startCycler best-effort */
                            }
                        }, 10);
                    } else {
                        console.log(
                            '[Screensaver.startCycler] Background already exists, will wait for interval'
                        );
                    }
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
                    // Ensure shuffled order is aligned with current list size
                    if (!_state.order || _state.order.length !== items.length) {
                        const n = items.length;
                        if (n > 0) {
                            _state.order = Array.from({ length: n }, (_, i) => i);
                            for (let i = n - 1; i > 0; i--) {
                                const j = Math.floor(Math.random() * (i + 1));
                                const t = _state.order[i];
                                _state.order[i] = _state.order[j];
                                _state.order[j] = t;
                            }
                        } else {
                            _state.order = null;
                        }
                    }
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
                    const mappedIdx =
                        _state.order && _state.order.length === total
                            ? _state.order[Math.max(0, _state.idx % total)]
                            : Math.max(0, _state.idx % total);
                    const nextItem = items[mappedIdx] || items[0];
                    const nextUrl = nextItem?.backgroundUrl || null;
                    if (!nextUrl || nextUrl === 'null' || nextUrl === 'undefined') return;

                    // Expose current media EARLY (before image load) for accurate initial heartbeat
                    try {
                        window.__posterramaCurrentMedia = nextItem;
                        window.__posterramaCurrentMediaId =
                            nextItem?.id || nextItem?.title || nextItem?.posterUrl || null;
                        window.__posterramaPaused = !!_state.paused;
                    } catch (_) {
                        /* noop */
                    }

                    // Send early heartbeat so admin sees correct initial media
                    // (before waiting for image preload)
                    if (opts.sendEarlyBeat !== false) {
                        try {
                            triggerLiveBeat();
                        } catch (_) {
                            /* noop */
                        }
                    }

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

                            // Ensure visibility immediately after updating info to prevent flash
                            // of disabled elements (e.g., clearlogo showing briefly when disabled)
                            try {
                                api.ensureVisibility();
                            } catch (_) {
                                /* noop */
                            }

                            // Update globals (already done early, but keep for safety)
                            try {
                                window.__posterramaCurrentMedia = nextItem;
                                window.__posterramaCurrentMediaId =
                                    nextItem?.id || nextItem?.title || nextItem?.posterUrl || null;
                                window.__posterramaPaused = !!_state.paused;
                            } catch (_) {
                                /* noop */
                            }
                            // Note: triggerLiveBeat() removed here - now sent early (before image load)
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
                    const clockVisible = window.appConfig?.clockWidget !== false;
                    const clearlogoVisible =
                        window.appConfig?.showClearlogo !== false &&
                        window.appConfig?.showClearLogo !== false; // Handle both spellings
                    const rtVisible = window.appConfig?.showRottenTomatoes !== false;

                    const infoContainer = document.getElementById('info-container');
                    const posterWrapper = document.getElementById('poster-wrapper');
                    const textWrapper = document.getElementById('text-wrapper');
                    const clockContainer = document.getElementById('clock-widget-container');
                    const clearlogoEl = document.getElementById('clearlogo');

                    // Toggle poster and metadata wrappers
                    if (posterWrapper) posterWrapper.classList.toggle('is-hidden', !posterVisible);
                    if (textWrapper) textWrapper.classList.toggle('is-hidden', !metaVisible);

                    // Toggle clock widget
                    if (clockContainer) {
                        clockContainer.classList.toggle('is-hidden', !clockVisible);
                        if (clockVisible) {
                            clockContainer.style.display = 'flex';
                            // Update clock immediately when shown or settings changed
                            if (_clockUpdateFn) _clockUpdateFn();
                        } else {
                            clockContainer.style.display = 'none';
                        }
                    }

                    // Apply UI scaling via CSS custom properties
                    try {
                        const uiScaling = window.appConfig?.uiScaling || {};
                        const globalScale = (uiScaling.global || 100) / 100;
                        const contentScale = (uiScaling.content || 100) / 100;
                        const clearlogoScale = (uiScaling.clearlogo || 100) / 100;
                        const clockScale = (uiScaling.clock || 100) / 100;

                        const root = document.documentElement;

                        // Apply global scale to root font size (affects everything using rem units)
                        if (globalScale !== 1) {
                            root.style.fontSize = `${globalScale * 16}px`;
                        } else {
                            root.style.fontSize = '';
                        }

                        // Apply content scale via CSS variable (used by #info-container and #poster-wrapper)
                        root.style.setProperty('--content-scale', String(contentScale));

                        // Apply clearlogo scale via CSS variable (used by #clearlogo-container)
                        root.style.setProperty('--clearlogo-scale', String(clearlogoScale));

                        // Apply clock scale via CSS variable (used by #time-widget)
                        root.style.setProperty('--clock-scale', String(clockScale));

                        console.log(
                            '[Screensaver.ensureVisibility] Applied UI scaling via CSS variables',
                            {
                                global: globalScale,
                                content: contentScale,
                                clearlogo: clearlogoScale,
                                clock: clockScale,
                            }
                        );
                    } catch (e) {
                        console.error('[Screensaver.ensureVisibility] UI scaling error:', e);
                    }

                    // Toggle clearlogo - respect both setting and URL availability
                    if (clearlogoEl) {
                        const hasUrl = clearlogoEl.src && clearlogoEl.src !== '';
                        if (clearlogoVisible && hasUrl) {
                            clearlogoEl.style.opacity = '1';
                        } else {
                            clearlogoEl.style.opacity = '0';
                        }
                    }

                    // Toggle Rotten Tomatoes badge
                    try {
                        if (_rtBadge) {
                            if (rtVisible) {
                                _rtBadge.style.opacity = '1';
                                _rtBadge.style.display = 'block';
                            } else {
                                _rtBadge.style.opacity = '0';
                                _rtBadge.style.display = 'none';
                            }
                        }
                    } catch (_) {
                        /* RT badge toggle is optional */
                    }

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

                    console.log('[Screensaver.ensureVisibility] Updated visibility', {
                        poster: posterVisible,
                        meta: metaVisible,
                        clock: clockVisible,
                        clearlogo: clearlogoVisible,
                        clearlogoHasUrl: clearlogoEl?.src ? 'yes' : 'no',
                        rottenTomatoes: rtVisible,
                        uiScaling: window.appConfig?.uiScaling,
                    });
                } catch (e) {
                    console.error('[Screensaver.ensureVisibility] Error:', e);
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

                    // Reset background layers to empty state
                    // showNextBackground() will handle setting the first image
                    console.log(
                        '[Screensaver.reinitBackground] Clearing layers, startCycler will load first image'
                    );
                    la.style.backgroundImage = '';
                    lb.style.backgroundImage = '';

                    // Make sure the visible layer shows immediately
                    la.style.transition = 'none';
                    lb.style.transition = 'none';
                    la.style.opacity = '1';
                    lb.style.opacity = '0';

                    // Reset references to a known state
                    window.activeLayer = la;
                    window.inactiveLayer = lb;

                    // Don't update metadata here - showNextBackground() will handle it
                    // Just ensure _state.idx is valid
                    try {
                        const items = Array.isArray(window.mediaQueue) ? window.mediaQueue : [];
                        if (items.length > 0) {
                            // Use the ALREADY SEEDED random index from start(), don't override it!
                            // Only initialize to 0 if completely unset (edge case)
                            if (!Number.isFinite(_state.idx) || _state.idx < -1) {
                                _state.idx = 0;
                            }
                            console.log(
                                '[Screensaver.reinitBackground] Index ready:',
                                _state.idx,
                                '- startCycler will show first image'
                            );
                        }
                    } catch (_) {
                        /* noop: set initial index */
                    }
                } catch (_) {
                    /* noop: reinit is best-effort */
                }
            },
            // Live settings apply (from preview mode, WebSocket, etc.)
            applySettings(patch = {}) {
                try {
                    console.log(
                        '[Screensaver.applySettings] Received patch with keys:',
                        Object.keys(patch)
                    );

                    // Get current config for comparison
                    const oldConfig = window.appConfig || {};

                    // Settings that affect timing/cycling and require restart
                    const restartSettings = ['transitionEffect', 'transitionIntervalSeconds'];

                    // Visual settings that only need UI update
                    const visualSettings = [
                        'showPoster',
                        'showMetadata',
                        'clockWidget',
                        'clockFormat',
                        'clockTimezone',
                        'showClearlogo',
                        'showClearLogo', // Note: admin sends showClearLogo, config has showClearlogo
                        'showRottenTomatoes',
                        'uiElementScaling',
                        'uiScaling', // Handle nested uiScaling object
                    ];

                    // Check if any restart settings ACTUALLY CHANGED VALUE
                    let needsRestart = false;
                    for (const key of restartSettings) {
                        if (key in patch && patch[key] !== oldConfig[key]) {
                            needsRestart = true;
                            console.log(
                                '[Screensaver.applySettings] Restart needed - value changed:',
                                key,
                                'from',
                                oldConfig[key],
                                'to',
                                patch[key]
                            );
                            break;
                        }
                    }

                    // Check if any visual settings changed VALUE
                    let hasVisualChanges = false;
                    let clockSettingsChanged = false;

                    for (const key of visualSettings) {
                        if (key in patch) {
                            // Handle nested uiScaling object
                            if (key === 'uiScaling' && typeof patch[key] === 'object') {
                                const oldUiScaling = oldConfig.uiScaling || {};
                                const newUiScaling = patch[key] || {};
                                const scalingKeys = ['global', 'content', 'clearlogo', 'clock'];
                                for (const sk of scalingKeys) {
                                    if (
                                        newUiScaling[sk] != null &&
                                        newUiScaling[sk] !== oldUiScaling[sk]
                                    ) {
                                        hasVisualChanges = true;
                                        console.log(
                                            '[Screensaver.applySettings] UI Scaling change detected:',
                                            sk,
                                            'from',
                                            oldUiScaling[sk],
                                            'to',
                                            newUiScaling[sk]
                                        );
                                        break;
                                    }
                                }
                            } else if (patch[key] !== oldConfig[key]) {
                                hasVisualChanges = true;
                                console.log(
                                    '[Screensaver.applySettings] Visual change detected:',
                                    key,
                                    'from',
                                    oldConfig[key],
                                    'to',
                                    patch[key]
                                );

                                // Track if clock-related settings changed
                                if (key === 'clockFormat' || key === 'clockTimezone') {
                                    clockSettingsChanged = true;
                                }
                            }
                        }
                    }

                    // Special handling for showClearLogo vs showClearlogo mismatch
                    if ('showClearLogo' in patch && !('showClearlogo' in patch)) {
                        patch.showClearlogo = patch.showClearLogo;
                        if (patch.showClearlogo !== oldConfig.showClearlogo) {
                            hasVisualChanges = true;
                            console.log(
                                '[Screensaver.applySettings] Visual change detected: showClearlogo (via showClearLogo)'
                            );
                        }
                    }

                    if (!needsRestart && !hasVisualChanges) {
                        console.log('[Screensaver.applySettings] No actual value changes detected');
                        return;
                    }

                    // window.appConfig is already updated by core.js
                    console.log(
                        '[Screensaver.applySettings] Updating UI, needsRestart:',
                        needsRestart
                    );

                    // Always update visibility for visual elements
                    api.ensureVisibility();

                    // If clock settings changed, force immediate clock update
                    if (clockSettingsChanged && _clockUpdateFn) {
                        console.log(
                            '[Screensaver.applySettings] Clock settings changed, forcing update'
                        );
                        _clockUpdateFn();
                    }

                    // Only restart cycler if timing/effect changed
                    if (needsRestart) {
                        console.log('[Screensaver.applySettings] Restarting cycler');
                        api.startCycler();
                    } else {
                        console.log(
                            '[Screensaver.applySettings] Visual-only update, keeping current media'
                        );
                    }
                } catch (e) {
                    console.error('[Screensaver.applySettings] Error:', e);
                }
            },
        };

        // Attach to window; only on the screensaver page we actually use it, on others wrappers will no-op
        window.PosterramaScreensaver = api;

        // Listen for settingsUpdated event from core.js (preview mode, WebSocket, BroadcastChannel, etc.)
        try {
            if (document.body && document.body.dataset.mode === 'screensaver') {
                window.addEventListener('settingsUpdated', event => {
                    try {
                        console.log('[Screensaver] Received settingsUpdated event', event.detail);
                        const settings = event.detail?.settings;
                        if (settings) {
                            api.applySettings(settings);
                        }
                    } catch (e) {
                        console.error('[Screensaver] Failed to handle settingsUpdated:', e);
                    }
                });
                console.log('[Screensaver] Registered settingsUpdated listener');
            }
        } catch (_) {
            /* noop */
        }

        try {
            const debugOn =
                (window.logger &&
                    typeof window.logger.isDebug === 'function' &&
                    window.logger.isDebug()) ||
                window.POSTERRAMA_DEBUG;
            if (document.body && document.body.dataset.mode === 'screensaver' && debugOn) {
                (window.logger && window.logger.debug ? window.logger.debug : console.log)(
                    '[Screensaver] module loaded'
                );
            }
        } catch (_) {
            /* ignore debug log */
        }
    } catch (e) {
        if (window && window.console) console.debug('[Screensaver] module init error');
    }
})();
