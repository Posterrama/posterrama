const axios = require('axios');
const logger = require('../logger');

class TVDBSource {
    constructor(config) {
        this.enabled = config.enabled || false;
        // Use hardcoded developer API key for all Posterrama users
        this.apiKey = 'be1920c6-6993-42fe-a2ee-ad8e270eba9d';
        this.pin = ''; // Developer keys don't need a PIN
        this.baseURL = 'https://api4.thetvdb.com/v4';
        this.token = null;
        this.tokenExpiry = null;
        this.showCount = config.showCount || 25;
        this.movieCount = config.movieCount || 25;
        this.category = config.category || 'popular';
        this.minRating = config.minRating || 0;
        this.yearFilter = config.yearFilter || null;
        this.genreFilter = config.genreFilter || '';
        
        // Cache for API responses
        this.cache = new Map();
        this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
        
        // Genre mapping cache
        this.genreMap = new Map();
        this.genresLoaded = false;
        
        // Performance metrics
        this.metrics = {
            requestCount: 0,
            authCount: 0,
            cacheHits: 0,
            cacheMisses: 0,
            averageResponseTime: 0,
            lastRequestTime: null,
            errorCount: 0
        };
    }

    /**
     * Get performance metrics
     * @returns {object} Current performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            cacheHitRate: this.metrics.requestCount > 0 ? 
                (this.metrics.cacheHits / this.metrics.requestCount) : 0,
            cacheSize: this.cache.size,
            genreMapSize: this.genreMap.size
        };
    }

    /**
     * Reset performance metrics
     */
    resetMetrics() {
        this.metrics = {
            requestCount: 0,
            authCount: 0,
            cacheHits: 0,
            cacheMisses: 0,
            averageResponseTime: 0,
            lastRequestTime: null,
            errorCount: 0
        };
    }

    async authenticate() {
        if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.token;
        }

