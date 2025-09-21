const axios = require('axios');
const logger = require('../utils/logger');

class TVDBSource {
    constructor(config) {
        this.enabled = config.enabled || false;
        // Use environment variable if set, otherwise fall back to hardcoded developer key
        this.apiKey = process.env.TVDB_API_KEY || 'be1920c6-6993-42fe-a2ee-ad8e270eba9d';
        this.pin = ''; // Developer keys don't need a PIN
        this.baseURL = 'https://api4.thetvdb.com/v4';
        this.token = null;
        this.tokenExpiry = null;
        this.showCount = config.showCount || 25;
        this.movieCount = config.movieCount || 25;
        this.category = config.category || 'popular';
        this.minRating = config.minRating || 0;
        this.yearFilter = config.yearFilter || null;
        // Optional TMDB enrichment (if TMDB API key is available in overall config)
        this.tmdbApiKey = config.tmdbApiKey || process.env.TMDB_API_KEY || null;

        // Cache for API responses
        this.cache = new Map();
        this.cacheTimeout = 30 * 60 * 1000; // 30 minutes

        // Artwork access circuit-breaker (e.g., 403 subscription required)
        this.artworkBlockedUntil = 0; // epoch ms; when > now we skip artwork calls

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
            errorCount: 0,
        };
    }

    /**
     * Get performance metrics
     * @returns {object} Current performance metrics
     */
    getMetrics() {
        const cacheHitRate =
            this.metrics.requestCount > 0 ? this.metrics.cacheHits / this.metrics.requestCount : 0;

        return {
            totalItems: this.cachedMedia ? this.cachedMedia.length : 0,
            lastFetch: this.lastFetch,
            cacheDuration: this.cacheTimeout || 3600000,
            ...this.metrics,
            cacheHitRate,
            cacheSize: this.cache ? this.cache.size : 0,
        };
    }

    // Get all unique ratings from the media collection
    getAvailableRatings() {
        if (!this.cachedMedia) {
            return [];
        }

        const ratings = new Set();
        this.cachedMedia.forEach(item => {
            if (item.rating && item.rating.trim()) {
                ratings.add(item.rating.trim());
            }
        });

        return Array.from(ratings).sort();
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
            errorCount: 0,
        };
    }

    async authenticate() {
        if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.token;
        }

        try {
            // For developer API keys, we don't need a PIN
            const authBody = {
                apikey: this.apiKey,
            };

            // Only add PIN if it's provided (for user accounts)
            if (this.pin && this.pin.trim() !== '') {
                authBody.pin = this.pin;
            }

            const response = await axios.post(`${this.baseURL}/login`, authBody);

            if (response.data && response.data.data && response.data.data.token) {
                this.token = response.data.data.token;
                // TVDB tokens expire after 1 month, but we'll refresh every 24 hours to be safe
                this.tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
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
                    Authorization: `Bearer ${this.token}`,
                    Accept: 'application/json',
                },
                params,
            });
            // Record basic request metrics and last successful fetch time
            try {
                this.metrics.requestCount = (this.metrics.requestCount || 0) + 1;
                this.metrics.lastRequestTime = new Date();
                this.lastFetch = Date.now();
            } catch (_) {
                /* update metrics best-effort */
            }
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
                            Authorization: `Bearer ${this.token}`,
                            Accept: 'application/json',
                        },
                        params,
                    });
                    // Record basic request metrics and last successful fetch time on retry
                    try {
                        this.metrics.requestCount = (this.metrics.requestCount || 0) + 1;
                        this.metrics.lastRequestTime = new Date();
                        this.lastFetch = Date.now();
                    } catch (_) {
                        /* update metrics best-effort */
                    }
                    return retryResponse.data;
                } catch (retryError) {
                    logger.error('TVDB API retry failed:', retryError.message);
                    throw retryError;
                }
            }

            // For artwork endpoints, 403/404/429 are expected in some setups (no subscription, not found, rate-limit)
            // Down-level logging to avoid loud ERROR spam in normal operation
            try {
                const status = error.response?.status;
                if (typeof endpoint === 'string' && endpoint.includes('/artworks')) {
                    if (status === 403) {
                        logger.warn(
                            'TVDB artworks endpoint returned 403 (forbidden). Skipping artwork fetches.'
                        );
                    } else if (status === 404) {
                        logger.debug('TVDB artworks endpoint returned 404 (not found).');
                    } else if (status === 429) {
                        logger.warn('TVDB artworks endpoint rate-limited (429). Backing off.');
                    } else {
                        logger.warn('TVDB API request (artworks) failed:', error.message);
                    }
                } else {
                    logger.error('TVDB API request failed:', error.message);
                }
            } catch (_) {
                logger.error('TVDB API request failed:', error.message);
            }
            throw error;
        }
    }

    // --- Optional TMDB enrichment helpers ---
    getTMDBImageUrl(path, type = 'poster') {
        if (!path) return null;
        const base = 'https://image.tmdb.org/t/p';
        // Prefer high quality; caller can downscale via CSS
        if (type === 'backdrop') return `${base}/original${path}`;
        return `${base}/original${path}`;
    }

    async searchTMDBByTitle(title, year, type = 'movie') {
        if (!this.tmdbApiKey || !title) return null;
        try {
            const endpoint = type === 'tv' ? '/search/tv' : '/search/movie';
            const params = {
                api_key: this.tmdbApiKey,
                query: title,
                language: 'en-US',
                include_adult: false,
                page: 1,
            };
            if (year && type === 'movie') params.year = year;
            if (year && type === 'tv') params.first_air_date_year = year;
            const url = `https://api.themoviedb.org/3${endpoint}`;
            const r = await axios.get(url, { params });
            const results = r.data && Array.isArray(r.data.results) ? r.data.results : [];
            return results && results.length ? results[0] : null;
        } catch (e) {
            // quiet failure
            return null;
        }
    }

    async enrichArtworkWithTMDB(title, year, type = 'movie') {
        if (!this.tmdbApiKey || !title) return { fanart: null, poster: null };
        const hit = await this.searchTMDBByTitle(title, year, type === 'tv' ? 'tv' : 'movie');
        if (!hit) return { fanart: null, poster: null };
        const poster = this.getTMDBImageUrl(hit.poster_path, 'poster');
        const fanart = this.getTMDBImageUrl(hit.backdrop_path, 'backdrop');
        return { fanart, poster };
    }

    async getArtwork(itemId, itemType = 'series') {
        try {
            // If artwork is temporarily blocked (e.g., 403), short-circuit to avoid noisy retries
            if (this.artworkBlockedUntil && Date.now() < this.artworkBlockedUntil) {
                return { fanart: null, poster: null };
            }
            const cacheKey = `tvdb_artwork_${itemType}_${itemId}`;
            const cached = this.getCachedData(cacheKey);
            if (cached) {
                // Reflect last data readiness time even when served from cache
                const entry = this.cache.get(cacheKey);
                if (entry && entry.timestamp) this.lastFetch = entry.timestamp;
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
            const fanart =
                artworks.find(art => art.type === 5) || // type 5 = fanart
                artworks.find(art => art.type === 3) || // type 3 = background
                artworks.find(art => art.language === 'eng' && art.type === 15); // type 15 = series images

            const poster =
                artworks.find(art => art.type === 2 && art.language === 'eng') || // type 2 = poster
                artworks.find(art => art.type === 1); // type 1 = poster (any language)

            const result = {
                fanart: fanart ? this.getImageUrl(fanart.image) : null,
                poster: poster ? this.getImageUrl(poster.image) : null,
            };

            // If TVDB lacks artwork and TMDB API key is available, try to enrich
            // Note: If TVDB lacks artwork, enrichment is attempted later where title/year are available

            this.setCachedData(cacheKey, result);
            return result;
        } catch (error) {
            try {
                const status = error?.response?.status;
                if (status === 403) {
                    // Likely subscription required; back off artwork requests for a while to reduce noise
                    this.artworkBlockedUntil = Date.now() + 15 * 60 * 1000; // 15 minutes
                    logger.info(
                        'TVDB artwork access forbidden (403). Will skip artwork fetches for 15 minutes.'
                    );
                }
                if (status === 404) {
                    // Not found for this item; no need to warn loudly
                    logger.debug(`TVDB artwork not found (404) for ${itemType} ${itemId}.`);
                } else if (status === 429) {
                    // Rate limiting: brief backoff
                    this.artworkBlockedUntil = Math.max(
                        this.artworkBlockedUntil,
                        Date.now() + 2 * 60 * 1000
                    );
                    logger.warn(
                        'TVDB artwork requests are rate-limited (429). Short backoff applied.'
                    );
                } else if (status && status !== 403) {
                    logger.warn(
                        `Failed to fetch artwork for ${itemType} ${itemId} (status ${status}):`,
                        error.message
                    );
                } else if (!status) {
                    logger.warn(
                        `Failed to fetch artwork for ${itemType} ${itemId}:`,
                        error.message
                    );
                }
            } catch (_) {
                // Best-effort logging only
            }
            const fallback = { fanart: null, poster: null };
            // Cache null result to avoid repeated attempts for this item during cache window
            try {
                const cacheKey = `tvdb_artwork_${itemType}_${itemId}`;
                this.setCachedData(cacheKey, fallback);
            } catch (_) {}
            return fallback;
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
        return Array.from(this.genreMap.entries())
            .map(([id, name]) => ({
                id: id.toString(),
                name,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
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
            timestamp: Date.now(),
        });
    }

    async getShows() {
        if (!this.enabled) {
            return [];
        }

        try {
            const cacheKey = `tvdb_shows_${this.category}_${this.showCount}_${this.minRating}_${this.yearFilter}`;
            const cached = this.getCachedData(cacheKey);
            if (cached) {
                // Reflect last data readiness time even when served from cache
                const entry = this.cache.get(cacheKey);
                if (entry && entry.timestamp) this.lastFetch = entry.timestamp;
                return cached;
            }

            const endpoint = '/series';
            const params = {
                limit: Math.min(this.showCount * 2, 500), // Get more to filter
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

            // Add filters (when a single year is provided). TVDB API accepts a single year.
            if (this.yearFilter && typeof this.yearFilter === 'number') {
                params.year = this.yearFilter;
            }

            const response = await this.makeAuthenticatedRequest(endpoint, params);

            if (!response.data || !Array.isArray(response.data)) {
                logger.warn('Invalid TVDB series response format');
                return [];
            }

            let shows = await this.processShows(response.data);
            // Apply year expression filtering if configured as string (lists/ranges)
            if (this.yearFilter && typeof this.yearFilter === 'string') {
                const expr = this.yearFilter;
                const parts = expr
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
                const ranges = [];
                for (const p of parts) {
                    const m1 = p.match(/^\d{4}$/);
                    const m2 = p.match(/^(\d{4})\s*-\s*(\d{4})$/);
                    if (m1) {
                        const y = Number(m1[0]);
                        if (y >= 1900) ranges.push([y, y]);
                    } else if (m2) {
                        const a = Number(m2[1]);
                        const b = Number(m2[2]);
                        if (a >= 1900 && b >= a) ranges.push([a, b]);
                    }
                }
                if (ranges.length) {
                    shows = shows.filter(itm => {
                        const y = itm.year;
                        return typeof y === 'number' && ranges.some(([a, b]) => y >= a && y <= b);
                    });
                }
            }

            // Mark last successful fetch time (used by admin UI)
            this.lastFetch = Date.now();
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
            const cacheKey = `tvdb_movies_${this.category}_${this.movieCount}_${this.minRating}_${this.yearFilter}`;
            const cached = this.getCachedData(cacheKey);
            if (cached) {
                // Reflect last data readiness time even when served from cache
                const entry = this.cache.get(cacheKey);
                if (entry && entry.timestamp) this.lastFetch = entry.timestamp;
                return cached;
            }

            const endpoint = '/movies';
            const params = {
                limit: Math.min(this.movieCount * 2, 500),
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

            // Add filters (when a single year is provided). TVDB API accepts a single year.
            if (this.yearFilter && typeof this.yearFilter === 'number') {
                params.year = this.yearFilter;
            }

            const response = await this.makeAuthenticatedRequest(endpoint, params);

            if (!response.data || !Array.isArray(response.data)) {
                logger.warn('Invalid TVDB movies response format');
                return [];
            }

            let movies = await this.processMovies(response.data);
            if (this.yearFilter && typeof this.yearFilter === 'string') {
                const expr = this.yearFilter;
                const parts = expr
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
                const ranges = [];
                for (const p of parts) {
                    const m1 = p.match(/^\d{4}$/);
                    const m2 = p.match(/^(\d{4})\s*-\s*(\d{4})$/);
                    if (m1) {
                        const y = Number(m1[0]);
                        if (y >= 1900) ranges.push([y, y]);
                    } else if (m2) {
                        const a = Number(m2[1]);
                        const b = Number(m2[2]);
                        if (a >= 1900 && b >= a) ranges.push([a, b]);
                    }
                }
                if (ranges.length) {
                    movies = movies.filter(itm => {
                        const y = itm.year;
                        return typeof y === 'number' && ranges.some(([a, b]) => y >= a && y <= b);
                    });
                }
            }

            // Mark last successful fetch time (used by admin UI)
            this.lastFetch = Date.now();
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
                if (
                    this.minRating > 0 &&
                    (!show.averageRating || show.averageRating < this.minRating)
                ) {
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
                        // artwork fetch failed; continue with fallback
                        if (this.metrics)
                            this.metrics.errorCount = (this.metrics.errorCount || 0) + 1;
                    }
                    // If still missing and TMDB enrichment available, try using title/year
                    if (!backgroundUrl || !posterUrl) {
                        try {
                            const enriched = await this.enrichArtworkWithTMDB(
                                show.name,
                                this.extractYear(show.firstAired),
                                'tv'
                            );
                            backgroundUrl = backgroundUrl || enriched.fanart;
                            posterUrl = posterUrl || enriched.poster;
                        } catch (e) {
                            // enrichment failed; continue
                        }
                    }
                }

                const processedShow = {
                    key: `tvdb-${show.id}`,
                    title: show.name || 'Unknown Title',
                    year: this.extractYear(show.firstAired),
                    rating: show.averageRating || 0,
                    genres: [], // TODO: TVDB /series endpoint doesn't include genres - needs separate API calls
                    tagline: show.overview || '',
                    posterUrl: posterUrl,
                    backgroundUrl: backgroundUrl,
                    clearLogoUrl: null, // TVDB doesn't provide clear logos
                    imdbUrl: null, // Could be added with additional API calls
                    rottenTomatoes: null, // Not available from TVDB
                    source: 'tvdb',
                    id: show.id,
                    type: 'tv',
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
                if (
                    this.minRating > 0 &&
                    (!movie.averageRating || movie.averageRating < this.minRating)
                ) {
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
                        if (this.metrics)
                            this.metrics.errorCount = (this.metrics.errorCount || 0) + 1;
                    }
                    // If still missing and TMDB enrichment available, try using title/year
                    if (!backgroundUrl || !posterUrl) {
                        try {
                            const enriched = await this.enrichArtworkWithTMDB(
                                movie.name,
                                this.extractYear(movie.releaseDate),
                                'movie'
                            );
                            backgroundUrl = backgroundUrl || enriched.fanart;
                            posterUrl = posterUrl || enriched.poster;
                        } catch (e) {
                            // enrichment failed; continue
                        }
                    }
                }

                const processedMovie = {
                    key: `tvdb-${movie.id}`,
                    title: movie.name || 'Unknown Title',
                    year: this.extractYear(movie.releaseDate),
                    rating: movie.averageRating || 0,
                    genres: [], // TODO: TVDB /movies endpoint doesn't include genres - needs separate API calls
                    tagline: movie.overview || '',
                    posterUrl: posterUrl,
                    backgroundUrl: backgroundUrl,
                    clearLogoUrl: null, // TVDB doesn't provide clear logos
                    imdbUrl: null, // Could be added with additional API calls
                    rottenTomatoes: null, // Not available from TVDB
                    source: 'tvdb',
                    id: movie.id,
                    type: 'movie',
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

        return genreIds.map(id => this.genreMap.get(id)).filter(name => name);
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
                        apiVersion: 'v4',
                    },
                };
            } else {
                return {
                    success: false,
                    message: 'Invalid response from TVDB API',
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `TVDB connection failed: ${error.message}`,
            };
        }
    }

    getCacheStats() {
        const stats = {
            totalEntries: this.cache.size,
            entries: [],
        };

        for (const [key, value] of this.cache.entries()) {
            const age = Date.now() - value.timestamp;
            const remaining = Math.max(0, this.cacheTimeout - age);

            stats.entries.push({
                key,
                age: Math.round(age / 1000),
                remaining: Math.round(remaining / 1000),
                size: JSON.stringify(value.data).length,
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
