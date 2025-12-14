const request = require('supertest');

// This test ensures the cinema client doesn't get spammy 500s when TMDB isn't configured.
// When no API key is present, /get-trailer should return 200 with success:false.

describe('GET /get-trailer (missing TMDB key)', () => {
    let app;
    let serverModule;

    const savedEnv = {};

    beforeAll(() => {
        savedEnv.TMDB_API_KEY = process.env.TMDB_API_KEY;
        // Force "missing" in test env to avoid external network calls.
        process.env.TMDB_API_KEY = '';

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
        if (savedEnv.TMDB_API_KEY === undefined) delete process.env.TMDB_API_KEY;
        else process.env.TMDB_API_KEY = savedEnv.TMDB_API_KEY;
    });

    test('returns 200 with success:false (not 500)', async () => {
        const res = await request(app).get('/get-trailer?tmdbId=127585&type=movie');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            success: false,
            error: expect.stringMatching(/TMDB API key not configured/i),
        });
    });
});
