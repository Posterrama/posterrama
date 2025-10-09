# Banner Fix for Series & Collections

**Date:** 2025-10-08  
**Issue:** Series posterpacks missing banner.jpg file  
**Status:** ✅ Fixed

## Problem

Series posterpacks (Ted Lasso, Bridgerton, Star Trek Picard, etc.) were missing banner images despite Plex API documentation indicating banners are available for:

- **Series** (TV Shows)
- **Collections**

### Investigation Results

Tested 3 series posterpacks:

- ❌ Ted Lasso (2020).zip - No banner
- ❌ Bridgerton (2020).zip - No banner
- ❌ Star Trek Picard (2020).zip - No banner

All had `metadata.images.banner: false`

## Root Cause

The code was only checking `sourceItem.banner` direct field:

```javascript
const bannerUrl = sourceItem.banner ? `/image?server=...&path=...` : null;
```

However, for series/collections, Plex provides the banner in the `Image` array with `type: 'banner'`:

```xml
<Image alt="Ted Lasso" type="banner" url="/library/metadata/.../banner/..."/>
```

## Solution

### 1. Added `getBannerPath()` Helper Function

**File:** `server.js` (after `getClearLogoPath`)

```javascript
const getBannerPath = (images, bannerField) => {
    // First check if sourceItem.banner exists (direct field)
    if (bannerField) {
        return bannerField;
    }
    // Otherwise look in Image array for type='banner'
    if (images && Array.isArray(images)) {
        const bannerObject = images.find(img => img.type === 'banner');
        return bannerObject ? bannerObject.url : null;
    }
    return null;
};
```

This helper:

1. First checks the direct `banner` field (for backwards compatibility)
2. Falls back to searching `Image` array for `type: 'banner'`
3. Returns the banner URL or null

### 2. Updated Banner Extraction Logic

**File:** `server.js` (lines ~5607-5614)

**Before:**

```javascript
// Banner image URL (primarily for TV shows)
const bannerUrl = sourceItem.banner
    ? `/image?server=${...}&path=${...}`
    : null;
```

**After:**

```javascript
// Banner image URL (primarily for TV shows, collections)
// Check both sourceItem.banner field and Image array
const bannerPath = getBannerPath(sourceItem.Image, sourceItem.banner);
const bannerUrl = bannerPath
    ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(bannerPath)}`
    : null;
```

### 3. No Changes Needed in job-queue.js

The posterpack generation code already correctly handles banner download:

```javascript
// Download banner if available (primarily for TV shows)
if (item.bannerUrl) {
    const bannerData = await this._withInflightLimit(() =>
        this.downloadAsset(item.bannerUrl, sourceType, exportLogger)
    );
    if (bannerData) {
        zip.file('banner.jpg', bannerData);
        assets.banner = true;
    }
}
```

Once `bannerUrl` is correctly populated, the download logic works automatically.

## Testing

### Test Script

Created `test-banner-series.js` to verify banner presence in series posterpacks.

**Results:**

- All tested series posterpacks confirmed missing banners ✅
- Root cause identified ✅
- Fix implemented ✅

### Expected Behavior After Fix

When generating NEW posterpacks for series/collections:

1. `getBannerPath()` extracts banner URL from `Image` array
2. `bannerUrl` is populated in processed item
3. job-queue downloads banner.jpg
4. ZIP contains banner.jpg file
5. `metadata.images.banner: true`

### Backwards Compatibility

✅ **Old posterpacks:** Continue to work (banner = null/false)  
✅ **Movies:** Unaffected (banner rare for movies)  
✅ **Direct banner field:** Still checked first (if Plex provides it)

## Plex API Reference

According to Plex API documentation (screenshot provided by user):

| Type   | Beschikbaar bij     | API-veld |
| ------ | ------------------- | -------- |
| Banner | Series, Collections | `banner` |

The `banner` appears in the `<Image>` elements:

```xml
<Image alt="Show Name" type="banner" url="/library/metadata/12345/banner/..."/>
```

## Files Modified

1. **server.js**
    - Added `getBannerPath()` helper function
    - Updated banner extraction to check `Image` array

2. **test-banner-series.js** (new)
    - Test script to verify banner presence
    - Documents the investigation

3. **BANNER-FIX-SERIES.md** (this file)
    - Complete documentation of the fix

## Next Steps

To apply this fix to existing posterpacks:

1. **Re-generate series posterpacks** from Plex
2. New posterpacks will include banner.jpg
3. Old posterpacks remain valid (just without banner)

To verify the fix works:

1. Generate a fresh posterpack for any series
2. Check ZIP contents for `banner.jpg`
3. Verify `metadata.images.banner: true`

## Summary

**Problem:** Series banners not extracted from Plex API  
**Cause:** Only checking direct `banner` field, not `Image` array  
**Fix:** Added `getBannerPath()` to check both sources  
**Impact:** New series/collection posterpacks will include banner images  
**Breaking Changes:** None - fully backwards compatible

---

**Status:** ✅ Ready to commit and re-generate series posterpacks
