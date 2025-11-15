/**
 * CSS Loading Optimization
 *
 * Simple script to defer non-critical CSS loading for improved FCP.
 * Loads main CSS after critical rendering path is complete.
 */

(function () {
    'use strict';

    /**
     * Check if CSS file should be deferred
     * @param {HTMLLinkElement} link - Link element to check
     * @returns {boolean} True if should be deferred
     */
    function shouldDefer(link) {
        return (
            link.rel === 'stylesheet' && link.media === 'print' && link.hasAttribute('data-onload')
        );
    }

    /**
     * Initialize deferred CSS loading
     */
    function init() {
        // Load deferred stylesheets after page load
        if (document.readyState === 'complete') {
            activateDeferredCSS();
        } else {
            window.addEventListener('load', activateDeferredCSS);
        }
    }

    /**
     * Activate all deferred stylesheets
     */
    function activateDeferredCSS() {
        const deferredLinks = document.querySelectorAll('link[rel="stylesheet"][media="print"]');

        deferredLinks.forEach(link => {
            if (shouldDefer(link)) {
                link.media = 'all';
                link.removeAttribute('data-onload');
            }
        });
    }

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
