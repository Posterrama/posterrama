// Rate limiting configuration
const createRateLimiter = (windowMs, max, messageText) => {
    return require('express-rate-limit')({
        windowMs,
        // In test environment, use a lower max for specific rate limiter tests only
        // For general tests that need normal operation, use regular limits
        max: process.env.RATE_LIMIT_TEST === 'strict' ? Math.max(1, Math.floor(max / 50)) : max,
        standardHeaders: true,
        legacyHeaders: false,
        message: req => ({
            error: messageText,
            timestamp: new Date().toISOString(),
            path: req.path,
            method: req.method,
            requestId: req.id || 'unknown',
            retryAfter: Math.ceil(windowMs / 1000), // in seconds
        }),
    });
};

module.exports = {
    createRateLimiter,
};
