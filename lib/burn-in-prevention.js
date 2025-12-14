/**
 * Burn-in Prevention Helper Module
 *
 * Backend helper for burn-in prevention configuration.
 * Validates and provides defaults for burn-in prevention settings.
 *
 * @module lib/burn-in-prevention
 */

const logger = require('../utils/logger');

/**
 * Default burn-in prevention configuration
 */
const DEFAULTS = {
    enabled: false,
    level: 'subtle', // subtle | moderate | aggressive
    pixelShift: {
        enabled: true,
        amount: 2, // pixels
        intervalMs: 180000, // 3 minutes
    },
    elementCycling: {
        enabled: true,
        intervalMs: 300000, // 5 minutes
        fadeMs: 500,
    },
    screenRefresh: {
        enabled: false,
        intervalMs: 3600000, // 1 hour
        type: 'blackout', // blackout | colorWipe
        durationMs: 100,
    },
};

/**
 * Level presets - predefined configurations for different protection levels
 * NOTE: Values are intentionally subtle - burn-in prevention should be imperceptible
 */
const LEVEL_PRESETS = {
    subtle: {
        pixelShift: { enabled: true, amount: 1, intervalMs: 300000 }, // 5 min, 1px
        elementCycling: { enabled: false },
        screenRefresh: { enabled: false },
    },
    moderate: {
        pixelShift: { enabled: true, amount: 2, intervalMs: 300000 }, // 5 min, 2px
        elementCycling: { enabled: true, intervalMs: 900000 }, // 15 min
        screenRefresh: { enabled: false },
    },
    aggressive: {
        pixelShift: { enabled: true, amount: 3, intervalMs: 60000 }, // 1 min, 3px
        elementCycling: { enabled: true, intervalMs: 600000 }, // 10 min
        screenRefresh: { enabled: true, intervalMs: 3600000 }, // 1 hour
    },
};

/**
 * Merge user config with defaults, applying level preset if specified
 * @param {object} userConfig - User-provided burn-in prevention config
 * @returns {object} Complete configuration with defaults applied
 */
function resolveConfig(userConfig = {}) {
    if (!userConfig || !userConfig.enabled) {
        return { ...DEFAULTS, enabled: false };
    }

    // Start with defaults
    const resolved = JSON.parse(JSON.stringify(DEFAULTS));
    resolved.enabled = true;

    // Apply level preset if specified
    const level = userConfig.level || 'subtle';
    if (LEVEL_PRESETS[level]) {
        const preset = LEVEL_PRESETS[level];
        resolved.level = level;
        resolved.pixelShift = { ...resolved.pixelShift, ...preset.pixelShift };
        resolved.elementCycling = { ...resolved.elementCycling, ...preset.elementCycling };
        resolved.screenRefresh = { ...resolved.screenRefresh, ...preset.screenRefresh };
    }

    // Apply user overrides (deep merge)
    if (userConfig.pixelShift) {
        resolved.pixelShift = { ...resolved.pixelShift, ...userConfig.pixelShift };
    }
    if (userConfig.elementCycling) {
        resolved.elementCycling = { ...resolved.elementCycling, ...userConfig.elementCycling };
    }
    if (userConfig.screenRefresh) {
        resolved.screenRefresh = { ...resolved.screenRefresh, ...userConfig.screenRefresh };
    }

    return resolved;
}

/**
 * Validate burn-in prevention configuration
 * @param {object} config - Configuration to validate
 * @returns {object} Validation result { valid: boolean, errors: string[] }
 */
function validateConfig(config) {
    const errors = [];

    if (typeof config !== 'object' || config === null) {
        return { valid: false, errors: ['burnInPrevention must be an object'] };
    }

    // Validate level
    if (config.level && !['subtle', 'moderate', 'aggressive'].includes(config.level)) {
        errors.push(`Invalid level: ${config.level}. Must be subtle, moderate, or aggressive`);
    }

    // Validate pixelShift
    if (config.pixelShift) {
        const ps = config.pixelShift;
        if (ps.amount !== undefined && (ps.amount < 1 || ps.amount > 10)) {
            errors.push('pixelShift.amount must be between 1 and 10');
        }
        if (ps.intervalMs !== undefined && (ps.intervalMs < 10000 || ps.intervalMs > 3600000)) {
            errors.push('pixelShift.intervalMs must be between 10000 (10s) and 3600000 (1h)');
        }
    }

    // Validate elementCycling
    if (config.elementCycling) {
        const ec = config.elementCycling;
        if (ec.intervalMs !== undefined && (ec.intervalMs < 30000 || ec.intervalMs > 3600000)) {
            errors.push('elementCycling.intervalMs must be between 30000 (30s) and 3600000 (1h)');
        }
        if (ec.fadeMs !== undefined && (ec.fadeMs < 0 || ec.fadeMs > 2000)) {
            errors.push('elementCycling.fadeMs must be between 0 and 2000');
        }
    }

    // Validate screenRefresh
    if (config.screenRefresh) {
        const sr = config.screenRefresh;
        if (sr.type && !['blackout', 'colorWipe'].includes(sr.type)) {
            errors.push('screenRefresh.type must be blackout or colorWipe');
        }
        if (sr.intervalMs !== undefined && (sr.intervalMs < 60000 || sr.intervalMs > 86400000)) {
            errors.push('screenRefresh.intervalMs must be between 60000 (1m) and 86400000 (24h)');
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Get client-side configuration for frontend module
 * Filters out any sensitive or unnecessary data
 * @param {object} config - Full configuration object
 * @returns {object} Client-safe burn-in prevention config
 */
function getClientConfig(config) {
    const burnInConfig = config?.burnInPrevention;
    const resolved = resolveConfig(burnInConfig);

    // Return only what the frontend needs
    return {
        enabled: resolved.enabled,
        level: resolved.level,
        pixelShift: resolved.pixelShift,
        elementCycling: resolved.elementCycling,
        screenRefresh: resolved.screenRefresh,
    };
}

/**
 * Log burn-in prevention status at startup
 * @param {object} config - Configuration object
 */
function logStatus(config) {
    const resolved = resolveConfig(config?.burnInPrevention);

    if (!resolved.enabled) {
        logger.debug('[Burn-in Prevention] Disabled');
        return;
    }

    logger.info(`[Burn-in Prevention] Enabled with level: ${resolved.level}`);
    if (resolved.pixelShift.enabled) {
        logger.debug(
            `  - Pixel shift: ${resolved.pixelShift.amount}px every ${resolved.pixelShift.intervalMs / 1000}s`
        );
    }
    if (resolved.elementCycling.enabled) {
        logger.debug(`  - Element cycling: every ${resolved.elementCycling.intervalMs / 1000}s`);
    }
    if (resolved.screenRefresh.enabled) {
        logger.debug(
            `  - Screen refresh (${resolved.screenRefresh.type}): every ${resolved.screenRefresh.intervalMs / 60000}min`
        );
    }
}

module.exports = {
    DEFAULTS,
    LEVEL_PRESETS,
    resolveConfig,
    validateConfig,
    getClientConfig,
    logStatus,
};
