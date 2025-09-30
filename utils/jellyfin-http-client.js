/**
 * Jellyfin HTTP Client
 * A lightweight alternative to the official Jellyfin SDK using direct HTTP calls
 */

const axios = require('axios');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
let pkgVersion = '1.0.0';
try {
    // Resolve version for User-Agent / authorization metadata
    // Falls back silently if package.json cannot be loaded

    pkgVersion = require('../package.json').version || pkgVersion;
} catch (_) {
    // package.json not available; keep default version
}

class JellyfinHttpClient {
    constructor({
        hostname,
        port,
        apiKey,
        timeout = 15000,
        basePath = '',
        insecure = false,
        insecureHttps = false,
        retryMaxRetries = 2,
        retryBaseDelay = 1000,
    }) {
        this.hostname = hostname;
        this.port = port;
        this.apiKey = apiKey;
        this.timeout = timeout;
        this.basePath = basePath;
        this.retryMaxRetries = retryMaxRetries;
        this.retryBaseDelay = retryBaseDelay;
        // Honor explicit flags and fall back to env var
        this.insecure = Boolean(
            insecureHttps || insecure || process.env.JELLYFIN_INSECURE_HTTPS === 'true'
        );

        // Build base URL with protocol detection
        // Build base URL with protocol detection (Jellyfin defaults: 8096 http, 8920 https)
        const httpsPorts = new Set([443, '443', 8920, '8920']);
        const protocol = httpsPorts.has(port) ? 'https' : 'http';
        // Normalize optional basePath
        let normalizedBasePath = '';
        if (this.basePath && this.basePath !== '/') {
            normalizedBasePath = this.basePath.startsWith('/')
                ? this.basePath
                : `/${this.basePath}`;
            // remove trailing slash
            if (normalizedBasePath.length > 1 && normalizedBasePath.endsWith('/')) {
                normalizedBasePath = normalizedBasePath.slice(0, -1);
            }
        }
        this.baseUrl = `${protocol}://${hostname}:${port}${normalizedBasePath}`;
        // Dedicated debug flag for the Jellyfin HTTP client
        const jfDebug =
            process.env.JELLYFIN_HTTP_DEBUG === 'true' || process.env.DEBUG_JELLYFIN === 'true';
        this.__jfDebug = jfDebug;
        // Opt-in flag specifically for retry attempt logging (very noisy)
        this.__retryLogEnabled = process.env.JELLYFIN_RETRY_LOGS === 'true';
        if (jfDebug) {
            const logger = require('./logger');
            logger.debug(`[JellyfinHttpClient] baseUrl=${this.baseUrl}, insecure=${this.insecure}`);
        }

        // Simple throttled warning tracker to avoid log spam per-key
        this.__lastWarnAt = new Map();
        this.__warnIntervalMs = 60_000; // default 60s throttle window

        const logger = require('./logger');
        this.debug = (...args) => {
            if (this.__jfDebug) {
                logger.debug(...args);
            }
        };

        this.warnThrottled = (key, ...args) => {
            const now = Date.now();
            const last = this.__lastWarnAt.get(key) || 0;
            if (now - last >= this.__warnIntervalMs) {
                this.__lastWarnAt.set(key, now);

                console.warn(...args);
            }
        };

        // Compose Jellyfin/Emby authorization metadata header
        const deviceName = process.env.POSTERRAMA_DEVICE_NAME || os.hostname() || 'Posterrama';
        const deviceId =
            process.env.POSTERRAMA_DEVICE_ID ||
            `posterrama-${crypto.createHash('md5').update(deviceName).digest('hex').slice(0, 12)}`;
        const embyAuthHeader = `MediaBrowser Client="Posterrama", Device="${deviceName}", DeviceId="${deviceId}", Version="${pkgVersion}", Token="${this.apiKey}"`;

        // Create axios instance with default config
        const httpsAgent =
            this.insecure && protocol === 'https'
                ? new https.Agent({ rejectUnauthorized: false })
                : undefined;
        this.http = axios.create({
            baseURL: this.baseUrl,
            timeout: this.timeout,
            httpsAgent,
            headers: {
                // Both headers are accepted by Jellyfin/Emby; include for compatibility
                'X-Emby-Token': this.apiKey,
                'X-MediaBrowser-Token': this.apiKey,
                'X-Emby-Authorization': embyAuthHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': `Posterrama/${pkgVersion}`,
            },
        });

        // Append api_key to all requests as a reverse-proxy friendly fallback if headers are stripped
        this.http.interceptors.request.use(config => {
            if (this.__jfDebug) {
                const masked = val =>
                    typeof val === 'string' && val.length > 6
                        ? `${val.slice(0, 3)}…${val.slice(-2)}`
                        : '[redacted]';
                const hdrKeys = Object.keys(config.headers || {});
                logger.debug(
                    `[JellyfinHttpClient] Request: ${String(config.method || 'GET').toUpperCase()} ${config.url}`
                );
                logger.debug('[JellyfinHttpClient] Header keys:', hdrKeys);
                if (
                    config.headers &&
                    (config.headers['X-Emby-Token'] || config.headers['X-MediaBrowser-Token'])
                ) {
                    logger.debug(
                        '[JellyfinHttpClient] Token (masked):',
                        masked(
                            config.headers['X-Emby-Token'] || config.headers['X-MediaBrowser-Token']
                        )
                    );
                }
            }
            try {
                const url = new URL((config.baseURL || '') + (config.url || ''));
                if (!url.searchParams.has('api_key')) {
                    if (!config.params) config.params = {};
                    if (!('api_key' in config.params)) {
                        config.params.api_key = this.apiKey;
                    }
                }
            } catch (_) {
                // If URL parsing fails (relative complex paths), fallback to params only
                if (!config.params) config.params = {};
                if (!('api_key' in config.params)) {
                    config.params.api_key = this.apiKey;
                }
            }
            if (this.__jfDebug) {
                const paramsSafe = { ...(config.params || {}) };
                if ('api_key' in paramsSafe) paramsSafe.api_key = '[redacted]';
                logger.debug('[JellyfinHttpClient] Params:', paramsSafe);
            }
            return config;
        });
    }

