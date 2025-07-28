const metricsManager = require('../utils/metrics');
const logger = require('../logger');

// Middleware to collect request metrics
const metricsMiddleware = (req, res, next) => {
    const startTime = Date.now();
    
    // Store original end function
    const originalEnd = res.end;
    
    // Override end function to capture metrics
    res.end = function(chunk, encoding) {
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        const statusCode = res.statusCode;
        const method = req.method;
        const path = req.route ? req.route.path : req.path;
        const cached = res.get('X-Cache') === 'HIT';
        
        // Record the request metrics
        try {
            metricsManager.recordRequest(method, path, responseTime, statusCode, cached);
        } catch (error) {
            logger.error('Error recording metrics:', error);
        }
        
        // Call original end function
        originalEnd.call(this, chunk, encoding);
    };
    
    next();
};

// Middleware to track active connections
const connectionTracker = (req, res, next) => {
    // This would be enhanced to track actual connections
    // For now, it's a placeholder for the middleware structure
    next();
};

module.exports = {
    metricsMiddleware,
    connectionTracker
};
