const Joi = require('joi');
const DOMPurify = require('dompurify');
const validator = require('validator');
const { JSDOM } = require('jsdom');

// Initialize DOMPurify with JSDOM for server-side usage
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// Schema definitions
const configSchema = Joi.object({
    config: Joi.object({
        clockWidget: Joi.boolean().required(),
        transitionIntervalSeconds: Joi.number().integer().min(1).max(300).required(),
        backgroundRefreshMinutes: Joi.number().integer().min(1).max(1440).required(),
        showClearLogo: Joi.boolean().required(),
        showPoster: Joi.boolean().required(),
        showMetadata: Joi.boolean().required(),
        showRottenTomatoes: Joi.boolean().required(),
        rottenTomatoesMinimumScore: Joi.number().min(0).max(10).required(),
        kenBurnsEffect: Joi.object({
            enabled: Joi.boolean().required(),
            durationSeconds: Joi.number().integer().min(5).max(60).required()
        }).optional(),
        customMessage: Joi.string().max(500).optional()
    }).required()
});

const plexConnectionSchema = Joi.object({
    hostname: Joi.string().custom((value, helpers) => {
        // Check for valid hostname or IP
        if (!validator.isFQDN(value) && !validator.isIP(value)) {
            return helpers.error('any.invalid');
        }
        return value;
    }).required().messages({
        'any.invalid': 'Invalid hostname format'
    }),
    port: Joi.number().integer().min(1).max(65535).required(),
    token: Joi.string().optional()
});

const queryParamsSchema = Joi.object({
    limit: Joi.number().integer().min(1).max(1000).optional(),
    offset: Joi.number().integer().min(0).optional()
});

// Sanitization function
const sanitizeInput = (obj) => {
    if (typeof obj === 'string') {
        return purify.sanitize(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(sanitizeInput);
    }
    if (obj && typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            sanitized[key] = sanitizeInput(value);
        }
        return sanitized;
    }
    return obj;
};

// Common validation configuration
const validationOptions = {
    abortEarly: false,
    allowUnknown: false, // Reject unknown properties
    stripUnknown: false,  // Don't strip, just reject
    convert: false       // Don't convert types
};

// Validation middleware factory
const createValidationMiddleware = (schema, property = 'body') => {
    return (req, res, next) => {
        const data = req[property];
        
        // Sanitize input first
        const sanitizedData = sanitizeInput(data);
        req[property] = sanitizedData;
        
        // Validate against schema
        const { error, value } = schema.validate(sanitizedData, validationOptions);
        
        if (error) {
            const details = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));
            
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details,
                timestamp: new Date().toISOString(),
                path: req.path,
                method: req.method,
                requestId: req.id || 'unknown'
            });
        }
        
        req[property] = value;
        next();
    };
};

// Query parameter validation middleware
const validateQueryParams = (req, res, next) => {
    const { error, value } = queryParamsSchema.validate(req.query, {
        ...validationOptions,
        allowUnknown: true,    // Allow unknown query params 
        stripUnknown: true     // Remove unknown query params
    });
    
    if (error) {
        return res.status(400).json({
            error: 'Invalid query parameters',
            details: error.details.map(detail => detail.message)
        });
    }
    
    req.query = value;
    next();
};

// Legacy function for backwards compatibility
function validateRequest(schema) {
    const { validate } = require('../validators');
    const { ApiError } = require('../errors');
    
    return (req, res, next) => {
        try {
            const data = req.method === 'GET' ? req.query : req.body;
            req.validatedData = validate(schema, data);
            next();
        } catch (error) {
            next(new ApiError(400, error.message));
        }
    };
}

module.exports = {
    createValidationMiddleware,
    validateQueryParams,
    sanitizeInput,
    validateRequest, // Legacy support
    schemas: {
        config: configSchema,
        plexConnection: plexConnectionSchema,
        queryParams: queryParamsSchema
    }
};
