/**
 * Plex media source for posterrama.app
 * Handles fetching and processing media from a Plex server.
 */
const logger = require('../utils/logger');

class PlexSource {
    constructor(
        serverConfig,
        getPlexClient,
        processPlexItem,
        getPlexLibraries,
        shuffleArray,
        rtMinScore,
        isDebug
    ) {
        this.server = serverConfig;
        this.getPlexClient = getPlexClient;
        this.processPlexItem = processPlexItem;
        this.getPlexLibraries = getPlexLibraries;
        this.shuffleArray = shuffleArray;
        this.rtMinScore = rtMinScore;
        this.isDebug = isDebug;
        // Lazy initialization: plex client will be awaited on first use
        this.plexPromise = null;
        this.plex = null;

        // Performance metrics
        this.metrics = {
            requestCount: 0,
            itemsProcessed: 0,
            itemsFiltered: 0,
            averageProcessingTime: 0,
            lastRequestTime: null,
            errorCount: 0,
        };
    }

    /**
     * Get performance metrics
     * @returns {object} Current performance metrics
     */
    getMetrics() {
        const filterEfficiency =
            this.metrics.itemsProcessed > 0
                ? this.metrics.itemsFiltered / this.metrics.itemsProcessed
                : 0;

        return {
            totalItems: this.cachedMedia ? this.cachedMedia.length : 0,
            lastFetch: this.lastFetch,
            cacheDuration: 3600000, // Default cache duration
            ...this.metrics,
            filterEfficiency,
        };
    }

    /**
     * Ensures the Plex client is initialized (lazy loading)
     * @returns {Promise<void>}
     * @private
     */
    async ensurePlexClient() {
        if (!this.plex) {
            if (!this.plexPromise) {
                this.plexPromise = this.getPlexClient(this.server);
            }
            this.plex = await this.plexPromise;
        }
    }

