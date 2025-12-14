/**
 * Display Mode Initialization Module
 *
 * Common initialization logic for display modes (cinema, wallart, screensaver)
 */

/**
 * Initialize device management for a display mode
 * Returns a promise that resolves when device setup is complete
 * (including setup overlay if shown)
 */
export async function initDevice() {
    try {
        if (window.PosterramaDevice && window.PosterramaDevice.init) {
            const cfg = await window.PosterramaCore.fetchConfig();
            await window.PosterramaDevice.init(cfg || {}); // Await so setup overlay completes first
        }
    } catch (e) {
        console.warn('[Display Mode] Device init failed:', e);
    }
}

/**
 * Start auto-exit polling (checks if mode should switch)
 */
export function startAutoExitPoll(currentMode, intervalMs = 15000) {
    try {
        if (window.PosterramaCore && window.PosterramaCore.startAutoExitPoll) {
            window.PosterramaCore.startAutoExitPoll({ currentMode, intervalMs });
        }
    } catch (e) {
        console.warn('[Display Mode] Auto-exit poll failed:', e);
    }
}

/**
 * Initialize burn-in prevention for OLED/Plasma displays
 * Dynamically loads the burn-in prevention module only when enabled
 * @param {object} config - Application config object (or will fetch if not provided)
 */
export async function initBurnInPrevention(config) {
    try {
        // Get config if not provided
        const cfg = config || window.appConfig || (await window.PosterramaCore?.fetchConfig());
        const burnInConfig = cfg?.burnInPrevention;

        // Skip if not enabled
        if (!burnInConfig?.enabled) {
            return;
        }

        // Check if already loaded
        if (window.PosterramaBurnInPrevention) {
            window.PosterramaBurnInPrevention.init(burnInConfig);
            return;
        }

        // Dynamically load the burn-in prevention script
        const script = document.createElement('script');
        script.src = '/burn-in-prevention.js?v=' + Date.now();
        script.async = true;

        script.onload = () => {
            try {
                if (window.PosterramaBurnInPrevention) {
                    window.PosterramaBurnInPrevention.init(burnInConfig);
                    console.log('[Display Mode] Burn-in prevention initialized');
                }
            } catch (e) {
                console.warn('[Display Mode] Burn-in prevention init failed:', e);
            }
        };

        script.onerror = () => {
            console.warn('[Display Mode] Failed to load burn-in prevention module');
        };

        document.head.appendChild(script);
    } catch (e) {
        console.warn('[Display Mode] Burn-in prevention setup failed:', e);
    }
}
