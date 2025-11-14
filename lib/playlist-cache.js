/**
 * Playlist Cache Management Module
 *
 * Manages in-memory playlist caching with automatic background refresh.
 * Provides locking mechanism to prevent concurrent refreshes and stuck state recovery.
 *
 * @module lib/playlist-cache
 */

const logger = require('../utils/logger');

// Module state
let playlistCache = null;
let cacheTimestamp = 0;
let isRefreshing = false;
let refreshStartTime = null;

// FIXED_LIMITS.TOTAL_CAP will be injected via refreshPlaylistCache parameters

/**
 * Refreshes the playlist cache with fresh media data from all sources.
 * Includes concurrency protection, stuck state recovery, and performance monitoring.
 *
 * @param {Object} options - Refresh options
 * @param {Function} options.getPlaylistMediaWrapper - Function that returns media from all sources
 * @param {Function} options.shuffleArray - Function to shuffle array in-place
 * @param {number} options.totalCap - Maximum number of items to keep in cache (FIXED_LIMITS.TOTAL_CAP)
 * @returns {Promise<void>} Resolves when refresh is complete (or skipped if already in progress)
 *
 * @example
 * await refreshPlaylistCache({
 *   getPlaylistMediaWrapper: async () => [...items],
 *   shuffleArray: (arr) => arr.sort(() => Math.random() - 0.5),
 *   totalCap: 5000
 * });
 */
async function refreshPlaylistCache({ getPlaylistMediaWrapper, shuffleArray, totalCap }) {
    if (isRefreshing) {
        // Check if the current refresh is stuck
        if (refreshStartTime && Date.now() - refreshStartTime > 20000) {
            logger.warn('Force-clearing stuck refresh state before starting new refresh', {
                action: 'force_clear_stuck_refresh',
                stuckDuration: `${Date.now() - refreshStartTime}ms`,
            });
            isRefreshing = false;
            refreshStartTime = null;
        } else {
            logger.debug('Playlist refresh skipped - already in progress');
            return;
        }
    }

    const startTime = process.hrtime();
    isRefreshing = true;
    refreshStartTime = Date.now(); // Track when refresh started

    // Add a safety timeout to prevent stuck refresh state
    const refreshTimeout = setTimeout(() => {
        logger.warn('Playlist refresh timeout - forcing reset of isRefreshing flag', {
            action: 'playlist_refresh_timeout',
            duration: '15000ms',
        });
        isRefreshing = false;
        refreshStartTime = null;
    }, 15000); // 15 second timeout (was 60)

    logger.info('Starting playlist refresh', {
        action: 'playlist_refresh_start',
        timestamp: new Date().toISOString(),
    });

    try {
        // Track memory usage before fetch
        const memBefore = process.memoryUsage();

        let allMedia = await getPlaylistMediaWrapper();
        // Apply global cap before shuffling to bound payload size
        if (allMedia.length > totalCap) {
            logger.debug(
                `[Limits] Applying global cap: trimming ${allMedia.length} -> ${totalCap}`
            );
            allMedia = allMedia.slice(0, totalCap);
        }
        playlistCache = shuffleArray(allMedia);
        cacheTimestamp = Date.now();

        // Track memory usage after fetch
        const memAfter = process.memoryUsage();
        const [seconds, nanoseconds] = process.hrtime(startTime);
        const duration = seconds * 1000 + nanoseconds / 1000000;

        // Calculate memory delta
        const heapDeltaMB = Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024);
        const rssDeltaMB = Math.round((memAfter.rss - memBefore.rss) / 1024 / 1024);

        // Log success with performance metrics
        logger.info('Playlist refresh completed', {
            action: 'playlist_refresh_complete',
            metrics: {
                duration: `${duration.toFixed(2)}ms`,
                itemCount: playlistCache.length,
                memoryDelta: {
                    heapUsed: `${heapDeltaMB}MB`,
                    rss: `${rssDeltaMB}MB`,
                },
            },
        });

        // Alert on excessive memory growth (>200MB heap delta)
        if (heapDeltaMB > 200) {
            logger.warn('Excessive memory growth during playlist refresh', {
                action: 'playlist_memory_alert',
                heapDeltaMB,
                rssDeltaMB,
                itemCount: playlistCache.length,
                avgBytesPerItem: Math.round((heapDeltaMB * 1024 * 1024) / playlistCache.length),
            });
        }

        // Log warning if refresh was slow
        if (duration > 5000) {
            // 5 seconds threshold
            logger.warn('Slow playlist refresh detected', {
                action: 'playlist_refresh_slow',
                duration: `${duration.toFixed(2)}ms`,
                itemCount: playlistCache.length,
            });
        }
    } catch (error) {
        logger.error('Playlist refresh failed', {
            action: 'playlist_refresh_error',
            error: error.message,
            stack: error.stack,
        });
        // We keep the old cache in case of an error
    } finally {
        clearTimeout(refreshTimeout);
        isRefreshing = false;
        refreshStartTime = null;
    }
}

