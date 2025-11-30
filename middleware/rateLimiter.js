// Rate limiting configuration
const createRateLimiter = (windowMs, max, messageText) => {
    // @ts-ignore - express-rate-limit is callable but require() doesn't map types correctly
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

// Auth-specific rate limiter for sensitive authentication endpoints
// Stricter than general API rate limiting to prevent brute-force attacks
const authLimiter = createRateLimiter(
    15 * 60 * 1000, // 15 minutes
    5, // 5 attempts per window
    'Too many authentication attempts from this IP. Please try again after 15 minutes.'
);

module.exports = {
    createRateLimiter,
    authLimiter,
};
