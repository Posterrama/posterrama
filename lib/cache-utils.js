/**
 * Cache Configuration Utilities
 * Helper functions for cache configuration management
 */

const fs = require('fs');

/**
 * Get current cache configuration from disk and CacheDiskManager
 * Prefers live values from CacheDiskManager; falls back to loaded config.json defaults
 *
 * @param {Object} params - Parameters
 * @param {Object} params.config - Application configuration object
 * @param {Object} params.cacheDiskManager - Cache disk manager instance
 * @returns {Object} Cache configuration with maxSizeGB and minFreeDiskSpaceMB
 */
function getCacheConfig({ config, cacheDiskManager }) {
    try {
        // Read latest config from disk to support manual edits without restart
        let diskCfg = null;
        try {
            const raw = fs.readFileSync('./config.json', 'utf-8');
            diskCfg = JSON.parse(raw);
        } catch (_) {
            // ignore disk read errors; fall back to in-memory
            diskCfg = null;
        }

        const diskMaxGB = Number(diskCfg?.cache?.maxSizeGB ?? config?.cache?.maxSizeGB ?? 2);
        const diskMinMB = Number(
            diskCfg?.cache?.minFreeDiskSpaceMB ?? config?.cache?.minFreeDiskSpaceMB ?? 500
        );

        // If CacheDiskManager is out of sync with on-disk config, update it live
        const liveMaxGB = cacheDiskManager?.maxSizeBytes
            ? cacheDiskManager.maxSizeBytes / (1024 * 1024 * 1024)
            : null;
        if (
            liveMaxGB != null &&
            Number.isFinite(diskMaxGB) &&
            Math.abs(liveMaxGB - diskMaxGB) > 1e-9
        ) {
            try {
                cacheDiskManager.updateConfig(diskCfg?.cache || config?.cache || {});
            } catch (_) {
                /* ignore update errors */
            }
        }

        // Keep in-memory config close to disk to avoid stale reads
        try {
            if (diskCfg && typeof diskCfg === 'object') Object.assign(config, diskCfg);
        } catch (_) {
            /* ignore */
        }

        const maxSizeGB = cacheDiskManager?.maxSizeBytes
            ? cacheDiskManager.maxSizeBytes / (1024 * 1024 * 1024)
            : diskMaxGB;
        const minFreeDiskSpaceMB = cacheDiskManager?.minFreeDiskSpaceBytes
            ? Math.round(cacheDiskManager.minFreeDiskSpaceBytes / (1024 * 1024))
            : diskMinMB;
        return { maxSizeGB, minFreeDiskSpaceMB };
    } catch (_) {
        return {
            maxSizeGB: Number(config?.cache?.maxSizeGB ?? 2),
            minFreeDiskSpaceMB: Number(config?.cache?.minFreeDiskSpaceMB ?? 500),
        };
    }
}

module.exports = {
    getCacheConfig,
};
