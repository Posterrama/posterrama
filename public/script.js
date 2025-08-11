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
    let appConfig = {};
    let preloadedImage = null;

    const transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

    function showError(message) {
        const errorMessageEl = document.getElementById('error-message');
        errorMessageEl.textContent = message;
        errorMessageEl.classList.remove('is-hidden');
    }

    async function initialize() {
        try {
            const configResponse = await fetch('/get-config', {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            appConfig = await configResponse.json();

            // Logic for the public site promo box.
            // The server injects `isPublicSite: true` into the config for the public-facing server.
            if (appConfig.isPublicSite) {
                const promoBox = document.getElementById('promo-box');
                if (promoBox) promoBox.classList.remove('is-hidden');
            }

        } catch (e) {
            showError(e.message);
            console.error(e);
            return;
        }

        await fetchMedia(true);
        if (appConfig.showPoster === false) {
            infoContainer.classList.add('is-hidden');
        } else {
            // Poster is shown, now check metadata
            if (appConfig.showMetadata === false) {
                textWrapper.classList.add('is-hidden');
            }
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
            refreshTimerId = setInterval(fetchMedia, appConfig.backgroundRefreshMinutes * 60 * 1000);
        }

        // Periodically refresh configuration to pick up admin changes
        // Check for config changes every 30 seconds
        if (configRefreshTimerId) clearInterval(configRefreshTimerId);
        configRefreshTimerId = setInterval(refreshConfig, 30 * 1000);

        // Apply initial UI scaling
        applyUIScaling(appConfig);

        // Apply cinema mode
        applyCinemaMode(appConfig);
    }

    function applyUIScaling(config) {
        // Apply UI scaling from configuration
        if (!config.uiScaling) {
            console.log('No UI scaling configuration found, using defaults');
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

        console.log('Applied UI scaling:', {
            content: contentScale,
            clearlogo: clearlogoScale,
            clock: clockScale
        });
    }

    function applyCinemaMode(config) {
        const body = document.body;
        
        // Remove any existing cinema mode classes
        body.classList.remove('cinema-mode', 'cinema-auto', 'cinema-portrait', 'cinema-portrait-flipped');
        
        if (config.cinemaMode) {
            console.log('Applying cinema mode with orientation:', config.cinemaOrientation);
            
            // Add cinema mode base class
            body.classList.add('cinema-mode');
            
            // Add orientation-specific class
            const orientation = config.cinemaOrientation || 'auto';
            body.classList.add(`cinema-${orientation}`);
            
            // Force info container to be visible in cinema mode
            setTimeout(() => {
                infoContainer.classList.add('visible');
            }, 100);
        }
    }

    async function refreshConfig() {
        try {
            const configResponse = await fetch('/get-config', {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            const newConfig = await configResponse.json();
            
            // Check if configuration has changed
            const configChanged = JSON.stringify(appConfig) !== JSON.stringify(newConfig);
            
            if (configChanged) {
                console.log('Configuration changed, applying updates...');
                const oldConfig = { ...appConfig };
                appConfig = newConfig;
                
                // Apply configuration changes
                applyConfigurationChanges(oldConfig, newConfig);
                
                // Apply UI scaling changes
                applyUIScaling(newConfig);
                
                // Apply cinema mode changes
                applyCinemaMode(newConfig);
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
        if (oldConfig.clockTimezone !== newConfig.clockTimezone || 
            oldConfig.clockFormat !== newConfig.clockFormat) {
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
                refreshTimerId = setInterval(fetchMedia, newConfig.backgroundRefreshMinutes * 60 * 1000);
            }
        }

        // Handle cinema mode changes
        if (oldConfig.cinemaMode !== newConfig.cinemaMode || 
            oldConfig.cinemaOrientation !== newConfig.cinemaOrientation) {
            applyCinemaMode(newConfig);
        }

        console.log('Configuration changes applied successfully');
    }

    function applyUIScaling(config) {
        // Apply UI scaling from configuration
        if (config.uiScaling) {
            const root = document.documentElement;
            const globalScale = (config.uiScaling.global || 100) / 100;
            
            // Support both old and new field names for backwards compatibility
            let contentScale;
            if (config.uiScaling.content !== undefined) {
                // New format: use content field
                contentScale = ((config.uiScaling.content || 100) / 100) * globalScale;
            } else if (config.uiScaling.poster !== undefined || config.uiScaling.text !== undefined) {
                // Old format: use average of poster and text, or fallback to poster
                const posterVal = config.uiScaling.poster || 100;
                const textVal = config.uiScaling.text || posterVal;
                contentScale = ((Math.max(posterVal, textVal) || 100) / 100) * globalScale;
            } else {
                // Default
                contentScale = globalScale;
            }
            
            const clearlogoScale = ((config.uiScaling.clearlogo || 100) / 100) * globalScale;
            const clockScale = ((config.uiScaling.clock || 100) / 100) * globalScale;
            
            // Apply to CSS custom properties
            root.style.setProperty('--content-scale', contentScale);
            root.style.setProperty('--clearlogo-scale', clearlogoScale);
            root.style.setProperty('--clock-scale', clockScale);
            
            console.log('Applied UI scaling:', {
                content: contentScale,
                clearlogo: clearlogoScale,
                clock: clockScale
            });
        } else {
            console.log('No UI scaling configuration found, using defaults');
        }
    }

    function updateCurrentMediaDisplay() {
        // Re-render the current media item with updated configuration
        if (currentIndex >= 0 && currentIndex < mediaQueue.length) {
            const currentMedia = mediaQueue[currentIndex];
            if (currentMedia) {
                renderMediaItem(currentMedia);
                console.log('Updated current media display with new configuration');
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
                console.log('Server is preparing media, retrying in a moment...');
                // Keep the loader visible if it's the initial load.
                if (isInitialLoad && loader.style.opacity !== '1') {
                    loader.style.opacity = '1';
                }
                setTimeout(() => fetchMedia(isInitialLoad), data.retryIn || 2000);
                return; // Stop execution for this call
            }

            if (!mediaResponse.ok) {
                const errorData = await mediaResponse.json().catch(() => ({ error: mediaResponse.statusText }));
                throw new Error(errorData.error || `Server error: ${mediaResponse.status}`);
            }

            const newMediaQueue = await mediaResponse.json();
            if (newMediaQueue.length === 0) {
                showError("No media found. Check the library configuration.");
                if (loader.style.opacity !== '0') loader.style.opacity = '0';
                return;
            }
            mediaQueue = newMediaQueue;
            console.log(`Playlist updated with ${mediaQueue.length} items.`);

            if (isInitialLoad) {
                // Pick a random starting point instead of always starting at 0.
                // We set it to randomIndex - 1 because changeMedia increments it before use.
                const randomIndex = Math.floor(Math.random() * mediaQueue.length);
                currentIndex = randomIndex - 1;
                changeMedia('next', true); // This will start the slideshow at `randomIndex`
            }
        } catch (e) {
            console.error("Failed to fetch media", e);
            showError(e.message || "Could not load media. Check the server connection.");
            if (loader.style.opacity !== '0') loader.style.opacity = '0';
        }
    }

    async function jumpToMedia(key) {
        const newIndex = mediaQueue.findIndex(item => item.key === key);

        const jump = (index) => {
            // Stop any pending timer. changeMedia will restart it if not paused.
            if (timerId) clearInterval(timerId);
            currentIndex = index - 1; // -1 because changeMedia increments
            changeMedia('next');
        };

        if (newIndex > -1) {
            jump(newIndex);
        } else {
            console.warn(`Item with key ${key} not in playlist, fetching...`);
            try {
                const response = await fetch(`/get-media-by-key/${key}`);
                if (!response.ok) throw new Error('Media not found on server.');
                const mediaItem = await response.json();
                // Insert after current item and jump to it
                mediaQueue.splice(currentIndex + 1, 0, mediaItem);
                jump(currentIndex + 1);
            } catch (e) {
                console.error(`Failed to fetch and jump to media item ${key}:`, e);
                showError("Could not load the selected item.");
                if (!isPaused) startTimer();
            }
        }
    }

    function preloadNextImage() {
        if (mediaQueue.length < 2) return;
        const nextIndex = (currentIndex + 1) % mediaQueue.length;
        preloadedImage = new Image();
        preloadedImage.src = mediaQueue[nextIndex].backgroundUrl;
    }

    /**
     * Renders the metadata for a single media item into the DOM.
     * This function is responsible for updating the poster, title, tagline, ratings, etc.
     * @param {object} mediaItem The media item object to render.
     */
    function renderMediaItem(mediaItem) {
        console.log('[DEBUG] renderMediaItem called, cinemaMode:', appConfig.cinemaMode);
        
        // Apply transition effects to poster in cinema mode
        if (appConfig.cinemaMode) {
            console.log('[DEBUG] Cinema mode is active, applying poster layer effects');
            applyPosterTransitionEffect(mediaItem.posterUrl);
        } else {
            console.log('[DEBUG] Cinema mode is OFF, using original poster');
            posterEl.style.backgroundImage = `url('${mediaItem.posterUrl}')`;
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
        titleEl.textContent = mediaItem.title;
        taglineEl.textContent = mediaItem.tagline || '';
        yearEl.textContent = mediaItem.year || '';
        ratingEl.textContent = mediaItem.rating ? mediaItem.rating.toFixed(1) : '';
        document.title = `${mediaItem.title} - posterrama.app`;
        taglineEl.style.display = mediaItem.tagline ? 'block' : 'none';
        yearEl.style.display = mediaItem.year ? 'inline' : 'none';
        ratingEl.style.display = mediaItem.rating ? 'inline' : 'none';

        if (appConfig.showClearLogo && mediaItem.clearLogoUrl) {
            clearlogoEl.src = mediaItem.clearLogoUrl;
            clearlogoEl.classList.add('visible');
        } else {
            clearlogoEl.src = transparentPixel;
            clearlogoEl.classList.remove('visible');
        }

        // Update Rotten Tomatoes badge
        if (appConfig.showRottenTomatoes && mediaItem.rottenTomatoes && mediaItem.rottenTomatoes.score) {
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
        } else { // 'prev'
            currentIndex = (currentIndex - 1 + mediaQueue.length) % mediaQueue.length;
        }

        const currentMedia = mediaQueue[currentIndex];
        if (!currentMedia) {
            console.error('Invalid media item at index, skipping.', currentIndex);
            changeMedia('next', false, true);
            return;
        }

        console.log('[posterrama.app] Updating info for:', currentMedia);

        const img = new Image();
        img.onerror = () => {
            console.error(`Could not load background for: ${currentMedia.title}. Skipping item.`);
            changeMedia('next', false, true);
        };
        img.src = currentMedia.backgroundUrl;
        img.onload = () => {
            // Set the background image first
            inactiveLayer.style.backgroundImage = `url('${currentMedia.backgroundUrl}')`;
            
            console.log('[DEBUG] Background image set on layer:', inactiveLayer.id, 'Image URL:', currentMedia.backgroundUrl);
            console.log('[DEBUG] Layer styles before effect - opacity:', inactiveLayer.style.opacity, 'transform:', inactiveLayer.style.transform);
            
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
        console.log('[DEBUG] applyPosterTransitionEffect called with URL:', newPosterUrl);
        
        // Get poster layer elements
        const posterA = document.getElementById('poster-a');
        const posterB = document.getElementById('poster-b');
        
        if (!posterA || !posterB) {
            console.warn('[DEBUG] Poster layers not found, falling back to original poster');
            const originalPoster = document.getElementById('poster');
            if (originalPoster) {
                originalPoster.style.backgroundImage = `url('${newPosterUrl}')`;
            }
            return;
        }
        
        // Get transition effect configuration
        const transitionEffect = appConfig.transitionEffect || 'none';
        const transitionInterval = appConfig.transitionIntervalSeconds || 15;
        const pauseTime = (appConfig.effectPauseTime !== null && appConfig.effectPauseTime !== undefined) ? appConfig.effectPauseTime : 2;
        
        // NEW LOGIC: effect duration = total interval - pause time
        const effectDuration = Math.max(1, transitionInterval - pauseTime);
        
        // Use same logic as screensaver mode for actual durations
        const actualDuration = effectDuration; // Use calculated effect duration
        const actualPauseTime = pauseTime; // Use full pause time

        console.log('[DEBUG] Poster effect config:', {
            transitionEffect,
            transitionInterval,
            pauseTime,
            effectDuration,
            actualDuration,
            actualPauseTime
        });

        // Determine which layer is currently active and which is new
        const currentLayer = posterA.style.opacity === '1' ? posterA : posterB;
        const newLayer = currentLayer === posterA ? posterB : posterA;
        
        console.log('[DEBUG] Layer setup:', {
            currentLayer: currentLayer.id,
            newLayer: newLayer.id,
            currentOpacity: currentLayer.style.opacity,
            newOpacity: newLayer.style.opacity
        });

        // Set the new image on the new layer
        newLayer.style.backgroundImage = `url('${newPosterUrl}')`;
        
        // Clear any existing animations and reset to starting state
        newLayer.style.animation = 'none';
        newLayer.style.transition = 'none';
        newLayer.style.transform = 'none';
        newLayer.style.opacity = '0';
        
        console.log('[DEBUG] After reset - newLayer opacity:', newLayer.style.opacity, 'animation:', newLayer.style.animation);

        // Force reflow to ensure styles are applied
        newLayer.offsetHeight;

        if (transitionEffect === 'none') {
            console.log('[DEBUG] Applying NONE effect to poster layers');
            newLayer.style.transition = 'opacity 0.8s ease-in-out';
            
            setTimeout(() => {
                console.log('[DEBUG] Setting new layer opacity to 1');
                newLayer.style.opacity = '1';
                currentLayer.style.opacity = '0';
                
                // Hold for pause time
                setTimeout(() => {
                    console.log('[DEBUG] Pause complete for NONE effect');
                }, actualPauseTime * 1000);
            }, 100);
            return;
        }

        // Handle Ken Burns for posters - DISABLED for cinema mode
        if ((transitionEffect === 'kenburns' || 
            (!appConfig.transitionEffect && appConfig.kenBurnsEffect && appConfig.kenBurnsEffect.enabled))) {
            
            console.log('[DEBUG] Ken Burns disabled for cinema mode - using fade instead');
            // Fall through to fade behavior
        }

        // Apply other effects to poster layers
        switch (transitionEffect) {
            case 'kenburns':
                // Ken Burns disabled for cinema mode - fall through to fade
                console.log('[DEBUG] Ken Burns effect redirected to fade for cinema mode');
            case 'fade':
                console.log('[DEBUG] Applying FADE effect to poster layers');
                const fadeInDuration = 1.5; // Fixed fade in duration
                const holdDuration = actualDuration - actualPauseTime - fadeInDuration; // Hold visible
                
                // Fade in new layer while fading out old layer
                newLayer.style.transition = `opacity ${fadeInDuration}s ease-in-out`;
                currentLayer.style.transition = `opacity ${fadeInDuration}s ease-in-out`;
                
                setTimeout(() => {
                    console.log('[DEBUG] Cross-fading poster layers, duration:', fadeInDuration + 's', 'hold:', holdDuration + 's', 'pause:', actualPauseTime + 's');
                    newLayer.style.opacity = '1';
                    currentLayer.style.opacity = '0';
                    
                    // Hold visible for calculated time
                    setTimeout(() => {
                        console.log('[DEBUG] Fade hold time complete');
                    }, holdDuration * 1000);
                }, 100);
                break;
                
            case 'slide':
                console.log('[DEBUG] Applying SLIDE effect to poster layers');
                const slideDuration = actualDuration - actualPauseTime;
                
                // Only left/right slides for cinema mode with cinema-specific animations
                const slideDirections = ['cinema-slide-in-left', 'cinema-slide-in-right'];
                const slideDirection = slideDirections[Math.floor(Math.random() * slideDirections.length)];
                
                console.log('[DEBUG] Starting cinema slide animation:', slideDirection, 'duration:', slideDuration + 's', 'pause:', actualPauseTime + 's');
                
                // Set initial state for slide - new layer starts off-screen
                newLayer.style.opacity = '1';
                newLayer.style.transition = 'none';
                newLayer.style.transform = slideDirection.includes('left') ? 'translateX(-100%)' : 'translateX(100%)';
                newLayer.style.animation = 'none';
                
                // Current layer stays visible
                currentLayer.style.opacity = '1';
                currentLayer.style.transition = 'none';
                currentLayer.style.transform = 'translateX(0)';
                
                // Force reflow
                newLayer.offsetHeight;
                
                setTimeout(() => {
                    console.log('[DEBUG] Starting slide animation on both layers');
                    
                    // Animate new layer sliding in
                    newLayer.style.animation = `${slideDirection} ${slideDuration}s ease-out forwards`;
                    
                    // Animate old layer sliding out (opposite direction)
                    const slideOutDirection = slideDirection.includes('left') ? 'cinema-slide-out-right' : 'cinema-slide-out-left';
                    currentLayer.style.animation = `${slideOutDirection} ${slideDuration}s ease-out forwards`;
                    
                    // After animation + pause
                    setTimeout(() => {
                        console.log('[DEBUG] Cinema slide animation + pause complete');
                        newLayer.style.animation = 'none';
                        newLayer.style.transform = 'translateX(0)';
                        currentLayer.style.animation = 'none';
                        currentLayer.style.opacity = '0';
                        currentLayer.style.transform = 'translateX(0)';
                    }, (slideDuration + actualPauseTime) * 1000);
                }, 100);
                break;
                
            default:
                console.warn(`[DEBUG] Poster effect not implemented for: ${transitionEffect}, using fade`);
                newLayer.style.transition = 'opacity 1s ease-in-out';
                
                setTimeout(() => {
                    newLayer.style.opacity = '1';
                    currentLayer.style.opacity = '0';
                }, 100);
                break;
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
        const pauseTime = (appConfig.effectPauseTime !== null && appConfig.effectPauseTime !== undefined) ? appConfig.effectPauseTime : 2;
        
        // NEW LOGIC: effect duration = total interval - pause time
        const effectDuration = Math.max(1, transitionInterval - pauseTime);

        console.log('[DEBUG] Applying transition effect:', {
            transitionEffect,
            transitionInterval,
            pauseTime,
            effectDuration,
            isPoster,
            hasOldKenBurns: !!(appConfig.kenBurnsEffect && appConfig.kenBurnsEffect.enabled)
        });

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
                setTimeout(() => {
                    swapLayers(newLayer, oldLayer);
                }, 500 + (actualPauseTime * 1000));
            });
            return;
        }

        // Handle backward compatibility with old Ken Burns config
        if (transitionEffect === 'kenburns') {
            const kenBurnsVariations = [
                'kenburns-zoom-out-tl', 'kenburns-zoom-out-br', 'kenburns-zoom-out-tr', 'kenburns-zoom-out-bl',
                'kenburns-zoom-in-tl', 'kenburns-zoom-in-br', 'kenburns-zoom-in-tr', 'kenburns-zoom-in-bl'
            ];
            const randomAnimation = kenBurnsVariations[Math.floor(Math.random() * kenBurnsVariations.length)];
            
            // Start with opacity 0, then animate in with Ken Burns
            newLayer.style.opacity = 0;
            newLayer.style.transition = 'opacity 1s ease-in-out';
            
            requestAnimationFrame(() => {
                newLayer.style.opacity = 1;
                newLayer.style.animation = `${randomAnimation} ${actualDuration}s linear forwards`;
                if (oldLayer) {
                    oldLayer.style.opacity = 0;
                }
                
                // Swap layers after fade in (no pause for Ken Burns)
                setTimeout(() => {
                    swapLayers(newLayer, oldLayer);
                }, 1000);
            });
            return;
        }

        // Backward compatibility: if transitionEffect is not set but old kenBurnsEffect is enabled
        if (!appConfig.transitionEffect && appConfig.kenBurnsEffect && appConfig.kenBurnsEffect.enabled) {
            const kenBurnsVariations = [
                'kenburns-zoom-out-tl', 'kenburns-zoom-out-br', 'kenburns-zoom-out-tr', 'kenburns-zoom-out-bl',
                'kenburns-zoom-in-tl', 'kenburns-zoom-in-br', 'kenburns-zoom-in-tr', 'kenburns-zoom-in-bl'
            ];
            const randomAnimation = kenBurnsVariations[Math.floor(Math.random() * kenBurnsVariations.length)];
            
            newLayer.style.opacity = 0;
            newLayer.style.transition = 'opacity 1s ease-in-out';
            
            requestAnimationFrame(() => {
                newLayer.style.opacity = 1;
                newLayer.style.animation = `${randomAnimation} ${actualDuration}s linear forwards`;
                if (oldLayer) {
                    oldLayer.style.opacity = 0;
                }
                
                setTimeout(() => {
                    swapLayers(newLayer, oldLayer);
                }, 1000);
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
                    setTimeout(() => {
                        swapLayers(newLayer, oldLayer);
                    }, (actualDuration + actualPauseTime) * 1000);
                });
                break;
                
            case 'slide':
                // True slide effect with proper layer management
                const slideDirections = ['slide-in-left', 'slide-in-right', 'slide-in-up', 'slide-in-down'];
                const randomSlide = slideDirections[Math.floor(Math.random() * slideDirections.length)];
                
                console.log('[DEBUG] Starting slide animation:', randomSlide);
                console.log('[DEBUG] newLayer (will slide in):', newLayer.id);
                console.log('[DEBUG] oldLayer (background):', oldLayer ? oldLayer.id : 'none');
                console.log('[DEBUG] newLayer background image:', newLayer.style.backgroundImage ? 'set' : 'not set');
                
                // Ensure old layer is visible and positioned correctly as background
                if (oldLayer) {
                    oldLayer.style.transform = 'none';
                    oldLayer.style.animation = 'none';
                    oldLayer.style.transition = 'none';
                    oldLayer.style.opacity = 1;
                    console.log('[DEBUG] oldLayer set to visible as background');
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
                
                console.log('[DEBUG] About to start animation:', randomSlide);
                
                // Apply slide animation
                newLayer.style.animation = `${randomSlide} ${actualDuration}s ease-out forwards`;
                
                // After animation completes, clean up
                setTimeout(() => {
                    console.log('[DEBUG] Slide animation complete, cleaning up');
                    
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
                    
                    console.log('[DEBUG] Layer swap complete. New activeLayer:', activeLayer.id);
                    
                }, actualDuration * 1000);
                
                return; // Exit early to avoid the swapLayers call at the end
                
            default:
                console.warn(`Unknown transition effect: ${transitionEffect}`);
                // Fallback to simple crossfade
                newLayer.style.opacity = 0;
                newLayer.style.transition = 'opacity 1s ease-in-out';
                
                requestAnimationFrame(() => {
                    newLayer.style.opacity = 1;
                    if (oldLayer) {
                        oldLayer.style.opacity = 0;
                    }
                    
                    setTimeout(() => {
                        swapLayers(newLayer, oldLayer);
                    }, (1 + actualPauseTime) * 1000);
                });
                break;
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
        }
        
        // Reset new layer transitions but keep it visible
        newLayer.style.transition = 'none';
        newLayer.style.animation = 'none';
        newLayer.style.transform = 'none'; // Reset any transforms from animations
        newLayer.style.opacity = 1; // Ensure it's visible
        
        // Update global layer references
        const tempLayer = activeLayer;
        activeLayer = inactiveLayer;
        inactiveLayer = tempLayer;
    }

    function changeMedia(direction = 'next', isFirstLoad = false, isErrorSkip = false) {
        if (mediaQueue.length === 0) return;
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
        
        // Calculate total time including effect duration + pause time
        const transitionInterval = appConfig.transitionIntervalSeconds || 15;
        const effectPauseTime = (appConfig.effectPauseTime !== null && appConfig.effectPauseTime !== undefined) ? appConfig.effectPauseTime : 2;
        
        // Total interval should be: effect duration + pause time
        // But if user sets a specific interval, respect that as the total time
        const totalInterval = transitionInterval; // User sets total time
        const interval = totalInterval * 1000;
        
        console.log('[TIMER] Starting timer with total interval:', totalInterval + 's', 'effect pause:', effectPauseTime + 's');
        
        timerId = setInterval(() => changeMedia('next'), interval);
    }

    function updateClock() {
        const now = new Date();
        
        // Get timezone and format from config
        const timezone = appConfig.clockTimezone || 'auto';
        const format = appConfig.clockFormat || '24h';
        
        let timeOptions = {
            hour: '2-digit',
            minute: '2-digit',
            hour12: format === '12h'
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
                console.debug('[Clock] Using Intl.DateTimeFormat:', { timezone, format, timeString, timeOptions });
            } else {
                // Fallback to toLocaleTimeString
                timeString = now.toLocaleTimeString('en-US', timeOptions);
                console.debug('[Clock] Using toLocaleTimeString fallback:', { timezone, format, timeString, timeOptions });
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
            console.warn('Invalid timezone configuration, falling back to system timezone:', error);
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

    document.addEventListener('keydown', (e) => {
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

    posterWrapper.addEventListener('mousemove', (e) => {
        const rect = posterWrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -8;
        const rotateY = ((x - centerX) / centerX) * 8;
        
        // Get current content scale from CSS variable
        const contentScale = getComputedStyle(document.documentElement).getPropertyValue('--content-scale').trim() || '1';
        posterEl.style.transform = `scale(${contentScale}) perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.08, 1.08, 1.08)`;
        posterEl.style.setProperty('--mouse-x', `${x}px`);
        posterEl.style.setProperty('--mouse-y', `${y}px`);
    });

    posterWrapper.addEventListener('mouseleave', () => {
        // Get current content scale from CSS variable
        const contentScale = getComputedStyle(document.documentElement).getPropertyValue('--content-scale').trim() || '1';
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
                    console.log('Swipe Left detected, showing next media.');
                    changeMedia('next');
                } else {
                    // Swipe right -> Previous media
                    console.log('Swipe Right detected, showing previous media.');
                    changeMedia('prev');
                }
            }
        }
    }

    document.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe();
    }, { passive: true });

    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });
});
