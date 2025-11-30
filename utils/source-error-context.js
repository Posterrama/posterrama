/**
 * @file utils/source-error-context.js
 * @description Enhanced error context utilities for media source adapters
 * Provides structured error logging with detailed context for troubleshooting
 */

/**
 * Create enhanced error context for source adapter failures
 * @param {object} options - Error context options
 * @param {string} options.source - Source name (plex, jellyfin, tmdb, etc.)
 * @param {string} options.operation - Operation being performed (fetchMedia, getServerInfo, etc.)
 * @param {Error} options.error - Original error object
 * @param {object} [options.metadata] - Additional context metadata
 * @returns {object} Structured error context
 */
function createSourceErrorContext({ source, operation, error, metadata = {} }) {
    const err = /** @type {any} */ (error);
    return {
        source,
        operation,
        error: {
            message: error.message,
            name: error.name,
            code: err.code,
            statusCode: err.statusCode || err.response?.status,
        },
        metadata,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Log source adapter error with enhanced context
 * @param {object} logger - Logger instance
 * @param {object} options - Error logging options
 * @param {string} options.source - Source name
 * @param {string} options.operation - Operation name
 * @param {Error} options.error - Error object
 * @param {object} [options.metadata] - Additional context
 * @param {string} [options.level='error'] - Log level (error, warn)
 */
function logSourceError(logger, { source, operation, error, metadata = {}, level = 'error' }) {
    const context = createSourceErrorContext({ source, operation, error, metadata });

    const logMessage = `[${source}] ${operation} failed`;
    const logData = {
        ...context,
        // Include stack trace for debugging but sanitize sensitive data
        stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines only
    };

    if (level === 'warn') {
        logger.warn(logMessage, logData);
    } else {
        logger.error(logMessage, logData);
    }

    return context;
}

/**
 * Create enhanced error for rethrowing with context
 * @param {object} options - Error creation options
 * @param {string} options.source - Source name
 * @param {string} options.operation - Operation name
 * @param {Error} options.originalError - Original error
 * @param {object} [options.metadata] - Additional context
 * @returns {Error} Enhanced error with context
 */
function createEnhancedError({ source, operation, originalError, metadata = {} }) {
    const error = /** @type {any} */ (
        new Error(`[${source}] ${operation} failed: ${originalError.message}`)
    );
    const origErr = /** @type {any} */ (originalError);
    error.name = 'SourceAdapterError';
    error.originalError = originalError;
    error.source = source;
    error.operation = operation;
    error.metadata = metadata;
    error.statusCode = origErr.statusCode || origErr.response?.status || 500;

    // Preserve original stack trace
    if (originalError.stack) {
        error.stack = `${error.stack}\nCaused by: ${originalError.stack}`;
    }

    return error;
}

/**
 * Get operation-specific metadata extractors
 * Common patterns for different operations
 */
const metadataExtractors = {
    /**
     * Extract metadata for fetchMedia operations
     * @param {object} params - Fetch parameters
     * @returns {object} Extracted metadata
     */
    fetchMedia: params => ({
        libraryNames: params.libraryNames || params.libraries,
        type: params.type,
        count: params.count,
        filters: params.filters ? Object.keys(params.filters) : [],
    }),

    /**
     * Extract metadata for HTTP requests
     * @param {object} request - Request object
     * @returns {object} Extracted metadata
     */
    httpRequest: request => ({
        url: sanitizeUrl(request.url || request.endpoint),
        method: request.method || 'GET',
        params: request.params ? Object.keys(request.params) : [],
    }),

    /**
     * Extract metadata for server connection attempts
     * @param {object} server - Server config
     * @returns {object} Extracted metadata
     */
    connection: server => ({
        serverName: server.name,
        host: sanitizeUrl(server.host || server.url),
        port: server.port,
    }),
};

/**
 * Sanitize URL to remove sensitive information
 * @param {string} url - URL to sanitize
 * @returns {string} Sanitized URL
 */
function sanitizeUrl(url) {
    if (!url) return 'unknown';

    try {
        const urlObj = new URL(url);
        // Remove token/key query parameters
        urlObj.searchParams.delete('token');
        urlObj.searchParams.delete('apikey');
        urlObj.searchParams.delete('api_key');
        urlObj.searchParams.delete('X-Plex-Token');

        // Mask credentials in auth
        if (urlObj.username) {
            urlObj.username = '***';
        }
        if (urlObj.password) {
            urlObj.password = '***';
        }

        return urlObj.toString();
    } catch (e) {
        // Not a valid URL, just return sanitized string
        return String(url).replace(/[?&](token|apikey|api_key|X-Plex-Token)=[^&]*/gi, '$1=***');
    }
}

module.exports = {
    createSourceErrorContext,
    logSourceError,
    createEnhancedError,
    metadataExtractors,
    sanitizeUrl,
};
