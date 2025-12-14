/**
 * Tests for unified error handling classes
 */

const {
    SourceError,
    NetworkError,
    AuthError,
    ConfigError,
    TimeoutError,
    ParseError,
    RateLimitError,
    normalizeError,
    ApiError,
    NotFoundError,
} = require('../../utils/errors');

describe('SourceError', () => {
    it('should create error with required fields', () => {
        const error = new SourceError('Test error', {
            source: 'plex',
            operation: 'fetchMedia',
        });

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('SourceError');
        expect(error.message).toBe('Test error');
        expect(error.source).toBe('plex');
        expect(error.operation).toBe('fetchMedia');
        expect(error.isRetryable).toBe(false);
        expect(error.context).toEqual({});
        expect(error.timestamp).toBeTruthy();
    });

    it('should accept optional context and cause', () => {
        const originalError = new Error('Original error');
        const error = new SourceError('Wrapped error', {
            source: 'jellyfin',
            operation: 'getMetadata',
            isRetryable: true,
            context: { userId: '123', libraryId: '456' },
            cause: originalError,
        });

        expect(error.isRetryable).toBe(true);
        expect(error.context).toEqual({ userId: '123', libraryId: '456' });
        expect(error.cause).toBe(originalError);
    });

    it('should serialize to JSON correctly', () => {
        const error = new SourceError('Test error', {
            source: 'tmdb',
            operation: 'search',
            context: { query: 'Matrix' },
        });

        const json = error.toJSON();
        expect(json.name).toBe('SourceError');
        expect(json.message).toBe('Test error');
        expect(json.source).toBe('tmdb');
        expect(json.operation).toBe('search');
        expect(json.isRetryable).toBe(false);
        expect(json.context).toEqual({ query: 'Matrix' });
        expect(json.timestamp).toBeTruthy();
        expect(json.stack).toBeTruthy();
    });

    it('should serialize cause message when present', () => {
        const originalError = new Error('Original error');
        const error = new SourceError('Wrapped', {
            source: 'tmdb',
            operation: 'search',
            cause: originalError,
        });

        const json = error.toJSON();
        expect(json.cause).toBe('Original error');
    });

    it('should not rely on Error.captureStackTrace', () => {
        const originalCapture = Error.captureStackTrace;
        Error.captureStackTrace = undefined;
        try {
            const error = new SourceError('No captureStackTrace', {
                source: 'plex',
                operation: 'fetchMedia',
            });

            expect(error).toBeInstanceOf(Error);
            expect(error.stack).toBeTruthy();
        } finally {
            Error.captureStackTrace = originalCapture;
        }
    });
});

describe('NetworkError', () => {
    it('should be retryable by default', () => {
        const error = new NetworkError('Connection refused', {
            source: 'plex',
            operation: 'fetchMedia',
            code: 'ECONNREFUSED',
        });

        expect(error).toBeInstanceOf(SourceError);
        expect(error.name).toBe('NetworkError');
        expect(error.isRetryable).toBe(true);
        expect(error.code).toBe('ECONNREFUSED');
    });

    it('should accept status code', () => {
        const error = new NetworkError('Network error', {
            source: 'jellyfin',
            operation: 'getLibraries',
            statusCode: 502,
        });

        expect(error.statusCode).toBe(502);
    });
});

describe('AuthError', () => {
    it('should NOT be retryable', () => {
        const error = new AuthError('Unauthorized', {
            source: 'plex',
            operation: 'fetchMedia',
            statusCode: 401,
        });

        expect(error).toBeInstanceOf(SourceError);
        expect(error.name).toBe('AuthError');
        expect(error.isRetryable).toBe(false);
        expect(error.statusCode).toBe(401);
    });
});

describe('ConfigError', () => {
    it('should NOT be retryable', () => {
        const error = new ConfigError('Missing API key', {
            source: 'tmdb',
            operation: 'init',
            configKey: 'TMDB_API_KEY',
        });

        expect(error).toBeInstanceOf(SourceError);
        expect(error.name).toBe('ConfigError');
        expect(error.isRetryable).toBe(false);
        expect(error.configKey).toBe('TMDB_API_KEY');
    });
});

describe('TimeoutError', () => {
    it('should be retryable', () => {
        const error = new TimeoutError('Request timeout', {
            source: 'plex',
            operation: 'fetchMedia',
            timeout: 30000,
        });

        expect(error).toBeInstanceOf(SourceError);
        expect(error.name).toBe('TimeoutError');
        expect(error.isRetryable).toBe(true);
        expect(error.timeout).toBe(30000);
    });
});

describe('ParseError', () => {
    it('should NOT be retryable', () => {
        const error = new ParseError('Invalid JSON', {
            source: 'romm',
            operation: 'fetchGames',
            rawData: '{invalid json}',
        });

        expect(error).toBeInstanceOf(SourceError);
        expect(error.name).toBe('ParseError');
        expect(error.isRetryable).toBe(false);
        expect(error.rawData).toBe('{invalid json}');
    });
});

