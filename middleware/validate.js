// Validation middleware & helpers for request data
const Joi = require('joi');
const DOMPurify = require('dompurify');
const validator = require('validator');
const { JSDOM } = require('jsdom');

// Provide a lazily-created DOMPurify instance (tests mock dompurify module)
let purifyInstance;
function getPurify() {
    // In test environment always create a fresh instance so per-test mocks of DOMPurify.sanitize apply
    if (process.env.NODE_ENV === 'test') {
        const window = new JSDOM('').window;
        return DOMPurify(window);
    }
    if (!purifyInstance) {
        const window = new JSDOM('').window;
        purifyInstance = DOMPurify(window);
    }
    return purifyInstance;
}

// Schemas
const configSchema = Joi.object({
    config: Joi.object({
        clockWidget: Joi.boolean().required(),
        clockTimezone: Joi.string().default('auto').optional(),
        clockFormat: Joi.string().valid('12h', '24h').default('24h').optional(),
        transitionIntervalSeconds: Joi.number().integer().min(1).max(300).required(),
        backgroundRefreshMinutes: Joi.number().integer().min(1).max(1440).required(),
        showClearLogo: Joi.boolean().required(),
        showPoster: Joi.boolean().required(),
        showMetadata: Joi.boolean().required(),
        showRottenTomatoes: Joi.boolean().required(),
        rottenTomatoesMinimumScore: Joi.number().min(0).max(10).required(),
        kenBurnsEffect: Joi.object({
            enabled: Joi.boolean().required(),
            durationSeconds: Joi.number().integer().min(5).max(60).required(),
        }).optional(),
        mediaServers: Joi.object({
            plex: Joi.object({
                hostname: Joi.string().required(),
                port: Joi.number().integer().min(1).max(65535).required(),
                token: Joi.string().required(),
                ssl: Joi.boolean().optional(),
            }).optional(),
        }).optional(),
        customMessage: Joi.string().max(500).optional(),
    }).required(),
});

const plexConnectionSchema = Joi.object({
    hostname: Joi.string()
        .custom((value, helpers) => {
            if (!validator.isFQDN(value) && !validator.isIP(value)) {
                return helpers.error('any.invalid');
            }
            return value;
        })
        .required()
        .messages({
            'any.invalid': 'Invalid hostname format',
        }),
    port: Joi.number().integer().min(1).max(65535).required(),
    token: Joi.string().optional(),
});

const queryParamsSchema = Joi.object({
    limit: Joi.number().integer().min(1).max(1000).optional(),
    offset: Joi.number().integer().min(0).optional(),
});

// Public API endpoint schemas
const getConfigQuerySchema = Joi.object({
    // No query parameters expected for get-config endpoint
    // Accept any parameters but strip them during validation
}).unknown(true);

const getMediaQuerySchema = Joi.object({
    search: Joi.string().max(200).optional(),
    year: Joi.number().integer().min(1900).max(2100).optional(),
    genre: Joi.string().max(50).optional(),
    // Optional source filter: restrict results to a single origin
    // Allowed values reflect primary sources integrated in Posterrama
    source: Joi.string()
        .valid('plex', 'jellyfin', 'tmdb', 'local', 'romm')
        .insensitive()
        .optional(),
    limit: Joi.number().integer().min(1).max(1000).optional(),
    offset: Joi.number().integer().min(0).optional(),
    // Optional flag to include extras (trailers, theme music) in the response
    // When true, fetches additional metadata from Plex/Jellyfin
    includeExtras: Joi.boolean().optional(),
    // Optional flag to exclude games from results (for screensaver/cinema modes)
    // Accepts boolean or string values: true, "true", "1", 1
    excludeGames: Joi.alternatives()
        .try(Joi.boolean(), Joi.string().valid('1', 'true', 'false', '0'), Joi.number().valid(0, 1))
        .optional(),
});

const imageQuerySchema = Joi.object({
    // Either server+path OR url is required
    server: Joi.string().max(100).optional(),
    path: Joi.string().max(500).optional(),
    url: Joi.string()
        .uri({
            scheme: ['http', 'https'],
        })
        .optional(),
    // Optional image processing parameters
    width: Joi.number().integer().min(1).max(4000).optional(),
    height: Joi.number().integer().min(1).max(4000).optional(),
    quality: Joi.number().integer().min(1).max(100).optional(),
})
    .or('url', 'server')
    .with('server', 'path')
    .messages({
        'object.missing': 'Either URL parameter or both server and path parameters are required',
    });

const mediaKeyParamSchema = Joi.object({
    key: Joi.string()
        .pattern(/^[a-zA-Z0-9\-_]+$/)
        .max(100)
        .required()
        .messages({
            'string.pattern.base':
                'Key must contain only alphanumeric characters, hyphens, and underscores',
            'string.max': 'Key must not exceed 100 characters',
            'any.required': 'Key parameter is required',
        }),
});

