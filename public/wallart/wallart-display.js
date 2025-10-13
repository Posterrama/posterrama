// Wallart module: begin extracting wallart-specific helpers from script.js
(function initWallartModule() {
    try {
        const logDebug = msg => {
            try {
                window.logger && typeof window.logger.debug === 'function'
                    ? window.logger.debug(msg)
                    : console.debug(msg);
            } catch (_) {}
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
                } catch (_) {}
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
                } catch (_) {}
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
