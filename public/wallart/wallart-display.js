// Wallart module: begin extracting wallart-specific helpers from script.js
(function initWallartModule() {
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

        const api = {
            // Pure helper: compute grid sizing and placement
            calculateLayout(density = 'medium') {
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
                        const promoBoxHeight = promoBox.offsetHeight || 120; // fallback height
                        availableHeight = screenHeight - promoBoxHeight * 0.8; // Give some margin
                    }
                }

                // Optimize for both desktop and mobile with different density factors
                let densityFactors;
                if (isMobile || isPortrait) {
                    densityFactors = { low: 0.25, medium: 0.2, high: 0.167, ludicrous: 0.1 };
                } else {
                    densityFactors = { low: 0.15, medium: 0.12, high: 0.09, ludicrous: 0.06 };
                }
                let densityFactor = densityFactors[density] || densityFactors['medium'];

                const isHeroGrid = window.wallartConfig?.layoutVariant === 'heroGrid';
                if (window.IS_PREVIEW && !isHeroGrid) {
                    densityFactor = densityFactor * 0.5; // Double the effective density for preview (classic layouts only)
                }

                // Calculate optimal poster width based on screen width and density
                const optimalPosterWidth = Math.round(screenWidth * densityFactor);
                const optimalPosterHeight = Math.round(optimalPosterWidth / posterAspectRatio);

                // Calculate how many posters fit
                const cols = Math.floor(screenWidth / optimalPosterWidth);
                const rows = Math.floor(availableHeight / optimalPosterHeight);

                // Now optimize: stretch posters slightly to minimize black space while maintaining aspect ratio
                const actualPosterWidth = Math.floor(screenWidth / cols);
                const actualPosterHeight = Math.round(actualPosterWidth / posterAspectRatio);

                // Check if we can fit the calculated height
                let finalRows = rows;
                let finalPosterHeight = actualPosterHeight;
                let finalPosterWidth = actualPosterWidth;

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
                            finalPosterHeight = Math.round(finalPosterWidth / posterAspectRatio);
                        }
                    }
                } else if (remainingHeight < 0) {
                    finalPosterHeight = Math.floor(availableHeight / rows);
                    finalPosterWidth = Math.round(finalPosterHeight * posterAspectRatio);
                }

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
            // Start wallart cycle: while extraction is in progress, delegate to legacy if present
            start(cfg) {
                try {
                    if (typeof window.startWallartCycle === 'function') {
                        return window.startWallartCycle(cfg);
                    }
                } catch (_) {
                    /* noop: layout preview adjustment best-effort */
                }
                // If legacy function isn't available yet, no-op safely
                return undefined;
            },
            // Stop/cleanup wallart cycle: optional convenience for future calls
            stop() {
                try {
                    const grid = document.getElementById('wallart-grid');
                    if (grid) grid.remove();
                    const ambient = document.getElementById('wallart-ambient-overlay');
                    if (ambient) ambient.remove();
                } catch (_) {
                    /* noop: ambient update is best-effort */
                }
            },
            ambient: {
                ensure: ensureAmbientOverlay,
                updateFromGrid: updateAmbientFromGrid,
                updateFromImage: updateAmbientFromImage,
            },
            // Create and attach the grid element using module's layout calculation
            runtime: {
                createGridElement(cfg = {}) {
                    try {
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
                        if (item.posterUrl && window.makeLazy) {
                            window.makeLazy(img, item.posterUrl);
                        } else {
                            img.src =
                                item.posterUrl ||
                                'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                        }
                        img.alt = item.title || 'Movie Poster';
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
                    } catch (_) {
                        return null;
                    }
                },
            },
        };

        window.PosterramaWallart = api;
        if (document.body && document.body.dataset.mode === 'wallart' && window.POSTERRAMA_DEBUG) {
            console.log('[Wallart] module loaded');
        }
    } catch (e) {
        if (window && window.console) console.debug('[Wallart] module init error');
    }
})();
