/**
 * RomM HTTP Client
 * Client for RomM game ROM management API with OAuth2 and Basic auth support
 */

const axios = require('axios');
const https = require('https');
const config = require('../config/');
const UserAgentBuilder = require('./userAgent');

class RommHttpClient {
    constructor({
        hostname,
        port = 80,
        username,
        password,
        timeout = config.getTimeout('externalApiRomm'),
        basePath = '',
        insecure = false,
        insecureHttps = false,
        retryMaxRetries = config.getTimeout('externalApiMaxRetries'),
        retryBaseDelay = config.getTimeout('externalApiRetryDelay'),
    }) {
        this.hostname = hostname;
        this.port = port;
        this.username = username;
        this.password = password;
        this.timeout = timeout;
        this.basePath = basePath;
        this.retryMaxRetries = retryMaxRetries;
        this.retryBaseDelay = retryBaseDelay;
        this.insecure = Boolean(
            insecureHttps || insecure || process.env.ROMM_INSECURE_HTTPS === 'true'
        );

        // Build base URL with protocol detection
        const httpsPorts = new Set([443, '443', 8443, '8443']);
        const protocol = httpsPorts.has(port) ? 'https' : 'http';

        // Normalize basePath
        let normalizedBasePath = '';
        if (this.basePath && this.basePath !== '/') {
            normalizedBasePath = this.basePath.startsWith('/')
                ? this.basePath
                : `/${this.basePath}`;
            if (normalizedBasePath.length > 1 && normalizedBasePath.endsWith('/')) {
                normalizedBasePath = normalizedBasePath.slice(0, -1);
            }
        }
        this.baseUrl = `${protocol}://${hostname}:${port}${normalizedBasePath}`;

        // OAuth2 token storage
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;

        // Debug logging
        const rommDebug =
            process.env.ROMM_HTTP_DEBUG === 'true' || process.env.DEBUG_ROMM === 'true';
        this.__rommDebug = rommDebug;
        this.__retryLogEnabled = process.env.ROMM_RETRY_LOGS === 'true';

        const logger = require('./logger');
        this.debug = (...args) => {
            if (this.__rommDebug) {
                logger.debug(...args);
            }
        };

        this.__lastWarnAt = new Map();
        this.__warnIntervalMs = 60_000;

        if (rommDebug) {
            logger.debug(`[RommHttpClient] baseUrl=${this.baseUrl}, insecure=${this.insecure}`);
        }
    }

    /**
     * Build authorization header for requests
     * @returns {Object} Authorization header object
     */
    _getAuthHeader() {
        if (this.accessToken) {
            return { Authorization: `Bearer ${this.accessToken}` };
        }
        // Fallback to Basic auth if no token
        if (this.username && this.password) {
            const basicAuth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
            return { Authorization: `Basic ${basicAuth}` };
        }
        return {};
    }

    /**
     * Check if token needs refresh (5 min buffer)
     * @returns {boolean}
     */
    _needsTokenRefresh() {
        if (!this.tokenExpiry) return true;
        const bufferMs = 5 * 60 * 1000; // 5 minutes
        return Date.now() >= this.tokenExpiry - bufferMs;
    }

