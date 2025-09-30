const { schemas, validate } = require('../../config/validators');

describe('config validation rejects legacy host/port env field usage', () => {
    test('should throw when hostnameEnvVar present', () => {
        const cfg = {
            mediaServers: [
                {
                    name: 'plexA',
                    type: 'plex',
                    enabled: true,
                    hostname: 'localhost',
                    port: 32400,
                    tokenEnvVar: 'PLEX_TOKEN',
                    hostnameEnvVar: 'PLEX_HOSTNAME',
                },
            ],
        };
        expect(() => validate('config', cfg)).toThrow(/hostnameEnvVar is no longer supported/i);
    });

    test('should throw when portEnvVar present', () => {
        const cfg = {
            mediaServers: [
                {
                    name: 'plexA',
                    type: 'plex',
                    enabled: true,
                    hostname: 'localhost',
                    port: 32400,
                    tokenEnvVar: 'PLEX_TOKEN',
                    portEnvVar: 'PLEX_PORT',
                },
            ],
        };
        expect(() => validate('config', cfg)).toThrow(/portEnvVar is no longer supported/i);
    });

    test('still accepts valid modern config', () => {
        const cfg = {
            mediaServers: [
                {
                    name: 'plexA',
                    type: 'plex',
                    enabled: true,
                    hostname: 'localhost',
                    port: 32400,
                    tokenEnvVar: 'PLEX_TOKEN',
                },
            ],
        };
        const validated = validate('config', cfg);
        expect(validated.mediaServers[0].hostname).toBe('localhost');
    });
});
