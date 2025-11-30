/**
 * Input Validation and Sanitization Middleware
 * Provides comprehensive input validation for API endpoints
 */

const { body, query, param, validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Handle validation errors
 */
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorDetails = errors.array().map(error => {
            const err = /** @type {any} */ (error);
            return {
                field: err.path || err.param,
                message: err.msg,
                value: err.value,
            };
        });

        logger.warn('Validation failed', {
            url: req.url,
            method: req.method,
            errors: errorDetails,
            ip: req.ip,
        });

        return res.status(400).json({
            success: false,
            error: {
                message: 'Validation failed',
                code: 400,
                details: errorDetails,
            },
        });
    }
    next();
}

/**
 * Common validation rules
 */
const validationRules = {
    // Media request validation
    mediaRequest: [
        query('type')
            .optional()
            .isIn(['movie', 'show', 'tv'])
            .withMessage('Type must be movie, show, or tv'),
        query('count')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('Count must be between 1 and 100'),
        query('source')
            .optional()
            .isAlphanumeric()
            .isLength({ max: 50 })
            .withMessage('Source must be alphanumeric and max 50 characters'),
        query('nocache').optional().isBoolean().withMessage('Nocache must be a boolean'),
    ],

    // Admin authentication validation
    adminAuth: [
        body('username')
            .notEmpty()
            .isLength({ min: 1, max: 50 })
            .matches(/^[a-zA-Z0-9_-]+$/)
            .withMessage(
                'Username must be 1-50 characters, letters, numbers, underscore, or dash only'
            ),
        body('password')
            .notEmpty()
            .isLength({ min: 8, max: 200 })
            .withMessage('Password must be 8-200 characters'),
    ],

    // Configuration validation
    configUpdate: [
        body('tmdbApiKey')
            .optional()
            .isLength({ min: 10, max: 100 })
            .matches(/^[a-zA-Z0-9]+$/)
            .withMessage('TMDB API key must be 10-100 alphanumeric characters'),
        body('serverPort')
            .optional()
            .isInt({ min: 1000, max: 65535 })
            .withMessage('Server port must be between 1000 and 65535'),
        body('adminUsername')
            .optional()
            .isLength({ min: 1, max: 50 })
            .matches(/^[a-zA-Z0-9_-]+$/)
            .withMessage(
                'Admin username must be 1-50 characters, alphanumeric with underscore or dash'
            ),
        body('enableDebugMode').optional().isBoolean().withMessage('Debug mode must be a boolean'),
        body('sources').optional().isArray().withMessage('Sources must be an array'),
        body('sources.*.name')
            .optional()
            .isLength({ min: 1, max: 100 })
            .matches(/^[a-zA-Z0-9\s_-]+$/)
            .withMessage(
                'Source name must be 1-100 characters, alphanumeric with spaces, underscore, or dash'
            ),
        body('sources.*.apiKey')
            .optional()
            .isLength({ min: 5, max: 200 })
            .withMessage('API key must be 5-200 characters'),
    ],

    // Image proxy validation
    imageProxy: [
        query('url')
            .notEmpty()
            .isURL({ protocols: ['http', 'https'] })
            .withMessage('URL must be a valid HTTP/HTTPS URL'),
        query('width')
            .optional()
            .isInt({ min: 10, max: 2000 })
            .withMessage('Width must be between 10 and 2000 pixels'),
        query('height')
            .optional()
            .isInt({ min: 10, max: 2000 })
            .withMessage('Height must be between 10 and 2000 pixels'),
    ],

    // Cache management validation
    cacheManagement: [
        body('action')
            .notEmpty()
            .isIn(['clear', 'cleanup', 'stats'])
            .withMessage('Action must be clear, cleanup, or stats'),
        body('type')
            .optional()
            .isIn(['image', 'api', 'response', 'all'])
            .withMessage('Type must be image, api, response, or all'),
    ],

    // Search validation
    search: [
        query('q')
            .notEmpty()
            .isLength({ min: 1, max: 200 })
            .trim()
            .escape()
            .withMessage('Search query must be 1-200 characters'),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 50 })
            .withMessage('Limit must be between 1 and 50'),
    ],

    // Generic ID validation
    id: [
        param('id')
            .notEmpty()
            .matches(/^[a-zA-Z0-9_-]+$/)
            .isLength({ max: 100 })
            .withMessage('ID must be alphanumeric with underscore or dash, max 100 characters'),
    ],

    // Admin request validation (minimal for authenticated routes)
    adminRequest: [
        // No specific validation needed for cache stats - authentication is handled by middleware
    ],

    // Devices: merge validation
    devicesMerge: [
        param('id')
            .notEmpty()
            .matches(/^[a-zA-Z0-9_-]+$/)
            .isLength({ max: 100 })
            .withMessage('ID must be alphanumeric with underscore or dash, max 100 characters'),
        body('sourceIds').isArray({ min: 1 }).withMessage('sourceIds must be a non-empty array'),
        body('sourceIds.*')
            .isString()
            .isLength({ min: 1, max: 100 })
            .matches(/^[a-zA-Z0-9_-]+$/)
            .withMessage('Each source id must be 1-100 chars (alphanumeric, underscore or dash)'),
    ],
};

/**
 * Rate limiting configuration for different endpoint types
 */
const rateLimitRules = {
    // Strict limits for auth endpoints
    auth: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 attempts per window
        message: {
            success: false,
            error: {
                message: 'Too many authentication attempts, please try again later',
                code: 429,
            },
        },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
    },

    // Moderate limits for API endpoints
    api: {
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 60, // 60 requests per minute
        message: {
            success: false,
            error: {
                message: 'Too many API requests, please slow down',
                code: 429,
            },
        },
        standardHeaders: true,
        legacyHeaders: false,
    },

    // Generous limits for media endpoints
    media: {
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 100, // 100 requests per minute
        message: {
            success: false,
            error: {
                message: 'Too many media requests, please slow down',
                code: 429,
            },
        },
        standardHeaders: true,
        legacyHeaders: false,
    },

    // Very strict limits for admin actions
    admin: {
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 10, // 10 admin actions per minute
        message: {
            success: false,
            error: {
                message: 'Too many admin requests, please slow down',
                code: 429,
            },
        },
        standardHeaders: true,
        legacyHeaders: false,
    },
};

/**
 * Sanitize and validate file paths
 */
function sanitizePath(path) {
    if (typeof path !== 'string') return '';

    // Remove any path traversal attempts
    return path
        .replace(/\.\./g, '')
        .replace(/[<>:"|?*]/g, '')
        .replace(/\/+/g, '/')
        .trim();
}

/**
 * Sanitize HTML content
 */
function sanitizeHtml(content) {
    if (typeof content !== 'string') return '';

    return content.replace(/[<>]/g, '').trim();
}

/**
 * Create validation middleware for specific endpoint
 */
function createValidationMiddleware(rules) {
    return [...rules, handleValidationErrors];
}

module.exports = {
    validationRules,
    rateLimitRules,
    handleValidationErrors,
    createValidationMiddleware,
    sanitizePath,
    sanitizeHtml,
};