    /**
     * Authenticate and get OAuth2 token
     * @returns {Promise<void>}
     */
    async authenticate() {
        if (!this.username || !this.password) {
            throw new Error('Username and password required for authentication');
        }

        try {
            this.debug('[RommHttpClient] Authenticating with OAuth2 password flow');

            const formData = new URLSearchParams({
                grant_type: 'password',
                username: this.username,
                password: this.password,
                scope: 'roms.read platforms.read assets.read',
            });

            const response = await axios.post(`${this.baseUrl}/api/token`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: this.timeout,
                httpsAgent: this.insecure
                    ? new https.Agent({ rejectUnauthorized: false })
                    : undefined,
            });

            this.accessToken = response.data.access_token;
            this.refreshToken = response.data.refresh_token;
            this.tokenExpiry = Date.now() + (response.data.expires || 3600) * 1000;

            this.debug(
                '[RommHttpClient] Authentication successful, token expires in',
                response.data.expires,
                'seconds'
            );
        } catch (error) {
            const logger = require('./logger');
            logger.error('[RommHttpClient] Authentication failed:', error.message);
            throw new Error(`RomM authentication failed: ${error.message}`);
        }
    }

    /**
     * Refresh OAuth2 token using refresh token
     * @returns {Promise<void>}
     */
    async refreshAccessToken() {
        if (!this.refreshToken) {
            // No refresh token, re-authenticate
            return this.authenticate();
        }

        try {
            this.debug('[RommHttpClient] Refreshing access token');

            const formData = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken,
            });

            const response = await axios.post(`${this.baseUrl}/api/token`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: this.timeout,
                httpsAgent: this.insecure
                    ? new https.Agent({ rejectUnauthorized: false })
                    : undefined,
            });

            this.accessToken = response.data.access_token;
            this.refreshToken = response.data.refresh_token || this.refreshToken;
            this.tokenExpiry = Date.now() + (response.data.expires || 3600) * 1000;

            this.debug('[RommHttpClient] Token refresh successful');
        } catch (error) {
            const logger = require('./logger');
            logger.warn('[RommHttpClient] Token refresh failed, re-authenticating:', error.message);
            // Refresh failed, try full re-auth
            return this.authenticate();
        }
    }

    /**
     * Make authenticated request with retry and token refresh
     * @param {string} method - HTTP method
     * @param {string} path - API path
     * @param {Object} options - Request options
     * @returns {Promise<any>}
     */
    async request(method, path, options = {}) {
        // Ensure we have a valid token
        if (this._needsTokenRefresh()) {
            await this.refreshAccessToken();
        }

        const url = `${this.baseUrl}${path}`;
        const config = {
            method,
            url,
            timeout: this.timeout,
            headers: {
                'User-Agent': UserAgentBuilder.forRomM(),
                ...this._getAuthHeader(),
                ...options.headers,
            },
            httpsAgent: this.insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined,
            ...options,
        };

        let lastError;
        for (let attempt = 0; attempt <= this.retryMaxRetries; attempt++) {
            try {
                this.debug(
                    `[RommHttpClient] ${method} ${path}`,
                    attempt > 0 ? `(attempt ${attempt + 1})` : ''
                );
                const response = await axios(config);
                return response.data;
            } catch (error) {
                lastError = error;

                // Handle 401 Unauthorized - token expired
                if (error.response?.status === 401 && attempt === 0) {
                    this.debug('[RommHttpClient] 401 Unauthorized, refreshing token');
                    await this.refreshAccessToken();
                    config.headers = {
                        ...config.headers,
                        ...this._getAuthHeader(),
                    };
                    continue;
                }

                // Don't retry on 4xx errors (except 401 already handled)
                if (error.response?.status >= 400 && error.response?.status < 500) {
                    throw error;
                }

                // Retry on network errors or 5xx
                if (attempt < this.retryMaxRetries) {
                    const delay = this.retryBaseDelay * Math.pow(2, attempt);
                    if (this.__retryLogEnabled) {
                        this.debug(`[RommHttpClient] Retry after ${delay}ms`);
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }
        }

        throw lastError;
    }

    /**
     * Get list of ROMs with filters
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>} Paginated ROMs response
     */
    async getRoms(params = {}) {
        const queryParams = new URLSearchParams();

        if (params.platform_id) queryParams.append('platform_id', params.platform_id);
        if (params.search_term) queryParams.append('search_term', params.search_term);
        if (params.favourite !== undefined) queryParams.append('favourite', params.favourite);
        if (params.playable !== undefined) queryParams.append('playable', params.playable);
        if (params.matched !== undefined) queryParams.append('matched', params.matched);
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.offset) queryParams.append('offset', params.offset);
        if (params.order_by) queryParams.append('order_by', params.order_by);
        if (params.order_dir) queryParams.append('order_dir', params.order_dir);

        const query = queryParams.toString();
        const path = query ? `/api/roms?${query}` : '/api/roms';

        return this.request('GET', path);
    }

    /**
     * Get detailed ROM information
     * @param {number} romId - ROM ID
     * @returns {Promise<Object>} Detailed ROM object
     */
    async getRomDetails(romId) {
        return this.request('GET', `/api/roms/${romId}`);
    }

    /**
     * Get list of available platforms
     * @returns {Promise<Array>} Array of platform objects
     */
    async getPlatforms() {
        return this.request('GET', '/api/platforms');
    }

    /**
     * Get platform details
     * @param {number} platformId - Platform ID
     * @returns {Promise<Object>} Platform object
     */
    async getPlatform(platformId) {
        return this.request('GET', `/api/platforms/${platformId}`);
    }

    /**
     * Generate asset URL with authentication
     * @param {string} path - Asset path from RomM (e.g., rom.path_cover_large)
     * @returns {string} Full asset URL
     */
    getAssetUrl(path) {
        if (!path) return null;

        // If path is already a full URL, return as-is
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }

        // Remove leading slash if present
        const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

        return `${this.baseUrl}/api/raw/assets/${normalizedPath}`;
    }

    /**
     * Download asset data (for proxying through Posterrama)
     * @param {string} path - Asset path
     * @returns {Promise<Buffer>} Asset binary data
     */
    async downloadAsset(path) {
        const url = this.getAssetUrl(path);
        if (!url) {
            throw new Error('Invalid asset path');
        }

        return this.request(
            'GET',
            `/api/raw/assets/${path.startsWith('/') ? path.slice(1) : path}`,
            {
                responseType: 'arraybuffer',
            }
        );
    }

    /**
     * Get server heartbeat/config
     * @returns {Promise<Object>} Heartbeat response with server config
     */
    async getHeartbeat() {
        return this.request('GET', '/api/heartbeat');
    }

    /**
     * Test connection to RomM server
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            await this.authenticate();
            await this.getHeartbeat();
            return true;
        } catch (error) {
            const logger = require('./logger');
            logger.error('[RommHttpClient] Connection test failed:', error.message);
            return false;
        }
    }
}

module.exports = RommHttpClient;
