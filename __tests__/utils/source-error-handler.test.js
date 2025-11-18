/**
 * Tests for source error handler utility
 */

const {
    executeWithRetry,
    getErrorMetrics,
    resetErrorMetrics,
    validateConfig,
    calculateDelay,
    sleep,
    DEFAULT_RETRY_CONFIG,
} = require('../../utils/source-error-handler');

const { NetworkError, AuthError, ConfigError, RateLimitError } = require('../../utils/errors');

describe('executeWithRetry', () => {
    beforeEach(() => {
        resetErrorMetrics();
        jest.clearAllMocks();
    });

    it('should return result on first success', async () => {
        const operation = jest.fn().mockResolvedValue({ data: 'success' });
        const context = { source: 'plex', operation: 'fetchMedia' };

        const result = await executeWithRetry(operation, context);

        expect(result).toEqual({ data: 'success' });
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error', async () => {
        const operation = jest
            .fn()
            .mockRejectedValueOnce(
                new NetworkError('Connection failed', {
                    source: 'plex',
                    operation: 'fetchMedia',
                })
            )
            .mockResolvedValueOnce({ data: 'success' });

        const context = { source: 'plex', operation: 'fetchMedia' };
        const config = { maxRetries: 3, baseDelay: 10, jitter: false };

        const result = await executeWithRetry(operation, context, config);

        expect(result).toEqual({ data: 'success' });
        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should NOT retry on non-retryable error', async () => {
        const operation = jest.fn().mockRejectedValue(
            new AuthError('Unauthorized', {
                source: 'plex',
                operation: 'fetchMedia',
                statusCode: 401,
            })
        );

        const context = { source: 'plex', operation: 'fetchMedia' };

        await expect(executeWithRetry(operation, context)).rejects.toThrow(AuthError);
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries and throw last error', async () => {
        const operation = jest.fn().mockRejectedValue(
            new NetworkError('Connection failed', {
                source: 'plex',
                operation: 'fetchMedia',
            })
        );

        const context = { source: 'plex', operation: 'fetchMedia' };
        const config = { maxRetries: 2, baseDelay: 10, jitter: false };

        await expect(executeWithRetry(operation, context, config)).rejects.toThrow(NetworkError);
        expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should normalize unknown errors', async () => {
        const operation = jest.fn().mockRejectedValue(new Error('Unknown error'));

        const context = { source: 'plex', operation: 'fetchMedia' };
        const config = { maxRetries: 0 };

        await expect(executeWithRetry(operation, context, config)).rejects.toThrow('Unknown error');
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should record metrics correctly', async () => {
        resetErrorMetrics();

        const operation = jest
            .fn()
            .mockRejectedValueOnce(
                new NetworkError('Network error', {
                    source: 'plex',
                    operation: 'fetchMedia',
                })
            )
            .mockResolvedValueOnce({ data: 'success' });

        const context = { source: 'plex', operation: 'fetchMedia' };
        const config = { maxRetries: 3, baseDelay: 10, jitter: false };

        await executeWithRetry(operation, context, config);

        const metrics = getErrorMetrics('plex');
        expect(metrics.fetchMedia.total).toBe(2); // 1 failure + 1 success
        expect(metrics.fetchMedia.errors).toBe(1);
        expect(metrics.fetchMedia.retries).toBe(1);
    });

    it('should handle rate limit with Retry-After', async () => {
        const operation = jest
            .fn()
            .mockRejectedValueOnce(
                new RateLimitError('Too many requests', {
                    source: 'tmdb',
                    operation: 'search',
                    retryAfter: 2, // 2 seconds
                })
            )
            .mockResolvedValueOnce({ data: 'success' });

        const context = { source: 'tmdb', operation: 'search' };
        const config = { maxRetries: 3, baseDelay: 10, jitter: false };

        const start = Date.now();
        await executeWithRetry(operation, context, config);
        const duration = Date.now() - start;

        expect(operation).toHaveBeenCalledTimes(2);
        expect(duration).toBeGreaterThanOrEqual(2000); // Should wait at least 2 seconds
    });
});

describe('calculateDelay', () => {
    it('should calculate exponential backoff', () => {
        const config = { baseDelay: 1000, multiplier: 1.5, maxDelay: 30000, jitter: false };
        const error = new NetworkError('Network error', { source: 'plex', operation: 'test' });

        expect(calculateDelay(0, config, error)).toBe(1000); // 1s
        expect(calculateDelay(1, config, error)).toBe(1500); // 1.5s
        expect(calculateDelay(2, config, error)).toBe(2250); // 2.25s
        expect(calculateDelay(3, config, error)).toBe(3375); // 3.375s
    });

    it('should respect max delay', () => {
        const config = { baseDelay: 1000, multiplier: 2, maxDelay: 5000, jitter: false };
        const error = new NetworkError('Network error', { source: 'plex', operation: 'test' });

        expect(calculateDelay(10, config, error)).toBe(5000); // Capped at 5s
    });

    it('should add jitter when enabled', () => {
        const config = { baseDelay: 1000, multiplier: 1.5, maxDelay: 30000, jitter: true };
        const error = new NetworkError('Network error', { source: 'plex', operation: 'test' });

        const delays = [];
        for (let i = 0; i < 10; i++) {
            delays.push(calculateDelay(0, config, error));
        }

        // All delays should be different (with high probability)
        const unique = new Set(delays);
        expect(unique.size).toBeGreaterThan(5);

        // All delays should be within base ± 25%
        delays.forEach(delay => {
            expect(delay).toBeGreaterThanOrEqual(1000);
            expect(delay).toBeLessThanOrEqual(1250);
        });
    });

    it('should respect Retry-After header', () => {
        const config = { baseDelay: 1000, multiplier: 1.5, maxDelay: 30000, jitter: false };
        const error = new RateLimitError('Too many requests', {
            source: 'tmdb',
            operation: 'search',
            retryAfter: 10, // 10 seconds
        });

        expect(calculateDelay(0, config, error)).toBe(10000); // 10s from Retry-After
    });

    it('should cap Retry-After at max delay', () => {
        const config = { baseDelay: 1000, multiplier: 1.5, maxDelay: 5000, jitter: false };
        const error = new RateLimitError('Too many requests', {
            source: 'tmdb',
            operation: 'search',
            retryAfter: 60, // 60 seconds
        });

        expect(calculateDelay(0, config, error)).toBe(5000); // Capped at 5s
    });
});

