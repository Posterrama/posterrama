/**
 * WebSocket Message Validator
 * Joi-based validation schemas for WebSocket messages (Issue #5 fix)
 */

const Joi = require('joi');

// Maximum message size (1MB)
const MAX_MESSAGE_SIZE = 1024 * 1024;

// Rate limiting per device (messages per second)
const RATE_LIMIT_PER_SECOND = 10;

const schemas = {
    hello: Joi.object({
        kind: Joi.string().valid('hello').required(),
        deviceId: Joi.string()
            .pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)
            .required()
            .messages({
                'string.pattern.base': 'deviceId must be a valid UUID',
            }),
        secret: Joi.string().min(32).max(128).required().messages({
            'string.min': 'secret must be at least 32 characters',
            'string.max': 'secret must not exceed 128 characters',
        }),
    })
        .required()
        .messages({
            'any.required': 'hello message must include kind, deviceId, and secret',
        }),

    ack: Joi.object({
        kind: Joi.string().valid('ack').required(),
        id: Joi.string()
            .pattern(/^[a-z0-9-]+$/i)
            .required()
            .messages({
                'string.pattern.base': 'id must be alphanumeric with hyphens',
            }),
        status: Joi.string().valid('ok', 'error').required().messages({
            'any.only': 'status must be either "ok" or "error"',
        }),
        // Allow info to be any type: object, string, null, or omitted
        info: Joi.any().optional(),
        error: Joi.string().when('status', {
            is: 'error',
            then: Joi.optional(),
            otherwise: Joi.forbidden(),
        }),
    }).required(),

    ping: Joi.object({
        kind: Joi.string().valid('ping').required(),
        timestamp: Joi.number().integer().positive().optional(),
    }).required(),
};

/**
 * Validate WebSocket message against schema
 * @param {Object} message - Parsed message object
 * @returns {Object} { valid: boolean, error?: string, value?: Object }
 */
function validateMessage(message) {
    // Basic structure check
    if (!message || typeof message !== 'object') {
        return { valid: false, error: 'Message must be an object' };
    }

    if (!message.kind || typeof message.kind !== 'string') {
        return { valid: false, error: 'Message must have a string "kind" field' };
    }

    // Check if kind is recognized
    const schema = schemas[message.kind];
    if (!schema) {
        return {
            valid: false,
            error: `Unknown message kind: ${message.kind}. Valid kinds: ${Object.keys(schemas).join(', ')}`,
        };
    }

    // Schema validation
    const { error, value } = schema.validate(message, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
    });

    if (error) {
        return {
            valid: false,
            error: error.details.map(d => d.message).join('; '),
            details: error.details,
        };
    }

    return { valid: true, value };
}

/**
 * Rate limiter for WebSocket messages per device
 */
class MessageRateLimiter {
    constructor() {
        // deviceId -> { count, resetAt, violations }
        this.deviceMessageCounts = new Map();
    }

    /**
     * Check if device has exceeded rate limit
     * @param {string} deviceId - Device identifier
     * @returns {boolean} true if within limit, false if exceeded
     */
    checkRateLimit(deviceId) {
        const now = Date.now();
        const record = this.deviceMessageCounts.get(deviceId);

        if (!record || now > record.resetAt) {
            // Reset or initialize counter
            this.deviceMessageCounts.set(deviceId, {
                count: 1,
                resetAt: now + 1000, // Reset after 1 second
                violations: 0,
            });
            return true;
        }

        if (record.count >= RATE_LIMIT_PER_SECOND) {
            record.violations++;
            return false;
        }

        record.count++;
        return true;
    }

    /**
     * Get rate limit statistics for a device
     * @param {string} deviceId - Device identifier
     * @returns {Object|null} Rate limit stats or null if not tracked
     */
    getStats(deviceId) {
        const record = this.deviceMessageCounts.get(deviceId);
        if (!record) return null;

        return {
            count: record.count,
            limit: RATE_LIMIT_PER_SECOND,
            violations: record.violations,
            resetAt: record.resetAt,
        };
    }

    /**
     * Clean up tracking for a device (on disconnect)
     * @param {string} deviceId - Device identifier
     */
    cleanup(deviceId) {
        this.deviceMessageCounts.delete(deviceId);
    }

    /**
     * Get all tracked devices
     * @returns {Array} Array of device IDs
     */
    getTrackedDevices() {
        return Array.from(this.deviceMessageCounts.keys());
    }

    /**
     * Clear all tracking data
     */
    reset() {
        this.deviceMessageCounts.clear();
    }
}

module.exports = {
    validateMessage,
    MessageRateLimiter,
    MAX_MESSAGE_SIZE,
    RATE_LIMIT_PER_SECOND,
};
