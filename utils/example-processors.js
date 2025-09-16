/**
 * Example item processors for a new source adapter.
 * Aim to normalize to the fields the UI expects.
 */

function processExampleItem(raw, { type, server, rtMinScore }) {
    // Map raw item fields into a normalized shape similar to Plex/Jellyfin processors
    // Required-ish fields used by UI and image pipeline
    const id = raw.id || raw.guid || raw.Key || String(Math.random());
    const title = raw.title || raw.Name || 'Untitled';
    const year = raw.year || raw.ProductionYear || null;
    const rating = raw.OfficialRating || raw.contentRating || raw.rating || null;
    const rtScore = typeof raw.rtScore === 'number' ? raw.rtScore : null;
    // Build a poster path/URL; server adapters often resolve to proxied image URLs
    const poster = raw.poster || raw.Poster || raw.ImageUrl || null;

    // Simple filter example based on RottenTomatoes minimum score
    if (rtMinScore != null && typeof rtScore === 'number' && rtScore < rtMinScore) {
        return null;
    }

    return {
        id,
        type, // 'movie' | 'show'
        title,
        year,
        rating,
        rtScore,
        poster,
        // Extend this shape when your UI needs more (genres, runtime, overview, etc.)
        _source: server?.name || 'example',
    };
}

module.exports = { processExampleItem };
