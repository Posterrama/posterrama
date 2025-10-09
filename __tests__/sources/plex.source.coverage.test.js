const PlexSource = require('../../sources/plex');

// Helper stubs
const getPlexClient = () => ({ query: async () => ({ MediaContainer: { Metadata: [] } }) });
const processPlexItem = async item => ({
    title: item.title || 'T',
    rottenTomatoes: { originalScore: 7 },
});
const getPlexLibraries = async () =>
    new Map([
        ['Movies', { key: '1' }],
        ['Shows', { key: '2' }],
    ]);
const shuffleArray = arr => arr; // deterministic

const baseServer = {
    name: 'PlexA',
    ratingFilter: '',
    genreFilter: '',
    recentlyAddedOnly: false,
    recentlyAddedDays: 0,
    qualityFilter: '',
    yearFilter: null,
};

// Disabled: overlapping with existing plex tests; keeping to avoid double-counting and differing expectations
describe('PlexSource coverage (lightweight)', () => {
    test('metrics and empty input behavior', async () => {
        const src = new PlexSource(
            baseServer,
            getPlexClient,
            processPlexItem,
            getPlexLibraries,
            shuffleArray,
            0,
            false
        );
        const r = await src.fetchMedia([], 'movie', 10);
        expect(r).toEqual([]);
        expect(src.getMetrics().requestCount).toBe(0);
    });

    test('fetches, filters by rating/genre/quality/year and updates metrics', async () => {
        const plexClient = {
            query: async () => ({
                MediaContainer: {
                    Metadata: [
                        {
                            title: 'A',
                            contentRating: 'R',
                            Genre: [{ tag: 'Sci-Fi' }],
                            Media: [{ videoResolution: '1080' }],
                            year: 2022,
                            addedAt: String(Math.floor(Date.now() / 1000)),
                        },
                        {
                            title: 'B',
                            contentRating: 'PG-13',
                            Genre: [{ tag: 'Action' }],
                            Media: [{ videoResolution: '4k' }],
                            originallyAvailableAt: '2010-01-01',
                        },
                        {
                            title: 'C',
                            contentRating: 'G',
                            Genre: [{ tag: 'Drama' }],
                            Media: [{ videoResolution: 'sd' }],
                            firstAired: '1999-05-05',
                        },
                    ],
                },
            }),
        };
        const src = new PlexSource(
            {
                ...baseServer,
                ratingFilter: 'PG-13,G',
                genreFilter: 'Action,Drama',
                qualityFilter: '1080p,4k',
                yearFilter: '2000-2025',
            },
            () => plexClient,
            processPlexItem,
            async () => new Map([['Movies', { key: '1' }]]),
            shuffleArray,
            0,
            true
        );

        const out = await src.fetchMedia(['Movies'], 'movie', 10);
        // Items A (1080 but R, sci-fi) -> filtered by rating/genre, B (4k Action 2010) -> allowed, C (sd drama 1999) -> filtered by quality/year
        expect(out.map(x => x && x.title)).toContain('B');
        expect(out.length).toBe(1);

        const m = src.getMetrics();
        expect(m.itemsProcessed).toBe(3);
        expect(m.itemsFiltered).toBeGreaterThanOrEqual(2);
        expect(m.lastRequestTime).toBeGreaterThanOrEqual(0);
        expect(m.averageProcessingTime).toBeGreaterThanOrEqual(0);
        expect(m.totalItems).toBe(1);
    });

    test('rtMinScore filters processed items', async () => {
        const src = new PlexSource(
            baseServer,
            getPlexClient,
            async () => ({ rottenTomatoes: { originalScore: 6.9 } }),
            getPlexLibraries,
            shuffleArray,
            70,
            false
        );
        const plexClient = {
            query: async () => ({ MediaContainer: { Metadata: [{ title: 'A' }] } }),
        };
        src.plex = plexClient;
        const out = await src.fetchMedia(['Movies'], 'movie', 10);
        expect(out).toEqual([]);
    });
});
