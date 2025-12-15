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

        const safeUnlink = filePath => {
            try {
                if (!filePath.startsWith(root + path.sep)) return;
                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    fs.unlinkSync(filePath);
                }
            } catch (_) {
                // ignore unlink failures
            }
        };

        const safeRimrafDirContents = dirPath => {
            try {
                if (!dirPath.startsWith(root + path.sep)) return;
                if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;
                const entries = fs.readdirSync(dirPath);
                for (const name of entries) {
                    const full = path.join(dirPath, name);
                    try {
                        const st = fs.statSync(full);
                        if (st.isDirectory()) {
                            safeRimrafDirContents(full);
                            fs.rmdirSync(full);
                        } else {
                            safeUnlink(full);
                        }
                    } catch (_) {
                        // ignore per-entry failures
                    }
                }
            } catch (_) {
                // ignore cleanup errors
            }
        };

        const entries = fs.readdirSync(root);
        for (const name of entries) {
            // Clean up device test files
            if (name.startsWith('devices.test.') && name.endsWith('.json')) {
                safeUnlink(path.join(root, name));
            }
            // Clean up legacy test artifacts
            if (name.endsWith('.groups.test.json')) {
                safeUnlink(path.join(root, name));
            }
            if (name.startsWith('devices.test.') && name.endsWith('.json.backup')) {
                safeUnlink(path.join(root, name));
            }
            if (name.startsWith('devices.broadcast.') && name.endsWith('.json.backup')) {
                safeUnlink(path.join(root, name));
            }
            if (name.endsWith('.test.json.backup') || name.endsWith('.test.backup')) {
                safeUnlink(path.join(root, name));
            }
            if (name === '.env.backup') {
                safeUnlink(path.join(root, name));
            }
            // Clean up device broadcast test files
            if (name.startsWith('devices.broadcast.') && name.endsWith('.json')) {
                safeUnlink(path.join(root, name));
            }
        }

        // Clean up runtime artifacts generated during Jest runs
        // NOTE: Never wipe the live `sessions/` directory; the app may be running from this workspace.
        safeRimrafDirContents(path.join(root, 'sessions-test'));
        safeRimrafDirContents(path.join(root, 'image_cache'));
        safeRimrafDirContents(path.join(root, 'logs'));
    } catch (_) {
        // ignore cleanup errors
    }
};
