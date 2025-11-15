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

const { JellyfinHttpClient } = require('../../utils/jellyfin-http-client');

function makeAxios() {
    const inst = {
        get: jest.fn(),
        interceptors: { request: { use: jest.fn(fn => (inst.__reqInterceptor = fn)) } },
    };
    axios.create.mockReturnValue(inst);
    return inst;
}

describe('utils/jellyfin-http-client - Missing Coverage', () => {
    const OLD_ENV = process.env;
    beforeEach(() => {
        process.env = { ...OLD_ENV };
        delete process.env.JELLYFIN_HTTP_DEBUG;
        delete process.env.POSTERRAMA_DEVICE_NAME;
        delete process.env.POSTERRAMA_DEVICE_ID;
        jest.clearAllMocks();
        // Reset axios mock before each test
        axios.create.mockClear();
    });
    afterAll(() => {
        process.env = OLD_ENV;
    });

    describe('Constructor and Interceptor Debug Logging', () => {
        test('__jfDebug logs request method, URL, headers, and params when enabled', async () => {
            process.env.JELLYFIN_HTTP_DEBUG = 'true';
            const http = makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'debug.local',
                port: 8096,
                apiKey: 'SECRETKEY123',
            });

            const loggerSpy = jest.spyOn(require('../../utils/logger'), 'debug');

            // Simulate request through interceptor with headers
            const cfg = await http.__reqInterceptor({
                baseURL: client.baseUrl,
                url: '/Items',
                method: 'post',
                headers: {
                    'X-Emby-Token': 'SECRETKEY123',
                    'Content-Type': 'application/json',
                },
                params: { StartIndex: 0 },
            });

            expect(cfg.params.api_key).toBe('SECRETKEY123');

            // Verify debug logging
            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining('[JellyfinHttpClient] Request: POST /Items')
            );
            expect(loggerSpy).toHaveBeenCalledWith(
                '[JellyfinHttpClient] Header keys:',
                expect.arrayContaining(['X-Emby-Token', 'Content-Type'])
            );
            expect(loggerSpy).toHaveBeenCalledWith(
                '[JellyfinHttpClient] Token (masked):',
                'SEC…23'
            );
            expect(loggerSpy).toHaveBeenCalledWith('[JellyfinHttpClient] Params:', {
                StartIndex: 0,
                api_key: '[redacted]',
            });

            loggerSpy.mockRestore();
        });

        test('interceptor uses X-MediaBrowser-Token for masking if X-Emby-Token absent', async () => {
            process.env.JELLYFIN_HTTP_DEBUG = 'true';
            const http = makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'MEDIATOKEN',
            });

            const loggerSpy = jest.spyOn(require('../../utils/logger'), 'debug');

            await http.__reqInterceptor({
                baseURL: client.baseUrl,
                url: '/Test',
                headers: { 'X-MediaBrowser-Token': 'MEDIATOKEN' },
            });

            expect(loggerSpy).toHaveBeenCalledWith(
                '[JellyfinHttpClient] Token (masked):',
                'MED…EN'
            );

            loggerSpy.mockRestore();
        });

        test('interceptor masks short tokens as [redacted]', async () => {
            process.env.JELLYFIN_HTTP_DEBUG = 'true';
            const http = makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'SHORT',
            });

            const loggerSpy = jest.spyOn(require('../../utils/logger'), 'debug');

            await http.__reqInterceptor({
                baseURL: client.baseUrl,
                url: '/Test',
                headers: { 'X-Emby-Token': 'SHORT' },
            });

            expect(loggerSpy).toHaveBeenCalledWith(
                '[JellyfinHttpClient] Token (masked):',
                '[redacted]'
            );

            loggerSpy.mockRestore();
        });

        test('interceptor adds api_key when URL already has api_key param', async () => {
            const http = makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'KEY123',
            });

            const cfg = await http.__reqInterceptor({
                baseURL: client.baseUrl,
                url: '/Users?api_key=EXISTING',
            });

            // Should not overwrite existing api_key in URL
            expect(cfg.url).toBe('/Users?api_key=EXISTING');
        });

        test('interceptor handles URL parsing failure and adds api_key to params', async () => {
            const http = makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'FALLBACK',
            });

            // Use invalid URL that will fail parsing
            const cfg = await http.__reqInterceptor({
                baseURL: '',
                url: ':::invalid-url:::', // Invalid URL
            });

            // Should fallback to adding api_key in params
            expect(cfg.params.api_key).toBe('FALLBACK');
        });

        test('interceptor does not overwrite existing params.api_key', async () => {
            const http = makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'DEFAULT',
            });

            const cfg = await http.__reqInterceptor({
                baseURL: client.baseUrl,
                url: '/Test',
                params: { api_key: 'CUSTOM' },
            });

            expect(cfg.params.api_key).toBe('CUSTOM');
        });
    });

    describe('retryRequest with Logging', () => {
        test('logs retry attempts when __jfDebug and __retryLogEnabled are true', async () => {
            process.env.JELLYFIN_HTTP_DEBUG = 'true';
            const http = makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 2,
                retryBaseDelay: 2,
            });
            client.__retryLogEnabled = true;

            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            const seq = [
                () => Promise.reject(new Error('Network error 1')),
                () => Promise.reject(new Error('Network error 2')),
                () => Promise.resolve('success'),
            ];
            let i = 0;
            const result = await client.retryRequest(() => seq[i++]());

            expect(result).toBe('success');
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[JellyfinClient] Request failed (attempt 1/3), retrying in 2ms:'
                ),
                'Network error 1'
            );
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[JellyfinClient] Request failed (attempt 2/3), retrying in 4ms:'
                ),
                'Network error 2'
            );

            warnSpy.mockRestore();
        });
    });

    describe('testConnection - Error Paths', () => {
        test('testConnection: both /System/Info/Public and /System/Info fail', async () => {
            const http = makeAxios();
            const error1 = new Error('Public endpoint disabled');
            const error2 = new Error('System info failed');
            error2.response = { status: 500 };
            error2.code = 'ECONNRESET';

            http.get.mockRejectedValueOnce(error1).mockRejectedValueOnce(error2);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toThrow('System info failed');
        });

        test('testConnection: /Users with __jfDebug logs apiKey length', async () => {
            process.env.JELLYFIN_HTTP_DEBUG = 'true';
            const http = makeAxios();
            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockResolvedValueOnce({ data: [{}] }); // /Users success

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: '12345678',
            });

            const loggerSpy = jest.spyOn(require('../../utils/logger'), 'debug');

            await client.testConnection();

            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[JellyfinHttpClient] Testing auth with /Users, apiKey length: 8'
                )
            );

            loggerSpy.mockRestore();
        });

        test('testConnection: /Users fails with 404 (first try)', async () => {
            const http = makeAxios();
            const error = new Error('Not found');
            error.response = { status: 404 };

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toMatchObject({
                code: 'EJELLYFIN_NOT_FOUND',
            });
        });

        test('testConnection: /Users fails with TLS error (first try)', async () => {
            const http = makeAxios();
            const error = new Error('self-signed certificate');
            error.code = 'DEPTH_ZERO_SELF_SIGNED_CERT';

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8920,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toMatchObject({
                code: 'EJELLYFIN_CERT',
            });
        });

        test('testConnection: /Users fails with TLS error via message match', async () => {
            const http = makeAxios();
            const error = new Error('unable to verify the first certificate');

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8920,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toMatchObject({
                code: 'EJELLYFIN_CERT',
            });
        });

        test('testConnection: /Users fails with 401, query param fails with 404', async () => {
            const http = makeAxios();
            const error1 = new Error('Unauthorized');
            error1.response = { status: 401 };
            const error2 = new Error('Not found');
            error2.response = { status: 404 };

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error1)
                .mockRejectedValueOnce(error2);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toMatchObject({
                code: 'EJELLYFIN_NOT_FOUND',
            });
        });

        test('testConnection: /Users fails with 401, query param fails with TLS cert error (code)', async () => {
            const http = makeAxios();
            const error1 = new Error('Unauthorized');
            error1.response = { status: 401 };
            const error2 = new Error('Self-signed cert');
            error2.code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error1)
                .mockRejectedValueOnce(error2);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8920,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toMatchObject({
                code: 'EJELLYFIN_CERT',
            });
        });

        test('testConnection: /Users fails with 401, query param fails with TLS message match', async () => {
            const http = makeAxios();
            const error1 = new Error('Unauthorized');
            error1.response = { status: 401 };
            const error2 = new Error('self signed certificate in chain');

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error1)
                .mockRejectedValueOnce(error2);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8920,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toMatchObject({
                code: 'EJELLYFIN_CERT',
            });
        });

        test('testConnection: /Users fails with 401, query param throws other error', async () => {
            const http = makeAxios();
            const error1 = new Error('Unauthorized');
            error1.response = { status: 401 };
            const error2 = new Error('Service unavailable');
            error2.response = { status: 503 };

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error1)
                .mockRejectedValueOnce(error2);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toThrow('Service unavailable');
        });

        test('testConnection: /Users fails with ECONNREFUSED', async () => {
            const http = makeAxios();
            const error = new Error('Connection refused');
            error.code = 'ECONNREFUSED';

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toMatchObject({
                code: 'ECONNREFUSED',
            });
        });

        test('testConnection: /Users fails with ETIMEDOUT', async () => {
            const http = makeAxios();
            const error = new Error('Timeout');
            error.code = 'ETIMEDOUT';

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toMatchObject({
                code: 'ETIMEDOUT',
            });
        });

        test('testConnection: /Users fails with ENOTFOUND', async () => {
            const http = makeAxios();
            const error = new Error('Host not found');
            error.code = 'ENOTFOUND';

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toMatchObject({
                code: 'ENOTFOUND',
            });
        });

        test('testConnection: /Users fails with unknown error (rethrown for retry)', async () => {
            const http = makeAxios();
            const error = new Error('Unknown server error');
            error.code = 'EUNKNOWN';

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error);

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.testConnection()).rejects.toThrow('Unknown server error');
        });

        test('testConnection: /Users with __jfDebug logs failure status', async () => {
            process.env.JELLYFIN_HTTP_DEBUG = 'true';
            const http = makeAxios();
            const error = new Error('Auth failed');
            error.response = { status: 401 };

            http.get
                .mockResolvedValueOnce({ data: { ServerName: 'JF', Version: '10.9', Id: 'abc' } })
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce({ data: [{}] }); // Query param succeeds

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            const loggerSpy = jest.spyOn(require('../../utils/logger'), 'debug');

            await client.testConnection();

            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining('[JellyfinHttpClient] /Users failed:'),
                401,
                'Auth failed'
            );
            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining('[JellyfinHttpClient] Retrying with query param fallback')
            );

            loggerSpy.mockRestore();
        });
    });

    describe('getImageUrl - Missing Branches', () => {
        test('getImageUrl without optional parameters', () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'KEY',
            });

            const url = client.getImageUrl('item123', 'Backdrop');

            expect(url).toContain('/Items/item123/Images/Backdrop');
            expect(url).toContain('api_key=KEY');
            expect(url).not.toContain('maxHeight');
            expect(url).not.toContain('maxWidth');
            expect(url).not.toContain('quality');
            expect(url).not.toContain('tag');
        });

        test('getImageUrl with all optional parameters', () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'KEY',
            });

            const url = client.getImageUrl('item456', 'Primary', {
                maxHeight: 500,
                maxWidth: 800,
                quality: 90,
                tag: 'v2',
            });

            expect(url).toContain('maxHeight=500');
            expect(url).toContain('maxWidth=800');
            expect(url).toContain('quality=90');
            expect(url).toContain('tag=v2');
        });
    });

    describe('searchItems - Error Handling', () => {
        test('searchItems throws error with message on failure', async () => {
            const http = makeAxios();
            http.get.mockRejectedValueOnce(new Error('Network timeout'));

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            await expect(client.searchItems('test')).rejects.toThrow(
                'Search failed: Network timeout'
            );
        });

        test('searchItems returns empty array when Items is missing', async () => {
            const http = makeAxios();
            http.get.mockResolvedValueOnce({ data: {} });

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            const result = await client.searchItems('test');
            expect(result).toEqual([]);
        });
    });

    describe('getSpecialFeatures, getLocalTrailers, getThemeSongs - Error Paths', () => {
        test('getSpecialFeatures returns empty array on error and calls debug', async () => {
            const http = makeAxios();
            http.get.mockRejectedValueOnce(new Error('No special features available'));

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            const debugSpy = jest.spyOn(client, 'debug');

            const result = await client.getSpecialFeatures('item123');

            expect(result).toEqual([]);
            expect(debugSpy).toHaveBeenCalledWith(
                expect.stringContaining('[JellyfinHttpClient] No special features for item item123')
            );

            debugSpy.mockRestore();
        });

        test('getLocalTrailers returns empty array on error and calls debug', async () => {
            const http = makeAxios();
            http.get.mockRejectedValueOnce(new Error('No trailers'));

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            const debugSpy = jest.spyOn(client, 'debug');

            const result = await client.getLocalTrailers('item456');

            expect(result).toEqual([]);
            expect(debugSpy).toHaveBeenCalledWith(
                expect.stringContaining('[JellyfinHttpClient] No local trailers for item item456')
            );

            debugSpy.mockRestore();
        });

        test('getThemeSongs returns empty array on error and calls debug', async () => {
            const http = makeAxios();
            http.get.mockRejectedValueOnce(new Error('No theme songs'));

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            const debugSpy = jest.spyOn(client, 'debug');

            const result = await client.getThemeSongs('item789');

            expect(result).toEqual([]);
            expect(debugSpy).toHaveBeenCalledWith(
                expect.stringContaining('[JellyfinHttpClient] No theme songs for item item789')
            );

            debugSpy.mockRestore();
        });

        test('getSpecialFeatures returns Items array on success', async () => {
            const http = makeAxios();
            http.get.mockResolvedValueOnce({
                data: { Items: [{ Id: 'trailer1' }, { Id: 'bts1' }] },
            });

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            const result = await client.getSpecialFeatures('item123');

            expect(result).toEqual([{ Id: 'trailer1' }, { Id: 'bts1' }]);
        });

        test('getLocalTrailers returns data array on success', async () => {
            const http = makeAxios();
            http.get.mockResolvedValueOnce({ data: [{ Id: 'trailer1' }] });

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            const result = await client.getLocalTrailers('item456');

            expect(result).toEqual([{ Id: 'trailer1' }]);
        });

        test('getThemeSongs returns Items array on success', async () => {
            const http = makeAxios();
            http.get.mockResolvedValueOnce({ data: { Items: [{ Id: 'theme1' }] } });

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            const result = await client.getThemeSongs('item789');

            expect(result).toEqual([{ Id: 'theme1' }]);
        });

        test('getThemeSongs handles missing Items with optional chaining', async () => {
            const http = makeAxios();
            http.get.mockResolvedValueOnce({ data: {} });

            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            const result = await client.getThemeSongs('item789');

            expect(result).toEqual([]);
        });
    });

    describe('getQualitiesWithCounts - Error Handling and Edge Cases', () => {
        test('getQualitiesWithCounts tolerates per-library errors with warnThrottled', async () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
                retryMaxRetries: 0,
            });

            const warnThrottledSpy = jest
                .spyOn(client, 'warnThrottled')
                .mockImplementation(() => {});

            const getItemsSpy = jest.spyOn(client, 'getItems');
            getItemsSpy
                .mockResolvedValueOnce({
                    Items: [{ MediaStreams: [{ Type: 'Video', Height: 1080 }] }],
                })
                .mockRejectedValueOnce(new Error('Library unavailable'));

            const result = await client.getQualitiesWithCounts(['L1', 'L2']);

            expect(result).toEqual([{ quality: '1080p', count: 1 }]);
            expect(warnThrottledSpy).toHaveBeenCalled();

            getItemsSpy.mockRestore();
            warnThrottledSpy.mockRestore();
        });

        test('getQualitiesWithCounts handles items without MediaStreams or MediaSources', async () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            const getItemsSpy = jest.spyOn(client, 'getItems');
            getItemsSpy.mockResolvedValueOnce({
                Items: [
                    { Name: 'Item1' }, // No media info
                    { MediaStreams: [{ Type: 'Audio' }] }, // No video stream
                    { MediaSources: [] }, // Empty sources
                ],
            });

            const result = await client.getQualitiesWithCounts(['L1']);

            expect(result).toEqual([]);

            getItemsSpy.mockRestore();
        });

        test('getQualitiesWithCounts maps various heights correctly (SD, 720p, 1080p, 4K, custom)', async () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            const getItemsSpy = jest.spyOn(client, 'getItems');
            getItemsSpy.mockResolvedValueOnce({
                Items: [
                    { MediaStreams: [{ Type: 'Video', Height: 480 }] }, // SD
                    { MediaStreams: [{ Type: 'Video', Height: 576 }] }, // SD
                    { MediaStreams: [{ Type: 'Video', Height: 720 }] }, // 720p
                    { MediaStreams: [{ Type: 'Video', Height: 1080 }] }, // 1080p
                    { MediaStreams: [{ Type: 'Video', Height: 2160 }] }, // 4K
                    { MediaStreams: [{ Type: 'Video', Height: 4320 }] }, // 4K (8K height)
                    { MediaStreams: [{ Type: 'Video', Height: 1440 }] }, // 1440p (custom)
                ],
            });

            const result = await client.getQualitiesWithCounts(['L1']);

            // 1440p comes AFTER 4K because 4K is in predefined order, 1440p is not
            expect(result).toEqual([
                { quality: 'SD', count: 2 },
                { quality: '720p', count: 1 },
                { quality: '1080p', count: 1 },
                { quality: '4K', count: 2 },
                { quality: '1440p', count: 1 }, // Custom resolutions come after predefined
            ]);

            getItemsSpy.mockRestore();
        });

        test('getQualitiesWithCounts throws error with message on outer try/catch failure', async () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            // Break Map to trigger outer catch
            const originalMap = global.Map;
            global.Map = jest.fn().mockImplementation(() => {
                throw new Error('Critical failure');
            });

            await expect(client.getQualitiesWithCounts(['L1'])).rejects.toThrow(
                'Failed to fetch qualities with counts: Critical failure'
            );

            global.Map = originalMap;
        });
    });

    describe('getGenres - Error Handling', () => {
        test('getGenres throws error with message on outer catch', async () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            // Trigger outer catch by breaking Array.from
            const originalArrayFrom = Array.from;
            Array.from = jest.fn().mockImplementation(() => {
                throw new Error('Critical error');
            });

            await expect(client.getGenres(['L1'])).rejects.toThrow(
                'Failed to fetch genres: Critical error'
            );

            Array.from = originalArrayFrom;
        });
    });

    describe('getRatings - Error Handling', () => {
        test('getRatings throws error with message on outer catch', async () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            // Trigger outer catch by breaking Array.from
            const originalArrayFrom = Array.from;
            Array.from = jest.fn().mockImplementation(() => {
                throw new Error('Critical error');
            });

            await expect(client.getRatings(['L1'])).rejects.toThrow(
                'Failed to fetch ratings: Critical error'
            );

            Array.from = originalArrayFrom;
        });
    });

    describe('getGenresWithCounts - Error Handling', () => {
        test('getGenresWithCounts throws error with message on outer catch', async () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            // Trigger outer catch by breaking Array.from
            const originalArrayFrom = Array.from;
            Array.from = jest.fn().mockImplementation(() => {
                throw new Error('Critical error');
            });

            await expect(client.getGenresWithCounts(['L1'])).rejects.toThrow(
                'Failed to fetch genres with counts: Critical error'
            );

            Array.from = originalArrayFrom;
        });
    });

    describe('getRatingsWithCounts - Error Handling', () => {
        test('getRatingsWithCounts throws error with message on outer catch', async () => {
            makeAxios();
            const client = new JellyfinHttpClient({
                hostname: 'h',
                port: 8096,
                apiKey: 'k',
            });

            // Trigger outer catch by breaking Array.from
            const originalArrayFrom = Array.from;
            Array.from = jest.fn().mockImplementation(() => {
                throw new Error('Critical error');
            });

            await expect(client.getRatingsWithCounts(['L1'])).rejects.toThrow(
                'Failed to fetch ratings with counts: Critical error'
            );

            Array.from = originalArrayFrom;
        });
    });
});
