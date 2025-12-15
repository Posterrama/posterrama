/**
 * Centralized Environment Variable Configuration
 *
 * This module provides a single source of truth for all environment variables
 * used throughout the application. It includes:
 * - Type coercion (strings to booleans, numbers)
 * - Default values
 * - Validation
 * - Documentation
 *
 * Benefits:
 * - Consistent access patterns across the codebase
 * - Easier testing (mock this module instead of process.env)
 * - Type safety and validation
 * - Clear documentation of all env vars
 *
 * @module config/environment
 */

const logger = require('../utils/logger');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Auto-generate SESSION_SECRET if missing in production
 * This ensures backward compatibility for existing installations
 */
function ensureSessionSecret() {
    if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
        logger.info('SESSION_SECRET missing - auto-generating for backward compatibility');

        const newSecret = crypto.randomBytes(48).toString('base64');
        const envPath = path.resolve(process.cwd(), '.env');

        try {
            // Set in current process FIRST (prevents restart loop)
            process.env.SESSION_SECRET = newSecret;

            // Then save to .env file for future restarts (best-effort, async)
            void (async () => {
                let envContent = '';
                try {
                    envContent = await fs.promises.readFile(envPath, 'utf8');
                    if (!envContent.endsWith('\n')) {
                        envContent += '\n';
                    }
                } catch (err) {
                    // Missing .env is fine; other errors should surface to logging
                    if (err && err.code !== 'ENOENT') {
                        throw err;
                    }
                }

                envContent += `SESSION_SECRET="${newSecret}"\n`;
                await fs.promises.writeFile(envPath, envContent, 'utf8');

                logger.info('✅ SESSION_SECRET generated and saved to .env');
            })()
                .catch(err => {
                    logger.error('Failed to save SESSION_SECRET to .env:', err.message);
                    logger.warn('⚠️  Continuing with in-memory SESSION_SECRET (not persisted)');
                })
                .finally(() => {
                    logger.info('✅ Using auto-generated SESSION_SECRET for this session');
                });
        } catch (err) {
            logger.error('Failed to save SESSION_SECRET to .env:', err.message);
            logger.warn('⚠️  Continuing with in-memory SESSION_SECRET (not persisted)');
            // Don't exit - use the in-memory secret
        }
    }
}

// Auto-generate SESSION_SECRET if needed (before any config access)
ensureSessionSecret();

/**
 * Parse boolean environment variable
 * @param {string} key - Environment variable key
 * @param {boolean} defaultValue - Default value if not set
 * @returns {boolean}
 */
function getBoolean(key, defaultValue = false) {
    const value = process.env[key];
    if (value === undefined || value === '') {
        return defaultValue;
    }
    return value === 'true' || value === '1';
}

/**
 * Parse number environment variable
 * @param {string} key - Environment variable key
 * @param {number} defaultValue - Default value if not set
 * @returns {number}
 */
function getNumber(key, defaultValue = 0) {
    const value = process.env[key];
    if (value === undefined || value === '') {
        return defaultValue;
    }
    const parsed = Number(value);
    if (isNaN(parsed)) {
        logger.warn(
            `[Environment] Invalid number for ${key}: "${value}", using default: ${defaultValue}`
        );
        return defaultValue;
    }
    return parsed;
}

/**
 * Get string environment variable
 * @param {string} key - Environment variable key
 * @param {string} defaultValue - Default value if not set
 * @returns {string}
 */
function getString(key, defaultValue = '') {
    return process.env[key] || defaultValue;
}

/**
 * Get trimmed string (useful for secrets that might have whitespace)
 * @param {string} key - Environment variable key
 * @param {string} defaultValue - Default value if not set
 * @returns {string}
 */
function getTrimmed(key, defaultValue = '') {
    return (process.env[key] || defaultValue).trim();
}

/**
 * Check if environment variable is set (non-empty)
 * @param {string} key - Environment variable key
 * @returns {boolean}
 */
function isSet(key) {
    return !!(process.env[key] || '').trim();
}

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

