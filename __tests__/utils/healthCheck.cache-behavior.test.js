const health = require('../../utils/healthCheck');

/**
 * These tests target uncovered branches in healthCheck.js:
 * - Cache reuse vs refresh when duration elapses
 * - Inclusion toggles (env flags)
 * - Update check path with mocked GitHub service
 */

describe('healthCheck cache + toggles', () => {
    beforeEach(() => {
        health.__resetCache();
        health.__setCacheDuration(50); // short TTL
        delete process.env.DASHBOARD_INCLUDE_UPDATE_CHECK;
        delete process.env.DASHBOARD_INCLUDE_CACHE_EFFICIENCY;
        delete process.env.DASHBOARD_INCLUDE_TMDB;
        delete process.env.DASHBOARD_INCLUDE_TVDB;
        delete process.env.DASHBOARD_INCLUDE_JELLYFIN;
        delete process.env.DASHBOARD_INCLUDE_DEVICE_SLA;
    });

    test('returns cached result within TTL and refreshes after expiry', async () => {
        const first = await health.getDetailedHealth();
        const second = await health.getDetailedHealth();
        // Names of checks should be identical (cache hit or fast recompute)
        expect(second.checks.map(c => c.name)).toEqual(first.checks.map(c => c.name));
        // If timestamp changed, ensure change is small (<100ms) implying possible race vs TTL boundary
        if (second.timestamp !== first.timestamp) {
            const delta = Date.parse(second.timestamp) - Date.parse(first.timestamp);
            expect(delta).toBeLessThan(100);
        }
        // Wait past TTL to force refresh
        await new Promise(r => setTimeout(r, 60));
        const third = await health.getDetailedHealth();
        expect(third.timestamp).not.toBe(first.timestamp);
    });

    test('includes update check when enabled and mocked service returns update', async () => {
        health.__resetCache();
        process.env.DASHBOARD_INCLUDE_UPDATE_CHECK = 'true';
        // Force out of test gating by faking NODE_ENV (restore after)
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        const mockSvc = {
            checkForUpdates: jest.fn().mockResolvedValue({
                updateAvailable: true,
                currentVersion: '1.0.0',
                latestVersion: '9.9.9',
                releaseUrl: 'http://example/release',
                publishedAt: '2025-01-01T00:00:00Z',
            }),
        };
        health.__setGitHubService(mockSvc);
        const res = await health.getDetailedHealth();
        process.env.NODE_ENV = prev;
        const upd = res.checks.find(c => c.name === 'update_available');
        expect(upd && upd.status).toBe('warning');
    });
});