    // Get all unique content ratings from the media collection
    getAvailableRatings() {
        if (!this.cachedMedia) {
            return [];
        }

        const ratings = new Set();
        this.cachedMedia.forEach(item => {
            if (item.contentRating && item.contentRating.trim()) {
                ratings.add(item.contentRating.trim());
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
            itemsProcessed: 0,
            itemsFiltered: 0,
            averageProcessingTime: 0,
            lastRequestTime: null,
            errorCount: 0,
        };
    }

    /**
     * Fetches a specified number of items from a list of libraries.
     * @param {string[]} libraryNames - The names of the libraries to fetch from.
     * @param {string} type - The type of media ('movie' or 'show').
     * @param {number} count - The number of items to fetch.
     * @returns {Promise<object[]>} A promise that resolves to an array of processed media items.
     */
    async fetchMedia(libraryNames, type, count) {
        if (!libraryNames || libraryNames.length === 0 || count === 0) {
            return [];
        }

        // Ensure Plex client is initialized (lazy loading)
        await this.ensurePlexClient();

        const reqStart = Date.now();
        this.metrics.requestCount++;

        if (this.isDebug) {
            logger.info(`Fetching media from Plex`, {
                server: this.server.name,
                type,
                count,
                libraries: libraryNames,
            });
        }

        try {
            const allLibraries = await this.getPlexLibraries(this.server);
            let allItems = [];

            for (const name of libraryNames) {
                const library = allLibraries.get(name);
                if (!library) {
                    logger.warn(`[PlexSource:${this.server.name}] Library "${name}" not found.`);
                    continue;
                }

                try {
                    const content = await this.plex.query(`/library/sections/${library.key}/all`);
                    if (content?.MediaContainer?.Metadata) {
                        // Add library info to each item
                        const itemsWithLibrary = content.MediaContainer.Metadata.map(item => ({
                            ...item,
                            librarySectionTitle: name,
                            librarySectionID: library.key,
                        }));
                        allItems = allItems.concat(itemsWithLibrary);
                        if (this.isDebug) {
                            logger.debug(
                                `[PlexSource:${this.server.name}] Library "${name}" provided ${content.MediaContainer.Metadata.length} items`
                            );
                        }
                    }
                } catch (libraryError) {
                    logger.error(
                        `[PlexSource:${this.server.name}] Failed to fetch from library "${name}":`,
                        {
                            error: libraryError.message,
                            type,
                            libraryKey: library.key,
                        }
                    );
                    // Continue with other libraries
                }
            }

            if (this.isDebug) {
                logger.debug(
                    `[PlexSource:${this.server.name}] Found ${allItems.length} total items in specified libraries.`
                );
                if (allItems.length === 0) {
                    logger.debug(
                        `[PlexSource:${this.server.name}] No items returned. Check that library names exist and contain media. Names: ${libraryNames.join(', ')}`
                    );
                }
            }

            // Apply content filtering
            const filteredItems = this.applyContentFiltering(allItems);
            this.metrics.itemsProcessed += allItems.length;
            this.metrics.itemsFiltered += Math.max(0, allItems.length - filteredItems.length);
            if (this.isDebug) {
                logger.debug(
                    `[PlexSource:${this.server.name}] After filtering: ${filteredItems.length} items remaining.`
                );
                if (filteredItems.length === 0) {
                    logger.debug(
                        `[PlexSource:${this.server.name}] All items filtered out. Check ratingFilter (${JSON.stringify(
                            this.server.ratingFilter || 'none'
                        )}), qualityFilter (${JSON.stringify(
                            this.server.qualityFilter || 'none'
                        )}), yearFilter (${JSON.stringify(this.server.yearFilter || 'none')}).`
                    );
                }
            }

            const shuffledItems = this.shuffleArray(filteredItems);
            const selectedItems = count > 0 ? shuffledItems.slice(0, count) : shuffledItems;

            const processedItems = await Promise.all(
                selectedItems.map(async item => {
                    try {
                        return await this.processPlexItem(item, this.server, this.plex);
                    } catch (e) {
                        this.metrics.errorCount++;
                        if (this.isDebug) {
                            logger.warn(
                                `[PlexSource:${this.server.name}] Failed to process item ${item.key || item.ratingKey || item.title || 'unknown'}: ${e.message}`
                            );
                        }
                        return null;
                    }
                })
            );

            const finalItems = processedItems.filter(item => {
                if (!item) return false;
                if (this.rtMinScore > 0 && item.rottenTomatoes) {
                    return item.rottenTomatoes.originalScore * 10 >= this.rtMinScore;
                }
                return true;
            });

            // Mark successful fetch time
            this.lastFetch = Date.now();
            this.cachedMedia = finalItems;

            // Update average processing time (EMA to smooth)
            const duration = Date.now() - reqStart;
            const prev = this.metrics.averageProcessingTime || 0;
            this.metrics.averageProcessingTime =
                prev === 0 ? duration : Math.round(prev * 0.8 + duration * 0.2);
            this.metrics.lastRequestTime = duration;

            if (this.isDebug) {
                // Consolidated Plex Debug summary to reduce log noise
                const rtItemsCount = finalItems.filter(item => item.rottenTomatoesData).length;
                const avgScore =
                    rtItemsCount > 0
                        ? Math.round(
                              finalItems
                                  .filter(item => item.rottenTomatoesData)
                                  .reduce((sum, item) => sum + item.rottenTomatoesData.score, 0) /
                                  rtItemsCount
                          )
                        : 0;

                logger.info(
                    `[Plex Debug] Fetch completed: ${finalItems.length} items processed, ${rtItemsCount} with RT data (avg: ${avgScore}%), took ${duration}ms`
                );
            }
            return finalItems;
        } catch (error) {
            this.metrics.errorCount++;
            // Preserve console.error for backward compatibility with existing tests/spies
            // server.js wraps console.error to forward to logger as well
            console.error(
                `[PlexSource:${this.server.name}] Error fetching media: ${error.message}`
            );
            // Also emit via logger for file/memory transports
            try {
                logger.error(
                    `[PlexSource:${this.server.name}] Error fetching media: ${error.message}`
                );
            } catch (_) {
                /* ignore */
            }
            return [];
        }
    }

    /**
     * Applies content filtering based on server configuration.
     * @param {object[]} items - Array of Plex media items to filter.
     * @returns {object[]} Filtered array of media items.
     */
    applyContentFiltering(items) {
        let filteredItems = [...items];

        // Release Years filter (apply early for performance)
        if (this.server.yearFilter) {
            const expr = this.server.yearFilter;
            let allow;
            if (typeof expr === 'number') {
                const minY = expr;
                allow = y => y >= minY;
            } else if (typeof expr === 'string') {
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
                    allow = y => ranges.some(([a, b]) => y >= a && y <= b);
                }
            }
            if (allow) {
                filteredItems = filteredItems.filter(item => {
                    // Plex provides year as item.year (number) or originallyAvailableAt (date string)
                    let year = undefined;
                    if (item.year != null) {
                        const y = Number(item.year);
                        year = Number.isFinite(y) ? y : undefined;
                    }
                    if (year == null && item.originallyAvailableAt) {
                        const d = new Date(item.originallyAvailableAt);
                        if (!Number.isNaN(d.getTime())) year = d.getFullYear();
                    }
                    if (year == null && item.firstAired) {
                        const d = new Date(item.firstAired);
                        if (!Number.isNaN(d.getTime())) year = d.getFullYear();
                    }
                    if (year == null) return false;
                    return allow(year);
                });
                if (this.isDebug)
                    logger.debug(
                        `[PlexSource:${this.server.name}] Year filter (${this.server.yearFilter}): ${filteredItems.length} items.`
                    );
            }
        }

        // Rating filter (support both string and array formats, with comma-delimited values)
        if (this.server.ratingFilter) {
            let hasValidRatingFilter = false;

            if (Array.isArray(this.server.ratingFilter)) {
                hasValidRatingFilter = this.server.ratingFilter.length > 0;
            } else if (typeof this.server.ratingFilter === 'string') {
                hasValidRatingFilter = this.server.ratingFilter.trim() !== '';
            }

            if (hasValidRatingFilter) {
                // Normalize to individual tokens (split by commas), trim and upper-case
                const toTokens = v =>
                    String(v)
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean);
                const allowedRatings = (
                    Array.isArray(this.server.ratingFilter)
                        ? this.server.ratingFilter.flatMap(toTokens)
                        : toTokens(this.server.ratingFilter)
                ).map(r => String(r).toUpperCase());
                const allowedSet = new Set(allowedRatings);

                filteredItems = filteredItems.filter(item => {
                    const itemRating = item.contentRating
                        ? String(item.contentRating).trim().toUpperCase()
                        : null;

                    // If item has a rating and it's not in the list, exclude; if unrated, allow
                    if (itemRating && !allowedSet.has(itemRating)) {
                        if (this.isDebug) {
                            logger.debug(
                                `[PlexSource:${this.server.name}] Filtered out "${item.title}" - contentRating "${item.contentRating}" not in allowed list: ${allowedRatings.join(', ')}`
                            );
                        }
                        return false;
                    }
                    return true;
                });
                if (this.isDebug)
                    logger.debug(
                        `[PlexSource:${this.server.name}] Rating filter (${allowedRatings.join(', ')}): ${filteredItems.length} items.`
                    );
            }
        }

        // Genre filter (comma-separated allowed values)
        if (this.server.genreFilter && this.server.genreFilter.trim() !== '') {
            const genreList = this.server.genreFilter
                .split(',')
                .map(g => g.trim().toLowerCase())
                .filter(Boolean);
            filteredItems = filteredItems.filter(item => {
                if (!item.Genre || !Array.isArray(item.Genre)) return false;
                return item.Genre.some(genre =>
                    genreList.some(filterGenre => genre.tag.toLowerCase().includes(filterGenre))
                );
            });
            if (this.isDebug)
                logger.debug(
                    `[PlexSource:${this.server.name}] Genre filter (${this.server.genreFilter}): ${filteredItems.length} items.`
                );
        }

        // Recently added filter
        if (this.server.recentlyAddedOnly && this.server.recentlyAddedDays) {
            const daysAgo = Date.now() - this.server.recentlyAddedDays * 24 * 60 * 60 * 1000;
            filteredItems = filteredItems.filter(item => {
                if (!item.addedAt) return false;
                const addedDate = new Date(parseInt(item.addedAt) * 1000);
                return addedDate.getTime() >= daysAgo;
            });
            if (this.isDebug)
                logger.debug(
                    `[PlexSource:${this.server.name}] Recently added filter (${this.server.recentlyAddedDays} days): ${filteredItems.length} items.`
                );
        }

        // Quality filter (supports comma-separated list: e.g., "1080p,4K")
        if (this.server.qualityFilter && this.server.qualityFilter.trim() !== '') {
            const rawList = this.server.qualityFilter
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            // Normalize allowed values to canonical labels to match mapping logic
            const normalizeAllowed = v => {
                const r = String(v || '').toLowerCase();
                if (!r || r === 'sd') return 'SD';
                if (r === '720' || r === 'hd' || r === '720p') return '720p';
                if (r === '1080' || r === '1080p' || r === 'fullhd') return '1080p';
                if (r === '4k' || r === '2160' || r === '2160p' || r === 'uhd') return '4K';
                return v;
            };
            const allowed = new Set(rawList.map(normalizeAllowed));
            const known = new Set(['SD', '720p', '1080p', '4K']);
            const hasUnknown = rawList.some(v => !known.has(v));

            const mapResolutionToLabel = res => {
                const r = (res || '').toString().toLowerCase();
                // Treat unknown/empty as SD (legacy behavior expected by tests/UI)
                if (!r || r === 'sd') return 'SD';
                if (r === '720' || r === 'hd' || r === '720p') return '720p';
                if (r === '1080' || r === '1080p' || r === 'fullhd') return '1080p';
                if (r === '4k' || r === '2160' || r === '2160p' || r === 'uhd') return '4K';
                return r;
            };

            filteredItems = filteredItems.filter(item => {
                if (!item.Media || !Array.isArray(item.Media)) return false;
                return item.Media.some(media => {
                    if (hasUnknown) return true; // If unknown quality specified, act as pass-through
                    const label = mapResolutionToLabel(media.videoResolution);
                    // Unknown or empty resolutions are considered SD for filtering purposes
                    return allowed.has(label);
                });
            });
            if (this.isDebug)
                logger.debug(
                    `[PlexSource:${this.server.name}] Quality filter (${this.server.qualityFilter}): ${filteredItems.length} items.`
                );
        }

        return filteredItems;
    }
}

module.exports = PlexSource;
