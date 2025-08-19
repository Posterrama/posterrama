/**
 * Simplified Promo Site Script
 * Immediately starts screensaver with promo box overlay - no loading delays!
 */

console.log('Promo site loading...');

// Override API URLs to point to main app on port 4000
const API_BASE_URL = 'http://localhost:4000';

// Global app state
let appConfig = {};
let mediaList = [];
let currentMediaIndex = 0;
let transitionTimer = null;
let transitionInProgress = false;

// DOM elements
let posterA, posterB, posterWrapper, titleEl, taglineEl, yearEl, ratingEl;
let infoContainer, posterLink, backgroundImage, layerA, layerB;

// Override fetch function to redirect API calls to main app
const originalFetch = window.fetch;
window.fetch = function(url, options) {
    if (typeof url === 'string' && url.startsWith('/') && (
        url.includes('media') ||
        url.includes('config') ||
        url.includes('api') ||
        url.includes('get-') ||
        url.includes('image')
    )) {
        console.log(`Redirecting API call: ${url} -> ${API_BASE_URL}${url}`);
        url = `${API_BASE_URL}${url}`;
    }
    return originalFetch.call(this, url, options);
};

// Initialize immediately when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing promo screensaver...');
    
    // Get DOM elements
    posterA = document.getElementById('poster-a');
    posterB = document.getElementById('poster-b');
    posterWrapper = document.getElementById('poster-wrapper');
    titleEl = document.getElementById('title');
    taglineEl = document.getElementById('tagline');
    yearEl = document.getElementById('year');
    ratingEl = document.getElementById('rating');
    infoContainer = document.getElementById('info-container');
    posterLink = document.getElementById('poster-link');
    backgroundImage = document.getElementById('background-image');
    layerA = document.getElementById('layer-a');
    layerB = document.getElementById('layer-b');
    
    // FORCE screensaver mode styling - ALWAYS regardless of admin settings
    document.body.classList.remove('wallart-mode', 'cinema-mode');
    document.body.classList.add('screensaver-mode');
    console.log('Forced screensaver mode active');
    
    // FORCE promo box visibility - ALWAYS
    const promoBox = document.getElementById('promo-box');
    if (promoBox) {
        promoBox.classList.remove('is-hidden');
        promoBox.style.display = 'block';
        promoBox.style.opacity = '1';
        promoBox.style.visibility = 'visible';
        promoBox.style.zIndex = '99999';
        console.log('Promo box forced visible');
    }
    
    // Initialize promo screensaver
    initializePromoScreensaver();
});

// Separate async function for initialization
async function initializePromoScreensaver() {
    console.log('Initializing promo screensaver...');
    
    // Load config and media immediately
    await loadConfig();
    await loadMedia();
    
    if (mediaList.length > 0) {
        console.log(`Loaded ${mediaList.length} media items, starting slideshow...`);
        showMedia(0);
        startSlideshow();
    } else {
        console.warn('No media found, showing promo box only');
    }
}

async function loadConfig() {
    try {
        console.log('Loading config...');
        const response = await fetch('/get-config?t=' + Date.now());
        appConfig = await response.json();
        
        console.log('Raw config loaded:', appConfig);
        
        // FORCE screensaver mode settings while respecting admin preferences
        appConfig.wallartMode = { enabled: false }; // Always disable wallart
        appConfig.cinemaMode = false; // Always disable cinema
        appConfig.autoTransition = true; // Always enable transitions
        
        // Keep all the admin settings for UI elements
        // showClearLogo, showPoster, showMetadata, clockWidget, etc. stay as configured
        
        console.log('Config processed for promo screensaver mode:', appConfig);
        
        // Apply UI visibility based on admin settings
        applyUISettings();
        
    } catch (error) {
        console.error('Failed to load config:', error);
        // Use safe defaults
        appConfig = {
            showPoster: true,
            showMetadata: true,
            showClearLogo: true,
            clockWidget: true,
            autoTransition: true,
            transitionIntervalSeconds: 8,
            wallartMode: { enabled: false },
            cinemaMode: false
        };
        applyUISettings();
    }
}

