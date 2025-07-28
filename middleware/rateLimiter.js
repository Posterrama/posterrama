// Rate limiting configuration
const createRateLimiter = (windowMs, max, messageText) => {
    return require('express-rate-limit')({
        windowMs,
        max: process.env.NODE_ENV === 'test' ? Math.floor(max / 10) : max,
        standardHeaders: true,
        legacyHeaders: false,
        message: (req) => ({
            error: messageText,
            timestamp: new Date().toISOString(),
            path: req.path,
            method: req.method,
            requestId: req.id || 'unknown',
            retryAfter: Math.ceil(windowMs / 1000) // in seconds
        })
    });
};

module.exports = {
    createRateLimiter
};
