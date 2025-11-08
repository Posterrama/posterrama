# Plex Music API Specification

**Part of:** Plex Music Implementation Plan  
**Phase:** 2 - Plex Music API Integration

---

## Overview

This document specifies the Plex API integration for music, including endpoints, metadata mapping, and implementation details for `sources/plex.js`.

---

## Plex Music API Endpoints

### 1. Get Music Libraries

**Endpoint:** `/library/sections`  
**Filter:** `type=artist`

**Response:**

```xml
<MediaContainer>
  <Directory key="8" type="artist" title="Music" />
  <Directory key="9" type="artist" title="Classical" />
</MediaContainer>
```

### 2. Get Albums from Library

**Endpoint:** `/library/sections/{id}/albums`  
**Parameters:**

- `X-Plex-Container-Start`: Pagination start
- `X-Plex-Container-Size`: Items per page (max 500)
- `sort`: `addedAt:desc`, `titleSort:asc`, `rating:desc`, `lastViewedAt:desc`

**Response:**

```xml
<MediaContainer size="150">
  <Directory
    ratingKey="12345"
    key="/library/metadata/12345/children"
    parentRatingKey="12346"
    guid="plex://album/..."
    type="album"
    title="Dark Side of the Moon"
    parentTitle="Pink Floyd"
    year="1973"
    thumb="/library/metadata/12345/thumb/1234567890"
    art="/library/metadata/12345/art/1234567890"
    parentThumb="/library/metadata/12346/thumb/1234567890"
    userRating="9.5"
    rating="8.7"
    viewCount="42"
    lastViewedAt="1699123456"
    addedAt="1699000000"
    updatedAt="1699100000">
    <Genre tag="Progressive Rock" />
    <Genre tag="Psychedelic Rock" />
  </Directory>
</MediaContainer>
```

### 3. Get Album Details

**Endpoint:** `/library/metadata/{ratingKey}`

**Response:**

```xml
<MediaContainer>
  <Directory
    ratingKey="12345"
    title="Dark Side of the Moon"
    parentTitle="Pink Floyd"
    year="1973"
    originallyAvailableAt="1973-03-01"
    studio="Harvest Records"
    summary="The eighth studio album..."
    thumb="/library/metadata/12345/thumb/1234567890"
    art="/library/metadata/12345/art/1234567890"
    parentThumb="/library/metadata/12346/thumb/1234567890"
    loudnessAnalysis="true">
    <Genre tag="Progressive Rock" />
    <Genre tag="Psychedelic Rock" />
    <Style tag="Concept Album" />
    <Mood tag="Dark" />
    <Mood tag="Atmospheric" />
    <Collection tag="Classic Albums" />
  </Directory>
</MediaContainer>
```

### 4. Get Artist Details

**Endpoint:** `/library/metadata/{parentRatingKey}`

**Response:**

```xml
<MediaContainer>
  <Directory
    ratingKey="12346"
    type="artist"
    title="Pink Floyd"
    summary="English rock band formed in London in 1965..."
    country="United Kingdom"
    thumb="/library/metadata/12346/thumb/1234567890"
    art="/library/metadata/12346/art/1234567890">
    <Genre tag="Progressive Rock" />
    <Genre tag="Psychedelic Rock" />
    <Style tag="Art Rock" />
  </Directory>
</MediaContainer>
```

---

## Implementation: sources/plex.js

### New Method: fetchMusic()

**Location:** `sources/plex.js`

**Signature:**

```javascript
async fetchMusic(libraryNames = [], count = 50, options = {}) {
  // Returns array of album objects in unified format
}
```

**Implementation:**

