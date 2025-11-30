/**
 * Base HTTP Client
 *
 * Abstract base class for external API HTTP clients (Plex, Jellyfin, RomM).
 * Provides common functionality:
 * - Retry logic with exponential backoff
 * - Debug logging with throttling
 * - Base URL construction with protocol detection
 * - Insecure HTTPS handling
 * - Connection pooling configuration
 */

const axios = require('axios');
const http = require('http');
const https = require('https');
const logger = require('../utils/logger');
const config = require('../config/');
const UserAgentBuilder = require('../utils/userAgent');

class BaseHttpClient {
    /**
     * @param {Object} [options] - Client configuration
     * @param {string} [options.hostname] - Server hostname
     * @param {number|string} [options.port] - Server port
     * @param {number} [options.timeout] - Request timeout in ms
     * @param {string} [options.basePath=''] - Base path for API endpoints
     * @param {boolean} [options.insecure=false] - Allow insecure connections
     * @param {boolean} [options.insecureHttps=false] - Allow insecure HTTPS (legacy)
     * @param {number} [options.retryMaxRetries] - Max retry attempts
     * @param {number} [options.retryBaseDelay] - Base delay for exponential backoff
     * @param {Set<number|string>} [options.httpsPorts] - Ports that indicate HTTPS
     * @param {string} [options.debugEnvVar] - Environment variable for debug logging
     * @param {string} [options.clientName='HttpClient'] - Client name for logging
     */
    constructor(options = /** @type {any} */ ({})) {
        const {
            hostname,
            port,
            timeout = config.getTimeout('externalApiDefault') || 30000,
            basePath = '',
            insecure = false,
            insecureHttps = false,
            retryMaxRetries = config.getTimeout('externalApiMaxRetries') || 3,
            retryBaseDelay = config.getTimeout('externalApiRetryDelay') || 1000,
            httpsPorts = new Set([443, '443', 8443, '8443']),
            debugEnvVar = 'DEBUG_HTTP_CLIENT',
            clientName = 'HttpClient',
        } = options;

        this.hostname = hostname;
        this.port = port;
        this.timeout = timeout;
        this.basePath = basePath;
        this.retryMaxRetries = retryMaxRetries;
        this.retryBaseDelay = retryBaseDelay;
        this.clientName = clientName;

        // Handle insecure connections (allow self-signed certificates)
        this.insecure = Boolean(insecureHttps || insecure);

        // Build base URL with protocol detection
        const protocol = httpsPorts.has(port) ? 'https' : 'http';
        const normalizedBasePath = this._normalizeBasePath(basePath);
        this.baseUrl = `${protocol}://${hostname}:${port}${normalizedBasePath}`;

        // Debug logging configuration
        this._setupDebugLogging(debugEnvVar);

        // Configure HTTP/HTTPS agents for connection pooling
        this._setupAgents();

        // Initialize axios instance (to be configured by subclasses)
        this.http = null;
    }

    /**
     * Normalize base path (remove trailing slash, ensure leading slash)
     * @private
     */
    _normalizeBasePath(basePath) {
        if (!basePath || basePath === '/') {
            return '';
        }

        let normalized = basePath.startsWith('/') ? basePath : `/${basePath}`;
        if (normalized.length > 1 && normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }

        return normalized;
    }

    /**
     * Setup debug logging with environment variable control
     * @private
     */
    _setupDebugLogging(debugEnvVar) {
        this.__debug = process.env[debugEnvVar] === 'true';
        this.__retryLogEnabled = process.env[`${debugEnvVar}_RETRY`] === 'true';

        // Throttled warning tracker to avoid log spam
        this.__lastWarnAt = new Map();
        this.__warnIntervalMs = 60000; // 60 seconds

        if (this.__debug) {
            // Mask sensitive URL information (protocol + domain visible, path/query hidden)
            const maskedUrl = this._maskUrl(this.baseUrl);
            logger.debug(
                `[${this.clientName}] Initialized: baseUrl=${maskedUrl}, insecure=${this.insecure}`
            );
        }
    }

