# Streaming Extras API Documentation

**Version:** 2.8.1+  
**Last Updated:** November 3, 2025  
**Feature:** Trailer and Theme Music Streaming Support

## Overview

Posterrama now supports streaming trailers and theme music without requiring posterpack generation. The `/get-media` endpoint can be enriched with extras metadata on-demand using the `includeExtras` query parameter.

This feature enables screensaver, wallart, and cinema modes to display trailers and play theme music dynamically.

## API Endpoint

### GET /get-media

**Query Parameters:**

| Parameter       | Type    | Required | Description                                               |
| --------------- | ------- | -------- | --------------------------------------------------------- |
| `source`        | string  | No       | Filter by source: `plex`, `jellyfin`, `tmdb`, `local`     |
| `includeExtras` | boolean | No       | When `true`, enriches items with trailers and theme music |
| `nocache`       | string  | No       | Set to `'1'` to bypass cache (admin use)                  |

### Example Requests

```bash
# Regular request (no extras)
GET /get-media?source=plex

# With trailers and theme music
GET /get-media?includeExtras=true&source=plex

# Specific source with extras
GET /get-media?includeExtras=true&source=jellyfin
```

## Response Structure

### MediaItem Fields (with includeExtras=true)

```json
{
    "key": "plex-Plex Server-182202",
    "title": "Seven Samurai",
    "extras": [
        {
            "type": "clip",
            "title": "Seven Samurai",
            "thumb": "/image?server=Plex%20Server&path=%2Flibrary%2Fmetadata%2F182202%2Fthumb%2F1718461487",
            "key": "/library/metadata/182202",
            "duration": 150000,
            "year": null,
            "addedAt": 1718461487000
        }
    ],
    "trailer": {
        "type": "clip",
        "title": "Seven Samurai",
        "key": "/library/metadata/182202",
        "thumb": "/image?server=Plex%20Server&path=%2Flibrary%2Fmetadata%2F182202%2Fthumb%2F1718461487",
        "duration": 150000,
        "year": null,
        "addedAt": 1718461487000
    },
    "theme": "/library/metadata/71073/theme/1760661726",
    "themeUrl": "/proxy/plex?server=Plex%20Server&path=%2Flibrary%2Fmetadata%2F71073%2Ftheme%2F1760661726"
}
```

### Field Descriptions

#### `extras` (array, nullable)

Array of all extras available for the item (trailers, behind the scenes, deleted scenes, etc.).

**Properties:**

- `type` (string): Type of extra - `clip` (trailer), `behindTheScenes`, `deletedScene`, `interview`, etc.
- `title` (string): Title of the extra
- `thumb` (string, nullable): Thumbnail image URL (proxied through `/image` endpoint)
- `key` (string): Server-specific key/ID for the extra
- `duration` (integer, nullable): Duration in milliseconds
- `year` (integer, nullable): Release year
- `addedAt` (integer, nullable): Timestamp when added (milliseconds since epoch)

**Availability:** Plex, Jellyfin  
**Default (without includeExtras):** `null`

#### `trailer` (object, nullable)

First trailer from the `extras` array, provided for convenience.

Same properties as extras items. Most commonly used for quick access to the main trailer.

**Availability:** Plex, Jellyfin  
**Default (without includeExtras):** `null`

#### `theme` (string, nullable)

Raw theme music path from Plex server.

Example: `/library/metadata/71073/theme/1760661726`

**Availability:** Plex only (TV shows typically)  
**Default (without includeExtras):** `null`

#### `themeUrl` (string, nullable)

Proxied theme music URL for streaming.

Example: `/proxy/plex?server=Plex%20Server&path=%2Flibrary%2Fmetadata%2F71073%2Ftheme%2F1760661726`

**Note:** The `/proxy/plex` endpoint is not yet implemented. Use the raw `theme` path for direct Plex API access.

**Availability:** Plex only (TV shows typically)  
**Default (without includeExtras):** `null`

## Implementation Details

### Source Support

| Source       | Trailers           | Theme Music        | Notes                                                     |
| ------------ | ------------------ | ------------------ | --------------------------------------------------------- |
| **Plex**     | ✅ Yes             | ✅ Yes             | Full support via `/library/metadata/{id}/extras` endpoint |
| **Jellyfin** | ✅ Yes             | ❌ No              | Via special features API; no theme music endpoint         |
| **TMDB**     | ❌ No              | ❌ No              | External source, no extras available                      |
| **Local**    | ℹ️ Posterpack only | ℹ️ Posterpack only | Reads from generated posterpacks                          |

### Performance

**Test Results (300 Plex items):**

