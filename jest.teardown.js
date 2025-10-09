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

    // Remove generated test files from test runs
    try {
        const fs = require('fs');
        const path = require('path');
        const root = path.join(__dirname);
        const entries = fs.readdirSync(root);
        for (const name of entries) {
            // Clean up device test files
            if (name.startsWith('devices.test.') && name.endsWith('.json')) {
                try {
                    fs.unlinkSync(path.join(root, name));
                } catch (_) {
                    // ignore unlink failures
                }
            }
            // Clean up groups test files
            if (name.endsWith('.groups.test.json')) {
                try {
                    fs.unlinkSync(path.join(root, name));
                } catch (_) {
                    // ignore unlink failures
                }
            }
        }
    } catch (_) {
        // ignore cleanup errors
    }
};
