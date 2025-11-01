/**
 * Utility Helper Functions
 *
 * Small, self-contained utility functions:
 * - sseDbg() - Debug logging for SSE/device events
 * - getLocalIPAddress() - Get first non-internal IPv4 address
 * - getAvatarPath() - Lookup user avatar file path
 * - isDeviceMgmtEnabled() - Check device management feature flag
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Dev debug helper for SSE/device events
 * Only logs when DEBUG_DEVICE_SSE=true
 * @param {...any} args - Arguments to log
 */
function sseDbg(...args) {
    try {
        if (process.env.DEBUG_DEVICE_SSE !== 'true') return;
        logger.debug('[SSE]', ...args);
    } catch (_) {
        /* ignore */
    }
}

/**
 * Get the first non-internal IPv4 address from network interfaces
 * @returns {string} IP address or 'localhost' as fallback
 */
function getLocalIPAddress() {
    const os = require('os');
    const interfaces = os.networkInterfaces();

    // Look for the first non-internal IPv4 address
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over internal (i.e., 127.0.0.1) and IPv6 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }

    // Fallback to localhost if no external IP found
    return 'localhost';
}

/**
 * Get the avatar file path for a username
 * Checks for .png, .webp, .jpg, .jpeg extensions
 * @param {string} username - Username to lookup avatar for
 * @param {string} avatarDir - Directory containing avatars
 * @returns {string|null} Full path to avatar file, or null if not found
 */
function getAvatarPath(username, avatarDir) {
    const base = (username || 'admin').replace(/[^a-z0-9_-]+/gi, '_');
    const exts = ['.png', '.webp', '.jpg', '.jpeg'];
    for (const ext of exts) {
        const p = path.join(avatarDir, base + ext);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * Check if device management feature is enabled
 * Checks both config.json and environment variables
 * @param {string} rootDir - Application root directory
 * @returns {boolean} True if device management is enabled
 */
function isDeviceMgmtEnabled(rootDir) {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(rootDir, 'config.json'), 'utf8'));
        if (cfg && cfg.deviceMgmt && cfg.deviceMgmt.enabled) return true;
    } catch (_) {
        // ignore missing or invalid config.json
    }
    return process.env.DEVICE_MGMT_ENABLED === '1' || process.env.DEVICE_MGMT_ENABLED === 'true';
}

module.exports = {
    sseDbg,
    getLocalIPAddress,
    getAvatarPath,
    isDeviceMgmtEnabled,
};