```json
{
    "totalItems": 300,
    "itemsWithExtras": 297,
    "itemsWithTrailers": 297,
    "itemsWithTheme": 0
}
```

**Timing:**

- First request (cold cache): ~8 seconds
- Subsequent requests: ~100ms (cached)
- Enrichment uses parallel API calls for optimal performance

**Impact:**

- Enrichment adds significant latency to first request
- Results are cached via existing cache middleware
- Recommend using `includeExtras=true` only when needed (e.g., when user enables trailers in admin settings)

### Caching Behavior

The enriched response is cached using the existing API cache middleware:

- Cache key includes all query parameters (including `includeExtras`)
- Separate cache entries for requests with/without extras
- Standard TTL applies (configurable in cache settings)
- Use `nocache=1` to bypass cache during development/testing

## Client Implementation Guide

### Fetching Media with Extras

```javascript
// Example: Fetch media with trailers enabled
async function fetchMediaWithTrailers() {
    const response = await fetch('/get-media?includeExtras=true&source=plex');
    const items = await response.json();

    return items.filter(item => item.trailer !== null);
}
```

### Playing Trailers

**Important:** Trailer playback requires additional steps because the `trailer.key` is a metadata endpoint, not a direct video URL.

#### Step 1: Fetch Trailer Metadata

```javascript
async function getTrailerVideoUrl(item, serverName) {
    // item.trailer.key = "/library/metadata/182202"
    const metadataUrl = `/get-media-by-key/${item.key}`;
    const metadata = await fetch(metadataUrl).then(r => r.json());

    // Navigate to video URL
    const videoKey = metadata.Media?.[0]?.Part?.[0]?.key;
    // Example: "/library/parts/182202/1234567890/file.mp4"

    return videoKey;
}
```

#### Step 2: Construct Streaming URL

For Plex, the video URL needs to be proxied through the Plex server with authentication:

```javascript
function buildPlexStreamUrl(videoKey, serverName) {
    // Note: This requires the Plex server URL and token
    // Client should use the /image proxy pattern or implement /proxy/plex endpoint

    const plexUrl = `https://plex.example.com:32400`;
    const token = 'YOUR_PLEX_TOKEN';

    return `${plexUrl}${videoKey}?X-Plex-Token=${token}`;
}
```

**Recommendation:** Implement a `/stream/trailer` endpoint on the server to handle this complexity and avoid exposing Plex tokens to the client.

### Playing Theme Music

For Plex theme music, use the `themeUrl` field:

```javascript
function playThemeMusic(item) {
    if (!item.themeUrl) return;

    const audio = new Audio();
    // Note: /proxy/plex endpoint not yet implemented
    // For now, use direct Plex API with authentication
    audio.src = item.themeUrl;
    audio.loop = true;
    audio.volume = 0.3;
    audio.play();

    return audio;
}
```

## Frontend Integration

### Screensaver Mode

```javascript
// In screensaver initialization
async function initScreensaver(config) {
    const includeTrailers = config.screensaver?.enableTrailers || false;
    const includeTheme = config.screensaver?.enableThemeMusic || false;

    const url = includeTrailers || includeTheme ? '/get-media?includeExtras=true' : '/get-media';

    const items = await fetch(url).then(r => r.json());

    // Filter items with trailers if enabled
    if (includeTrailers) {
        return items.filter(item => item.trailer !== null);
    }

    return items;
}
```

### Cinema Mode

```javascript
// Show trailer before main feature
async function showTrailer(item) {
    if (!item.trailer) {
        console.log('No trailer available');
        return;
    }

    // Fetch trailer video URL
    const videoUrl = await getTrailerVideoUrl(item.trailer);

    // Play in video element
    const video = document.querySelector('#cinema-video');
    video.src = videoUrl;
    await video.play();
}

