/**
 * Audit Logger for Config Backup Operations
 * Logs all backup operations (create/restore/delete/cleanup) with user, IP, timestamp
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Create audit logger with daily rotation
const auditLogger = winston.createLogger({
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new DailyRotateFile({
            filename: path.join(LOG_DIR, 'backup-audit-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d', // Keep 30 days of audit logs
            zippedArchive: true,
        }),
    ],
});

/**
 * Log an audit event
 * @param {string} action - Action type (e.g., 'backup.created', 'backup.restored')
 * @param {Object} details - Additional details about the action
 * @param {Object} context - Request context (user, IP, etc.)
 */
function auditLog(action, details = {}, context = {}) {
    const entry = {
        action,
        timestamp: new Date().toISOString(),
        user: context.user || 'system',
        ip: context.ip || 'unknown',
        ...details,
    };

    auditLogger.info(entry);
}

/**
 * Extract audit context from Express request
 * @param {Object} req - Express request object
 * @returns {Object} Audit context with user and IP
 */
function getAuditContext(req) {
    return {
        user: req.user?.username || req.user?.email || 'admin',
        ip: req.ip || req.connection?.remoteAddress || 'unknown',
    };
}

module.exports = {
    auditLog,
    getAuditContext,
    auditLogger,
};