/**
 * Schedules or reschedules background playlist refresh based on config.
 * Clears any existing interval before creating new one.
 *
 * @param {Object} options - Scheduling options
 * @param {number} options.intervalMinutes - Refresh interval in minutes (0 to disable)
 * @param {Function} options.refreshCallback - Function to call on each refresh cycle
 *
 * @example
 * schedulePlaylistBackgroundRefresh({
 *   intervalMinutes: 60,
 *   refreshCallback: () => refreshPlaylistCache({...})
 * });
 */
function schedulePlaylistBackgroundRefresh({ intervalMinutes, refreshCallback }) {
    try {
        const minutes = Number(intervalMinutes ?? 60);
        const intervalMs = Math.max(0, Math.round(minutes)) * 60 * 1000;

        // Clear any existing interval first
        if (global.playlistRefreshInterval) {
            try {
                clearInterval(global.playlistRefreshInterval);
            } catch (_) {
                /* ignore */
            }
            global.playlistRefreshInterval = null;
        }

        if (intervalMs > 0) {
            global.playlistRefreshInterval = setInterval(() => {
                try {
                    refreshCallback();
                } catch (_) {
                    /* fire-and-forget */
                }
            }, intervalMs);
            logger.debug(
                `Playlist background refresh scheduled every ${Math.round(minutes)} minutes.`
            );
        } else {
            logger.info('Playlist background refresh disabled (interval set to 0).');
        }
    } catch (e) {
        logger.warn('Failed to (re)schedule playlist background refresh', { error: e?.message });
    }
}

/**
 * Gets the current playlist cache and timestamp.
 * Returns null if cache hasn't been initialized yet.
 *
 * @returns {{cache: Array|null, timestamp: number}} Current cache and timestamp
 */
function getPlaylistCache() {
    return {
        cache: playlistCache,
        timestamp: cacheTimestamp,
    };
}

/**
 * Checks if a playlist refresh is currently in progress.
 *
 * @returns {boolean} True if refresh is in progress
 */
function isPlaylistRefreshing() {
    return isRefreshing;
}

/**
 * Clears the refresh interval (useful for shutdown or testing).
 */
function clearPlaylistRefreshInterval() {
    if (global.playlistRefreshInterval) {
        try {
            clearInterval(global.playlistRefreshInterval);
        } catch (_) {
            /* ignore */
        }
        global.playlistRefreshInterval = null;
    }
}

/**
 * Gets the refresh start time (for stuck state detection).
 * @returns {number|null} Timestamp when refresh started, or null if not refreshing
 */
function getRefreshStartTime() {
    return refreshStartTime;
}

/**
 * Resets the stuck refresh state (emergency recovery).
 * Use only when you're certain a refresh is actually stuck.
 */
function resetRefreshState() {
    isRefreshing = false;
    refreshStartTime = null;
}

/**
 * Clears the playlist cache (forces re-fetch on next request).
 * Use when configuration changes require fresh data.
 */
function clearPlaylistCache() {
    playlistCache = null;
    cacheTimestamp = 0;
}

module.exports = {
    refreshPlaylistCache,
    schedulePlaylistBackgroundRefresh,
    getPlaylistCache,
    isPlaylistRefreshing,
    clearPlaylistRefreshInterval,
    getRefreshStartTime,
    resetRefreshState,
    clearPlaylistCache,
};