        try {
            // For developer API keys, we don't need a PIN
            const authBody = {
                apikey: this.apiKey
            };
            
            // Only add PIN if it's provided (for user accounts)
            if (this.pin && this.pin.trim() !== '') {
                authBody.pin = this.pin;
            }

            const response = await axios.post(`${this.baseURL}/login`, authBody);

            if (response.data && response.data.data && response.data.data.token) {
                this.token = response.data.data.token;
                // TVDB tokens expire after 1 month, but we'll refresh every 24 hours to be safe
                this.tokenExpiry = Date.now() + (24 * 60 * 60 * 1000);
                logger.info('TVDB authentication successful');
                return this.token;
            } else {
                throw new Error('Invalid authentication response from TVDB');
            }
        } catch (error) {
            logger.error('TVDB authentication failed:', error.message);
            throw new Error(`TVDB authentication failed: ${error.message}`);
        }
    }

    async makeAuthenticatedRequest(endpoint, params = {}) {
        try {
            await this.authenticate();
            
            const response = await axios.get(`${this.baseURL}${endpoint}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Accept': 'application/json'
                },
                params
            });

            return response.data;
        } catch (error) {
            if (error.response?.status === 401) {
                // Token expired, clear it and retry once
                this.token = null;
                this.tokenExpiry = null;
                
                try {
                    await this.authenticate();
                    const retryResponse = await axios.get(`${this.baseURL}${endpoint}`, {
                        headers: {
                            'Authorization': `Bearer ${this.token}`,
                            'Accept': 'application/json'
                        },
                        params
                    });
                    return retryResponse.data;
                } catch (retryError) {
                    logger.error('TVDB API retry failed:', retryError.message);
                    throw retryError;
                }
            }
            
            logger.error('TVDB API request failed:', error.message);
            throw error;
        }
    }

    async getArtwork(itemId, itemType = 'series') {
        try {
            const cacheKey = `tvdb_artwork_${itemType}_${itemId}`;
            const cached = this.getCachedData(cacheKey);
            if (cached) {
                return cached;
            }

            let endpoint;
            if (itemType === 'movie' || itemType === 'movies') {
                endpoint = `/movies/${itemId}/artworks`;
            } else {
                endpoint = `/series/${itemId}/artworks`;
            }

            const response = await this.makeAuthenticatedRequest(endpoint);
            
            if (!response.data || !Array.isArray(response.data.artworks)) {
                return { fanart: null, poster: null };
            }

            const artworks = response.data.artworks;
            
            // Find fanart (background) and poster
            const fanart = artworks.find(art => art.type === 5) || // type 5 = fanart
                          artworks.find(art => art.type === 3) || // type 3 = background  
                          artworks.find(art => art.language === 'eng' && art.type === 15); // type 15 = series images
            
            const poster = artworks.find(art => art.type === 2 && art.language === 'eng') || // type 2 = poster
                          artworks.find(art => art.type === 1); // type 1 = poster (any language)

            const result = {
                fanart: fanart ? this.getImageUrl(fanart.image) : null,
                poster: poster ? this.getImageUrl(poster.image) : null
            };

            this.setCachedData(cacheKey, result);
            return result;

        } catch (error) {
            logger.warn(`Failed to fetch artwork for ${itemType} ${itemId}:`, error.message);
            return { fanart: null, poster: null };
        }
    }

    async loadGenres() {
        if (this.genresLoaded) return;

        try {
            const cacheKey = 'tvdb_genres';
            const cached = this.getCachedData(cacheKey);
            if (cached) {
                this.processGenreData(cached);
                return;
            }

            const response = await this.makeAuthenticatedRequest('/genres');
            
            if (response.data && Array.isArray(response.data)) {
                this.setCachedData(cacheKey, response.data);
                this.processGenreData(response.data);
            }
        } catch (error) {
            logger.error('Failed to load TVDB genres:', error.message);
        }
    }

    processGenreData(genres) {
        this.genreMap.clear();
        genres.forEach(genre => {
            if (genre.id && genre.name) {
                this.genreMap.set(genre.id, genre.name);
            }
        });
        this.genresLoaded = true;
        logger.info(`Loaded ${this.genreMap.size} TVDB genres`);
    }

    async getGenres() {
        await this.loadGenres();
        return Array.from(this.genreMap.entries()).map(([id, name]) => ({
            id: id.toString(),
            name
        }));
    }

    getCachedData(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    setCachedData(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    async getShows() {
        if (!this.enabled) {
            return [];
        }

        try {
            const cacheKey = `tvdb_shows_${this.category}_${this.showCount}_${this.minRating}_${this.yearFilter}_${this.genreFilter}`;
            const cached = this.getCachedData(cacheKey);
            if (cached) {
                return cached;
            }

            let endpoint = '/series';
            let params = {
                limit: Math.min(this.showCount * 2, 500) // Get more to filter
            };

            // Add category-specific parameters
            switch (this.category) {
                case 'popular':
                    params.sort = 'score';
                    break;
                case 'top_rated':
                    params.sort = 'averageRating';
                    break;
                case 'trending':
                case 'recently_updated':
                    params.sort = 'lastUpdated';
                    break;
                case 'newest':
                    params.sort = 'firstAired';
                    break;
                case 'oldest':
                    params.sort = 'firstAired';
                    // TODO: Add reverse order when TVDB supports it
                    break;
                case 'recently_added':
                    params.sort = 'createdAt';
                    break;
                case 'alphabetical':
                    params.sort = 'name';
                    break;
                default:
                    params.sort = 'score'; // Default fallback
                    break;
            }

            // Add filters
            if (this.yearFilter) {
                params.year = this.yearFilter;
            }

            if (this.genreFilter) {
                params.genre = this.genreFilter;
            }

            const response = await this.makeAuthenticatedRequest(endpoint, params);
            
            if (!response.data || !Array.isArray(response.data)) {
                logger.warn('Invalid TVDB series response format');
                return [];
            }

            const shows = await this.processShows(response.data);
            
            this.setCachedData(cacheKey, shows);
            return shows;

        } catch (error) {
            logger.error('Failed to fetch TVDB shows:', error.message);
            return [];
        }
    }

    async getMovies() {
        if (!this.enabled) {
            return [];
        }

        try {
            const cacheKey = `tvdb_movies_${this.category}_${this.movieCount}_${this.minRating}_${this.yearFilter}_${this.genreFilter}`;
            const cached = this.getCachedData(cacheKey);
            if (cached) {
                return cached;
            }

            let endpoint = '/movies';
            let params = {
                limit: Math.min(this.movieCount * 2, 500)
            };

            // Add category-specific parameters
            switch (this.category) {
                case 'popular':
                    params.sort = 'score';
                    break;
                case 'top_rated':
                    params.sort = 'averageRating';
                    break;
                case 'trending':
                case 'recently_updated':
                    params.sort = 'lastUpdated';
                    break;
                case 'newest':
                    params.sort = 'releaseDate';
                    break;
                case 'oldest':
                    params.sort = 'releaseDate';
                    // TODO: Add reverse order when TVDB supports it
                    break;
                case 'recently_added':
                    params.sort = 'createdAt';
                    break;
                case 'alphabetical':
                    params.sort = 'name';
                    break;
                default:
                    params.sort = 'score'; // Default fallback
                    break;
            }

            // Add filters
            if (this.yearFilter) {
                params.year = this.yearFilter;
            }

            if (this.genreFilter) {
                params.genre = this.genreFilter;
            }

            const response = await this.makeAuthenticatedRequest(endpoint, params);
            
            if (!response.data || !Array.isArray(response.data)) {
                logger.warn('Invalid TVDB movies response format');
                return [];
            }

            const movies = await this.processMovies(response.data);
            
            this.setCachedData(cacheKey, movies);
            return movies;

        } catch (error) {
            logger.error('Failed to fetch TVDB movies:', error.message);
            return [];
        }
    }

    async processShows(shows) {
        const processed = [];
        
        for (const show of shows) {
            try {
                // Apply rating filter
                if (this.minRating > 0 && (!show.averageRating || show.averageRating < this.minRating)) {
                    continue;
                }

                // Try to get better artwork for first few items
                let backgroundUrl = this.getImageUrl(show.fanart) || this.getImageUrl(show.image);
                let posterUrl = this.getImageUrl(show.image);
                
                // For the first 5 items, try to get high quality artwork
                if (processed.length < 5) {
                    try {
                        const artwork = await this.getArtwork(show.id, 'series');
                        if (artwork.fanart) {
                            backgroundUrl = artwork.fanart;
                        }
                        if (artwork.poster) {
                            posterUrl = artwork.poster;
                        }
                    } catch (error) {
                        // Ignore artwork fetch errors, use fallback
                    }
                }

                const processedShow = {
                    key: `tvdb-${show.id}`,
                    title: show.name || 'Unknown Title',
                    year: this.extractYear(show.firstAired),
                    rating: show.averageRating || 0,
                    genres: await this.mapGenres(show.genres || []),
                    tagline: show.overview || '',
                    posterUrl: posterUrl,
                    backgroundUrl: backgroundUrl,
                    clearLogoUrl: null, // TVDB doesn't provide clear logos
                    imdbUrl: null, // Could be added with additional API calls
                    rottenTomatoes: null, // Not available from TVDB
                    source: 'tvdb',
                    id: show.id,
                    type: 'tv'
                };

                processed.push(processedShow);
                
                if (processed.length >= this.showCount) {
                    break;
                }
            } catch (error) {
                logger.warn('Error processing TVDB show:', error.message);
            }
        }

        return processed;
    }

    async processMovies(movies) {
        const processed = [];
        
        for (const movie of movies) {
            try {
                // Apply rating filter
                if (this.minRating > 0 && (!movie.averageRating || movie.averageRating < this.minRating)) {
                    continue;
                }

                // Try to get better artwork for first few items
                let backgroundUrl = this.getImageUrl(movie.fanart) || this.getImageUrl(movie.image);
                let posterUrl = this.getImageUrl(movie.image);
                
                // For the first 5 items, try to get high quality artwork
                if (processed.length < 5) {
                    try {
                        const artwork = await this.getArtwork(movie.id, 'movie');
                        if (artwork.fanart) {
                            backgroundUrl = artwork.fanart;
                        }
                        if (artwork.poster) {
                            posterUrl = artwork.poster;
                        }
                    } catch (error) {
                        // Ignore artwork fetch errors, use fallback
                    }
                }

                const processedMovie = {
                    key: `tvdb-${movie.id}`,
                    title: movie.name || 'Unknown Title',
                    year: this.extractYear(movie.releaseDate),
                    rating: movie.averageRating || 0,
                    genres: await this.mapGenres(movie.genres || []),
                    tagline: movie.overview || '',
                    posterUrl: posterUrl,
                    backgroundUrl: backgroundUrl,
                    clearLogoUrl: null, // TVDB doesn't provide clear logos
                    imdbUrl: null, // Could be added with additional API calls
                    rottenTomatoes: null, // Not available from TVDB
                    source: 'tvdb',
                    id: movie.id,
                    type: 'movie'
                };

                processed.push(processedMovie);
                
                if (processed.length >= this.movieCount) {
                    break;
                }
            } catch (error) {
                logger.warn('Error processing TVDB movie:', error.message);
            }
        }

        return processed;
    }

    async mapGenres(genreIds) {
        if (!Array.isArray(genreIds) || genreIds.length === 0) {
            return [];
        }

        await this.loadGenres();
        
        return genreIds
            .map(id => this.genreMap.get(id))
            .filter(name => name);
    }

    extractYear(dateString) {
        if (!dateString) return null;
        const match = dateString.match(/^\d{4}/);
        return match ? parseInt(match[0]) : null;
    }

    getImageUrl(imagePath) {
        if (!imagePath) return null;
        
        // TVDB image URLs are typically full URLs or relative paths
        if (imagePath.startsWith('http')) {
            return imagePath;
        }
        
        return `https://artworks.thetvdb.com${imagePath}`;
    }

    async testConnection() {
        try {
            await this.authenticate();
            
            // Test with a simple API call
            const response = await this.makeAuthenticatedRequest('/series', { limit: 1 });
            
            if (response && response.data) {
                return {
                    success: true,
                    message: 'TVDB connection successful',
                    details: {
                        authenticated: true,
                        apiVersion: 'v4'
                    }
                };
            } else {
                return {
                    success: false,
                    message: 'Invalid response from TVDB API'
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `TVDB connection failed: ${error.message}`
            };
        }
    }

    getCacheStats() {
        const stats = {
            totalEntries: this.cache.size,
            entries: []
        };

        for (const [key, value] of this.cache.entries()) {
            const age = Date.now() - value.timestamp;
            const remaining = Math.max(0, this.cacheTimeout - age);
            
            stats.entries.push({
                key,
                age: Math.round(age / 1000),
                remaining: Math.round(remaining / 1000),
                size: JSON.stringify(value.data).length
            });
        }

        return stats;
    }

    clearCache() {
        this.cache.clear();
        this.genreMap.clear();
        this.genresLoaded = false;
        logger.info('TVDB cache cleared');
    }
}

module.exports = TVDBSource;
