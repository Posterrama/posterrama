const { processJellyfinItem } = require('../../lib/jellyfin-helpers');

describe('jellyfin-helpers: processed item key format', () => {
    test('includes server name in key when available', async () => {
        const client = {
            getImageUrl: jest.fn(() => 'http://example.invalid/image'),
        };
        const serverConfig = {
            name: 'MyServer',
        };
        const item = {
            Id: '171',
            Name: 'Example Movie',
            Type: 'Movie',
            ImageTags: { Primary: 'tag1' },
            BackdropImageTags: [],
        };

        const processed = await processJellyfinItem(item, serverConfig, client);
        expect(processed).toBeTruthy();
        expect(processed.key).toBe('jellyfin_MyServer_171');
        expect(processed.serverName).toBe('MyServer');
    });

    test('falls back to legacy key when server name is missing', async () => {
        const client = {
            getImageUrl: jest.fn(() => 'http://example.invalid/image'),
        };
        const serverConfig = {
            name: '',
        };
        const item = {
            Id: '171',
            Name: 'Example Movie',
            Type: 'Movie',
            ImageTags: { Primary: 'tag1' },
            BackdropImageTags: [],
        };

        const processed = await processJellyfinItem(item, serverConfig, client);
        expect(processed).toBeTruthy();
        expect(processed.key).toBe('jellyfin_171');
    });
});
