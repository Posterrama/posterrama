// Pure computation helpers extracted from admin.js updateOverviewCards logic for unit testing.
// This file intentionally has no DOM dependencies.

function computeSourceStatus({ type, sourceCfg = {}, env = {} }) {
    const enabled = !!sourceCfg.enabled;
    let configured = false;
    if (type === 'plex') {
        const hostVar = sourceCfg.hostnameEnvVar || 'PLEX_HOSTNAME';
        const portVar = sourceCfg.portEnvVar || 'PLEX_PORT';
        const tokenVar = sourceCfg.tokenEnvVar || 'PLEX_TOKEN';
        const host = env[hostVar];
        const port = env[portVar];
        const tokenVal = env[tokenVar];
        configured = !!(host && port && tokenVal);
    } else if (type === 'jellyfin') {
        const hostVar = sourceCfg.hostnameEnvVar || 'JELLYFIN_HOSTNAME';
        const portVar = sourceCfg.portEnvVar || 'JELLYFIN_PORT';
        const keyVar = sourceCfg.tokenEnvVar || 'JELLYFIN_API_KEY';
        const host = env[hostVar];
        const port = env[portVar];
        const keyVal = env[keyVar];
        configured = !!(host && port && keyVal);
    } else if (type === 'tmdb') {
        const apiVar = sourceCfg.apiKeyEnvVar || 'TMDB_API_KEY';
        const apiKey = env[apiVar];
        configured = !!apiKey;
    }
    return {
        type,
        enabled,
        configured,
        pillText: !enabled ? 'Disabled' : configured ? 'Configured' : 'Not configured',
    };
}

function computeOverviewStatuses(cfg = {}, env = {}) {
    const mediaServers = Array.isArray(cfg.mediaServers) ? cfg.mediaServers : [];
    const plex = mediaServers.find(s => s?.type === 'plex') || {};
    const jf = mediaServers.find(s => s?.type === 'jellyfin') || {};
    const tmdb = cfg?.tmdbSource || {};
    return {
        plex: computeSourceStatus({ type: 'plex', sourceCfg: plex, env }),
        jellyfin: computeSourceStatus({ type: 'jellyfin', sourceCfg: jf, env }),
        tmdb: computeSourceStatus({ type: 'tmdb', sourceCfg: tmdb, env }),
    };
}

module.exports = { computeSourceStatus, computeOverviewStatuses };

// Optional browser global (non-breaking) to allow re-use inside admin UI without additional bundling.
try {
    if (typeof window !== 'undefined') {
        window.__adminOverviewCompute = {
            computeSourceStatus,
            computeOverviewStatuses,
        };
    }
} catch (_) {}
