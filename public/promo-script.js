/**
 * Promo Site Script - Forces Screensaver Mode
 * This script ensures the promo site ALWAYS runs in screensaver mode
 */

// Store the promo box elements before we start screensaver
let promoBox;
let promoStartTime;

// Override config to force screensaver mode
window.FORCE_PROMO_SCREENSAVER = true;

// Override API URLs to point to main app on port 4000
const API_BASE_URL = 'http://localhost:4000';

document.addEventListener('DOMContentLoaded', function() {
    promoBox = document.getElementById('promo-box');
    promoStartTime = Date.now();
    
    // Show promo box for 5 seconds, then start screensaver
    setTimeout(() => {
        startPromoScreensaver();
    }, 5000);
    
    // Load the main script after we've set up our overrides
    loadMainScript();
});

function startPromoScreensaver() {
    if (promoBox) {
        promoBox.classList.add('is-hidden');
    }
    
    // Force screensaver mode
    document.body.classList.add('promo-screensaver-mode');
    document.body.classList.add('screensaver-mode');
    
    // Show the poster elements
    const infoContainer = document.getElementById('info-container');
    const posterWrapper = document.getElementById('poster-wrapper');
    const controlsContainer = document.getElementById('controls-container');
    const brandingContainer = document.getElementById('branding-container');
    
    if (infoContainer) infoContainer.style.display = 'block';
    if (posterWrapper) posterWrapper.style.display = 'block';
    if (controlsContainer) controlsContainer.style.display = 'block';
    if (brandingContainer) brandingContainer.style.display = 'block';
    
    // Initialize the app with forced screensaver config
    if (window.initializeApp) {
        // Override config before initialization
        window.CONFIG_OVERRIDE = {
            DISPLAY_MODE: 'screensaver',
            AUTO_TRANSITION: true,
            SCREENSAVER_ENABLED: true,
            PROMO_BOX_ENABLED: false,
            // Force poster visibility and auto transition
            showPoster: true,
            autoTransition: true,
            transitionInterval: 10000, // 10 seconds between posters
            transitionDuration: 1000 // 1 second fade
        };
        
        window.initializeApp();
    }
}

function loadMainScript() {
    const script = document.createElement('script');
    script.src = 'script.js?v=20250819a';
    script.onload = function() {
        console.log('Main script loaded for promo screensaver');
    };
    document.head.appendChild(script);
}

// Override fetch function to redirect API calls to main app
const originalFetch = window.fetch;
window.fetch = function(url, options) {
    // If it's an API call, redirect to main app on port 4000
    if (typeof url === 'string' && (
        url.startsWith('/') && (
            url.includes('media') ||
            url.includes('config') ||
            url.includes('api') ||
            url.includes('get-')
        )
    )) {
        console.log(`Redirecting API call from ${url} to ${API_BASE_URL}${url}`);
        url = `${API_BASE_URL}${url}`;
    }
    
    return originalFetch.call(this, url, options);
};

// Prevent any mode switching on promo site
window.addEventListener('load', function() {
    // Override any mode switching functions
    if (window.switchToMode) {
        window.switchToMode = function(mode) {
            console.log('Mode switching disabled on promo site - staying in screensaver mode');
            return;
        };
    }
    
    // Override display mode setters
    if (window.setDisplayMode) {
        window.setDisplayMode = function(mode) {
            console.log('Display mode setting disabled on promo site - staying in screensaver mode');
            return;
        };
    }
});