function applyUISettings() {
    console.log('Applying UI settings from admin config...');
    
    // Clear logo visibility
    const clearlogoEl = document.getElementById('clearlogo');
    const clearLogoEl = document.getElementById('clear-logo');
    if (clearlogoEl) {
        clearlogoEl.style.display = appConfig.showClearLogo ? 'block' : 'none';
    }
    if (clearLogoEl) {
        clearLogoEl.style.display = appConfig.showClearLogo ? 'block' : 'none';
    }
    
    // Clock widget visibility
    const clockWidget = document.getElementById('widget-container');
    if (clockWidget) {
        clockWidget.style.display = appConfig.clockWidget ? 'block' : 'none';
    }
    
    // Info container (poster + metadata) visibility
    const infoContainer = document.getElementById('info-container');
    if (infoContainer) {
        infoContainer.style.display = appConfig.showPoster ? 'block' : 'none';
    }
    
    // Metadata visibility within info container
    const textWrapper = document.getElementById('text-wrapper');
    if (textWrapper) {
        textWrapper.style.display = appConfig.showMetadata ? 'block' : 'none';
    }
    
    // Controls - always show but transparent
    const controlsContainer = document.getElementById('controls-container');
    if (controlsContainer) {
        controlsContainer.style.display = 'block';
        controlsContainer.style.opacity = '0.3';
        controlsContainer.style.zIndex = '10';
    }
    
    // Branding - always show but transparent
    const brandingContainer = document.getElementById('branding-container');
    if (brandingContainer) {
        brandingContainer.style.display = 'block';
        brandingContainer.style.opacity = '0.5';
        brandingContainer.style.zIndex = '10';
    }
    
    console.log('UI settings applied based on admin config');
}

async function loadMedia() {
    try {
        console.log('Loading media...');
        const response = await fetch('/get-media?t=' + Date.now());
        console.log('Media response status:', response.status);
        console.log('Media response ok:', response.ok);
        
        const data = await response.json();
        console.log('Media data type:', typeof data);
        console.log('Media data is array:', Array.isArray(data));
        console.log('Media data sample:', data ? data.slice(0, 2) : 'no data');
        
        if (Array.isArray(data)) {
            mediaList = data;
            currentMediaIndex = 0;
            console.log(`Loaded ${mediaList.length} media items`);
        } else {
            console.error('Media data is not an array:', data);
            mediaList = [];
        }
    } catch (error) {
        console.error('Failed to load media:', error);
        mediaList = [];
    }
}

