const logger = require('../utils/logger');

class AppError extends Error {
    constructor(message, statusCode, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true;
        this.timestamp = new Date().toISOString();
        this.name = 'AppError';

        Error.captureStackTrace(this, this.constructor);
    }
}

// Calculate similarity between two strings (for suggestions)
function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1, // insertion
                    matrix[i - 1][j] + 1 // deletion
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

// Find similar endpoints for suggestions
function findSimilarEndpoints(requestedPath) {
    const knownEndpoints = [
        '/api/v1/config',
        '/api/v1/media',
        '/api/v1/admin/config',
        '/api/v1/admin/plex/validate-connection',
        '/api/v1/admin/config/validate',
        '/api-docs',
        '/get-config',
        '/get-media',
    ];

    // Special handling for common typos
    if (requestedPath.includes('get-config')) {
        return ['/api/v1/config', '/get-config'];
    }
    if (requestedPath.includes('get-media')) {
        return ['/api/v1/media', '/get-media'];
    }

    const suggestions = knownEndpoints
        .map(endpoint => ({
            endpoint,
            distance: levenshteinDistance(requestedPath, endpoint),
        }))
        .filter(item => item.distance <= 3) // Only suggest if reasonably close
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3) // Max 3 suggestions
        .map(item => item.endpoint);

    return suggestions;
}

// Centralized error handler middleware
function error(err, req, res, _next) {
    const requestId = req.requestId || res.locals.requestId || 'unknown';
    const isProduction = process.env.NODE_ENV === 'production';
    const timestamp = new Date().toISOString();

    // Handle null or undefined errors
    if (!err) {
        err = new Error('Unknown error occurred');
        err.statusCode = 500;
    }

    // Ensure err has required properties
    if (!err.message) {
        // For explicit client errors (status < 500) return empty string, else unknown marker
        if (err.statusCode && err.statusCode < 500) {
            err.message = '';
        } else {
            err.message = 'Unknown error occurred';
        }
    }

    // Determine status code early for log level
    let statusCode = err.statusCode || err.status || 500;
    const isSessionENOENT =
        ((err && err.code === 'ENOENT') || /ENOENT/.test(String(err && err.message))) &&
        /sessions\//.test(String(err && err.message));

    // Log the error with appropriate severity
    const logPayload = { stack: err.stack, timestamp };
    if (isSessionENOENT) {
        // Benign/ephemeral in file-session-store.
        // For SSE streams, this can otherwise become very noisy due to automatic reconnects.
        const isSsePath =
            req.path === '/api/admin/logs/stream' ||
            req.path === '/api/admin/events' ||
            (typeof req.headers.accept === 'string' &&
                req.headers.accept.includes('text/event-stream'));
        const logFn = isSsePath ? logger.debug : logger.warn;
        logFn(
            `[Error Handler] Caught (session ENOENT) for ${req.method} ${req.path}: ${err.message}`,
            logPayload
        );
    } else if (statusCode < 500) {
        // In development, log client errors as error level to aid debugging and satisfy tests
        const logFn = process.env.NODE_ENV === 'development' ? logger.error : logger.warn;
        logFn(
            `[Error Handler] Caught error for ${req.method} ${req.path}: ${err.message}`,
            logPayload
        );
    } else {
        // In development and test, ensure we log server errors at error level (tests expect this)
        logger.error(
            `[Error Handler] Caught error for ${req.method} ${req.path}: ${err.message}`,
            logPayload
        );
    }

    // If headers are already sent, avoid double-send; log-only and exit
    if (res.headersSent) {
        logger.debug('[Error Handler] Response headers already sent; logging only', {
            path: req.path,
            method: req.method,
            statusCode,
        });
        return; // do not call next(err) to avoid default handler noise
    }

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
    } else if (err.name === 'UnauthorizedError') {
        statusCode = 401;
    } else if (err.name === 'ForbiddenError') {
        statusCode = 403;
    }

    // Build error response
    const baseMessage =
        !err || err.message === 'Unknown error occurred' ? 'Unknown error occurred' : err.message;
    const errorResponse = {
        error:
            isProduction && statusCode === 500 && baseMessage !== 'Unknown error occurred'
                ? 'Internal Server Error'
                : baseMessage,
        timestamp,
        path: req.path,
        method: req.method,
        requestId,
    };

    // Add additional context in development (only for server errors or non-operational)
    if (!isProduction && err.stack && statusCode >= 500) {
        errorResponse.stack = err.stack;
    }

    // Set status and send response
    res.status(statusCode).json(errorResponse);
}

// 404 handler for unmatched routes
function notFoundHandler(req, res, _next) {
    const requestId = req.requestId || res.locals.requestId || 'unknown';
    const timestamp = new Date().toISOString();
    const method = req.method;
    const path = req.path;

    // Log the 404
    logger.warn(`Route ${method} ${path} not found`, {
        ip: req.ip,
        method,
        path,
        requestId,
        stack: new Error(`Route ${method} ${path} not found`).stack,
        statusCode: 404,
        timestamp,
        userAgent: req.get('User-Agent'),
    });

    // Build response with suggestions
    const suggestions = findSimilarEndpoints(path);

    const errorResponse = {
        error: 'Not Found',
        timestamp,
        path,
        method,
        requestId,
    };

    // Add suggestions if available
    if (suggestions.length > 0) {
        errorResponse.suggestions = suggestions;
    }

    res.status(404).json(errorResponse);
}

module.exports = {
    AppError,
    errorHandler: error,
    notFoundHandler,
    findSimilarEndpoints,
};
