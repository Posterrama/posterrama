// Screensaver module: extracted helpers from script.js for screensaver-specific behavior
(function initScreensaverModule() {
    // Reset pause state on page load (fresh start = not paused)
    // This ensures admin UI is updated correctly when display refreshes
    try {
        window.__posterramaPaused = false;
    } catch (_) {
        /* ignore */
    }

    try {
        // Define a single namespace on window to avoid globals
        const _state = {
            ensureTimer: null,
            started: false,
            cycleTimer: null,
            idx: -1,
            paused: false,
            order: null,
            isPinned: false,
            pinnedMediaId: null,
            isTransitioning: false,
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

        const applyPosterEffect = ({ onChange } = { onChange: true }) => {
            try {
                const poster = $('poster');
                if (!poster) return;

                const effect = String(
                    window.appConfig?.transitionEffect || 'kenburns'
                ).toLowerCase();
                const intervalMs = Math.max(
                    5000,
                    Math.floor((window.appConfig?.transitionIntervalSeconds || 10) * 1000)
                );

                // Drive CSS durations via a single variable
                try {
                    document.body?.style?.setProperty('--ss-poster-ms', `${intervalMs}ms`);
                } catch (_) {
                    /* noop */
                }

                // Clear previous effect classes
                poster.classList.remove(
                    'ss-poster-tilt',
                    'ss-poster-analogzoom',
                    'ss-poster-focus',
                    'ss-poster-sweep'
                );

                // Continuous/idle effects
                if (effect === 'tilt') {
                    poster.classList.add('ss-poster-tilt');
                } else if (effect === 'analogzoom') {
                    poster.classList.add('ss-poster-analogzoom');
                }

                // One-shot effects on change
                if (onChange) {
                    if (effect === 'focus') {
                        // Restart animation reliably
                        poster.classList.remove('ss-poster-focus');
                        requestAnimationFrame(() => {
                            poster.classList.add('ss-poster-focus');
                        });
                    } else if (effect === 'sweep') {
                        poster.classList.remove('ss-poster-sweep');
                        requestAnimationFrame(() => {
                            poster.classList.add('ss-poster-sweep');
                        });
                    }
                }
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
                    // PROGRESSIVE LOADING: Show thumbnail first for instant feedback
                    const thumbUrl = url.includes('?')
                        ? `${url}&quality=30&width=400`
                        : `${url}?quality=30&width=400`;

                    poster.style.backgroundImage = `url('${thumbUrl}')`;
                    poster.style.filter = 'blur(3px)';
                    poster.style.transition = 'filter 0.5s ease-out';

                    // Load full quality in background
                    const fullImg = new Image();
                    fullImg.onload = () => {
                        poster.style.backgroundImage = `url('${url}')`;
                        poster.style.filter = 'none';
                    };
                    fullImg.onerror = () => {
                        // Keep thumbnail, remove blur
                        poster.style.filter = 'none';
                    };
                    fullImg.src = url;
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
        // Heartbeat: smart cooldown to avoid spamming during rapid poster transitions
        // Trigger immediate heartbeat on poster change
        // Simple debounce to prevent duplicate calls within 500ms
        const triggerLiveBeat = () => {
            try {
                const dev = window.PosterramaDevice;
                if (!dev || typeof dev.beat !== 'function') return;
                const now = Date.now();

                // Short debounce only - prevent rapid-fire duplicate calls
                const until = window.__posterramaBeatCooldownUntil || 0;
                if (now < until) return;
                window.__posterramaBeatCooldownUntil = now + 500;

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
                    applyPosterEffect({ onChange: true });
                } else {
                    showEl('poster-wrapper', false);
                    try {
                        const poster = $('poster');
                        if (poster) {
                            poster.classList.remove(
                                'ss-poster-tilt',
                                'ss-poster-analogzoom',
                                'ss-poster-focus',
                                'ss-poster-sweep'
                            );
                        }
                    } catch (_) {
                        /* noop */
                    }
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
                        (item.rottenTomatoes.score ||
                            item.rottenTomatoes.icon ||
                            item.rottenTomatoes.rating) &&
                        badge &&
                        _rtIcon
                    ) {
                        // Backwards compatibility: fallback to 'rating' if 'score' is missing (old Jellyfin exports)
                        const score = Number(
                            item.rottenTomatoes.score || item.rottenTomatoes.rating || 0
                        );

                        // Calculate icon from score if missing (old Jellyfin exports)
                        let icon = String(item.rottenTomatoes.icon || '').toLowerCase();
                        if (!icon && score > 0) {
                            if (score >= 85) {
                                icon = 'certified-fresh';
                            } else if (score >= 60) {
                                icon = 'fresh';
                            } else {
                                icon = 'rotten';
                            }
                        }

                        // Optional minimum score filter
                        const min = Number(window.appConfig?.rottenTomatoesMinimumScore || 0);
                        if (!Number.isFinite(min) || score >= min) {
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

                    // Add a mode class so shared CSS selectors can apply consistently.
                    try {
                        if (document && document.body) {
                            document.body.classList.add('screensaver-mode');
                        }
                    } catch (_) {
                        /* noop */
                    }

                    // Initialize clock widget
                    try {
                        const updateClock = () => {
                            try {
                                const config = window.appConfig || {};
                                const format = config.clockFormat || '24h';
                                const timezone = config.clockTimezone || 'auto';

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

                                // Apply 12h/24h format
                                if (format === '12h') {
                                    hours = hours % 12 || 12; // Convert 0 to 12 for midnight
                                }

                                const hoursStr = String(hours).padStart(2, '0');
                                const hoursEl = document.getElementById('time-hours');
                                const minutesEl = document.getElementById('time-minutes');

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
                        // Note: Pause indicator functions are defined outside this try block
                        // so they can be accessed by window.__posterramaPlayback

                        document.addEventListener('keydown', e => {
                            try {
                                showControls();
                            } catch (_) {
                                /* noop */
                            }
                            if (e.key === 'ArrowRight') {
                                e.preventDefault();
                                if (typeof hidePauseIndicator === 'function') hidePauseIndicator();
                                try {
                                    window.__posterramaPlayback &&
                                        window.__posterramaPlayback.next &&
                                        window.__posterramaPlayback.next();
                                } catch (_) {
                                    /* noop */
                                }
                            } else if (e.key === 'ArrowLeft') {
                                e.preventDefault();
                                if (typeof hidePauseIndicator === 'function') hidePauseIndicator();
                                try {
                                    window.__posterramaPlayback &&
                                        window.__posterramaPlayback.prev &&
                                        window.__posterramaPlayback.prev();
                                } catch (_) {
                                    /* noop */
                                }
                            } else if (
                                e.key === ' ' ||
                                e.key === 'Enter' ||
                                e.key === 'MediaPlayPause'
                            ) {
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
                            } else if (e.key === 'MediaPause') {
                                e.preventDefault();
                                if (!_state.paused) {
                                    window.__posterramaPlayback &&
                                        window.__posterramaPlayback.pause &&
                                        window.__posterramaPlayback.pause();
                                    if (pauseBtn) pauseBtn.classList.add('is-paused');
                                }
                            } else if (e.key === 'MediaPlay') {
                                e.preventDefault();
                                if (_state.paused) {
                                    window.__posterramaPlayback &&
                                        window.__posterramaPlayback.resume &&
                                        window.__posterramaPlayback.resume();
                                    if (pauseBtn) pauseBtn.classList.remove('is-paused');
                                }
                            }
                        });
                    } catch (_) {
                        /* noop */
                    }

                    // === Pause Indicator ===
                    let pauseIndicatorEl = null;

                    const createPauseIndicator = () => {
                        if (pauseIndicatorEl) return;
                        pauseIndicatorEl = document.createElement('div');
                        pauseIndicatorEl.className = 'screensaver-pause-indicator';
                        pauseIndicatorEl.innerHTML = `
                            <div class="pause-icon">
                                <span class="pause-bar"></span>
                                <span class="pause-bar"></span>
                            </div>
                            <span class="pause-text">PAUSED</span>
                        `;
                        pauseIndicatorEl.style.cssText = `
                            position: fixed;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%) scale(0.8);
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            gap: 1rem;
                            padding: 2rem 3rem;
                            background: rgba(0, 0, 0, 0.3);
                            backdrop-filter: blur(10px);
                            -webkit-backdrop-filter: blur(10px);
                            border-radius: 16px;
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            opacity: 0;
                            visibility: hidden;
                            transition: opacity 0.3s ease, transform 0.3s ease, visibility 0.3s;
                            z-index: 9999;
                        `;
                        const icon = pauseIndicatorEl.querySelector('.pause-icon');
                        if (icon) icon.style.cssText = 'display: flex; gap: 0.5rem;';
                        pauseIndicatorEl.querySelectorAll('.pause-bar').forEach(bar => {
                            bar.style.cssText =
                                'display: block; width: 0.75rem; height: 3rem; background: #fff; border-radius: 0.25rem;';
                        });
                        const text = pauseIndicatorEl.querySelector('.pause-text');
                        if (text)
                            text.style.cssText =
                                'font-size: 1.25rem; font-weight: 600; color: #fff; letter-spacing: 0.2em; text-transform: uppercase;';
                        document.body.appendChild(pauseIndicatorEl);
                    };

                    const showPauseIndicator = () => {
                        // Check if pause indicator is enabled in config (default: true)
                        const cfg = window.appConfig || window.__serverConfig;
                        if (cfg?.pauseIndicator?.enabled === false) return;
                        if (!pauseIndicatorEl) createPauseIndicator();
                        pauseIndicatorEl.style.opacity = '1';
                        pauseIndicatorEl.style.visibility = 'visible';
                        pauseIndicatorEl.style.transform = 'translate(-50%, -50%) scale(1)';
                    };

                    const hidePauseIndicator = () => {
                        if (pauseIndicatorEl) {
                            pauseIndicatorEl.style.opacity = '0';
                            pauseIndicatorEl.style.visibility = 'hidden';
                            pauseIndicatorEl.style.transform = 'translate(-50%, -50%) scale(0.8)';
                        }
                    };

                    // Playback exposure for device mgmt
                    try {
                        window.__posterramaPlayback = {
                            next: () => {
                                try {
                                    _state.paused = false;
                                    _state.isPinned = false;
                                    _state.pinnedMediaId = null;
                                    window.__posterramaPaused = false;
                                    hidePauseIndicator();
                                    api.showNextBackground({ forceNext: true });
                                } catch (_) {
                                    /* noop */
                                }
                            },
                            prev: () => {
                                try {
                                    _state.paused = false;
                                    _state.isPinned = false;
                                    _state.pinnedMediaId = null;
                                    window.__posterramaPaused = false;
                                    hidePauseIndicator();
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
                                showPauseIndicator();
                                try {
                                    triggerLiveBeat();
                                } catch (_) {
                                    /* noop */
                                }
                            },
                            resume: () => {
                                _state.paused = false;
                                _state.isPinned = false;
                                _state.pinnedMediaId = null;
                                try {
                                    window.__posterramaPaused = false;
                                } catch (_) {
                                    /* noop */
                                }
                                hidePauseIndicator();
                                // Note: triggerLiveBeat() removed - showNextBackground sends it
                                api.showNextBackground({ forceNext: true });
                            },
                            remoteKey: key => {
                                try {
                                    switch (key) {
                                        case 'left':
                                            window.__posterramaPlayback.prev();
                                            break;
                                        case 'right':
                                            window.__posterramaPlayback.next();
                                            break;
                                    }
                                } catch (_) {
                                    /* noop */
                                }
                            },
                        };
                    } catch (_) {
                        /* noop */
                    }

                    // === D-pad / Remote Control Keyboard Handler ===
                    try {
                        const togglePause = () => {
                            if (_state.paused) {
                                window.__posterramaPlayback.resume();
                            } else {
                                window.__posterramaPlayback.pause();
                            }
                        };

                        document.addEventListener('keydown', e => {
                            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')
                                return;

                            switch (e.key) {
                                case 'ArrowRight':
                                    e.preventDefault();
                                    window.__posterramaPlayback.next();
                                    break;
                                case 'ArrowLeft':
                                    e.preventDefault();
                                    window.__posterramaPlayback.prev();
                                    break;
                                case ' ':
                                case 'Enter':
                                case 'MediaPlayPause':
                                    e.preventDefault();
                                    togglePause();
                                    break;
                                case 'MediaPause':
                                    e.preventDefault();
                                    if (!_state.paused) {
                                        window.__posterramaPlayback.pause();
                                    }
                                    break;
                                case 'MediaPlay':
                                    e.preventDefault();
                                    if (_state.paused) {
                                        window.__posterramaPlayback.resume();
                                    }
                                    break;
                            }
                        });
                    } catch (_) {
                        /* D-pad init best-effort */
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
                            if (_state.paused || _state.isPinned) return;
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

                    if (!hasBackground) {
                        // No background yet, show first one immediately
                        setTimeout(() => {
                            try {
                                api.showNextBackground({ immediate: true });
                            } catch (_) {
                                /* noop: startCycler best-effort */
                            }
                        }, 10);
                    }
                } catch (_) {
                    /* noop */
                }
            },
            // Advance to next media item and transition layers
            showNextBackground(opts = {}) {
                try {
                    if (_state.isTransitioning && !opts.forceNext && !opts.immediate) {
                        return;
                    }

                    // Don't rotate if poster is pinned
                    if (_state.isPinned && !opts.forceNext) {
                        return;
                    }

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

                        // Track display for KPI dashboard (fire-and-forget)
                        if (nextItem?.key && nextItem?.title) {
                            fetch('/api/v1/metrics/track-display', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    mediaId: nextItem.key,
                                    title: nextItem.title,
                                }),
                            }).catch(() => {
                                /* ignore */
                            });
                        }
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

                    const resetLayer = layer => {
                        try {
                            layer.style.animation = 'none';
                            layer.removeAttribute('data-ken-burns');
                            layer.removeAttribute('data-ss-kenburns');
                            layer.style.transition = 'none';
                            layer.style.transform = 'translate3d(0,0,0)';
                        } catch (_) {
                            /* noop */
                        }
                    };

                    const setSceneVars = vars => {
                        try {
                            const b = document.body;
                            if (!b) return;
                            if (typeof vars.ms === 'number') {
                                b.style.setProperty('--ss-scene-ms', `${Math.max(0, vars.ms)}ms`);
                            }
                            if (typeof vars.xPx === 'number') {
                                b.style.setProperty('--ss-scene-x', `${Math.round(vars.xPx)}px`);
                            }
                            if (typeof vars.opacity === 'number') {
                                b.style.setProperty(
                                    '--ss-scene-opacity',
                                    String(Math.max(0, Math.min(1, vars.opacity)))
                                );
                            }
                        } catch (_) {
                            /* noop */
                        }
                    };

                    const getTimings = () => {
                        const intervalMs = Math.max(
                            5000,
                            Math.floor((window.appConfig?.transitionIntervalSeconds || 10) * 1000)
                        );
                        const effect = String(
                            window.appConfig?.transitionEffect || 'kenburns'
                        ).toLowerCase();

                        // Keep non-KenBurns transitions short so the image is mostly static.
                        // Ken Burns animates continuously for the full interval.
                        const transitionMs = Math.max(
                            320,
                            Math.min(1400, Math.round(intervalMs * 0.22))
                        );

                        return {
                            effect,
                            intervalMs,
                            transitionMs,
                        };
                    };

                    const slideOffsetPx = (() => {
                        try {
                            const vw = window.innerWidth || 1920;
                            // ~12% of viewport width, clamped.
                            return Math.max(80, Math.min(320, Math.round(vw * 0.12)));
                        } catch (_) {
                            return 160;
                        }
                    })();

                    // Preload next image before switching
                    const img = new Image();
                    img.onload = () => {
                        try {
                            const { effect, intervalMs, transitionMs } = getTimings();

                            // Map poster-only effects to a background fade.
                            const bgEffect = ['tilt', 'focus', 'sweep', 'analogzoom'].includes(
                                effect
                            )
                                ? 'fade'
                                : effect;

                            const effectMs = bgEffect === 'kenburns' ? intervalMs : transitionMs;

                            // Mark transitioning to avoid overlap
                            _state.isTransitioning = !opts.immediate;

                            // Reset layers
                            // Important: for Ken Burns we must NOT reset the outgoing (active) layer,
                            // otherwise it snaps back to the default transform/scale during the fade.
                            // Keep its animation running and only fade its opacity.
                            if (bgEffect !== 'kenburns') {
                                resetLayer(active);
                            }
                            resetLayer(inactive);

                            // Prepare inactive background
                            inactive.style.backgroundImage = `url('${nextUrl}')`;

                            // Fast path: first paint or forced immediate
                            if (opts.immediate) {
                                active.style.opacity = '0';
                                inactive.style.opacity = '1';
                                try {
                                    window.activeLayer = inactive;
                                    window.inactiveLayer = active;
                                } catch (_) {
                                    /* noop */
                                }
                                updateInfo(nextItem);
                                try {
                                    api.ensureVisibility();
                                } catch (_) {
                                    /* noop */
                                }
                                try {
                                    setSceneVars({ ms: 0, xPx: 0, opacity: 1 });
                                } catch (_) {
                                    /* noop */
                                }
                                _state.isTransitioning = false;
                                return;
                            }

                            // Scene (foreground + widgets) uses CSS variables
                            const halfOutMs = Math.max(160, Math.floor(effectMs / 2));
                            const halfInMs = Math.max(160, effectMs - halfOutMs);

                            // Background transition
                            if (bgEffect === 'fade' || bgEffect === 'none') {
                                inactive.style.opacity = '0';
                                inactive.style.transition = `opacity ${effectMs}ms ease-in-out`;
                                active.style.transition = `opacity ${effectMs}ms ease-in-out`;
                                requestAnimationFrame(() => {
                                    inactive.style.opacity = '1';
                                    active.style.opacity = '0';
                                });

                                // Foreground: fade-out then fade-in
                                setSceneVars({ ms: halfOutMs, xPx: 0, opacity: 0 });
                                setTimeout(() => {
                                    try {
                                        updateInfo(nextItem);
                                        api.ensureVisibility();
                                    } catch (_) {
                                        /* noop */
                                    }
                                    setSceneVars({ ms: halfInMs, xPx: 0, opacity: 1 });
                                }, halfOutMs);

                                setTimeout(() => {
                                    try {
                                        window.activeLayer = inactive;
                                        window.inactiveLayer = active;
                                        resetLayer(active);
                                        active.style.opacity = '0';
                                        inactive.style.opacity = '1';
                                    } catch (_) {
                                        /* noop */
                                    }
                                    _state.isTransitioning = false;
                                }, effectMs + 50);
                            } else if (bgEffect === 'slide') {
                                // Background: slide left as new slides in from right
                                inactive.style.opacity = '0';
                                inactive.style.transform = `translate3d(${slideOffsetPx}px,0,0)`;
                                active.style.opacity = '1';
                                active.style.transform = 'translate3d(0,0,0)';
                                inactive.style.transition = `transform ${effectMs}ms ease-in-out, opacity ${effectMs}ms ease-in-out`;
                                active.style.transition = `transform ${effectMs}ms ease-in-out, opacity ${effectMs}ms ease-in-out`;
                                requestAnimationFrame(() => {
                                    inactive.style.transform = 'translate3d(0,0,0)';
                                    inactive.style.opacity = '1';
                                    active.style.transform = `translate3d(-${slideOffsetPx}px,0,0)`;
                                    active.style.opacity = '0';
                                });

                                // Foreground: slide-out left, jump right, slide-in
                                setSceneVars({ ms: halfOutMs, xPx: -slideOffsetPx, opacity: 0 });
                                setTimeout(() => {
                                    try {
                                        updateInfo(nextItem);
                                        api.ensureVisibility();
                                    } catch (_) {
                                        /* noop */
                                    }
                                    // Jump to the right off-screen before sliding in
                                    setSceneVars({ ms: 0, xPx: slideOffsetPx, opacity: 0 });
                                    requestAnimationFrame(() => {
                                        setSceneVars({ ms: halfInMs, xPx: 0, opacity: 1 });
                                    });
                                }, halfOutMs);

                                setTimeout(() => {
                                    try {
                                        window.activeLayer = inactive;
                                        window.inactiveLayer = active;
                                        resetLayer(active);
                                        active.style.opacity = '0';
                                        inactive.style.opacity = '1';
                                        inactive.style.transform = 'translate3d(0,0,0)';
                                    } catch (_) {
                                        /* noop */
                                    }
                                    _state.isTransitioning = false;
                                }, effectMs + 50);
                            } else {
                                // Classic Ken Burns: slow pan + zoom with a gentle crossfade.
                                // (No effectPauseTime; the animation itself is the whole interval.)
                                const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
                                const rand = (min, max) => min + Math.random() * (max - min);

                                const crossfadeMs = clamp(Math.round(intervalMs * 0.16), 650, 1600);
                                const safeCrossfadeMs = clamp(crossfadeMs, 350, intervalMs - 400);

                                // Pan ranges (vw/vh) are small; scale ensures no edge reveal.
                                const zoomIn = Math.random() < 0.75;
                                const fromScale = zoomIn ? rand(1.03, 1.08) : rand(1.1, 1.17);
                                const toScale = zoomIn ? rand(1.1, 1.17) : rand(1.03, 1.08);

                                const fromX = rand(-4, 4);
                                const fromY = rand(-3, 3);
                                const toX = rand(-4, 4);
                                const toY = rand(-3, 3);

                                inactive.setAttribute('data-ss-kenburns', 'true');
                                inactive.style.setProperty(
                                    '--ss-kb-from-x',
                                    `${fromX.toFixed(2)}vw`
                                );
                                inactive.style.setProperty(
                                    '--ss-kb-from-y',
                                    `${fromY.toFixed(2)}vh`
                                );
                                inactive.style.setProperty('--ss-kb-to-x', `${toX.toFixed(2)}vw`);
                                inactive.style.setProperty('--ss-kb-to-y', `${toY.toFixed(2)}vh`);
                                inactive.style.setProperty(
                                    '--ss-kb-from-scale',
                                    String(fromScale.toFixed(3))
                                );
                                inactive.style.setProperty(
                                    '--ss-kb-to-scale',
                                    String(toScale.toFixed(3))
                                );

                                inactive.style.opacity = '0';
                                inactive.style.animation = `ss-kenburns ${intervalMs}ms ease-in-out forwards`;
                                inactive.style.transition = `opacity ${crossfadeMs}ms ease-in-out`;
                                active.style.transition = `opacity ${crossfadeMs}ms ease-in-out`;
                                requestAnimationFrame(() => {
                                    inactive.style.opacity = '1';
                                    active.style.opacity = '0';
                                });

                                // Foreground: keep stable (ensure fully visible)
                                setSceneVars({ ms: 320, xPx: 0, opacity: 1 });
                                updateInfo(nextItem);
                                try {
                                    api.ensureVisibility();
                                } catch (_) {
                                    /* noop */
                                }

                                setTimeout(() => {
                                    try {
                                        window.activeLayer = inactive;
                                        window.inactiveLayer = active;
                                        // Keep old active clean; KB must remain on active layer
                                        resetLayer(active);
                                        active.style.opacity = '0';
                                    } catch (_) {
                                        /* noop */
                                    }
                                    _state.isTransitioning = false;
                                }, safeCrossfadeMs + 50);
                            }

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
                        (la.hasAttribute('data-ss-kenburns') &&
                            la.getAttribute('data-ss-kenburns') !== 'false') ||
                        (lb.hasAttribute('data-ss-kenburns') &&
                            lb.getAttribute('data-ss-kenburns') !== 'false')
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
                                        break;
                                    }
                                }
                            } else if (patch[key] !== oldConfig[key]) {
                                hasVisualChanges = true;

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
                        }
                    }

                    if (!needsRestart && !hasVisualChanges) {
                        return;
                    }

                    // window.appConfig is already updated by core.js

                    // Always update visibility for visual elements
                    api.ensureVisibility();

                    // If clock settings changed, force immediate clock update
                    if (clockSettingsChanged && _clockUpdateFn) {
                        _clockUpdateFn();
                    }

                    // Apply preview orientation if provided (for preview mode only)
                    if (patch.previewOrientation) {
                        const isPortrait = patch.previewOrientation === 'portrait';
                        document.body.classList.toggle('preview-portrait', isPortrait);
                        document.body.classList.toggle('preview-landscape', !isPortrait);
                    }

                    // Apply screensaver orientation (auto/portrait/landscape/flipped variants)
                    if (patch.screensaverMode?.orientation) {
                        applyOrientation(patch.screensaverMode.orientation);
                    }

                    // Only restart cycler if timing/effect changed
                    if (needsRestart) {
                        api.startCycler();
                    }
                } catch (e) {
                    console.error('[Screensaver.applySettings] Error:', e);
                }
            },
            applyOrientation,
        };

        // Apply orientation with auto detection and flipped support
        function applyOrientation(orientation) {
            const body = document.body;

            // Remove existing orientation classes
            body.classList.remove(
                'orientation-auto',
                'orientation-portrait',
                'orientation-landscape',
                'orientation-portrait-flipped',
                'orientation-landscape-flipped'
            );

            // Handle auto orientation: use sensor if available, otherwise aspect ratio
            let resolvedOrientation = orientation;
            if (orientation === 'auto') {
                // Try screen orientation API first
                if (window.screen?.orientation?.type) {
                    const type = window.screen.orientation.type;
                    resolvedOrientation = type.includes('portrait') ? 'portrait' : 'landscape';
                } else {
                    // Fallback: use aspect ratio (width > height = landscape)
                    resolvedOrientation =
                        window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
                }
            }

            // Add resolved orientation class
            body.classList.add(`orientation-${resolvedOrientation}`);
        }

        // Attach to window; only on the screensaver page we actually use it, on others wrappers will no-op
        window.PosterramaScreensaver = api;

        // Listen for settingsUpdated event from core.js (preview mode, WebSocket, BroadcastChannel, etc.)
        try {
            if (document.body && document.body.dataset.mode === 'screensaver') {
                window.addEventListener('settingsUpdated', event => {
                    try {
                        const settings = event.detail?.settings;
                        if (settings) {
                            api.applySettings(settings);
                        }
                    } catch (e) {
                        console.error('[Screensaver] Failed to handle settingsUpdated:', e);
                    }
                });
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
