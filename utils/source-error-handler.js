/**
 * Error Handler Utility for Media Source Adapters
 *
 * Provides automatic retry logic with exponential backoff for media source operations.
 * Normalizes errors, records metrics, and handles rate limiting gracefully.
 *
 * @module utils/source-error-handler
 */

const { normalizeError, ConfigError } = require('./errors');
const logger = require('./logger');

/**
 * Retry configuration with exponential backoff
 */
const DEFAULT_RETRY_CONFIG = {
    maxRetries: 3, // Maximum number of retry attempts
    baseDelay: 1000, // Initial delay in ms (1 second)
    multiplier: 1.5, // Exponential multiplier (1s → 1.5s → 2.25s → 3.375s)
    maxDelay: 30000, // Maximum delay in ms (30 seconds)
    jitter: true, // Add random jitter to prevent thundering herd
};

/**
 * Metrics tracking for source errors
 * Structure: { source: { operation: { total, errors, retries } } }
 */
const errorMetrics = {};

/**
 * Execute operation with automatic retry and exponential backoff
 *
 * @param {Function} operation - Async function to execute
 * @param {Object} context - Operation context
 * @param {string} context.source - Source name (plex, jellyfin, tmdb, romm)
 * @param {string} context.operation - Operation name (fetchMedia, getMetadata, etc.)
 * @param {Object} [context.params={}] - Operation parameters for logging
 * @param {Object} [retryConfig] - Override default retry config
 * @returns {Promise<any>} Operation result
 * @throws {SourceError} Normalized error after all retries exhausted
 */
async function executeWithRetry(operation, context, retryConfig = {}) {
    const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    const { source, operation: operationName, params = {} } = context;

    // Initialize metrics for this source/operation
    initializeMetrics(source, operationName);

    let lastError;
    let attempt = 0;

    while (attempt <= config.maxRetries) {
        try {
            // Record attempt
            errorMetrics[source][operationName].total++;

            // Execute operation
            const result = await operation();

            // Success - return result
            if (attempt > 0) {
                logger.info('Operation succeeded after retry', {
                    source,
                    operation: operationName,
                    attempt,
                    params,
                });
            }

            return result;
        } catch (error) {
            // Normalize error to SourceError
            const normalizedError = normalizeError(error, { source, operation: operationName });
            lastError = normalizedError;

            // Record error
            errorMetrics[source][operationName].errors++;

            // Log error with context
            logger.warn('Operation failed', {
                source,
                operation: operationName,
                attempt,
                error: normalizedError.toJSON(),
                params,
            });

            // Check if error is retryable
            if (!normalizedError.isRetryable) {
                logger.error('Non-retryable error, aborting', {
                    source,
                    operation: operationName,
                    error: normalizedError.toJSON(),
                });
                throw normalizedError;
            }

            // Check if we have retries left
            if (attempt >= config.maxRetries) {
                logger.error('Max retries exhausted', {
                    source,
                    operation: operationName,
                    attempts: attempt + 1,
                    error: normalizedError.toJSON(),
                });
                throw normalizedError;
            }

            // Calculate delay for next retry
            const delay = calculateDelay(attempt, config, normalizedError);

            // Record retry
            errorMetrics[source][operationName].retries++;

            logger.info('Retrying operation', {
                source,
                operation: operationName,
                attempt: attempt + 1,
                delay,
                maxRetries: config.maxRetries,
            });

            // Wait before retry
            await sleep(delay);
            attempt++;
        }
    }

    // This should never be reached, but just in case
    throw lastError;
}

/**
 * Calculate delay for next retry with exponential backoff
 *
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {Object} config - Retry configuration
 * @param {Error} error - Normalized error
 * @returns {number} Delay in milliseconds
 */
function calculateDelay(attempt, config, error) {
    // Check if error has Retry-After header (rate limiting)
    if (error.retryAfter) {
        const delay = error.retryAfter * 1000; // Convert seconds to ms
        return Math.min(delay, config.maxDelay);
    }

    // Exponential backoff: baseDelay * (multiplier ^ attempt)
    let delay = config.baseDelay * Math.pow(config.multiplier, attempt);

    // Add jitter (random 0-25% variation)
    if (config.jitter) {
        const jitterAmount = delay * 0.25;
        const jitter = Math.random() * jitterAmount;
        delay += jitter;
    }

    // Cap at max delay
    return Math.min(delay, config.maxDelay);
}

/**
 * Sleep for specified duration
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Initialize metrics for source/operation if not exists
 *
 * @param {string} source - Source name
 * @param {string} operation - Operation name
 */
function initializeMetrics(source, operation) {
    if (!errorMetrics[source]) {
        errorMetrics[source] = {};
    }

    if (!errorMetrics[source][operation]) {
        errorMetrics[source][operation] = {
            total: 0,
            errors: 0,
            retries: 0,
        };
    }
}

/**
 * Get error metrics for all sources or specific source
 *
 * @param {string} [source] - Optional source name filter
 * @returns {Object} Error metrics
 */
function getErrorMetrics(source = null) {
    if (source) {
        return errorMetrics[source] || {};
    }
    return errorMetrics;
}

/**
 * Reset error metrics for all sources or specific source
 *
 * @param {string} [source] - Optional source name filter
 */
function resetErrorMetrics(source = null) {
    if (source) {
        delete errorMetrics[source];
    } else {
        Object.keys(errorMetrics).forEach(key => delete errorMetrics[key]);
    }
}

/**
 * Validate source configuration before operation
 * Throws ConfigError if required fields are missing
 *
 * @param {string} source - Source name
 * @param {Object} config - Source configuration
 * @param {string[]} requiredFields - Required field names
 * @throws {ConfigError} If validation fails
 */
function validateConfig(source, config, requiredFields) {
    if (!config) {
        throw new ConfigError('Configuration missing', {
            source,
            operation: 'validateConfig',
            configKey: 'config',
        });
    }

    for (const field of requiredFields) {
        if (!config[field]) {
            throw new ConfigError(`Missing required field: ${field}`, {
                source,
                operation: 'validateConfig',
                configKey: field,
                context: { requiredFields },
            });
        }
    }
}

module.exports = {
    executeWithRetry,
    getErrorMetrics,
    resetErrorMetrics,
    validateConfig,
    calculateDelay,
    sleep,
    DEFAULT_RETRY_CONFIG,
};
