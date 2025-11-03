const logger = require('../utils/logger');

/**
 * Middleware to add user context to all logs
 * Enriches logging with session info, IP addresses, and user actions
 */
const userContextMiddleware = (req, res, next) => {
    // Extract user context information
    const userContext = {
        ip:
            req.ip ||
            req.connection.remoteAddress ||
            req.headers['x-forwarded-for']?.split(',')[0]?.trim(),
        userAgent: req.get('user-agent'),
        sessionId: req.session?.id || req.sessionID,
        isAdmin: Boolean(req.session?.user),
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        referer: req.get('referer'),
        origin: req.get('origin'),
    };

    // Add user context to request for use in other middleware/routes
    req.userContext = userContext;

    // Only log significant user actions, not routine admin operations
    if (req.method !== 'GET' || req.path.includes('/api/')) {
        const actionType = getActionType(req);

        // Skip routine admin action logging to reduce noise
        // if (actionType === 'admin_action') {
        //     logger.info('👤 Admin action', {
        //         ...userContext,
        //         action: `${req.method} ${req.path}`,
        //         body: req.method !== 'GET' ? sanitizeRequestBody(req.body) : undefined,
        //     });
        // } else
        if (actionType === 'api_access') {
            // Skip logging for noisy admin/monitoring endpoints
            const isNoisyEndpoint =
                req.path &&
                (req.path.startsWith('/api/admin/performance') ||
                    req.path.startsWith('/api/v1/metrics') ||
                    req.path.startsWith('/api/admin/metrics') ||
                    req.path.startsWith('/api/admin/logs') ||
                    req.path.startsWith('/api/admin/status') ||
                    req.path.startsWith('/api/plex/sessions'));

            if (!isNoisyEndpoint) {
                logger.debug('🔌 API access', {
                    ...userContext,
                    endpoint: req.path,
                    query: Object.keys(req.query).length > 0 ? req.query : undefined,
                });
            }
        } else if (actionType === 'auth_action') {
            logger.info('🔐 Authentication action', {
                ...userContext,
                action: req.path,
            });
        }
    }

    next();
};
/**
 * Determine the type of action based on the request
 */
function getActionType(req) {
    const path = req.path.toLowerCase();

    if (path.includes('/admin') && !path.includes('/logout') && !path.includes('/login')) {
        return 'admin_action';
    }

    if (path.includes('/login') || path.includes('/logout') || path.includes('/auth')) {
        return 'auth_action';
    }

    if (path.startsWith('/api/')) {
        return 'api_access';
    }

    return 'user_action';
}

/**
 * Middleware to log successful login attempts
 */
const loginSuccessMiddleware = (req, res, next) => {
    if (req.session?.user) {
        logger.info('✅ Admin login successful', {
            username: req.session.user.username,
            ip: req.userContext?.ip || req.ip,
            userAgent: req.get('user-agent'),
            sessionId: req.sessionID,
            timestamp: new Date().toISOString(),
        });
    }
    next();
};

/**
 * Middleware to log logout attempts
 */
const logoutMiddleware = (req, res, next) => {
    if (req.session?.user) {
        logger.info('👋 Admin logout', {
            username: req.session.user.username,
            ip: req.userContext?.ip || req.ip,
            sessionId: req.sessionID,
            sessionDuration: req.session.cookie?.maxAge
                ? `${Math.round((Date.now() - req.session.cookie.originalMaxAge + req.session.cookie.maxAge) / 1000 / 60)}m`
                : 'unknown',
            timestamp: new Date().toISOString(),
        });
    }
    next();
};
module.exports = {
    userContextMiddleware,
    loginSuccessMiddleware,
    logoutMiddleware,
};
