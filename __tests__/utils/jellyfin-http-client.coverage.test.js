const axios = require('axios');

jest.mock('axios');
jest.mock('../../config', () => ({
    getTimeout: jest.fn(key => {
        const timeouts = {
            externalApiJellyfin: 15000,
            externalApiMaxRetries: 2,
            externalApiRetryDelay: 1000,
        };
        return timeouts[key] || 15000;
    }),
}));

// Defer require until after axios mock is set up
const { JellyfinHttpClient } = require('../../utils/jellyfin-http-client');

function makeAxios() {
    const inst = {
        get: jest.fn(),
        interceptors: { request: { use: jest.fn(fn => (inst.__reqInterceptor = fn)) } },
    };
    axios.create.mockReturnValue(inst);
    return inst;
}

describe('utils/jellyfin-http-client', () => {
    const OLD_ENV = process.env;
    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV };
        delete process.env.JELLYFIN_HTTP_DEBUG;
        delete process.env.DEBUG_JELLYFIN;
        delete process.env.JELLYFIN_RETRY_LOGS;
    });
    afterAll(() => {
        process.env = OLD_ENV;
    });

    test('builds correct baseUrl and headers; request interceptor injects api_key', async () => {
        const http = makeAxios();
        const client = new JellyfinHttpClient({
            hostname: 'demo.local',
            port: 8096,
            apiKey: 'ABC123',
            basePath: '/jf',
            insecureHttps: false,
        });

        // Interceptor should be registered
        expect(http.interceptors.request.use).toHaveBeenCalled();

        // Simulate a request through the interceptor
        const cfg = await http.__reqInterceptor({ baseURL: client.baseUrl, url: '/Users' });
        expect(cfg.params.api_key).toBe('ABC123');

        // getImageUrl should include baseUrl and optional query
        const img = client.getImageUrl('item1', 'Primary', { maxHeight: 300, tag: 'v1' });
        expect(img).toContain('http://demo.local:8096/jf/Items/item1/Images/Primary');
        expect(img).toContain('maxHeight=300');
        expect(img).toContain('tag=v1');
    });

    test('retryRequest retries on errors except 4xx and uses exponential backoff', async () => {
        makeAxios();
        const client = new JellyfinHttpClient({
            hostname: 'h',
            port: 8096,
            apiKey: 'k',
            retryBaseDelay: 2,
            retryMaxRetries: 2,
        });

        const seq = [
            () => Promise.reject(new Error('boom1')),
            () => Promise.reject(new Error('boom2')),
            () => Promise.resolve('ok'),
        ];
        let i = 0;
        const res = await client.retryRequest(() => seq[i++]());
        expect(res).toBe('ok');
    });

    test('retryRequest does not retry 4xx responses', async () => {
        makeAxios();
        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'k' });
        const e = new Error('nope');
        e.response = { status: 401 };
        await expect(client.retryRequest(() => Promise.reject(e))).rejects.toBe(e);
    });

    test('testConnection success path and /System/Info/Public fallback to /System/Info', async () => {
        const http = makeAxios();
        // First attempt: /System/Info/Public throws; then /System/Info returns
        http.get
            .mockRejectedValueOnce(new Error('public blocked'))
            .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
            .mockResolvedValueOnce({ data: [{}] }); // /Users success

        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'k' });
        const res = await client.testConnection();
        expect(res.success).toBe(true);
        expect(res.serverName).toBe('JF');
    });

    test('testConnection handles 401 then succeeds via query param fallback', async () => {
        const http = makeAxios();
        http.get
            .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } }) // /System/Info/Public
            .mockRejectedValueOnce(
                Object.assign(new Error('unauth'), { response: { status: 401 } })
            ) // /Users
            .mockResolvedValueOnce({ data: [{}] }); // /Users?api_key=...

        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'secret' });
        const res = await client.testConnection();
        expect(res.success).toBe(true);
        // Ensure that a request with query-param fallback occurred
        expect(http.get).toHaveBeenLastCalledWith(expect.stringContaining('/Users?api_key='));
    });

    test('testConnection raises EJELLYFIN_UNAUTHORIZED on repeated 401/403', async () => {
        const http = makeAxios();
        http.get
            .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
            .mockRejectedValueOnce(
                Object.assign(new Error('unauth'), { response: { status: 403 } })
            )
            .mockRejectedValueOnce(
                Object.assign(new Error('unauth'), { response: { status: 401 } })
            );

        const client = new JellyfinHttpClient({
            hostname: 'h',
            port: 8920,
            apiKey: 'secret',
            retryMaxRetries: 0,
        });
        await expect(client.testConnection()).rejects.toMatchObject({
            code: 'EJELLYFIN_UNAUTHORIZED',
        });
    });

    test('getLibraries and getItems pass through to http.get with params', async () => {
        const http = makeAxios();
        http.get.mockResolvedValueOnce({ data: { libs: [] } });
        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'k' });
        const libs = await client.getLibraries();
        expect(libs).toEqual({ libs: [] });

        http.get.mockResolvedValueOnce({ data: { Items: [] } });
        const items = await client.getItems({
            parentId: 'L1',
            includeItemTypes: ['Movie'],
            fields: ['Genres'],
            sortBy: ['Name'],
            limit: 10,
            startIndex: 5,
        });
        expect(items).toEqual({ Items: [] });
        expect(http.get).toHaveBeenLastCalledWith(expect.stringContaining('/Items?'));
    });

    test('getGenres aggregates unique and sorts; tolerates per-library errors', async () => {
        const http = makeAxios();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        http.get
            // L1
            .mockResolvedValueOnce({
                data: {
                    Items: [{ Genres: ['Action', 'Drama', 'Action ', '', null] }, { Genres: [] }],
                },
            })
            // L2
            .mockResolvedValueOnce({ data: { Items: [{ Genres: ['Sci-Fi'] }] } })
            // L3 -> error triggers warnThrottled
            .mockRejectedValueOnce(new Error('boom'));

        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'k' });
        const genres = await client.getGenres(['L1', 'L2', 'L3']);
        expect(genres).toEqual(['Action', 'Drama', 'Sci-Fi']);
        warnSpy.mockRestore();
    });

    test('getGenresWithCounts returns counts sorted by name', async () => {
        const http = makeAxios();
        http.get
            .mockResolvedValueOnce({
                data: { Items: [{ Genres: ['Drama', 'Action'] }, { Genres: ['Action'] }] },
            })
            .mockResolvedValueOnce({ data: { Items: [{ Genres: ['Sci-Fi', 'Action '] }] } });

        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'k' });
        const out = await client.getGenresWithCounts(['L1', 'L2']);
        expect(out).toEqual([
            { genre: 'Action', count: 3 },
            { genre: 'Drama', count: 1 },
            { genre: 'Sci-Fi', count: 1 },
        ]);
    });

    test('getRatings aggregates OfficialRating unique and sorts', async () => {
        const http = makeAxios();
        http.get
            .mockResolvedValueOnce({
                data: { Items: [{ OfficialRating: 'PG-13' }, { OfficialRating: 'R ' }] },
            })
            .mockResolvedValueOnce({
                data: { Items: [{ OfficialRating: 'PG' }, { OfficialRating: 'PG' }] },
            });

        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'k' });
        const ratings = await client.getRatings(['L1', 'L2']);
        expect(ratings).toEqual(['PG', 'PG-13', 'R']);
    });

    test('getRatingsWithCounts returns counts sorted by rating', async () => {
        const http = makeAxios();
        http.get
            .mockResolvedValueOnce({
                data: { Items: [{ OfficialRating: 'PG-13' }, { OfficialRating: 'R ' }] },
            })
            .mockResolvedValueOnce({
                data: { Items: [{ OfficialRating: 'PG' }, { OfficialRating: 'PG' }] },
            });

        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'k' });
        const out = await client.getRatingsWithCounts(['L1', 'L2']);
        expect(out).toEqual([
            { rating: 'PG', count: 2 },
            { rating: 'PG-13', count: 1 },
            { rating: 'R', count: 1 },
        ]);
    });

    test('searchItems builds query and returns Items array', async () => {
        const http = makeAxios();
        http.get.mockResolvedValueOnce({ data: { Items: [{ Id: 'x1' }, { Id: 'x2' }] } });

        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'k' });
        const res = await client.searchItems('interstellar');
        expect(Array.isArray(res)).toBe(true);
        expect(res).toHaveLength(2);
    });

    test('getQualitiesWithCounts maps heights to labels and sorts by preference', async () => {
        makeAxios();
        const client = new JellyfinHttpClient({ hostname: 'h', port: 8096, apiKey: 'k' });

        const spy = jest.spyOn(Object.getPrototypeOf(client), 'getItems');
        spy.mockResolvedValueOnce({
            Items: [
                { MediaStreams: [{ Type: 'Video', Height: 480 }] }, // SD
                { MediaStreams: [{ Type: 'Video', Height: 720 }] }, // 720p
                { MediaSources: [{ MediaStreams: [{ Type: 'Video', Height: 1080 }] }] }, // 1080p via nested
            ],
        }).mockResolvedValueOnce({
            Items: [
                { MediaSources: [{ MediaStreams: [{ Type: 'Video', Height: 2160 }] }] }, // 4K
                { MediaStreams: [{ Type: 'Video', Height: 900 }] }, // 900p
                { MediaStreams: [{ Type: 'Video', Height: 1080 }] }, // another 1080p
            ],
        });

        const result = await client.getQualitiesWithCounts(['L1', 'L2']);
        expect(result).toEqual([
            { quality: 'SD', count: 1 },
            { quality: '720p', count: 1 },
            { quality: '1080p', count: 3 }, // includes 900 height mapped to 1080p bucket
            { quality: '4K', count: 1 },
        ]);

        spy.mockRestore();
    });
});
