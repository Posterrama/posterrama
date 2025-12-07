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
