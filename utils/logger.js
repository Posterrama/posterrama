const winston = require('winston');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

// Create a single, long-lived EventEmitter for admin live events (SSE/WS)
// This must NOT be re-created per log entry; subscribers rely on a stable instance.
const events = new EventEmitter();

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Redaction patterns (case-insensitive) for sensitive tokens/keys
const REDACTION_PATTERNS = [
    /X-Plex-Token=([A-Za-z0-9]+)/gi,
    /X_PLEX_TOKEN=([A-Za-z0-9]+)/gi,
    /PLEX_TOKEN=([A-Za-z0-9]+)/gi,
    /JELLYFIN_API_KEY=([A-Za-z0-9]+)/gi,
    /Authorization:\s*Bearer\s+([A-Za-z0-9._-]+)/gi,
];

function redact(str) {
    if (typeof str !== 'string') return str;
    let out = str;
    for (const re of REDACTION_PATTERNS) {
        out = out.replace(re, (match, p1) => match.replace(p1, '***REDACTED***'));
    }
    return out;
}

// Format messages to handle objects and arrays + redact sensitive substrings
const formatMessage = winston.format(info => {
    if (typeof info.message === 'object' && info.message !== null) {
        try {
            info.message = JSON.stringify(
                info.message,
                (key, value) => {
                    if (key === '_raw' && value) return '[Raw Data Hidden]';
                    return value;
                },
                2
            );
        } catch (e) {
            info.message = '[Unserializable Object]';
        }
    }
    if (typeof info.message === 'string') {
        info.message = redact(info.message);
    }
    // Redact top-level string props commonly used for logging tokens
    for (const k of Object.keys(info)) {
        if (typeof info[k] === 'string') info[k] = redact(info[k]);
    }
    return info;
});

function buildTimestampFormat() {
    return winston.format.timestamp({
        format: () => {
            try {
                const config = require('../config.json');
                const timezone = config.clockTimezone || 'auto';
                const baseOpts = {
                    hour12: false,
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                };
                if (timezone !== 'auto') baseOpts.timeZone = timezone;
                return new Date().toLocaleString('sv-SE', baseOpts);
            } catch (e) {
                return new Date().toLocaleString('sv-SE', {
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    hour12: false,
                });
            }
        },
    });
}

function buildBaseFormat() {
    return winston.format.combine(
        formatMessage(),
        buildTimestampFormat(),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    );
}

// Simple custom transport capturing logs in memory
function createMemoryTransport(inst) {
    const CustomTransport = class extends winston.Transport {
        constructor(opts = {}) {
            super(opts);
            this.name = 'memory';
        }
        log(info, next) {
            setImmediate(() => this.emit('logged', info));
            try {
                const timestamp = new Date().toISOString();
                const entry = {
                    timestamp,
                    level: (info.level || '').toUpperCase(),
                    message:
                        typeof info.message === 'string'
                            ? info.message
                            : JSON.stringify(info.message),
                    ...Object.fromEntries(
                        Object.entries(info).filter(
                            ([key]) => !['timestamp', 'level', 'message'].includes(key)
                        )
                    ),
                };
                if (!inst.shouldExcludeFromAdmin || !inst.shouldExcludeFromAdmin(entry.message)) {
                    if (inst.memoryLogs.length >= 2000) inst.memoryLogs.shift();
                    inst.memoryLogs.push(entry);
                    events.emit('log', entry);
                }
            } catch (e) {
                // swallow
            }
            next();
        }
    };
    return new CustomTransport();
}

function buildTransports(inst, { forTest = false } = {}) {
    const memoryTransport = createMemoryTransport(inst);
    const base = [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        }),
        memoryTransport,
    ];
    if (!forTest) {
        base.splice(
            1,
            0,
            new winston.transports.File({
                filename: path.join(logsDir, 'error.log'),
                level: 'error',
                maxsize: 5242880,
                maxFiles: 5,
            }),
            new winston.transports.File({
                filename: path.join(logsDir, 'combined.log'),
                maxsize: 5242880,
                maxFiles: 5,
            })
        );
    }
    return forTest ? [memoryTransport] : base;
}

