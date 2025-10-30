/**
 * Server Connection Testing Module
 *
 * Provides lightweight connection testing for media servers (Plex, Jellyfin).
 * Tests authentication, reachability, and measures response times with configurable thresholds.
 *
 * @module lib/server-test-helpers
 */

const logger = require('../utils/logger');
const { createPlexClient } = require('./plex-helpers');
const { createJellyfinClient } = require('./jellyfin-helpers');

/**
 * Tests connection to a media server with response time metrics and error handling.
 * Supports Plex and Jellyfin server types with configurable logging levels and slow thresholds.
 *
 * @param {Object} serverConfig - Server configuration object
 * @param {string} serverConfig.type - Server type ('plex' or 'jellyfin')
 * @param {string} serverConfig.name - Server display name
 * @param {string} serverConfig.hostname - Server hostname or IP
 * @param {number} serverConfig.port - Server port number
 * @param {string} serverConfig.tokenEnvVar - Environment variable name containing auth token/API key
 * @returns {Promise<{status: string, message: string}>} Test result with status ('ok' or 'error') and message
 *
 * @example
 * const result = await testServerConnection({
 *   type: 'plex',
 *   name: 'Home Plex',
 *   hostname: '192.168.1.100',
 *   port: 32400,
 *   tokenEnvVar: 'PLEX_TOKEN_HOME_PLEX'
 * });
 * if (result.status === 'ok') {
 *   console.log('Connection successful!');
 * }
 */
async function testServerConnection(serverConfig) {
    if (serverConfig.type === 'plex') {
        const startTime = process.hrtime();

        logger.debug('Testing Plex server connection', {
            action: 'plex_connection_test',
            server: {
                name: serverConfig.name,
                hostname: serverConfig.hostname,
                port: serverConfig.port,
            },
        });

        try {
            const hostname = serverConfig.hostname;
            const port = serverConfig.port;
            const token = process.env[serverConfig.tokenEnvVar];

            if (!hostname || !port || !token) {
                throw new Error('Missing required connection details (hostname, port, or token).');
            }

            const testClient = await createPlexClient({
                hostname,
                port,
                token,
                timeout: 5000, // 5-second timeout for health checks
            });

            // A lightweight query to check reachability and authentication
            await testClient.query('/');

            // Calculate response time
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const responseTime = seconds * 1000 + nanoseconds / 1000000;

            // Log success with metrics (demoted by default to reduce noise)
            const plexLogLevel = (process.env.PLEX_TEST_LOG_LEVEL || 'debug').toLowerCase(); // info|debug|warn
            const plexLog = logger[plexLogLevel] || logger.debug;
            plexLog('Plex server connection test successful', {
                action: 'plex_connection_success',
                server: {
                    name: serverConfig.name,
                    hostname: hostname,
                    port: port,
                },
                metrics: {
                    responseTime: `${responseTime.toFixed(2)}ms`,
                },
            });

            // Log warning if connection was slow (configurable threshold)
            const plexSlowMs = Number(process.env.PLEX_SLOW_WARN_MS || 3000);
            if (responseTime > plexSlowMs) {
                logger.warn('Slow Plex server response detected', {
                    action: 'plex_connection_slow',
                    server: {
                        name: serverConfig.name,
                        hostname: hostname,
                        port: port,
                    },
                    responseTime: `${responseTime.toFixed(2)}ms`,
                    thresholdMs: plexSlowMs,
                });
            }

            return { status: 'ok', message: 'Connection successful.' };
        } catch (error) {
            let errorMessage = error.message;
            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Connection refused. Check hostname and port.';

                logger.error('Plex server connection refused', {
                    action: 'plex_connection_refused',
                    server: {
                        name: serverConfig.name,
                        hostname: serverConfig.hostname,
                        port: serverConfig.port,
                    },
                    error: {
                        code: error.code,
                        message: error.message,
                    },
                });
            } else if (error.message.includes('401 Unauthorized')) {
                errorMessage = 'Unauthorized. Check token.';
            } else if (error.code === 'ETIMEDOUT') {
                errorMessage = 'Connection timed out.';
            }
            return { status: 'error', message: `Plex connection failed: ${errorMessage}` };
        }
    } else if (serverConfig.type === 'jellyfin') {
        const startTime = process.hrtime();

        logger.debug('Testing Jellyfin server connection', {
            action: 'jellyfin_connection_test',
            server: {
                name: serverConfig.name,
                hostname: serverConfig.hostname,
                port: serverConfig.port,
            },
        });

        try {
            const hostname = serverConfig.hostname;
            const port = serverConfig.port;
            const apiKey = process.env[serverConfig.tokenEnvVar];

            if (!hostname || !port || !apiKey) {
                throw new Error(
                    'Missing required connection details (hostname, port, or API key).'
                );
            }

            const testClient = await createJellyfinClient({
                hostname,
                port,
                apiKey,
                timeout: 5000, // 5-second timeout for health checks
            });

            // A lightweight query to check reachability and authentication
            await testClient.testConnection();

            // Calculate response time
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const responseTime = seconds * 1000 + nanoseconds / 1000000;

            // Log success with metrics (demoted by default to reduce noise)
            const jfLogLevel = (process.env.JELLYFIN_TEST_LOG_LEVEL || 'debug').toLowerCase(); // info|debug|warn
            const jfLog = logger[jfLogLevel] || logger.debug;
            jfLog('Jellyfin server connection test successful', {
                action: 'jellyfin_connection_success',
                server: {
                    name: serverConfig.name,
                    hostname: hostname,
                    port: port,
                },
                metrics: {
                    responseTime: `${responseTime.toFixed(2)}ms`,
                },
            });

            // Log warning if connection was slow (configurable threshold)
            const jfSlowMs = Number(process.env.JELLYFIN_SLOW_WARN_MS || 3000);
            if (responseTime > jfSlowMs) {
                logger.warn('Slow Jellyfin server response detected', {
                    action: 'jellyfin_connection_slow',
                    server: {
                        name: serverConfig.name,
                        hostname: hostname,
                        port: port,
                    },
                    responseTime: `${responseTime.toFixed(2)}ms`,
                    thresholdMs: jfSlowMs,
                });
            }

            return { status: 'ok', message: 'Connection successful.' };
        } catch (error) {
            let errorMessage = error.message;
            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Connection refused. Check hostname and port.';

                logger.error('Jellyfin server connection refused', {
                    action: 'jellyfin_connection_refused',
                    server: {
                        name: serverConfig.name,
                        hostname: serverConfig.hostname,
                        port: serverConfig.port,
                    },
                    error: {
                        code: error.code,
                        message: error.message,
                    },
                });
            } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                errorMessage = 'Unauthorized. Check API key.';
            } else if (error.code === 'ETIMEDOUT') {
                errorMessage = 'Connection timed out.';
            }
            return { status: 'error', message: `Jellyfin connection failed: ${errorMessage}` };
        }
    }
    // Future server types can be added here
    return {
        status: 'error',
        message: `Unsupported server type for health check: ${serverConfig.type}`,
    };
}

module.exports = {
    testServerConnection,
};