describe('RateLimitError', () => {
    it('should be retryable with 429 status', () => {
        const error = new RateLimitError('Too many requests', {
            source: 'tmdb',
            operation: 'search',
            retryAfter: 60,
        });

        expect(error).toBeInstanceOf(SourceError);
        expect(error.name).toBe('RateLimitError');
        expect(error.isRetryable).toBe(true);
        expect(error.statusCode).toBe(429);
        expect(error.retryAfter).toBe(60);
    });
});

describe('Error constructors (default options)', () => {
    it('should allow constructing errors without options arg', () => {
        expect(new SourceError('x')).toBeInstanceOf(Error);
        expect(new NetworkError('x')).toBeInstanceOf(Error);
        expect(new AuthError('x')).toBeInstanceOf(Error);
        expect(new ConfigError('x')).toBeInstanceOf(Error);
        expect(new TimeoutError('x')).toBeInstanceOf(Error);
    });
});

describe('normalizeError', () => {
    const context = { source: 'plex', operation: 'fetchMedia' };

    it('should return SourceError as-is', () => {
        const original = new NetworkError('Network error', context);
        const normalized = normalizeError(original, context);
        expect(normalized).toBe(original);
    });

    it('should convert axios 401 to AuthError', () => {
        const axiosError = {
            response: {
                status: 401,
                statusText: 'Unauthorized',
                data: { error: 'Invalid token' },
            },
        };

        const normalized = normalizeError(axiosError, context);
        expect(normalized).toBeInstanceOf(AuthError);
        expect(normalized.statusCode).toBe(401);
        expect(normalized.isRetryable).toBe(false);
    });

    it('should convert axios 403 to AuthError', () => {
        const axiosError = {
            response: {
                status: 403,
                statusText: 'Forbidden',
                data: { error: 'Access denied' },
            },
        };

        const normalized = normalizeError(axiosError, context);
        expect(normalized).toBeInstanceOf(AuthError);
        expect(normalized.statusCode).toBe(403);
    });

    it('should convert axios 429 to RateLimitError', () => {
        const axiosError = {
            response: {
                status: 429,
                statusText: 'Too Many Requests',
                data: { error: 'Rate limit exceeded' },
                headers: { 'retry-after': '120' },
            },
        };

        const normalized = normalizeError(axiosError, context);
        expect(normalized).toBeInstanceOf(RateLimitError);
        expect(normalized.statusCode).toBe(429);
        expect(normalized.isRetryable).toBe(true);
        expect(normalized.retryAfter).toBe(120);
    });

    it('should handle axios 429 without retry-after header', () => {
        const axiosError = {
            response: {
                status: 429,
                statusText: 'Too Many Requests',
                data: { error: 'Rate limit exceeded' },
                headers: {},
            },
        };

        const normalized = normalizeError(axiosError, context);
        expect(normalized).toBeInstanceOf(RateLimitError);
        expect(normalized.retryAfter).toBeUndefined();
    });

    it('should fall back to default statusText when missing', () => {
        const axiosError = {
            response: {
                status: 500,
                statusText: '',
                data: { error: 'Server error' },
            },
        };

        const normalized = normalizeError(axiosError, context);
        expect(normalized).toBeInstanceOf(SourceError);
        expect(normalized.message).toContain('API Error');
        expect(normalized.isRetryable).toBe(true);
    });

    it('should convert axios 500 to retryable SourceError', () => {
        const axiosError = {
            response: {
                status: 500,
                statusText: 'Internal Server Error',
                data: { error: 'Server error' },
            },
        };

        const normalized = normalizeError(axiosError, context);
        expect(normalized).toBeInstanceOf(SourceError);
        expect(normalized.isRetryable).toBe(true);
    });

    it('should convert axios 400 to non-retryable SourceError', () => {
        const axiosError = {
            response: {
                status: 400,
                statusText: 'Bad Request',
                data: { error: 'Invalid parameters' },
            },
        };

        const normalized = normalizeError(axiosError, context);
        expect(normalized).toBeInstanceOf(SourceError);
        expect(normalized.isRetryable).toBe(false);
    });

    it('should convert axios network error to NetworkError', () => {
        const axiosError = {
            request: {},
            message: 'Network Error',
            code: 'ECONNREFUSED',
        };

        const normalized = normalizeError(axiosError, context);
        expect(normalized).toBeInstanceOf(NetworkError);
        expect(normalized.isRetryable).toBe(true);
        expect(normalized.code).toBe('ECONNREFUSED');
    });

    it('should fall back to default message for axios network error', () => {
        const axiosError = {
            request: {},
            code: 'ECONNRESET',
        };

        const normalized = normalizeError(axiosError, context);
        expect(normalized).toBeInstanceOf(NetworkError);
        expect(normalized.message).toBe('Network error');
        expect(normalized.code).toBe('ECONNRESET');
    });

    it('should convert ETIMEDOUT to TimeoutError', () => {
        const timeoutError = { message: 'Request timeout', code: 'ETIMEDOUT' };

        const normalized = normalizeError(timeoutError, context);
        expect(normalized).toBeInstanceOf(TimeoutError);
        expect(normalized.isRetryable).toBe(true);
    });

    it('should convert ESOCKETTIMEDOUT to TimeoutError', () => {
        const timeoutError = { message: 'Socket timeout', code: 'ESOCKETTIMEDOUT' };

        const normalized = normalizeError(timeoutError, context);
        expect(normalized).toBeInstanceOf(TimeoutError);
        expect(normalized.isRetryable).toBe(true);
    });

    it('should convert SyntaxError to ParseError', () => {
        const syntaxError = new SyntaxError('Unexpected token < in JSON');

        const normalized = normalizeError(syntaxError, context);
        expect(normalized).toBeInstanceOf(ParseError);
        expect(normalized.isRetryable).toBe(false);
    });

    it('should convert name-only SyntaxError to ParseError', () => {
        const syntaxError = { name: 'SyntaxError', message: 'Bad JSON' };

        const normalized = normalizeError(syntaxError, context);
        expect(normalized).toBeInstanceOf(ParseError);
        expect(normalized.isRetryable).toBe(false);
    });

    it('should convert ENOTFOUND to NetworkError', () => {
        const dnsError = new Error('getaddrinfo ENOTFOUND example.com');
        dnsError.code = 'ENOTFOUND';

        const normalized = normalizeError(dnsError, context);
        expect(normalized).toBeInstanceOf(NetworkError);
        expect(normalized.isRetryable).toBe(true);
    });

    it('should fall back to default message for generic network errors', () => {
        const netError = { code: 'ECONNREFUSED' };

        const normalized = normalizeError(netError, context);
        expect(normalized).toBeInstanceOf(NetworkError);
        expect(normalized.message).toBe('Network error');
        expect(normalized.code).toBe('ECONNREFUSED');
    });

    it('should wrap unknown error as non-retryable SourceError', () => {
        const unknownError = new Error('Something went wrong');

        const normalized = normalizeError(unknownError, context);
        expect(normalized).toBeInstanceOf(SourceError);
        expect(normalized.isRetryable).toBe(false);
        expect(normalized.cause).toBe(unknownError);
    });

    it('should handle unknown errors without a message', () => {
        const unknownError = {};

        const normalized = normalizeError(unknownError, context);
        expect(normalized).toBeInstanceOf(SourceError);
        expect(normalized.message).toBe('Unknown error');
        expect(normalized.isRetryable).toBe(false);
        expect(normalized.cause).toBe(unknownError);
    });
});