function createLoggerInstance(options = {}) {
    const { level, forTest = false, silent, hardSilent = false } = options;
    // Determine base level. In test mode we normally default to 'warn' to keep useful diagnostics
    // while trimming info/debug spam. If QUIET_TEST_LOGS is set, we further clamp to 'error'.
    let resolvedLevel = level || (forTest ? 'warn' : process.env.LOG_LEVEL || 'info');
    if (forTest && process.env.QUIET_TEST_LOGS === '1') {
        resolvedLevel = 'error';
    }
    const inst = winston.createLogger({
        level: resolvedLevel,
        levels: winston.config.npm.levels,
        format: buildBaseFormat(),
        transports: [],
        // In test mode we never fully silence the logger so memory transport still captures
        silent: hardSilent ? true : forTest ? false : (silent ?? false),
    });
    // Attach shared structures
    inst.memoryLogs = [];
    inst.events = events;
    // Utility helpers will be assigned after baseLogger populated
    inst.info = (...args) => inst.log('info', ...args);
    inst.warn = (...args) => inst.log('warn', ...args);
    inst.error = (...args) => inst.log('error', ...args);
    inst.fatal = (...args) => inst.log('error', ...args);
    inst.debug = (...args) => inst.log('debug', ...args);
    inst.__resetMemory = () => {
        inst.memoryLogs.length = 0;
    };
    inst.__ping = () => true;
    // If exclusion helper already defined attach it (baseLogger populated later during module load)
    if (baseLogger.shouldExcludeFromAdmin) {
        inst.shouldExcludeFromAdmin = baseLogger.shouldExcludeFromAdmin;
    }
    if (baseLogger._computeRecentLogs) {
        inst.getRecentLogs = (level = null, limit = 500, offset = 0, testOnly = false) =>
            baseLogger._computeRecentLogs(inst.memoryLogs, level, limit, offset, testOnly);
    }
    if (baseLogger.updateLogLevelFromDebug) {
        inst.updateLogLevelFromDebug = baseLogger.updateLogLevelFromDebug;
    }
    // Build transports after instance so memory transport can reference inst
    const transports = buildTransports(inst, { forTest });
    transports.forEach(t => inst.add(t));
    return inst;
}

// Temporary base object to allow methods reuse in factory without circular assignment
const baseLogger = {};

// Create the default singleton logger (backward compatible)
const logger = createLoggerInstance({ forTest: process.env.NODE_ENV === 'test' });

// Expose factory for tests and advanced scenarios
function createTestLogger(opts = {}) {
    // silent ignored for test loggers (memory still captured)
    const rest = { ...opts };
    delete rest.silent;
    return createLoggerInstance({ forTest: true, hardSilent: false, ...rest });
}

// List of messages to exclude from the admin panel (but still log to files)
const adminPanelExclusions = ['[Request Logger] Received:', '[Auth] Authenticated via session'];

// Helper to check if a message should be excluded from admin panel
baseLogger.shouldExcludeFromAdmin = message => {
    return adminPanelExclusions.some(
        exclusion => typeof message === 'string' && message.includes(exclusion)
    );
};

// Add convenience methods that match console
logger.info = (...args) => logger.log('info', ...args);
logger.warn = (...args) => logger.log('warn', ...args);
logger.error = (...args) => logger.log('error', ...args);
logger.fatal = (...args) => logger.log('error', ...args); // Map fatal to error level
logger.debug = (...args) => logger.log('debug', ...args);

/**
 * Retrieve recent logs from in-memory ring buffer.
 * Ordering semantics:
 *  - Logs are stored oldest -> newest in logger.memoryLogs.
 *  - This function selects from the end (newest) applying offset & limit, but
 *    returns the slice in chronological order (oldest -> newest within the window)
 *    so UI components can append naturally.
 * Filtering semantics:
 *  - level (optional): case-insensitive log level threshold. Using ERROR returns only ERROR,
 *    WARN returns WARN+ERROR, INFO returns INFO+WARN+ERROR, etc. Unknown level -> no filtering.
 *  - testOnly: when true, only logs with marker [TEST-LOG] in message are included.
 * Pagination semantics:
 *  - offset counts from the newest end (offset=0 => newest log included).
 *  - limit defines max number of entries returned.
 * @param {string|null} level Optional level threshold (ERROR|WARN|INFO|DEBUG|TRACE etc.)
 * @param {number} limit Maximum number of entries to return (default 500)
 * @param {number} offset Number of newest logs to skip from the end (default 0)
 * @param {boolean} testOnly Restrict to synthetic test logs containing [TEST-LOG]
 * @returns {Array<{level:string,message:string,timestamp:string}>}
 */
