/**
 * Source Utilities
 * Helper functions for media source management
 */

/**
 * Check if a specific source type is enabled in config
 * @param {Object} config - Application configuration
 * @param {string} sourceType - Source type to check (e.g., 'plex', 'jellyfin', 'tmdb')
 * @returns {boolean} True if the source type is enabled
 */
function isSourceTypeEnabled(config, sourceType) {
    if (!config.mediaServers) {
        return false;
    }

    const server = config.mediaServers.find(s => s.type === sourceType);
    return server && server.enabled === true;
}

module.exports = {
    isSourceTypeEnabled,
};
