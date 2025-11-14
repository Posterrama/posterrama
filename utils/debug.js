/**
 * Debug Utility
 * Provides centralized debug flag checking and logging utilities.
 *
 * @module utils/debug
 */

const logger = require('./logger');

/**
 * Check if debug mode is enabled.
 * Checks both DEBUG and NODE_ENV environment variables.
 *
 * @returns {boolean} True if debug mode is active
 */
function isDebugMode() {
    return process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
}

/**
 * Conditionally log debug message if debug mode is enabled.
 * Wrapper around logger.debug() that checks debug flag automatically.
 *
 * @param {string|object} message - Debug message or object to log
 * @param {...any} args - Additional arguments to pass to logger
 *
 * @example
 * debugLog('[MyModule] Processing request', { userId: 123 });
 * // Only logs if DEBUG=true or NODE_ENV=development
 */
function debugLog(message, ...args) {
    if (isDebugMode()) {
        logger.debug(message, ...args);
    }
}

/**
 * Create a debug logger function for a specific module/component.
 * Returns a function that automatically prefixes messages with the module name.
 *
 * @param {string} moduleName - Name of the module/component for log prefixing
 * @returns {Function} Debug logging function for the module
 *
 * @example
 * const debug = createDebugLogger('AdminAPI');
 * debug('User login successful', { username: 'admin' });
 * // Logs: [AdminAPI] User login successful { username: 'admin' }
 */
function createDebugLogger(moduleName) {
    return function (message, ...args) {
        if (isDebugMode()) {
            const prefixedMessage =
                typeof message === 'string' ? `[${moduleName}] ${message}` : message;
            logger.debug(prefixedMessage, ...args);
        }
    };
}

/**
 * Debug-only function execution.
 * Executes the provided function only if debug mode is enabled.
 * Useful for expensive debug operations that should be skipped in production.
 *
 * @param {Function} fn - Function to execute in debug mode
 * @returns {any} Result of function execution, or undefined if not in debug mode
 *
 * @example
 * debugOnly(() => {
 *   console.log('Complex debug analysis:', analyzeData());
 * });
 */
function debugOnly(fn) {
    if (isDebugMode()) {
        return fn();
    }
}

module.exports = {
    isDebugMode,
    debugLog,
    createDebugLogger,
    debugOnly,
};
