// Pure computation helpers extracted from admin.js updateOverviewCards logic for unit testing.
// This file intentionally has no DOM dependencies.

function computeSourceStatus({ type, sourceCfg = {}, env = {} }) {
    const enabled = !!sourceCfg.enabled;
    let configured = false;
    if (type === 'plex') {
        // Hostname/port now expected directly on sourceCfg (legacy *EnvVar removed). Token still comes from env var.
        const tokenVar = sourceCfg.tokenEnvVar || 'PLEX_TOKEN';
        const host = sourceCfg.hostname;
        const port = sourceCfg.port;
        const tokenVal = sourceCfg.token || env[tokenVar];
        configured = !!(host && port && tokenVal);
    } else if (type === 'jellyfin') {
        const keyVar = sourceCfg.tokenEnvVar || 'JELLYFIN_API_KEY';
        const host = sourceCfg.hostname;
        const port = sourceCfg.port;
        const keyVal = sourceCfg.apiKey || env[keyVar];
        configured = !!(host && port && keyVal);
    } else if (type === 'tmdb') {
        const apiVar = sourceCfg.apiKeyEnvVar || 'TMDB_API_KEY';
        const apiKey = sourceCfg.apiKey || env[apiVar];
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
} catch (_) {
    // Intentionally ignored: accessing window in non-browser environments will throw.
}