    /**
     * Mask URL to hide sensitive information including hostname
     * @param {string} url - URL to mask
     * @returns {string} Masked URL (e.g., "https://je******.com:443")
     * @private
     */
    _maskUrl(url) {
        try {
            const parsed = new URL(url);

            // Mask hostname: show first 2 chars, then ******, then TLD
            let maskedHost = parsed.hostname;
            if (maskedHost.length > 10) {
                const parts = maskedHost.split('.');
                if (parts.length >= 2) {
                    // Keep TLD visible, mask subdomain/domain
                    const tld = parts[parts.length - 1];
                    const domain = parts.slice(0, -1).join('.');
                    const prefix = domain.slice(0, 2);
                    maskedHost = `${prefix}*******.${tld}`;
                } else {
                    // Single part hostname
                    maskedHost = maskedHost.slice(0, 2) + '*******';
                }
            } else if (maskedHost.length > 4) {
                // Short hostname
                maskedHost = maskedHost.slice(0, 2) + '***';
            }

            // Show port if explicitly present in original URL (check for :port pattern)
            const portStr = url.match(/:(\d+)/) ? `:${url.match(/:(\d+)/)[1]}` : '';
            return `${parsed.protocol}//${maskedHost}${portStr}`;
        } catch {
            // If URL parsing fails, show only first 5 chars + "..."
            return url.length > 5 ? url.slice(0, 5) + '...' : '***';
        }
    }

    /**
     * Setup HTTP/HTTPS agents for connection pooling
     * @private
     */
    _setupAgents() {
        const agentOptions = {
            keepAlive: true,
            keepAliveMsecs: 30000,
            maxSockets: 10,
            maxFreeSockets: 5,
        };

        this.httpAgent = new http.Agent(agentOptions);

        // HTTPS agent with optional insecure mode
        this.httpsAgent = new https.Agent({
            ...agentOptions,
            rejectUnauthorized: !this.insecure,
        });
    }

    /**
     * Create axios instance with common configuration
     * @protected
     */
    createAxiosInstance(extraConfig = {}) {
        const userAgent = UserAgentBuilder.build(this.clientName);

        // Extract headers from extraConfig to avoid overwriting
        const { headers: extraHeaders = {}, ...restConfig } = extraConfig;

        // @ts-ignore - axios.create is valid but require() doesn't map types correctly
        return axios.create({
            baseURL: this.baseUrl,
            timeout: this.timeout,
            httpAgent: this.httpAgent,
            httpsAgent: this.httpsAgent,
            headers: {
                'User-Agent': userAgent,
                ...extraHeaders,
            },
            ...restConfig,
        });
    }

    /**
     * Debug logging (only if debug enabled)
     */
    debug(...args) {
        if (this.__debug) {
            logger.debug(`[${this.clientName}]`, ...args);
        }
    }

    /**
     * Throttled warning logging (max once per minute per key)
     */
    warnThrottled(key, ...args) {
        const now = Date.now();
        const last = this.__lastWarnAt.get(key) || 0;

        if (now - last >= this.__warnIntervalMs) {
            this.__lastWarnAt.set(key, now);
            logger.warn(`[${this.clientName}]`, ...args);
        }
    }

    /**
     * Retry a request with exponential backoff
     *
     * @param {Function} requestFn - Async function that performs the request
     * @param {number} [maxRetries] - Maximum retry attempts (overrides default)
     * @param {number} [baseDelay] - Base delay in ms (overrides default)
     * @returns {Promise<*>} Request result
     * @throws {Error} Last error if all retries fail
     */
    async retryRequest(
        requestFn,
        maxRetries = this.retryMaxRetries,
        baseDelay = this.retryBaseDelay
    ) {
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                lastError = error;

                // Don't retry on client errors (4xx) - these won't succeed on retry
                if (error.response?.status >= 400 && error.response?.status < 500) {
                    throw error;
                }

                // Last attempt - throw error
                if (attempt === maxRetries) {
                    break;
                }

                // Exponential backoff: delay = baseDelay * 2^attempt
                const delay = baseDelay * Math.pow(2, attempt);

                if (this.__debug && this.__retryLogEnabled) {
                    logger.warn(
                        `[${this.clientName}] Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
                        error.message
                    );
                }

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    /**
     * Test connection to the server (to be implemented by subclasses)
     * @abstract
     */
    async testConnection() {
        throw new Error('testConnection() must be implemented by subclass');
    }

    /**
     * Cleanup resources (close connection pools)
     */
    destroy() {
        if (this.httpAgent) {
            this.httpAgent.destroy();
        }
        if (this.httpsAgent) {
            this.httpsAgent.destroy();
        }
    }
}

module.exports = BaseHttpClient;
