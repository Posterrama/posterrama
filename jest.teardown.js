/**
 * Jest global teardown for cleaning up server instances and cache
 */

// Global teardown function
module.exports = async () => {
    // Clean up any remaining timers
    if (global.cleanupTimers) {
        global.cleanupTimers();
    }

    // Force cleanup of any require cache to prevent memory leaks
    const cachePattern = /\/var\/www\/posterrama\/(server|utils|middleware|sources)/;
    Object.keys(require.cache).forEach(key => {
        if (cachePattern.test(key)) {
            delete require.cache[key];
        }
    });

    // Wait a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100));
};
