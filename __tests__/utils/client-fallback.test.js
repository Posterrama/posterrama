const { decideFallbackSource } = require('../../utils/client-fallback');

describe('client fallback helper', () => {
    test('keeps savedSource if still enabled', () => {
        const out = decideFallbackSource({
            savedSource: 'plex',
            enabledServers: [
                { type: 'plex', enabled: true },
                { type: 'local', enabled: true },
            ],
        });
        expect(out).toBe('plex');
    });

    test('prefers local when savedSource disabled', () => {
        const out = decideFallbackSource({
            savedSource: 'plex',
            enabledServers: [
                { type: 'local', enabled: true },
                { type: 'jellyfin', enabled: true },
            ],
        });
        expect(out).toBe('local');
    });

    test('falls back to first enabled when no local', () => {
        const out = decideFallbackSource({
            savedSource: 'plex',
            enabledServers: [{ type: 'jellyfin', enabled: true }],
        });
        expect(out).toBe('jellyfin');
    });

    test('returns null if nothing enabled', () => {
        const out = decideFallbackSource({ savedSource: 'plex', enabledServers: [] });
        expect(out).toBeNull();
    });
});
