# Plex Music Backend Routes Specification

**Part of:** Plex Music Implementation Plan  
**Phase:** 3 - Backend Routes & Integration

---

## Overview

This document specifies all backend routes and endpoints needed for Plex Music support, including admin API endpoints and integration with existing `/get-media` endpoint.

---

## New API Endpoints

### 1. Get Music Libraries

**Endpoint:** `GET /api/admin/plex/music-libraries`

**Purpose:** Fetch available music libraries from Plex server for configuration

**Authentication:** Required (admin session)

**Request:**

```javascript
GET / api / admin / plex / music - libraries;
```

**Response:**

```json
{
    "success": true,
    "libraries": [
        {
            "key": "8",
            "name": "Music",
            "type": "artist",
            "albumCount": 1247,
            "artistCount": 342,
            "trackCount": 15834
        },
        {
            "key": "9",
            "name": "Classical",
            "type": "artist",
            "albumCount": 523,
            "artistCount": 156,
            "trackCount": 6789
        }
    ]
}
```

**Implementation:**

```javascript
/**
 * @swagger
 * /api/admin/plex/music-libraries:
 *   get:
 *     summary: Get Plex music libraries
 *     tags: [Admin, Plex]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Music libraries retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.get('/api/admin/plex/music-libraries', isAuthenticated, async (req, res) => {
    try {
        const plexConfig = config.plex;

        if (!plexConfig.enabled) {
            return res.json({ success: false, error: 'Plex not enabled' });
        }

        // Initialize Plex client
        const PlexAPI = require('plex-api');
        const client = new PlexAPI({
            hostname: plexConfig.hostname,
            port: plexConfig.port,
            token: plexConfig.token,
            options: {
                identifier: 'posterrama',
                product: 'Posterrama',
            },
        });

        // Fetch all library sections
        const sections = await client.query('/library/sections');
        const musicSections = sections.MediaContainer.Directory.filter(
            section => section.type === 'artist'
        ).map(section => ({
            key: section.key,
            name: section.title,
            type: section.type,
            albumCount: parseInt(section.count) || 0,
            artistCount: parseInt(section.artist) || 0,
            trackCount: parseInt(section.track) || 0,
        }));

        logger.info(`[Admin] Found ${musicSections.length} Plex music libraries`);

        res.json({
            success: true,
            libraries: musicSections,
        });
    } catch (error) {
        logger.error('[Admin] Error fetching Plex music libraries:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
```

---

### 2. Get Music Genres

**Endpoint:** `GET /api/admin/plex/music-genres`

**Purpose:** Fetch all available genres from music libraries for filtering

**Authentication:** Required (admin session)

**Query Parameters:**

- `libraries` (optional): Comma-separated library names to filter

**Request:**

```javascript
GET /api/admin/plex/music-genres?libraries=Music,Classical
```

**Response:**

```json
{
    "success": true,
    "genres": [
        "Rock",
        "Jazz",
        "Classical",
        "Blues",
        "Electronic",
        "Hip-Hop",
        "Country",
        "R&B",
        "Pop",
        "Metal"
    ]
}
```

**Implementation:**

```javascript
/**
 * @swagger
 * /api/admin/plex/music-genres:
 *   get:
 *     summary: Get available music genres from Plex
 *     tags: [Admin, Plex]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: libraries
 *         schema:
 *           type: string
 *         description: Comma-separated library names
 *     responses:
 *       200:
 *         description: Genres retrieved successfully
 */
app.get('/api/admin/plex/music-genres', isAuthenticated, async (req, res) => {
    try {
        const plexConfig = config.plex;
        const libraryNames = req.query.libraries
            ? req.query.libraries.split(',').map(l => l.trim())
            : [];

        if (!plexConfig.enabled) {
            return res.json({ success: false, error: 'Plex not enabled' });
        }

        const PlexAPI = require('plex-api');
        const client = new PlexAPI({
            hostname: plexConfig.hostname,
            port: plexConfig.port,
            token: plexConfig.token,
            options: {
                identifier: 'posterrama',
                product: 'Posterrama',
            },
        });

        // Get music library sections
        const sections = await client.query('/library/sections');
        const musicSections = sections.MediaContainer.Directory.filter(
            section =>
                section.type === 'artist' &&
                (libraryNames.length === 0 || libraryNames.includes(section.title))
        );

        // Collect all genres from all music sections
        const genresSet = new Set();

        for (const section of musicSections) {
            try {
                // Get genres for this section
                const genreResponse = await client.query(`/library/sections/${section.key}/genre`);
                const genres = genreResponse.MediaContainer.Directory || [];

                genres.forEach(genre => {
                    if (genre.title) genresSet.add(genre.title);
                });
            } catch (error) {
                logger.warn(`[Admin] Could not fetch genres from ${section.title}:`, error.message);
            }
        }

        const genresList = Array.from(genresSet).sort();

        logger.info(`[Admin] Found ${genresList.length} unique music genres`);

        res.json({
            success: true,
            genres: genresList,
        });
    } catch (error) {
        logger.error('[Admin] Error fetching music genres:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
```

