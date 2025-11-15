/**
 * Tests for lib/http-client-base.js
 * Base class for HTTP clients with common functionality
 */

const BaseHttpClient = require('../../lib/http-client-base');

describe('BaseHttpClient', () => {
    describe('constructor', () => {
        it('should initialize with required parameters', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
            });

            expect(client.hostname).toBe('example.com');
            expect(client.port).toBe(8080);
            expect(client.baseUrl).toBe('http://example.com:8080');
        });

        it('should detect HTTPS from port 443', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 443,
            });

            expect(client.baseUrl).toBe('https://example.com:443');
        });

        it('should detect HTTPS from port 8443', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8443,
            });

            expect(client.baseUrl).toBe('https://example.com:8443');
        });

        it('should use HTTP for custom ports', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8096,
            });

            expect(client.baseUrl).toBe('http://example.com:8096');
        });

        it('should normalize basePath with leading slash', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
                basePath: 'api/v1',
            });

            expect(client.baseUrl).toBe('http://example.com:8080/api/v1');
        });

        it('should remove trailing slash from basePath', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
                basePath: '/api/v1/',
            });

            expect(client.baseUrl).toBe('http://example.com:8080/api/v1');
        });

        it('should ignore basePath if it is just "/"', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
                basePath: '/',
            });

            expect(client.baseUrl).toBe('http://example.com:8080');
        });

        it('should set insecure flag from options', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 443,
                insecure: true,
            });

            expect(client.insecure).toBe(true);
        });

        it('should use custom retry configuration', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
                retryMaxRetries: 5,
                retryBaseDelay: 2000,
            });

            expect(client.retryMaxRetries).toBe(5);
            expect(client.retryBaseDelay).toBe(2000);
        });

        it('should set custom client name for logging', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
                clientName: 'TestClient',
            });

            expect(client.clientName).toBe('TestClient');
        });
    });

    describe('_normalizeBasePath', () => {
        let client;

        beforeEach(() => {
            client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
            });
        });

        it('should return empty string for null basePath', () => {
            expect(client._normalizeBasePath(null)).toBe('');
        });

        it('should return empty string for empty basePath', () => {
            expect(client._normalizeBasePath('')).toBe('');
        });

        it('should return empty string for "/" basePath', () => {
            expect(client._normalizeBasePath('/')).toBe('');
        });

        it('should add leading slash if missing', () => {
            expect(client._normalizeBasePath('api')).toBe('/api');
        });

        it('should remove trailing slash', () => {
            expect(client._normalizeBasePath('/api/')).toBe('/api');
        });

        it('should handle multiple path segments', () => {
            expect(client._normalizeBasePath('api/v1/jellyfin')).toBe('/api/v1/jellyfin');
        });
    });

    describe('debug logging', () => {
        it('should create debug function', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
            });

            expect(typeof client.debug).toBe('function');
        });

        it('should create warnThrottled function', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
            });

            expect(typeof client.warnThrottled).toBe('function');
        });

        it('should not log debug messages when debug is disabled', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
                debugEnvVar: 'NONEXISTENT_DEBUG_VAR',
            });

            // Should not throw, just no-op
            client.debug('Test message');
            expect(client.__debug).toBe(false);
        });
    });

    describe('retryRequest', () => {
        let client;

        beforeEach(() => {
            client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
                retryMaxRetries: 3,
                retryBaseDelay: 10, // Short delay for testing
            });
        });

        it('should return result on first successful attempt', async () => {
            const mockFn = jest.fn().mockResolvedValue('success');

            const result = await client.retryRequest(mockFn);

            expect(result).toBe('success');
            expect(mockFn).toHaveBeenCalledTimes(1);
        });

        it('should retry on temporary failures', async () => {
            const mockFn = jest
                .fn()
                .mockRejectedValueOnce(new Error('Temporary error'))
                .mockRejectedValueOnce(new Error('Temporary error'))
                .mockResolvedValue('success');

            const result = await client.retryRequest(mockFn);

            expect(result).toBe('success');
            expect(mockFn).toHaveBeenCalledTimes(3);
        });

        it('should not retry on 4xx client errors', async () => {
            const error = new Error('Not found');
            error.response = { status: 404 };
            const mockFn = jest.fn().mockRejectedValue(error);

            await expect(client.retryRequest(mockFn)).rejects.toThrow('Not found');
            expect(mockFn).toHaveBeenCalledTimes(1); // No retries
        });

        it('should throw last error after max retries', async () => {
            const mockFn = jest.fn().mockRejectedValue(new Error('Persistent error'));

            await expect(client.retryRequest(mockFn)).rejects.toThrow('Persistent error');
            expect(mockFn).toHaveBeenCalledTimes(4); // Initial + 3 retries
        });

        it('should use exponential backoff', async () => {
            const mockFn = jest
                .fn()
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockResolvedValue('success');

            const startTime = Date.now();
            await client.retryRequest(mockFn);
            const duration = Date.now() - startTime;

            // Should have waited: 10ms + 20ms = 30ms minimum
            expect(duration).toBeGreaterThanOrEqual(25);
        });

        it('should respect custom retry parameters', async () => {
            const mockFn = jest
                .fn()
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockResolvedValue('success');

            await client.retryRequest(mockFn, 1, 5); // Max 1 retry, 5ms base delay

            expect(mockFn).toHaveBeenCalledTimes(2);
        });
    });

    describe('createAxiosInstance', () => {
        it('should create axios instance with base configuration', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
            });

            const axiosInstance = client.createAxiosInstance();

            expect(axiosInstance.defaults.baseURL).toBe('http://example.com:8080');
            expect(axiosInstance.defaults.timeout).toBe(client.timeout);
            expect(axiosInstance.defaults.headers['User-Agent']).toBeDefined();
        });

        it('should merge extra configuration', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
            });

            const axiosInstance = client.createAxiosInstance({
                headers: {
                    'X-Custom-Header': 'test-value',
                },
            });

            expect(axiosInstance.defaults.headers['X-Custom-Header']).toBe('test-value');
            expect(axiosInstance.defaults.headers['User-Agent']).toBeTruthy();
        });
    });

    describe('testConnection', () => {
        it('should throw error if not implemented', async () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
            });

            await expect(client.testConnection()).rejects.toThrow(
                'testConnection() must be implemented by subclass'
            );
        });
    });

    describe('destroy', () => {
        it('should destroy HTTP agents', () => {
            const client = new BaseHttpClient({
                hostname: 'example.com',
                port: 8080,
            });

            const httpDestroySpy = jest.spyOn(client.httpAgent, 'destroy');
            const httpsDestroySpy = jest.spyOn(client.httpsAgent, 'destroy');

            client.destroy();

            expect(httpDestroySpy).toHaveBeenCalled();
            expect(httpsDestroySpy).toHaveBeenCalled();
        });
    });

    describe('inheritance', () => {
        class TestHttpClient extends BaseHttpClient {
            constructor(options) {
                super({
                    ...options,
                    clientName: 'TestHttpClient',
                });
            }

            async testConnection() {
                return { status: 'connected' };
            }
        }

        it('should allow subclassing', () => {
            const client = new TestHttpClient({
                hostname: 'test.com',
                port: 9000,
            });

            expect(client.clientName).toBe('TestHttpClient');
            expect(client.baseUrl).toBe('http://test.com:9000');
        });

        it('should allow subclass to implement testConnection', async () => {
            const client = new TestHttpClient({
                hostname: 'test.com',
                port: 9000,
            });

            const result = await client.testConnection();
            expect(result).toEqual({ status: 'connected' });
        });
    });
});
