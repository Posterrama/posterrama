# Plex /tree Endpoint Test Script

## Purpose

Verifies that the Plex `/library/metadata/{ratingKey}/tree` endpoint returns complete `Media.Part.Stream` arrays with full technical metadata (video/audio/subtitle details).

## Why /tree endpoint?

The standard Plex metadata endpoint (`/library/metadata/{key}`) often returns **empty or incomplete** `Stream` arrays. The `/tree` endpoint is the **ONLY reliable way** to get complete technical stream details from Plex API.

## Usage

### Auto-detect first movie:

```bash
PLEX_TOKEN=your_token node scripts/test-plex-tree.js
```

### Test specific ratingKey:

```bash
PLEX_TOKEN=your_token node scripts/test-plex-tree.js 12345
```

### Custom Plex URL:

```bash
PLEX_URL=http://192.168.1.100:32400 PLEX_TOKEN=your_token node scripts/test-plex-tree.js
```

## Expected Output

```
🔍 Testing Plex /tree endpoint for ratingKey: 12345

📡 Fetching standard metadata: http://ip:32400/library/metadata/12345?X-Plex-Token=xxx
✅ Standard metadata: Movie Title (movie)
   Media count: 1
   ⚠️  No Stream data in standard endpoint

📡 Fetching tree metadata: http://ip:32400/library/metadata/12345/tree?X-Plex-Token=xxx
✅ Tree metadata: Movie Title (movie)
   Media count: 1
   Stream count (tree): 15

📊 Stream breakdown:
   Video streams: 1
      Example: h264 1920x1080 8500kbps
      Properties: streamType, codec, width, height, bitrate, ...

   Audio streams: 3
      Example: ac3 6ch 5.1 384kbps
      Properties: streamType, codec, channels, audioChannelLayout, bitrate, ...

   Subtitle streams: 11
      Example: srt (eng) FORCED
      Properties: streamType, codec, language, forced, default, ...

✅ SUCCESS: /tree endpoint returns complete stream metadata!
```

## What This Proves

1. **Standard endpoint** returns basic metadata but often **missing Stream arrays**
2. **Tree endpoint** returns **complete hierarchical data** with all Stream details
3. **Our implementation** (`server.js:5530-5550`) correctly uses both:
    - Primary query for basic metadata
    - Secondary /tree query for complete Media.Part.Stream arrays
    - Fallback to standard if /tree fails

## Integration

This test verifies the implementation in `server.js` function `processPlexItem()`:

```javascript
// Fetch comprehensive metadata with full Media.Part.Stream arrays using /tree endpoint
let treeData = null;
if (item.ratingKey) {
    try {
        const treeResponse = await plex.query(`/library/metadata/${item.ratingKey}/tree`);
        treeData = treeResponse?.MediaContainer?.Metadata?.[0];
    } catch (err) {
        logger.debug(
            `[Plex] Failed to fetch /tree data for ratingKey ${item.ratingKey}: ${err.message}`
        );
    }
}

// Use tree data for Media arrays if available (has complete Stream details)
const enrichedItem = treeData && treeData.Media ? { ...item, Media: treeData.Media } : item;
```

## Result

With `/tree` endpoint implementation:

- ✅ **367 lines of comprehensive metadata extraction** now has access to complete data
- ✅ `videoStreams[]` populated with 20+ properties per stream
- ✅ `audioTracks[]` populated with 15+ properties per track
- ✅ `subtitles[]` populated with 12+ properties per subtitle
- ✅ HDR/Dolby Vision detection works correctly
- ✅ All technical stream details available for posterpack generation
- ✅ Backward compatible (falls back if /tree unavailable)

## Troubleshooting

### "No metadata found"

- Check ratingKey is valid: `curl "http://ip:32400/library/metadata/12345?X-Plex-Token=xxx"`
- Verify Plex server is accessible
- Confirm token has read permissions

### "No Stream data in tree endpoint"

- Rare case, may indicate Plex version too old
- Check Plex server version: `curl "http://ip:32400/?X-Plex-Token=xxx" | grep version`
- Try different ratingKey (some content may have no streams)

### Connection errors

- Verify PLEX_URL format: `http://ip:32400` (no trailing slash)
- Check firewall allows access to Plex port
- Test with browser: `http://ip:32400/web`
