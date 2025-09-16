/**
 * Example media source adapter for Posterrama
 * Use this file as a starting point for integrating a new source.
 *
 * Contract:
 * - constructor(serverConfig, getClient, processItem, getLibraries, shuffleArray, rtMinScore, isDebug)
 * - async fetchMedia(libraryNames, type, count)
 * - getMetrics(), resetMetrics()
 * - Optional: getAvailableRatings()
 */
const logger = require('../utils/logger');

class ExampleSource {
    constructor(
        serverConfig,
        getClient, // function(serverConfig) -> client for the remote API
        processItem, // function(raw, ctx) -> normalized media item used by UI
        getLibraries, // async function(serverConfig) -> Map<name, {id, ...}>
        shuffleArray, // function(arr)
        rtMinScore = null, // e.g., RottenTomatoes min score if applicable
        isDebug = false
    ) {
        this.server = serverConfig;
        this.getClient = getClient;
        this.processItem = processItem;
        this.getLibraries = getLibraries;
        this.shuffleArray = shuffleArray;
        this.rtMinScore = rtMinScore;
        this.isDebug = isDebug;

        this.metrics = {
            requestCount: 0,
            itemsProcessed: 0,
            itemsFiltered: 0,
            averageProcessingTime: 0,
            lastRequestTime: null,
            errorCount: 0,
        };
    }

    getMetrics() {
        const filterEfficiency =
            this.metrics.itemsProcessed > 0
                ? this.metrics.itemsFiltered / this.metrics.itemsProcessed
                : 0;

        return {
            totalItems: this.cachedMedia ? this.cachedMedia.length : 0,
            lastFetch: this.lastFetch,
            cacheDuration: 60 * 60 * 1000,
            ...this.metrics,
            filterEfficiency,
        };
    }

    getAvailableRatings() {
        if (!this.cachedMedia) return [];
        const ratings = new Set();
        for (const item of this.cachedMedia) {
            const r = item.rating || item.contentRating || '';
            if (r && r.trim()) ratings.add(r.trim());
        }
        return Array.from(ratings).sort();
    }

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
     * Core: fetch media from remote source, filter, normalize, and shuffle.
     * @param {string[]} libraryNames
     * @param {('movie'|'show')} type
     * @param {number} count
     */
    async fetchMedia(libraryNames, type, count) {
        if (!Array.isArray(libraryNames) || libraryNames.length === 0 || !count) return [];

        const reqStart = Date.now();
        this.metrics.requestCount++;
        this.metrics.lastRequestTime = new Date();

        try {
            const client = await this.getClient(this.server);
            const libraries = await this.getLibraries(this.server); // Map(name -> {id})

            let rawItems = [];
            for (const name of libraryNames) {
                const lib = libraries.get(name);
                if (!lib) {
                    logger.warn(`[ExampleSource:${this.server.name}] Library "${name}" not found.`);
                    continue;
                }

                // Copy‑paste ready sketch: implement client.getItems or equivalent.
                // Expectation: client.getItems({ parentId, includeItemTypes, recursive, fields, limit, startIndex })
                const pageSize = 1000;
                let startIndex = 0;
                let fetched = 0;
                do {
                    // Replace with your SDK/API call; the signature below mirrors Jellyfin style
                    const page = await (client.getItems
                        ? client.getItems({
                              parentId: lib.id,
                              includeItemTypes: type === 'movie' ? ['Movie'] : ['Series'],
                              recursive: true,
                              fields: [
                                  'Genres',
                                  'Overview',
                                  'CommunityRating',
                                  'OfficialRating',
                                  'ProductionYear',
                                  'RunTimeTicks',
                                  'Taglines',
                                  'OriginalTitle',
                                  'ImageTags',
                                  'BackdropImageTags',
                                  'MediaStreams',
                                  'MediaSources',
                              ],
                              limit: pageSize,
                              startIndex,
                          })
                        : { Items: [] });
                    const items = (page && page.Items) || [];
                    rawItems = rawItems.concat(items);
                    fetched = items.length;
                    startIndex += pageSize;
                } while (fetched === pageSize);
            }

            // Normalize and filter
            const processed = [];
            for (const raw of rawItems) {
                try {
                    const item = await this.processItem(raw, {
                        type,
                        server: this.server,
                        rtMinScore: this.rtMinScore,
                    });
                    if (!item) continue;
                    this.metrics.itemsProcessed++;
                    processed.push(item);
                } catch (e) {
                    this.metrics.errorCount++;
                    if (this.isDebug)
                        logger.debug('[ExampleSource] processItem failed:', e.message);
                }
            }

            // Example filter: honor min score if your processItem sets item.rtScore
            let filtered = processed;
            if (this.rtMinScore != null) {
                filtered = processed.filter(
                    i => typeof i.rtScore !== 'number' || i.rtScore >= this.rtMinScore
                );
                this.metrics.itemsFiltered += processed.length - filtered.length;
            }

            // Shuffle and cap
            this.shuffleArray(filtered);
            const result = filtered.slice(0, count);

            this.cachedMedia = result;
            this.lastFetch = new Date();
            const dt = Date.now() - reqStart;
            // EMA for averageProcessingTime
            const alpha = 0.3;
            this.metrics.averageProcessingTime =
                this.metrics.averageProcessingTime === 0
                    ? dt
                    : Math.round(alpha * dt + (1 - alpha) * this.metrics.averageProcessingTime);

            return result;
        } catch (err) {
            this.metrics.errorCount++;
            logger.error(`[ExampleSource:${this.server.name}] fetch failed:`, err.message);
            return [];
        }
    }
}

module.exports = ExampleSource;
