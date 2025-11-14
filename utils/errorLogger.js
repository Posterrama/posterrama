/**
 * Standardized Error Logger
 * Provides consistent error logging with context and sanitization (Issue #6 fix)
 */

const logger = require('./logger');

/**
 * Standardized error logging with context
 */
class ErrorLogger {
    /**
     * Log error with full context and consistent structure
     *
     * @param {Error} error - The error object
     * @param {Object} context - Additional context
     * @param {string} context.operation - What operation was being performed
     * @param {string} context.module - Which module/file the error occurred in
     * @param {string} context.requestId - Request ID if applicable
     * @param {string} context.userId - User ID if applicable
     * @param {Object} context.metadata - Additional metadata
     * @param {string} level - Log level (error, warn, info)
     * @returns {Object} Structured error log object
     */
    static log(error, context = {}, level = 'error') {
        const {
            operation = 'unknown',
            module = 'unknown',
            requestId = null,
            userId = null,
            metadata = {},
        } = context;

        // Build standardized error object
        const errorLog = {
            // Error details
            errorMessage: error.message || String(error),
            errorName: error.name || 'Error',
            errorCode: error.code || error.statusCode || null,

            // Stack trace (sanitized)
            stack: this.sanitizeStack(error.stack),

            // Context
            operation,
            module,

            // Request tracking
            requestId,
            userId,

            // Timestamp
            timestamp: new Date().toISOString(),

            // Additional metadata (sanitized)
            metadata: this.sanitizeMetadata(metadata),
        };

        // Remove null values
        Object.keys(errorLog).forEach(key => {
            if (errorLog[key] === null || errorLog[key] === undefined) {
                delete errorLog[key];
            }
        });

        // Log with appropriate level
        const logMessage = `[${module}] ${operation} failed: ${errorLog.errorMessage}`;
        logger[level](logMessage, errorLog);

        return errorLog;
    }

    /**
     * Sanitize stack traces to remove sensitive paths
     * @param {string} stack - Stack trace string
     * @returns {string|null} Sanitized stack trace
     */
    static sanitizeStack(stack) {
        if (!stack) return null;

        // Remove absolute paths, keep relative
        return stack
            .split('\n')
            .map(line => {
                // Replace /var/www/posterrama with .
                return line.replace(/\/var\/www\/posterrama\//g, './');
            })
            .join('\n');
    }

    /**
     * Sanitize metadata to remove sensitive data
     * @param {Object} metadata - Metadata object
     * @returns {Object} Sanitized metadata
     */
    static sanitizeMetadata(metadata) {
        if (!metadata || typeof metadata !== 'object') {
            return {};
        }

        const sanitized = JSON.parse(JSON.stringify(metadata)); // Deep clone

        // List of sensitive keys to redact
        const sensitiveKeys = [
            'password',
            'secret',
            'token',
            'apiKey',
            'api_key',
            'authorization',
            'cookie',
            'session',
            'credentials',
            'auth',
        ];

        // Recursively sanitize object
        const sanitizeObject = obj => {
            if (!obj || typeof obj !== 'object') return;

            for (const key of Object.keys(obj)) {
                const lowerKey = key.toLowerCase();

                // Redact sensitive fields
                if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
                    obj[key] = '[REDACTED]';
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitizeObject(obj[key]);
                }
            }
        };

        sanitizeObject(sanitized);
        return sanitized;
    }

    /**
     * Quick error logger for HTTP requests
     * @param {Error} error - The error object
     * @param {Object} req - Express request object
     * @param {Object} additionalContext - Additional context
     * @returns {Object} Structured error log
     */
    static logHttpError(error, req, additionalContext = {}) {
        return this.log(error, {
            operation: `${req.method} ${req.path}`,
            module: 'http',
            requestId: req.id || req.requestId || req.headers['x-request-id'],
            userId: req.session?.user?.username || req.user?.username,
            metadata: {
                ip: req.ip,
                userAgent: req.get('user-agent')?.substring(0, 100),
                query: req.query,
                params: req.params,
                ...additionalContext,
            },
        });
    }

    /**
     * Log database errors
     * @param {Error} error - The error object
     * @param {string} operation - Database operation
     * @param {Object} additionalContext - Additional context
     * @returns {Object} Structured error log
     */
    static logDatabaseError(error, operation, additionalContext = {}) {
        return this.log(error, {
            operation,
            module: 'database',
            metadata: additionalContext,
        });
    }

    /**
     * Log external API errors
     * @param {Error} error - The error object
     * @param {string} service - Service name (plex, jellyfin, etc)
     * @param {string} endpoint - API endpoint
     * @param {Object} additionalContext - Additional context
     * @returns {Object} Structured error log
     */
    static logExternalApiError(error, service, endpoint, additionalContext = {}) {
        return this.log(error, {
            operation: `${service} API call`,
            module: 'external-api',
            metadata: {
                service,
                endpoint,
                ...additionalContext,
            },
        });
    }

    /**
     * Log WebSocket errors
     * @param {Error} error - The error object
     * @param {string} deviceId - Device identifier
     * @param {Object} additionalContext - Additional context
     * @returns {Object} Structured error log
     */
    static logWebSocketError(error, deviceId, additionalContext = {}) {
        return this.log(error, {
            operation: 'WebSocket communication',
            module: 'websocket',
            metadata: {
                deviceId,
                ...additionalContext,
            },
        });
    }

    /**
     * Log cache errors
     * @param {Error} error - The error object
     * @param {string} operation - Cache operation
     * @param {Object} additionalContext - Additional context
     * @returns {Object} Structured error log
     */
    static logCacheError(error, operation, additionalContext = {}) {
        return this.log(error, {
            operation,
            module: 'cache',
            metadata: additionalContext,
        });
    }

    /**
     * Log file system errors
     * @param {Error} error - The error object
     * @param {string} operation - File operation
     * @param {Object} additionalContext - Additional context
     * @returns {Object} Structured error log
     */
    static logFileSystemError(error, operation, additionalContext = {}) {
        return this.log(error, {
            operation,
            module: 'filesystem',
            metadata: additionalContext,
        });
    }

    /**
     * Log validation errors
     * @param {Error} error - The error object
     * @param {string} field - Field being validated
     * @param {Object} additionalContext - Additional context
     * @returns {Object} Structured error log
     */
    static logValidationError(error, field, additionalContext = {}) {
        return this.log(
            error,
            {
                operation: 'validation',
                module: 'validator',
                metadata: {
                    field,
                    ...additionalContext,
                },
            },
            'warn'
        ); // Validation errors are typically warnings
    }
}

module.exports = ErrorLogger;
