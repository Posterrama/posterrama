const fsModule = require('fs');
const fs = fsModule.promises;
const path = require('path');
const logger = require('./logger');
const pkg = require('../package.json');

// Health check cache to avoid expensive checks on every request
let healthCheckCache = null;
let cacheTimestamp = 0;

/**
 * Read the current configuration from config.json
 * @returns {Promise<object>} The current configuration
 */
async function readConfig() {
    try {
        const content = await fs.readFile(path.join(__dirname, '../config.json'), 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        logger.error('Failed to read config.json in healthCheck', { error: error.message });
        return { mediaServers: [] }; // fallback to prevent crashes
    }
}
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Basic health check for simple monitoring
 */
function getBasicHealth() {
    return {
        status: 'ok',
        service: 'posterrama',
        version: pkg.version,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    };
}

/**
 * Check if the configuration is valid
 */
async function checkConfiguration() {
    try {
        const config = await readConfig();
        const enabledServers = (config.mediaServers || []).filter(s => s.enabled);

        if (enabledServers.length === 0) {
            return {
                name: 'configuration',
                status: 'warning',
                message:
                    'No media servers are enabled in config.json. The application will run but cannot serve media.',
            };
        }

        return {
            name: 'configuration',
            status: 'ok',
            message: `${enabledServers.length} media server(s) are enabled.`,
            details: {
                enabledServers: enabledServers.length,
                totalServers: (config.mediaServers || []).length,
            },
        };
    } catch (error) {
        return {
            name: 'configuration',
            status: 'error',
            message: `Configuration error: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Check filesystem access
 */
async function checkFilesystem() {
    try {
        // Check if we can read/write to the sessions directory
        const sessionsDir = path.join(__dirname, '..', 'sessions');
        const R_OK = fsModule.constants?.R_OK || 4;
        const W_OK = fsModule.constants?.W_OK || 2;
        await fs.access(sessionsDir, R_OK | W_OK);

        // Check if we can access the image cache directory
        const imageCacheDir = path.join(__dirname, '..', 'image_cache');
        await fs.access(imageCacheDir, R_OK | W_OK);

        // Check if we can access logs directory
        const logsDir = path.join(__dirname, '..', 'logs');
        await fs.access(logsDir, R_OK | W_OK);

        return {
            name: 'filesystem',
            status: 'ok',
            message: 'All required filesystem paths are accessible.',
            details: {
                directories: ['sessions', 'image_cache', 'logs'],
            },
        };
    } catch (error) {
        return {
            name: 'filesystem',
            status: 'error',
            message: `Filesystem access error: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Check media cache status
 */
async function checkMediaCache() {
    try {
        // This would need access to the playlist cache
        // For now, we'll do a basic check
        const imageCacheDir = path.join(__dirname, '..', 'image_cache');
        const stats = await fs.stat(imageCacheDir);
        const files = await fs.readdir(imageCacheDir);

        return {
            name: 'cache',
            status: 'ok',
            message: `Media cache directory is accessible with ${files.length} cached items.`,
            details: {
                itemCount: files.length,
                lastModified: stats.mtime,
            },
        };
    } catch (error) {
        return {
            name: 'cache',
            status: 'warning',
            message: `Media cache check failed: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Check Plex server connectivity
 */
async function checkPlexConnectivity() {
    try {
        // Try to import the testServerConnection function from server utilities
        let testServerConnection;
        try {
            testServerConnection = require('../server').testServerConnection;
        } catch (error) {
            // If import fails, use fallback
            return await checkPlexConnectivityFallback();
        }

        if (!testServerConnection) {
            // Fallback: create a simple connection test
            return await checkPlexConnectivityFallback();
        }

        const config = await readConfig();
        const enabledServers = (config.mediaServers || []).filter(
            s => s.enabled && s.type === 'plex'
        );

        if (enabledServers.length === 0) {
            return {
                name: 'plex_connectivity',
                status: 'ok',
                message: 'No Plex servers are configured.',
                details: { servers: [] },
            };
        }

        const checks = [];
        for (const server of enabledServers) {
            const startTime = Date.now();
            const result = await testServerConnection(server);
            const responseTime = Date.now() - startTime;

            checks.push({
                server: server.name,
                status: result.status,
                message: result.message,
                responseTime,
            });
        }

        const hasErrors = checks.some(check => check.status === 'error');
        const hasWarnings = checks.some(check => check.status === 'warning');

        return {
            name: 'plex_connectivity',
            status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'ok',
            message: `Checked ${checks.length} Plex server(s).`,
            details: { servers: checks },
        };
    } catch (error) {
        // If all else fails, try fallback
        try {
            return await checkPlexConnectivityFallback();
        } catch (fallbackError) {
            return {
                name: 'plex_connectivity',
                status: 'error',
                message: `Plex connectivity check failed: ${error.message}`,
                details: { error: error.message },
            };
        }
    }
}

/**
 * Fallback Plex connectivity check when main function is not available
 */
async function checkPlexConnectivityFallback() {
    try {
        const config = await readConfig();
        const enabledServers = (config.mediaServers || []).filter(
            s => s.enabled && s.type === 'plex'
        );

        if (enabledServers.length === 0) {
            return {
                name: 'plex_connectivity',
                status: 'ok',
                message: 'No Plex servers are configured.',
                details: { servers: [] },
            };
        }

        // Simple connectivity check using basic HTTP request
        const https = require('https');
        const http = require('http');

        const checks = [];
        for (const server of enabledServers) {
            const startTime = Date.now();
            const hostname = process.env[server.hostnameEnvVar];
            const port = process.env[server.portEnvVar] || '32400';

            if (!hostname) {
                checks.push({
                    server: server.name,
                    status: 'error',
                    message: 'Hostname not configured',
                    responseTime: 0,
                });
                continue;
            }

            try {
                // Simple connection test
                const protocol = port === '443' ? https : http;
                const result = await new Promise((resolve, _reject) => {
                    const req = protocol.request(
                        {
                            hostname,
                            port,
                            path: '/',
                            method: 'HEAD',
                            timeout: 5000,
                        },
                        res => {
                            resolve({
                                status: res.statusCode < 400 ? 'ok' : 'warning',
                                message: `HTTP ${res.statusCode}`,
                                responseTime: Date.now() - startTime,
                            });
                        }
                    );

                    req.on('error', error => {
                        resolve({
                            status: 'error',
                            message: error.message,
                            responseTime: Date.now() - startTime,
                        });
                    });

                    req.on('timeout', () => {
                        resolve({
                            status: 'error',
                            message: 'Connection timeout',
                            responseTime: Date.now() - startTime,
                        });
                    });

                    req.end();
                });

                checks.push({
                    server: server.name,
                    ...result,
                });
            } catch (error) {
                checks.push({
                    server: server.name,
                    status: 'error',
                    message: error.message,
                    responseTime: Date.now() - startTime,
                });
            }
        }

        const hasErrors = checks.some(check => check.status === 'error');
        const hasWarnings = checks.some(check => check.status === 'warning');

        return {
            name: 'plex_connectivity',
            status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'ok',
            message: `Checked ${checks.length} Plex server(s) using fallback method.`,
            details: { servers: checks },
        };
    } catch (error) {
        return {
            name: 'plex_connectivity',
            status: 'error',
            message: `Plex connectivity fallback failed: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Perform all health checks
 */
async function performHealthChecks() {
    const checks = [];

    try {
        // Run all checks in parallel where possible
        const [configCheck, fsCheck, cacheCheck, plexCheck] = await Promise.all([
            checkConfiguration(),
            checkFilesystem(),
            checkMediaCache(),
            checkPlexConnectivity(),
        ]);

        checks.push(configCheck);
        checks.push(fsCheck);
        checks.push(cacheCheck);

        if (plexCheck) {
            checks.push(plexCheck);
        }

        // Determine overall status
        const hasErrors = checks.some(check => check.status === 'error');
        const hasWarnings = checks.some(check => check.status === 'warning');

        const overallStatus = hasErrors ? 'error' : hasWarnings ? 'warning' : 'ok';

        return {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            checks,
        };
    } catch (error) {
        logger.error('Health check failed:', error);
        return {
            status: 'error',
            timestamp: new Date().toISOString(),
            checks: [
                {
                    name: 'system',
                    status: 'error',
                    message: `Health check system failure: ${error.message}`,
                    details: { error: error.message },
                },
            ],
        };
    }
}

/**
 * Get cached health check results or perform new checks
 */
async function getDetailedHealth() {
    const now = Date.now();

    // Return cached result if still valid
    if (healthCheckCache && now - cacheTimestamp < CACHE_DURATION) {
        return healthCheckCache;
    }

    // Perform new health checks
    const result = await performHealthChecks();

    // Cache the result
    healthCheckCache = result;
    cacheTimestamp = now;

    return result;
}

module.exports = {
    getBasicHealth,
    getDetailedHealth,
    checkConfiguration,
    checkFilesystem,
    checkMediaCache,
    checkPlexConnectivity,
    __resetCache: () => {
        healthCheckCache = null;
        cacheTimestamp = 0;
    },
};
