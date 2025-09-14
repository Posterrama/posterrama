const winston = require('winston');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Format messages to handle objects and arrays
const formatMessage = winston.format(info => {
    // Lightweight event bus to signal new logs to any live streams (SSE/WS)
    logger.events = new EventEmitter();
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
    return info;
});

// Custom format for console and file output
const customFormat = winston.format.combine(
    formatMessage(),
    winston.format.timestamp({
        format: () => {
            try {
                const config = require('./config.json');
                const timezone = config.clockTimezone || 'auto';

                if (timezone === 'auto') {
                    return new Date().toLocaleString('sv-SE', {
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        hour12: false,
                    });
                } else {
                    return new Date().toLocaleString('sv-SE', {
                        timeZone: timezone,
                        hour12: false,
                    });
                }
            } catch (e) {
                return new Date().toLocaleString('sv-SE', {
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    hour12: false,
                });
            }
        },
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// In-memory transport for admin panel
const memoryTransport = new winston.transports.Stream({
    format: winston.format.combine(
        formatMessage(),
        winston.format(info => {
            // Get the configured timezone or fallback to system timezone
            let timestamp;
            try {
                const config = require('./config.json');
                const timezone = config.clockTimezone || 'auto';

                if (timezone === 'auto') {
                    // Use local timezone
                    timestamp = new Date()
                        .toLocaleString('sv-SE', {
                            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                            hour12: false,
                        })
                        .replace(' ', 'T');
                } else {
                    // Use configured timezone
                    timestamp = new Date()
                        .toLocaleString('sv-SE', {
                            timeZone: timezone,
                            hour12: false,
                        })
                        .replace(' ', 'T');
                }
            } catch (e) {
                // Fallback to local time if config is not available
                timestamp = new Date()
                    .toLocaleString('sv-SE', {
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        hour12: false,
                    })
                    .replace(' ', 'T');
            }

            return {
                timestamp: timestamp,
                level: info.level.toUpperCase(),
                message: info.message,
            };
        })()
    ),
    stream: new (require('stream').Writable)({
        objectMode: true,
        write: (chunk, encoding, callback) => {
            // Skip system/debug messages for the admin panel
            if (!logger.shouldExcludeFromAdmin(chunk.message)) {
                // Keep only the last 200 logs in memory
                if (logger.memoryLogs.length >= 200) {
                    logger.memoryLogs.shift();
                }
                logger.memoryLogs.push(chunk);
                try {
                    // Emit a real-time event to subscribers
                    logger.events.emit('log', chunk);
                } catch (_) {
                    /* ignore */
                }
            }
            callback();
        },
    }),
});

// Build transports conditionally (skip file transports in test to avoid fs.stat issues with mocks)
const transports = [
    new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
    memoryTransport,
];

if (process.env.NODE_ENV !== 'test') {
    transports.splice(
        1,
        0, // Insert file transports after console
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

// Create the logger instance
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'test' ? 'warn' : process.env.LOG_LEVEL || 'info', // Suppress debug/info during tests
    levels: winston.config.npm.levels,
    format: customFormat,
    transports:
        process.env.NODE_ENV === 'test'
            ? [memoryTransport] // Only memory transport during tests to suppress console output
            : transports,
    silent: process.env.NODE_ENV === 'test' && process.env.TEST_SILENT === 'true', // Allow complete silence for tests
});

// Store logs in memory for admin panel access
logger.memoryLogs = [];

// List of messages to exclude from the admin panel (but still log to files)
const adminPanelExclusions = ['[Request Logger] Received:', '[Auth] Authenticated via session'];

// Helper to check if a message should be excluded from admin panel
logger.shouldExcludeFromAdmin = message => {
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

// Method to get recent logs for admin panel
logger.getRecentLogs = (level = null, limit = 200) => {
    let logs = [...logger.memoryLogs];
    if (level) {
        const levels = { ERROR: 0, WARN: 1, INFO: 2 }; // Match uppercase format from winston
        const requestedLevel = levels[level.toUpperCase()];
        if (requestedLevel !== undefined) {
            logs = logs.filter(log => {
                const logLevelValue = levels[log.level];
                return logLevelValue !== undefined && logLevelValue <= requestedLevel;
            });
        }
    }
    return logs.slice(-limit);
};

module.exports = logger;
