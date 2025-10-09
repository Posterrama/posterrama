const PlexHttpClient = require('../../utils/plex-http-client');

// Mock logger to capture calls without real output
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
}));

const logger = require('../../utils/logger');

describe('utils/plex-http-client', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function makePlexClient(sequenceMap) {
        // sequenceMap: { [path]: () => Promise<data> | throws }
        return {
            query: jest.fn(async path => {
                const handler = sequenceMap[path];
                if (!handler) throw new Error(`Unexpected query path: ${path}`);
                return await handler();
            }),
        };
    }

    test('getRatings aggregates unique ratings and sorts them (debug on)', async () => {
        const plex = makePlexClient({
            '/library/sections': async () => ({
                MediaContainer: {
                    Directory: [
                        { key: '1', title: 'Movies' },
                        { key: '2', title: 'Shows' },
                    ],
                },
            }),
            '/library/sections/1/all': async () => ({
                MediaContainer: {
                    Metadata: [
                        { contentRating: 'PG' },
                        { contentRating: ' R' },
                        { contentRating: 'PG-13' },
                        { contentRating: 'PG' },
                        { contentRating: ' ' },
                    ],
                },
            }),
            '/library/sections/2/all': async () => ({
                MediaContainer: {
                    Metadata: [
                        { contentRating: 'TV-MA' },
                        { contentRating: 'R ' },
                        { contentRating: '' },
                        {},
                    ],
                },
            }),
        });

        const client = new PlexHttpClient(plex, { name: 'TestPlex' }, true);
        const ratings = await client.getRatings();

        expect(ratings).toEqual(['PG', 'PG-13', 'R', 'TV-MA']);
        expect(logger.debug).toHaveBeenCalled();
    });

    test('getRatings continues on per-library errors and logs warn', async () => {
        const plex = makePlexClient({
            '/library/sections': async () => ({
                MediaContainer: {
                    Directory: [
                        { key: '1', title: 'Movies' },
                        { key: '2', title: 'Shows' },
                    ],
                },
            }),
            '/library/sections/1/all': async () => ({
                MediaContainer: { Metadata: [{ contentRating: 'PG' }] },
            }),
            '/library/sections/2/all': async () => {
                throw new Error('Boom');
            },
        });

        const client = new PlexHttpClient(plex, { name: 'TestPlex' }, false);
        const ratings = await client.getRatings();

        expect(ratings).toEqual(['PG']);
        expect(logger.warn).toHaveBeenCalled();
    });

    test('getRatings logs error and returns [] on top-level failure', async () => {
        const plex = makePlexClient({
            '/library/sections': async () => {
                throw new Error('Top-level');
            },
        });

        const client = new PlexHttpClient(plex, { name: 'TestPlex' }, false);
        const ratings = await client.getRatings();
        expect(ratings).toEqual([]);
        expect(logger.error).toHaveBeenCalled();
    });

    test('getRatingsWithCounts aggregates counts and sorts', async () => {
        const plex = makePlexClient({
            '/library/sections': async () => ({
                MediaContainer: { Directory: [{ key: '1', title: 'Movies' }] },
            }),
            '/library/sections/1/all': async () => ({
                MediaContainer: {
                    Metadata: [
                        { contentRating: ' R' },
                        { contentRating: 'PG' },
                        { contentRating: 'R ' },
                        { contentRating: 'PG-13' },
                        { contentRating: '' },
                    ],
                },
            }),
        });

        const client = new PlexHttpClient(plex, { name: 'TestPlex' }, true);
        const out = await client.getRatingsWithCounts();
        expect(out).toEqual([
            { rating: 'PG', count: 1 },
            { rating: 'PG-13', count: 1 },
            { rating: 'R', count: 2 },
        ]);
    });

    test('getRatingsWithCounts returns [] and logs error on failure', async () => {
        const plex = makePlexClient({
            '/library/sections': async () => {
                throw new Error('oops');
            },
        });
        const client = new PlexHttpClient(plex, { name: 'TestPlex' });
        const out = await client.getRatingsWithCounts();
        expect(out).toEqual([]);
        expect(logger.error).toHaveBeenCalled();
    });
});
