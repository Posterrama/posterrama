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
let refreshPromise = null; // Track active refresh promise for deduplication

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
    // If already refreshing, return the existing promise (deduplication)
    if (isRefreshing && refreshPromise) {
        logger.debug('Playlist refresh already in progress - returning existing promise');
        return refreshPromise;
    }

    // If flag is set but no promise exists, it's a stuck state - clear it
    if (isRefreshing && !refreshPromise) {
        logger.warn('Detected stuck refresh state (flag set but no promise) - clearing', {
            action: 'clear_stuck_state',
            stuckDuration: refreshStartTime ? `${Date.now() - refreshStartTime}ms` : 'unknown',
        });
        isRefreshing = false;
        refreshStartTime = null;
    }

    const startTime = process.hrtime();
    isRefreshing = true;
    refreshStartTime = Date.now();

    logger.info('Starting playlist refresh', {
        action: 'playlist_refresh_start',
        timestamp: new Date().toISOString(),
    });

    // Create the refresh promise that others can wait for
    refreshPromise = (async () => {
        try {
            // Track memory usage before fetch
            const memBefore = process.memoryUsage();

            const result = await getPlaylistMediaWrapper();

            // Handle new format: {media: Array, errors: Array}
            let allMedia = Array.isArray(result) ? result : result.media || [];
            const aggregationErrors = Array.isArray(result) ? [] : result.errors || [];

            // Log any aggregation errors
            if (aggregationErrors.length > 0) {
                logger.warn(
                    `Playlist refresh completed with ${aggregationErrors.length} source error(s)`,
                    {
                        action: 'playlist_refresh_partial_failure',
                        errors: aggregationErrors.map(e => `${e.source}: ${e.message}`),
                    }
                );
            }

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
            throw error; // Propagate error to waiters
        } finally {
            // Always reset state, no matter what
            isRefreshing = false;
            refreshStartTime = null;
            refreshPromise = null;
        }
    })();

    // Wait for the refresh to complete before returning
    try {
        await refreshPromise;
    } catch (error) {
        // Error already logged above, just ensure promise is cleared
        refreshPromise = null;
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
 * This also clears the refresh promise to prevent waiters from hanging.
 */
function resetRefreshState() {
    logger.warn('Manual refresh state reset triggered', {
        action: 'manual_reset_refresh_state',
        wasRefreshing: isRefreshing,
        hadPromise: !!refreshPromise,
    });
    isRefreshing = false;
    refreshStartTime = null;
    refreshPromise = null;
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
