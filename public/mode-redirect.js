/**
 * Mode Redirect Module
 *
 * Handles automatic redirection to the correct display mode (screensaver, wallart, cinema)
 * based on server configuration. Skips redirect in preview mode or when already on correct page.
 */

/**
 * Check if we're in preview mode (iframe, ?preview=1, or IS_PREVIEW flag)
 */
export function isPreviewMode() {
    const params = new URLSearchParams(window.location.search);
    return (
        params.get('preview') === '1' || window.self !== window.top || window.IS_PREVIEW === true
    );
}

/**
 * Check if we're already on a mode-specific page
 */
export function isOnModePage() {
    const path = window.location.pathname;
    return path.includes('/cinema') || path.includes('/wallart') || path.includes('/screensaver');
}

/**
 * Build URL for a specific mode using PosterramaCore or fallback
 */
export function buildModeUrl(mode) {
    if (window.PosterramaCore && window.PosterramaCore.buildUrlForMode) {
        return window.PosterramaCore.buildUrlForMode(mode);
    }

    // Fallback: manual URL construction
    const base = (function (p) {
        p = (p || '/').replace(/\/+/, '/');
        p = p.replace(/\/+/g, '/');
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        p = p.replace(/[^/]+$/, '/');
        return p;
    })(window.location.pathname);

    return new URL(base + mode, window.location.origin).toString();
}

/**
 * Fetch current configuration from server
 */
export async function fetchConfig() {
    const response = await fetch('/get-config', { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`Config fetch failed: ${response.status}`);
    }
    return response.json();
}

/**
 * Get the active mode from configuration
 */
export function getActiveMode(config) {
    if (config.cinemaMode === true) {
        return 'cinema';
    }
    if (config.wallartMode && config.wallartMode.enabled === true) {
        return 'wallart';
    }
    return 'screensaver';
}

/**
 * Main redirect logic for mode-specific pages
 *
 * @param {string} currentMode - The mode this page expects ('wallart', 'cinema', 'screensaver')
 * @param {string} [verifiedFlag] - Global flag to set when mode is verified (e.g., '__wallartModeVerified')
 */
export async function checkModeRedirect(currentMode, verifiedFlag) {
    window.debugLog &&
        window.debugLog('MODE_REDIRECT_CHECK', { currentMode, isPreview: isPreviewMode() });

    // Skip redirect if in preview mode, server hints a mode, or already on a mode page
    if (isPreviewMode() || window.MODE_HINT || isOnModePage()) {
        window.debugLog &&
            window.debugLog('MODE_REDIRECT_SKIP', {
                reason: 'already on mode page',
                isPreview: isPreviewMode(),
                modeHint: window.MODE_HINT,
            });

        // Mark as verified to prevent auto-exit poll from reloading
        if (verifiedFlag) {
            window[verifiedFlag] = true;
        }
        return;
    }

    try {
        window.debugLog && window.debugLog('MODE_REDIRECT_FETCH_CONFIG', {});

        const config = await fetchConfig();
        const activeMode = getActiveMode(config);

        window.debugLog &&
            window.debugLog('MODE_REDIRECT_CONFIG_LOADED', {
                activeMode,
                currentMode,
                cinemaMode: config.cinemaMode,
                wallartEnabled: config.wallartMode?.enabled,
            });

        // If active mode doesn't match current page, redirect
        if (activeMode !== currentMode) {
            window.debugLog && window.debugLog('MODE_REDIRECT_TO', { targetMode: activeMode });
            console.log(
                `[Posterrama] ${activeMode} mode detected, redirecting from ${currentMode}`
            );
            window.location.replace(buildModeUrl(activeMode));
            return;
        }

        // Mode matches, mark as verified and add body class
        window.debugLog && window.debugLog('MODE_REDIRECT_VERIFIED', { currentMode });
        console.log(`[Posterrama] ${currentMode} mode verified`);
        document.body.classList.add(`${currentMode}-mode`);

        if (verifiedFlag) {
            window[verifiedFlag] = true;
        }
    } catch (err) {
        // Failed to check config, allow page to continue
        window.debugLog &&
            window.debugLog('MODE_REDIRECT_ERROR', { error: err.message, currentMode });
        console.warn(`[Posterrama] Failed to check mode config for ${currentMode}`, err);

        if (verifiedFlag) {
            window[verifiedFlag] = true;
        }
    }
}

/**
 * Load promo overlay if enabled (typically port 4001 promo site)
 */
export async function loadPromoOverlayIfEnabled() {
    try {
        const cfg = await fetchConfig();
        if (cfg && cfg.promoBoxEnabled === true && window.PosterramaCore) {
            window.PosterramaCore.loadPromoOverlay(cfg);
        }
    } catch (e) {
        // Silently ignore promo overlay errors
    }
}
