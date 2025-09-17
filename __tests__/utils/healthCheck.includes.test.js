/**
 * Intent: Validate inclusion/exclusion of optional health checks via DASHBOARD_INCLUDE_* env vars.
 * Strategy: Force NODE_ENV=development to bypass test env gating; mock network via fetch.
 */

function loadHealth() {
    jest.resetModules();
    return require('../../utils/healthCheck');
}

describe('healthCheck optional includes', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        process.env.NODE_ENV = 'development';
        global.fetch = jest.fn(() =>
            Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
        );
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    test.each([
        ['TMDB', { DASHBOARD_INCLUDE_TMDB: 'true' }, 'tmdb_connectivity'],
        ['TVDB', { DASHBOARD_INCLUDE_TVDB: 'true' }, 'tvdb_connectivity'],
        ['Update', { DASHBOARD_INCLUDE_UPDATE_CHECK: 'true' }, 'update_available'],
        ['CacheEfficiency', { DASHBOARD_INCLUDE_CACHE_EFFICIENCY: 'true' }, 'cache_efficiency'],
        ['Performance', { DASHBOARD_INCLUDE_PERF_CHECK: 'true' }, 'performance'],
        ['DeviceSLA', { DASHBOARD_INCLUDE_DEVICE_SLA: 'true' }, 'device_sla'],
        ['Jellyfin disabled', { DASHBOARD_INCLUDE_JELLYFIN: 'false' }, 'jellyfin_connectivity'],
    ])('%s toggle', async (_label, envPatch, expectedName) => {
        Object.assign(process.env, envPatch);
        const health = loadHealth();
        if (envPatch.DASHBOARD_INCLUDE_UPDATE_CHECK === 'true') {
            health.__setGitHubService({
                checkForUpdates: jest.fn().mockResolvedValue({
                    updateAvailable: true,
                    currentVersion: '1.0.0',
                    latestVersion: '2.0.0',
                    releaseUrl: 'http://example',
                    publishedAt: new Date().toISOString(),
                }),
            });
        }
        health.__resetCache();
        const res = await health.getDetailedHealth();
        const names = res.checks.map(c => c.name);
        if (envPatch.DASHBOARD_INCLUDE_JELLYFIN === 'false') {
            expect(names).not.toContain(expectedName);
        } else {
            expect(names).toContain(expectedName);
        }
    });
});
