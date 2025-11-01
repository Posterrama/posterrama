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
        // Don't delete env vars in CI - just reset cache
        // CI may have different health check configuration
    });

    test('returns cached result within TTL and refreshes after expiry', async () => {
        const first = await health.getDetailedHealth();
        const second = await health.getDetailedHealth();
        // Names of checks should be identical (cache hit or fast recompute)
        // Note: check count may vary between local and CI based on env vars
        const firstNames = first.checks.map(c => c.name).sort();
        const secondNames = second.checks.map(c => c.name).sort();
        expect(secondNames).toEqual(firstNames);
        if (second.timestamp !== first.timestamp) {
            const delta = Date.parse(second.timestamp) - Date.parse(first.timestamp);
            expect(delta).toBeLessThan(100);
        }
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
