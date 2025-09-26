const {
    computeOverviewStatuses,
    computeSourceStatus,
} = require('../../public/admin-overview-compute');

describe('admin-overview-compute', () => {
    test('computeSourceStatus plex configured + enabled', () => {
        const out = computeSourceStatus({
            type: 'plex',
            sourceCfg: { enabled: true },
            env: { PLEX_HOSTNAME: 'host', PLEX_PORT: '32400', PLEX_TOKEN: 'abc' },
        });
        expect(out).toMatchObject({ enabled: true, configured: true, pillText: 'Configured' });
    });

    test('computeSourceStatus plex enabled but not configured', () => {
        const out = computeSourceStatus({
            type: 'plex',
            sourceCfg: { enabled: true },
            env: { PLEX_HOSTNAME: 'host' },
        });
        expect(out).toMatchObject({ enabled: true, configured: false, pillText: 'Not configured' });
    });

    test('computeSourceStatus jellyfin disabled overrides configured state', () => {
        const out = computeSourceStatus({
            type: 'jellyfin',
            sourceCfg: { enabled: false },
            env: { JELLYFIN_HOSTNAME: 'h', JELLYFIN_PORT: '8096', JELLYFIN_API_KEY: 'key' },
        });
        expect(out).toMatchObject({ enabled: false, configured: true, pillText: 'Disabled' });
    });

    test('computeOverviewStatuses aggregate', () => {
        const cfg = {
            mediaServers: [
                { type: 'plex', enabled: true },
                { type: 'jellyfin', enabled: true },
            ],
            tmdbSource: { enabled: true },
        };
        const env = {
            PLEX_HOSTNAME: 'h',
            PLEX_PORT: '32400',
            PLEX_TOKEN: 't',
            JELLYFIN_HOSTNAME: 'h2',
            JELLYFIN_PORT: '8096',
            JELLYFIN_API_KEY: 'k',
            TMDB_API_KEY: 'kt',
        };
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
                hostnameEnvVar: 'P_HOST',
                portEnvVar: 'P_PORT',
                tokenEnvVar: 'P_TOKEN',
            },
            env: { P_HOST: 'x', P_PORT: '1', P_TOKEN: 'zz' },
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
