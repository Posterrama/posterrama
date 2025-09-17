const metricsManager = require('../utils/metrics');
const logger = require('../utils/logger');

// Helper function to get memory info in MB
function getMemoryInfo() {
    const memory = process.memoryUsage();
    return {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        external: Math.round(memory.external / 1024 / 1024),
    };
}

// Helper function to get request size
function getRequestSize(req) {
    return req.get('content-length') ? parseInt(req.get('content-length')) : 0;
}

// Middleware to collect request metrics
const metricsMiddleware = (req, res, next) => {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    // Store original end function
    const originalEnd = res.end;

    // Override end function to capture metrics
    res.end = function (chunk, encoding) {
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        const statusCode = res.statusCode;
        const method = req.method;
        const path = req.route ? req.route.path : req.path;
        const cached = res.get('X-Cache') === 'HIT';
        const endMemory = process.memoryUsage();

        // Calculate memory difference
        const memoryDelta = Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024); // KB

        // Get response size
        const responseSize = chunk ? Buffer.byteLength(chunk) : 0;
        const requestSize = getRequestSize(req);

        // Record the request metrics
        try {
            metricsManager.recordRequest(method, path, responseTime, statusCode, cached);

            // Enhanced performance logging
            const performanceData = {
                method,
                path: path || req.path,
                responseTime,
                statusCode,
                cached,
                memoryDelta: `${memoryDelta}KB`,
                requestSize: `${requestSize}B`,
                responseSize: `${responseSize}B`,
                userAgent: req.get('user-agent'),
                ip: req.ip || req.connection.remoteAddress,
            };

            // Log based on performance thresholds
            if (responseTime > 2000) {
                logger.warn('🐌 Slow request detected', performanceData);
            } else if (responseTime > 1000) {
                logger.verbose('⏱️ Moderate response time', performanceData);
            } else {
                logger.debug('⚡ Request performance', performanceData);
            }

            // Log high memory usage requests
            if (Math.abs(memoryDelta) > 1024) {
                // More than 1MB change
                logger.verbose('🧠 High memory impact request', {
                    ...performanceData,
                    memoryBefore: Math.round(startMemory.heapUsed / 1024 / 1024) + 'MB',
                    memoryAfter: Math.round(endMemory.heapUsed / 1024 / 1024) + 'MB',
                });
            }
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
    connectionTracker,
};