```javascript
/**
 * Fetch music albums from Plex music libraries
 * @param {string[]} libraryNames - Array of music library names to include
 * @param {number} count - Maximum number of albums to return
 * @param {object} options - Filtering and sorting options
 * @param {string[]} options.genres - Genre filter array
 * @param {string[]} options.artists - Artist filter array
 * @param {number} options.minRating - Minimum rating (0-10)
 * @param {string} options.sortMode - Sorting mode (weighted-random, recent, popular, alphabetical, random)
 * @param {object} options.sortWeights - Weights for weighted-random mode
 * @returns {Promise<Array>} Array of album objects
 */
async fetchMusic(libraryNames = [], count = 50, options = {}) {
  const {
    genres = [],
    artists = [],
    minRating = 0,
    sortMode = 'weighted-random',
    sortWeights = { recentWeight: 20, popularWeight: 30, randomWeight: 50 }
  } = options;

  try {
    // 1. Get all music libraries
    const sections = await this.client.library.sections();
    const musicSections = sections.filter(
      s => s.type === 'artist' &&
      (libraryNames.length === 0 || libraryNames.includes(s.title))
    );

    if (musicSections.length === 0) {
      logger.warn('[Plex Music] No music libraries found');
      return [];
    }

    logger.info(`[Plex Music] Found ${musicSections.length} music libraries`);

    // 2. Fetch albums from all selected libraries
    let allAlbums = [];

    for (const section of musicSections) {
      try {
        const albums = await this.fetchAlbumsFromSection(section.key, count * 2);
        allAlbums.push(...albums);
        logger.debug(`[Plex Music] Fetched ${albums.length} albums from ${section.title}`);
      } catch (error) {
        logger.error(`[Plex Music] Error fetching from ${section.title}:`, error.message);
      }
    }

    logger.info(`[Plex Music] Total albums fetched: ${allAlbums.length}`);

    // 3. Filter by genre
    if (genres.length > 0) {
      const before = allAlbums.length;
      allAlbums = allAlbums.filter(album => {
        const albumGenres = album._raw?.Genre?.map(g => g.tag) || [];
        return albumGenres.some(g => genres.includes(g));
      });
      logger.debug(`[Plex Music] Genre filter: ${before} → ${allAlbums.length} albums`);
    }

    // 4. Filter by artist
    if (artists.length > 0) {
      const before = allAlbums.length;
      allAlbums = allAlbums.filter(album =>
        artists.includes(album.artist)
      );
      logger.debug(`[Plex Music] Artist filter: ${before} → ${allAlbums.length} albums`);
    }

    // 5. Filter by rating
    if (minRating > 0) {
      const before = allAlbums.length;
      allAlbums = allAlbums.filter(album =>
        (album.rating || 0) >= minRating
      );
      logger.debug(`[Plex Music] Rating filter: ${before} → ${allAlbums.length} albums`);
    }

    // 6. Remove albums without covers
    allAlbums = allAlbums.filter(album => album.posterUrl);

    // 7. Apply sorting
    allAlbums = this.sortAlbums(allAlbums, sortMode, sortWeights);

    // 8. Limit to requested count
    const finalAlbums = allAlbums.slice(0, count);

    logger.info(`[Plex Music] Returning ${finalAlbums.length} albums`);
    this.updateMetrics('music', finalAlbums.length, allAlbums.length);

    return finalAlbums;

  } catch (error) {
    logger.error('[Plex Music] Error in fetchMusic:', error);
    return [];
  }
}

/**
 * Fetch albums from a specific library section
 */
async fetchAlbumsFromSection(sectionKey, limit = 500) {
  const albums = [];
  let start = 0;
  const pageSize = 100; // Plex recommends max 500, we use 100 for safety

  while (albums.length < limit) {
    const url = `/library/sections/${sectionKey}/albums`;
    const params = {
      'X-Plex-Container-Start': start,
      'X-Plex-Container-Size': pageSize,
      sort: 'addedAt:desc' // Get recent albums first
    };

    const response = await this.client.query(url, params);
    const items = response.MediaContainer.Directory || [];

    if (items.length === 0) break;

    for (const item of items) {
      albums.push(this.mapAlbumToUnifiedFormat(item));
    }

    start += pageSize;
    if (items.length < pageSize) break; // No more pages
  }

  return albums;
}

/**
 * Map Plex album metadata to unified format
 */
mapAlbumToUnifiedFormat(album) {
  const serverName = this.config.name || 'plex';
  const albumId = album.ratingKey;

  return {
    // Unified format
    key: `plex-${serverName}-${albumId}`,
    title: album.title,
    artist: album.parentTitle,
    year: parseInt(album.year) || null,
    posterUrl: this.getImageUrl(album.thumb, albumId),
    backgroundUrl: album.art ? this.getImageUrl(album.art, albumId) : null,
    artistPhotoUrl: album.parentThumb ? this.getImageUrl(album.parentThumb, album.parentRatingKey) : null,
    rating: this.normalizeRating(album.userRating || album.rating),
    type: 'music', // Important: identifies as music content

    // Extended metadata
    album: album.title,
    summary: album.summary || '',
    studio: album.studio || '',
    releaseDate: album.originallyAvailableAt || null,
    genres: album.Genre?.map(g => g.tag) || [],
    styles: album.Style?.map(s => s.tag) || [],
    moods: album.Mood?.map(m => m.tag) || [],
    collections: album.Collection?.map(c => c.tag) || [],

    // Statistics
    viewCount: parseInt(album.viewCount) || 0,
    lastViewedAt: album.lastViewedAt ? new Date(album.lastViewedAt * 1000).toISOString() : null,
    addedAt: album.addedAt ? new Date(album.addedAt * 1000).toISOString() : null,
    updatedAt: album.updatedAt ? new Date(album.updatedAt * 1000).toISOString() : null,

    // Plex-specific
    ratingKey: albumId,
    parentRatingKey: album.parentRatingKey,
    guid: album.guid,

    // Raw data (for debugging, excluded in production)
    ...(this.config.debug && { _raw: album })
  };
}

/**
 * Sort albums based on mode and weights
 */
sortAlbums(albums, mode, weights) {
  switch (mode) {
    case 'recent':
      return albums.sort((a, b) =>
        new Date(b.addedAt) - new Date(a.addedAt)
      );

    case 'popular':
      return albums.sort((a, b) =>
        (b.viewCount || 0) - (a.viewCount || 0)
      );

    case 'alphabetical':
      return albums.sort((a, b) =>
        a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
      );

    case 'random':
      return this.shuffleArray(albums);

    case 'weighted-random':
    default:
      return this.weightedRandomSort(albums, weights);
  }
}

/**
 * Weighted random sorting algorithm
 * Combines recent, popular, and random selection
 */
weightedRandomSort(albums, weights) {
  const { recentWeight, popularWeight, randomWeight } = weights;
  const total = recentWeight + popularWeight + randomWeight;

  if (total === 0) return this.shuffleArray(albums);

  // Calculate how many albums from each category
  const recentCount = Math.floor(albums.length * (recentWeight / total));
  const popularCount = Math.floor(albums.length * (popularWeight / total));
  const randomCount = albums.length - recentCount - popularCount;

  // Sort for each category
  const recent = [...albums]
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
    .slice(0, recentCount);

  const popular = [...albums]
    .filter(a => !recent.includes(a))
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
    .slice(0, popularCount);

  const random = [...albums]
    .filter(a => !recent.includes(a) && !popular.includes(a));
  this.shuffleArray(random);
  const randomSelection = random.slice(0, randomCount);

  // Combine and shuffle the final selection
  const combined = [...recent, ...popular, ...randomSelection];
  return this.shuffleArray(combined);
}

/**
 * Normalize rating to 0-10 scale
 */
normalizeRating(rating) {
  if (!rating) return null;
  // Plex ratings are typically 0-10
  return Math.min(10, Math.max(0, parseFloat(rating)));
}

/**
 * Fisher-Yates shuffle algorithm
 */
shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Update metrics for monitoring
 */
updateMetrics(type, returned, total) {
  if (!this.metrics) this.metrics = {};
  if (!this.metrics[type]) {
    this.metrics[type] = {
      requests: 0,
      itemsReturned: 0,
      itemsTotal: 0,
      filterEfficiency: 0
    };
  }

  this.metrics[type].requests++;
  this.metrics[type].itemsReturned += returned;
  this.metrics[type].itemsTotal += total;
  this.metrics[type].filterEfficiency =
    total > 0 ? (returned / total) * 100 : 100;
}
```

