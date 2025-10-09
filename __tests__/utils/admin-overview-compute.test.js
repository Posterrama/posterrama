const {
    computeOverviewStatuses,
    computeSourceStatus,
} = require('../../public/admin-overview-compute');

describe('admin-overview-compute', () => {
    test('computeSourceStatus plex configured + enabled', () => {
        const out = computeSourceStatus({
            type: 'plex',
            sourceCfg: { enabled: true, hostname: 'host', port: 32400 },
            env: { PLEX_TOKEN: 'abc' },
        });
        expect(out).toMatchObject({ enabled: true, configured: true, pillText: 'Configured' });
    });

    test('computeSourceStatus plex enabled but not configured (missing token)', () => {
        const out = computeSourceStatus({
            type: 'plex',
            sourceCfg: { enabled: true, hostname: 'host', port: 32400 },
            env: {},
        });
        expect(out).toMatchObject({ enabled: true, configured: false, pillText: 'Not configured' });
    });

    test('computeSourceStatus jellyfin disabled overrides configured state', () => {
        const out = computeSourceStatus({
            type: 'jellyfin',
            sourceCfg: { enabled: false, hostname: 'h', port: 8096 },
            env: { JELLYFIN_API_KEY: 'key' },
        });
        expect(out).toMatchObject({ enabled: false, configured: true, pillText: 'Disabled' });
    });

    test('handles malformed mediaServers entries gracefully', () => {
        const env = { PLEX_TOKEN: 't' };
        const r = computeOverviewStatuses(
            {
                mediaServers: [{ type: 'plex', enabled: true, hostname: 'h', port: 32400 }],
            },
            env
        );
        expect(r.plex.enabled).toBe(true);
        expect(r.plex.configured).toBe(true);
        expect(r.jellyfin.enabled).toBe(false); // not present
        expect(r.tmdb.enabled).toBe(false); // no tmdbSource
    });

    test('computeOverviewStatuses aggregate', () => {
        const cfg = {
            mediaServers: [
                { type: 'plex', enabled: true, hostname: 'h', port: 32400 },
                { type: 'jellyfin', enabled: true, hostname: 'h2', port: 8096 },
            ],
            tmdbSource: { enabled: true, apiKey: 'kt' },
        };
        const env = { PLEX_TOKEN: 't', JELLYFIN_API_KEY: 'k' };
        const out = computeOverviewStatuses(cfg, env);
        expect(out.plex.configured).toBe(true);
        expect(out.jellyfin.configured).toBe(true);
        expect(out.tmdb.configured).toBe(true);
    });

    test('custom env var names respected (plex)', () => {
        const out = computeSourceStatus({
            type: 'plex',
            sourceCfg: {
                enabled: true,
                hostname: 'x',
                port: 1,
                tokenEnvVar: 'P_TOKEN',
            },
            env: { P_TOKEN: 'zz' },
        });
        expect(out.configured).toBe(true);
    });

    test('tmdb not configured when key missing', () => {
        const out = computeSourceStatus({ type: 'tmdb', sourceCfg: { enabled: true }, env: {} });
        expect(out).toMatchObject({ enabled: true, configured: false, pillText: 'Not configured' });
    });

    test('tmdb disabled even with key', () => {
        const out = computeSourceStatus({
            type: 'tmdb',
            sourceCfg: { enabled: false },
            env: { TMDB_API_KEY: 'abc' },
        });
        expect(out).toMatchObject({ enabled: false, configured: true, pillText: 'Disabled' });
    });
});
