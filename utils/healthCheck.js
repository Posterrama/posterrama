const fsModule = require('fs');
const fs = fsModule.promises;
const path = require('path');
const logger = require('./logger');
const pkg = require('../package.json');
const deviceStore = require('./deviceStore');
const metricsManager = require('./metrics');
let GitHubService = null; // lazy-loaded for optional update check to avoid startup cost
const { setTimeout: sleep } = require('timers/promises');

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
 * Check device SLA based on lastSeenAt heartbeat recency.
 * Emits warning/error when devices haven't heartbeated within thresholds.
 */
async function checkDeviceSLA() {
    try {
        const WARN_MIN = Number(process.env.DEVICE_SLA_WARN_MIN || 5); // minutes
        const ERROR_MIN = Number(process.env.DEVICE_SLA_ERROR_MIN || 30); // minutes
        const warnMs = WARN_MIN * 60 * 1000;
        const errorMs = ERROR_MIN * 60 * 1000;
        const now = Date.now();

        const all = (await deviceStore.getAll()) || [];
        const staleWarn = [];
        const staleError = [];

        for (const d of all) {
            const ts = Date.parse(d?.lastSeenAt || 0) || 0;
            if (!ts) continue; // never seen; ignore for SLA
            const age = now - ts;
            if (age >= errorMs) {
                staleError.push({
                    id: d.id,
                    name: d.name || '',
                    location: d.location || '',
                    lastSeenAt: d.lastSeenAt,
                    minutesAgo: Math.round(age / 60000),
                });
            } else if (age >= warnMs) {
                staleWarn.push({
                    id: d.id,
                    name: d.name || '',
                    location: d.location || '',
                    lastSeenAt: d.lastSeenAt,
                    minutesAgo: Math.round(age / 60000),
                });
            }
        }

        const status = staleError.length > 0 ? 'error' : staleWarn.length > 0 ? 'warning' : 'ok';
        const msgParts = [];
        if (staleError.length) msgParts.push(`${staleError.length} device(s) > ${ERROR_MIN}m`);
        if (staleWarn.length) msgParts.push(`${staleWarn.length} device(s) > ${WARN_MIN}m`);

        return {
            name: 'device_sla',
            status,
            message:
                status === 'ok'
                    ? 'All devices within SLA heartbeat thresholds.'
                    : `Stale device heartbeats: ${msgParts.join(', ')}`,
            details: {
                totalDevices: all.length,
                warnThresholdMinutes: WARN_MIN,
                errorThresholdMinutes: ERROR_MIN,
                staleWarnCount: staleWarn.length,
                staleErrorCount: staleError.length,
                examples: [...staleError.slice(0, 5), ...staleWarn.slice(0, 5)], // cap list
            },
        };
    } catch (error) {
        return {
            name: 'device_sla',
            status: 'warning',
            message: `Device SLA check failed: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Check cache efficiency using metricsManager cache stats.
 */
async function checkCacheEfficiency() {
    try {
        const { hitRate, missRate, totalHits, totalMisses } = metricsManager.getCacheMetrics();
        const total = (totalHits || 0) + (totalMisses || 0);
        const WARN_RATE = Number(process.env.CACHE_HITRATE_WARN || 70); // percent
        const ERROR_RATE = Number(process.env.CACHE_HITRATE_ERROR || 40); // percent
        const MIN_REQUESTS = Number(process.env.CACHE_MIN_REQUESTS || 50); // only evaluate after some traffic

        // Default to ok if not enough traffic yet
        if (total < MIN_REQUESTS) {
            return {
                name: 'cache_efficiency',
                status: 'ok',
                message: 'Insufficient traffic to evaluate cache efficiency',
                details: { hitRate, missRate, totalHits, totalMisses, minRequests: MIN_REQUESTS },
            };
        }

        const status = hitRate < ERROR_RATE ? 'error' : hitRate < WARN_RATE ? 'warning' : 'ok';
        return {
            name: 'cache_efficiency',
            status,
            message: `Cache hit rate ${hitRate}% (miss ${missRate}%) over ${total} requests`,
            details: {
                hitRate,
                missRate,
                totalHits,
                totalMisses,
                thresholds: { WARN_RATE, ERROR_RATE },
            },
        };
    } catch (error) {
        return {
            name: 'cache_efficiency',
            status: 'warning',
            message: `Cache efficiency check failed: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Check performance thresholds based on recent p95 and error rate.
 */
async function checkPerformanceThresholds() {
    try {
        const perf = metricsManager.getPerformanceMetrics();
        const errs = metricsManager.getErrorMetrics();
        const p95 = Number(perf?.responseTime?.p95 || 0);
        const ERR_RATE = Number(errs?.errorRate || 0);

        const P95_WARN = Number(process.env.P95_WARN_MS || 1200);
        const P95_ERROR = Number(process.env.P95_ERROR_MS || 3000);
        const ER_WARN = Number(process.env.ERROR_RATE_WARN || 5); // percent
        const ER_ERROR = Number(process.env.ERROR_RATE_ERROR || 15); // percent

        const p95Status = p95 > P95_ERROR ? 'error' : p95 > P95_WARN ? 'warning' : 'ok';
        const erStatus = ERR_RATE > ER_ERROR ? 'error' : ERR_RATE > ER_WARN ? 'warning' : 'ok';
        const status =
            p95Status === 'error' || erStatus === 'error'
                ? 'error'
                : p95Status === 'warning' || erStatus === 'warning'
                  ? 'warning'
                  : 'ok';

        return {
            name: 'performance',
            status,
            message:
                status === 'ok'
                    ? 'Performance within thresholds'
                    : `p95=${p95}ms (warn>${P95_WARN}, err>${P95_ERROR}), errorRate=${ERR_RATE}% (warn>${ER_WARN}, err>${ER_ERROR})`,
            details: {
                p95,
                errorRate: ERR_RATE,
                thresholds: { P95_WARN, P95_ERROR, ER_WARN, ER_ERROR },
            },
        };
    } catch (error) {
        return {
            name: 'performance',
            status: 'warning',
            message: `Performance check failed: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Optionally check for application updates and surface as a warning when available.
 * Controlled by env DASHBOARD_INCLUDE_UPDATE_CHECK === 'true'
 */
async function checkUpdateAvailability() {
    try {
        const include = process.env.DASHBOARD_INCLUDE_UPDATE_CHECK === 'true';
        if (!include) {
            return {
                name: 'update_available',
                status: 'ok',
                message: 'Update check disabled',
            };
        }
        if (!GitHubService) {
            try {
                GitHubService = require('./github');
            } catch (_) {
                GitHubService = null;
            }
        }
        if (!GitHubService || typeof GitHubService.checkForUpdates !== 'function') {
            return {
                name: 'update_available',
                status: 'ok',
                message: 'Update service unavailable',
            };
        }

        const info = await GitHubService.checkForUpdates(pkg.version);
        if (info && info.updateAvailable) {
            return {
                name: 'update_available',
                status: 'warning',
                message: `New version available: v${info.latestVersion}`,
                details: {
                    currentVersion: info.currentVersion,
                    latestVersion: info.latestVersion,
                    releaseUrl: info.releaseUrl,
                    publishedAt: info.publishedAt,
                },
            };
        }
        return {
            name: 'update_available',
            status: 'ok',
            message: 'You are running the latest version',
        };
    } catch (error) {
        // Don't elevate to warning/error for transient network issues; keep quiet unless explicitly desired
        return {
            name: 'update_available',
            status: 'ok',
            message: 'Update check failed (ignored)',
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
 * Check Jellyfin server connectivity
 */
async function checkJellyfinConnectivity() {
    try {
        // Try to import the testServerConnection function from server utilities
        let testServerConnection;
        try {
            testServerConnection = require('../server').testServerConnection;
        } catch (error) {
            // If import fails, use fallback
            return await checkJellyfinConnectivityFallback();
        }

        if (!testServerConnection) {
            // Fallback: create a simple connection test
            return await checkJellyfinConnectivityFallback();
        }

        const config = await readConfig();
        const enabledServers = (config.mediaServers || []).filter(
            s => s.enabled && s.type === 'jellyfin'
        );

        if (enabledServers.length === 0) {
            return {
                name: 'jellyfin_connectivity',
                status: 'ok',
                message: 'No Jellyfin servers are configured.',
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
            name: 'jellyfin_connectivity',
            status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'ok',
            message: `Checked ${checks.length} Jellyfin server(s).`,
            details: { servers: checks },
        };
    } catch (error) {
        // If all else fails, try fallback
        try {
            return await checkJellyfinConnectivityFallback();
        } catch (fallbackError) {
            return {
                name: 'jellyfin_connectivity',
                status: 'error',
                message: `Jellyfin connectivity check failed: ${error.message}`,
                details: { error: error.message },
            };
        }
    }
}

/**
 * Fallback Jellyfin connectivity check when main function is not available
 */
async function checkJellyfinConnectivityFallback() {
    try {
        const config = await readConfig();
        const enabledServers = (config.mediaServers || []).filter(
            s => s.enabled && s.type === 'jellyfin'
        );

        if (enabledServers.length === 0) {
            return {
                name: 'jellyfin_connectivity',
                status: 'ok',
                message: 'No Jellyfin servers are configured.',
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
            const port = process.env[server.portEnvVar] || '8096';

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
                // Simple connection test (HEAD to root)
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
            name: 'jellyfin_connectivity',
            status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'ok',
            message: `Checked ${checks.length} Jellyfin server(s) using fallback method.`,
            details: { servers: checks },
        };
    } catch (error) {
        return {
            name: 'jellyfin_connectivity',
            status: 'error',
            message: `Jellyfin connectivity fallback failed: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Check TMDB connectivity (requires apiKey when enabled).
 */
async function checkTMDBConnectivity() {
    try {
        const config = await readConfig();
        const src = config.tmdbSource || {};
        if (!src.enabled) {
            return {
                name: 'tmdb_connectivity',
                status: 'ok',
                message: 'TMDB source disabled',
            };
        }
        if (!src.apiKey) {
            return {
                name: 'tmdb_connectivity',
                status: 'warning',
                message: 'TMDB API key not configured',
            };
        }

        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 5000);
        let status = 'error';
        let message = 'Request failed';
        let httpStatus = 0;
        const start = Date.now();
        try {
            const r = await fetch(
                `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(
                    src.apiKey
                )}`,
                { method: 'GET', signal: controller.signal }
            );
            httpStatus = r.status;
            if (r.ok) {
                status = 'ok';
                message = 'TMDB reachable';
            } else if (httpStatus >= 400 && httpStatus < 500) {
                status = 'warning';
                message = `TMDB HTTP ${httpStatus}`;
            } else {
                status = 'error';
                message = `TMDB HTTP ${httpStatus}`;
            }
        } catch (e) {
            status = 'error';
            message = e.name === 'AbortError' ? 'TMDB request timeout' : `TMDB error: ${e.message}`;
        } finally {
            clearTimeout(to);
        }
        return {
            name: 'tmdb_connectivity',
            status,
            message,
            details: { httpStatus, responseTime: Date.now() - start },
        };
    } catch (error) {
        return {
            name: 'tmdb_connectivity',
            status: 'error',
            message: `TMDB connectivity check failed: ${error.message}`,
            details: { error: error.message },
        };
    }
}

/**
 * Check TVDB endpoint reachability (lightweight, no auth).
 */
async function checkTVDBConnectivity() {
    try {
        const config = await readConfig();
        const src = config.tvdbSource || {};
        if (!src.enabled) {
            return {
                name: 'tvdb_connectivity',
                status: 'ok',
                message: 'TVDB source disabled',
            };
        }

        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 5000);
        let status = 'error';
        let message = 'Request failed';
        let httpStatus = 0;
        const start = Date.now();
        try {
            const r = await fetch('https://api4.thetvdb.com/v4', {
                method: 'GET',
                signal: controller.signal,
            });
            httpStatus = r.status;
            if (r.ok) {
                status = 'ok';
                message = 'TVDB reachable';
            } else if (httpStatus >= 400 && httpStatus < 500) {
                status = 'warning';
                message = `TVDB HTTP ${httpStatus}`;
            } else {
                status = 'error';
                message = `TVDB HTTP ${httpStatus}`;
            }
        } catch (e) {
            status = 'error';
            message = e.name === 'AbortError' ? 'TVDB request timeout' : `TVDB error: ${e.message}`;
        } finally {
            clearTimeout(to);
        }
        return {
            name: 'tvdb_connectivity',
            status,
            message,
            details: { httpStatus, responseTime: Date.now() - start },
        };
    } catch (error) {
        return {
            name: 'tvdb_connectivity',
            status: 'error',
            message: `TVDB connectivity check failed: ${error.message}`,
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
        const [
            configCheck,
            fsCheck,
            cacheCheck,
            plexCheck,
            jellyfinCheck,
            tmdbCheck,
            tvdbCheck,
            deviceSla,
            cacheEff,
            perf,
            updateAvail,
        ] = await Promise.all([
            checkConfiguration(),
            checkFilesystem(),
            checkMediaCache(),
            checkPlexConnectivity(),
            checkJellyfinConnectivity(),
            checkTMDBConnectivity(),
            checkTVDBConnectivity(),
            checkDeviceSLA(),
            checkCacheEfficiency(),
            checkPerformanceThresholds(),
            checkUpdateAvailability(),
        ]);

        checks.push(configCheck);
        checks.push(fsCheck);
        checks.push(cacheCheck);

        if (plexCheck) checks.push(plexCheck);
        if (jellyfinCheck) checks.push(jellyfinCheck);
        if (tmdbCheck) checks.push(tmdbCheck);
        if (tvdbCheck) checks.push(tvdbCheck);
        if (deviceSla) checks.push(deviceSla);
        if (cacheEff) checks.push(cacheEff);
        if (perf) checks.push(perf);
        if (updateAvail) checks.push(updateAvail);

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
    checkJellyfinConnectivity,
    checkTMDBConnectivity,
    checkTVDBConnectivity,
    checkDeviceSLA,
    checkCacheEfficiency,
    checkPerformanceThresholds,
    checkUpdateAvailability,
    __resetCache: () => {
        healthCheckCache = null;
        cacheTimestamp = 0;
    },
};
