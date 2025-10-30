/**
 * Async Error Handler Middleware
 * Wraps async route handlers to automatically catch and forward errors to Express error handler
 */

/**
 * Wrapper for async routes to catch errors and pass them to the error handler
 * @param {Function} fn - Async route handler function
 * @returns {Function} Wrapped middleware function
 * @example
 * app.get('/api/data', asyncHandler(async (req, res) => {
 *   const data = await fetchData();
 *   res.json(data);
 * }));
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = asyncHandler;
