/**
 * Focused coverage tests for healthCheck TMDB connectivity and update availability branches.
 * Targets: disabled, no key, success (200), warning (401), timeout/error; update disabled,
 * service unavailable, update available, latest version.
 */

const path = require('path');
const fs = require('fs');
// We'll dynamically require healthCheck after setting up mocks for each test.
let healthCheck;

// Helper to mutate config.json safely and restore after
function withConfigMutations(mutator, testFn) {
    const cfgPath = path.join(process.cwd(), 'config.json');
    const original = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const mutated = mutator(original);
    fs.writeFileSync(cfgPath, JSON.stringify(mutated, null, 2));
    return testFn().finally(() => fs.writeFileSync(cfgPath, JSON.stringify(original, null, 2)));
}

function loadFresh(fetchMock) {
    jest.resetModules();
    if (fetchMock) {
        global.fetch = fetchMock; // healthCheck uses global.fetch
    } else {
        delete global.fetch;
    }
    delete require.cache[require.resolve('../../utils/healthCheck')];
    // eslint-disable-next-line global-require
    healthCheck = require('../../utils/healthCheck');
    return healthCheck;
}

describe('healthCheck TMDB + update availability coverage', () => {
    afterEach(() => {
        delete process.env.DASHBOARD_INCLUDE_UPDATE_CHECK;
        jest.resetModules();
    });

    test('TMDB disabled returns ok disabled message', async () => {
        loadFresh();
        await withConfigMutations(
            cfg => {
                cfg.tmdbSource = { enabled: false, apiKey: '' };
                return cfg;
            },
            async () => {
                const res = await healthCheck.checkTMDBConnectivity();
                expect(res.status).toBe('ok');
                expect(res.message).toMatch(/disabled/i);
            }
        );
    });

    test('TMDB enabled but no key -> warning', async () => {
        loadFresh();
        await withConfigMutations(
            cfg => {
                cfg.tmdbSource = { enabled: true, apiKey: '' };
                return cfg;
            },
            async () => {
                const res = await healthCheck.checkTMDBConnectivity();
                expect(res.status).toBe('warning');
                expect(res.message).toMatch(/not configured/i);
            }
        );
    });

    test('TMDB success 200 branch', async () => {
        const fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
        const hc = loadFresh(fetch);
        await withConfigMutations(
            cfg => {
                cfg.tmdbSource = { enabled: true, apiKey: 'abc123' };
                return cfg;
            },
            async () => {
                const res = await hc.checkTMDBConnectivity();
                expect(fetch).toHaveBeenCalled();
                expect(res.status).toBe('ok');
                expect(res.message).toMatch(/reachable/i);
            }
        );
    });

    test('TMDB 401 warning branch', async () => {
        const fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
        const hc = loadFresh(fetch);
        await withConfigMutations(
            cfg => {
                cfg.tmdbSource = { enabled: true, apiKey: 'badkey' };
                return cfg;
            },
            async () => {
                const res = await hc.checkTMDBConnectivity();
                expect(res.status).toBe('warning');
                expect(res.message).toMatch(/401/);
            }
        );
    });

    test('TMDB timeout/error branch', async () => {
        const fetch = jest.fn().mockRejectedValue(new Error('boom'));
        const hc = loadFresh(fetch);
        await withConfigMutations(
            cfg => {
                cfg.tmdbSource = { enabled: true, apiKey: 'key' };
                return cfg;
            },
            async () => {
                const res = await hc.checkTMDBConnectivity();
                expect(res.status).toBe('error');
                expect(res.message).toMatch(/boom|error|failed/i);
            }
        );
    });

    test('Update check disabled', async () => {
        delete process.env.DASHBOARD_INCLUDE_UPDATE_CHECK;
        loadFresh();
        const res = await healthCheck.checkUpdateAvailability();
        expect(res.message).toMatch(/disabled/i);
    });

    test('Update service unavailable (no GitHubService)', async () => {
        process.env.DASHBOARD_INCLUDE_UPDATE_CHECK = 'true';
        const hc = loadFresh();
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
        const hc = loadFresh();
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
        const hc = loadFresh();
        hc.__setGitHubService(mockSvc);
        const res = await hc.checkUpdateAvailability();
        expect(res.status).toBe('ok');
        expect(res.message).toMatch(/latest version/i);
    });
});
