/**
 * Authentication Middleware Factory
 * Creates isAuthenticated middleware with debug configuration
 */

const { isAuthenticated: isAuthenticatedBase } = require('../lib/auth-helpers');

/**
 * Create authentication middleware with configuration
 * @param {Object} options - Configuration options
 * @param {boolean} options.isDebug - Enable debug mode
 * @returns {Function} Configured authentication middleware
 */
function createIsAuthenticated({ isDebug }) {
    return (req, res, next) => isAuthenticatedBase(req, res, next, { isDebug });
}

module.exports = createIsAuthenticated;
