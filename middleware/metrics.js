const metricsManager = require('../utils/metrics');
const logger = require('../utils/logger');

// Helper function to get memory info in MB (reserved for future use)
// function getMemoryInfo() {
//     const memory = process.memoryUsage();
//     return {
//         rss: Math.round(memory.rss / 1024 / 1024),
//         heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
//         heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
//         external: Math.round(memory.external / 1024 / 1024),
//     };
// }

// Helper function to get request size
function getRequestSize(req) {
    // Support both Express req.get and plain object headers
    const headerVal =
        typeof req.get === 'function'
            ? req.get('content-length')
            : req.headers?.['content-length'] || req.headers?.['Content-Length'];
    return headerVal ? parseInt(headerVal) : 0;
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
        const cached = res.get?.('X-Cache') === 'HIT';
        const endMemory = process.memoryUsage();

        // Calculate memory difference
        const memoryDelta = Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024); // KB

        // Get response size
        const responseSize = chunk ? Buffer.byteLength(chunk) : 0;
        const requestSize = getRequestSize(req);

        // Record the request metrics
        try {
            metricsManager.recordRequest(method, path, responseTime, statusCode, cached);

            // Enhanced performance logging - only log notable issues
            const performanceData = {
                method,
                path: path || req.path,
                responseTime,
                statusCode,
                cached,
                memoryDelta: `${memoryDelta}KB`,
                requestSize: `${requestSize}B`,
                responseSize: `${responseSize}B`,
                userAgent:
                    (typeof req.get === 'function'
                        ? req.get('user-agent')
                        : req.headers?.['user-agent']) || undefined,
                ip: req.ip || req.connection?.remoteAddress,
            };

            // Only log performance issues, not routine requests
            if (responseTime > 3000) {
                logger.warn('🐌 Very slow request', performanceData);
            } else if (responseTime > 1500) {
                logger.info('⏱️ Slow request', performanceData);
            } else if (statusCode >= 500) {
                logger.error('💥 Server error', performanceData);
            } else if (statusCode >= 400) {
                logger.warn('⚠️ Client error', performanceData);
            }
            // Removed routine "Request performance" logging

            // Only log significant memory usage changes, but exclude endpoints that naturally have large responses
            const isLargeResponseEndpoint =
                [
                    '/get-media',
                    '/api/admin/logs',
                    '/api/v1/media',
                    '/api/admin/config',
                    '/api/admin/preview-media',
                ].some(endpoint => (path || req.path).includes(endpoint)) ||
                // Admin API endpoints with counts/genres/qualities often have large responses
                ((path || req.path).includes('/api/admin/') &&
                    ((path || req.path).includes('-with-counts') ||
                        (path || req.path).includes('-genres') ||
                        (path || req.path).includes('-qualities')));

            // Memory impact warnings removed - not actionable and create log noise
            // if (Math.abs(memoryDelta) > 2048 && !isLargeResponseEndpoint) {
            //     logger.warn('🧠 High memory impact request', { ... });
            // }
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