---

### 3. Get Music Artists

**Endpoint:** `GET /api/admin/plex/music-artists`

**Purpose:** Fetch all artists from music libraries for filtering

**Authentication:** Required (admin session)

**Query Parameters:**

- `libraries` (optional): Comma-separated library names
- `limit` (optional): Max artists to return (default: 100)

**Request:**

```javascript
GET /api/admin/plex/music-artists?libraries=Music&limit=50
```

**Response:**

```json
{
    "success": true,
    "artists": [
        {
            "name": "Pink Floyd",
            "albumCount": 15,
            "guid": "plex://artist/..."
        },
        {
            "name": "The Beatles",
            "albumCount": 23,
            "guid": "plex://artist/..."
        }
    ],
    "total": 342
}
```

**Implementation:**

```javascript
/**
 * @swagger
 * /api/admin/plex/music-artists:
 *   get:
 *     summary: Get artists from Plex music libraries
 *     tags: [Admin, Plex]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: libraries
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Artists retrieved successfully
 */
app.get('/api/admin/plex/music-artists', isAuthenticated, async (req, res) => {
    try {
        const plexConfig = config.plex;
        const libraryNames = req.query.libraries
            ? req.query.libraries.split(',').map(l => l.trim())
            : [];
        const limit = parseInt(req.query.limit) || 100;

        if (!plexConfig.enabled) {
            return res.json({ success: false, error: 'Plex not enabled' });
        }

        const PlexAPI = require('plex-api');
        const client = new PlexAPI({
            hostname: plexConfig.hostname,
            port: plexConfig.port,
            token: plexConfig.token,
            options: {
                identifier: 'posterrama',
                product: 'Posterrama',
            },
        });

        // Get music library sections
        const sections = await client.query('/library/sections');
        const musicSections = sections.MediaContainer.Directory.filter(
            section =>
                section.type === 'artist' &&
                (libraryNames.length === 0 || libraryNames.includes(section.title))
        );

        let allArtists = [];

        for (const section of musicSections) {
            try {
                // Get all artists from this section
                const artistResponse = await client.query(`/library/sections/${section.key}/all`, {
                    type: 8, // Type 8 = artist
                });

                const artists = artistResponse.MediaContainer.Directory || [];

                artists.forEach(artist => {
                    allArtists.push({
                        name: artist.title,
                        albumCount: parseInt(artist.childCount) || 0,
                        guid: artist.guid,
                    });
                });
            } catch (error) {
                logger.warn(
                    `[Admin] Could not fetch artists from ${section.title}:`,
                    error.message
                );
            }
        }

        // Sort by name and limit
        allArtists.sort((a, b) => a.name.localeCompare(b.name));
        const total = allArtists.length;
        const limitedArtists = allArtists.slice(0, limit);

        logger.info(`[Admin] Found ${total} music artists, returning ${limitedArtists.length}`);

        res.json({
            success: true,
            artists: limitedArtists,
            total: total,
        });
    } catch (error) {
        logger.error('[Admin] Error fetching music artists:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
```

---

## Update Existing Endpoints

### 4. Update /get-media Endpoint

**Purpose:** Include music albums when Music Only mode is enabled

**Implementation Changes:**