// Recursively sanitize strings; guard against circular references.
const circularGuard = new WeakSet();
function sanitizeInput(obj) {
    if (typeof obj === 'string') {
        try {
            // Additional sanitization for common attack vectors
            let sanitized = getPurify().sanitize(obj);

            // Remove potential script/javascript protocols
            sanitized = sanitized.replace(/^javascript:/i, '');
            sanitized = sanitized.replace(/^data:.*?script/i, '');

            // Validate against common injection patterns
            if (sanitized.match(/<script|javascript:|data:.*?script|on\w+\s*=/i)) {
                return ''; // Return empty string for obvious attack attempts
            }

            return sanitized;
        } catch (_) {
            return obj;
        }
    }
    if (Array.isArray(obj)) return obj.map(sanitizeInput);
    if (obj && typeof obj === 'object') {
        if (circularGuard.has(obj)) return obj; // prevent infinite recursion
        circularGuard.add(obj);
        const out = {};
        for (const [k, v] of Object.entries(obj)) out[k] = sanitizeInput(v);
        return out;
    }
    return obj;
}

const baseValidationOptions = {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: false,
    convert: true, // allow string->number etc. (queries & body numeric fields)
};

function createValidationMiddleware(schema, property = 'body') {
    return (req, res, next) => {
        if (!Object.prototype.hasOwnProperty.call(req, property)) {
            return res.status(400).json({
                success: false,
                error: `Validation failed: request property '${property}' is missing`,
                details: [],
                timestamp: new Date().toISOString(),
                path: req.path,
                method: req.method,
                requestId: req.id || 'unknown',
            });
        }
        const data = req[property];
        const sanitized = sanitizeInput(data);
        req[property] = sanitized;
        const { error, value } = schema.validate(sanitized, baseValidationOptions);
        if (error) {
            const details = error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message,
            }));
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details,
                timestamp: new Date().toISOString(),
                path: req.path,
                method: req.method,
                requestId: req.id || 'unknown',
            });
        }
        req[property] = value;
        return next();
    };
}

function validateQueryParams(req, res, next) {
    const raw = { ...req.query };

    // Sanitize all query parameters first
    const sanitized = sanitizeInput(raw);

    const { error, value } = queryParamsSchema.validate(sanitized, {
        ...baseValidationOptions,
        stripUnknown: true,
    });
    if (error) {
        return res.status(400).json({
            error: 'Invalid query parameters',
            details: error.details.map(d => d.message),
        });
    }
    // Keep only validated keys, preserving original (string) representations used in tests
    const rebuilt = {};
    Object.keys(value).forEach(k => {
        if (Object.prototype.hasOwnProperty.call(raw, k)) rebuilt[k] = raw[k];
    });
    req.query = rebuilt;
    return next();
}

// Specific validation middleware for public API endpoints
function validateGetConfigQuery(req, res, next) {
    const sanitized = sanitizeInput(req.query || {});
    const { error } = getConfigQuerySchema.validate(sanitized, {
        ...baseValidationOptions,
        stripUnknown: true,
    });

    if (error) {
        return res.status(400).json({
            error: 'Invalid query parameters',
            details: error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message,
            })),
            timestamp: new Date().toISOString(),
        });
    }

    // For get-config, we ignore query parameters, so just set to empty object
    req.query = {};
    return next();
}

function validateGetMediaQuery(req, res, next) {
    const sanitized = sanitizeInput(req.query || {});
    const { error, value } = getMediaQuerySchema.validate(sanitized, {
        ...baseValidationOptions,
        stripUnknown: true,
    });

    if (error) {
        return res.status(400).json({
            error: 'Invalid query parameters',
            details: error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message,
            })),
            timestamp: new Date().toISOString(),
        });
    }

    req.query = value;
    return next();
}

function validateImageQuery(req, res, next) {
    const sanitized = sanitizeInput(req.query || {});
    const { error, value } = imageQuerySchema.validate(sanitized, baseValidationOptions);

    if (error) {
        return res.status(400).json({
            error: 'Invalid image parameters',
            details: error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message,
            })),
            timestamp: new Date().toISOString(),
        });
    }

    req.query = value;
    return next();
}

function validateMediaKeyParam(req, res, next) {
    const sanitized = sanitizeInput(req.params || {});
    const { error, value } = mediaKeyParamSchema.validate(sanitized, baseValidationOptions);

    if (error) {
        return res.status(400).json({
            error: 'Invalid media key parameter',
            details: error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message,
            })),
            timestamp: new Date().toISOString(),
        });
    }

    req.params = value;
    return next();
}

// Legacy validation function kept for backwards compatibility with older code/tests
function validateRequest(schemaKey) {
    const { validate } = require('../config/validators');
    return (req, _res, next) => {
        try {
            const payload = req.method === 'GET' ? req.query : req.body;
            req.validatedData = validate(schemaKey, payload);
            return next();
        } catch (err) {
            const message = err.message.replace(/^Validation error:\s*/i, '');
            return next(new (require('../utils/errors').ApiError)(400, message));
        }
    };
}

module.exports = {
    createValidationMiddleware,
    validateQueryParams,
    validateGetConfigQuery,
    validateGetMediaQuery,
    validateImageQuery,
    validateMediaKeyParam,
    sanitizeInput,
    validateRequest,
    schemas: {
        config: configSchema,
        plexConnection: plexConnectionSchema,
        queryParams: queryParamsSchema,
        getConfigQuery: getConfigQuerySchema,
        getMediaQuery: getMediaQuerySchema,
        imageQuery: imageQuerySchema,
        mediaKeyParam: mediaKeyParamSchema,
    },
};
