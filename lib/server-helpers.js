/**
 * Server lifecycle helper functions
 * Extracted from server.js (Issue #84)
 */

/**
 * Cleanup function for proper server shutdown and test cleanup
 * Clears all global intervals, source instances, and manager cleanup
 * @param {Object} options - Cleanup dependencies
 * @param {Object} options.logger - Logger instance
 * @param {Object} options.cacheManager - Cache manager instance
 * @param {Object} options.cacheDiskManager - Disk cache manager instance
 * @param {Object} options.metricsManager - Metrics manager instance
 */
function cleanup({ logger, cacheManager, cacheDiskManager, metricsManager }) {
    logger.info('Cleaning up server resources...');

    // Clear global intervals
    if (global.memoryCheckInterval) {
        clearInterval(global.memoryCheckInterval);
    }
    // Always normalize to null so tests can assert strict null
    global.memoryCheckInterval = null;

    if (global.tmdbCacheCleanupInterval) {
        clearInterval(global.tmdbCacheCleanupInterval);
        global.tmdbCacheCleanupInterval = null;
    }

    if (global.playlistRefreshInterval) {
        clearInterval(global.playlistRefreshInterval);
        global.playlistRefreshInterval = null;
    }

    if (global.cacheCleanupInterval) {
        clearInterval(global.cacheCleanupInterval);
        global.cacheCleanupInterval = null;
    }

    // Cleanup source instances
    if (global.tmdbSourceInstance && typeof global.tmdbSourceInstance.cleanup === 'function') {
        global.tmdbSourceInstance.cleanup();
        global.tmdbSourceInstance = null;
    }

    // Cleanup cache and auth managers
    if (cacheManager && typeof cacheManager.cleanup === 'function') {
        cacheManager.cleanup();
    }

    if (cacheDiskManager && typeof cacheDiskManager.cleanup === 'function') {
        cacheDiskManager.cleanup();
    }

    // Cleanup API cache middleware
    if (global.apiCacheInstance && typeof global.apiCacheInstance.destroy === 'function') {
        global.apiCacheInstance.destroy();
        global.apiCacheInstance = null;
    }

    // Cleanup metrics manager
    if (metricsManager && typeof metricsManager.shutdown === 'function') {
        metricsManager.shutdown();
    }

    logger.info('Server cleanup completed');
}

module.exports = {
    cleanup,
};
