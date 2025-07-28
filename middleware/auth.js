const authManager = require('../utils/auth');
const logger = require('../logger');

// JWT Authentication Middleware
const jwtAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access token required' });
    }

    const token = authHeader.substring(7);
    
    try {
        const decoded = authManager.verifyToken(token);
        req.user = decoded;
        next();
    } catch (error) {
        logger.warn('JWT authentication failed:', error.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

// API Key Authentication Middleware
const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return next(); // Continue to next auth method
    }

    try {
        const keyData = authManager.authenticateApiKey(apiKey);
        req.user = {
            userId: keyData.userId,
            permissions: keyData.permissions,
            authMethod: 'api-key'
        };
        next();
    } catch (error) {
        logger.warn('API key authentication failed:', error.message);
        return res.status(401).json({ error: 'Invalid API key' });
    }
};

// Combined Authentication Middleware (JWT or API Key)
const authenticate = (req, res, next) => {
    // Try API key first
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
        try {
            const keyData = authManager.authenticateApiKey(apiKey);
            req.user = {
                userId: keyData.userId,
                permissions: keyData.permissions,
                authMethod: 'api-key'
            };
            return next();
        } catch (error) {
            logger.warn('API key authentication failed:', error.message);
            return res.status(401).json({ error: 'Invalid API key' });
        }
    }

    // Then try JWT
    return jwtAuth(req, res, next);
};

// Role-based authorization middleware
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (roles.includes(req.user.role) || req.user.role === 'admin') {
            return next();
        }

        logger.warn(`Access denied for user ${req.user.username} with role ${req.user.role}. Required roles: ${roles.join(', ')}`);
        return res.status(403).json({ error: 'Insufficient permissions' });
    };
};

// Permission-based authorization middleware
const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // For API key authentication
        if (req.user.authMethod === 'api-key') {
            if (req.user.permissions.includes(permission) || req.user.permissions.includes('*')) {
                return next();
            }
        } else {
            // For JWT authentication - check user role permissions
            const hasPermission = authManager.hasPermission(req.user, permission);
            if (hasPermission) {
                return next();
            }
        }

        logger.warn(`Permission denied for user ${req.user.username || req.user.userId}. Required permission: ${permission}`);
        return res.status(403).json({ error: `Permission denied. Required: ${permission}` });
    };
};

// Two-Factor Authentication middleware
const requireTwoFactor = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if user has 2FA enabled and verified
    const twoFactorData = authManager.twoFactorSecrets?.get(req.user.userId);
    if (twoFactorData && twoFactorData.enabled) {
        const twoFactorToken = req.headers['x-2fa-token'];
        if (!twoFactorToken) {
            return res.status(403).json({ 
                error: 'Two-factor authentication required',
                requiresTwoFactor: true
            });
        }

        try {
            const verified = authManager.verifyTwoFactor(req.user.userId, twoFactorToken);
            if (!verified) {
                return res.status(403).json({ error: 'Invalid two-factor authentication token' });
            }
        } catch (error) {
            return res.status(403).json({ error: error.message });
        }
    }

    next();
};

// Optional authentication (doesn't require auth but adds user if present)
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];

    if (apiKey) {
        try {
            const keyData = authManager.authenticateApiKey(apiKey);
            req.user = {
                userId: keyData.userId,
                permissions: keyData.permissions,
                authMethod: 'api-key'
            };
        } catch (error) {
            // Ignore API key errors for optional auth
        }
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
            const decoded = authManager.verifyToken(token);
            req.user = decoded;
        } catch (error) {
            // Ignore JWT errors for optional auth
        }
    }

    next();
};

// Session-based authentication (for web interface)
const sessionAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Session authentication required' });
    }

    req.user = req.session.user;
    next();
};

// Middleware to check account lockout
const checkAccountLockout = (req, res, next) => {
    const { username } = req.body;
    if (!username) {
        return next();
    }

    const user = authManager.users?.get(username);
    if (user && user.locked) {
        return res.status(423).json({ 
            error: 'Account locked due to too many failed login attempts',
            lockedUntil: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
        });
    }

    next();
};

module.exports = {
    jwtAuth,
    apiKeyAuth,
    authenticate,
    requireRole,
    requirePermission,
    requireTwoFactor,
    optionalAuth,
    sessionAuth,
    checkAccountLockout
};