const server = {
    /** Server port (default: 4000) */
    port: getNumber('SERVER_PORT', 4000),

    /** Node environment (development, production, test) */
    nodeEnv: getString('NODE_ENV', 'development'),

    /** Enable debug mode */
    debug: getBoolean('DEBUG'),

    /** Expose internal endpoints (development only) */
    exposeInternalEndpoints: getBoolean('EXPOSE_INTERNAL_ENDPOINTS'),
};

// =============================================================================
// AUTHENTICATION & SECURITY
// =============================================================================

const auth = {
    /** Admin username */
    adminUsername: getTrimmed('ADMIN_USERNAME'),

    /** Admin password hash (bcrypt) */
    adminPasswordHash: getTrimmed('ADMIN_PASSWORD_HASH'),

    /** Admin 2FA secret (TOTP) */
    admin2FASecret: getTrimmed('ADMIN_2FA_SECRET'),

    /** API access token */
    apiAccessToken: getTrimmed('API_ACCESS_TOKEN'),

    /** Session secret for cookie signing */
    sessionSecret: getTrimmed('SESSION_SECRET'),

    /** Check if admin credentials are configured */
    hasAdminCredentials() {
        return !!this.adminUsername && !!this.adminPasswordHash;
    },

    /** Check if 2FA is enabled */
    has2FA() {
        return !!this.admin2FASecret;
    },

    /** Check if API token is configured */
    hasApiToken() {
        return !!this.apiAccessToken;
    },
};

// =============================================================================
// PLEX CONFIGURATION
// =============================================================================

const plex = {
    /** Plex hostname */
    hostname: getString('PLEX_HOSTNAME'),

    /** Plex port */
    port: getNumber('PLEX_PORT', 32400),

    /** Plex token */
    token: getTrimmed('PLEX_TOKEN'),

    /** Preview page size for admin filters */
    previewPageSize: getNumber('PLEX_PREVIEW_PAGE_SIZE', 200),

    /** Test log level (info, debug, warn) */
    testLogLevel: getString('PLEX_TEST_LOG_LEVEL', 'debug').toLowerCase(),

    /** Slow request warning threshold (ms) */
    slowWarnMs: getNumber('PLEX_SLOW_WARN_MS', 3000),
};

// =============================================================================
// JELLYFIN CONFIGURATION
// =============================================================================

const jellyfin = {
    /** Jellyfin hostname */
    hostname: getString('JELLYFIN_HOSTNAME'),

    /** Jellyfin port */
    port: getNumber('JELLYFIN_PORT', 8096),

    /** Jellyfin API token */
    token: getTrimmed('JELLYFIN_TOKEN'),

    /** Allow insecure HTTPS (self-signed certificates) */
    insecureHttps: getBoolean('JELLYFIN_INSECURE_HTTPS'),

    /** Preview page size for admin filters */
    previewPageSize: getNumber('JF_PREVIEW_PAGE_SIZE', 1000),

    /** Enable HTTP client debug logging */
    httpDebug: getBoolean('JELLYFIN_HTTP_DEBUG'),

    /** Enable Jellyfin debug logging */
    debug: getBoolean('DEBUG_JELLYFIN'),

    /** Enable retry logging */
    retryLogs: getBoolean('JELLYFIN_RETRY_LOGS'),

    /** Test log level (info, debug, warn) */
    testLogLevel: getString('JELLYFIN_TEST_LOG_LEVEL', 'debug').toLowerCase(),

    /** Slow request warning threshold (ms) */
    slowWarnMs: getNumber('JELLYFIN_SLOW_WARN_MS', 3000),
};

// =============================================================================
// ROMM CONFIGURATION
// =============================================================================

const romm = {
    /** ROMM hostname */
    hostname: getString('ROMM_HOSTNAME'),

    /** ROMM port */
    port: getNumber('ROMM_PORT', 8080),

    /** ROMM username */
    username: getString('ROMM_USERNAME'),

    /** ROMM password */
    password: getString('ROMM_PASSWORD'),

    /** Enable HTTP client debug logging */
    httpDebug: getBoolean('ROMM_HTTP_DEBUG'),

    /** Enable ROMM debug logging */
    debug: getBoolean('DEBUG_ROMM'),
};

// =============================================================================
// LOGGING & DEBUGGING
// =============================================================================