function showMedia(index) {
    if (!mediaList || mediaList.length === 0) return;
    
    const media = mediaList[index];
    if (!media) return;
    
    console.log('Showing media:', media.title);
    console.log('Media data:', media);
    
    // Debug: Check if DOM elements exist
    console.log('DOM elements check:');
    console.log('- posterA:', !!posterA);
    console.log('- posterB:', !!posterB);
    console.log('- backgroundImage:', !!backgroundImage);
    console.log('- layerA:', !!layerA);
    console.log('- titleEl:', !!titleEl);
    console.log('- infoContainer:', !!infoContainer);
    
    // Update text content (only if showMetadata is enabled)
    if (appConfig.showMetadata !== false) {
        if (titleEl) {
            titleEl.textContent = media.title || '';
            console.log('Set title:', media.title);
        }
        if (taglineEl) {
            taglineEl.textContent = media.tagline || '';
            console.log('Set tagline:', media.tagline);
        }
        if (yearEl) {
            yearEl.textContent = media.year ? `(${media.year})` : '';
            console.log('Set year:', media.year);
        }
        if (ratingEl && media.rating) {
            ratingEl.textContent = `★ ${media.rating}`;
            console.log('Set rating:', media.rating);
        }
    }
    
    // Update poster link
    if (posterLink && media.imdbUrl) {
        posterLink.href = media.imdbUrl;
        console.log('Set poster link:', media.imdbUrl);
    }
    
    // Show poster (only if showPoster is enabled)
    if (appConfig.showPoster !== false && posterA && posterB && media.posterUrl) {
        const activePoster = currentMediaIndex % 2 === 0 ? posterA : posterB;
        const inactivePoster = currentMediaIndex % 2 === 0 ? posterB : posterA;
        
        // Set new poster
        activePoster.style.backgroundImage = `url('${media.posterUrl}')`;
        activePoster.style.backgroundSize = 'cover';
        activePoster.style.backgroundPosition = 'center';
        activePoster.style.opacity = '1';
        activePoster.style.display = 'block';
        
        // Hide old poster
        inactivePoster.style.opacity = '0';
        
        console.log('Set poster image:', media.posterUrl);
    }
    
    // Set background fanart
    if (backgroundImage && media.backgroundUrl) {
        backgroundImage.style.backgroundImage = `url('${media.backgroundUrl}')`;
        backgroundImage.style.backgroundSize = 'cover';
        backgroundImage.style.backgroundPosition = 'center';
        backgroundImage.style.opacity = '0.3';
        backgroundImage.style.display = 'block';
        console.log('Set background image:', media.backgroundUrl);
    }
    
    // Set background layers with blur effect
    if (layerA && media.backgroundUrl) {
        layerA.style.backgroundImage = `url('${media.backgroundUrl}')`;
        layerA.style.backgroundSize = 'cover';
        layerA.style.backgroundPosition = 'center';
        layerA.style.filter = 'blur(20px)';
        layerA.style.opacity = '0.2';
        layerA.style.display = 'block';
        console.log('Set layer A background');
    }
    
    // Show clear logo if enabled and available - use img element like index.html
    if (appConfig.showClearLogo && media.clearLogoUrl) {
        const clearlogoContainer = document.getElementById('clearlogo-container');
        const clearlogoImg = document.getElementById('clearlogo');
        if (clearlogoContainer && clearlogoImg) {
            clearlogoImg.src = media.clearLogoUrl;
            clearlogoContainer.style.display = 'block';
            clearlogoContainer.style.opacity = '0.8';
            console.log('Set clearlogo container and img:', media.clearLogoUrl);
        }
    }
}

function nextMedia() {
    if (!mediaList || mediaList.length === 0) return;
    
    currentMediaIndex = (currentMediaIndex + 1) % mediaList.length;
    showMedia(currentMediaIndex);
}

function startSlideshow() {
    if (!mediaList || mediaList.length <= 1) return;
    
    // Use admin configured interval (converted to milliseconds)
    const interval = (appConfig.transitionIntervalSeconds || 8) * 1000;
    console.log(`Starting slideshow with ${interval}ms interval`);
    
    transitionTimer = setInterval(() => {
        if (!transitionInProgress) {
            nextMedia();
        }
    }, interval);
}

// Handle control interactions
document.addEventListener('click', function(e) {
    if (e.target.closest('#prev-button')) {
        e.preventDefault();
        if (mediaList && mediaList.length > 1) {
            currentMediaIndex = currentMediaIndex > 0 ? currentMediaIndex - 1 : mediaList.length - 1;
            showMedia(currentMediaIndex);
        }
    } else if (e.target.closest('#next-button')) {
        e.preventDefault();
        if (mediaList && mediaList.length > 1) {
            nextMedia();
        }
    } else if (e.target.closest('#pause-button')) {
        e.preventDefault();
        if (transitionTimer) {
            clearInterval(transitionTimer);
            transitionTimer = null;
            console.log('Slideshow paused');
        } else {
            startSlideshow();
            console.log('Slideshow resumed');
        }
    }
});

// Initialize clock widget
function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    const hoursEl = document.getElementById('time-hours');
    const minutesEl = document.getElementById('time-minutes');
    
    if (hoursEl) hoursEl.textContent = hours;
    if (minutesEl) minutesEl.textContent = minutes;
}

// Update clock every second
setInterval(updateClock, 1000);
updateClock(); // Initial call

console.log('Promo site script loaded successfully');