```javascript
app.get('/get-media', cacheMiddleware(300), async (req, res) => {
    try {
        // ... existing code ...

        const gamesOnly = config.wallart?.gamesOnly === true;
        const musicMode = config.wallart?.musicMode?.enabled === true;

        // Validate mode exclusivity
        if (gamesOnly && musicMode) {
            logger.warn(
                '[get-media] Both Games Only and Music Mode enabled, defaulting to Games Only'
            );
            musicMode = false;
        }

        // ... existing Plex movies/TV fetch ...

        // NEW: Fetch Plex music if Music Mode enabled
        if (musicMode && config.plex?.musicEnabled) {
            logger.info('[get-media] Fetching music albums (Music Only mode)');

            try {
                const plexSource = new PlexSource(config.plex);
                const musicAlbums = await plexSource.fetchMusic(
                    config.plex.musicLibraries || [],
                    count,
                    {
                        genres: config.plex.musicFilters?.genres || [],
                        artists: config.plex.musicFilters?.artists || [],
                        minRating: config.plex.musicFilters?.minRating || 0,
                        sortMode: config.wallart.musicMode.sorting?.mode || 'weighted-random',
                        sortWeights: config.wallart.musicMode.sorting || {},
                    }
                );

                allMedia.push(...musicAlbums);
                logger.info(`[get-media] Added ${musicAlbums.length} music albums`);
            } catch (error) {
                logger.error('[get-media] Error fetching Plex music:', error);
            }
        }

        // If Music Mode enabled, filter out non-music content
        if (musicMode) {
            allMedia = allMedia.filter(item => item.type === 'music');
            logger.info(`[get-media] Music Mode: ${allMedia.length} music albums after filtering`);
        }

        // ... rest of existing code ...
    } catch (error) {
        logger.error('[get-media] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
```

---

## Route Testing

### Test Suite Structure

**File:** `__tests__/routes/plex-music-routes.test.js`

```javascript
const request = require('supertest');
const app = require('../server');

describe('Plex Music Routes', () => {
    describe('GET /api/admin/plex/music-libraries', () => {
        it('should return music libraries', async () => {
            const response = await request(app)
                .get('/api/admin/plex/music-libraries')
                .set('Cookie', adminSession)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.libraries).toBeArray();
        });

        it('should require authentication', async () => {
            await request(app).get('/api/admin/plex/music-libraries').expect(401);
        });
    });

    describe('GET /api/admin/plex/music-genres', () => {
        it('should return genre list', async () => {
            const response = await request(app)
                .get('/api/admin/plex/music-genres')
                .set('Cookie', adminSession)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.genres).toBeArray();
        });

        it('should filter by libraries', async () => {
            const response = await request(app)
                .get('/api/admin/plex/music-genres?libraries=Music')
                .set('Cookie', adminSession)
                .expect(200);

            expect(response.body.genres).toBeArray();
        });
    });

    describe('GET /api/admin/plex/music-artists', () => {
        it('should return artist list', async () => {
            const response = await request(app)
                .get('/api/admin/plex/music-artists')
                .set('Cookie', adminSession)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.artists).toBeArray();
            expect(response.body.total).toBeNumber();
        });

        it('should respect limit parameter', async () => {
            const response = await request(app)
                .get('/api/admin/plex/music-artists?limit=10')
                .set('Cookie', adminSession)
                .expect(200);

            expect(response.body.artists.length).toBeLessThanOrEqual(10);
        });
    });

    describe('GET /get-media (music integration)', () => {
        it('should return music albums when Music Mode enabled', async () => {
            // Enable music mode in config
            config.wallart.musicMode.enabled = true;
            config.plex.musicEnabled = true;

            const response = await request(app).get('/get-media').expect(200);

            expect(response.body).toBeArray();
            response.body.forEach(item => {
                expect(item.type).toBe('music');
            });
        });

        it('should not mix music with other content', async () => {
            config.wallart.musicMode.enabled = true;

            const response = await request(app).get('/get-media').expect(200);

            const types = new Set(response.body.map(item => item.type));
            expect(types.size).toBe(1);
            expect(types.has('music')).toBe(true);
        });
    });
});
```

---

## Error Handling

### Common Error Scenarios

1. **Plex server unreachable:**

```javascript
{
  "success": false,
  "error": "Could not connect to Plex server"
}
```

2. **No music libraries found:**

```javascript
{
  "success": true,
  "libraries": []
}
```

3. **Invalid token:**

```javascript
{
  "success": false,
  "error": "Unauthorized: Invalid Plex token"
}
```

4. **Music mode + Games Only conflict:**

```javascript
// Server logs warning and defaults to Games Only
logger.warn('[get-media] Both Games Only and Music Mode enabled, defaulting to Games Only');
```

---

## Performance Optimization

1. **Caching:** Cache genre/artist lists for 5 minutes
2. **Pagination:** Implement pagination for large artist lists
3. **Lazy Loading:** Load additional data on demand
4. **Rate Limiting:** Prevent excessive API calls
5. **Connection Pooling:** Reuse Plex connections

---

**Status:** Ready for implementation
