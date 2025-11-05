# RomM Integration Plan

## Overview

RomM is a game ROM management system with rich metadata from IGDB, RetroAchievements, and other sources. This document outlines the integration plan for Posterrama, specifically focused on **Wallart Mode** support for game artwork display.

## Scope

**Initial Implementation: Wallart Mode Only**

- Display game box art/covers in rotation
- Platform-based filtering and organization
- RetroAchievements badge/stats display
- Separated from movie/TV content (no mixing)

## RomM API Overview

### Key Endpoints

- `GET /api/roms` - List ROMs with filters
- `GET /api/platforms` - List available platforms
- `GET /api/roms/{id}` - Detailed ROM information
- `GET /api/raw/assets/{path}` - Serve cover images and assets

### Authentication

- Supports OAuth2 (password flow) and HTTP Basic
- Token endpoint: `POST /api/token`
- Tokens expire, refresh handling needed

### Data Structure

```javascript
{
  id: number,
  name: string,
  slug: string,
  summary: string,
  platform_name: string,
  platform_id: number,
  url_cover: string,          // Direct URL to cover
  path_cover_large: string,   // Large cover path
  metadatum: {
    genres: string[],
    first_release_date: number,
    average_rating: number
  },
  igdb_metadata: {
    total_rating: string,
    youtube_video_id: string,
    genres: string[]
  },
  rom_user: {
    last_played: date,
    is_favorite: boolean
  }
}
```

## Implementation Plan

### Phase 1: Foundation

**Goal:** Basic RomM connection and data fetching

#### 1.1 Create RomM HTTP Client

**File:** `utils/romm-http-client.js`

Features:

- HTTP client with OAuth2/Basic auth support
- Token refresh mechanism
- Endpoints:
    - `getRoms(params)` - Fetch ROMs with filters
    - `getPlatforms()` - Get platform list
    - `getRomDetails(romId)` - Get detailed ROM info
    - `getAssetUrl(path)` - Generate asset URL with auth

Pattern: Follow `utils/jellyfin-http-client.js` structure

#### 1.2 Create RomM Source Adapter

**File:** `sources/romm.js`

Functions:

- `fetchMedia(platforms, type, count)` - Main fetch function
- `getAvailablePlatforms()` - For admin platform selection
- `processRomItem(rom)` - Transform RomM ROM to Posterrama format
- `getMetrics()` / `resetMetrics()` - Standard metrics

Data Mapping:

```javascript
{
  // Posterrama format
  id: `romm_${serverName}_${rom.id}`,
  sourceId: `romm_${serverName}_${rom.id}`,
  key: `romm_${serverName}_${rom.id}`,
  title: rom.name,
  slug: rom.slug,
  overview: rom.summary,
  poster: rom.url_cover,
  posterUrl: rom.url_cover,
  type: 'game',
  source: 'romm',
  serverName: serverConfig.name,

  // Game-specific fields
  platform: rom.platform_name,
  platformId: rom.platform_id,
  genres: rom.metadatum?.genres || [],
  rating: rom.metadatum?.average_rating,
  releaseDate: rom.metadatum?.first_release_date,

  // RetroAchievements (if available)
  raId: rom.ra_id,
  achievements: rom.merged_ra_metadata?.achievements || [],

  // Metadata
  igdbId: rom.igdb_id,
  alternativeNames: rom.alternative_names || []
}
```

#### 1.3 Config Schema Updates

**File:** `config.schema.json`

Add RomM server type:

```json
{
    "type": "romm",
    "name": "string",
    "url": "string",
    "username": "string",
    "password": "string",
    "enabled": "boolean",
    "selectedPlatforms": ["string"],
    "filters": {
        "favouritesOnly": "boolean",
        "playableOnly": "boolean",
        "excludeUnidentified": "boolean"
    }
}
```

### Phase 2: Wallart Mode Integration

**Goal:** Enable game artwork display in Wallart mode

#### 2.1 Mode Detection & Filtering

**Files:** `server.js`, `public/wallart.html`, `public/wallart.js`

Changes:

- Wallart mode recognizes `type=game` parameter
- Support `source=romm` in media fetching
- Keep games separated from movies/shows (no mixing)

#### 2.2 Game-Specific Display

**Files:** `public/wallart.js`, `public/wallart.css`

Features:

- Platform badge/logo in corner (optional overlay)
- Genre tags display (optional)
- RetroAchievements badge count (if present)
- Release year display
- Rating display (stars/percentage)

Example overlay structure:

```html
<div class="game-overlay">
    <div class="platform-badge">Nintendo Switch</div>
    <div class="ra-achievements">🏆 45/50</div>
    <div class="genre-tags">RPG • Adventure</div>
</div>
```

#### 2.3 Admin Configuration

**Files:** `public/admin.html`, `public/admin.js`

UI Elements:

- RomM server configuration section
- Platform selection (multi-select like libraries)
- Filter options:
    - Favorites only
    - Playable only (browser-playable ROMs)
    - Exclude unidentified
- Test connection button
- Platform logo preview

### Phase 3: RetroAchievements Integration

**Goal:** Display achievement data for games

#### 3.1 Achievement Data Processing

**File:** `sources/romm.js`

Features:

