/**
 * Tests for healthCheck dashboard include toggles
 */
// Load module fresh with controlled env and spies
function loadHealthCheck() {
    jest.resetModules();
    const mod = require('../../utils/healthCheck');
    return mod;
}

describe('healthCheck performHealthChecks env toggles', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        // Default to non-test env so toggles are honored
        process.env = { ...ORIGINAL_ENV, NODE_ENV: 'development' };
        jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
        jest.restoreAllMocks();
    });

    test('includes only explicitly enabled optional checks when off by default', async () => {
        // Defaults: PERF and JELLYFIN and DEVICE_SLA are included unless explicitly false in development
        process.env.DASHBOARD_INCLUDE_CACHE_EFFICIENCY = 'false';
        process.env.DASHBOARD_INCLUDE_PERF_CHECK = 'false';
        process.env.DASHBOARD_INCLUDE_UPDATE_CHECK = 'false';
        process.env.DASHBOARD_INCLUDE_DEVICE_SLA = 'false';
        process.env.DASHBOARD_INCLUDE_JELLYFIN = 'false';
        process.env.DASHBOARD_INCLUDE_TMDB = 'false';
        //

        const hc = loadHealthCheck();
        // Speed up cache and ensure fresh results
        hc.__setCacheDuration(0);
        hc.__resetCache();

        const res = await hc.__performHealthChecks();
        const names = res.checks.map(c => c.name);
        // Core checks always present
        expect(names).toEqual(
            expect.arrayContaining(['configuration', 'filesystem', 'cache', 'plex_connectivity'])
        );
        // Optional checks not present
        expect(names).not.toEqual(expect.arrayContaining(['device_sla']));
        expect(names).not.toEqual(expect.arrayContaining(['jellyfin_connectivity']));
        expect(names).not.toEqual(expect.arrayContaining(['tmdb_connectivity']));
        //
        expect(names).not.toEqual(expect.arrayContaining(['update_available']));
    });

    test('enables TMDB and Update when toggles true', async () => {
        process.env.DASHBOARD_INCLUDE_PERF_CHECK = 'false';
        process.env.DASHBOARD_INCLUDE_DEVICE_SLA = 'false';
        process.env.DASHBOARD_INCLUDE_JELLYFIN = 'false';
        process.env.DASHBOARD_INCLUDE_TMDB = 'true';
        //
        process.env.DASHBOARD_INCLUDE_UPDATE_CHECK = 'true';

        const hc = loadHealthCheck();
        hc.__setCacheDuration(0);
        hc.__resetCache();

        // Mock networked checks to avoid real calls and to be deterministic
        jest.spyOn(hc, 'checkTMDBConnectivity').mockResolvedValue({
            name: 'tmdb_connectivity',
            status: 'ok',
            message: 'TMDB reachable',
        });
        //
        jest.spyOn(hc, 'checkUpdateAvailability').mockResolvedValue({
            name: 'update_available',
            status: 'ok',
            message: 'Update check disabled',
        });
        // Also mock Jellyfin/Plex connectivity to be quick
        jest.spyOn(hc, 'checkJellyfinConnectivity').mockResolvedValue({
            name: 'jellyfin_connectivity',
            status: 'ok',
            message: 'Jellyfin reachable',
        });
        jest.spyOn(hc, 'checkPlexConnectivity').mockResolvedValue({
            name: 'plex_connectivity',
            status: 'ok',
            message: 'No Plex servers are configured.',
            details: { servers: [] },
        });

        const res = await hc.__performHealthChecks();
        const names = res.checks.map(c => c.name);

        expect(names).toEqual(
            expect.arrayContaining([
                'configuration',
                'filesystem',
                'cache',
                'plex_connectivity',
                'tmdb_connectivity',
                //
                'update_available',
            ])
        );
        // Optional ones we didn't enable remain absent
        expect(names).not.toEqual(expect.arrayContaining(['device_sla']));
        expect(names).not.toEqual(expect.arrayContaining(['jellyfin_connectivity']));
    });
});
