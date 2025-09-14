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
    // eslint-disable-next-line import/no-extraneous-dependencies
    // eslint-disable-next-line global-require
    pkgVersion = require('../package.json').version || pkgVersion;
} catch (_) {}

class JellyfinHttpClient {
    constructor({ hostname, port, apiKey, timeout = 15000, basePath = '' }) {
        this.hostname = hostname;
        this.port = port;
        this.apiKey = apiKey;
        this.timeout = timeout;
        this.basePath = basePath;
        this.insecure = process.env.JELLYFIN_INSECURE_HTTPS === 'true';

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
    }

    /**
     * Helper method to retry requests with exponential backoff
     */
    async retryRequest(requestFn, maxRetries = 2, baseDelay = 1000) {
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
                console.warn(
                    `[JellyfinClient] Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
                    error.message
                );
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
            const response = await this.http.get('/System/Info');
            return {
                success: true,
                serverName: response.data.ServerName,
                version: response.data.Version,
                id: response.data.Id,
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
                    console.warn(
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
                    console.warn(
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
                    console.warn(
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
                    console.warn(
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
                        limit: 50, // Reduced to 50 for testing - was 1000
                        recursive: true,
                    });

                    console.log(
                        `[DEBUG] Library ${libraryId}: Found ${response.Items ? response.Items.length : 0} items (includeItemTypes: ['Movie', 'Series']) - LIMIT: 50`
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
                    console.warn(
                        `Failed to fetch qualities from library ${libraryId}:`,
                        error.message
                    );
                }
            }

            console.log(
                `[DEBUG] Final quality counts across all libraries:`,
                Array.from(qualityCounts.entries())
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
