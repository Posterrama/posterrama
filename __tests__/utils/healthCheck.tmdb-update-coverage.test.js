/**
 * Focused coverage tests for healthCheck TMDB connectivity and update availability branches.
 * Targets: disabled, no key, success (200), warning (401), timeout/error; update disabled,
 * service unavailable, update available, latest version.
 */

const {
    loadHealthCheckWithConfig,
    restoreConfigMock,
} = require('../../test-support/healthCheckTestUtils');
let healthCheck;

describe('healthCheck TMDB + update availability coverage', () => {
    afterEach(() => {
        delete process.env.DASHBOARD_INCLUDE_UPDATE_CHECK;
        restoreConfigMock();
    });

    test('TMDB disabled returns ok disabled message', async () => {
        const hc = loadHealthCheckWithConfig({
            tmdbSource: { enabled: false, apiKey: '' },
            mediaServers: [],
        });
        const res = await hc.checkTMDBConnectivity();
        expect(res.status).toBe('ok');
        expect(res.message).toMatch(/disabled/i);
    });

    test('TMDB enabled but no key -> warning', async () => {
        const hc = loadHealthCheckWithConfig({
            tmdbSource: { enabled: true, apiKey: '' },
            mediaServers: [],
        });
        const res = await hc.checkTMDBConnectivity();
        expect(res.status).toBe('warning');
        expect(res.message).toMatch(/not configured/i);
    });

    test('TMDB success 200 branch', async () => {
        const fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
        const hc = loadHealthCheckWithConfig(
            { tmdbSource: { enabled: true, apiKey: 'abc123' }, mediaServers: [] },
            { fetchMock: fetch }
        );
        const res = await hc.checkTMDBConnectivity();
        expect(fetch).toHaveBeenCalled();
        expect(res.status).toBe('ok');
        expect(res.message).toMatch(/reachable/i);
    });

    test('TMDB 401 warning branch', async () => {
        const fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
        const hc = loadHealthCheckWithConfig(
            { tmdbSource: { enabled: true, apiKey: 'badkey' }, mediaServers: [] },
            { fetchMock: fetch }
        );
        const res = await hc.checkTMDBConnectivity();
        expect(res.status).toBe('warning');
        expect(res.message).toMatch(/401/);
    });

    test('TMDB timeout/error branch', async () => {
        const fetch = jest.fn().mockRejectedValue(new Error('boom'));
        const hc = loadHealthCheckWithConfig(
            { tmdbSource: { enabled: true, apiKey: 'key' }, mediaServers: [] },
            { fetchMock: fetch }
        );
        const res = await hc.checkTMDBConnectivity();
        expect(res.status).toBe('error');
        expect(res.message).toMatch(/boom|error|failed/i);
    });

    test('Update check disabled', async () => {
        delete process.env.DASHBOARD_INCLUDE_UPDATE_CHECK;
        healthCheck = loadHealthCheckWithConfig({
            tmdbSource: { enabled: true, apiKey: 'key' },
            mediaServers: [],
        });
        const res = await healthCheck.checkUpdateAvailability();
        expect(res.message).toMatch(/disabled/i);
    });

    test('Update service unavailable (no GitHubService)', async () => {
        process.env.DASHBOARD_INCLUDE_UPDATE_CHECK = 'true';
        const hc = loadHealthCheckWithConfig({
            tmdbSource: { enabled: true, apiKey: 'key' },
            mediaServers: [],
        });
        // Provide an object without checkForUpdates to trigger 'service unavailable'
        hc.__setGitHubService({});
        const res = await hc.checkUpdateAvailability();
        expect(res.status).toBe('ok');
        expect(res.message).toMatch(/unavailable/i);
    });

    test('Update available branch', async () => {
        process.env.DASHBOARD_INCLUDE_UPDATE_CHECK = 'true';
        const mockSvc = {
            checkForUpdates: jest.fn().mockResolvedValue({
                updateAvailable: true,
                latestVersion: '9.9.9',
                currentVersion: '1.0.0',
                releaseUrl: 'https://example.com',
                publishedAt: new Date().toISOString(),
            }),
        };
        const hc = loadHealthCheckWithConfig({
            tmdbSource: { enabled: true, apiKey: 'key' },
            mediaServers: [],
        });
        hc.__setGitHubService(mockSvc);
        const res = await hc.checkUpdateAvailability();
        expect(res.status).toBe('warning');
        expect(res.message).toMatch(/New version available/);
    });

    test('Latest version branch', async () => {
        process.env.DASHBOARD_INCLUDE_UPDATE_CHECK = 'true';
        const mockSvc = {
            checkForUpdates: jest.fn().mockResolvedValue({
                updateAvailable: false,
                latestVersion: '1.0.0',
                currentVersion: '1.0.0',
            }),
        };
        const hc = loadHealthCheckWithConfig({
            tmdbSource: { enabled: true, apiKey: 'key' },
            mediaServers: [],
        });
        hc.__setGitHubService(mockSvc);
        const res = await hc.checkUpdateAvailability();
        expect(res.status).toBe('ok');
        expect(res.message).toMatch(/latest version/i);
    });
});
