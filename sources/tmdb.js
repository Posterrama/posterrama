/**
 * TMDB media source for posterrama.app
 * Handles fetching and processing media from The Movie Database API.
 */

class TMDBSource {
    constructor(sourceConfig, shuffleArray, isDebug) {
        this.source = sourceConfig;
        this.shuffleArray = shuffleArray;
        this.isDebug = isDebug;
        this.baseUrl = 'https://api.themoviedb.org/3';
        this.imageBaseUrl = 'https://image.tmdb.org/t/p/';

        // Initialize caches
        this.genreCache = new Map(); // Cache for genre mappings
        this.responseCache = new Map(); // Cache for API responses
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes cache TTL

        // Rate limiting
        this.lastRequestTime = 0;
        this.minRequestInterval = 250; // 250ms between requests (4 requests per second)

        // Retry configuration
        this.maxRetries = 3;
        this.retryDelay = 1000; // Start with 1 second delay

        // Performance metrics
        this.metrics = {
            requestCount: 0,
            cacheHits: 0,
            cacheMisses: 0,
            averageResponseTime: 0,
            lastRequestTime: null,
            errorCount: 0,
        };
    }

    /**
     * Get performance metrics
     * @returns {object} Current performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            cacheHitRate:
                this.metrics.requestCount > 0
                    ? this.metrics.cacheHits / this.metrics.requestCount
                    : 0,
            cacheSizes: {
                genres: this.genreCache.size,
                responses: this.responseCache.size,
            },
        };
    }

    /**
     * Reset performance metrics
     */
    resetMetrics() {
        this.metrics = {
            requestCount: 0,
            cacheHits: 0,
            cacheMisses: 0,
            averageResponseTime: 0,
            lastRequestTime: null,
            errorCount: 0,
        };
    }

    /**
     * Fetches and caches genre mappings from TMDB.
     * @param {string} type - The type of media ('movie' or 'tv').
     * @returns {Promise<Map>} A promise that resolves to a Map of genre ID to name.
     */
    async fetchGenreMapping(type) {
        const cacheKey = `genres_${type}`;

        // Check cache first
        if (this.genreCache.has(cacheKey)) {
            const cached = this.genreCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                if (this.isDebug) {
                    console.log(
                        `[TMDBSource:${this.source.name}] Using cached genre mapping for ${type}`
                    );
                }
                return cached.data;
            }
        }

