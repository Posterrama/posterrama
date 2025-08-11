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
        const posterScale = ((scaling.poster || 100) * globalScale) / 100;
        const textScale = ((scaling.text || 100) * globalScale) / 100;
        const clearlogoScale = ((scaling.clearlogo || 100) * globalScale) / 100;
        const clockScale = ((scaling.clock || 100) * globalScale) / 100;

        // Set CSS custom properties for scaling
        root.style.setProperty('--poster-scale', posterScale / 100);
        root.style.setProperty('--text-scale', textScale / 100);
        root.style.setProperty('--clearlogo-scale', clearlogoScale / 100);
        root.style.setProperty('--clock-scale', clockScale / 100);

        console.log('Applied UI scaling:', {
            poster: posterScale,
            text: textScale,
            clearlogo: clearlogoScale,
            clock: clockScale
        });
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

        console.log('Configuration changes applied successfully');
    }

    function applyUIScaling(config) {
        // Apply UI scaling from configuration
        if (config.uiScaling) {
            const root = document.documentElement;
            const globalScale = (config.uiScaling.global || 100) / 100;
            
            // Calculate combined scales (individual * global)
            const posterScale = ((config.uiScaling.poster || 100) / 100) * globalScale;
            const textScale = ((config.uiScaling.text || 100) / 100) * globalScale;
            const clearlogoScale = ((config.uiScaling.clearlogo || 100) / 100) * globalScale;
            const clockScale = ((config.uiScaling.clock || 100) / 100) * globalScale;
            
            // Apply to CSS custom properties
            root.style.setProperty('--poster-scale', posterScale);
            root.style.setProperty('--text-scale', textScale);
            root.style.setProperty('--clearlogo-scale', clearlogoScale);
            root.style.setProperty('--clock-scale', clockScale);
            
            console.log('Applied UI scaling:', {
                poster: posterScale,
                text: textScale,
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
        posterEl.style.backgroundImage = `url('${mediaItem.posterUrl}')`;
        if (mediaItem.imdbUrl) {
            posterLink.href = mediaItem.imdbUrl;
        } else {
            // Make the poster non-clickable if there is no IMDb URL
            posterLink.removeAttribute('href');
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
            if (appConfig.kenBurnsEffect && appConfig.kenBurnsEffect.enabled) {
                const animations = [
                    'kenburns-zoom-out-tl', 'kenburns-zoom-out-br', 'kenburns-zoom-out-tr', 'kenburns-zoom-out-bl',
                    'kenburns-zoom-in-tl', 'kenburns-zoom-in-br', 'kenburns-zoom-in-tr', 'kenburns-zoom-in-bl'
                ];
                const randomAnimation = animations[Math.floor(Math.random() * animations.length)];
                const duration = appConfig.kenBurnsEffect.durationSeconds || 25;

                // Use 'forwards' to keep the end state of the animation.
                // This removes the "pulsing" `infinite alternate` effect and creates a smooth,
                // one-way motion that is more cinematic and less distracting.
                inactiveLayer.style.animation = `${randomAnimation} ${duration}s linear forwards`;
            } else {
                inactiveLayer.style.animation = 'none';
            }

            inactiveLayer.style.backgroundImage = `url('${currentMedia.backgroundUrl}')`;
            activeLayer.style.opacity = 0;
            inactiveLayer.style.opacity = 1;
            const tempLayer = activeLayer;
            activeLayer = inactiveLayer;
            inactiveLayer = tempLayer;            
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
                }, 500);
            }
            if (!isPaused) startTimer();
        };
    }

    function changeMedia(direction = 'next', isFirstLoad = false, isErrorSkip = false) {
        if (mediaQueue.length === 0) return;
        if (timerId) clearInterval(timerId);

        // Hide info immediately to prepare for the new content
        if (!isErrorSkip) {
            infoContainer.classList.remove('visible');
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
        const interval = (appConfig.transitionIntervalSeconds || 15) * 1000;
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
        posterEl.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.08, 1.08, 1.08)`;
        posterEl.style.setProperty('--mouse-x', `${x}px`);
        posterEl.style.setProperty('--mouse-y', `${y}px`);
    });

    posterWrapper.addEventListener('mouseleave', () => {
        posterEl.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)';
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