describe('ApiError (backwards compatibility)', () => {
    it('should create error with status code', () => {
        const error = new ApiError(404, 'Not found');

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('ApiError');
        expect(error.message).toBe('Not found');
        expect(error.statusCode).toBe(404);
    });

    it('should serialize to JSON', () => {
        const error = new ApiError(500, 'Internal server error');
        const json = error.toJSON();

        expect(json.name).toBe('ApiError');
        expect(json.message).toBe('Internal server error');
        expect(json.statusCode).toBe(500);
        expect(json.stack).toBeTruthy();
    });

    describe('isRetryableStatus', () => {
        it('should return true for 5xx errors', () => {
            expect(ApiError.isRetryableStatus(500)).toBe(true);
            expect(ApiError.isRetryableStatus(502)).toBe(true);
            expect(ApiError.isRetryableStatus(503)).toBe(true);
            expect(ApiError.isRetryableStatus(599)).toBe(true);
        });

        it('should return true for specific 4xx errors', () => {
            expect(ApiError.isRetryableStatus(408)).toBe(true); // Request Timeout
            expect(ApiError.isRetryableStatus(429)).toBe(true); // Too Many Requests
        });

        it('should return false for other 4xx errors', () => {
            expect(ApiError.isRetryableStatus(400)).toBe(false);
            expect(ApiError.isRetryableStatus(401)).toBe(false);
            expect(ApiError.isRetryableStatus(403)).toBe(false);
            expect(ApiError.isRetryableStatus(404)).toBe(false);
        });

        it('should return false for 2xx and 3xx', () => {
            expect(ApiError.isRetryableStatus(200)).toBe(false);
            expect(ApiError.isRetryableStatus(301)).toBe(false);
        });
    });
});

describe('NotFoundError (backwards compatibility)', () => {
    it('should create 404 error', () => {
        const error = new NotFoundError();

        expect(error).toBeInstanceOf(ApiError);
        expect(error.name).toBe('NotFoundError');
        expect(error.message).toBe('Resource not found');
        expect(error.statusCode).toBe(404);
    });

    it('should accept custom message', () => {
        const error = new NotFoundError('User not found');

        expect(error.message).toBe('User not found');
        expect(error.statusCode).toBe(404);
    });
});