        try {
            await this.rateLimitDelay();
            const endpoint = type === 'movie' ? '/genre/movie/list' : '/genre/tv/list';
            const response = await fetch(
                `${this.baseUrl}${endpoint}?api_key=${this.source.apiKey}&language=en-US`
            );

            if (!response.ok) {
                throw new Error(
                    `TMDB Genre API error: ${response.status} - ${response.statusText}`
                );
            }

            const data = await response.json();
            const genreMap = new Map();

            if (data.genres && Array.isArray(data.genres)) {
                data.genres.forEach(genre => {
                    genreMap.set(genre.id, genre.name);
                });
            }

            // Cache the result
            this.genreCache.set(cacheKey, {
                data: genreMap,
                timestamp: Date.now(),
            });

            if (this.isDebug) {
                console.log(
                    `[TMDBSource:${this.source.name}] Fetched ${genreMap.size} genres for ${type}`
                );
            }

            return genreMap;
        } catch (error) {
            console.error(
                `[TMDBSource:${this.source.name}] Error fetching genres for ${type}: ${error.message}`
            );
            return new Map(); // Return empty map on error
        }
    }

    /**
     * Rate limiting to respect TMDB API limits.
     * @returns {Promise<void>}
     */
    async rateLimitDelay() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minRequestInterval) {
            const delay = this.minRequestInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * Cached API request with error handling and retry logic.
     * @param {string} url - The URL to fetch.
     * @param {number} retryCount - Current retry count.
     * @returns {Promise<object>} The API response data.
     */
    async cachedApiRequest(url, retryCount = 0) {
        // Check cache first
        if (this.responseCache.has(url)) {
            const cached = this.responseCache.get(url);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                if (this.isDebug) {
                    console.log(
                        `[TMDBSource:${this.source.name}] Using cached response for ${url}`
                    );
                }
                return cached.data;
            }
        }

        try {
            await this.rateLimitDelay();
            const response = await fetch(url);

            if (!response.ok) {
                // Handle specific TMDB errors
                if (response.status === 429) {
                    // Rate limit exceeded - retry with exponential backoff
                    if (retryCount < this.maxRetries) {
                        const delay = this.retryDelay * Math.pow(2, retryCount);
                        console.warn(
                            `[TMDBSource:${this.source.name}] Rate limit hit, retrying in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`
                        );
                        await new Promise(resolve => setTimeout(resolve, delay));
                        return this.cachedApiRequest(url, retryCount + 1);
                    } else {
                        throw new Error('TMDB API rate limit exceeded. Please try again later.');
                    }
                } else if (response.status === 401) {
                    throw new Error('Invalid TMDB API key. Please check your configuration.');
                } else if (response.status === 404) {
                    throw new Error('TMDB API endpoint not found.');
                } else if (response.status >= 500) {
                    // Server error - retry
                    if (retryCount < this.maxRetries) {
                        const delay = this.retryDelay * (retryCount + 1);
                        console.warn(
                            `[TMDBSource:${this.source.name}] Server error ${response.status}, retrying in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`
                        );
                        await new Promise(resolve => setTimeout(resolve, delay));
                        return this.cachedApiRequest(url, retryCount + 1);
                    } else {
                        throw new Error(
                            `TMDB API server error: ${response.status} - ${response.statusText}`
                        );
                    }
                } else {
                    throw new Error(`TMDB API error: ${response.status} - ${response.statusText}`);
                }
            }

            const data = await response.json();

            // Cache successful response
            this.responseCache.set(url, {
                data: data,
                timestamp: Date.now(),
            });

            return data;
        } catch (error) {
            // Network or parsing errors - retry for certain types
            if (
                (error.name === 'TypeError' || error.message.includes('fetch')) &&
                retryCount < this.maxRetries
            ) {
                const delay = this.retryDelay * (retryCount + 1);
                console.warn(
                    `[TMDBSource:${this.source.name}] Network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries}): ${error.message}`
                );
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.cachedApiRequest(url, retryCount + 1);
            }

            // Enhanced error logging
            console.error(
                `[TMDBSource:${this.source.name}] API request failed for ${url}: ${error.message}`
            );
            throw error;
        }
    }

    /**
     * Fetches a specified number of items from TMDB.
     * @param {string} type - The type of media ('movie' or 'tv').
     * @param {number} count - The number of items to fetch.
     * @returns {Promise<object[]>} A promise that resolves to an array of processed media items.
     */
    async fetchMedia(type, count) {
        if (count === 0) return [];

        if (this.isDebug) {
            console.log(
                `[TMDBSource:${this.source.name}] Fetching ${count} ${type}(s) from TMDB (category: ${this.source.category})`
            );
        }

        try {
            // Fetch genre mapping first
            const genreMap = await this.fetchGenreMapping(type);

            let allItems = [];
            const itemsPerPage = 20; // TMDB returns max 20 per page
            const pagesToFetch = Math.ceil(count / itemsPerPage);

            // Special handling for latest endpoint (returns single item)
            if (this.source.category === 'latest' || this.source.category === 'tv_latest') {
                const endpoint = this.getEndpoint(type, 1);
                const url = `${this.baseUrl}${endpoint}&api_key=${this.source.apiKey}`;

                try {
                    const data = await this.cachedApiRequest(url);
                    if (data && data.id) {
                        allItems = [data]; // Latest returns single object, not array
                    }
                } catch (error) {
                    console.warn(
                        `[TMDBSource:${this.source.name}] Failed to fetch latest: ${error.message}`
                    );
                }
            } else {
                // Fetch multiple pages for other endpoints
                for (let page = 1; page <= pagesToFetch && page <= 500; page++) {
                    const endpoint = this.getEndpoint(type, page);
                    const url = `${this.baseUrl}${endpoint}&api_key=${this.source.apiKey}`;

                    try {
                        const data = await this.cachedApiRequest(url);

                        if (data.results && Array.isArray(data.results)) {
                            // Filter results by media type for cross-category endpoints
                            let results = data.results;
                            if (
                                this.source.category.startsWith('trending_all') ||
                                this.source.category.startsWith('discover_')
                            ) {
                                results = results.filter(item => {
                                    if (type === 'movie') {
                                        return item.media_type === 'movie' || !item.media_type;
                                    } else if (type === 'tv') {
                                        return (
                                            item.media_type === 'tv' ||
                                            (!item.media_type && item.first_air_date)
                                        );
                                    }
                                    return true;
                                });
                            }
                            allItems = allItems.concat(results);
                        }

                        // Stop if we have enough items
                        if (allItems.length >= count) break;
                    } catch (error) {
                        console.warn(
                            `[TMDBSource:${this.source.name}] Failed to fetch page ${page}: ${error.message}`
                        );
                        // Continue with next page instead of failing completely
                        continue;
                    }
                }
            }

            if (this.isDebug) {
                console.log(
                    `[TMDBSource:${this.source.name}] Found ${allItems.length} total items from TMDB.`
                );
            }

            // Apply content filtering with genre mapping
            const filteredItems = this.applyContentFiltering(allItems, type, genreMap);
            if (this.isDebug) {
                console.log(
                    `[TMDBSource:${this.source.name}] After filtering: ${filteredItems.length} items remaining.`
                );
            }

            const shuffledItems = this.shuffleArray(filteredItems);
            const selectedItems = count > 0 ? shuffledItems.slice(0, count) : shuffledItems;

            // Check if this is a streaming-related category to include streaming data
            const includeStreaming =
                this.source.category && this.source.category.includes('streaming');

            // Process items (async if streaming data needed)
            let processedItems;
            if (includeStreaming) {
                // Use Promise.all for parallel processing when streaming data is needed
                processedItems = await Promise.all(
                    selectedItems.map(item => this.processTMDBItem(item, type, genreMap, true))
                );
                if (this.isDebug) {
                    console.log(
                        `[TMDBSource:${this.source.name}] Fetched streaming data for ${processedItems.length} items.`
                    );
                }
            } else {
                // Use regular map for faster processing when streaming data not needed
                processedItems = await Promise.all(
                    selectedItems.map(item => this.processTMDBItem(item, type, genreMap, false))
                );
            }

            if (this.isDebug) {
                console.log(
                    `[TMDBSource:${this.source.name}] Returning ${processedItems.length} processed items.`
                );
            }

            return processedItems;
        } catch (error) {
            console.error(
                `[TMDBSource:${this.source.name}] Error fetching media: ${error.message}`
            );
            return [];
        }
    }

    /**
     * Gets the appropriate TMDB endpoint based on source configuration.
     * @param {string} type - The media type ('movie' or 'tv').
     * @param {number} page - The page number.
     * @returns {string} The API endpoint.
     */
    getEndpoint(type, page) {
        const category = this.source.category || 'popular';

        // Handle trending endpoints (cross-category)
        if (category.startsWith('trending_')) {
            const [, mediaType, timeWindow] = category.split('_');
            return `/trending/${mediaType}/${timeWindow}?page=${page}`;
        }

        // Handle discover endpoints
        if (category.startsWith('discover_')) {
            const mediaType = category.split('_')[1];
            return `/discover/${mediaType}?page=${page}&sort_by=popularity.desc`;
        }

        // Handle TV-specific categories
        if (category.startsWith('tv_') || type === 'tv') {
            const tvCategory = category.replace('tv_', '');
            switch (tvCategory) {
                case 'popular':
                    return `/tv/popular?page=${page}`;
                case 'top_rated':
                    return `/tv/top_rated?page=${page}`;
                case 'on_the_air':
                    return `/tv/on_the_air?page=${page}`;
                case 'airing_today':
                    return `/tv/airing_today?page=${page}`;
                case 'latest':
                    return `/tv/latest?page=${page}`;
                // New streaming-specific endpoints
                case 'streaming_netflix':
                    return `/discover/tv?page=${page}&with_watch_providers=8&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
                case 'streaming_disney':
                    return `/discover/tv?page=${page}&with_watch_providers=337&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
                case 'streaming_prime':
                    return `/discover/tv?page=${page}&with_watch_providers=119&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
                case 'streaming_hbo':
                    return `/discover/tv?page=${page}&with_watch_providers=1899&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
                case 'streaming_new_releases':
                    return `/discover/tv?page=${page}&with_watch_providers=8|337|119|1899&watch_region=${this.getWatchRegion()}&sort_by=release_date.desc&first_air_date.gte=${this.getRecentDate()}`;
                default:
                    // If category doesn't start with tv_ but type is tv, map movie categories to tv
                    switch (category) {
                        case 'popular':
                            return `/tv/popular?page=${page}`;
                        case 'top_rated':
                            return `/tv/top_rated?page=${page}`;
                        case 'now_playing':
                            return `/tv/on_the_air?page=${page}`;
                        case 'upcoming':
                            return `/tv/on_the_air?page=${page}`;
                        case 'latest':
                            return `/tv/latest?page=${page}`;
                        // New streaming categories for TV
                        case 'streaming_netflix':
                            return `/discover/tv?page=${page}&with_watch_providers=8&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
                        case 'streaming_disney':
                            return `/discover/tv?page=${page}&with_watch_providers=337&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
                        case 'streaming_prime':
                            return `/discover/tv?page=${page}&with_watch_providers=119&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
                        case 'streaming_hbo':
                            return `/discover/tv?page=${page}&with_watch_providers=1899&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
                        case 'streaming_new_releases':
                            return `/discover/tv?page=${page}&with_watch_providers=8|337|119|1899&watch_region=${this.getWatchRegion()}&sort_by=first_air_date.desc&first_air_date.gte=${this.getRecentDate()}`;
                        default:
                            return `/tv/popular?page=${page}`;
                    }
            }
        }

        // Handle movie categories (including new streaming categories)
        switch (category) {
            case 'popular':
                return `/movie/popular?page=${page}`;
            case 'top_rated':
                return `/movie/top_rated?page=${page}`;
            case 'now_playing':
                return `/movie/now_playing?page=${page}`;
            case 'upcoming':
                return `/movie/upcoming?page=${page}`;
            case 'latest':
                return `/movie/latest?page=${page}`;
            // New streaming categories for movies
            case 'streaming_netflix':
                return `/discover/movie?page=${page}&with_watch_providers=8&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
            case 'streaming_disney':
                return `/discover/movie?page=${page}&with_watch_providers=337&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
            case 'streaming_prime':
                return `/discover/movie?page=${page}&with_watch_providers=119&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
            case 'streaming_hbo':
                return `/discover/movie?page=${page}&with_watch_providers=1899&watch_region=${this.getWatchRegion()}&sort_by=popularity.desc`;
            case 'streaming_new_releases':
                return `/discover/movie?page=${page}&with_watch_providers=8|337|119|1899&watch_region=${this.getWatchRegion()}&sort_by=release_date.desc&primary_release_date.gte=${this.getRecentDate()}`;
            default:
                return `/movie/popular?page=${page}`;
        }
    }

    /**
     * Gets the watch region for streaming provider queries.
     * Can be configured in source config, defaults to 'US'.
     * @returns {string} The watch region code.
     */
    getWatchRegion() {
        return this.source.watchRegion || 'US';
    }

    /**
     * Gets a date string for recent releases (last 3 months).
     * @returns {string} Date in YYYY-MM-DD format.
     */
    getRecentDate() {
        const date = new Date();
        date.setMonth(date.getMonth() - 3); // Last 3 months
        return date.toISOString().split('T')[0];
    }

    /**
     * Fetches streaming provider information for a specific item.
     * @param {string} mediaType - 'movie' or 'tv'
     * @param {number} itemId - The TMDB ID of the item
     * @returns {Promise<object>} Streaming provider data
     */
    async fetchStreamingProviders(mediaType, itemId) {
        const cacheKey = `streaming_${mediaType}_${itemId}`;

        // Check cache first
        if (this.responseCache.has(cacheKey)) {
            const cached = this.responseCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                return cached.data;
            }
        }

        try {
            await this.rateLimitDelay();
            const url = `${this.baseUrl}/${mediaType}/${itemId}/watch/providers?api_key=${this.source.apiKey}`;
            const response = await fetch(url);

            if (!response.ok) {
                if (this.isDebug) {
                    console.warn(
                        `[TMDBSource:${this.source.name}] Failed to fetch streaming providers for ${mediaType} ${itemId}: ${response.status}`
                    );
                }
                return null;
            }

            const data = await response.json();

            // Cache the response
            this.responseCache.set(cacheKey, {
                data,
                timestamp: Date.now(),
            });

            return data;
        } catch (error) {
            if (this.isDebug) {
                console.warn(
                    `[TMDBSource:${this.source.name}] Error fetching streaming providers: ${error.message}`
                );
            }
            return null;
        }
    }

    /**
     * Formats streaming provider data for a specific region.
     * @param {object} streamingData - Raw streaming data from TMDB
     * @param {string} region - Region code (e.g., 'US', 'NL', 'GB')
     * @returns {object} Formatted streaming info
     */
    formatStreamingProviders(streamingData, region = null) {
        if (!streamingData || !streamingData.results) {
            return { available: false, providers: [] };
        }

        const watchRegion = region || this.getWatchRegion();
        const regionData = streamingData.results[watchRegion];

        if (!regionData) {
            return { available: false, providers: [] };
        }

        const providers = [];

        // Add flatrate (subscription) providers
        if (regionData.flatrate) {
            providers.push(
                ...regionData.flatrate.map(provider => ({
                    name: provider.provider_name,
                    type: 'subscription',
                    logo: provider.logo_path
                        ? `https://image.tmdb.org/t/p/w92${provider.logo_path}`
                        : null,
                }))
            );
        }

        // Add buy providers
        if (regionData.buy) {
            providers.push(
                ...regionData.buy.map(provider => ({
                    name: provider.provider_name,
                    type: 'buy',
                    logo: provider.logo_path
                        ? `https://image.tmdb.org/t/p/w92${provider.logo_path}`
                        : null,
                }))
            );
        }

        // Add rent providers
        if (regionData.rent) {
            providers.push(
                ...regionData.rent.map(provider => ({
                    name: provider.provider_name,
                    type: 'rent',
                    logo: provider.logo_path
                        ? `https://image.tmdb.org/t/p/w92${provider.logo_path}`
                        : null,
                }))
            );
        }

        return {
            available: providers.length > 0,
            providers: providers,
            region: watchRegion,
            link: regionData.link || null,
        };
    }

    /**
     * Applies content filtering based on source configuration.
     * @param {object[]} items - The items to filter.
     * @param {string} type - The type of media ('movie' or 'tv').
     * @param {Map} genreMap - Map of genre ID to name.
     * @returns {object[]} Filtered items.
     */
    applyContentFiltering(items, type, genreMap) {
        let filteredItems = [...items];

        // Rating filter (vote_average)
        if (this.source.minRating && this.source.minRating > 0) {
            filteredItems = filteredItems.filter(item => {
                return item.vote_average >= this.source.minRating;
            });
            if (this.isDebug) {
                console.log(
                    `[TMDBSource:${this.source.name}] Rating filter (>=${this.source.minRating}): ${filteredItems.length} items.`
                );
            }
        }

        // Genre filter with proper name mapping
        if (this.source.genreFilter && this.source.genreFilter.trim() !== '') {
            const genreNames = this.source.genreFilter
                .split(',')
                .map(g => g.trim().toLowerCase())
                .filter(g => g);

            if (genreNames.length > 0) {
                filteredItems = filteredItems.filter(item => {
                    if (!item.genre_ids || !Array.isArray(item.genre_ids)) return false;

                    // Convert genre IDs to names and check if any match our filter
                    const itemGenreNames = item.genre_ids
                        .map(id => genreMap.get(id))
                        .filter(name => name)
                        .map(name => name.toLowerCase());

                    // Check if any of the item's genres match our filter
                    return genreNames.some(filterGenre =>
                        itemGenreNames.some(
                            itemGenre =>
                                itemGenre.includes(filterGenre) || filterGenre.includes(itemGenre)
                        )
                    );
                });

                if (this.isDebug) {
                    console.log(
                        `[TMDBSource:${this.source.name}] Genre filter (${genreNames.join(', ')}): ${filteredItems.length} items.`
                    );
                }
            }
        }

        // Year filter
        if (this.source.yearFilter) {
            filteredItems = filteredItems.filter(item => {
                const releaseDate = type === 'movie' ? item.release_date : item.first_air_date;
                if (!releaseDate) return false;
                const year = new Date(releaseDate).getFullYear();
                return year >= this.source.yearFilter;
            });
            if (this.isDebug) {
                console.log(
                    `[TMDBSource:${this.source.name}] Year filter (>=${this.source.yearFilter}): ${filteredItems.length} items.`
                );
            }
        }

        return filteredItems;
    }

    /**
     * Processes a TMDB item into the standard format.
     * @param {object} item - The TMDB item.
     * @param {string} type - The type of media ('movie' or 'tv').
     * @param {Map} genreMap - Map of genre ID to name.
     * @param {boolean} includeStreaming - Whether to fetch streaming data.
     * @returns {object} Processed item.
     */
    async processTMDBItem(item, type, genreMap, includeStreaming = false) {
        const title = type === 'movie' ? item.title : item.name;
        const releaseDate = type === 'movie' ? item.release_date : item.first_air_date;
        const year = releaseDate ? new Date(releaseDate).getFullYear() : null;

        // Convert genre IDs to names
        const genres = item.genre_ids
            ? item.genre_ids.map(id => genreMap.get(id)).filter(name => name)
            : [];

        // Base item structure
        const processedItem = {
            key: `tmdb-${item.id}`,
            title: title,
            backgroundUrl: item.backdrop_path
                ? `${this.imageBaseUrl}original${item.backdrop_path}`
                : null,
            posterUrl: item.poster_path ? `${this.imageBaseUrl}w500${item.poster_path}` : null,
            clearLogoUrl: null, // TMDB doesn't provide clear logos
            tagline: item.overview || '',
            rating: item.vote_average || 0,
            year: year,
            genres: genres, // Add genre information
            imdbUrl: null, // We could fetch this from additional API calls if needed
            rottenTomatoes: null, // Not available from TMDB
            source: this.source.name || 'tmdb', // Use source name for better identification
            category: this.source.category, // Add category for provider detection
            tmdbId: item.id,
            mediaType: type, // Add media type for streaming queries
            _raw: item,
        };

        // Add streaming data if requested
        if (includeStreaming) {
            try {
                const streamingData = await this.fetchStreamingProviders(type, item.id);
                if (streamingData) {
                    processedItem.streaming = this.formatStreamingProviders(streamingData);
                    if (this.isDebug) {
                        console.log(
                            `[TMDBSource:${this.source.name}] Added streaming data for ${title}: ${processedItem.streaming.providers.length} providers`
                        );
                    }
                }
            } catch (error) {
                if (this.isDebug) {
                    console.warn(
                        `[TMDBSource:${this.source.name}] Failed to fetch streaming data for ${title}: ${error.message}`
                    );
                }
                processedItem.streaming = { available: false, providers: [] };
            }
        }

        return processedItem;
    }

    /**
     * Get available genres for this TMDB source.
     * @returns {Promise<string[]>} Array of genre names.
     */
    async getAvailableGenres() {
        try {
            const [movieGenres, tvGenres] = await Promise.all([
                this.fetchGenreMapping('movie'),
                this.fetchGenreMapping('tv'),
            ]);

            // Combine and deduplicate genres from both movie and TV
            const allGenres = new Set();
            movieGenres.forEach(name => allGenres.add(name));
            tvGenres.forEach(name => allGenres.add(name));

            return Array.from(allGenres).sort();
        } catch (error) {
            console.error(
                `[TMDBSource:${this.source.name}] Error getting available genres: ${error.message}`
            );
            return [];
        }
    }

    /**
     * Clean up expired cache entries to prevent memory leaks.
     */
    cleanupCache() {
        const now = Date.now();

        // Clean genre cache
        for (const [key, value] of this.genreCache.entries()) {
            if (now - value.timestamp > this.cacheTTL) {
                this.genreCache.delete(key);
            }
        }

        // Clean response cache
        for (const [key, value] of this.responseCache.entries()) {
            if (now - value.timestamp > this.cacheTTL) {
                this.responseCache.delete(key);
            }
        }

        if (this.isDebug) {
            console.log(
                `[TMDBSource:${this.source.name}] Cache cleanup completed. Genre cache: ${this.genreCache.size}, Response cache: ${this.responseCache.size}`
            );
        }
    }

    /**
     * Get cache statistics for debugging.
     * @returns {object} Cache statistics.
     */
    getCacheStats() {
        const now = Date.now();

        const genreStats = {
            total: this.genreCache.size,
            expired: 0,
        };

        const responseStats = {
            total: this.responseCache.size,
            expired: 0,
        };

        for (const [, value] of this.genreCache.entries()) {
            if (now - value.timestamp > this.cacheTTL) {
                genreStats.expired++;
            }
        }

        for (const [, value] of this.responseCache.entries()) {
            if (now - value.timestamp > this.cacheTTL) {
                responseStats.expired++;
            }
        }

        return {
            genreCache: genreStats,
            responseCache: responseStats,
            cacheTTL: this.cacheTTL,
        };
    }
}

module.exports = TMDBSource;
