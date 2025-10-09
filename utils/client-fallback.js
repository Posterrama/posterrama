/**
 * Decide a fallback media source when the saved source yields no items or is disabled.
 * Preference order:
 * 1) If savedSource exists and is still enabled -> keep it
 * 2) If 'local' is enabled -> choose 'local'
 * 3) Else choose the first enabled server's type (lowercased)
 * 4) If no enabled servers -> return null
 *
 * @param {Object} params
 * @param {string|undefined|null} params.savedSource - persisted selected source (e.g., 'plex', 'jellyfin', 'local')
 * @param {Array<{type:string, enabled?:boolean}>} params.enabledServers - list of enabled server entries
 * @returns {string|null} the fallback source type to use, or null if no suitable fallback
 */
function decideFallbackSource({ savedSource, enabledServers }) {
    const norm = s => (typeof s === 'string' ? s.toLowerCase() : s);
    const enabled = Array.isArray(enabledServers)
        ? enabledServers.filter(s => s && s.enabled !== false)
        : [];

    if (savedSource) {
        const keep = enabled.some(s => norm(s.type) === norm(savedSource));
        if (keep) return norm(savedSource);
    }

    const hasLocal = enabled.find(s => norm(s.type) === 'local');
    if (hasLocal) return 'local';

    if (enabled.length > 0) return norm(enabled[0].type);

    return null;
}

module.exports = { decideFallbackSource };
