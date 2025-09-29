/**
 * Jellyfin mixed connectivity: configure two jellyfin servers with env missing
 * to ensure multiple server checks and aggregated status logic executes.
 */
const fs = require('fs');
const path = require('path');

describe('healthCheck jellyfin mixed connectivity aggregation', () => {
    test('multiple jellyfin servers produce aggregated error status', async () => {
        const cfgPath = path.join(process.cwd(), 'config.json');
        const original = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const mutated = { ...original };
        mutated.mediaServers = [
            {
                name: 'J1',
                type: 'jellyfin',
                enabled: true,
                hostnameEnvVar: 'J1_HOST',
                portEnvVar: 'J1_PORT',
            },
            {
                name: 'J2',
                type: 'jellyfin',
                enabled: true,
                hostnameEnvVar: 'J2_HOST',
                portEnvVar: 'J2_PORT',
            },
        ];
        fs.writeFileSync(cfgPath, JSON.stringify(mutated, null, 2));
        jest.resetModules();
        const hc = require('../../utils/healthCheck');
        const res = await hc.checkJellyfinConnectivity();
        expect(res.name).toBe('jellyfin_connectivity');
        expect(Array.isArray(res.details.servers)).toBe(true);
        expect(res.details.servers.length).toBe(2);
        // All servers should report error due to missing env hostname
        expect(res.details.servers.every(s => s.status === 'error')).toBe(true);
        fs.writeFileSync(cfgPath, JSON.stringify(original, null, 2));
    });
});
