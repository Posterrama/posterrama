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

document.addEventListener('DOMContentLoaded', async () => {
    // --- Element References ---
    const layerA = document.getElementById('layer-a');
    const layerB = document.getElementById('layer-b');
    const infoContainer = document.getElementById('info-container');
    const posterWrapper = document.getElementById('poster-wrapper');
    const textWrapper = document.getElementById('text-wrapper');
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

    // --- Create and inject Rotten Tomatoes badge ---
    const rtBadge = document.createElement('div');
    rtBadge.id = 'rt-badge';

    const rtIcon = document.createElement('img');
    rtIcon.id = 'rt-icon';
    rtIcon.alt = 'Rotten Tomatoes';

    rtBadge.appendChild(rtIcon);
    posterEl.appendChild(rtBadge);

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

    function showError(message) {
        // Add fallback background to body
        document.body.classList.add('no-media-background');

        const errorMessageEl = document.getElementById('error-message');
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

        // Check poster visibility
        if (appConfig.showPoster === false) {
            infoContainer.classList.add('is-hidden');
        } else {
            infoContainer.classList.remove('is-hidden');
        }

        // Check metadata visibility (independent of poster)
        if (appConfig.showMetadata === false) {
            textWrapper.classList.add('is-hidden');
        } else {
            textWrapper.classList.remove('is-hidden');
        }

        if (appConfig.clockWidget) {
            document.getElementById('widget-container').style.display = 'block';
            updateClock();
            setInterval(updateClock, 1000);
        } else {
            document.getElementById('widget-container').style.display = 'none';
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

        // Apply initial UI scaling
        applyUIScaling(appConfig);

        // Apply cinema mode
        applyCinemaMode(appConfig);

        // Apply wallart mode
        applyWallartMode(appConfig);
    }

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

        if (config.cinemaMode) {
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
        }
    }

    function applyWallartMode(config) {
        const body = document.body;

        // Remove any existing wallart mode classes
        body.classList.remove('wallart-mode');

        // Clean up wallart resize listener when leaving wallart mode
        if (window.wallartResizeListener) {
            window.removeEventListener('resize', window.wallartResizeListener);
            window.wallartResizeListener = null;
        }

        if (config.wallartMode?.enabled) {
            // Add wallart mode class to body
            body.classList.add('wallart-mode');

            const elementsToHide = [
                'layer-a',
                'layer-b',
                'widget-container',
                'clearlogo-container',
                'info-container',
                'controls-container',
                'branding-container',
                'poster-wrapper',
                'background-image',
                'loader',
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

            // Start the new wallart cycle system
            startWallartCycle(config.wallartMode);

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

            // Clear wallart title timer
            if (wallartTitleTimer) {
                clearInterval(wallartTitleTimer);
                wallartTitleTimer = null;
            }

            const wallartGrid = document.getElementById('wallart-grid');
            if (wallartGrid) {
                wallartGrid.remove();
            }

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

            // Restore document title to current media when exiting wallart mode
            if (currentIndex >= 0 && currentIndex < mediaQueue.length) {
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
        }
    }

    function calculateWallartLayout(density = 'medium') {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // Standard movie poster aspect ratio - NEVER change this!
        const posterAspectRatio = 2 / 3; // width/height

        // Optimize for 16:9 screens with maximum space utilization
        // Define poster density as percentage of screen width
        const densityFactors = {
            low: 0.15, // Posters take ~15% of screen width each
            medium: 0.12, // Posters take ~12% of screen width each
            high: 0.09, // Posters take ~9% of screen width each
        };

        const densityFactor = densityFactors[density] || 0.12;

        // Calculate optimal poster width based on screen width and density
        const optimalPosterWidth = Math.round(screenWidth * densityFactor);
        const optimalPosterHeight = Math.round(optimalPosterWidth / posterAspectRatio);

        // Calculate how many posters fit
        const cols = Math.floor(screenWidth / optimalPosterWidth);
        const rows = Math.floor(screenHeight / optimalPosterHeight);

        // Now optimize: stretch posters slightly to minimize black space
        // while maintaining aspect ratio
        const actualPosterWidth = Math.floor(screenWidth / cols);
        const actualPosterHeight = Math.round(actualPosterWidth / posterAspectRatio);

        // Check if we can fit the calculated height
        let finalRows = rows;
        let finalPosterHeight = actualPosterHeight;
        let finalPosterWidth = actualPosterWidth;

        const calculatedGridHeight = rows * actualPosterHeight;
        const remainingHeight = screenHeight - calculatedGridHeight;

        // If remaining height is significant, try different approaches
        if (remainingHeight > actualPosterHeight * 0.4) {
            // Try adding one more row
            const newRows = rows + 1;
            const heightPerRow = Math.floor(screenHeight / newRows);
            const widthForHeight = Math.round(heightPerRow * posterAspectRatio);

            if (widthForHeight * cols <= screenWidth) {
                // Height-constrained layout works
                finalRows = newRows;
                finalPosterHeight = heightPerRow;
                finalPosterWidth = widthForHeight;
            } else {
                // Width-constrained layout with stretched height
                finalPosterHeight = Math.floor(screenHeight / rows);
                finalPosterWidth = Math.round(finalPosterHeight * posterAspectRatio);

                // Ensure we don't exceed screen width
                if (finalPosterWidth * cols > screenWidth) {
                    finalPosterWidth = Math.floor(screenWidth / cols);
                    finalPosterHeight = Math.round(finalPosterWidth / posterAspectRatio);
                }
            }
        } else if (remainingHeight < 0) {
            // Grid is too tall, reduce height
            finalPosterHeight = Math.floor(screenHeight / rows);
            finalPosterWidth = Math.round(finalPosterHeight * posterAspectRatio);
        }

        // Final grid dimensions
        const gridWidth = cols * finalPosterWidth;
        const gridHeight = finalRows * finalPosterHeight;

        // Center the grid with minimal black bars
        const gridLeft = Math.round((screenWidth - gridWidth) / 2);
        const gridTop = Math.round((screenHeight - gridHeight) / 2);

        const posterCount = cols * finalRows;
        const bufferedCount = Math.ceil(posterCount * 1.5);

        // Calculate coverage percentage
        const coverage = ((gridWidth * gridHeight) / (screenWidth * screenHeight)) * 100;

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

    function createLoadingGrid(message = 'Loading posters...') {
        const wallartGrid = document.createElement('div');
        wallartGrid.id = 'wallart-grid';
        wallartGrid.className = 'wallart-grid';

        const loadingItem = document.createElement('div');
        loadingItem.style.cssText = `
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 999999 !important;
            background: #000 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            color: white !important;
            font-size: 24px !important;
            font-family: Arial, sans-serif !important;
        `;
        loadingItem.textContent = message;
        wallartGrid.appendChild(loadingItem);
        document.body.appendChild(wallartGrid);
    }

    function startWallartCycle(wallartConfig) {
        // Remove existing wallart grid if it exists
        const existingGrid = document.getElementById('wallart-grid');
        if (existingGrid) {
            existingGrid.remove();
        }

        // Check if media is available
        if (mediaQueue.length === 0) {
            // Prevent multiple simultaneous initialization attempts
            if (wallartInitializing) {
                // console.log removed for cleaner browser console
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
                        // Continue with showing loading message and retry after delay
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
                    createLoadingGrid('Failed to load posters. Retrying...');
                    // Retry after error
                    setTimeout(() => {
                        // console.log removed for cleaner browser console
                        startWallartCycle(wallartConfig);
                    }, 5000);
                });
            return;
        }

        // Create wallart grid container
        const wallartGrid = document.createElement('div');
        wallartGrid.id = 'wallart-grid';
        wallartGrid.className = 'wallart-grid';

        // Calculate dynamic grid based on screen size and density
        const layoutInfo = calculateWallartLayout(wallartConfig.density);

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

        // Append directly to body
        document.body.appendChild(wallartGrid);

        // Get dynamically calculated poster count
        const posterCount = layoutInfo.posterCount;
        const animationType = wallartConfig.animationType || 'fade';

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

        let currentPosters = []; // Track current posters for uniqueness
        const usedPosters = new Set(); // Track used poster IDs

        function createPosterElement(item, index) {
            const posterItem = document.createElement('div');
            posterItem.className = 'wallart-poster-item';
            posterItem.dataset.originalIndex = index;
            posterItem.dataset.posterId = item.id || item.title || index;

            // Use grid cell dimensions but preserve poster proportions with object-fit
            posterItem.style.cssText = `
                background: #111 !important;
                overflow: hidden !important;
                opacity: 1 !important;
                display: block !important;
                width: 100% !important;
                height: 100% !important;
                position: relative !important;
            `;

            const img = document.createElement('img');
            img.src = item.posterUrl || transparentPixel;
            img.alt = item.title || 'Movie Poster';
            img.loading = 'lazy';

            // Fill the grid cell while maintaining poster aspect ratio
            img.style.cssText = `
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                object-position: center !important;
                display: block !important;
                transform: scale(1.05) !important;
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

            // console.log removed for cleaner browser console
        }

        function getUniqueRandomPoster(excludePosterId = null) {
            if (mediaQueue.length === 0) return null;

            // Get all poster IDs currently visible in the grid
            const currentlyVisibleIds = new Set();
            currentPosters.forEach(poster => {
                if (poster) {
                    const posterId = poster.id || poster.title || poster.posterUrl;
                    currentlyVisibleIds.add(posterId);
                }
            });

            // If we've used all available posters, reset the used set
            if (usedPosters.size >= mediaQueue.length) {
                usedPosters.clear();
            }

            // Find posters that haven't been used yet AND are not the excluded poster AND are not currently visible
            const availablePosters = mediaQueue.filter(item => {
                const posterId = item.id || item.title || item.posterUrl;
                const isUsed = usedPosters.has(posterId);
                const isExcluded = excludePosterId && posterId === excludePosterId;
                const isCurrentlyVisible = currentlyVisibleIds.has(posterId);
                return !isUsed && !isExcluded && !isCurrentlyVisible;
            });

            if (availablePosters.length === 0) {
                // If no available posters, find posters that are not the excluded one and not currently visible
                const nonExcludedNonVisiblePosters = mediaQueue.filter(item => {
                    const posterId = item.id || item.title || item.posterUrl;
                    const isExcluded = excludePosterId && posterId === excludePosterId;
                    const isCurrentlyVisible = currentlyVisibleIds.has(posterId);
                    return !isExcluded && !isCurrentlyVisible;
                });

                if (nonExcludedNonVisiblePosters.length === 0) {
                    // If still no options and we have more than one poster, find non-excluded ones
                    const nonExcludedPosters = mediaQueue.filter(item => {
                        const posterId = item.id || item.title || item.posterUrl;
                        return !excludePosterId || posterId !== excludePosterId;
                    });

                    if (nonExcludedPosters.length === 0) {
                        // Last resort: any poster
                        const randomIndex = Math.floor(Math.random() * mediaQueue.length);
                        return mediaQueue[randomIndex];
                    }

                    // Get random from non-excluded posters
                    const randomIndex = Math.floor(Math.random() * nonExcludedPosters.length);
                    const selectedPoster = nonExcludedPosters[randomIndex];

                    // Mark as used
                    const posterId =
                        selectedPoster.id || selectedPoster.title || selectedPoster.posterUrl;
                    usedPosters.add(posterId);

                    return selectedPoster;
                }

                // Get random from non-excluded, non-visible posters
                const randomIndex = Math.floor(Math.random() * nonExcludedNonVisiblePosters.length);
                const selectedPoster = nonExcludedNonVisiblePosters[randomIndex];

                // Mark as used
                const posterId =
                    selectedPoster.id || selectedPoster.title || selectedPoster.posterUrl;
                usedPosters.add(posterId);

                return selectedPoster;
            }

            // Get a random poster from available ones
            const randomIndex = Math.floor(Math.random() * availablePosters.length);
            const selectedPoster = availablePosters[randomIndex];

            // Mark as used
            const posterId = selectedPoster.id || selectedPoster.title || selectedPoster.posterUrl;
            usedPosters.add(posterId);

            return selectedPoster;
        }

        function initializeWallartGrid() {
            // Clear existing items
            wallartGrid.innerHTML = '';
            currentPosters = [];
            usedPosters.clear();

            // Apply dynamic grid layout based on screen-filling calculation
            const layoutInfo = calculateWallartLayout(wallartConfig.density);

            // Update CSS grid with proper centering and fixed poster sizes
            wallartGrid.style.cssText = `
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
                z-index: 1000 !important;
                overflow: visible !important;
            `;

            // Check if we have enough media
            if (mediaQueue.length === 0) {
                // Show loading message
                const loadingItem = document.createElement('div');
                loadingItem.style.cssText = `
                    grid-column: 1 / -1 !important;
                    grid-row: 1 / -1 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    color: white !important;
                    font-size: 24px !important;
                    font-family: Arial, sans-serif !important;
                `;
                loadingItem.textContent = 'Loading posters...';
                wallartGrid.appendChild(loadingItem);

                // Try to fetch media if not available
                // console.log removed for cleaner browser console
                fetchMedia(true)
                    .then(() => {
                        // After media is fetched, reinitialize the grid
                        if (mediaQueue.length > 0) {
                            initializeWallartGrid();
                        }
                    })
                    .catch(error => {
                        console.error('[WALLART] Failed to fetch media:', error);
                        loadingItem.textContent =
                            'Failed to load posters. Please refresh the page.';
                    });

                return;
            }

            // Fill grid with unique posters
            for (let i = 0; i < posterCount; i++) {
                const poster = getUniqueRandomPoster();
                if (poster) {
                    currentPosters.push(poster);
                    const posterItem = createPosterElement(poster, i);

                    // Add subtle fade-in animation with staggered timing
                    posterItem.style.animationDelay = `${i * 0.02}s`;
                    posterItem.style.animation = 'wallartFadeIn 0.6s ease-out forwards';

                    wallartGrid.appendChild(posterItem);
                }
            }
        }

        window.refreshSinglePoster = function refreshSinglePoster() {
            if (currentPosters.length === 0 || mediaQueue.length === 0) {
                return;
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
                // console.log removed for cleaner browser console
                return;
            }

            // Remove old poster from used set (so it can be used again later)
            if (currentPosterAtPosition) {
                usedPosters.delete(currentPosterId);
            }

            // Update current poster tracking
            currentPosters[randomPosition] = newPoster;

            // Find the DOM element and animate the change
            const posterElements = wallartGrid.querySelectorAll('.wallart-poster-item');
            const targetElement = posterElements[randomPosition];

            if (targetElement) {
                targetElement.dataset.posterId = newPoster.id || newPoster.title || randomPosition;
                animatePosterChange(targetElement, newPoster, animationType);
            }

            // Schedule next refresh only if auto-refresh is enabled
            if (wallartConfig.autoRefresh !== false) {
                // Use exponential random distribution for more natural, unpredictable timing
                const randomFactor = Math.random() * Math.random(); // Double random for exponential curve
                const isNegative = Math.random() < 0.5; // 50% chance negative variation
                const randomVariation = (isNegative ? -1 : 1) * randomFactor * maxRandomVariation;
                const nextInterval = Math.max(200, refreshInterval + randomVariation);

                wallartRefreshTimeout = setTimeout(refreshSinglePoster, nextInterval);
            }
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

        function animatePosterChange(element, newItem, animationType) {
            const img = element.querySelector('img');
            if (!img) return;

            // If animation type is 'random', select a random type from all available types
            if (animationType === 'random') {
                animationType = getRandomAnimationType();
            }

            // Start with just a simple, reliable fade animation
            if (animationType === 'fade') {
                // Step 1: Fade out current image
                img.style.transition = 'opacity 0.5s ease-in-out';
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
                }, 500);
            } else if (animationType === 'slideLeft') {
                // Reset any existing transition first
                img.style.transition = 'none';
                img.style.transform = 'scale(1.05) translateX(0px)';

                // Force reflow
                img.offsetHeight;

                // Step 1: Slide out to the left with fade
                img.style.transition = 'all 0.6s ease-in-out';
                img.style.opacity = '0';
                img.style.transform = 'scale(1.05) translateX(-100px)';

                // Step 2: Change image and slide in from right
                setTimeout(() => {
                    img.src =
                        newItem.posterUrl ||
                        '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                    img.alt = newItem.title || 'Movie Poster';

                    // Position image off-screen right (no transition)
                    img.style.transition = 'none';
                    img.style.transform = 'scale(1.05) translateX(100px)';
                    img.style.opacity = '0';

                    // Force reflow
                    img.offsetHeight;

                    // Step 3: Slide in from right
                    img.style.transition = 'all 0.6s ease-out';
                    setTimeout(() => {
                        img.style.opacity = '1';
                        img.style.transform = 'scale(1.05) translateX(0px)';
                    }, 50);
                }, 600);
            } else if (animationType === 'slideUp') {
                // Reset any existing transition first
                img.style.transition = 'none';
                img.style.transform = 'scale(1.05) translateY(0px)';

                // Force reflow
                img.offsetHeight;

                // Step 1: Slide up and fade out
                img.style.transition = 'all 0.6s ease-in-out';
                img.style.opacity = '0';
                img.style.transform = 'scale(1.05) translateY(-100px)';

                // Step 2: Change image and slide in from bottom
                setTimeout(() => {
                    img.src =
                        newItem.posterUrl ||
                        '/api/image?url=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
                    img.alt = newItem.title || 'Movie Poster';

                    // Position image off-screen bottom (no transition)
                    img.style.transition = 'none';
                    img.style.transform = 'scale(1.05) translateY(100px)';
                    img.style.opacity = '0';

                    // Force reflow
                    img.offsetHeight;

                    // Step 3: Slide in from bottom
                    img.style.transition = 'all 0.6s ease-out';
                    setTimeout(() => {
                        img.style.opacity = '1';
                        img.style.transform = 'scale(1.05) translateY(0px)';
                    }, 50);
                }, 600);
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
                initializeWallartGrid();
            }, 250); // Debounce resize events
        }

        // Remove existing listener if any
        if (window.wallartResizeListener) {
            window.removeEventListener('resize', window.wallartResizeListener);
        }

        // Add new listener
        window.wallartResizeListener = handleWallartResize;
        window.addEventListener('resize', window.wallartResizeListener);
    }

    async function refreshConfig() {
        try {
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
            const newConfig = await configResponse.json();

            // Check if configuration has changed
            const configChanged = JSON.stringify(appConfig) !== JSON.stringify(newConfig);

            if (configChanged) {
                const oldConfig = { ...appConfig };
                appConfig = newConfig;

                // Apply configuration changes
                applyConfigurationChanges(oldConfig, newConfig);

                // Apply UI scaling changes
                applyUIScaling(newConfig);

                // Apply cinema mode changes
                applyCinemaMode(newConfig);

                // Apply wallart mode changes
                applyWallartMode(newConfig);
            }
        } catch (error) {
            console.error('Failed to refresh configuration:', error);
        }
    }

    function applyConfigurationChanges(oldConfig, newConfig) {
        // Handle display changes
        if (oldConfig.showPoster !== newConfig.showPoster) {
            if (newConfig.showPoster === false) {
                infoContainer.classList.add('is-hidden');
            } else {
                infoContainer.classList.remove('is-hidden');
            }
        }

        // Handle clock widget changes
        if (oldConfig.clockWidget !== newConfig.clockWidget) {
            const widgetContainer = document.getElementById('widget-container');
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
        if (oldConfig.showMetadata !== newConfig.showMetadata) {
            updateCurrentMediaDisplay();
        }

        // Handle clear logo display changes
        if (oldConfig.showClearLogo !== newConfig.showClearLogo) {
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
                if (isInitialLoad && loader.style.opacity !== '1') {
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

            const newMediaQueue = await mediaResponse.json();
            if (newMediaQueue.length === 0) {
                showError('No media found. Check the library configuration.');
                if (loader.style.opacity !== '0') loader.style.opacity = '0';
                return;
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
                changeMedia('next', true); // This will start the slideshow at `randomIndex`
            }

            // Start preloading images for smooth transitions
            preloadNextImages();
        } catch (e) {
            console.error('Failed to fetch media', e);
            showError(e.message || 'Could not load media. Check the server connection.');
            if (loader.style.opacity !== '0') loader.style.opacity = '0';
        }
    }

    // Prefetch system for smooth transitions
    const preloadedImages = {
        backgrounds: new Map(),
        posters: new Map(),
    };
    const maxPreloadedImages = 5; // Preload next 5 items

    function preloadNextImages() {
        if (mediaQueue.length < 2) return;

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
            console.error('renderMediaItem called with invalid mediaItem');
            return;
        }

        // Skip rendering individual media items in wallart mode
        // Wallart mode handles its own poster display
        if (document.body.classList.contains('wallart-mode')) {
            return;
        }

        // Apply transition effects to poster in cinema mode
        if (appConfig.cinemaMode) {
            applyPosterTransitionEffect(mediaItem.posterUrl);
        } else {
            posterEl.style.backgroundImage = `url('${mediaItem.posterUrl}')`;
        }

        // Check if poster should be shown
        if (appConfig.showPoster === false) {
            infoContainer.classList.add('is-hidden');
        } else {
            infoContainer.classList.remove('is-hidden');
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

        // Check if metadata should be shown
        if (appConfig.showMetadata === false) {
            textWrapper.classList.add('is-hidden');
        } else {
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
        } else {
            rtBadge.classList.remove('visible');
        }
    }

    function updateInfo(direction, isFirstLoad = false) {
        if (direction === 'next') {
            currentIndex = (currentIndex + 1) % mediaQueue.length;
        } else {
            // 'prev'
            currentIndex = (currentIndex - 1 + mediaQueue.length) % mediaQueue.length;
        }

        const currentMedia = mediaQueue[currentIndex];
        if (!currentMedia) {
            console.error('Invalid media item at index, skipping.', currentIndex);
            changeMedia('next', false, true);
            return;
        }

        // Check if background URL is valid before loading
        if (!currentMedia.backgroundUrl) {
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
            changeMedia('next', false, true);
            return;
        }

        const img = new Image();
        img.onerror = () => {
            console.error(`Could not load background for: ${currentMedia.title}. Skipping item.`);
            changeMedia('next', false, true);
        };
        img.src = currentMedia.backgroundUrl;
        img.onload = () => {
            // Set the background image first
            inactiveLayer.style.backgroundImage = `url('${currentMedia.backgroundUrl}')`;

            // Apply transition effects with proper layering
            applyTransitionEffect(inactiveLayer, activeLayer, false);

            renderMediaItem(currentMedia);

            if (loader.style.opacity !== '0') {
                loader.style.opacity = '0';
            }
            preloadNextImage();

            if (isFirstLoad) {
                infoContainer.classList.add('visible');
            } else {
                setTimeout(() => {
                    infoContainer.classList.add('visible');

                    // Additional check for cinema mode
                    if (appConfig.cinemaMode) {
                        infoContainer.classList.add('visible');
                    }
                }, 500);
            }
            if (!isPaused) startTimer();
        };
    }

    // Apply transition effects specifically for posters in cinema mode
    function applyPosterTransitionEffect(newPosterUrl) {
        // Check if poster is already preloaded
        const isPreloaded = preloadedImages.posters.has(newPosterUrl);

        // Get poster layer elements
        const posterA = document.getElementById('poster-a');
        const posterB = document.getElementById('poster-b');

        if (!posterA || !posterB) {
            const originalPoster = document.getElementById('poster');

            if (originalPoster) {
                if (isPreloaded) {
                    // Image is preloaded, safe to set immediately
                    originalPoster.style.backgroundImage = `url('${newPosterUrl}')`;
                } else {
                    // Load image first to avoid black flash
                    const img = new Image();
                    img.onload = () => {
                        originalPoster.style.backgroundImage = `url('${newPosterUrl}')`;
                    };
                    img.onerror = () => {
                        // Keep existing poster on error
                    };
                    img.src = newPosterUrl;
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
                const fadeInDuration = 1.5; // Fixed fade in duration
                const holdDuration = actualDuration - actualPauseTime - fadeInDuration; // Hold visible

                // Fade in new layer while fading out old layer
                newLayer.style.transition = `opacity ${fadeInDuration}s ease-in-out`;
                currentLayer.style.transition = `opacity ${fadeInDuration}s ease-in-out`;

                setTimeout(() => {
                    newLayer.style.opacity = '1';
                    currentLayer.style.opacity = '0';

                    // Hold visible for calculated time
                    setTimeout(() => {
                        // Fade hold complete
                    }, holdDuration * 1000);
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

    // Apply transition effects based on configuration
    function applyTransitionEffect(newLayer, oldLayer, isPoster = false) {
        // Clear any existing animation classes
        newLayer.className = newLayer.className.replace(/\beffect-\w+\b/g, '');
        newLayer.style.animation = 'none';
        newLayer.style.transition = 'none';

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
            // For 'none', just do a simple crossfade with pause
            newLayer.style.opacity = 0;
            newLayer.style.transition = 'opacity 0.5s ease-in-out';

            // Trigger the transition
            requestAnimationFrame(() => {
                newLayer.style.opacity = 1;
                if (oldLayer) {
                    oldLayer.style.opacity = 0;
                }

                // Swap layers after transition + pause
                setTimeout(
                    () => {
                        swapLayers(newLayer, oldLayer);
                    },
                    500 + actualPauseTime * 1000
                );
            });
            return;
        }

        // Handle backward compatibility with old Ken Burns config
        if (transitionEffect === 'kenburns') {
            const kenBurnsVariations = [
                'kenburns-zoom-out-tl',
                'kenburns-zoom-out-br',
                'kenburns-zoom-out-tr',
                'kenburns-zoom-out-bl',
                'kenburns-zoom-in-tl',
                'kenburns-zoom-in-br',
                'kenburns-zoom-in-tr',
                'kenburns-zoom-in-bl',
            ];
            const randomAnimation =
                kenBurnsVariations[Math.floor(Math.random() * kenBurnsVariations.length)];

            // Ken Burns uses the full transition interval (no pause time)
            const kenBurnsDuration = transitionInterval || appConfig.transitionInterval || 20;

            // Mark as Ken Burns active and clear any conflicting styles
            newLayer.setAttribute('data-ken-burns', 'true');
            newLayer.style.transform = '';
            newLayer.style.animation = 'none';

            // Start with opacity 0, then animate in with Ken Burns
            newLayer.style.opacity = 0;
            newLayer.style.transition = 'opacity 1s ease-in-out';

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    newLayer.style.opacity = 1;
                    newLayer.style.animation = `${randomAnimation} ${kenBurnsDuration}s linear forwards`;
                    if (oldLayer) {
                        oldLayer.style.opacity = 0;
                    }
                });

                // Swap layers after fade in + full Ken Burns animation
                setTimeout(
                    () => {
                        // Fade out the layer while Ken Burns is still running
                        newLayer.style.transition = 'opacity 1s ease-out';
                        newLayer.style.opacity = 0;

                        // Clean up after fade out completes, but don't call swapLayers
                        setTimeout(() => {
                            newLayer.removeAttribute('data-ken-burns');
                            newLayer.style.animation = 'none';
                            newLayer.style.transition = 'none';

                            // Manually update layer references without forcing visibility
                            const tempLayer = activeLayer;
                            activeLayer = inactiveLayer;
                            inactiveLayer = tempLayer;
                        }, 1000);
                    },
                    (kenBurnsDuration - 1) * 1000
                ); // Start fade-out 1 second before Ken Burns ends
            });
            return;
        }

        // Backward compatibility: if transitionEffect is not set but old kenBurnsEffect is enabled
        if (
            !appConfig.transitionEffect &&
            appConfig.kenBurnsEffect &&
            appConfig.kenBurnsEffect.enabled
        ) {
            const kenBurnsVariations = [
                'kenburns-zoom-out-tl',
                'kenburns-zoom-out-br',
                'kenburns-zoom-out-tr',
                'kenburns-zoom-out-bl',
                'kenburns-zoom-in-tl',
                'kenburns-zoom-in-br',
                'kenburns-zoom-in-tr',
                'kenburns-zoom-in-bl',
            ];
            const randomAnimation =
                kenBurnsVariations[Math.floor(Math.random() * kenBurnsVariations.length)];

            // Ken Burns uses the full transition interval (no pause time)
            const kenBurnsDuration = transitionInterval || appConfig.transitionInterval || 20;

            // Mark as Ken Burns active and clear any conflicting styles
            newLayer.setAttribute('data-ken-burns', 'true');
            newLayer.style.transform = '';
            newLayer.style.animation = 'none';

            newLayer.style.opacity = 0;
            newLayer.style.transition = 'opacity 1s ease-in-out';

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    newLayer.style.opacity = 1;
                    newLayer.style.animation = `${randomAnimation} ${kenBurnsDuration}s linear forwards`;
                    if (oldLayer) {
                        oldLayer.style.opacity = 0;
                    }
                });

                setTimeout(
                    () => {
                        // Fade out the layer while Ken Burns is still running
                        newLayer.style.transition = 'opacity 1s ease-out';
                        newLayer.style.opacity = 0;

                        // Clean up after fade out completes, but don't call swapLayers
                        setTimeout(() => {
                            newLayer.removeAttribute('data-ken-burns');
                            newLayer.style.animation = 'none';
                            newLayer.style.transition = 'none';

                            // Manually update layer references without forcing visibility
                            const tempLayer = activeLayer;
                            activeLayer = inactiveLayer;
                            inactiveLayer = tempLayer;
                        }, 1000);
                    },
                    (kenBurnsDuration - 1) * 1000
                ); // Start fade-out 1 second before Ken Burns ends
            });
            return;
        }

        // Apply the selected effect with proper layering
        switch (transitionEffect) {
            case 'fade':
                // Proper crossfade: both layers visible, new layer fades in while old fades out
                newLayer.style.opacity = 0;
                newLayer.style.transition = `opacity ${actualDuration}s ease-in-out`;

                if (oldLayer) {
                    oldLayer.style.transition = `opacity ${actualDuration}s ease-in-out`;
                }

                requestAnimationFrame(() => {
                    newLayer.style.opacity = 1;
                    if (oldLayer) {
                        oldLayer.style.opacity = 0;
                    }

                    // Swap layers after effect + pause
                    setTimeout(
                        () => {
                            swapLayers(newLayer, oldLayer);
                        },
                        (actualDuration + actualPauseTime) * 1000
                    );
                });
                break;

            case 'slide': {
                // True slide effect with proper layer management
                const slideDirections = [
                    'slide-in-left',
                    'slide-in-right',
                    'slide-in-up',
                    'slide-in-down',
                ];
                const randomSlide =
                    slideDirections[Math.floor(Math.random() * slideDirections.length)];

                // Ensure old layer is visible and positioned correctly as background
                if (oldLayer) {
                    oldLayer.style.transform = 'none';
                    oldLayer.style.animation = 'none';
                    oldLayer.style.transition = 'none';
                    oldLayer.style.opacity = 1;
                }

                // Prepare new layer for slide animation - start with opacity 1 so it's visible during slide
                newLayer.style.opacity = 1;
                newLayer.style.transition = 'none';
                newLayer.style.transform = 'none';
                newLayer.style.zIndex = 2; // Make sure new layer is on top

                if (oldLayer) {
                    oldLayer.style.zIndex = 1; // Old layer behind
                }

                // Force a reflow
                newLayer.offsetHeight;

                // Apply slide animation
                newLayer.style.animation = `${randomSlide} ${actualDuration}s ease-out forwards`;

                // After animation completes, clean up
                setTimeout(() => {
                    // Reset the new layer completely
                    newLayer.style.animation = 'none';
                    newLayer.style.transform = 'none';
                    newLayer.style.opacity = 1;
                    newLayer.style.zIndex = '';

                    // Hide old layer
                    if (oldLayer) {
                        oldLayer.style.opacity = 0;
                        oldLayer.style.animation = 'none';
                        oldLayer.style.transform = 'none';
                        oldLayer.style.zIndex = '';
                    }

                    // Swap the global references
                    const tempLayer = activeLayer;
                    activeLayer = inactiveLayer;
                    inactiveLayer = tempLayer;
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
                        },
                        (1 + actualPauseTime) * 1000
                    );
                });
                break;
            }
        }
    }

    // Helper function to swap layers after transition
    function swapLayers(newLayer, oldLayer) {
        if (oldLayer) {
            // Reset old layer completely
            oldLayer.style.animation = 'none';
            oldLayer.style.transition = 'none';
            oldLayer.style.opacity = 0;
            oldLayer.style.transform = 'none'; // Reset any transforms from animations
            oldLayer.removeAttribute('data-ken-burns'); // Clean up Ken Burns marker
        }

        // Reset new layer transitions but keep it visible ONLY if it's not faded out from Ken Burns
        newLayer.style.transition = 'none';
        newLayer.style.animation = 'none';

        // Only reset transform if NOT a Ken Burns layer that's still animating
        const isKenBurnsActive = newLayer.hasAttribute('data-ken-burns');
        if (!isKenBurnsActive) {
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
        if (mediaQueue.length === 0) return;

        // Don't change media in wallart mode (wallart has its own system)
        if (document.body.classList.contains('wallart-mode') && !isFirstLoad) {
            // console.log removed for cleaner browser console
            return;
        }

        if (timerId) clearInterval(timerId);

        // Hide info immediately to prepare for the new content
        if (!isErrorSkip) {
            // In cinema mode, don't hide the info container
            if (!appConfig.cinemaMode) {
                infoContainer.classList.remove('visible');
            }
            clearlogoEl.classList.remove('visible');
            rtBadge.classList.remove('visible'); // Hide RT badge
        }
        if (isFirstLoad) {
            updateInfo(direction, true);
        } else {
            setTimeout(() => updateInfo(direction), isErrorSkip ? 0 : 800);
        }
    }

    function startTimer() {
        if (timerId) clearInterval(timerId);

        // Don't start slideshow timer in wallart mode
        if (document.body.classList.contains('wallart-mode')) {
            return;
        }

        // Calculate total time including effect duration + pause time
        const transitionInterval = appConfig.transitionIntervalSeconds || 15;

        // Total interval should be: effect duration + pause time
        // But if user sets a specific interval, respect that as the total time
        const totalInterval = transitionInterval; // User sets total time
        const interval = totalInterval * 1000;

        timerId = setInterval(() => changeMedia('next'), interval);
    }

    function updateClock() {
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

    nextButton.addEventListener('click', () => changeMedia('next'));
    prevButton.addEventListener('click', () => changeMedia('prev'));

    document.addEventListener('keydown', e => {
        showControls();
        if (e.key === 'ArrowRight') {
            changeMedia('next');
        } else if (e.key === 'ArrowLeft') {
            changeMedia('prev');
        } else if (e.key === ' ') {
            e.preventDefault();
            pauseButton.click();
        }
    });

    // Show controls on mouse movement or touch, and hide them after a few seconds.
    function showControls() {
        controlsContainer.classList.add('visible');
        document.body.style.cursor = 'default';
        clearTimeout(controlsTimer);
        controlsTimer = setTimeout(() => {
            controlsContainer.classList.remove('visible');
            document.body.style.cursor = 'none';
        }, 3000);
    }

    document.body.addEventListener('mousemove', showControls);
    document.body.addEventListener('touchstart', showControls, { passive: true });

    posterWrapper.addEventListener('mousemove', e => {
        const rect = posterWrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -8;
        const rotateY = ((x - centerX) / centerX) * 8;

        // Get current content scale from CSS variable
        const contentScale =
            getComputedStyle(document.documentElement).getPropertyValue('--content-scale').trim() ||
            '1';
        posterEl.style.transform = `scale(${contentScale}) perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.08, 1.08, 1.08)`;
        posterEl.style.setProperty('--mouse-x', `${x}px`);
        posterEl.style.setProperty('--mouse-y', `${y}px`);
    });

    posterWrapper.addEventListener('mouseleave', () => {
        // Get current content scale from CSS variable
        const contentScale =
            getComputedStyle(document.documentElement).getPropertyValue('--content-scale').trim() ||
            '1';
        posterEl.style.transform = `scale(${contentScale}) perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)`;
    });

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
});
