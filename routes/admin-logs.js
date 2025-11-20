/**
 * Admin Logs API Routes
 * Provides endpoints for viewing, streaming, and managing application logs
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

/**
 * GET /api/admin/logs
 * Fetch historical logs with pagination and filtering
 * Query params:
 *   - level: Filter by log level (INFO, WARN, ERROR, DEBUG)
 *   - search: Search term to filter log messages
 *   - limit: Number of logs per page (default: 100, max: 1000)
 *   - offset: Number of logs to skip from newest (default: 0)
 */
router.get('/logs', (req, res) => {
    try {
        const level = req.query.level || null;
        const search = req.query.search || null;
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;

        // Get logs from memory buffer (already sorted chronologically)
        let logs = logger.getRecentLogs(level, 2000, 0, false); // Get all from memory

        // Apply search filter if provided
        if (search) {
            const searchLower = search.toLowerCase();
            logs = logs.filter(
                log =>
                    (log.message && log.message.toLowerCase().includes(searchLower)) ||
                    (log.level && log.level.toLowerCase().includes(searchLower))
            );
        }

        // Calculate pagination
        const total = logs.length;
        const startIdx = Math.max(0, total - offset - limit);
        const endIdx = total - offset;
        const paginatedLogs = logs.slice(startIdx, endIdx);

        res.json({
            success: true,
            logs: paginatedLogs,
            pagination: {
                total,
                limit,
                offset,
                hasMore: startIdx > 0,
            },
        });
    } catch (error) {
        logger.error('[Admin Logs API] Error fetching logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch logs',
        });
    }
});

/**
 * GET /api/admin/logs/stream
 * Server-Sent Events (SSE) stream for real-time log updates
 */
router.get('/logs/stream', (req, res) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send initial connection confirmation
    res.write('data: {"type":"connected"}\n\n');

    // Filter function for log events
    const level = req.query.level || null;
    const levelHierarchy = {
        FATAL: 0,
        ERROR: 1,
        WARN: 2,
        INFO: 3,
        DEBUG: 4,
        TRACE: 5,
    };

    const onLog = entry => {
        try {
            // Apply level filter if specified
            if (level) {
                const requestedLevel = levelHierarchy[level.toUpperCase()];
                const entryLevel = levelHierarchy[entry.level.toUpperCase()];
                if (requestedLevel === undefined || entryLevel === undefined) {
                    return; // Skip if unknown level
                }
                if (entryLevel > requestedLevel) {
                    return; // Skip if log is more verbose than requested
                }
            }

            // Send log entry as SSE event
            const data = JSON.stringify({
                type: 'log',
                data: entry,
            });
            res.write(`data: ${data}\n\n`);
        } catch (error) {
            logger.error('[Admin Logs SSE] Error sending log entry:', error);
        }
    };

    // Subscribe to log events
    const logEvents = logger.events;
    logEvents.on('log', onLog);

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
        try {
            res.write('data: {"type":"heartbeat"}\n\n');
        } catch (error) {
            clearInterval(heartbeatInterval);
        }
    }, 30000);

    // Cleanup on client disconnect
    req.on('close', () => {
        logEvents.removeListener('log', onLog);
        clearInterval(heartbeatInterval);
        res.end();
    });
});

/**
 * GET /api/admin/logs/files
 * List available log files in the logs directory
 */
router.get('/logs/files', async (req, res) => {
    try {
        const logsDir = path.join(__dirname, '..', 'logs');
        const files = await fs.readdir(logsDir);

        // Filter for log files and get stats
        const logFiles = [];
        for (const file of files) {
            if (file.endsWith('.log')) {
                const filePath = path.join(logsDir, file);
                const stats = await fs.stat(filePath);
                logFiles.push({
                    name: file,
                    size: stats.size,
                    modified: stats.mtime.toISOString(),
                });
            }
        }

        // Sort by modified date (newest first)
        logFiles.sort((a, b) => new Date(b.modified) - new Date(a.modified));

        res.json({
            success: true,
            files: logFiles,
        });
    } catch (error) {
        logger.error('[Admin Logs API] Error listing log files:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list log files',
        });
    }
});

/**
 * GET /api/admin/logs/download
 * Download a specific log file or current memory logs
 * Query params:
 *   - file: Log filename to download (e.g., 'combined.log')
 *   - format: Export format for memory logs ('txt' or 'json', default: 'txt')
 */
router.get('/logs/download', async (req, res) => {
    try {
        const filename = req.query.file;
        const format = req.query.format || 'txt';

        if (filename) {
            // Download specific log file
            const logsDir = path.join(__dirname, '..', 'logs');
            const filePath = path.join(logsDir, filename);

            // Security check: ensure path is within logs directory
            const realPath = await fs.realpath(filePath).catch(() => null);
            const realLogsDir = await fs.realpath(logsDir);
            if (!realPath || !realPath.startsWith(realLogsDir)) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied',
                });
            }

            // Check if file exists
            const stats = await fs.stat(filePath).catch(() => null);
            if (!stats || !stats.isFile()) {
                return res.status(404).json({
                    success: false,
                    error: 'Log file not found',
                });
            }

            // Stream file to client
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            const fileStream = require('fs').createReadStream(filePath);
            fileStream.pipe(res);
        } else {
            // Export current memory logs
            const logs = logger.getRecentLogs(null, 1000, 0, false);

            if (format === 'json') {
                // JSON format
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename="logs-export.json"');
                res.json({
                    exported: new Date().toISOString(),
                    count: logs.length,
                    logs,
                });
            } else {
                // Plain text format
                res.setHeader('Content-Type', 'text/plain');
                res.setHeader('Content-Disposition', 'attachment; filename="logs-export.txt"');

                const lines = logs.map(
                    log => `${log.timestamp} ${log.level.padEnd(5)} ${log.message}`
                );
                res.send(lines.join('\n'));
            }
        }
    } catch (error) {
        logger.error('[Admin Logs API] Error downloading logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to download logs',
        });
    }
});

/**
 * POST /api/admin/logs/clear
 * Clear the in-memory log buffer (does not delete log files)
 */
router.post('/logs/clear', (req, res) => {
    try {
        const previousCount = logger.memoryLogs.length;
        logger.memoryLogs.length = 0; // Clear the array

        logger.info(`[Admin Logs API] Memory logs cleared (${previousCount} entries removed)`);

        res.json({
            success: true,
            message: `Cleared ${previousCount} logs from memory`,
            cleared: previousCount,
        });
    } catch (error) {
        logger.error('[Admin Logs API] Error clearing logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear logs',
        });
    }
});

/**
 * GET /api/admin/logs/stats
 * Get statistics about current logs
 */
router.get('/logs/stats', (req, res) => {
    try {
        const logs = logger.memoryLogs || [];

        // Count by level
        const levelCounts = logs.reduce((acc, log) => {
            const level = log.level.toUpperCase();
            acc[level] = (acc[level] || 0) + 1;
            return acc;
        }, {});

        // Calculate time range
        const timeRange =
            logs.length > 0
                ? {
                      oldest: logs[0].timestamp,
                      newest: logs[logs.length - 1].timestamp,
                  }
                : null;

        res.json({
            success: true,
            stats: {
                total: logs.length,
                byLevel: levelCounts,
                timeRange,
            },
        });
    } catch (error) {
        logger.error('[Admin Logs API] Error fetching stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch log statistics',
        });
    }
});

module.exports = router;
