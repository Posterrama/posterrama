/**
 * Plex media source for posterrama.app
 * Handles fetching and processing media from a Plex server.
 */
class PlexSource {
    constructor(serverConfig, getPlexClient, processPlexItem, getPlexLibraries, shuffleArray, rtMinScore, isDebug) {
        this.server = serverConfig;
        this.getPlexClient = getPlexClient;
        this.processPlexItem = processPlexItem;
        this.getPlexLibraries = getPlexLibraries;
        this.shuffleArray = shuffleArray;
        this.rtMinScore = rtMinScore;
        this.isDebug = isDebug;
        this.plex = this.getPlexClient(this.server);
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
            console.log(`[PlexSource:${this.server.name}] Fetching ${count} ${type}(s) from libraries: ${libraryNames.join(', ')}`);
        }

        try {
            const allLibraries = await this.getPlexLibraries(this.server);
            let allItems = [];

            for (const name of libraryNames) {
                const library = allLibraries.get(name);
                if (!library) {
                    console.warn(`[PlexSource:${this.server.name}] Library "${name}" not found.`);
                    continue;
                }

                const content = await this.plex.query(`/library/sections/${library.key}/all`);
                if (content?.MediaContainer?.Metadata) {
                    allItems = allItems.concat(content.MediaContainer.Metadata);
                }
            }

            if (this.isDebug) console.log(`[PlexSource:${this.server.name}] Found ${allItems.length} total items in specified libraries.`);

            const shuffledItems = this.shuffleArray(allItems);
            const selectedItems = count > 0 ? shuffledItems.slice(0, count) : shuffledItems;

            const processedItems = await Promise.all(
                selectedItems.map(item => this.processPlexItem(item, this.server, this.plex))
            );

            const finalItems = processedItems.filter(item => {
                if (!item) return false;
                if (this.rtMinScore > 0 && item.rottenTomatoes) {
                    return item.rottenTomatoes.originalScore * 10 >= this.rtMinScore;
                }
                return true;
            });

            if (this.isDebug) console.log(`[PlexSource:${this.server.name}] Returning ${finalItems.length} processed items.`);
            return finalItems;
        } catch (error) {
            console.error(`[PlexSource:${this.server.name}] Error fetching media: ${error.message}`);
            return [];
        }
    }
}

module.exports = PlexSource;