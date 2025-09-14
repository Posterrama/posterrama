/**
 * Jellyfin media source for posterrama.app
 * Handles fetching and processing media from a Jellyfin server.
 */
const logger = require('../utils/logger');

class JellyfinSource {
    constructor(
        serverConfig,
        getJellyfinClient,
        processJellyfinItem,
        getJellyfinLibraries,
        shuffleArray,
        rtMinScore,
        isDebug
    ) {
        this.server = serverConfig;
        this.getJellyfinClient = getJellyfinClient;
        this.processJellyfinItem = processJellyfinItem;
        this.getJellyfinLibraries = getJellyfinLibraries;
        this.shuffleArray = shuffleArray;
        this.rtMinScore = rtMinScore;
        this.isDebug = isDebug;

        // Debug: log rating filters configuration
        if (this.isDebug) {
            logger.info(
                `[JellyfinSource:${this.server.name}] Initialized with rating configuration:`,
                {
                    ratingFilter: this.server.ratingFilter || 'none',
                    legacyRatingFilters: this.server.ratingFilters || 'none',
                    rtMinScore: this.rtMinScore,
                }
            );
        }

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
            cacheDuration: 3600000, // Default cache duration in milliseconds (1 hour)
            requestCount: this.metrics.requestCount,
            itemsProcessed: this.metrics.itemsProcessed,
            itemsFiltered: this.metrics.itemsFiltered,
            averageProcessingTime: this.metrics.averageProcessingTime,
            lastRequestTime: this.metrics.lastRequestTime,
            errorCount: this.metrics.errorCount,
            filterEfficiency,
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

        if (this.isDebug) {
            logger.info(`Fetching media from Jellyfin`, {
                server: this.server.name,
                type,
                libraryNames,
                count,
            });
        }

        const startTime = process.hrtime();
        this.metrics.requestCount++;
        this.metrics.lastRequestTime = new Date();

        try {
            const client = await this.getJellyfinClient(this.server);
            const allLibraries = await this.getJellyfinLibraries(this.server);

            // Fetch ALL items for selected libraries (paginated), then filter across the full set
            let allItems = [];
            for (const name of libraryNames) {
                const library = allLibraries.get(name);
                if (!library) {
                    logger.warn(
                        `[JellyfinSource:${this.server.name}] Library "${name}" not found.`
                    );
                    continue;
                }

                try {
                    const pageSize = 1000;
                    let startIndex = 0;
                    let fetched = 0;
                    do {
                        const page = await client.getItems({
                            parentId: library.id,
                            includeItemTypes: type === 'movie' ? ['Movie'] : ['Series'],
                            recursive: true,
                            fields: [
                                'Genres',
                                'Overview',
                                'CommunityRating',
                                'OfficialRating',
                                'UserData',
                                'ProductionYear',
                                'RunTimeTicks',
                                'Taglines',
                                'OriginalTitle',
                                'ImageTags',
                                'BackdropImageTags',
                                // Include media info so quality filtering can work
                                'MediaStreams',
                                'MediaSources',
                            ],
                            sortBy: [], // deterministic fetch; we will shuffle after filtering
                            limit: pageSize,
                            startIndex,
                        });
                        const items = (page && page.Items) || [];
                        allItems = allItems.concat(items);
                        fetched = items.length;
                        startIndex += pageSize;
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Library "${name}" page @${startIndex - pageSize} -> +${items.length}`
                            );
                        }
                    } while (fetched === pageSize);
                } catch (libraryError) {
                    logger.error(
                        `[JellyfinSource:${this.server.name}] Failed to fetch from library "${name}":`,
                        {
                            error: libraryError.message,
                            type,
                            libraryId: library.id,
                        }
                    );
                    // Continue with other libraries
                }
            }

            if (this.isDebug) {
                logger.debug(
                    `[JellyfinSource:${this.server.name}] Found ${allItems.length} total items in specified libraries.`
                );
                if (allItems.length === 0) {
                    logger.debug(
                        `[JellyfinSource:${this.server.name}] No items returned. Check that library names exist and contain ${
                            type === 'movie' ? 'Movie' : 'Series'
                        } items. Names: ${libraryNames.join(', ')}`
                    );
                }
            }

            // First stage: Year and Genre filters (apply early for performance)
            let filteredItems = allItems.filter(item => {
                // Release Years filter
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
                        let year = undefined;
                        if (item.ProductionYear != null) {
                            const y = Number(item.ProductionYear);
                            year = Number.isFinite(y) ? y : undefined;
                        }
                        if (year == null && item.PremiereDate) {
                            const d = new Date(item.PremiereDate);
                            if (!Number.isNaN(d.getTime())) year = d.getFullYear();
                        }
                        if (year == null && item.DateCreated) {
                            const d = new Date(item.DateCreated);
                            if (!Number.isNaN(d.getTime())) year = d.getFullYear();
                        }
                        if (year == null || !allow(year)) return false;
                    }
                }

                // Genre filter if configured
                if (this.server.genreFilter && this.server.genreFilter.trim() !== '') {
                    const genreList = this.server.genreFilter
                        .split(',')
                        .map(g => g.trim().toLowerCase());

                    if (!item.Genres || !Array.isArray(item.Genres) || item.Genres.length === 0) {
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - No genres available when genre filter "${this.server.genreFilter}" is set`
                            );
                        }
                        return false;
                    }

                    const hasMatchingGenre = item.Genres.some(genre =>
                        genreList.some(filterGenre => genre.toLowerCase().includes(filterGenre))
                    );

                    if (!hasMatchingGenre) {
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - Genres [${item.Genres.join(', ')}] don't match filter "${this.server.genreFilter}"`
                            );
                        }
                        return false;
                    }
                }

                return true;
            });

            // Next stage: rating/quality/RT filters
            filteredItems = filteredItems.filter(item => {
                // Apply Rotten Tomatoes minimum score filter using CommunityRating
                if (this.rtMinScore > 0 && item.CommunityRating) {
                    // CommunityRating is typically 0-10, convert RT percentage to 0-10 scale for comparison
                    const rtScoreAsRating = this.rtMinScore / 10; // Convert percentage to 0-10 scale
                    if (item.CommunityRating < rtScoreAsRating) {
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - CommunityRating ${item.CommunityRating} below threshold ${rtScoreAsRating}`
                            );
                        }
                        return false;
                    }
                }

                // genre already applied above

                // Apply quality filter if configured
                if (this.server.qualityFilter && this.server.qualityFilter.trim() !== '') {
                    // Jellyfin Series items rarely contain stream info; skip quality filter for shows
                    if (type === 'show') {
                        return true;
                    }
                    const qualityList = this.server.qualityFilter.split(',').map(q => q.trim());

                    // Get quality information from media sources
                    let itemQuality = null;
                    if (item.MediaSources && Array.isArray(item.MediaSources)) {
                        for (const source of item.MediaSources) {
                            if (source.MediaStreams && Array.isArray(source.MediaStreams)) {
                                const videoStream = source.MediaStreams.find(
                                    stream => stream.Type === 'Video'
                                );
                                if (videoStream && videoStream.Height) {
                                    const height = videoStream.Height;

                                    // Map video height to standardized quality labels
                                    if (height <= 576) {
                                        itemQuality = 'SD';
                                    } else if (height <= 720) {
                                        itemQuality = '720p';
                                    } else if (height <= 1080) {
                                        itemQuality = '1080p';
                                    } else if (height >= 2160) {
                                        itemQuality = '4K';
                                    } else {
                                        itemQuality = `${height}p`;
                                    }
                                    break; // Use first video stream found
                                }
                            }
                        }
                    }

                    if (!itemQuality || !qualityList.includes(itemQuality)) {
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - Quality "${itemQuality || 'unknown'}" not in filter list: ${qualityList.join(', ')}`
                            );
                        }
                        return false;
                    }
                }

                // Apply server-specific rating filters if configured
                // Support both new simple ratingFilter (string) and legacy ratingFilters (object)
                const ratingFilter = this.server.ratingFilter;
                const legacyFilters = this.server.ratingFilters;

                // Handle simple string rating filter (new approach)
                if (ratingFilter) {
                    // Convert to normalized array for consistent handling
                    const allowedRatings = (
                        Array.isArray(ratingFilter) ? ratingFilter : [ratingFilter]
                    )
                        .filter(Boolean)
                        .map(r => String(r).trim().toUpperCase());

                    const itemRating = item.OfficialRating
                        ? String(item.OfficialRating).trim().toUpperCase()
                        : null;

                    // If filter is present but empty after normalization, skip filtering
                    if (allowedRatings.length > 0) {
                        // If item has no rating, allow it unless the filter explicitly excludes unrated content
                        if (itemRating && !allowedRatings.includes(itemRating)) {
                            if (this.isDebug) {
                                logger.debug(
                                    `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - OfficialRating "${item.OfficialRating}" not in allowed list: ${allowedRatings.join(', ')}`
                                );
                            }
                            return false;
                        }
                    }
                }

                // Handle legacy rating filters object (backward compatibility)
                if (legacyFilters) {
                    const filters = legacyFilters;

                    if (this.isDebug) {
                        logger.debug(
                            `[JellyfinSource:${this.server.name}] Applying legacy rating filters for "${item.Name}": ${JSON.stringify(filters)}`
                        );
                    }

                    // Community rating filter (0-10 scale)
                    if (filters.minCommunityRating && item.CommunityRating) {
                        if (item.CommunityRating < filters.minCommunityRating) {
                            if (this.isDebug) {
                                logger.debug(
                                    `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - CommunityRating ${item.CommunityRating} below ${filters.minCommunityRating}`
                                );
                            }
                            return false;
                        }
                    }

                    // Official rating filter (MPAA ratings)
                    if (filters.allowedOfficialRatings && item.OfficialRating) {
                        if (!filters.allowedOfficialRatings.includes(item.OfficialRating)) {
                            if (this.isDebug) {
                                logger.debug(
                                    `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - OfficialRating "${item.OfficialRating}" not in allowed list: ${filters.allowedOfficialRatings.join(', ')}`
                                );
                            }
                            return false;
                        }
                    }

                    // User rating filter (personal rating)
                    if (filters.minUserRating && item.UserData?.Rating) {
                        if (item.UserData.Rating < filters.minUserRating) {
                            if (this.isDebug) {
                                logger.debug(
                                    `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - UserRating ${item.UserData.Rating} below ${filters.minUserRating}`
                                );
                            }
                            return false;
                        }
                    }
                } else if (this.isDebug) {
                    logger.debug(
                        `[JellyfinSource:${this.server.name}] No rating filters configured for server`
                    );
                }

                return true;
            });

            // Log genre filter results if applied
            if (this.server.genreFilter && this.server.genreFilter.trim() !== '') {
                if (this.isDebug) {
                    logger.debug(
                        `[JellyfinSource:${this.server.name}] Genre filter (${this.server.genreFilter}): ${filteredItems.length} items.`
                    );
                }
            }

            // Log quality filter results if applied
            if (this.server.qualityFilter && this.server.qualityFilter.trim() !== '') {
                if (this.isDebug) {
                    logger.debug(
                        `[JellyfinSource:${this.server.name}] Quality filter (${this.server.qualityFilter}): ${filteredItems.length} items.`
                    );
                }
            }

            // Recently added filter
            if (this.server.recentlyAddedOnly && this.server.recentlyAddedDays) {
                const daysAgo = Date.now() - this.server.recentlyAddedDays * 24 * 60 * 60 * 1000;
                filteredItems = filteredItems.filter(item => {
                    if (!item.DateCreated) return false;
                    const addedDate = new Date(item.DateCreated);
                    return addedDate.getTime() >= daysAgo;
                });
                if (this.isDebug) {
                    logger.debug(
                        `[JellyfinSource:${this.server.name}] Recently added filter (${this.server.recentlyAddedDays} days): ${filteredItems.length} items.`
                    );
                }
            }

            // Year filter already applied above

            if (this.isDebug) {
                console.log(
                    `[JellyfinSource:${this.server.name}] After filtering: ${filteredItems.length} items remaining.`
                );
            }

            // If we ended up with zero after filters, emit a helpful debug line
            if (this.isDebug && filteredItems.length === 0) {
                logger.debug(
                    `[JellyfinSource:${this.server.name}] All items filtered out. Check ratingFilter (current: ${JSON.stringify(
                        this.server.ratingFilter || this.server.ratingFilters || 'none'
                    )}) and qualityFilter (current: ${JSON.stringify(
                        this.server.qualityFilter || 'none'
                    )}).`
                );
            }

            // Shuffle and limit to requested count (apply cap AFTER filtering)
            const selectedItems = this.shuffleArray([...filteredItems]).slice(0, count);

            // Process items
            const processedItems = await Promise.all(
                selectedItems.map(item => this.processJellyfinItem(item, this.server, client))
            );

            // Filter out null results
            const validItems = processedItems.filter(item => item !== null);

            // Update metrics
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const processingTime = seconds * 1000 + nanoseconds / 1000000; // Convert to milliseconds
            this.metrics.averageProcessingTime =
                (this.metrics.averageProcessingTime + processingTime) / 2;
            this.metrics.itemsProcessed += allItems.length;
            this.metrics.itemsFiltered += validItems.length;

            // Mark successful fetch time for admin UI
            this.lastFetch = Date.now();

            if (this.isDebug) {
                logger.info(`[JellyfinSource:${this.server.name}] Processing completed`, {
                    requestTime: `${processingTime.toFixed(2)}ms`,
                    itemsFound: allItems.length,
                    itemsProcessed: validItems.length,
                    metrics: this.getMetrics(),
                });
            }

            return validItems;
        } catch (error) {
            this.metrics.errorCount++;
            logger.error(`[JellyfinSource:${this.server.name}] Error fetching media:`, {
                error: error.message,
                libraryNames,
                type,
                count,
            });
            throw error;
        }
    }

    /**
     * Get server information for diagnostics
     * @returns {Promise<object>} Server information
     */
    async getServerInfo() {
        try {
            const client = await this.getJellyfinClient(this.server);
            const info = await client.testConnection();

            return {
                name: this.server.name,
                type: 'jellyfin',
                version: info.version || 'Unknown',
                serverName: info.serverName || 'Unknown',
                id: info.id || 'Unknown',
                metrics: this.getMetrics(),
            };
        } catch (error) {
            logger.error(
                `[JellyfinSource:${this.server.name}] Error getting server info:`,
                error.message
            );
            throw error;
        }
    }
}

module.exports = JellyfinSource;