const logging = {
    /** Log level (error, warn, info, debug) */
    logLevel: getString('LOG_LEVEL', 'info'),

    /** API request log level */
    apiRequestLogLevel: getString('API_REQUEST_LOG_LEVEL', 'debug'),

    /** API request log sampling rate (0-1) */
    apiRequestLogSample: getNumber('API_REQUEST_LOG_SAMPLE', 0),

    /** Silent mode for tests */
    testSilent: getBoolean('TEST_SILENT'),

    /** Print auth debug messages */
    printAuthDebug: getBoolean('PRINT_AUTH_DEBUG'),

    /** Enable device SSE debugging */
    debugDeviceSSE: getBoolean('DEBUG_DEVICE_SSE'),

    /** Enable performance tracing for admin endpoints */
    perfTraceAdmin: getBoolean('PERF_TRACE_ADMIN'),

    /** Enable CI mode */
    ci: getBoolean('CI'),

    /** Enable test debugging */
    debugTests: getBoolean('DEBUG_TESTS'),
};

// =============================================================================
// FEATURE FLAGS
// =============================================================================

const features = {
    /** Enable device management features */
    deviceManagement: true,

    /** Device store path */
    devicesStorePath: getString('DEVICES_STORE_PATH', 'devices.json'),
};

// =============================================================================
// PERFORMANCE & TIMEOUTS
// =============================================================================

const performance = {
    /** Admin filter preview timeout (ms) */
    adminFilterPreviewTimeoutMs: getNumber('ADMIN_FILTER_PREVIEW_TIMEOUT_MS', 8000),

    /** Startup fetch timeout (ms) */
    startupFetchTimeoutMs: getNumber('STARTUP_FETCH_TIMEOUT_MS', 12000),
};

// =============================================================================
// PM2 & PROCESS MANAGEMENT
// =============================================================================

const pm2 = {
    /** PM2 home directory */
    home: getString('PM2_HOME'),

    /** Check if running under PM2 */
    isEnabled() {
        return !!this.home;
    },
};

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Environment configuration object
 * Organized by functional area for easy access
 */
const env = {
    server,
    auth,
    plex,
    jellyfin,
    romm,
    logging,
    features,
    performance,
    pm2,

    // Helper functions for direct access
    getBoolean,
    getNumber,
    getString,
    getTrimmed,
    isSet,

    /**
     * Validate critical environment variables
     * @throws {Error} If critical vars are missing
     */
    validate() {
        const errors = [];

        // Session secret is required
        if (!auth.sessionSecret) {
            errors.push('SESSION_SECRET is required');
        }

        // If 2FA is enabled, admin credentials must be set
        if (auth.has2FA() && !auth.hasAdminCredentials()) {
            errors.push('ADMIN_2FA_SECRET requires ADMIN_USERNAME and ADMIN_PASSWORD_HASH');
        }

        if (errors.length > 0) {
            throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
        }
    },

    /**
     * Get environment summary (safe for logging, excludes secrets)
     * @returns {Object} Environment summary
     */
    getSummary() {
        return {
            server: {
                port: server.port,
                nodeEnv: server.nodeEnv,
                debug: server.debug,
            },
            auth: {
                hasAdminCredentials: auth.hasAdminCredentials(),
                has2FA: auth.has2FA(),
                hasApiToken: auth.hasApiToken(),
            },
            plex: {
                configured: !!(plex.hostname && plex.token),
                hostname: plex.hostname || '(not set)',
            },
            jellyfin: {
                configured: !!(jellyfin.hostname && jellyfin.token),
                hostname: jellyfin.hostname || '(not set)',
                insecureHttps: jellyfin.insecureHttps,
            },
            features: {
                deviceManagement: features.deviceManagement,
            },
            pm2: {
                enabled: pm2.isEnabled(),
            },
        };
    },
};

// Validate on module load (skip validation in test environment or if SESSION_SECRET is missing)
// Test environments handle validation explicitly as needed
const shouldValidate =
    process.env.NODE_ENV !== 'test' && process.env.SESSION_SECRET && !process.env.TEST_SILENT;

if (shouldValidate) {
    try {
        env.validate();
    } catch (error) {
        logger.error('[Environment] Validation failed:', error.message);
        // Don't throw in production, just log
        if (process.env.NODE_ENV !== 'production') {
            throw error;
        }
    }
}

module.exports = env;
