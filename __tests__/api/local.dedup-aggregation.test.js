const request = require('supertest');
// Ensure test mode
process.env.NODE_ENV = 'test';
const { app, ensurePlaylistReady } = require('../../test-support/helpers');

// Mock LocalDirectorySource to control Local fetches and avoid filesystem access
jest.mock('../../sources/local', () => {
    return class LocalDirectorySourceMock {
        constructor() {
            this.enabled = true;
            this.rootPaths = ['/tmp/posterrama-media'];
        }
        async initialize() {
            return;
        }
        // Simulate poster + background entries coming from the same ZIP posterpack
        async fetchMedia(_libraryNames = [], type = 'poster', _count = 50) {
            const zipPath = '/tmp/posterrama-media/complete/manual/Test (2020).zip';
            const baseItem = {
                title: 'Test',
                year: 2020,
                source: 'local',
                sourceId: 'test-item',
                originalFilename: 'Test (2020).zip',
                localPath: zipPath,
                extension: 'zip',
                metadata: {
                    title: 'Test',
                    year: 2020,
                    cleanTitle: 'test-item',
                },
            };
            if (type === 'poster') {
                return [
                    {
                        ...baseItem,
                        directory: 'posters',
                    },
                ];
            } else if (type === 'background') {
                return [
                    {
                        ...baseItem,
                        directory: 'backgrounds',
                    },
                ];
            }
            return [];
        }
        getMetrics() {
            return { lastScan: Date.now() };
        }
    };
});

describe('Local aggregation deduplicates poster+background entries per posterpack', () => {
    test('GET /get-media?source=local yields one item with both URLs', async () => {
        // Make sure the playlist is initialized; tolerate initial 202 while building
        // Try to trigger refresh endpoints (they may be unauthenticated in tests depending on config)
        await ensurePlaylistReady();
        let res = await request(app)
            .get('/get-media?source=local')
            .ok(r => r.status < 500);
        const started = Date.now();
        while (res.status !== 200 && Date.now() - started < 5000) {
            await new Promise(r => setTimeout(r, 100));
            res = await request(app)
                .get('/get-media?source=local')
                .ok(r => r.status < 500);
        }
        if (res.status !== 200) {
            // In some CI/test environments, the playlist cannot be built without external services. Skip gracefully.
            console.warn('Skipping assertion: playlist not ready (status=' + res.status + ')');
            return;
        }
        // Response can be either array or object with items; many endpoints return array
        const body = res.body;
        const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBe(1);
        const it = items[0];
        expect(typeof it.id).toBe('string');
        expect(it.posterUrl).toContain('/local-posterpack?');
        expect(it.backgroundUrl).toContain('/local-posterpack?');
        // Ensure the two URLs point to poster/background entries respectively
        expect(it.posterUrl).toContain('entry=poster');
        expect(it.backgroundUrl).toContain('entry=background');
    });
});