// Play theme music in background
function playTheme(item) {
    if (!item.themeUrl) return null;

    const audio = new Audio(item.themeUrl);
    audio.loop = true;
    audio.volume = 0.2;
    audio.play();

    return audio;
}
```

### Wallart Mode

```javascript
// Subtle theme music ambiance
async function initWallart(config) {
    if (!config.wallart?.enableThemeMusic) return;

    const items = await fetch('/get-media?includeExtras=true').then(r => r.json());
    const itemsWithTheme = items.filter(item => item.themeUrl !== null);

    // Randomly play theme music
    if (itemsWithTheme.length > 0) {
        const randomItem = itemsWithTheme[Math.floor(Math.random() * itemsWithTheme.length)];
        playTheme(randomItem);
    }
}
```

## Admin Configuration

### Recommended Settings Structure

Add these settings to `config.json` for per-mode control:

```json
{
    "modes": {
        "screensaver": {
            "enableTrailers": false,
            "enableThemeMusic": false
        },
        "wallart": {
            "enableTrailers": false,
            "enableThemeMusic": false
        },
        "cinema": {
            "enableTrailers": true,
            "enableThemeMusic": true
        }
    }
}
```

### Performance Considerations

- **First Load Impact**: Enabling extras adds ~8s latency for first request (300 items)
- **Cache Strategy**: Results are cached, subsequent loads are fast (~100ms)
- **Bandwidth**: Metadata only - no video/audio files downloaded until played
- **Recommendation**: Enable only for cinema mode by default

## Code Reference

### Modified Files

1. **`middleware/validate.js`**
    - Added `includeExtras` boolean parameter validation

2. **`lib/plex-helpers.js`**
    - Added `enrichPlexItemWithExtras()` function
    - Fetches extras via `/library/metadata/{ratingKey}/extras`
    - Fetches theme from full metadata query

3. **`lib/jellyfin-helpers.js`**
    - Added `enrichJellyfinItemWithExtras()` function
    - Uses Jellyfin special features API

4. **`routes/media.js`**
    - Added `enrichItemsWithExtras()` helper
    - Modified `/get-media` handler to conditionally enrich
    - Parallel processing for performance

5. **`swagger.js`**
    - Updated MediaItem schema with extras fields
    - Added comprehensive field documentation

### Helper Functions

```javascript
// Enrich Plex item with extras
const { enrichPlexItemWithExtras } = require('../lib/plex-helpers');
const enrichedItem = await enrichPlexItemWithExtras(item, serverConfig, plexClient, isDebug);

// Enrich Jellyfin item with extras
const { enrichJellyfinItemWithExtras } = require('../lib/jellyfin-helpers');
const enrichedItem = await enrichJellyfinItemWithExtras(item, serverConfig, jellyfinClient);
```

## Future Improvements

### Planned Enhancements

1. **`/proxy/plex` Endpoint**
    - Implement server-side proxy for Plex media streaming
    - Handle authentication transparently
    - Support for theme music and trailer streaming

2. **`/stream/trailer` Endpoint**
    - Simplified trailer streaming endpoint
    - Takes `key` parameter, returns video stream
    - Handles all Plex/Jellyfin complexity server-side

3. **Selective Enrichment**
    - Only enrich visible items (pagination)
    - Background enrichment for performance
    - Progressive enhancement strategy

4. **Jellyfin Theme Music**
    - Investigate Jellyfin theme music API
    - Implement if available in newer versions

5. **Caching Optimization**
    - Separate cache for enriched vs non-enriched
    - Shorter TTL for enriched data
    - Cache invalidation strategy

## Troubleshooting

### No Trailers Returned

**Symptom:** `extras` and `trailer` fields are `null` even with `includeExtras=true`

**Possible Causes:**

1. Item genuinely has no trailers in Plex/Jellyfin
2. Server connection issues
3. Insufficient permissions (Plex token)

**Solution:**

- Check PM2 logs: `pm2 logs posterrama --lines 100 | grep -i enrich`
- Verify item has extras in Plex/Jellyfin web UI
- Test with known item that has trailers

### Slow Response Times

**Symptom:** Request takes >10 seconds

**Possible Causes:**

1. First request (cold cache)
2. Large playlist (>500 items)
3. Slow Plex/Jellyfin server response

**Solution:**

- Verify it's faster on second request (should be <200ms)
- Consider reducing playlist size
- Check Plex/Jellyfin server performance
- Monitor with: `time curl -s 'http://localhost:4000/get-media?includeExtras=true'`

### Theme Music Not Playing

**Symptom:** `themeUrl` is `null` or audio won't play

**Possible Causes:**

1. Item is a movie (movies don't have theme music)
2. TV show doesn't have theme music in Plex
3. `/proxy/plex` endpoint not implemented

**Solution:**

- Verify item is a TV show
- Check if theme exists in Plex web UI
- For now, use direct Plex API with authentication
- Wait for `/proxy/plex` implementation

## Version History

| Version | Date       | Changes                                            |
| ------- | ---------- | -------------------------------------------------- |
| 2.8.1+  | 2025-11-03 | Initial implementation of streaming extras support |

## Related Documentation

- [Adding a Source](./adding-a-source.md)
- [Development Guide](./DEVELOPMENT.md)
- [API Documentation](http://localhost:4000/api-docs)

## Support

For issues or questions:

1. Check [GitHub Issues](https://github.com/Posterrama/posterrama/issues)
2. Review PM2 logs: `pm2 logs posterrama`
3. Enable debug mode in config.json
4. Check `/health?detailed=true` endpoint