---

## Testing Strategy

### Unit Tests

**File:** `__tests__/sources/plex-music.test.js`

```javascript
describe('Plex Music Integration', () => {
    describe('fetchMusic', () => {
        it('should fetch albums from music libraries', async () => {
            const albums = await plexSource.fetchMusic(['Music'], 50);
            expect(albums).toBeArray();
            expect(albums.length).toBeLessThanOrEqual(50);
        });

        it('should filter by genre', async () => {
            const albums = await plexSource.fetchMusic(['Music'], 50, {
                genres: ['Rock'],
            });
            albums.forEach(album => {
                expect(album.genres).toContain('Rock');
            });
        });

        it('should apply weighted-random sorting', async () => {
            const albums = await plexSource.fetchMusic(['Music'], 50, {
                sortMode: 'weighted-random',
                sortWeights: { recentWeight: 50, popularWeight: 30, randomWeight: 20 },
            });
            expect(albums.length).toBeGreaterThan(0);
        });
    });
});
```

---

## Performance Considerations

1. **Pagination:** Fetch in batches of 100 to avoid timeout
2. **Caching:** Cache album metadata for 5 minutes
3. **Filtering:** Apply filters after fetch to minimize API calls
4. **Sorting:** Implement efficient sorting algorithms
5. **Fallbacks:** Handle missing covers gracefully

---

**Status:** Ready for implementation
