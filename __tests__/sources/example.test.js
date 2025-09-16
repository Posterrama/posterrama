const ExampleSource = require('../../sources/example');

function makeShuffle() {
    return arr => arr.sort(() => Math.random() - 0.5);
}

describe('ExampleSource adapter', () => {
    const server = { name: 'example', url: 'http://example.local' };
    const getClient = async () => ({ ok: true });
    const getLibraries = async () => new Map([['Movies', { id: 'lib1' }]]);
    const processItem = async raw => ({ id: raw.id, title: raw.title, rtScore: raw.rtScore ?? 95 });

    test('constructs and exposes metrics', () => {
        const src = new ExampleSource(server, getClient, processItem, getLibraries, makeShuffle());
        const m = src.getMetrics();
        expect(m).toHaveProperty('totalItems');
        expect(m).toHaveProperty('filterEfficiency');
    });

    test('handles empty inputs gracefully', async () => {
        const src = new ExampleSource(server, getClient, processItem, getLibraries, makeShuffle());
        const out = await src.fetchMedia([], 'movie', 10);
        expect(out).toEqual([]);
    });
});
