/**
 * Jellyfin HTTP Client
 * A lightweight alternative to the official Jellyfin SDK using direct HTTP calls
 */

const axios = require('axios');

class JellyfinHttpClient {
    constructor({ hostname, port, apiKey, timeout = 15000 }) {
        this.hostname = hostname;
        this.port = port;
        this.apiKey = apiKey;
        this.timeout = timeout;

        // Build base URL with protocol detection
        const protocol = port === 443 || port === '443' ? 'https' : 'http';
        this.baseUrl = `${protocol}://${hostname}:${port}`;

        // Create axios instance with default config
        this.http = axios.create({
            baseURL: this.baseUrl,
            timeout: this.timeout,
            headers: {
                'X-Emby-Token': this.apiKey,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        });
    }

    /**
     * Test the connection to the Jellyfin server
     */
    async testConnection() {
        try {
            const response = await this.http.get('/System/Info');
            return {
                success: true,
                serverName: response.data.ServerName,
                version: response.data.Version,
                id: response.data.Id,
            };
        } catch (error) {
            throw new Error(`Connection failed: ${error.message}`);
        }
    }

    /**
     * Get all virtual folders (libraries) from the server
     */
    async getLibraries() {
        try {
            const response = await this.http.get('/Library/VirtualFolders');
            return response.data.map(library => ({
                Id: library.ItemId,
                Name: library.Name,
                CollectionType: library.CollectionType || 'mixed',
            }));
        } catch (error) {
            throw new Error(`Failed to fetch libraries: ${error.message}`);
        }
    }

    /**
     * Get items from a specific library
     */
    async getItems({
        parentId,
        includeItemTypes = [],
        recursive = true,
        fields = [],
        sortBy = [],
        limit = 100,
        startIndex = 0,
    }) {
        try {
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
        } catch (error) {
            throw new Error(`Failed to fetch items: ${error.message}`);
        }
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
}

module.exports = { JellyfinHttpClient };
