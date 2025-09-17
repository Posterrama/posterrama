const ExampleSource = require('../../sources/example');

/**
 * Intent: Cover metrics + rtMinScore filtering branches in example source.
 * Determinism: shuffleArray replaced with stable noop; synthetic predictable items.
 */

describe('ExampleSource metrics & filtering', () => {
    function makeClient(itemsPerLib = []) {
        return {
            getItems: jest.fn(async ({ startIndex, limit }) => {
                const batch = itemsPerLib.slice(startIndex, startIndex + limit);
                return { Items: batch };
            }),
        };
    }

    function processItem(raw) {
        if (raw.skip) return null;
        return { id: raw.Id, rating: raw.rating, rtScore: raw.rtScore };
    }

    async function getLibraries() {
        return new Map([['LibA', { id: 'lib-a' }]]);
    }

    function shuffleArray(arr) {
        /* deterministic no-op for test */
    }

    test('applies rtMinScore filter and updates metrics', async () => {
        const items = [];
        for (let i = 0; i < 5; i++) {
            items.push({ Id: 'i' + i, rtScore: i * 10 });
        }
        const client = makeClient(items);
        const src = new ExampleSource(
            { name: 'ex' },
            async () => client,
            processItem,
            getLibraries,
            shuffleArray,
            30,
            true
        );
        const result = await src.fetchMedia(['LibA'], 'movie', 10);
        // Expect items with rtScore >=30 (i=3,4)
        expect(result.length).toBe(2);
        const metrics = src.getMetrics();
        expect(metrics.itemsProcessed).toBe(5);
        expect(metrics.itemsFiltered).toBe(3); // 0,10,20 filtered
        expect(metrics.filterEfficiency).toBeCloseTo(3 / 5);
        expect(src.getAvailableRatings()).toEqual([]); // no ratings
    });
});