    /**
     * Helper method to retry requests with exponential backoff
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

                // Don't retry on authentication errors or client errors (4xx)
                if (error.response && error.response.status >= 400 && error.response.status < 500) {
                    throw error;
                }

                if (attempt === maxRetries) {
                    break;
                }

                // Exponential backoff: wait longer between retries
                const delay = baseDelay * Math.pow(2, attempt);
                if (this.__jfDebug && this.__retryLogEnabled) {
                    console.warn(
                        `[JellyfinClient] Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
                        error.message
                    );
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    /**
     * Test the connection to the Jellyfin server
     */
    async testConnection() {
        return this.retryRequest(async () => {
            // 1) Try public system info first (works even if auth is required elsewhere)
            let serverInfo;
            try {
                const respPublic = await this.http.get('/System/Info/Public');
                serverInfo = respPublic.data;
            } catch (e) {
                // Fallback to /System/Info for older servers or when public endpoint is restricted
                const resp = await this.http.get('/System/Info');
                serverInfo = resp.data;
            }

            // 2) Validate token by calling an authenticated endpoint accessible to normal users
            //    Use /Users which requires a valid token and lists users the token can access
            try {
                if (this.__jfDebug) {
                    logger.debug(
                        `[JellyfinHttpClient] Testing auth with /Users, apiKey length: ${
                            this.apiKey ? this.apiKey.length : 0
                        }`
                    );
                }
                await this.http.get('/Users');
            } catch (e) {
                if (this.__jfDebug) {
                    logger.debug(
                        `[JellyfinHttpClient] /Users failed:`,
                        e.response?.status,
                        e.message
                    );
                }
                if (e.response && (e.response.status === 401 || e.response.status === 403)) {
                    // Some reverse proxies can strip X-Emby-Token headers; try query-param fallback
                    try {
                        if (this.__jfDebug) {
                            logger.debug(`[JellyfinHttpClient] Retrying with query param fallback`);
                        }
                        await this.http.get(`/Users?api_key=${encodeURIComponent(this.apiKey)}`);
                    } catch (e2) {
                        if (
                            e2.response &&
                            (e2.response.status === 401 || e2.response.status === 403)
                        ) {
                            const err = new Error('401 Unauthorized: Jellyfin API key rejected');
                            err.code = 'EJELLYFIN_UNAUTHORIZED';
                            throw err;
                        }
                        if (e2.response && e2.response.status === 404) {
                            const err = new Error('404 Not Found: Check Jellyfin base path');
                            err.code = 'EJELLYFIN_NOT_FOUND';
                            throw err;
                        }
                        // TLS issues often surface here
                        if (
                            (e2.code &&
                                (e2.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
                                    e2.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')) ||
                            (e2.message && /self[- ]signed|unable to verify/i.test(e2.message))
                        ) {
                            const err = new Error('TLS certificate error');
                            err.code = 'EJELLYFIN_CERT';
                            throw err;
                        }
                        throw e2;
                    }
                } else if (e.response && e.response.status === 404) {
                    const err = new Error('404 Not Found: Check Jellyfin base path');
                    err.code = 'EJELLYFIN_NOT_FOUND';
                    throw err;
                } else if (
                    (e.code &&
                        (e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
                            e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')) ||
                    (e.message && /self[- ]signed|unable to verify/i.test(e.message))
                ) {
                    const err = new Error('TLS certificate error');
                    err.code = 'EJELLYFIN_CERT';
                    throw err;
                } else {
                    // Re-throw other errors to be handled by retry/backoff
                    throw e;
                }
            }

            return {
                success: true,
                serverName: serverInfo.ServerName || serverInfo.serverName || 'Jellyfin',
                version: serverInfo.Version || serverInfo.version,
                id: serverInfo.Id || serverInfo.id,
            };
        });
    }

    /**
     * Get all virtual folders (libraries) from the server
     */
    async getLibraries() {
        return this.retryRequest(async () => {
            const response = await this.http.get('/Library/VirtualFolders');
            return response.data;
        });
    }

    /**
     * Get items from a specific library
     */
    async getItems({
        parentId = '',
        includeItemTypes = [],
        recursive = true,
        fields = [],
        sortBy = [],
        limit = 100,
        startIndex = 0,
    }) {
        return this.retryRequest(async () => {
            const params = new URLSearchParams({
                ParentId: parentId,
                Recursive: recursive.toString(),
                Limit: limit.toString(),
                StartIndex: startIndex.toString(),
            });

            if (includeItemTypes.length > 0) {
                params.append('IncludeItemTypes', includeItemTypes.join(','));
            }

            if (fields.length > 0) {
                params.append('Fields', fields.join(','));
            }

            if (sortBy.length > 0) {
                params.append('SortBy', sortBy.join(','));
            }

            const response = await this.http.get(`/Items?${params}`);
            return response.data;
        });
    }

    /**
     * Get image URL for an item
     */
    getImageUrl(itemId, imageType = 'Primary', options = {}) {
        const params = new URLSearchParams();

        // Add optional parameters
        if (options.maxHeight) params.append('maxHeight', options.maxHeight);
        if (options.maxWidth) params.append('maxWidth', options.maxWidth);
        if (options.quality) params.append('quality', options.quality);
        if (options.tag) params.append('tag', options.tag);

        const queryString = params.toString();
        return `${this.baseUrl}/Items/${itemId}/Images/${imageType}${queryString ? '?' + queryString : ''}`;
    }

    /**
     * Get genres from specified libraries
     */
    async getGenres(libraryIds) {
        try {
            const genresSet = new Set();

            // Get all movies and series from the selected libraries
            for (const libraryId of libraryIds) {
                try {
                    // Use a broader approach to get all items from the library
                    const response = await this.http.get('/Items', {
                        params: {
                            ParentId: libraryId,
                            IncludeItemTypes: 'Movie,Series',
                            Fields: 'Genres',
                            Recursive: true,
                            Limit: 1000, // Increase limit to get more items
                        },
                    });

                    if (response.data.Items) {
                        response.data.Items.forEach(item => {
                            if (item.Genres && Array.isArray(item.Genres)) {
                                item.Genres.forEach(genre => {
                                    if (genre && genre.trim()) {
                                        genresSet.add(genre.trim());
                                    }
                                });
                            }
                        });
                    }
                } catch (error) {
                    this.warnThrottled(
                        `genres:${libraryId}`,
                        `Failed to fetch genres from library ${libraryId}:`,
                        error.message
                    );
                }
            }

            return Array.from(genresSet).sort();
        } catch (error) {
            throw new Error(`Failed to fetch genres: ${error.message}`);
        }
    }

    /**
     * Get all unique genres with counts from specified libraries
     */
    async getGenresWithCounts(libraryIds) {
        try {
            const genreCounts = new Map();

            // Get all movies and series from the selected libraries
            for (const libraryId of libraryIds) {
                try {
                    // Use a broader approach to get all items from the library
                    const response = await this.http.get('/Items', {
                        params: {
                            ParentId: libraryId,
                            IncludeItemTypes: 'Movie,Series',
                            Fields: 'Genres',
                            Recursive: true,
                            Limit: 1000, // Increase limit to get more items
                        },
                    });

                    if (response.data.Items) {
                        response.data.Items.forEach(item => {
                            if (item.Genres && Array.isArray(item.Genres)) {
                                item.Genres.forEach(genre => {
                                    if (genre && genre.trim()) {
                                        const cleanGenre = genre.trim();
                                        genreCounts.set(
                                            cleanGenre,
                                            (genreCounts.get(cleanGenre) || 0) + 1
                                        );
                                    }
                                });
                            }
                        });
                    }
                } catch (error) {
                    this.warnThrottled(
                        `genresCounts:${libraryId}`,
                        `Failed to fetch genres from library ${libraryId}:`,
                        error.message
                    );
                }
            }

            // Convert to array of objects and sort by genre name
            const result = Array.from(genreCounts.entries())
                .map(([genre, count]) => ({ genre, count }))
                .sort((a, b) => a.genre.localeCompare(b.genre));

            return result;
        } catch (error) {
            throw new Error(`Failed to fetch genres with counts: ${error.message}`);
        }
    }

    /**
     * Get all unique official ratings from specified libraries
     */
    async getRatings(libraryIds) {
        try {
            const ratingsSet = new Set();

            // Get all movies and series from the selected libraries
            for (const libraryId of libraryIds) {
                try {
                    // Get all items from the library with OfficialRating field
                    const response = await this.http.get('/Items', {
                        params: {
                            ParentId: libraryId,
                            IncludeItemTypes: 'Movie,Series',
                            Fields: 'OfficialRating',
                            Recursive: true,
                            Limit: 10000, // High limit to get all items
                        },
                    });

                    if (response.data.Items) {
                        response.data.Items.forEach(item => {
                            if (item.OfficialRating && item.OfficialRating.trim()) {
                                ratingsSet.add(item.OfficialRating.trim());
                            }
                        });
                    }
                } catch (error) {
                    this.warnThrottled(
                        `ratings:${libraryId}`,
                        `Failed to fetch ratings from library ${libraryId}:`,
                        error.message
                    );
                }
            }

            return Array.from(ratingsSet).sort();
        } catch (error) {
            throw new Error(`Failed to fetch ratings: ${error.message}`);
        }
    }

    /**
     * Get all unique official ratings with their counts from specified libraries
     */
    async getRatingsWithCounts(libraryIds) {
        try {
            const ratingsMap = new Map();

            // Get all movies and series from the selected libraries
            for (const libraryId of libraryIds) {
                try {
                    // Get all items from the library with OfficialRating field
                    const response = await this.http.get('/Items', {
                        params: {
                            ParentId: libraryId,
                            IncludeItemTypes: 'Movie,Series',
                            Fields: 'OfficialRating',
                            Recursive: true,
                            Limit: 10000, // High limit to get all items
                        },
                    });

                    if (response.data.Items) {
                        response.data.Items.forEach(item => {
                            if (item.OfficialRating && item.OfficialRating.trim()) {
                                const rating = item.OfficialRating.trim();
                                ratingsMap.set(rating, (ratingsMap.get(rating) || 0) + 1);
                            }
                        });
                    }
                } catch (error) {
                    this.warnThrottled(
                        `ratingsCounts:${libraryId}`,
                        `Failed to fetch ratings from library ${libraryId}:`,
                        error.message
                    );
                }
            }

            // Convert to array of objects and sort by rating
            return Array.from(ratingsMap.entries())
                .map(([rating, count]) => ({ rating, count }))
                .sort((a, b) => a.rating.localeCompare(b.rating));
        } catch (error) {
            throw new Error(`Failed to fetch ratings with counts: ${error.message}`);
        }
    }

    /**
     * Search for items by title (useful for future search functionality)
     */
    async searchItems(searchTerm, includeItemTypes = ['Movie', 'Series']) {
        try {
            const params = new URLSearchParams({
                SearchTerm: searchTerm,
                IncludeItemTypes: includeItemTypes.join(','),
                Recursive: 'true',
                Limit: '20',
            });

            const response = await this.http.get(`/Items?${params.toString()}`);
            return response.data.Items || [];
        } catch (error) {
            throw new Error(`Search failed: ${error.message}`);
        }
    }

    /**
     * Get all unique quality/resolution values with counts from specified libraries
     */
    async getQualitiesWithCounts(libraryIds) {
        try {
            const qualityCounts = new Map();

            for (const libraryId of libraryIds) {
                try {
                    // Get items with media stream information
                    // Use 'Movie' and 'Series' instead of 'Episode' to avoid counting all episodes individually
                    const response = await this.getItems({
                        parentId: libraryId,
                        includeItemTypes: ['Movie', 'Series'], // Fixed: was ['Movie', 'Episode']
                        fields: ['MediaStreams', 'MediaSources'], // Get both for maximum compatibility
                        limit: 1000, // Increase limit for better coverage (matches Plex side)
                        recursive: true,
                    });

                    this.debug(
                        `[JellyfinHttpClient] Library ${libraryId}: Found ${response.Items ? response.Items.length : 0} items (includeItemTypes: ['Movie', 'Series']) - LIMIT: 50`
                    );

                    if (response.Items) {
                        response.Items.forEach(item => {
                            let videoStream = null;

                            // First try direct MediaStreams on item level
                            if (item.MediaStreams && Array.isArray(item.MediaStreams)) {
                                videoStream = item.MediaStreams.find(
                                    stream => stream.Type === 'Video'
                                );
                            }

                            // If not found, try MediaSources > MediaStreams (nested)
                            if (
                                !videoStream &&
                                item.MediaSources &&
                                Array.isArray(item.MediaSources)
                            ) {
                                for (const source of item.MediaSources) {
                                    if (source.MediaStreams && Array.isArray(source.MediaStreams)) {
                                        videoStream = source.MediaStreams.find(
                                            stream => stream.Type === 'Video'
                                        );
                                        if (videoStream) break; // Use first video stream found
                                    }
                                }
                            }

                            // Process the video stream if found
                            if (videoStream && videoStream.Height) {
                                let quality;
                                const height = videoStream.Height;

                                // Map video height to standardized quality labels
                                if (height <= 576) {
                                    quality = 'SD';
                                } else if (height <= 720) {
                                    quality = '720p';
                                } else if (height <= 1080) {
                                    quality = '1080p';
                                } else if (height >= 2160) {
                                    quality = '4K';
                                } else {
                                    // For other resolutions, create a label based on height
                                    quality = `${height}p`;
                                }

                                qualityCounts.set(quality, (qualityCounts.get(quality) || 0) + 1);
                            }
                        });
                    }
                } catch (error) {
                    this.warnThrottled(
                        `qualities:${libraryId}`,
                        `Failed to fetch qualities from library ${libraryId}:`,
                        error.message
                    );
                }
            }

            this.debug(
                `[JellyfinHttpClient] Final quality counts across all libraries: ${JSON.stringify(Array.from(qualityCounts.entries()))}`
            );

            // Convert to array of objects and sort by quality preference
            const qualityOrder = ['SD', '720p', '1080p', '4K'];
            const result = Array.from(qualityCounts.entries())
                .map(([quality, count]) => ({ quality, count }))
                .sort((a, b) => {
                    const aIndex = qualityOrder.indexOf(a.quality);
                    const bIndex = qualityOrder.indexOf(b.quality);

                    // If both are in the predefined order, sort by order
                    if (aIndex !== -1 && bIndex !== -1) {
                        return aIndex - bIndex;
                    }
                    // If only one is in predefined order, prioritize it
                    if (aIndex !== -1) return -1;
                    if (bIndex !== -1) return 1;
                    // If neither is in predefined order, sort alphabetically
                    return a.quality.localeCompare(b.quality);
                });

            return result;
        } catch (error) {
            throw new Error(`Failed to fetch qualities with counts: ${error.message}`);
        }
    }
}

module.exports = { JellyfinHttpClient };
