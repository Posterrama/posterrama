/**
 * Test Session Shim Middleware
 * Injects a test admin session in test environments for compatibility
 */

/**
 * Middleware that provides a mock session for test environments
 * @param {Object} req - Express request
 * @param {Object} _res - Express response (unused)
 * @param {Function} next - Express next function
 */
function testSessionShim(req, _res, next) {
    if (process.env.NODE_ENV === 'test') {
        req.session = req.session || {};
        req.session.user = req.session.user || { username: 'test-admin' };
    }
    next();
}

module.exports = testSessionShim;
