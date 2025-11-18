/**
 * Unified Error Handling for Media Source Adapters
 *
 * Provides consistent error classes with context, retry logic, and structured logging.
 * All media source adapters (Plex, Jellyfin, TMDB, ROMM) should use these error classes.
 *
 * @module utils/errors
 */

/**
 * Base error class for all source-related errors
 * Provides common functionality: context, retry logic, structured logging
 */
class SourceError extends Error {
    /**
     * @param {string} message - Human-readable error message
     * @param {Object} options - Error context
     * @param {string} options.source - Source name (plex, jellyfin, tmdb, romm)
     * @param {string} options.operation - Operation being performed (fetchMedia, getMetadata, etc.)
     * @param {boolean} [options.isRetryable=false] - Whether this error should trigger retry
     * @param {Object} [options.context={}] - Additional context (params, URL, etc.)
     * @param {Error} [options.cause] - Original error if wrapping
     */
    constructor(message, options = {}) {
        super(message);
        this.name = this.constructor.name;
        this.source = options.source;
        this.operation = options.operation;
        this.isRetryable = options.isRetryable || false;
        this.context = options.context || {};
        this.timestamp = new Date().toISOString();
        this.cause = options.cause;

        // Preserve stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /**
     * Convert error to structured JSON for logging
     * @returns {Object} Structured error object
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            source: this.source,
            operation: this.operation,
            isRetryable: this.isRetryable,
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack,
            cause: this.cause ? this.cause.message : undefined,
        };
    }
}

/**
 * Network-related errors (connection failures, timeouts, DNS errors)
 * These are typically transient and retryable
 */
class NetworkError extends SourceError {
    constructor(message, options = {}) {
        super(message, { ...options, isRetryable: true });
        this.statusCode = options.statusCode;
        this.code = options.code; // ECONNREFUSED, ETIMEDOUT, etc.
    }
}

/**
 * Authentication/Authorization errors (401, 403)
 * These are NOT retryable - credentials need to be fixed
 */
class AuthError extends SourceError {
    constructor(message, options = {}) {
        super(message, { ...options, isRetryable: false });
        this.statusCode = options.statusCode;
    }
}

/**
 * Configuration errors (missing credentials, invalid URLs)
 * These are NOT retryable - config needs to be fixed
 */
class ConfigError extends SourceError {
    constructor(message, options = {}) {
        super(message, { ...options, isRetryable: false });
        this.configKey = options.configKey; // Which config key is missing/invalid
    }
}

/**
 * Timeout errors (request took too long)
 * These are retryable - might succeed on retry
 */
class TimeoutError extends SourceError {
    constructor(message, options = {}) {
        super(message, { ...options, isRetryable: true });
        this.timeout = options.timeout; // Timeout value in ms
    }
}

/**
 * Parse error (invalid JSON, XML, etc.)
 * These are NOT retryable - response format is wrong
 */
class ParseError extends SourceError {
    constructor(message, options = {}) {
        super(message, { ...options, isRetryable: false });
        this.rawData = options.rawData; // Raw data that failed to parse
    }
}

/**
 * Rate limiting errors (429 Too Many Requests)
 * Always retryable with exponential backoff
 */
class RateLimitError extends SourceError {
    constructor(message, options = {}) {
        super(message, { ...options, isRetryable: true, statusCode: 429 });
        this.statusCode = 429;
        this.retryAfter = options.retryAfter; // Seconds to wait before retry
    }
}

// ============================================================================
// BACKWARDS COMPATIBILITY: Keep existing ApiError and NotFoundError
// These are used by routes and middleware, but will eventually be migrated
// ============================================================================

/**
 * Generic API error (backwards compatibility)
 * DEPRECATED: New code should use SourceError subclasses instead
 *
 * API errors (4xx, 5xx HTTP responses)
 * Retryability depends on status code:
 * - 5xx (server errors): retryable
 * - 408 (timeout), 429 (rate limit), 503 (service unavailable): retryable
 * - 4xx (client errors): not retryable
 */
class ApiError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ApiError';
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            statusCode: this.statusCode,
            stack: this.stack,
        };
    }

    /**
     * Determine if HTTP status code is retryable
     * @param {number} statusCode - HTTP status code
     * @returns {boolean} True if retryable
     */
    static isRetryableStatus(statusCode) {
        // 5xx server errors: retryable
        if (statusCode >= 500 && statusCode < 600) return true;

        // Specific retryable 4xx codes
        if (statusCode === 408) return true; // Request Timeout
        if (statusCode === 429) return true; // Too Many Requests
        if (statusCode === 503) return true; // Service Unavailable

        // All other codes: not retryable
        return false;
    }
}

/**
 * Not found error (backwards compatibility)
 * DEPRECATED: New code should use SourceError subclasses instead
 */
class NotFoundError extends ApiError {
    constructor(message = 'Resource not found') {
        super(404, message);
        this.name = 'NotFoundError';
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            statusCode: this.statusCode,
            stack: this.stack,
        };
    }
}

/**
 * Normalize any error to SourceError
 * Converts unknown errors (axios, fetch, etc.) to our error classes
 *
 * @param {Error} error - Original error
 * @param {Object} context - Error context
 * @param {string} context.source - Source name
 * @param {string} context.operation - Operation name
 * @returns {SourceError} Normalized error
 */
function normalizeError(error, context) {
    // Already a SourceError - return as-is
    if (error instanceof SourceError) {
        return error;
    }

    // Axios error with response
    if (error.response) {
        const { status, statusText, data } = error.response;
        const message = `${statusText || 'API Error'}: ${status}`;

        // Auth errors
        if (status === 401 || status === 403) {
            return new AuthError(message, {
                ...context,
                statusCode: status,
                responseBody: data,
                cause: error,
            });
        }

        // Rate limit
        if (status === 429) {
            const retryAfter = error.response.headers?.['retry-after'];
            return new RateLimitError(message, {
                ...context,
                retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
                responseBody: data,
                cause: error,
            });
        }

        // Generic source error with API response
        return new SourceError(message, {
            ...context,
            isRetryable: ApiError.isRetryableStatus(status),
            statusCode: status,
            responseBody: data,
            cause: error,
        });
    }

    // Axios error without response (network error)
    if (error.request) {
        return new NetworkError(error.message || 'Network error', {
            ...context,
            code: error.code,
            cause: error,
        });
    }

    // Timeout errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
        return new TimeoutError(error.message || 'Request timeout', {
            ...context,
            code: error.code,
            cause: error,
        });
    }

    // Parse errors
    if (error instanceof SyntaxError || error.name === 'SyntaxError') {
        return new ParseError(error.message || 'Failed to parse response', {
            ...context,
            cause: error,
        });
    }

    // Generic network errors (ECONNREFUSED, ENOTFOUND, etc.)
    if (error.code && error.code.startsWith('E')) {
        return new NetworkError(error.message || 'Network error', {
            ...context,
            code: error.code,
            cause: error,
        });
    }

    // Unknown error - wrap as generic SourceError
    return new SourceError(error.message || 'Unknown error', {
        ...context,
        isRetryable: false,
        cause: error,
    });
}

module.exports = {
    // New unified error classes
    SourceError,
    NetworkError,
    AuthError,
    ConfigError,
    TimeoutError,
    ParseError,
    RateLimitError,
    normalizeError,

    // Backwards compatibility (DEPRECATED)
    ApiError,
    NotFoundError,
};
