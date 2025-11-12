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

    test('handles library not found warning', async () => {
        const getLibsEmpty = async () => new Map();
        const src = new ExampleSource(server, getClient, processItem, getLibsEmpty, makeShuffle());
        const out = await src.fetchMedia(['NonExistent'], 'movie', 10);
        expect(out).toEqual([]);
    });

    test('handles client error in fetch', async () => {
        const getClientError = async () => {
            throw new Error('Client connection failed');
        };
        const src = new ExampleSource(
            server,
            getClientError,
            processItem,
            getLibraries,
            makeShuffle()
        );
        const out = await src.fetchMedia(['Movies'], 'movie', 10);
        expect(out).toEqual([]);
        expect(src.metrics.errorCount).toBe(1);
    });

    test('handles processItem errors', async () => {
        const processItemError = async () => {
            throw new Error('Processing failed');
        };
        const getClientWithItems = async () => ({
            getItems: async () => ({ Items: [{ Id: '1', Name: 'Test' }], TotalRecordCount: 1 }),
        });
        const src = new ExampleSource(
            server,
            getClientWithItems,
            processItemError,
            getLibraries,
            makeShuffle()
        );
        const out = await src.fetchMedia(['Movies'], 'movie', 10);
        expect(out).toEqual([]);
        expect(src.metrics.errorCount).toBeGreaterThan(0);
    });

    test('filters by rtMinScore correctly', async () => {
        const items = [
            { Id: '1', Name: 'Low Score' },
            { Id: '2', Name: 'High Score' },
        ];
        const getClientWithScores = async () => ({
            getItems: async ({ startIndex }) => {
                if (startIndex >= items.length) {
                    return { Items: [], TotalRecordCount: items.length };
                }
                return {
                    Items: items.slice(startIndex, startIndex + 1000),
                    TotalRecordCount: items.length,
                };
            },
        });
        let scoreIndex = 0;
        const scores = [50, 95];
        const processWithScore = async raw => ({
            id: raw.Id,
            title: raw.Name,
            rtScore: scores[scoreIndex++],
        });
        const src = new ExampleSource(
            server,
            getClientWithScores,
            processWithScore,
            getLibraries,
            arr => arr, // No shuffle for predictable results
            80, // rtMinScore - filters out score of 50
            false
        );
        const out = await src.fetchMedia(['Movies'], 'movie', 10);
        expect(out.length).toBe(1);
        expect(out[0].title).toBe('High Score');
        expect(src.metrics.itemsFiltered).toBeGreaterThanOrEqual(1);
    });

    test('handles debug mode', async () => {
        const processItemError = async () => {
            throw new Error('Debug error');
        };
        const getClientWithItems = async () => ({
            getItems: async () => ({ Items: [{ Id: '1' }], TotalRecordCount: 1 }),
        });
        const src = new ExampleSource(
            server,
            getClientWithItems,
            processItemError,
            getLibraries,
            makeShuffle(),
            true // isDebug
        );
        const out = await src.fetchMedia(['Movies'], 'movie', 10);
        expect(out).toEqual([]);
    });
});
