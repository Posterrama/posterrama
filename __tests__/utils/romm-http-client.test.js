const RommHttpClient = require('../../utils/romm-http-client');
const axios = require('axios');
const logger = require('../../utils/logger');

jest.mock('axios');
jest.mock('../../utils/logger');

describe('RommHttpClient', () => {
    let client;
    let config;

    beforeEach(() => {
        jest.clearAllMocks();

        config = {
            hostname: 'localhost',
            port: 8080,
            username: 'testuser',
            password: 'testpass',
            timeout: 10000,
        };

        axios.post.mockResolvedValue({
            data: {
                access_token: 'test-access-token',
                refresh_token: 'test-refresh-token',
                expires: 3600,
            },
        });
    });

    describe('Constructor', () => {
        it('should initialize with HTTP on default port', () => {
            client = new RommHttpClient({ hostname: 'localhost', port: 8080 });
            expect(client.baseUrl).toBe('http://localhost:8080');
        });

        it('should use HTTPS for port 443', () => {
            client = new RommHttpClient({ hostname: 'localhost', port: 443 });
            expect(client.baseUrl).toBe('https://localhost:443');
        });

        it('should normalize path slashes', () => {
            client = new RommHttpClient({ hostname: 'localhost', port: 8080, basePath: '/romm/' });
            expect(client.baseUrl).toBe('http://localhost:8080/romm');
        });

        it('should store credentials', () => {
            client = new RommHttpClient(config);
            expect(client.username).toBe('testuser');
            expect(client.password).toBe('testpass');
        });
    });

    describe('_getAuthHeader', () => {
        it('should return Bearer token when available', () => {
            client = new RommHttpClient(config);
            client.accessToken = 'test-token';

            const headers = client._getAuthHeader();

            expect(headers).toEqual({
                Authorization: 'Bearer test-token',
            });
        });

        it('should return Basic auth when no access token', () => {
            client = new RommHttpClient(config);

            const headers = client._getAuthHeader();

            expect(headers.Authorization).toMatch(/^Basic /);
        });

        it('should handle missing credentials', () => {
            client = new RommHttpClient({ hostname: 'localhost', port: 80 });

            const headers = client._getAuthHeader();

            expect(headers).toEqual({});
        });
    });

    describe('authenticate', () => {
        beforeEach(() => {
            client = new RommHttpClient(config);
        });

        it('should successfully authenticate with OAuth2', async () => {
            await client.authenticate();

            expect(axios.post).toHaveBeenCalledWith(
                'http://localhost:8080/api/token',
                expect.any(URLSearchParams),
                expect.objectContaining({
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                })
            );

            expect(client.accessToken).toBe('test-access-token');
            expect(client.refreshToken).toBe('test-refresh-token');
            expect(client.tokenExpiry).toBeGreaterThan(Date.now());
        });

        it('should throw error when credentials missing', async () => {
            client.username = null;

            await expect(client.authenticate()).rejects.toThrow('Username and password required');
        });

        it('should handle authentication failure', async () => {
            axios.post.mockRejectedValue(new Error('Invalid credentials'));

            await expect(client.authenticate()).rejects.toThrow('RomM authentication failed');
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('refreshAccessToken', () => {
        beforeEach(() => {
            client = new RommHttpClient(config);
            client.accessToken = 'old-token';
            client.refreshToken = 'old-refresh-token';
            client.tokenExpiry = Date.now() + 60000;
        });

        it('should refresh token successfully', async () => {
            axios.post.mockResolvedValue({
                data: {
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires: 3600,
                },
            });

            await client.refreshAccessToken();

            expect(client.accessToken).toBe('new-access-token');
            expect(client.refreshToken).toBe('new-refresh-token');
        });

        it('should re-authenticate when no refresh token', async () => {
            client.refreshToken = null;

            await client.refreshAccessToken();

            expect(client.accessToken).toBe('test-access-token');
        });

        it('should fallback to re-auth on refresh failure', async () => {
            axios.post.mockRejectedValueOnce(new Error('Refresh failed')).mockResolvedValueOnce({
                data: {
                    access_token: 'new-token',
                    refresh_token: 'new-refresh',
                    expires: 3600,
                },
            });

            await client.refreshAccessToken();

            expect(client.accessToken).toBe('new-token');
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('request', () => {
        beforeEach(async () => {
            client = new RommHttpClient(config);
            await client.authenticate();
            jest.clearAllMocks();
        });

        it('should make successful authenticated request', async () => {
            axios.mockResolvedValue({ data: { result: 'success' } });

            const result = await client.request('GET', '/api/test');

            expect(result).toEqual({ result: 'success' });
            expect(axios).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'GET',
                    url: 'http://localhost:8080/api/test',
                    headers: expect.objectContaining({
                        Authorization: 'Bearer test-access-token',
                    }),
                })
            );
        });

        it('should refresh token on 401 and retry', async () => {
            axios
                .mockRejectedValueOnce({
                    response: { status: 401 },
                })
                .mockResolvedValueOnce({ data: { result: 'success-after-refresh' } });

            axios.post.mockResolvedValue({
                data: {
                    access_token: 'refreshed-token',
                    refresh_token: 'new-refresh',
                    expires: 3600,
                },
            });

            const result = await client.request('GET', '/api/test');

            expect(result).toEqual({ result: 'success-after-refresh' });
            expect(axios.post).toHaveBeenCalled();
        });

        it('should not retry on 4xx errors (except 401)', async () => {
            axios.mockRejectedValue({
                response: { status: 404 },
            });

            await expect(client.request('GET', '/api/notfound')).rejects.toMatchObject({
                response: { status: 404 },
            });

            expect(axios).toHaveBeenCalledTimes(1);
        });

        it('should retry on network errors', async () => {
            axios
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({ data: { result: 'success-after-retry' } });

            const result = await client.request('GET', '/api/test');

            expect(result).toEqual({ result: 'success-after-retry' });
            expect(axios).toHaveBeenCalledTimes(2);
        });
    });

    describe('getRoms', () => {
        beforeEach(async () => {
            client = new RommHttpClient(config);
            await client.authenticate();
            jest.clearAllMocks();
            axios.mockResolvedValue({ data: { items: [] } });
        });

        it('should fetch ROMs with platform filter', async () => {
            await client.getRoms({ platform_id: 1 });

            expect(axios).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'http://localhost:8080/api/roms?platform_id=1',
                })
            );
        });

        it('should fetch ROMs with pagination', async () => {
            await client.getRoms({ limit: 50, offset: 100 });

            expect(axios).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'http://localhost:8080/api/roms?limit=50&offset=100',
                })
            );
        });

        it('should handle empty parameters', async () => {
            await client.getRoms();

            expect(axios).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'http://localhost:8080/api/roms',
                })
            );
        });
    });

    describe('getPlatforms', () => {
        beforeEach(async () => {
            client = new RommHttpClient(config);
            await client.authenticate();
            jest.clearAllMocks();
            axios.mockResolvedValue({ data: [] });
        });

        it('should fetch platforms list', async () => {
            await client.getPlatforms();

            expect(axios).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'http://localhost:8080/api/platforms',
                })
            );
        });
    });

    describe('getAssetUrl', () => {
        beforeEach(() => {
            client = new RommHttpClient(config);
        });

        it('should generate asset URL from path', () => {
            const url = client.getAssetUrl('covers/mario64.png');

            expect(url).toBe('http://localhost:8080/api/raw/assets/covers/mario64.png');
        });

        it('should handle paths with leading slash', () => {
            const url = client.getAssetUrl('/covers/mario64.png');

            expect(url).toBe('http://localhost:8080/api/raw/assets/covers/mario64.png');
        });

        it('should return full URLs as-is', () => {
            const fullUrl = 'https://example.com/image.png';
            const url = client.getAssetUrl(fullUrl);

            expect(url).toBe(fullUrl);
        });

        it('should return null for empty path', () => {
            const url = client.getAssetUrl('');

            expect(url).toBeNull();
        });
    });

    describe('testConnection', () => {
        beforeEach(() => {
            client = new RommHttpClient(config);
            jest.clearAllMocks();
        });

        it('should return true on successful connection', async () => {
            axios.post.mockResolvedValue({
                data: {
                    access_token: 'token',
                    refresh_token: 'refresh',
                    expires: 3600,
                },
            });
            axios.mockResolvedValue({ data: { status: 'ok' } });

            const result = await client.testConnection();

            expect(result).toBe(true);
        });

        it('should return false on connection failure', async () => {
            axios.post.mockRejectedValue(new Error('Connection failed'));

            const result = await client.testConnection();

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('Debug logging', () => {
        it('should enable debug via environment variable', () => {
            const originalEnv = process.env.ROMM_HTTP_DEBUG;
            process.env.ROMM_HTTP_DEBUG = 'true';

            const debugClient = new RommHttpClient(config);

            expect(debugClient.__rommDebug).toBe(true);
            expect(typeof debugClient.debug).toBe('function');

            process.env.ROMM_HTTP_DEBUG = originalEnv;
        });

        it('should disable debug when environment variables not set', () => {
            const originalEnv1 = process.env.ROMM_HTTP_DEBUG;
            const originalEnv2 = process.env.DEBUG_ROMM;
            delete process.env.ROMM_HTTP_DEBUG;
            delete process.env.DEBUG_ROMM;

            const noDebugClient = new RommHttpClient(config);

            expect(noDebugClient.__rommDebug).toBe(false);
            expect(typeof noDebugClient.debug).toBe('function');

            if (originalEnv1) process.env.ROMM_HTTP_DEBUG = originalEnv1;
            if (originalEnv2) process.env.DEBUG_ROMM = originalEnv2;
        });
    });

    describe('Edge cases', () => {
        it('should handle token refresh with missing refresh token', async () => {
            client = new RommHttpClient(config);
            client.accessToken = 'token';
            client.refreshToken = null;

            await client.refreshAccessToken();

            expect(client.accessToken).toBe('test-access-token');
        });

        it('should handle token refresh keeping old refresh token if not provided', async () => {
            client = new RommHttpClient(config);
            await client.authenticate();

            const oldRefreshToken = client.refreshToken;

            axios.post.mockResolvedValue({
                data: {
                    access_token: 'new-token',
                    expires: 3600,
                },
            });

            await client.refreshAccessToken();

            expect(client.refreshToken).toBe(oldRefreshToken);
        });

        it('should handle retry base delay correctly', async () => {
            client = new RommHttpClient(config);
            await client.authenticate();
            jest.clearAllMocks();

            axios
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({ data: { result: 'ok' } });

            const startTime = Date.now();
            await client.request('GET', '/api/test');
            const elapsed = Date.now() - startTime;

            expect(elapsed).toBeGreaterThanOrEqual(1000);
        });

        it('should handle downloadAsset with invalid path', async () => {
            client = new RommHttpClient(config);

            await expect(client.downloadAsset(null)).rejects.toThrow('Invalid asset path');
        });

        it('should handle getRomDetails', async () => {
            client = new RommHttpClient(config);
            await client.authenticate();
            jest.clearAllMocks();

            axios.mockResolvedValue({ data: { id: 123, name: 'Test ROM' } });

            const result = await client.getRomDetails(123);

            expect(result).toEqual({ id: 123, name: 'Test ROM' });
            expect(axios).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'http://localhost:8080/api/roms/123',
                })
            );
        });

        it('should handle getPlatform', async () => {
            client = new RommHttpClient(config);
            await client.authenticate();
            jest.clearAllMocks();

            axios.mockResolvedValue({ data: { id: 1, name: 'N64' } });

            const result = await client.getPlatform(1);

            expect(result).toEqual({ id: 1, name: 'N64' });
        });

        it('should handle downloadAsset', async () => {
            client = new RommHttpClient(config);
            await client.authenticate();
            jest.clearAllMocks();

            axios.mockResolvedValue({ data: Buffer.from('image-data') });

            await client.downloadAsset('covers/mario64.png');

            expect(axios).toHaveBeenCalledWith(
                expect.objectContaining({
                    responseType: 'arraybuffer',
                })
            );
        });

        it('should handle getHeartbeat', async () => {
            client = new RommHttpClient(config);
            await client.authenticate();
            jest.clearAllMocks();

            axios.mockResolvedValue({ data: { status: 'ok' } });

            const result = await client.getHeartbeat();

            expect(result).toEqual({ status: 'ok' });
        });
    });
});