function computeRecentLogs(sourceLogs, level = null, limit = 500, offset = 0, testOnly = false) {
    let logs = [...sourceLogs];

    // Filter for test logs only if requested
    if (testOnly) {
        logs = logs.filter(log => log.message && log.message.includes('[TEST-LOG]'));
    }

    if (level) {
        // Level hierarchy: lower number = more severe, higher number = more verbose
        const levels = {
            FATAL: 0,
            ERROR: 1,
            WARN: 2,
            INFO: 3,
            DEBUG: 4,
            TRACE: 5,
        };
        const requestedLevel = levels[level.toUpperCase()];
        if (requestedLevel !== undefined) {
            logs = logs.filter(log => {
                const logLevelValue = levels[log.level.toUpperCase()];
                return logLevelValue !== undefined && logLevelValue <= requestedLevel;
            });
        }
    }

    // We want the selection based on most recent items (end of array) but
    // preserve their original chronological order inside the returned slice.
    if (offset < 0) offset = 0;
    if (limit < 0) limit = 0;
    const total = logs.length;
    // Calculate slice bounds from the end (newest)
    const sliceEndExclusive = total - offset; // exclude offset items from newest end
    const sliceStart = Math.max(0, sliceEndExclusive - limit);
    const slice = logs.slice(sliceStart, sliceEndExclusive);
    return slice; // already chronological (oldest→newest within requested window)
}

baseLogger.getRecentLogs = (level = null, limit = 500, offset = 0, testOnly = false) => {
    return computeRecentLogs(logger.memoryLogs, level, limit, offset, testOnly);
};
baseLogger._computeRecentLogs = computeRecentLogs;

// Method to update logger level based on DEBUG environment variable
baseLogger.updateLogLevelFromDebug = () => {
    const isDebugEnabled = process.env.DEBUG === 'true';
    const newLevel = isDebugEnabled ? 'debug' : 'info';

    if (logger.level !== newLevel) {
        logger.level = newLevel;

        // Update all transports
        logger.transports.forEach(transport => {
            transport.level = newLevel;
        });

        logger.info('🔧 Log level updated via DEBUG toggle', {
            previousLevel:
                logger.level === newLevel ? 'unknown' : isDebugEnabled ? 'info' : 'debug',
            newLevel,
            debugEnabled: isDebugEnabled,
            source: 'debug_toggle',
            timestamp: new Date().toISOString(),
        });
    }
};

// Wire reused methods onto default logger now that baseLogger has them
logger.shouldExcludeFromAdmin = baseLogger.shouldExcludeFromAdmin;
logger.getRecentLogs = baseLogger.getRecentLogs;
logger.updateLogLevelFromDebug = baseLogger.updateLogLevelFromDebug;

module.exports = logger; // default export (singleton)
module.exports.redact = redact; // pure helper
module.exports.createTestLogger = createTestLogger; // new factory
module.exports._createLoggerInstance = createLoggerInstance; // internal (for future refactors/tests)

// Initialize logger level based on DEBUG environment variable on startup
setTimeout(() => {
    try {
        logger.updateLogLevelFromDebug();
    } catch (error) {
        console.warn('Failed to initialize logger level from DEBUG setting:', error.message);
    }
}, 100); // Small delay to ensure module is fully loaded

// Test helper: reset in-memory logs (does not touch transports)
logger.__resetMemory = () => {
    logger.memoryLogs.length = 0;
};

// No-op utility to increase explicit API surface for tests without side effects
// Useful as a stable probe that the module is initialized
logger.__ping = () => true;
