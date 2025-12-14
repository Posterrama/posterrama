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
 * Get device identification headers for config requests
 * Uses PosterramaDevice if available, otherwise falls back to localStorage
 */
function getDeviceHeaders() {
    const headers = {};

    // Try PosterramaDevice first (most accurate)
    if (window.PosterramaDevice && typeof window.PosterramaDevice.getState === 'function') {
        const devState = window.PosterramaDevice.getState();
        if (devState.deviceId) headers['X-Device-Id'] = devState.deviceId;
        if (devState.installId) headers['X-Install-Id'] = devState.installId;
        if (devState.hardwareId) headers['X-Hardware-Id'] = devState.hardwareId;
    }

    // Fallback to localStorage for installId if not set
    if (!headers['X-Install-Id']) {
        try {
            const stored = localStorage.getItem('posterrama.installId');
            if (stored) headers['X-Install-Id'] = stored;
        } catch (_) {
            // localStorage not available
        }
    }

    // Fallback to localStorage for hardwareId if not set
    if (!headers['X-Hardware-Id']) {
        try {
            const stored = localStorage.getItem('posterrama.hardwareId');
            if (stored) headers['X-Hardware-Id'] = stored;
        } catch (_) {
            // localStorage not available
        }
    }

    return headers;
}

/**
 * Fetch current configuration from server
 * Includes device identification headers for profile-based config
 */
export async function fetchConfig() {
    const headers = getDeviceHeaders();
    // Add cache-busting query parameter
    const url = `/get-config?_t=${Date.now()}`;
    const response = await fetch(url, {
        cache: 'no-store',
        headers,
    });
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
    console.log('[MODE-REDIRECT] Starting check', {
        currentMode,
        verifiedFlag,
        isPreview: isPreviewMode(),
        MODE_HINT: window.MODE_HINT,
        pathname: window.location.pathname,
    });

    window.debugLog &&
        window.debugLog('MODE_REDIRECT_CHECK', { currentMode, isPreview: isPreviewMode() });

    // Skip redirect only if in preview mode or server explicitly hints a mode
    if (isPreviewMode() || window.MODE_HINT) {
        console.log('[MODE-REDIRECT] Skipping redirect', {
            reason: isPreviewMode() ? 'preview mode' : 'mode hint',
            isPreview: isPreviewMode(),
            modeHint: window.MODE_HINT,
        });

        window.debugLog &&
            window.debugLog('MODE_REDIRECT_SKIP', {
                reason: isPreviewMode() ? 'preview mode' : 'mode hint',
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
        console.log('[MODE-REDIRECT] Fetching config...');
        window.debugLog && window.debugLog('MODE_REDIRECT_FETCH_CONFIG', {});

        const config = await fetchConfig();
        const activeMode = getActiveMode(config);

        console.log('[MODE-REDIRECT] Config loaded', {
            activeMode,
            currentMode,
            cinemaMode: config.cinemaMode,
            wallartEnabled: config.wallartMode?.enabled,
            needsRedirect: activeMode !== currentMode,
        });

        window.debugLog &&
            window.debugLog('MODE_REDIRECT_CONFIG_LOADED', {
                activeMode,
                currentMode,
                cinemaMode: config.cinemaMode,
                wallartEnabled: config.wallartMode?.enabled,
            });

        // If active mode doesn't match current page, redirect
        if (activeMode !== currentMode) {
            const targetUrl = buildModeUrl(activeMode);
            console.log('[MODE-REDIRECT] REDIRECTING!', {
                from: currentMode,
                to: activeMode,
                targetUrl,
            });

            window.debugLog && window.debugLog('MODE_REDIRECT_TO', { targetMode: activeMode });
            console.log(
                `[Posterrama] ${activeMode} mode detected, redirecting from ${currentMode}`
            );
            window.location.replace(targetUrl);
            return;
        }

        // Mode matches, mark as verified and add body class
        console.log('[MODE-REDIRECT] Mode verified - staying on page', { currentMode });
        window.debugLog && window.debugLog('MODE_REDIRECT_VERIFIED', { currentMode });
        console.log(`[Posterrama] ${currentMode} mode verified`);
        document.body.classList.add(`${currentMode}-mode`);

        if (verifiedFlag) {
            window[verifiedFlag] = true;
        }
    } catch (err) {
        // Failed to check config, allow page to continue
        console.error('[MODE-REDIRECT] Error checking mode', {
            error: err.message,
            stack: err.stack,
        });

        window.debugLog &&
            window.debugLog('MODE_REDIRECT_ERROR', { error: err.message, currentMode });
        console.warn(`[Posterrama] Failed to check mode config for ${currentMode}`, err);

        if (verifiedFlag) {
            window[verifiedFlag] = true;
        }
    }
}

/**
 * Start periodic mode checking for non-device-management displays
 * Checks every 30 seconds if the active mode has changed and auto-navigates
 * @param {string} currentMode - The current mode (screensaver, wallart, cinema)
 */
export function startPeriodicModeCheck(currentMode) {
    // Only run on actual mode pages, not preview or landing
    if (!currentMode || isPreviewMode() || window.location.pathname === '/') {
        return;
    }

    const CHECK_INTERVAL = 30000; // 30 seconds
    const lastCheckedMode = currentMode;

    const checkMode = async () => {
        try {
            // Skip check if navigating away
            if (window.MODE_HINT !== currentMode && window.MODE_HINT) {
                console.log('[MODE-REDIRECT] Skipping periodic check - already navigating');
                return;
            }

            const config = await fetchConfig();
            const activeMode = getActiveMode(config);

            if (activeMode !== lastCheckedMode) {
                console.log('[MODE-REDIRECT] Periodic check detected mode change', {
                    from: lastCheckedMode,
                    to: activeMode,
                });

                // Navigate to new mode
                const targetUrl = buildModeUrl(activeMode);
                console.log('[MODE-REDIRECT] Auto-navigating to new mode', { targetUrl });
                window.location.replace(targetUrl);
            }
        } catch (err) {
            console.warn('[MODE-REDIRECT] Periodic mode check failed', err.message);
        }
    };

    // Start periodic checking
    const intervalId = setInterval(checkMode, CHECK_INTERVAL);
    console.log('[MODE-REDIRECT] Started periodic mode checking', {
        currentMode,
        intervalSeconds: CHECK_INTERVAL / 1000,
    });

    // Store interval ID for cleanup if needed
    window.__modeCheckIntervalId = intervalId;
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
