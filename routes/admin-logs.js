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
                // Enhanced diagnostics format
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader(
                    'Content-Disposition',
                    'attachment; filename="posterrama-diagnostics.txt"'
                );

                const os = require('os');
                const packageJson = require('../package.json');
                const config = require('../config');

                // Helper function to format timestamps in locale time (matching logger format)
                const formatLocaleTimestamp = date => {
                    try {
                        const timezone = config.config?.clockTimezone || 'auto';
                        const baseOpts = {
                            hour12: false,
                            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        };
                        if (timezone !== 'auto') baseOpts.timeZone = timezone;
                        return date.toLocaleString('sv-SE', baseOpts);
                    } catch (e) {
                        return date.toLocaleString('sv-SE', {
                            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                            hour12: false,
                        });
                    }
                };

                // Build comprehensive diagnostic report
                const lines = [];
                const separator = '='.repeat(80);
                const divider = '-'.repeat(80);

                // Header
                lines.push(separator);
                lines.push('                    POSTERRAMA - DIAGNOSTIC LOG EXPORT');
                lines.push(separator);
                lines.push(`Exported: ${formatLocaleTimestamp(new Date())}`);
                lines.push('');

                // System Information
                lines.push('## SYSTEM INFORMATION');
                lines.push(divider);
                lines.push(`Posterrama Version:    ${packageJson.version}`);
                lines.push(`Node.js Version:       ${process.version}`);
                lines.push(`Platform:              ${os.platform()} (${os.arch()})`);
                lines.push(`OS:                    ${os.type()} ${os.release()}`);
                lines.push(`Hostname:              ${os.hostname()}`);
                lines.push('');

                // Server Runtime
                lines.push('## SERVER RUNTIME');
                lines.push(divider);
                const uptime = process.uptime();
                const uptimeStr =
                    uptime < 60
                        ? `${Math.floor(uptime)}s`
                        : uptime < 3600
                          ? `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`
                          : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
                const startTime = formatLocaleTimestamp(new Date(Date.now() - uptime * 1000));
                lines.push(`Server Uptime:         ${uptimeStr} (${startTime})`);
                lines.push(`Process ID:            ${process.pid}`);
                lines.push(`Working Directory:     ${process.cwd()}`);
                lines.push(`Environment:           ${process.env.NODE_ENV || 'production'}`);
                lines.push(`Debug Mode:            ${config.debug || false}`);
                lines.push(`Log Level:             ${process.env.LOG_LEVEL || 'info'}`);
                lines.push('');

                // Resource Usage
                lines.push('## RESOURCE USAGE');
                lines.push(divider);
                const cpus = os.cpus();
                const totalMem = os.totalmem() / 1024 ** 3;
                const freeMem = os.freemem() / 1024 ** 3;
                const memUsage = process.memoryUsage();
                lines.push(`CPU Cores:             ${cpus.length}x ${cpus[0].model}`);
                lines.push(`Total Memory:          ${totalMem.toFixed(2)} GB`);
                lines.push(`Free Memory:           ${freeMem.toFixed(2)} GB`);
                lines.push(
                    `Process Heap Used:     ${(memUsage.heapUsed / 1024 ** 2).toFixed(2)} MB`
                );
                lines.push(
                    `Process Heap Total:    ${(memUsage.heapTotal / 1024 ** 2).toFixed(2)} MB`
                );
                lines.push(`Process RSS:           ${(memUsage.rss / 1024 ** 2).toFixed(2)} MB`);
                lines.push(
                    `Process External:      ${(memUsage.external / 1024 ** 2).toFixed(2)} MB`
                );
                lines.push('');

                // Configuration Summary
                lines.push('## CONFIGURATION');
                lines.push(divider);
                lines.push(`Admin Port:            ${config.port || 4000}`);
                lines.push(`Site Port:             ${config.sitePort || 4001}`);
                lines.push('');

                // Media Sources Status
                const mediaServers = config.mediaServers || [];
                if (mediaServers.length > 0) {
                    lines.push('## MEDIA SOURCES');
                    lines.push(divider);

                    const sourceLastFetch = global.sourceLastFetch || {};
                    logger.debug('[Diagnostics Export] sourceLastFetch:', sourceLastFetch);
                    logger.debug(
                        '[Diagnostics Export] mediaServers:',
                        mediaServers.map(s => ({ name: s.name, type: s.type, enabled: s.enabled }))
                    );

                    mediaServers.forEach(source => {
                        if (!source || !source.type) return;

                        const status = source.enabled !== false ? '\u2713' : '\u2717';
                        const typeUpper = (source.type || 'unknown').toUpperCase().padEnd(10);
                        const name = (source.name || 'Unnamed').padEnd(20);

                        // Mask hostname/port for privacy
                        let maskedUrl = 'N/A';

                        // Handle different URL formats
                        if (source.url) {
                            // ROMM uses full URL
                            try {
                                const urlObj = new URL(source.url);
                                const hostname = urlObj.hostname;
                                const port = urlObj.port ? `:${urlObj.port}` : '';

                                if (hostname.length > 10) {
                                    maskedUrl =
                                        hostname.substring(0, 3) +
                                        '***' +
                                        hostname.substring(hostname.length - 3) +
                                        port;
                                } else {
                                    maskedUrl = hostname.substring(0, 3) + '***' + port;
                                }

                                if (urlObj.protocol !== 'https:') {
                                    maskedUrl = urlObj.protocol + '//' + maskedUrl + '/';
                                }
                            } catch (err) {
                                maskedUrl = 'invalid-url';
                            }
                        } else if (source.hostname) {
                            // Plex/Jellyfin use hostname + port
                            const hostname = source.hostname;
                            const port = source.port || 443;

                            if (hostname.length > 10) {
                                maskedUrl = hostname.substring(0, 3) + '***';
                                if (hostname.includes('.')) {
                                    const parts = hostname.split('.');
                                    maskedUrl += '.' + parts[parts.length - 1];
                                }
                            } else {
                                maskedUrl = hostname.substring(0, 3) + '***';
                            }
                            maskedUrl += ':' + port;
                        }

                        lines.push(`  ${status} ${typeUpper} ${name} ${maskedUrl}`);

                        // Show last fetch time if available
                        // Try both exact match and case-insensitive match (type is lowercase in sourceLastFetch)
                        let fetchInfo = sourceLastFetch[source.name];
                        if (!fetchInfo && source.type) {
                            // Fallback: try lowercase type key (plex, jellyfin, romm)
                            fetchInfo = sourceLastFetch[source.type.toLowerCase()];
                        }

                        if (fetchInfo && fetchInfo.timestamp) {
                            const fetchDate = new Date(fetchInfo.timestamp);
                            const formattedDate = !isNaN(fetchDate)
                                ? formatLocaleTimestamp(fetchDate)
                                : fetchInfo.timestamp;
                            lines.push(`    Last check: ${formattedDate}`);
                        } else {
                            lines.push(`    Last check: pending first check`);
                        }
                    });
                    lines.push('');
                }

                // Integrations
                lines.push('## INTEGRATIONS');
                lines.push(divider);

                if (config.localDirectory?.enabled) {
                    const rootPath = config.localDirectory.rootPath || 'media';
                    lines.push(`Local Directory:       enabled (${rootPath})`);
                }

                if (config.tmdbSource?.enabled && config.tmdbSource.apiKey) {
                    const key = config.tmdbSource.apiKey;
                    const maskedKey = key.substring(0, 3) + '...' + key.substring(key.length - 3);
                    lines.push(`TMDB Integration:      enabled (${maskedKey})`);
                }

                if (config.mqtt?.enabled) {
                    const mqttHost = config.mqtt.broker?.host || 'localhost';
                    const mqttPort = config.mqtt.broker?.port || 1883;
                    lines.push(`MQTT Integration:      enabled (${mqttHost}:${mqttPort})`);
                }

                lines.push('');

                // Log Entries
                lines.push(separator);
                lines.push(`                    LOG ENTRIES (${logs.length} total)`);
                lines.push(separator);
                lines.push('');

                // Format each log entry with details
                logs.forEach((log, index) => {
                    lines.push(`[${index + 1}/${logs.length}] ${log.timestamp}`);
                    lines.push(`${log.level.padEnd(5)} | ${log.message}`);

                    // Add metadata if present (excluding timestamp, level, message)
                    const metaKeys = Object.keys(log).filter(
                        key =>
                            !['timestamp', 'level', 'message'].includes(key) &&
                            !isNaN(parseInt(key)) === false
                    );

                    if (metaKeys.length > 0) {
                        lines.push('       ├─ Details:');
                        metaKeys.forEach((key, idx) => {
                            const value = log[key];
                            const prefix = idx === metaKeys.length - 1 ? '└─' : '├─';

                            if (typeof value === 'object' && value !== null) {
                                lines.push(`       ${prefix} ${key}:`);
                                const jsonStr = JSON.stringify(value, null, 10);
                                const jsonLines = jsonStr.split('\n');
                                jsonLines.forEach(jl => {
                                    lines.push(`       │  ${jl}`);
                                });
                            } else {
                                lines.push(`       ${prefix} ${key}: ${value}`);
                            }
                        });
                    }
                    lines.push('');
                });

                // Footer
                lines.push(separator);
                lines.push('                         END OF LOG EXPORT');
                lines.push(separator);

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
