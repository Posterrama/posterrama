const logger = require('../logger');

class AppError extends Error {
    constructor(message, statusCode, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true;
        this.timestamp = new Date().toISOString();
        
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
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
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
        '/get-media'
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
            distance: levenshteinDistance(requestedPath, endpoint)
        }))
        .filter(item => item.distance <= 3) // Only suggest if reasonably close
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3) // Max 3 suggestions
        .map(item => item.endpoint);
    
    return suggestions;
}

// Centralized error handler middleware
function error(err, req, res, next) {
    const requestId = req.requestId || res.locals.requestId || 'unknown';
    const isProduction = process.env.NODE_ENV === 'production';
    const timestamp = new Date().toISOString();

    // Log the error
    logger.error(`[Error Handler] Caught error for ${req.method} ${req.path}: ${err.message}`, {
        stack: err.stack,
        timestamp
    });

    // Determine status code
    let statusCode = err.statusCode || err.status || 500;
    
    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
    } else if (err.name === 'UnauthorizedError') {
        statusCode = 401;
    } else if (err.name === 'ForbiddenError') {
        statusCode = 403;
    }

    // Build error response
    const errorResponse = {
        error: isProduction && statusCode === 500 ? 'Internal Server Error' : err.message,
        timestamp,
        path: req.path,
        method: req.method,
        requestId
    };

    // Add additional context in development
    if (!isProduction && err.stack) {
        errorResponse.stack = err.stack;
    }

    // Set status and send response
    res.status(statusCode).json(errorResponse);
}

// 404 handler for unmatched routes
function notFoundHandler(req, res, next) {
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
        stack: (new Error(`Route ${method} ${path} not found`)).stack,
        statusCode: 404,
        timestamp,
        userAgent: req.get('User-Agent')
    });

    // Build response with suggestions
    const suggestions = findSimilarEndpoints(path);
    
    const errorResponse = {
        error: 'Not Found',
        timestamp,
        path,
        method,
        requestId
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
    findSimilarEndpoints
};