- Parse `merged_ra_metadata.achievements` array
- Calculate completion percentage
- Track earned vs total achievements
- Badge image URLs from RomM

#### 3.2 Achievement Display

**Files:** `public/wallart.js`, `public/wallart.css`

Display Options:

1. **Badge Count:** "🏆 45/50 Achievements"
2. **Progress Bar:** Visual completion indicator
3. **Recent Achievements:** Show recently earned badges
4. **Badge Icons:** Display actual achievement badge images

Overlay Placement:

- Bottom-right corner (configurable)
- Non-intrusive, semi-transparent
- Only show if ROM has RA data

## Technical Details

### Authentication Flow

```javascript
// OAuth2 Password Flow
POST /api/token
{
  grant_type: "password",
  username: "user",
  password: "pass"
}

Response:
{
  access_token: "...",
  refresh_token: "...",
  token_type: "bearer",
  expires: 3600
}

// Use in subsequent requests
Authorization: Bearer {access_token}
```

### Asset URL Handling

RomM serves assets via authenticated endpoint:

```
GET /api/raw/assets/romm/resources/roms/1/cover.jpg
Authorization: Bearer {token}
```

Posterrama approach:

1. Proxy through `/image?url=...` endpoint (like Plex/Jellyfin)
2. Server-side fetches with auth headers
3. Cache responses in `image_cache/`

### Rate Limiting & Performance

- Batch ROM requests (default: 50 per page)
- Use `limit` and `offset` parameters for pagination
- Cache platform list (changes infrequently)
- Respect RomM server load

## Configuration Example

```json
{
    "mediaServers": [
        {
            "type": "romm",
            "name": "My Game Collection",
            "url": "http://192.168.1.100:8080",
            "username": "admin",
            "password": "secret",
            "enabled": true,
            "selectedPlatforms": ["switch", "ps5", "arcade", "nes", "snes"],
            "filters": {
                "favouritesOnly": false,
                "playableOnly": true,
                "excludeUnidentified": true
            }
        }
    ]
}
```

## Display Settings (Wallart Mode)

```json
{
    "wallartSettings": {
        "sources": ["romm"],
        "gameDisplay": {
            "showPlatformBadge": true,
            "showAchievements": true,
            "showGenres": false,
            "showRating": true,
            "overlayPosition": "bottom-right"
        },
        "rotation": {
            "interval": 30,
            "transition": "fade"
        }
    }
}
```

## Future Enhancements (Out of Scope)

### Potential Phase 4+ Features

- **Screensaver Mode:** Game cover slideshow
- **Cinema Mode:** YouTube trailers via `youtube_video_id`
- **Collections Support:** RomM user collections
- **Platform Themes:** Custom styling per platform
- **User Stats:** "Most Played" / "Recently Played"
- **Screenshot Rotation:** Alternate between cover and gameplay screenshots
- **Multi-ROM Display:** Show multiple games per screen (grid layout)

## Testing Checklist

### Phase 1 (Foundation)

- [ ] RomM client connects and authenticates
- [ ] Platform list fetches correctly
- [ ] ROMs fetch with basic filters
- [ ] Cover images load via proxy
- [ ] Config validation works for RomM servers

### Phase 2 (Wallart Integration)

- [ ] Wallart mode loads RomM games
- [ ] Cover art displays correctly
- [ ] Platform filter works in admin UI
- [ ] Rotation timing respects settings
- [ ] No mixing with movie/TV content

### Phase 3 (RetroAchievements)

- [ ] Achievement data parses correctly
- [ ] Badge count displays on overlay
- [ ] Only shows when RA data exists
- [ ] Achievement images load (if showing badges)
- [ ] Completion percentage calculates correctly

## Dependencies

### Required npm Packages

No new dependencies needed - use existing:

- `axios` - HTTP client
- `winston` - Logging
- Existing auth/cache utilities

### RomM Server Requirements

- RomM v4.0.1+ (confirmed via OpenAPI spec)
- API access enabled
- Valid user account with ROM read permissions
- OAuth2 or Basic auth configured

## Security Considerations

1. **Credential Storage:** Store RomM credentials encrypted (same as Plex/Jellyfin)
2. **Token Management:** Refresh tokens before expiry, handle 401 responses
3. **Asset Proxying:** Never expose RomM credentials to client
4. **Input Validation:** Sanitize platform IDs and ROM IDs from user input

## Documentation Updates

After implementation, update:

- `README.md` - Add RomM to supported sources
- `docs/DEVELOPMENT.md` - RomM dev setup instructions
- API docs (`swagger.js`) - RomM-specific endpoints
- Admin UI help text - RomM configuration guide

## Notes

- RomM focuses on retro gaming, so expect mostly classic platforms
- Cover art quality varies by platform and scraper
- RetroAchievements only available for supported systems (NES, SNES, Genesis, etc.)
- Some ROMs may not have IGDB matches (unidentified)
- Platform selection UI should show ROM counts per platform

## References

- RomM GitHub: https://github.com/rommapp/romm
- RomM API Spec: `/docs/api-specs/romm-openapi-stabe.json`
- RetroAchievements API: https://api-docs.retroachievements.org/
- IGDB API: https://api-docs.igdb.com/
