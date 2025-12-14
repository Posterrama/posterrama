const nock = require('nock');
const request = require('supertest');

describe('GET /get-trailer (TMDB success)', () => {
    let serverModule;
    let app;

    beforeAll(() => {
        process.env.TMDB_API_KEY = 'test_tmdb_key';
        jest.resetModules();
        // Ensure local developer config.json (which may contain a real TMDB key) doesn't affect the test.
        jest.doMock('../../config.json', () => ({
            tmdbSource: {
                enabled: true,
                apiKey: '',
            },
        }));
        serverModule = require('../../server');
        app = serverModule.app || serverModule;
    });

    afterAll(() => {
        delete process.env.TMDB_API_KEY;
        nock.cleanAll();
        nock.enableNetConnect();
    });

    beforeEach(() => {
        nock.disableNetConnect();
        // Allow the local supertest HTTP server (random port) while blocking internet.
        nock.enableNetConnect(/^(localhost|127\.0\.0\.1)(:\d+)?$/);
    });

    afterEach(() => {
        // Ensure no stray mocks leak across tests
        nock.cleanAll();
    });

    test('returns YouTube trailer key when TMDB provides videos', async () => {
        const tmdbId = '127585';

        nock('https://api.themoviedb.org')
            .get(`/3/movie/${tmdbId}/videos`)
            .query(q => q && q.api_key === 'test_tmdb_key')
            .reply(200, {
                id: Number(tmdbId),
                results: [
                    {
                        site: 'YouTube',
                        type: 'Trailer',
                        official: true,
                        key: 'abc123XYZ',
                        name: 'Official Trailer',
                    },
                ],
            });

        const res = await request(app).get(`/get-trailer?tmdbId=${tmdbId}&type=movie`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual(
            expect.objectContaining({
                success: true,
                trailer: expect.objectContaining({
                    key: 'abc123XYZ',
                    site: 'YouTube',
                    type: 'Trailer',
                    official: true,
                }),
            })
        );
        expect(res.body.trailer.embedUrl).toContain('https://www.youtube.com/embed/abc123XYZ');
    });
});
