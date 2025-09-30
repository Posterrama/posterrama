/**
 * Jellyfin mixed connectivity: configure two jellyfin servers with env missing
 * to ensure multiple server checks and aggregated status logic executes.
 */
describe('healthCheck jellyfin mixed connectivity aggregation', () => {
    const {
        loadHealthCheckWithConfig,
        restoreConfigMock,
    } = require('../../test-support/healthCheckTestUtils');
    afterEach(() => {
        restoreConfigMock();
    });

    test('multiple jellyfin servers produce aggregated error status', async () => {
        const hc = loadHealthCheckWithConfig({
            mediaServers: [
                {
                    name: 'J1',
                    type: 'jellyfin',
                    enabled: true,
                    // Intentionally missing hostname/port to force error aggregation
                },
                {
                    name: 'J2',
                    type: 'jellyfin',
                    enabled: true,
                    // Intentionally missing hostname/port to force error aggregation
                },
            ],
        });
        const res = await hc.checkJellyfinConnectivity();
        expect(res.name).toBe('jellyfin_connectivity');
        expect(Array.isArray(res.details.servers)).toBe(true);
        expect(res.details.servers.length).toBe(2);
        expect(res.details.servers.every(s => s.status === 'error')).toBe(true);
    });
});
