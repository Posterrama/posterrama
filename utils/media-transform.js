/**
 * Media Item Transformation Utilities
 * Provides lightweight transforms for different use cases
 * @module utils/media-transform
 */

/**
 * Essential fields needed for wallart/screensaver display
 * Reduces payload from ~160KB to ~1-2KB per item (100x reduction)
 */
const WALLART_ESSENTIAL_FIELDS = [
    // Identity
    'key',
    'title',
    'year',
    'type',
    'server',

    // Visual
    'posterUrl',
    'backgroundUrl',
    'clearLogoUrl',
    'thumbnailUrl',

    // Metadata
    'tagline',
    'overview',
    'rating',
    'contentRating',
    'quality',
    'qualityLabel',
    'library',

    // Media info
    'genres',
    'genre_ids',
    'runtimeMs',

    // Ratings (simplified)
    'rottenTomatoes', // Keep simplified object
    'ratingImage',
    'audienceRatingImage',
    'audienceRating',

    // Extras (minimal)
    'imdbUrl',
    'slug',
];

/**
 * Transforms full media item to lightweight wallart-compatible object
 * Strips heavy fields: cast, crew, audio/video streams, file details, etc.
 *
 * @param {object} item - Full media item from source
 * @returns {object} Lightweight item with only essential fields
 *
 * @example
 * const fullItem = await plexSource.fetchMedia(); // 160 KB
 * const lightItem = transformForWallart(fullItem); // 1-2 KB
 */
function transformForWallart(item) {
    if (!item) return null;

    const transformed = {};

    // Copy essential fields
    for (const field of WALLART_ESSENTIAL_FIELDS) {
        if (item[field] !== undefined) {
            transformed[field] = item[field];
        }
    }

    // Add hasHDR flag (useful for quality badges)
    if (item.hasHDR !== undefined) {
        transformed.hasHDR = item.hasHDR;
    }

    // Add hasDolbyVision flag
    if (item.hasDolbyVision !== undefined) {
        transformed.hasDolbyVision = item.hasDolbyVision;
    }

    // Include simplified mediaStreams (just resolution/codec, no full details)
    if (item.mediaStreams && item.mediaStreams.length > 0) {
        transformed.mediaStreams = item.mediaStreams.map(stream => ({
            videoResolution: stream.videoResolution,
            videoCodec: stream.videoCodec,
            audioCodec: stream.audioCodec,
            audioChannels: stream.audioChannels,
        }));
    }

    // Include directors/writers as simple arrays (no full details)
    if (item.directors) {
        transformed.directors = Array.isArray(item.directors) ? item.directors : [item.directors];
    }

    if (item.writers) {
        transformed.writers = Array.isArray(item.writers) ? item.writers : [item.writers];
    }

    // Include simplified cast (max 5, names only)
    if (item.cast && Array.isArray(item.cast)) {
        transformed.cast = item.cast.slice(0, 5).map(actor => actor.name || actor);
    }

    return transformed;
}

/**
 * Transforms array of items for wallart
 * @param {array} items - Array of full media items
 * @returns {array} Array of lightweight items
 */
function transformArrayForWallart(items) {
    if (!Array.isArray(items)) return [];
    return items.map(transformForWallart).filter(Boolean);
}

/**
 * Stream transformer - transforms items as they arrive
 * @param {AsyncGenerator} generator - Source generator yielding full items
 * @returns {AsyncGenerator} Generator yielding lightweight items
 */
async function* streamTransformForWallart(generator) {
    for await (const item of generator) {
        const transformed = transformForWallart(item);
        if (transformed) {
            yield transformed;
        }
    }
}

/**
 * Calculate size reduction achieved by transformation
 * Useful for debugging/testing
 * @param {object} fullItem - Original item
 * @param {object} lightItem - Transformed item
 * @returns {object} Size statistics
 */
function calculateSizeReduction(fullItem, lightItem) {
    const fullSize = JSON.stringify(fullItem).length;
    const lightSize = JSON.stringify(lightItem).length;
    const reduction = fullSize - lightSize;
    const reductionPercent = ((reduction / fullSize) * 100).toFixed(1);

    return {
        fullSize,
        lightSize,
        reduction,
        reductionPercent: `${reductionPercent}%`,
        compressionRatio: `${(fullSize / lightSize).toFixed(1)}x`,
    };
}

module.exports = {
    transformForWallart,
    transformArrayForWallart,
    streamTransformForWallart,
    calculateSizeReduction,
    WALLART_ESSENTIAL_FIELDS,
};
