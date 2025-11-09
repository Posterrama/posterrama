// Wallart module: begin extracting wallart-specific helpers from script.js
/* eslint-disable prettier/prettier */
(function initWallartModule() {
    window.debugLog && window.debugLog('WALLART_MODULE_INIT', { timestamp: Date.now() });
    try {
        const logDebug = msg => {
            try {
                window.logger && typeof window.logger.debug === 'function'
                    ? window.logger.debug(msg)
                    : console.debug(msg);
            } catch (_) {
                /* noop: debug log optional */
            }
        };

        // --- Ambient overlay helpers (extracted for reuse) ---
        const ensureAmbientOverlay = () => {
            try {
                let ambient = document.getElementById('wallart-ambient-overlay');
                if (!ambient) {
                    ambient = document.createElement('div');
                    ambient.id = 'wallart-ambient-overlay';
                    document.body.appendChild(ambient);
                }
                return ambient;
            } catch (_) {
                /* best-effort UI helper */
                return null;
            }
        };

        const updateAmbientFromGrid = gridEl => {
            try {
                const ambient = ensureAmbientOverlay();
                if (!ambient || !gridEl) return;
                const imgs = Array.from(gridEl.querySelectorAll('img')).slice(0, 24);
                if (imgs.length === 0) return;

                let r = 18,
                    g = 23,
                    b = 34;
                let count = 1;

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                canvas.width = 8;
                canvas.height = 8;

                for (const img of imgs) {
                    try {
                        ctx.clearRect(0, 0, 8, 8);
                        ctx.drawImage(img, 0, 0, 8, 8);
                        const data = ctx.getImageData(2, 2, 4, 4).data;
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

                const comp = [255 - r, 255 - g, 255 - b].map(v => Math.max(24, Math.min(220, v)));
                const start = `rgba(${r}, ${g}, ${b}, 0.9)`;
                const end = `rgba(${comp[0]}, ${comp[1]}, ${comp[2]}, 0.9)`;
                const nextBg = `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
                ambient.style.background = nextBg;
                ambient.style.opacity = '0.5';
            } catch (_) {
                /* best-effort UI helper */
            }
        };

        const updateAmbientFromImage = img => {
            try {
                const ambient = ensureAmbientOverlay();
                if (!ambient || !img) return;

                let r = 18,
                    g = 23,
                    b = 34;
                let count = 1;

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                canvas.width = 8;
                canvas.height = 8;

                try {
                    ctx.clearRect(0, 0, 8, 8);
                    ctx.drawImage(img, 0, 0, 8, 8);
                    const data = ctx.getImageData(2, 2, 4, 4).data;
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

                const comp = [255 - r, 255 - g, 255 - b].map(v => Math.max(24, Math.min(220, v)));
                const start = `rgba(${r}, ${g}, ${b}, 0.9)`;
                const end = `rgba(${comp[0]}, ${comp[1]}, ${comp[2]}, 0.9)`;
                const nextBg = `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
                ambient.style.background = nextBg;
                ambient.style.opacity = '0.5';
            } catch (_) {
                /* best-effort UI helper */
            }
        };

        // Internal module state (kept minimal, per-page)
        const _state = {
            wallartGrid: null,
            layoutInfo: null,
            layoutVariant: 'classic',
            wallartConfig: {},
            appConfig: {},
            mediaQueue: [],
            currentPosters: [],
            usedPosters: new Set(),
            refreshTimeout: null,
            paused: false,
            refreshNow: null,
        };

        const api = {
            // Pure helper: compute grid sizing and placement
            calculateLayout(density = 'medium') {
                const screenWidth = window.innerWidth;
                const screenHeight = window.innerHeight;
                const isPortrait = screenHeight > screenWidth;
                const isMobile = screenWidth <= 768; // Mobile breakpoint
                const isPromoSite = document.body.classList.contains('promo-site');

                // Check if music mode is enabled - use square aspect ratio (1:1) for albums
                const isMusicMode = window.appConfig?.wallartMode?.musicMode?.enabled === true;
                const musicConfig = window.appConfig?.wallartMode?.musicMode || {};

                // Music density uses same values as wallart (low/medium/high/ludicrous)
                // No mapping needed - direct pass-through

                // Poster aspect ratio: 2/3 for movies, 1/1 for music albums (ALWAYS SQUARE!)
                // Music mode: variable SIZES of squares, not aspect ratios
                const posterAspectRatio = isMusicMode ? 1 : 2 / 3; // width/height

                // Adjust available screen height for promo site when promo box is visible
                let availableHeight = screenHeight;
                if (isPromoSite) {
                    const promoBox = document.getElementById('promo-box');
                    if (promoBox && !document.body.classList.contains('wallart-mode')) {
                        const promoBoxHeight = promoBox.offsetHeight || 120; // fallback height
                        availableHeight = screenHeight - promoBoxHeight * 0.8; // Give some margin
                    }
                }

                // Optimize for both desktop and mobile with different density factors
                let densityFactors;
                if (isMobile || isPortrait) {
                    densityFactors = { low: 0.25, medium: 0.2, high: 0.167, ludicrous: 0.11 };
                } else {
                    densityFactors = { low: 0.15, medium: 0.12, high: 0.09, ludicrous: 0.07 };
                }
                // Use music density if in music mode, otherwise use wallart density
                const effectiveDensity =
                    isMusicMode && musicConfig.density ? musicConfig.density : density;
                let densityFactor = densityFactors[effectiveDensity] || densityFactors['medium'];

                const isHeroGrid = window.wallartConfig?.layoutVariant === 'heroGrid';
                if (window.IS_PREVIEW && !isHeroGrid) {
                    densityFactor = densityFactor * 0.5; // Double the effective density for preview (classic layouts only)
                }

                // Calculate optimal poster width based on screen width and density
                const optimalPosterWidth = Math.max(1, Math.round(screenWidth * densityFactor));
                const optimalPosterHeight = Math.max(
                    1,
                    Math.round(optimalPosterWidth / posterAspectRatio)
                );

                // Calculate how many posters fit
                let cols = Math.floor(screenWidth / optimalPosterWidth);
                let rows = Math.floor(availableHeight / optimalPosterHeight);

                if (!Number.isFinite(cols) || cols < 1) cols = 1;
                if (!Number.isFinite(rows) || rows < 1) rows = 1;

                // Calculate poster dimensions with aspect ratio
                const actualPosterWidth = Math.max(1, Math.floor(screenWidth / cols));
                const actualPosterHeight = Math.max(
                    1,
                    Math.round(actualPosterWidth / posterAspectRatio)
                );

                // Check if we can fit the calculated height
                let finalRows = rows;
                let finalPosterHeight = actualPosterHeight;
                let finalPosterWidth = actualPosterWidth;

                // Grid optimization - fit as many posters as possible
                {
                    const calculatedGridHeight = rows * actualPosterHeight;
                    const remainingHeight = availableHeight - calculatedGridHeight;

                    if (remainingHeight > actualPosterHeight * 0.4) {
                        const newRows = rows + 1;
                        const heightPerRow = Math.floor(availableHeight / newRows);
                        const widthForHeight = Math.round(heightPerRow * posterAspectRatio);
                        if (widthForHeight * cols <= screenWidth) {
                            finalRows = newRows;
                            finalPosterHeight = heightPerRow;
                            finalPosterWidth = widthForHeight;
                        } else {
                            finalPosterHeight = Math.floor(availableHeight / rows);
                            finalPosterWidth = Math.round(finalPosterHeight * posterAspectRatio);
                            if (finalPosterWidth * cols > screenWidth) {
                                finalPosterWidth = Math.floor(screenWidth / cols);
                                finalPosterHeight = Math.round(
                                    finalPosterWidth / posterAspectRatio
                                );
                            }
                        }
                    } else if (remainingHeight < 0) {
                        finalPosterHeight = Math.floor(availableHeight / rows);
                        finalPosterWidth = Math.round(finalPosterHeight * posterAspectRatio);
                    }
                } // End of else block for music mode skip

                const gridWidth = cols * finalPosterWidth;
                const gridHeight = finalRows * finalPosterHeight;

                let gridLeft = Math.round((screenWidth - gridWidth) / 2);
                let gridTop = Math.round((availableHeight - gridHeight) / 2);

                if (isPromoSite) {
                    const topOffset = (screenHeight - availableHeight) / 2;
                    gridTop = Math.round(topOffset + (availableHeight - gridHeight) / 2);
                }

                if (isPortrait && gridLeft > finalPosterWidth * 0.5) {
                    const newPosterWidth = Math.floor(screenWidth / cols);
                    const newPosterHeight = Math.round(newPosterWidth / posterAspectRatio);
                    if (newPosterHeight * finalRows <= availableHeight) {
                        finalPosterWidth = newPosterWidth;
                        finalPosterHeight = newPosterHeight;
                        gridLeft = 0;
                        gridTop = Math.round((availableHeight - newPosterHeight * finalRows) / 2);
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
                const coverage = ((gridWidth * gridHeight) / (screenWidth * availableHeight)) * 100;

                logDebug(
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
            },
            // Start wallart cycle with module-owned lifecycle (idempotent)
            start(cfg) {
                try {
                    // Throttled live heartbeat trigger to reflect updates immediately
                    // Trigger immediate heartbeat on poster change
                    // Simple debounce to prevent duplicate calls within 500ms
                    const triggerLiveBeat = () => {
                        try {
                            const dev = window.PosterramaDevice;
                            if (!dev || typeof dev.beat !== 'function') return;
                            const now = Date.now();
                            const until = window.__posterramaBeatCooldownUntil || 0;
                            if (now < until) return;
                            window.__posterramaBeatCooldownUntil = now + 500;
                            dev.beat();
                        } catch (_) {
                            /* noop */
                        }
                    };
                    const wallartConfig = { ...(cfg || {}), ...(window.wallartConfig || {}) };

                    window.debugLog &&
                        window.debugLog('WALLART_START_CALLED', {
                            hasConfig: !!cfg,
                            retryCount: _state.startRetries || 0,
                        });

                    // Reuse global appConfig/mediaQueue when available to avoid duplicate fetches
                    const appConfig = window.appConfig || {};
                    const mediaQueue = Array.isArray(window.mediaQueue) ? window.mediaQueue : [];

                    // If no media yet, try to fetch then retry shortly to avoid blank screen
                    if (!mediaQueue || mediaQueue.length === 0) {
                        window.debugLog &&
                            window.debugLog('WALLART_NO_MEDIA_RETRY', {
                                retryCount: _state.startRetries || 0,
                            });

                        // Prevent infinite retry loop
                        _state.startRetries = (_state.startRetries || 0) + 1;
                        if (_state.startRetries > 5) {
                            window.debugLog && window.debugLog('WALLART_MAX_RETRIES_EXCEEDED', {});
                            console.error(
                                '[Wallart] Max retries exceeded, cannot start without media'
                            );
                            return;
                        }

                        try {
                            if (typeof window.fetchMedia === 'function') {
                                window.fetchMedia(true).catch(() => {
                                    /* noop: fetch best-effort */
                                });
                            }
                        } catch (_) {
                            /* noop: fetch trigger failed */
                        }
                        setTimeout(() => {
                            try {
                                if (
                                    Array.isArray(window.mediaQueue) &&
                                    window.mediaQueue.length > 0
                                ) {
                                    api.start(wallartConfig);
                                }
                            } catch (_) {
                                /* noop: retry start failed */
                            }
                        }, 600);
                        return;
                    }

                    // Reset retry counter on successful start
                    _state.startRetries = 0;
                    window.debugLog &&
                        window.debugLog('WALLART_START_WITH_MEDIA', {
                            mediaCount: mediaQueue.length,
                        });

                    // Ensure grid exists via helper
                    window.debugLog && window.debugLog('WALLART_CREATE_GRID_START', {});
                    const created = api.runtime.createGridElement(wallartConfig);
                    const wallartGrid = created.gridEl;
                    const layoutInfo = created.layoutInfo;
                    window.debugLog &&
                        window.debugLog('WALLART_CREATE_GRID_DONE', {
                            hasGrid: !!wallartGrid,
                            hasLayout: !!layoutInfo,
                        });
                    if (!wallartGrid || !layoutInfo) return;

                    const layoutVariant = wallartConfig.layoutVariant || 'classic';

                    // Populate grid and compute initial state
                    window.debugLog && window.debugLog('WALLART_INIT_GRID_START', {});
                    const posterCount = Math.min(
                        Number(layoutInfo.posterCount) || 0,
                        mediaQueue.length
                    );
                    const init = api.runtime.initializeGrid({
                        wallartGrid,
                        layoutInfo,
                        layoutVariant,
                        wallartConfig,
                        appConfig,
                        mediaQueue,
                        posterCount,
                    });
                    const currentPosters = init?.currentPosters || [];
                    const usedPosters = init?.usedPosters || new Set();
                    window.debugLog &&
                        window.debugLog('WALLART_INIT_GRID_DONE', {
                            postersCount: currentPosters.length,
                        });

                    // Persist module state
                    _state.wallartGrid = wallartGrid;
                    _state.layoutInfo = layoutInfo;
                    _state.layoutVariant = layoutVariant;
                    _state.wallartConfig = wallartConfig;
                    _state.appConfig = appConfig;
                    _state.mediaQueue = mediaQueue;
                    _state.currentPosters = currentPosters;
                    _state.usedPosters = usedPosters;
                    window.debugLog && window.debugLog('WALLART_STATE_PERSISTED', {});

                    // Expose read-only getter for device-mgmt heartbeats
                    try {
                        if (!Object.getOwnPropertyDescriptor(window, '__wallartCurrentPosters')) {
                            Object.defineProperty(window, '__wallartCurrentPosters', {
                                get() {
                                    return _state.currentPosters;
                                },
                            });
                        }
                    } catch (_) {
                        /* optional */
                    }

                    // Compute refresh interval logic (mirrors legacy)
                    const refreshRate = wallartConfig.refreshRate || wallartConfig.randomness || 5;
                    const randomness = wallartConfig.randomness || 0;
                    const baseInterval = 25000; // slowest
                    const minInterval = 2000; // fastest clamp
                    const refreshInterval = Math.max(
                        minInterval,
                        baseInterval - (refreshRate - 1) * 2555
                    );
                    let maxRandomVariation = 0;
                    if (randomness > 0) {
                        const baseVariation = refreshInterval * 0.4;
                        const randomnessMultiplier = randomness / 10;
                        maxRandomVariation = Math.round(baseVariation * randomnessMultiplier);
                    }

                    // Tick function (adapted from legacy refreshSinglePoster)
                    const refreshTick = () => {
                        window.debugLog && window.debugLog('WALLART_REFRESH_TICK', {});
                        try {
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_PAUSED_CHECK', {
                                    paused: !!_state.paused,
                                    isPinned: !!_state.isPinned,
                                });
                            // Respect paused state or pinned state (used by remote controls)
                            if (_state.paused || _state.isPinned) {
                                _state.refreshTimeout = setTimeout(refreshTick, 2000);
                                return;
                            }
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_EXTRACT_STATE', {});
                            const { wallartGrid, currentPosters, usedPosters } = _state;
                            const mediaQueue = _state.mediaQueue;
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_VALIDATION', {
                                    hasGrid: !!wallartGrid,
                                    postersCount: currentPosters?.length || 0,
                                    mediaCount: mediaQueue?.length || 0,
                                });
                            if (
                                !wallartGrid ||
                                currentPosters.length === 0 ||
                                mediaQueue.length === 0
                            ) {
                                window.debugLog &&
                                    window.debugLog('WALLART_REFRESH_NO_DATA', {
                                        hasGrid: !!wallartGrid,
                                        postersCount: currentPosters.length,
                                        mediaCount: mediaQueue.length,
                                    });
                                return; // nothing to do
                            }
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_GET_CONFIG', {});
                            // Use _state.wallartConfig to get latest settings (may be updated by preview)
                            const currentConfig = _state.wallartConfig || wallartConfig;
                            const animationType =
                                currentConfig.animationType ||
                                currentConfig.animationPack ||
                                'fade';

                            const packType = String(animationType).toLowerCase();

                            // Determine poster transition effect
                            // If packType is a burst pattern, use fade for individual posters
                            // Otherwise, use the packType as the poster transition
                            const burstPatterns = ['staggered', 'ripple', 'scanline'];
                            const posterTransition = burstPatterns.includes(packType)
                                ? 'fade'
                                : packType;

                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_QUERY_DOM', {
                                    packType,
                                    posterTransition,
                                });
                            const tileEls = wallartGrid.querySelectorAll('.wallart-poster-item');
                            const cols = parseInt(wallartGrid.dataset.columns || '0', 10);
                            const rows = parseInt(wallartGrid.dataset.rows || '0', 10);
                            const total = currentPosters.length;
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_DOM_QUERIED', {
                                    tileCount: tileEls.length,
                                    cols,
                                    rows,
                                    total,
                                });
                            if (!cols || !rows || tileEls.length === 0) return;

                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_DEFINE_HELPERS', {});
                            // Helper to get a new poster (uses module helper)
                            const getUnique = excludeId =>
                                api.runtime.getUniqueRandomPoster(
                                    currentPosters,
                                    usedPosters,
                                    mediaQueue,
                                    excludeId
                                );

                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_CHECK_PACK_TYPE', {
                                    packType,
                                });
                            // Burst-style packs
                            if (
                                packType === 'staggered' ||
                                packType === 'ripple' ||
                                packType === 'scanline'
                            ) {
                                const rr =
                                    wallartConfig.refreshRate || wallartConfig.randomness || 5;
                                const base = 4 + Math.round(rr / 3);
                                let burstSize = Math.min(
                                    Math.max(base, Math.ceil(total * 0.06)),
                                    12
                                );
                                burstSize = Math.max(3, Math.min(burstSize, total));

                                let indices = Array.from({ length: total }, (_, i) => i);
                                if (wallartGrid.dataset.heroGrid === 'true') {
                                    indices = indices.filter(
                                        i => tileEls[i]?.dataset?.hero !== 'true'
                                    );
                                }

                                let ordered = [];
                                const delays = new Map();
                                const cooldownSets = Array.isArray(window._wallartRecentUpdates)
                                    ? window._wallartRecentUpdates
                                    : [];
                                const cooldown = new Set();
                                try {
                                    for (const s of cooldownSets)
                                        s && s.forEach && s.forEach(i => cooldown.add(i));
                                } catch (_) {
                                    /* ignore */
                                }

                                if (packType === 'staggered') {
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
                                    window._wallartDiagFlip = !window._wallartDiagFlip;
                                    let diags = Array.from(byDiag.keys()).sort((a, b) => a - b);
                                    if (window._wallartDiagFlip) diags.reverse();
                                    const startOffset = Math.floor(Math.random() * diags.length);
                                    diags = diags
                                        .slice(startOffset)
                                        .concat(diags.slice(0, startOffset));
                                    const diagQuota = total >= 60 ? 2 : 1;
                                    const picked = [];
                                    for (const d of diags) {
                                        const group = byDiag.get(d) || [];
                                        group.sort(() => Math.random() - 0.5);
                                        for (
                                            let k = 0;
                                            k < Math.min(diagQuota, group.length);
                                            k++
                                        ) {
                                            picked.push(group[k]);
                                            if (picked.length >= burstSize) break;
                                        }
                                        if (picked.length >= burstSize) break;
                                    }
                                    const chosen = picked.map(p => p.i);
                                    const filtered = chosen.filter(i => !cooldown.has(i));
                                    if (
                                        filtered.length >= Math.max(3, Math.floor(burstSize * 0.7))
                                    ) {
                                        ordered = filtered.slice(0, burstSize);
                                    } else {
                                        ordered = filtered
                                            .concat(chosen.filter(i => !filtered.includes(i)))
                                            .slice(0, burstSize);
                                    }
                                    for (const i of ordered) {
                                        const r = Math.floor(i / cols);
                                        const c = i % cols;
                                        const diag = r + c;
                                        const jitter = Math.floor(Math.random() * 90);
                                        const checker = ((r + c) % 2) * 25;
                                        delays.set(i, diag * 80 + jitter + checker);
                                    }
                                } else if (packType === 'ripple') {
                                    const originIndex = Math.floor(Math.random() * total);
                                    const oc = originIndex % cols;
                                    const orow = Math.floor(originIndex / cols);
                                    const withDistance = indices.map(i => {
                                        const row = Math.floor(i / cols);
                                        const col = i % cols;
                                        const dist = Math.hypot(col - oc, row - orow);
                                        const ring = Math.max(0, Math.floor(dist));
                                        return { i, row, col, dist, ring };
                                    });
                                    const rr2 =
                                        wallartConfig.refreshRate || wallartConfig.randomness || 5;
                                    let targetBurst = Math.ceil(total * 0.1) + Math.floor(rr2 / 2);
                                    targetBurst = Math.max(
                                        6,
                                        Math.min(targetBurst, Math.ceil(total * 0.22), 24)
                                    );
                                    const byRing = new Map();
                                    for (const item of withDistance) {
                                        if (!byRing.has(item.ring)) byRing.set(item.ring, []);
                                        byRing.get(item.ring).push(item);
                                    }
                                    const rings = Array.from(byRing.keys()).sort((a, b) => a - b);
                                    const ringQuota = total >= 60 ? 3 : 2;
                                    const picked = [];
                                    for (const ring of rings) {
                                        const group = byRing.get(ring) || [];
                                        group.sort(() => Math.random() - 0.5);
                                        for (
                                            let k = 0;
                                            k < Math.min(ringQuota, group.length);
                                            k++
                                        ) {
                                            picked.push(group[k]);
                                            if (picked.length >= targetBurst) break;
                                        }
                                        if (picked.length >= targetBurst) break;
                                    }
                                    if (picked.length < targetBurst) {
                                        const remaining = withDistance
                                            .filter(x => !picked.some(p => p.i === x.i))
                                            .sort((a, b) => a.dist - b.dist)
                                            .slice(0, targetBurst - picked.length);
                                        picked.push(...remaining);
                                    }
                                    const chosen = picked.map(p => p.i);
                                    const filtered = chosen.filter(i => !cooldown.has(i));
                                    if (
                                        filtered.length >=
                                        Math.max(3, Math.floor(targetBurst * 0.7))
                                    ) {
                                        ordered = filtered.slice(0, targetBurst);
                                    } else {
                                        ordered = filtered
                                            .concat(chosen.filter(i => !filtered.includes(i)))
                                            .slice(0, targetBurst);
                                    }
                                    for (const p of picked) {
                                        const jitter = Math.floor(Math.random() * 120);
                                        const checker = ((p.row + p.col) % 2) * 30;
                                        delays.set(p.i, p.ring * 140 + jitter + checker);
                                    }
                                } else if (packType === 'scanline') {
                                    if (typeof window._wallartScanline === 'undefined') {
                                        window._wallartScanline = { row: 0, dir: 1 };
                                    }
                                    const s = window._wallartScanline;
                                    const thickness = rows >= 6 ? 2 : 1;
                                    const rowsToUpdate = [];
                                    for (let t = 0; t < thickness; t++) {
                                        const r = s.row + t * s.dir;
                                        if (r >= 0 && r < rows) rowsToUpdate.push(r);
                                    }
                                    s.row += s.dir;
                                    if (s.row >= rows - 1 || s.row <= 0) {
                                        s.dir *= -1;
                                        s.row = Math.max(0, Math.min(rows - 1, s.row));
                                    }
                                    const chosen = [];
                                    for (const r of rowsToUpdate) {
                                        for (let c = 0; c < cols; c++) chosen.push(r * cols + c);
                                    }
                                    let chosenFiltered = chosen.filter(i => !cooldown.has(i));
                                    if (
                                        chosenFiltered.length <
                                        Math.max(3, Math.floor(chosen.length * 0.6))
                                    ) {
                                        chosenFiltered = chosen;
                                    }
                                    ordered = chosenFiltered;
                                    window._wallartScanlineFlip = !window._wallartScanlineFlip;
                                    for (const i of ordered) {
                                        const r = Math.floor(i / cols);
                                        const c = i % cols;
                                        const base = window._wallartScanlineFlip ? c : cols - 1 - c;
                                        const jitter = Math.floor(Math.random() * 40);
                                        delays.set(i, base * 45 + (r % rows) * 10 + jitter);
                                    }
                                }

                                // Execute burst
                                let maxDelay = 0;
                                window.debugLog &&
                                    window.debugLog('WALLART_REFRESH_TICK_EXECUTE_BURST', {
                                        orderedCount: ordered.length,
                                    });
                                for (const idx of ordered) {
                                    const delay = delays.get(idx) || 0;
                                    if (delay > maxDelay) maxDelay = delay;
                                    setTimeout(() => {
                                        const targetElement = tileEls[idx];
                                        if (!targetElement) return;
                                        const currentPosterAtPosition = currentPosters[idx];
                                        const currentPosterId = currentPosterAtPosition
                                            ? currentPosterAtPosition.id ||
                                              currentPosterAtPosition.title ||
                                              currentPosterAtPosition.posterUrl
                                            : null;
                                        const next = getUnique(currentPosterId);
                                        if (!next) return;
                                        if (currentPosterAtPosition && currentPosterId)
                                            usedPosters.delete(currentPosterId);
                                        currentPosters[idx] = next;
                                        targetElement.dataset.posterId =
                                            next.id || next.title || String(idx);
                                        window.debugLog &&
                                            window.debugLog('WALLART_REFRESH_TICK_BEFORE_ANIMATE', {
                                                idx,
                                                posterTransition,
                                            });
                                        const fn = window.animatePosterChange || null;
                                        if (fn && typeof fn === 'function')
                                            fn(targetElement, next, posterTransition);
                                        window.debugLog &&
                                            window.debugLog('WALLART_REFRESH_TICK_AFTER_ANIMATE', {
                                                idx,
                                            });
                                        // Keep heartbeat focused on hero; do not override current media here
                                    }, delay);
                                }
                                try {
                                    window._wallartRecentUpdates = Array.isArray(
                                        window._wallartRecentUpdates
                                    )
                                        ? window._wallartRecentUpdates
                                        : [];
                                    window._wallartRecentUpdates.push(new Set(ordered));
                                    if (window._wallartRecentUpdates.length > 3) {
                                        window._wallartRecentUpdates.shift();
                                    }
                                } catch (_) {
                                    /* ignore */
                                }

                                const randomFactor = Math.random() * Math.random();
                                const isNegative = Math.random() < 0.5;
                                const randomVariation =
                                    (isNegative ? -1 : 1) * randomFactor * maxRandomVariation;
                                const nextInterval = Math.max(
                                    200,
                                    refreshInterval + randomVariation
                                );
                                const padding = 250;
                                _state.refreshTimeout = setTimeout(
                                    refreshTick,
                                    nextInterval + maxDelay + padding
                                );
                                return; // done
                            }

                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_SINGLE_TILE_PATH', {});
                            // Single-tile update path
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
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_RANDOM_POSITION_SELECTED', {
                                    randomPosition,
                                });
                            if (wallartGrid.dataset.heroGrid === 'true') {
                                if (tileEls[randomPosition]?.dataset?.hero === 'true') {
                                    const candidates = Array.from(tileEls)
                                        .map((_, i) => i)
                                        .filter(i => tileEls[i]?.dataset?.hero !== 'true');
                                    if (candidates.length > 0) {
                                        randomPosition =
                                            candidates[
                                                Math.floor(Math.random() * candidates.length)
                                            ];
                                    }
                                }
                            }
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_HERO_CHECK_DONE', {
                                    randomPosition,
                                });
                            window.lastWallartPosition = randomPosition;
                            const currentPosterAtPosition = currentPosters[randomPosition];
                            const currentPosterId = currentPosterAtPosition
                                ? currentPosterAtPosition.id ||
                                  currentPosterAtPosition.title ||
                                  currentPosterAtPosition.posterUrl
                                : null;
                            const next = getUnique(currentPosterId);
                            if (!next) return;
                            if (currentPosterAtPosition && currentPosterId)
                                usedPosters.delete(currentPosterId);
                            currentPosters[randomPosition] = next;
                            const targetElement = tileEls[randomPosition];
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_SINGLE_BEFORE_ANIMATE', {
                                    randomPosition,
                                    posterTransition,
                                });
                            if (targetElement) {
                                targetElement.dataset.posterId =
                                    next.id || next.title || randomPosition;
                                const fn = window.animatePosterChange || null;
                                if (fn && typeof fn === 'function')
                                    fn(targetElement, next, posterTransition);
                                // Keep heartbeat focused on hero; do not override current media here
                            }
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_SINGLE_AFTER_ANIMATE', {
                                    randomPosition,
                                });
                            const randomFactor = Math.random() * Math.random();
                            const isNegative = Math.random() < 0.5;
                            const randomVariation =
                                (isNegative ? -1 : 1) * randomFactor * maxRandomVariation;
                            const nextInterval = Math.max(200, refreshInterval + randomVariation);
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_SCHEDULE_NEXT', {
                                    nextInterval,
                                });
                            _state.refreshTimeout = setTimeout(refreshTick, nextInterval);
                            window.debugLog && window.debugLog('WALLART_REFRESH_TICK_COMPLETE', {});
                        } catch (_) {
                            window.debugLog &&
                                window.debugLog('WALLART_REFRESH_TICK_ERROR', { error: String(_) });
                            // non-fatal: schedule another attempt to keep UI alive
                            _state.refreshTimeout = setTimeout(refreshTick, 3000);
                        }
                    };

                    // Start periodic refresh
                    // Expose a way for remote to force a tick
                    _state.refreshNow = () => {
                        try {
                            if (_state.refreshTimeout) clearTimeout(_state.refreshTimeout);
                        } catch (_) {
                            /* ignore clear */
                        }
                        refreshTick();
                    };
                    if (_state.refreshTimeout) clearTimeout(_state.refreshTimeout);
                    window.debugLog &&
                        window.debugLog('WALLART_SCHEDULE_REFRESH_TICK', { delayMs: 1200 });
                    _state.refreshTimeout = setTimeout(refreshTick, 1200);

                    // Seed current media for device-mgmt visibility (prefer hero if present)
                    try {
                        const first = currentPosters && currentPosters[0];
                        if (first) {
                            window.__posterramaCurrentMedia = first;
                            window.__posterramaCurrentMediaId =
                                first.id || first.title || first.posterUrl || null;
                            window.__posterramaPaused = false;
                        }
                    } catch (_) {
                        /* expose initial media best-effort */
                    }
                    // Initial beat handled near hero attach when applicable

                    // Minimal playback hooks so device-mgmt commands log and act
                    try {
                        window.__posterramaPlayback = {
                            next: () => {
                                try {
                                    _state.paused = false;
                                    _state.isPinned = false;
                                    _state.pinnedMediaId = null;
                                    _state.refreshNow && _state.refreshNow();
                                } catch (_) {
                                    /* ignore playback next */
                                }
                            },
                            prev: () => {
                                try {
                                    _state.paused = false;
                                    _state.isPinned = false;
                                    _state.pinnedMediaId = null;
                                    _state.refreshNow && _state.refreshNow();
                                } catch (_) {
                                    /* ignore playback prev */
                                }
                            },
                            pause: () => {
                                _state.paused = true;
                                try {
                                    window.__posterramaPaused = true;
                                } catch (_) {
                                    /* ignore flag */
                                }
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
                                    /* ignore flag */
                                }
                                try {
                                    triggerLiveBeat();
                                } catch (_) {
                                    /* noop */
                                }
                                try {
                                    _state.refreshNow && _state.refreshNow();
                                } catch (_) {
                                    /* ignore refresh */
                                }
                            },
                            pinPoster: payload => {
                                try {
                                    _state.isPinned = true;
                                    _state.paused = true;
                                    _state.pinnedMediaId =
                                        payload?.mediaId ||
                                        window.__posterramaCurrentMediaId ||
                                        null;
                                    window.__posterramaPaused = true;

                                    window.debugLog &&
                                        window.debugLog('WALLART_POSTER_PINNED', {
                                            mediaId: _state.pinnedMediaId,
                                        });

                                    try {
                                        triggerLiveBeat();
                                    } catch (_) {
                                        /* noop */
                                    }
                                } catch (_) {
                                    /* ignore pin poster */
                                }
                            },
                        };
                    } catch (_) {
                        /* expose playback best-effort */
                    }
                } catch (_) {
                    /* noop */
                }
            },
            // Stop/cleanup wallart cycle
            stop() {
                try {
                    if (_state.refreshTimeout) {
                        clearTimeout(_state.refreshTimeout);
                        _state.refreshTimeout = null;
                    }
                    if (window.wallartHeroTimer) {
                        clearInterval(window.wallartHeroTimer);
                        window.wallartHeroTimer = null;
                    }
                    const grid = document.getElementById('wallart-grid');
                    if (grid) grid.remove();
                    const ambient = document.getElementById('wallart-ambient-overlay');
                    if (ambient) ambient.remove();
                } catch (_) {
                    /* noop */
                }
            },
            ambient: {
                ensure: ensureAmbientOverlay,
                updateFromGrid: updateAmbientFromGrid,
                updateFromImage: updateAmbientFromImage,
            },
            // Create and attach the grid element using module's layout calculation
            runtime: {
                initializeGrid(params = {}) {
                    try {
                        // Local throttled heartbeat helper
                        const safeBeat = () => {
                            try {
                                const dev = window.PosterramaDevice;
                                if (!dev || typeof dev.beat !== 'function') return;
                                const now = Date.now();
                                const until = window.__posterramaBeatCooldownUntil || 0;
                                if (now < until) return;
                                window.__posterramaBeatCooldownUntil = now + 1500;
                                dev.beat();
                            } catch (_) {
                                /* noop */
                            }
                        };
                        const {
                            wallartGrid,
                            layoutInfo,
                            layoutVariant = 'classic',
                            wallartConfig = {},
                            appConfig = {},
                            mediaQueue = [],
                            posterCount: posterCountIn,
                        } = params || {};
                        if (!wallartGrid || !layoutInfo) return null;
                        const posterCount = Math.min(
                            Number(posterCountIn || layoutInfo.posterCount) || 0,
                            Array.isArray(mediaQueue) ? mediaQueue.length : 0
                        );
                        if (posterCount <= 0) return { currentPosters: [], usedPosters: new Set() };

                        const currentPosters = [];
                        const usedPosters = new Set();

                        // Apply base grid CSS according to layoutInfo
                        const cols = layoutInfo.columns;
                        const rows = layoutInfo.rows;
                        wallartGrid.style.cssText = `
                            display: grid !important;
                            grid-template-columns: repeat(${cols}, ${layoutInfo.actualPosterWidth}px) !important;
                            grid-template-rows: repeat(${rows}, ${layoutInfo.actualPosterHeight}px) !important;
                            gap: 0 !important;
                            padding: 0 !important;
                            margin: 0 !important;
                            background: transparent !important;
                            width: ${cols * layoutInfo.actualPosterWidth}px !important;
                            height: ${rows * layoutInfo.actualPosterHeight}px !important;
                            position: fixed !important;
                            top: ${layoutInfo.gridTop}px !important;
                            left: ${layoutInfo.gridLeft}px !important;
                            z-index: 10000 !important;
                            overflow: visible !important;
                        `;
                        wallartGrid.dataset.columns = String(cols);
                        wallartGrid.dataset.rows = String(rows);

                        // Helper to request a unique poster from queue
                        const pickUnique = excludeId =>
                            api.runtime.getUniqueRandomPoster(
                                currentPosters,
                                usedPosters,
                                mediaQueue,
                                excludeId
                            );

                        // Music mode uses the same layout as configured in wallart
                        const effectiveLayoutVariant = layoutVariant;

                        if (effectiveLayoutVariant === 'heroGrid') {
                            // Determine hero settings
                            const heroCfg = (wallartConfig.layoutSettings || {}).heroGrid || {};
                            const rawHeroSideValue =
                                heroCfg.heroSide || wallartConfig.heroSide || appConfig.heroSide;
                            const rawHeroSide = (rawHeroSideValue || '').toString().toLowerCase();
                            const heroSide = rawHeroSide === 'right' ? 'right' : 'left';
                            const heroRotValue =
                                heroCfg.heroRotationMinutes ??
                                wallartConfig.heroRotationMinutes ??
                                appConfig.heroRotationMinutes;
                            const heroRotationMinutes = Math.max(0, Number(heroRotValue) || 10);

                            // Determine poster transition for hero rotation
                            const animationType =
                                wallartConfig.animationType ||
                                wallartConfig.animationPack ||
                                'fade';
                            const burstPatterns = ['staggered', 'ripple', 'scanline'];
                            const heroPosterTransition = burstPatterns.includes(
                                animationType.toLowerCase()
                            )
                                ? 'fade'
                                : animationType.toLowerCase();

                            wallartGrid.dataset.layoutVariant = 'heroGrid';
                            wallartGrid.dataset.heroGrid = 'true';
                            wallartGrid.dataset.heroSide = heroSide;

                            // Compute hero span
                            const baseCellW = layoutInfo.actualPosterWidth;
                            const baseCellH = layoutInfo.actualPosterHeight;
                            const portraitMode = window.innerHeight > window.innerWidth;
                            const isMusicMode = appConfig?.wallartMode?.musicMode?.enabled === true;

                            let heroSpan;
                            let heroRowSpan;

                            if (portraitMode) {
                                heroSpan = 4; // 4x4
                                heroRowSpan = 4;
                                heroSpan = Math.max(2, Math.min(heroSpan, cols - 1));
                                heroRowSpan = Math.max(2, Math.min(heroRowSpan, rows - 1));
                            } else {
                                if (isMusicMode) {
                                    // For music mode: make hero PERFECTLY SQUARE (same rows as cols)
                                    // Use about 1/3 of the screen width
                                    heroSpan = Math.max(2, Math.min(Math.floor(cols / 3), rows));
                                    heroRowSpan = heroSpan; // SQUARE!
                                    // Ensure we don't take up the whole screen
                                    const minRemainingCols = Math.max(2, Math.ceil(cols * 0.25));
                                    if (heroSpan > cols - minRemainingCols) {
                                        heroSpan = Math.max(2, cols - minRemainingCols);
                                        heroRowSpan = heroSpan;
                                    }
                                    // Also check rows
                                    if (heroRowSpan > rows - 1) {
                                        heroRowSpan = Math.max(2, rows - 1);
                                        heroSpan = heroRowSpan;
                                    }
                                } else {
                                    // For movies: use 2:3 aspect ratio
                                    const aspectRatio = 2 / 3;
                                    const heroTargetW = Math.round(
                                        aspectRatio * (rows * baseCellH)
                                    );
                                    heroSpan = Math.max(1, Math.round(heroTargetW / baseCellW));
                                    const minRemainingCols = Math.max(2, Math.ceil(cols * 0.25));
                                    heroSpan = Math.min(heroSpan, cols - minRemainingCols);
                                    heroSpan = Math.max(2, heroSpan);
                                    heroRowSpan = rows; // Full height for movies
                                }
                            }

                            // Occupancy grid
                            const occupied = Array.from({ length: rows }, () =>
                                Array(cols).fill(false)
                            );

                            // Place hero first
                            const firstHero = pickUnique(null);
                            if (firstHero) {
                                currentPosters.push(firstHero);
                                const heroEl = api.runtime.createPosterElement(firstHero, 0);
                                const startCol = heroSide === 'left' ? 1 : cols - heroSpan + 1;
                                heroEl.style.gridColumn = `${startCol} / span ${heroSpan}`;

                                if (portraitMode) {
                                    const heroHeight = heroRowSpan || 4;
                                    if (rows >= heroHeight + 2) {
                                        const heroStartRow =
                                            Math.floor((rows - heroHeight) / 2) + 1;
                                        const heroEndRow = heroStartRow + heroHeight;
                                        heroEl.style.gridRow = `${heroStartRow} / ${heroEndRow}`;
                                    } else if (rows >= heroHeight) {
                                        heroEl.style.gridRow = `1 / ${heroHeight + 1}`;
                                    } else {
                                        heroEl.style.gridRow = `1 / -1`;
                                    }
                                } else {
                                    if (isMusicMode) {
                                        // For music: center the square hero vertically
                                        const heroStartRow = Math.max(
                                            1,
                                            Math.floor((rows - heroRowSpan) / 2) + 1
                                        );
                                        heroEl.style.gridRow = `${heroStartRow} / span ${heroRowSpan}`;
                                    } else {
                                        // For movies: full height
                                        heroEl.style.gridRow = `1 / -1`;
                                    }
                                }
                                heroEl.dataset.hero = 'true';
                                const heroImg = heroEl.querySelector('img');
                                if (heroImg) {
                                    // For music mode, use cover to fill the square hero area
                                    heroImg.style.objectFit = isMusicMode ? 'cover' : 'contain';
                                    heroImg.style.objectPosition = 'center';
                                    heroImg.style.background = 'black';
                                    heroImg.style.transform = 'none';
                                }
                                heroEl.style.opacity = '0';
                                heroEl.style.transition = 'opacity 600ms ease';
                                setTimeout(() => (heroEl.style.opacity = '1'), 60);
                                wallartGrid.appendChild(heroEl);
                                // Expose hero as current media for device heartbeat
                                try {
                                    window.__posterramaCurrentMedia = firstHero;
                                    window.__posterramaCurrentMediaId =
                                        firstHero.id ||
                                        firstHero.title ||
                                        firstHero.posterUrl ||
                                        null;
                                    window.__posterramaPaused = false;
                                } catch (_) {
                                    /* best-effort hero exposure */
                                }
                                try {
                                    safeBeat();
                                } catch (_) {
                                    /* noop */
                                }

                                // Mark occupied
                                if (portraitMode) {
                                    const heroHeight = heroRowSpan || Math.min(4, rows);
                                    let heroStartRow = 0;
                                    if (rows >= heroHeight + 2) {
                                        heroStartRow = Math.floor((rows - heroHeight) / 2);
                                    }
                                    for (
                                        let r = heroStartRow;
                                        r < Math.min(rows, heroStartRow + heroHeight);
                                        r++
                                    ) {
                                        for (let c = 0; c < heroSpan; c++) {
                                            const colIdx =
                                                (heroSide === 'left' ? 0 : cols - heroSpan) + c;
                                            occupied[r][colIdx] = true;
                                        }
                                    }
                                } else {
                                    if (isMusicMode) {
                                        // For music: only mark the square hero area
                                        const heroStartRow = Math.max(
                                            0,
                                            Math.floor((rows - heroRowSpan) / 2)
                                        );
                                        for (
                                            let r = heroStartRow;
                                            r < Math.min(rows, heroStartRow + heroRowSpan);
                                            r++
                                        ) {
                                            for (let c = 0; c < heroSpan; c++) {
                                                const colIdx =
                                                    (heroSide === 'left' ? 0 : cols - heroSpan) + c;
                                                occupied[r][colIdx] = true;
                                            }
                                        }
                                    } else {
                                        // For movies: mark full height
                                        for (let r = 0; r < rows; r++) {
                                            for (let c = 0; c < heroSpan; c++) {
                                                const colIdx =
                                                    (heroSide === 'left' ? 0 : cols - heroSpan) + c;
                                                occupied[r][colIdx] = true;
                                            }
                                        }
                                    }
                                }

                                // Hero rotation timer (export to global for symmetry with legacy)
                                try {
                                    if (window.wallartHeroTimer) {
                                        clearInterval(window.wallartHeroTimer);
                                        window.wallartHeroTimer = null;
                                    }
                                    if (heroRotationMinutes > 0) {
                                        const ms = heroRotationMinutes * 60 * 1000;
                                        window.wallartHeroTimer = setInterval(() => {
                                            const currentHero = currentPosters[0];
                                            const excludeId = currentHero
                                                ? currentHero.id ||
                                                  currentHero.title ||
                                                  currentHero.posterUrl
                                                : null;
                                            const next = pickUnique(excludeId);
                                            if (!next) return;
                                            currentPosters[0] = next;
                                            const heroElNow =
                                                wallartGrid.querySelector('[data-hero="true"]');
                                            if (heroElNow) {
                                                const fn = window.animatePosterChange || null;
                                                if (fn && typeof fn === 'function')
                                                    fn(heroElNow, next, heroPosterTransition);
                                            }
                                            // Update heartbeat exposure to new hero
                                            try {
                                                window.__posterramaCurrentMedia = next;
                                                window.__posterramaCurrentMediaId =
                                                    next.id || next.title || next.posterUrl || null;
                                                window.__posterramaPaused = false;
                                            } catch (_) {
                                                /* noop */
                                            }
                                            try {
                                                safeBeat();
                                            } catch (_) {
                                                /* noop */
                                            }
                                        }, ms);
                                    }
                                } catch (_) {
                                    /* no-op: hero rotation timer cleanup */
                                }
                            }

                            // Placement helpers
                            const placeTile = (r, c, hSpan, wSpan, poster, orderIndex) => {
                                const el = api.runtime.createPosterElement(poster, orderIndex);
                                el.style.gridRow = `${r + 1} / span ${hSpan}`;
                                el.style.gridColumn = `${c + 1} / span ${wSpan}`;
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

                            // Aim for a few mediums (2x2) then fill with singles
                            const heroArea = heroSpan * rows;
                            const areaCells = Math.max(0, cols * rows - heroArea);
                            let targetMedium = 3;
                            const minCellsForThree =
                                3 * 4 + Math.max(2, Math.floor(areaCells * 0.1));
                            if (areaCells < minCellsForThree) targetMedium = 2;

                            // Place mediums
                            const mediumCandidates = [];
                            for (let r = 0; r < rows - 1; r++) {
                                for (let c = 0; c < cols - 1; c++) mediumCandidates.push({ r, c });
                            }
                            mediumCandidates.sort(() => Math.random() - 0.5);
                            let placedMedium = 0;
                            let counter = 0;
                            for (const { r, c } of mediumCandidates) {
                                if (placedMedium >= targetMedium) break;
                                if (!canPlace(r, c, 2, 2)) continue;
                                const poster = pickUnique(null);
                                if (!poster) continue;
                                currentPosters.push(poster);
                                placeTile(r, c, 2, 2, poster, ++counter);
                                mark(r, c, 2, 2);
                                placedMedium++;
                            }
                            if (placedMedium < targetMedium) {
                                const additional = [];
                                for (let r = 0; r < rows - 1; r++) {
                                    for (let c = 0; c < cols - 1; c++) additional.push({ r, c });
                                }
                                additional.sort(() => Math.random() - 0.5);
                                for (const { r, c } of additional) {
                                    if (placedMedium >= targetMedium) break;
                                    if (!canPlace(r, c, 2, 2)) continue;
                                    const poster = pickUnique(null);
                                    if (!poster) continue;
                                    currentPosters.push(poster);
                                    placeTile(r, c, 2, 2, poster, ++counter);
                                    mark(r, c, 2, 2);
                                    placedMedium++;
                                }
                            }
                            // Fill singles
                            for (let r = 0; r < rows; r++) {
                                for (let c = 0; c < cols; c++) {
                                    if (occupied[r][c]) continue;
                                    const poster = pickUnique(null);
                                    if (!poster) continue;
                                    currentPosters.push(poster);
                                    placeTile(r, c, 1, 1, poster, ++counter);
                                    occupied[r][c] = true;
                                }
                            }
                        } else {
                            // Classic layout
                            wallartGrid.dataset.layoutVariant = 'classic';
                            const pack = (
                                wallartConfig.animationPack ||
                                (['staggered', 'ripple', 'scanline'].includes(
                                    (wallartConfig.animationType || '').toLowerCase()
                                )
                                    ? wallartConfig.animationType
                                    : null) ||
                                'staggered'
                            ).toLowerCase();
                            for (let i = 0; i < posterCount; i++) {
                                const poster = pickUnique(null);
                                if (!poster) break;
                                currentPosters.push(poster);
                                const el = api.runtime.createPosterElement(poster, i);
                                if (pack === 'staggered') {
                                    el.style.opacity = '0';
                                    el.style.transform = 'scale(0.96)';
                                    el.style.transition =
                                        'opacity 500ms ease, transform 600ms ease';
                                    const delay = (i % cols) * 60 + Math.floor(i / cols) * 40;
                                    setTimeout(() => {
                                        el.style.opacity = '1';
                                        el.style.transform = 'scale(1)';
                                    }, delay);
                                } else if (pack === 'ripple') {
                                    const col = i % cols;
                                    const row = Math.floor(i / cols);
                                    const cx = (cols - 1) / 2;
                                    const cy = (rows - 1) / 2;
                                    const dist = Math.hypot(col - cx, row - cy);
                                    const delay = Math.round(dist * 90);
                                    el.style.opacity = '0';
                                    el.style.transform = 'scale(0.94)';
                                    el.style.transition =
                                        'opacity 520ms ease, transform 620ms ease';
                                    setTimeout(() => {
                                        el.style.opacity = '1';
                                        el.style.transform = 'scale(1)';
                                    }, delay);
                                } else if (pack === 'scanline') {
                                    const col = i % cols;
                                    const row = Math.floor(i / cols);
                                    el.style.opacity = '0';
                                    el.style.transform = 'translateY(8px)';
                                    el.style.transition =
                                        'opacity 420ms ease-out, transform 460ms ease-out';
                                    const delay =
                                        row * 90 + col * 35 + Math.floor(Math.random() * 30);
                                    setTimeout(() => {
                                        el.style.opacity = '1';
                                        el.style.transform = 'translateY(0)';
                                    }, delay);
                                } else {
                                    el.style.animationDelay = `${i * 0.02}s`;
                                    el.style.animation = 'wallartFadeIn 0.6s ease-out forwards';
                                }
                                wallartGrid.appendChild(el);
                            }
                        }

                        // Ambient overlay after render
                        try {
                            if (wallartConfig.ambientGradient) {
                                const ambientMod =
                                    window.PosterramaWallart && window.PosterramaWallart.ambient;
                                const isHero = wallartGrid?.dataset?.heroGrid === 'true';
                                if (isHero) {
                                    const heroImg =
                                        wallartGrid.querySelector('[data-hero="true"] img');
                                    if (heroImg) {
                                        if (ambientMod?.updateFromImage)
                                            ambientMod.updateFromImage(heroImg);
                                        else updateAmbientFromImage(heroImg);
                                    } else {
                                        if (ambientMod?.updateFromGrid)
                                            ambientMod.updateFromGrid(wallartGrid);
                                        else updateAmbientFromGrid(wallartGrid);
                                    }
                                } else {
                                    if (ambientMod?.updateFromGrid)
                                        ambientMod.updateFromGrid(wallartGrid);
                                    else updateAmbientFromGrid(wallartGrid);
                                }
                            }
                        } catch (_) {
                            /* no-op: ambient update best-effort */
                        }

                        return { currentPosters, usedPosters };
                    } catch (e) {
                        return null;
                    }
                },
                createGridElement(cfg = {}) {
                    try {
                        // Remove existing grid if present (for rebuilds)
                        const existingGrid = document.getElementById('wallart-grid');
                        if (existingGrid) {
                            existingGrid.remove();
                        }

                        const layoutInfo = api.calculateLayout(cfg.density);
                        const grid = document.createElement('div');
                        grid.id = 'wallart-grid';
                        grid.className = 'wallart-grid';
                        // Base grid styles mirrored from legacy startWallartCycle
                        grid.style.cssText = `
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
                        grid.style.transform = `translate(${layoutInfo.gridLeft}px, ${layoutInfo.gridTop}px)`;
                        // datasets consumed by refresh/update logic
                        grid.dataset.minPosterWidth = layoutInfo.minPosterWidth;
                        grid.dataset.posterCount = layoutInfo.posterCount;
                        grid.dataset.totalNeeded = layoutInfo.totalNeeded;
                        grid.dataset.columns = layoutInfo.columns;
                        grid.dataset.rows = layoutInfo.rows;
                        document.body.appendChild(grid);
                        return { gridEl: grid, layoutInfo };
                    } catch (_) {
                        return { gridEl: null, layoutInfo: null };
                    }
                },
                createPosterElement(item, index) {
                    try {
                        const posterItem = document.createElement('div');
                        posterItem.className = 'wallart-poster-item';
                        posterItem.dataset.originalIndex = index;
                        posterItem.dataset.posterId = item.id || item.title || index;

                        const isMobile =
                            window.innerWidth <= 768 ||
                            /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);

                        // Check if this is a music item
                        const isMusicItem = item.type === 'music';

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
                        // Eagerly set src to avoid intersection/lazy race on initial grid
                        img.src =
                            item.posterUrl ||
                            'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                        // Optionally wire lazy helper for future updates
                        try {
                            if (item.posterUrl && window.makeLazy) {
                                window.makeLazy(img, item.posterUrl);
                            }
                        } catch (_) {
                            /* noop */
                        }
                        img.alt = item.title || 'Movie Poster';

                        // For music albums, use cover/contain to show square album art properly
                        // For movies/shows, keep contain to show full portrait poster
                        const objectFit = isMusicItem ? 'cover' : 'contain';

                        img.style.cssText = `
                            width: 100%;
                            height: 100%;
                            object-fit: ${objectFit};
                            object-position: center;
                            display: block;
                            transform: none;
                            background: #000;
                            ${isMobile ? 'will-change: opacity;' : ''}
                        `;
                        posterItem.appendChild(img);

                        // Add music metadata overlay if configured
                        if (isMusicItem) {
                            try {
                                const musicConfig = window.appConfig?.wallartMode?.musicMode || {};
                                const displayStyle = musicConfig.displayStyle || 'covers-only';
                                const showArtist = musicConfig.showArtist !== false;
                                const showAlbumTitle = musicConfig.showAlbumTitle !== false;
                                const showYear = musicConfig.showYear !== false;
                                const showGenre = musicConfig.showGenre === true;

                                // Display style: covers-only (minimal overlay)
                                if (displayStyle === 'covers-only') {
                                    if (showArtist && item.artist) {
                                        const overlay = document.createElement('div');
                                        overlay.className = 'music-metadata-overlay covers-only';
                                        overlay.style.cssText = `
                                            position: absolute;
                                            bottom: 0;
                                            left: 0;
                                            right: 0;
                                            background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%);
                                            color: #fff;
                                            padding: 8px 12px;
                                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                                            pointer-events: none;
                                            font-size: 0.85em;
                                            font-weight: 500;
                                            text-shadow: 0 1px 3px rgba(0,0,0,0.8);
                                            white-space: nowrap;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                        `;
                                        overlay.textContent = item.artist;
                                        posterItem.appendChild(overlay);
                                    }
                                }

                                // Display style: album-info (detailed metadata)
                                else if (displayStyle === 'album-info') {
                                    const overlay = document.createElement('div');
                                    overlay.className = 'music-metadata-overlay album-info';
                                    overlay.style.cssText = `
                                        position: absolute;
                                        bottom: 0;
                                        left: 0;
                                        right: 0;
                                        background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.7) 70%, transparent 100%);
                                        color: #fff;
                                        padding: 12px;
                                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                                        pointer-events: none;
                                    `;

                                    let html = '';
                                    if (showArtist && item.artist) {
                                        html += `<div style="font-size: 0.9em; font-weight: 600; margin-bottom: 4px; text-shadow: 0 1px 3px rgba(0,0,0,0.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.artist}</div>`;
                                    }
                                    if (showAlbumTitle && item.title) {
                                        html += `<div style="font-size: 0.8em; opacity: 0.9; margin-bottom: 4px; text-shadow: 0 1px 3px rgba(0,0,0,0.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.title}</div>`;
                                    }

                                    const metaItems = [];
                                    if (showYear && item.year) metaItems.push(item.year);
                                    if (showGenre && item.genres && item.genres[0])
                                        metaItems.push(item.genres[0]);

                                    if (metaItems.length > 0) {
                                        html += `<div style="font-size: 0.7em; opacity: 0.75; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">${metaItems.join(' • ')}</div>`;
                                    }

                                    overlay.innerHTML = html;
                                    posterItem.appendChild(overlay);
                                }

                                // Display style: artist-cards (artist-focused with large text)
                                else if (displayStyle === 'artist-cards') {
                                    const overlay = document.createElement('div');
                                    overlay.className = 'music-metadata-overlay artist-cards';
                                    overlay.style.cssText = `
                                        position: absolute;
                                        inset: 0;
                                        background: linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.5) 40%, transparent 60%);
                                        color: #fff;
                                        padding: 16px;
                                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                                        pointer-events: none;
                                        display: flex;
                                        flex-direction: column;
                                        justify-content: flex-end;
                                    `;

                                    let html = `<div style="font-size: 1.1em; font-weight: 700; margin-bottom: 6px; text-shadow: 0 2px 4px rgba(0,0,0,0.9); line-height: 1.2;">${item.artist}</div>`;

                                    if (showAlbumTitle && item.title) {
                                        html += `<div style="font-size: 0.75em; opacity: 0.85; text-shadow: 0 1px 3px rgba(0,0,0,0.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.title}</div>`;
                                    }

                                    if (showYear && item.year) {
                                        html += `<div style="font-size: 0.7em; opacity: 0.7; margin-top: 4px; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">${item.year}</div>`;
                                    }

                                    overlay.innerHTML = html;
                                    posterItem.appendChild(overlay);
                                }
                            } catch (overlayErr) {
                                // Gracefully ignore overlay creation errors
                                console.warn(
                                    '[Wallart] Failed to create music metadata overlay:',
                                    overlayErr
                                );
                            }
                        }

                        // Hide the global loader when first tile is created
                        try {
                            const loader = document.getElementById('loader');
                            if (loader) {
                                loader.style.opacity = '0';
                                loader.style.display = 'none';
                            }
                        } catch (_) {
                            /* noop */
                        }
                        return posterItem;
                    } catch (_) {
                        // createPosterElement failed; return null to fallback gracefully
                        return null;
                    }
                },
                getUniqueRandomPoster(currentPosters, usedPosters, mediaQueue, excludePosterId) {
                    try {
                        if (!Array.isArray(mediaQueue) || mediaQueue.length === 0) return null;

                        const visibleIds = new Set();
                        try {
                            (currentPosters || []).forEach(p => {
                                if (!p) return;
                                const id = p.id || p.title || p.posterUrl;
                                if (id) visibleIds.add(id);
                            });
                        } catch (_) {
                            // best-effort: ignore errors building visible id set
                        }

                        let pool = mediaQueue.filter(item => {
                            const id = item.id || item.title || item.posterUrl;
                            if (!id) return false;
                            if (excludePosterId && id === excludePosterId) return false;
                            if (visibleIds.has(id)) return false;
                            if (
                                usedPosters &&
                                typeof usedPosters.has === 'function' &&
                                usedPosters.has(id)
                            )
                                return false;
                            return true;
                        });

                        if (pool.length === 0) {
                            pool = mediaQueue.filter(item => {
                                const id = item.id || item.title || item.posterUrl;
                                if (!id) return false;
                                if (excludePosterId && id === excludePosterId) return false;
                                if (visibleIds.has(id)) return false;
                                return true;
                            });
                        }

                        if (pool.length === 0) {
                            pool = mediaQueue.filter(item => {
                                const id = item.id || item.title || item.posterUrl;
                                if (!id) return false;
                                if (excludePosterId && id === excludePosterId) return false;
                                return true;
                            });
                        }

                        if (pool.length === 0) pool = mediaQueue.slice();

                        const idx = Math.floor(Math.random() * pool.length);
                        const selected = pool[idx];
                        const selId = selected?.id || selected?.title || selected?.posterUrl;
                        if (selId && usedPosters && typeof usedPosters.add === 'function') {
                            usedPosters.add(selId);
                        }
                        return selected || null;
                    } catch (_) {
                        return null;
                    }
                },
            },
        };

        window.PosterramaWallart = api;

        // Listen for settingsUpdated event from core.js (preview mode, WebSocket, BroadcastChannel, etc.)
        try {
            if (document.body && document.body.dataset.mode === 'wallart') {
                window.addEventListener('settingsUpdated', event => {
                    try {
                        window.debugLog &&
                            window.debugLog('WALLART_SETTINGS_UPDATED_EVENT', {
                                detail: event.detail,
                            });

                        const settings = event.detail?.settings;
                        if (!settings) return;

                        // Check if wallart mode is enabled in the new settings
                        const wallartEnabled = settings.wallartMode?.enabled;
                        if (wallartEnabled === false) return;

                        // Get old config for comparison - if empty, wallart hasn't started yet, so skip
                        // We need this check BEFORE orientation handling to avoid rebuild on initial load
                        const oldConfig = _state.wallartConfig || {};
                        const isFirstLoad = Object.keys(oldConfig).length === 0;

                        if (isFirstLoad) {
                            // On first load, just set the orientation classes without triggering rebuild
                            if (settings.previewOrientation) {
                                const isPortrait = settings.previewOrientation === 'portrait';
                                document.body.classList.toggle('preview-portrait', isPortrait);
                                document.body.classList.toggle('preview-landscape', !isPortrait);
                            }
                            return;
                        }

                        // Apply preview orientation if provided (for preview mode only)
                        // Only check for changes AFTER initial load to avoid unnecessary rebuild
                        if (settings.previewOrientation) {
                            const isPortrait = settings.previewOrientation === 'portrait';
                            const wasPortrait =
                                document.body.classList.contains('preview-portrait');

                            document.body.classList.toggle('preview-portrait', isPortrait);
                            document.body.classList.toggle('preview-landscape', !isPortrait);

                            // If orientation changed, rebuild layout WITHOUT reload to avoid infinite loop
                            if (wasPortrait !== isPortrait) {
                                window.debugLog &&
                                    window.debugLog('WALLART_ORIENTATION_CHANGE_REBUILD', {
                                        wasPortrait,
                                        isPortrait,
                                    });

                                // Stop current cycle to avoid conflicts
                                api.stop();

                                // Rebuild grid with new orientation
                                // Give browser a moment to apply orientation classes
                                setTimeout(() => {
                                    try {
                                        // Merge latest settings into wallartConfig
                                        const updatedConfig = {
                                            ..._state.wallartConfig,
                                            ...settings.wallartMode,
                                        };
                                        api.start(updatedConfig);
                                    } catch (e) {
                                        console.error('[Wallart] Orientation rebuild failed:', e);
                                    }
                                }, 100);

                                // Early return to avoid duplicate rebuild logic below
                                return;
                            }
                        }

                        const newWallartConfig = settings.wallartMode || {};

                        // IMPORTANT: settings contains only the DELTA (changed properties)
                        // We need to merge with window.appConfig to get the FULL config for comparison
                        // Deep merge for nested musicMode object
                        const mergedWallartConfig = {
                            ...window.appConfig?.wallartMode,
                            ...newWallartConfig,
                            musicMode: {
                                ...(window.appConfig?.wallartMode?.musicMode || {}),
                                ...(newWallartConfig.musicMode || {}),
                            },
                        };

                        // Separate layout changes (require restart) from config-only changes
                        const layoutKeys = ['density', 'layoutVariant', 'gamesOnly'];
                        const configKeys = [
                            'ambientGradient',
                            'refreshRate',
                            'randomness',
                            'animationType',
                        ];

                        // Music mode changes that require layout rebuild
                        const musicModeKeys = ['enabled', 'density'];

                        let needsLayoutRebuild = false;
                        let needsConfigUpdate = false;

                        for (const key of layoutKeys) {
                            if (
                                key in mergedWallartConfig &&
                                mergedWallartConfig[key] !== oldConfig[key]
                            ) {
                                needsLayoutRebuild = true;
                                break;
                            }
                        }

                        // Check music mode changes
                        if (!needsLayoutRebuild && mergedWallartConfig.musicMode) {
                            const oldMusic = oldConfig.musicMode || {};
                            const newMusic = mergedWallartConfig.musicMode;
                            for (const key of musicModeKeys) {
                                if (key in newMusic && newMusic[key] !== oldMusic[key]) {
                                    needsLayoutRebuild = true;
                                    break;
                                }
                            }

                            // Display style and animation changes should update existing posters, not rebuild
                            const displayKeys = [
                                'displayStyle',
                                'animation',
                                'showArtist',
                                'showAlbumTitle',
                                'showYear',
                                'showGenre',
                            ];
                            if (!needsLayoutRebuild) {
                                for (const key of displayKeys) {
                                    if (key in newMusic && newMusic[key] !== oldMusic[key]) {
                                        needsConfigUpdate = true;
                                        break;
                                    }
                                }
                            }
                        }

                        if (!needsLayoutRebuild) {
                            for (const key of configKeys) {
                                if (
                                    key in mergedWallartConfig &&
                                    mergedWallartConfig[key] !== oldConfig[key]
                                ) {
                                    needsConfigUpdate = true;
                                    break;
                                }
                            }
                        }

                        // Check heroGrid settings (nested in layoutSettings.heroGrid)
                        if (
                            'layoutSettings' in mergedWallartConfig &&
                            mergedWallartConfig.layoutSettings &&
                            'heroGrid' in mergedWallartConfig.layoutSettings
                        ) {
                            const oldHero =
                                (oldConfig.layoutSettings && oldConfig.layoutSettings.heroGrid) ||
                                {};
                            const newHero = mergedWallartConfig.layoutSettings.heroGrid || {};
                            const heroKeys = [
                                'heroSide',
                                'heroRotationMinutes',
                                'biasAmbientToHero',
                            ];

                            for (const key of heroKeys) {
                                if (key in newHero && newHero[key] !== oldHero[key]) {
                                    needsLayoutRebuild = true;
                                    break;
                                }
                            }
                        }

                        if (needsLayoutRebuild) {
                            // Stop current cycle to avoid conflicts
                            api.stop();

                            // Clear state to force fresh rebuild
                            _state.wallartGrid = null;
                            _state.layoutInfo = null;
                            _state.currentPosters = [];
                            _state.usedPosters = new Set();

                            // Update stored config BEFORE rebuild so api.start uses correct values
                            _state.wallartConfig = mergedWallartConfig;
                            window.wallartConfig = mergedWallartConfig;

                            // Rebuild grid with new layout settings
                            // Small delay to ensure DOM cleanup is complete
                            setTimeout(() => {
                                try {
                                    api.start(mergedWallartConfig);
                                } catch (e) {
                                    console.error('[Wallart] Layout rebuild failed:', e);
                                }
                            }, 150);
                        } else if (needsConfigUpdate) {
                            // Check if animation type changed - if so, demo it immediately
                            const animationChanged =
                                mergedWallartConfig.animationType &&
                                mergedWallartConfig.animationType !== oldConfig.animationType;

                            // Check if music mode display changed
                            const musicDisplayChanged =
                                mergedWallartConfig.musicMode &&
                                oldConfig.musicMode &&
                                (mergedWallartConfig.musicMode.displayStyle !==
                                    oldConfig.musicMode.displayStyle ||
                                    mergedWallartConfig.musicMode.showArtist !==
                                        oldConfig.musicMode.showArtist ||
                                    mergedWallartConfig.musicMode.showAlbumTitle !==
                                        oldConfig.musicMode.showAlbumTitle ||
                                    mergedWallartConfig.musicMode.showYear !==
                                        oldConfig.musicMode.showYear ||
                                    mergedWallartConfig.musicMode.showGenre !==
                                        oldConfig.musicMode.showGenre);

                            // Update the stored config so future operations use new values
                            _state.wallartConfig = {
                                ..._state.wallartConfig,
                                ...mergedWallartConfig,
                            };
                            window.wallartConfig = { ..._state.wallartConfig };

                            // If music display settings changed, force rebuild to apply new overlay style
                            if (musicDisplayChanged) {
                                // Stop and rebuild with new music config
                                api.stop();
                                _state.wallartGrid = null;
                                _state.layoutInfo = null;
                                _state.currentPosters = [];
                                _state.usedPosters = new Set();
                                setTimeout(() => {
                                    try {
                                        api.start(mergedWallartConfig);
                                    } catch (e) {
                                        console.error('[Wallart] Music display rebuild failed:', e);
                                    }
                                }, 150);
                                return; // Skip animation demo below
                            }

                            // If animation changed, demonstrate it immediately in preview
                            if (animationChanged && window.animatePosterChange) {
                                // Find a random poster to animate - use correct selector
                                const posters = document.querySelectorAll(
                                    '.wallart-poster-item img'
                                );

                                if (posters.length > 0) {
                                    const randomImg =
                                        posters[Math.floor(Math.random() * posters.length)];
                                    const currentSrc = randomImg.src;
                                    const currentAlt = randomImg.alt || 'Animation Preview';

                                    // Get the parent poster element (not the img)
                                    const posterElement = randomImg.parentElement;

                                    // Trigger the animation by "replacing" the poster with itself
                                    // This will show the animation effect without changing content
                                    // animatePosterChange expects (element, newItem, animationType)
                                    window.animatePosterChange(
                                        posterElement,
                                        {
                                            posterUrl: currentSrc,
                                            title: currentAlt,
                                        },
                                        mergedWallartConfig.animationType
                                    );
                                }
                            }

                            // Config updates (tempo, animation) will be picked up by existing cycle
                        } else {
                            // No visual changes detected, keeping current grid
                        }
                    } catch (e) {
                        console.error('[Wallart] Failed to handle settingsUpdated:', e);
                    }
                });
            }
        } catch (_) {
            /* noop */
        }

        // Expose animatePosterChange for poster replacement animations
        // Restored from v2.7.8 where all animations worked perfectly
        try {
            window.animatePosterChange = function (element, newItem, animationType = 'fade') {
                try {
                    if (!element || !newItem || !newItem.posterUrl) return;

                    const img = element.querySelector('img');
                    if (!img) return;

                    // Mobile detection for optimized animations
                    const isMobile =
                        window.innerWidth <= 768 ||
                        /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);

                    // Check if this is a music item - use music animation if configured
                    const isMusicItem = newItem.type === 'music';
                    const musicConfig = window.appConfig?.wallartMode?.musicMode || {};
                    const musicAnimation = musicConfig.animation || 'vinyl-spin';

                    // Use music-specific animation for music items
                    if (isMusicItem && musicAnimation && musicAnimation !== 'default') {
                        animationType = musicAnimation;
                    }

                    // Determine animation type
                    const anim = String(animationType).toLowerCase();
                    const duration = 600; // ms - default animation duration

                    // Map burst patterns to fade for individual tiles
                    if (anim === 'staggered' || anim === 'ripple' || anim === 'scanline') {
                        animationType = 'fade';
                    }

                    // Apply animation based on type
                    if (
                        anim === 'fade' ||
                        anim === 'staggered' ||
                        anim === 'ripple' ||
                        anim === 'scanline'
                    ) {
                        const fadeTime = isMobile ? '0.4s' : '0.5s';
                        const waitTime = isMobile ? 400 : 500;

                        // Step 1: Fade out current image
                        img.style.transition = `opacity ${fadeTime} ease-in-out`;
                        img.style.opacity = '0';

                        // Step 2: After fade out, change image and fade in
                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';

                            // Step 3: Fade in new image
                            setTimeout(() => {
                                img.style.opacity = '1';
                            }, 50);
                        }, waitTime);
                    } else if (anim === 'slideleft') {
                        // Mobile optimized timings and transforms
                        const slideScale = isMobile ? 'scale(1)' : 'scale(1.05)';
                        const slideTime = isMobile ? '0.4s' : '0.6s';
                        const waitTime = isMobile ? 400 : 600;
                        const slideDistance = isMobile ? '50px' : '100px';

                        // Reset any existing transition first
                        img.style.transition = 'none';
                        img.style.transform = `${slideScale} translateX(0px)`;
                        img.offsetHeight; // Force reflow

                        // Step 1: Slide out to the left with fade
                        img.style.transition = `all ${slideTime} ease-in-out`;
                        img.style.opacity = '0';
                        img.style.transform = `${slideScale} translateX(-${slideDistance})`;

                        // Step 2: Change image and slide in from right
                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';
                            img.style.transition = 'none';
                            img.style.transform = `${slideScale} translateX(${slideDistance})`;
                            img.style.opacity = '0';
                            img.offsetHeight; // Force reflow

                            // Step 3: Slide in from right
                            img.style.transition = `all ${slideTime} ease-out`;
                            setTimeout(() => {
                                img.style.opacity = '1';
                                img.style.transform = `${slideScale} translateX(0px)`;
                            }, 50);
                        }, waitTime);
                    } else if (anim === 'slideup') {
                        // Mobile optimized timings and transforms
                        const slideScale = isMobile ? 'scale(1)' : 'scale(1.05)';
                        const slideTime = isMobile ? '0.4s' : '0.6s';
                        const waitTime = isMobile ? 400 : 600;
                        const slideDistance = isMobile ? '50px' : '100px';

                        // Reset any existing transition first
                        img.style.transition = 'none';
                        img.style.transform = `${slideScale} translateY(0px)`;
                        img.offsetHeight; // Force reflow

                        // Step 1: Slide up and fade out
                        img.style.transition = `all ${slideTime} ease-in-out`;
                        img.style.opacity = '0';
                        img.style.transform = `${slideScale} translateY(-${slideDistance})`;

                        // Step 2: Change image and slide in from bottom
                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';
                            img.style.transition = 'none';
                            img.style.transform = `${slideScale} translateY(${slideDistance})`;
                            img.style.opacity = '0';
                            img.offsetHeight; // Force reflow

                            // Step 3: Slide in from bottom
                            img.style.transition = `all ${slideTime} ease-out`;
                            setTimeout(() => {
                                img.style.opacity = '1';
                                img.style.transform = `${slideScale} translateY(0px)`;
                            }, 50);
                        }, waitTime);
                    } else if (anim === 'zoom') {
                        // Zoom out old, zoom in new
                        img.style.transition = `transform ${duration}ms ease, opacity ${duration}ms ease`;
                        img.style.transform = 'scale(1.3)';
                        img.style.opacity = '0';

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';
                            img.style.transform = 'scale(0.7)';
                            img.style.transition = 'none';
                            requestAnimationFrame(() => {
                                img.style.transition = `transform ${duration}ms ease, opacity ${duration}ms ease`;
                                img.style.transform = 'scale(1)';
                                img.style.opacity = '1';
                            });
                        }, duration);
                    } else if (anim === 'flip') {
                        // 3D flip effect - need perspective on parent
                        element.style.perspective = '1000px';
                        img.style.transition = `transform ${duration / 2}ms ease`;
                        img.style.transform = 'rotateY(90deg)';

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';
                            img.style.transform = 'rotateY(-90deg)';
                            img.style.transition = 'none';
                            requestAnimationFrame(() => {
                                img.style.transition = `transform ${duration / 2}ms ease`;
                                img.style.transform = 'rotateY(0deg)';
                            });
                        }, duration / 2);
                    } else if (anim === 'parallax') {
                        // Subtle depth/parallax effect with scale and opacity
                        img.style.transition = `transform ${duration}ms ease, opacity ${duration}ms ease`;
                        img.style.transform = 'scale(0.95) translateZ(-50px)';
                        img.style.opacity = '0';

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';
                            img.style.transform = 'scale(1.05) translateZ(50px)';
                            img.style.transition = 'none';
                            requestAnimationFrame(() => {
                                img.style.transition = `transform ${duration}ms ease, opacity ${duration}ms ease`;
                                img.style.transform = 'scale(1) translateZ(0)';
                                img.style.opacity = '1';
                            });
                        }, duration);
                    } else if (anim === 'neonpulse') {
                        // Neon pulse effect with glow
                        img.style.transition = `opacity ${duration}ms ease, filter ${duration}ms ease`;
                        img.style.filter = 'brightness(0.3) blur(10px)';
                        img.style.opacity = '0';

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';
                            img.style.filter = 'brightness(1.5) blur(0px)';
                            img.style.transition = 'none';
                            requestAnimationFrame(() => {
                                img.style.transition = `opacity ${duration}ms ease, filter ${duration}ms ease`;
                                img.style.opacity = '1';
                                img.style.filter = 'brightness(1) blur(0px)';
                            });
                        }, duration);
                    } else if (anim === 'chromaticshift') {
                        // RGB split/chromatic aberration effect
                        const keyframes = `
                            @keyframes chromaticOut {
                                0% { transform: translate(0, 0); filter: none; }
                                100% { 
                                    transform: translate(-3px, 0); 
                                    filter: saturate(2) hue-rotate(10deg);
                                    opacity: 0;
                                }
                            }
                            @keyframes chromaticIn {
                                0% { 
                                    transform: translate(3px, 0); 
                                    filter: saturate(2) hue-rotate(-10deg);
                                    opacity: 0;
                                }
                                100% { transform: translate(0, 0); filter: none; opacity: 1; }
                            }
                        `;

                        // Inject keyframes if not already present
                        if (!document.getElementById('chromatic-keyframes')) {
                            const style = document.createElement('style');
                            style.id = 'chromatic-keyframes';
                            style.textContent = keyframes;
                            document.head.appendChild(style);
                        }

                        img.style.animation = `chromaticOut ${duration}ms ease forwards`;

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';
                            img.style.animation = `chromaticIn ${duration}ms ease forwards`;
                        }, duration);
                    } else if (anim === 'mosaicshatter') {
                        // Mosaic/pixelate effect
                        img.style.transition = `filter ${duration}ms ease, opacity ${duration}ms ease`;
                        img.style.filter = 'blur(20px) saturate(0)';
                        img.style.opacity = '0';

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';
                            img.style.filter = 'blur(20px) saturate(0)';
                            img.style.transition = 'none';
                            requestAnimationFrame(() => {
                                img.style.transition = `filter ${duration}ms ease, opacity ${duration}ms ease`;
                                img.style.filter = 'blur(0px) saturate(1)';
                                img.style.opacity = '1';
                            });
                        }, duration);
                    } else if (anim === 'vinyl-spin') {
                        // Music-specific: Vinyl record spinning effect
                        const spinDuration = isMobile ? 800 : 1000;
                        element.style.perspective = '1000px';

                        img.style.transition = `transform ${spinDuration / 2}ms ease-in, opacity ${spinDuration / 2}ms ease`;
                        img.style.transform = 'rotateZ(180deg) scale(0.8)';
                        img.style.opacity = '0';

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Album Cover';
                            img.style.transition = 'none';
                            img.style.transform = 'rotateZ(-180deg) scale(0.8)';
                            img.style.opacity = '0';
                            img.offsetHeight;

                            img.style.transition = `transform ${spinDuration / 2}ms ease-out, opacity ${spinDuration / 2}ms ease`;
                            setTimeout(() => {
                                img.style.transform = 'rotateZ(0deg) scale(1)';
                                img.style.opacity = '1';
                            }, 50);
                        }, spinDuration / 2);
                    } else if (anim === 'slide-fade') {
                        // Music-specific: Smooth slide with fade
                        const slideDuration = isMobile ? 600 : 800;
                        const slideDistance = isMobile ? '40px' : '60px';

                        img.style.transition = `all ${slideDuration / 2}ms ease-in`;
                        img.style.transform = `translateY(${slideDistance})`;
                        img.style.opacity = '0';

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Album Cover';
                            img.style.transition = 'none';
                            img.style.transform = `translateY(-${slideDistance})`;
                            img.style.opacity = '0';
                            img.offsetHeight;

                            img.style.transition = `all ${slideDuration / 2}ms ease-out`;
                            setTimeout(() => {
                                img.style.transform = 'translateY(0)';
                                img.style.opacity = '1';
                            }, 50);
                        }, slideDuration / 2);
                    } else if (anim === 'crossfade') {
                        // Music-specific: Pure crossfade
                        const fadeDuration = isMobile ? 700 : 900;

                        const newImg = document.createElement('img');
                        newImg.src = newItem.posterUrl;
                        newImg.alt = newItem.title || 'Album Cover';
                        newImg.style.cssText = `
                            position: absolute;
                            inset: 0;
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                            opacity: 0;
                            transition: opacity ${fadeDuration}ms ease;
                        `;

                        element.appendChild(newImg);
                        setTimeout(() => (newImg.style.opacity = '1'), 50);

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Album Cover';
                            newImg.remove();
                        }, fadeDuration + 100);
                    } else {
                        // Default: fade
                        img.style.transition = `opacity ${duration}ms ease`;
                        img.style.opacity = '0';

                        setTimeout(() => {
                            img.src = newItem.posterUrl;
                            img.alt = newItem.title || 'Movie Poster';
                            requestAnimationFrame(() => {
                                img.style.opacity = '1';
                            });
                        }, duration);
                    }

                    // Update dataset
                    element.dataset.posterId = newItem.id || newItem.title || newItem.posterUrl;
                } catch (e) {
                    console.warn('[animatePosterChange] Error:', e);
                }
            };
        } catch (_) {
            /* noop: animation helper is optional */
        }

        try {
            const debugOn =
                (window.logger &&
                    typeof window.logger.isDebug === 'function' &&
                    window.logger.isDebug()) ||
                window.POSTERRAMA_DEBUG;
            if (document.body && document.body.dataset.mode === 'wallart' && debugOn) {
                (window.logger && window.logger.debug ? window.logger.debug : console.log)(
                    '[Wallart] module loaded'
                );
            }
        } catch (_) {
            /* ignore debug log */
        }
    } catch (e) {
        if (window && window.console) console.debug('[Wallart] module init error');
    }
})();
/* eslint-enable prettier/prettier */
