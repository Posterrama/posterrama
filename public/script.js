/**
 * posterrama.app - Client-side logic
 *
 * Author: Mark Frelink
 * Version: 1.0.1
 * Last Modified: 2024-08-02
 * License: AGPL-3.0-or-later - This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

function setAppHeight() {
    // Sets the --app-height CSS variable to the actual inner height of the window.
    // This is the most reliable method to solve the "100vh" problem on mobile browsers.
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
window.addEventListener('resize', setAppHeight);
setAppHeight(); // Call immediately when the script loads

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const layerA = document.getElementById('layer-a');
    const layerB = document.getElementById('layer-b');
    const infoContainer = document.getElementById('info-container');
    const posterWrapper = document.getElementById('poster-wrapper');
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
    const recentContainer = document.getElementById('recent-container');
    const recentItemsWrapper = document.getElementById('recent-items-wrapper');

    // --- State ---
    let mediaQueue = [];
    let currentIndex = -1;
    let activeLayer = layerA;
    let inactiveLayer = layerB;
    let isPaused = false;
    let timerId = null;
    let controlsTimer = null;
    let refreshTimerId = null;
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
            const configResponse = await fetch('/get-config');
            appConfig = await configResponse.json();
        } catch (e) {
            showError(e.message);
            console.error(e);
            return;
        }

        const initialDataPromises = [fetchMedia(true)];
        if (appConfig.recentlyAddedSidebar) {
            initialDataPromises.push(fetchAndShowRecentlyAdded());
        }
        await Promise.all(initialDataPromises);

        if (appConfig.clockWidget) {
            document.getElementById('widget-container').classList.remove('is-hidden');
            updateClock();
            setInterval(updateClock, 1000);
        } else {
            document.getElementById('widget-container').classList.add('is-hidden');
        }

        if (appConfig.backgroundRefreshMinutes > 0) {
            if (refreshTimerId) clearInterval(refreshTimerId);
            refreshTimerId = setInterval(fetchMedia, appConfig.backgroundRefreshMinutes * 60 * 1000);
        }
    }

    async function fetchMedia(isInitialLoad = false) {
        try {
            const mediaResponse = await fetch('/get-media');
            if (!mediaResponse.ok) {
                throw new Error(`Server error: ${mediaResponse.statusText}`);
            }
            const newMediaQueue = await mediaResponse.json();
            if (newMediaQueue.length === 0) {
                showError("No media found. Check the library configuration.");
                return;
            }
            mediaQueue = newMediaQueue;
            console.log(`Playlist bijgewerkt met ${mediaQueue.length} items.`);

            if (isInitialLoad) {
                currentIndex = -1; // Start at -1, changeMedia will increment to 0
                changeMedia('next', true);
            }
        } catch (e) {
            console.error("Failed to fetch media", e);
            showError("Could not load media. Check the server connection.");
        }
    }

    async function fetchAndShowRecentlyAdded() {
        try {
            const response = await fetch('/get-recently-added');
            if (!response.ok) return;

            const recentMedia = await response.json();
            if (recentMedia.length === 0) return;

            recentItemsWrapper.innerHTML = ''; // Clear previous items

            recentMedia.forEach(item => {
                const recentItem = document.createElement('div');
                recentItem.className = 'recent-item-poster';
                recentItem.style.backgroundImage = `url('${item.posterUrl}')`;
                recentItem.title = item.title;
                recentItem.dataset.key = item.key;
                recentItem.addEventListener('click', () => jumpToMedia(item.key));
                recentItemsWrapper.appendChild(recentItem);
            });

            recentContainer.classList.remove('is-hidden');
        } catch (e) {
            console.error("Error fetching recently added media:", e);
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

    function updateInfo(direction, isFirstLoad = false) {
        if (direction === 'next') {
            currentIndex = (currentIndex + 1) % mediaQueue.length;
        } else { // 'prev'
            currentIndex = (currentIndex - 1 + mediaQueue.length) % mediaQueue.length;
        }

        const currentMedia = mediaQueue[currentIndex];
        if (!currentMedia) {
            console.error('Invalid media item, skipping.', currentIndex);
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
            if (appConfig.kenBurnsEffect && appConfig.kenBurnsEffect.enabled) {
                const animations = ['kenburns-tl', 'kenburns-br', 'kenburns-tr', 'kenburns-bl'];
                const randomAnimation = animations[Math.floor(Math.random() * animations.length)];
                const duration = appConfig.kenBurnsEffect.durationSeconds || 20;
                inactiveLayer.style.animation = `${randomAnimation} ${duration}s ease-in-out infinite alternate`;
            } else {
                inactiveLayer.style.animation = 'none';
            }

            inactiveLayer.style.backgroundImage = `url('${currentMedia.backgroundUrl}')`;
            activeLayer.style.opacity = 0;
            inactiveLayer.style.opacity = 1;
            const tempLayer = activeLayer;
            activeLayer = inactiveLayer;
            inactiveLayer = tempLayer;
            activeLayer.style.animationPlayState = 'running';
            posterEl.style.backgroundImage = `url('${currentMedia.posterUrl}')`;
            if (currentMedia.imdbUrl) {
                posterLink.href = currentMedia.imdbUrl;
            }
            titleEl.textContent = currentMedia.title;
            taglineEl.textContent = currentMedia.tagline || '';
            yearEl.textContent = currentMedia.year || '';
            ratingEl.textContent = currentMedia.rating ? currentMedia.rating.toFixed(1) : '';
            document.title = `${currentMedia.title} - posterrama.app`;
            taglineEl.style.display = currentMedia.tagline ? 'block' : 'none';
            yearEl.style.display = currentMedia.year ? 'inline' : 'none';
            ratingEl.style.display = currentMedia.rating ? 'inline' : 'none';

            if (appConfig.showClearLogo && currentMedia.clearLogoUrl) {
                clearlogoEl.src = currentMedia.clearLogoUrl;
                clearlogoEl.classList.add('visible');
            } else {
                clearlogoEl.src = transparentPixel;
                clearlogoEl.classList.remove('visible');
            }

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
        if (!isErrorSkip) {
            infoContainer.classList.remove('visible');
            clearlogoEl.classList.remove('visible');
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
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        timeHours.textContent = hours;
        timeMinutes.textContent = minutes;
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
        if (e.key === 'ArrowRight') {
            changeMedia('next');
        } else if (e.key === 'ArrowLeft') {
            changeMedia('prev');
        } else if (e.key === ' ') {
            e.preventDefault();
            pauseButton.click();
        }
    });

    document.body.addEventListener('mousemove', () => {
        controlsContainer.classList.add('visible');
        document.body.style.cursor = 'default';
        clearTimeout(controlsTimer);
        controlsTimer = setTimeout(() => {
            controlsContainer.classList.remove('visible');
            document.body.style.cursor = 'none';
        }, 3000);
    });

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
});