describe('sleep', () => {
    it('should sleep for specified duration', async () => {
        const start = Date.now();
        await sleep(100);
        const duration = Date.now() - start;

        expect(duration).toBeGreaterThanOrEqual(95); // Allow 5ms margin
        expect(duration).toBeLessThanOrEqual(150); // Allow 50ms margin
    });
});

describe('getErrorMetrics', () => {
    beforeEach(() => {
        resetErrorMetrics();
    });

    it('should return empty object for unknown source', () => {
        const metrics = getErrorMetrics('unknown');
        expect(metrics).toEqual({});
    });

    it('should return metrics for specific source', async () => {
        const operation = jest.fn().mockResolvedValue({ data: 'success' });
        await executeWithRetry(operation, { source: 'plex', operation: 'fetchMedia' });

        const metrics = getErrorMetrics('plex');
        expect(metrics.fetchMedia).toBeDefined();
        expect(metrics.fetchMedia.total).toBe(1);
    });

    it('should return all metrics when no source specified', async () => {
        const op1 = jest.fn().mockResolvedValue({ data: 'success' });
        const op2 = jest.fn().mockResolvedValue({ data: 'success' });

        await executeWithRetry(op1, { source: 'plex', operation: 'fetchMedia' });
        await executeWithRetry(op2, { source: 'jellyfin', operation: 'getLibraries' });

        const metrics = getErrorMetrics();
        expect(metrics.plex).toBeDefined();
        expect(metrics.jellyfin).toBeDefined();
    });
});

describe('resetErrorMetrics', () => {
    beforeEach(() => {
        resetErrorMetrics();
    });

    it('should reset metrics for specific source', async () => {
        const operation = jest.fn().mockResolvedValue({ data: 'success' });
        await executeWithRetry(operation, { source: 'plex', operation: 'fetchMedia' });

        resetErrorMetrics('plex');
        const metrics = getErrorMetrics('plex');
        expect(metrics).toEqual({});
    });

    it('should reset all metrics', async () => {
        const op1 = jest.fn().mockResolvedValue({ data: 'success' });
        const op2 = jest.fn().mockResolvedValue({ data: 'success' });

        await executeWithRetry(op1, { source: 'plex', operation: 'fetchMedia' });
        await executeWithRetry(op2, { source: 'jellyfin', operation: 'getLibraries' });

        resetErrorMetrics();
        const metrics = getErrorMetrics();
        expect(metrics).toEqual({});
    });
});

describe('validateConfig', () => {
    it('should pass validation with all required fields', () => {
        const config = { hostname: 'localhost', port: 32400, token: 'abc123' };
        expect(() => validateConfig('plex', config, ['hostname', 'port', 'token'])).not.toThrow();
    });

    it('should throw ConfigError for missing config', () => {
        expect(() => validateConfig('plex', null, ['hostname'])).toThrow(ConfigError);
    });

    it('should throw ConfigError for missing required field', () => {
        const config = { hostname: 'localhost', port: 32400 };

        expect(() => validateConfig('plex', config, ['hostname', 'port', 'token'])).toThrow(
            ConfigError
        );
        expect(() => validateConfig('plex', config, ['hostname', 'port', 'token'])).toThrow(
            'Missing required field: token'
        );
    });

    it('should throw ConfigError with correct context', () => {
        const config = { hostname: 'localhost' };

        try {
            validateConfig('plex', config, ['hostname', 'port', 'token']);
            // If we reach this line, the test should fail
            expect(true).toBe(false);
        } catch (error) {
            expect(error).toBeInstanceOf(ConfigError);
            expect(error.source).toBe('plex');
            expect(error.operation).toBe('validateConfig');
            expect(error.configKey).toBe('port');
            expect(error.context.requiredFields).toEqual(['hostname', 'port', 'token']);
        }
    });
});

describe('DEFAULT_RETRY_CONFIG', () => {
    it('should have correct default values', () => {
        expect(DEFAULT_RETRY_CONFIG).toEqual({
            maxRetries: 3,
            baseDelay: 1000,
            multiplier: 1.5,
            maxDelay: 30000,
            jitter: true,
        });
    });
});
