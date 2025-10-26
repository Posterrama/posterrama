const fs = require('fs');
const path = require('path');

/**
 * This test verifies that when hostname/port/token are provided directly in config.json
 * they take precedence over environment variables referenced by *EnvVar fields.
 */

describe('Direct mediaServers connection fields precedence', () => {
    const originalEnv = { ...process.env };
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    let originalConfigContent;

    beforeAll(() => {
        originalConfigContent = fs.readFileSync(configPath, 'utf8');
        const cfg = JSON.parse(originalConfigContent);
        let plex = cfg.mediaServers.find(s => s.type === 'plex');

        // Create Plex server if it doesn't exist
        if (!plex) {
            plex = {
                name: 'Test Plex Server',
                type: 'plex',
                enabled: true,
                movieLibraryNames: [],
                showLibraryNames: [],
            };
            cfg.mediaServers.push(plex);
        }

        // Ensure test values
        plex.hostname = '10.10.10.10';
        plex.port = 12345;
        plex.token = 'CONFIG_TOKEN';
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
        // Set env vars that would otherwise be used
        process.env.PLEX_HOSTNAME = '99.99.99.99';
        process.env.PLEX_PORT = '32400';
        process.env.PLEX_TOKEN = 'ENV_TOKEN';
        // Clear require cache so config/index.js re-reads file
        Object.keys(require.cache).forEach(k => {
            if (k.endsWith(path.join('config', 'index.js')) || k.endsWith('config/index.js'))
                delete require.cache[k];
        });
    });

    afterAll(() => {
        fs.writeFileSync(configPath, originalConfigContent);
        process.env = originalEnv; // restore env
        Object.keys(require.cache).forEach(k => {
            if (k.endsWith(path.join('config', 'index.js')) || k.endsWith('config/index.js'))
                delete require.cache[k];
        });
    });

    test('direct fields override env', () => {
        const config = require('../../config/index.js');
        const plex = config.mediaServers.find(s => s.type === 'plex');
        expect(plex.hostname).toBe('10.10.10.10');
        expect(plex.port).toBe(12345);
        expect(plex.token).toBe('CONFIG_TOKEN');
    });
});
