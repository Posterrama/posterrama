# Plex Music Implementation Plan

**Version:** 1.0  
**Date:** November 8, 2025  
**Status:** Design Phase

## Executive Summary

Implementation plan for Plex Music support in Posterrama with square album cover display in Wallart mode only. Music content is displayed separately from movies/TV/games in a dedicated "Music Only" mode with three distinct visual styles.

---

## Core Requirements

### Must Have

- ✅ Plex music library integration
- ✅ Album cover display (square 1:1 aspect ratio)
- ✅ Wallart Music-Only mode (no mixing with other content)
- ✅ Automatic music library detection
- ✅ Full metadata extraction (artist, album, year, genre, rating)
- ✅ Multiple grid layouts (3x3, 4x4, 5x5, 6x6)
- ✅ Hero + Grid layout (1 hero + 16 grid)
- ✅ Three display styles
- ✅ Genre and artist filtering
- ✅ Music-specific animations (Vinyl Spin)

### Won't Have (Phase 1)

- ❌ Music in Screensaver mode
- ❌ Music in Cinema mode
- ❌ Mixed content display (music + movies)
- ❌ Music playback/audio
- ❌ Plex smart playlists
- ❌ Individual track display (albums only)
- ❌ Posterpack generation for music

---

## Architecture Overview

### Data Flow

```
Plex Music API
    ↓
sources/plex.js (fetchMusic method)
    ↓
Unified Media Format
    ↓
/get-media endpoint
    ↓
Wallart Music Mode
    ↓
Square Grid Display (1:1 ratio)
```

### File Structure

```
sources/
  └── plex.js                    # Add fetchMusic() method

config/
  └── validators.js              # Add music config validation

config.schema.json               # Add music schema
config.example.json              # Add music example

public/
  ├── wallart.html               # Add music mode UI
  ├── wallart.js                 # Add music filtering & layout
  ├── wallart.css                # Add square grid styles
  └── admin.html                 # Add music config UI

server.js                        # Add music API routes

__tests__/
  ├── sources/plex-music.test.js
  └── public/wallart-music.test.js
```

---

## Phase 1: Configuration Schema

### Config Schema Extensions

**File:** `config.schema.json`

```json
{
    "plex": {
        "properties": {
            "musicEnabled": {
                "type": "boolean",
                "default": false
            },
            "musicLibraries": {
                "type": "array",
                "items": { "type": "string" },
                "default": []
            },
            "musicFilters": {
                "type": "object",
                "properties": {
                    "genres": {
                        "type": "array",
                        "items": { "type": "string" },
                        "default": []
                    },
                    "artists": {
                        "type": "array",
                        "items": { "type": "string" },
                        "default": []
                    },
                    "minRating": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 10,
                        "default": 0
                    }
                }
            }
        }
    },
    "wallart": {
        "properties": {
            "musicMode": {
                "type": "object",
                "properties": {
                    "enabled": {
                        "type": "boolean",
                        "default": false
                    },
                    "displayStyle": {
                        "type": "string",
                        "enum": ["covers-only", "album-info", "artist-cards"],
                        "default": "covers-only"
                    },
                    "showArtist": {
                        "type": "boolean",
                        "default": true
                    },
                    "showAlbumTitle": {
                        "type": "boolean",
                        "default": true
                    },
                    "showYear": {
                        "type": "boolean",
                        "default": true
                    },
                    "showGenre": {
                        "type": "boolean",
                        "default": false
                    },
                    "animation": {
                        "type": "string",
                        "enum": ["vinyl-spin", "slide-fade", "crossfade", "flip"],
                        "default": "vinyl-spin"
                    },
                    "sorting": {
                        "type": "object",
                        "properties": {
                            "mode": {
                                "type": "string",
                                "enum": [
                                    "weighted-random",
                                    "recent",
                                    "popular",
                                    "alphabetical",
                                    "random"
                                ],
                                "default": "weighted-random"
                            },
                            "recentWeight": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 100,
                                "default": 20
                            },
                            "popularWeight": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 100,
                                "default": 30
                            },
                            "randomWeight": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 100,
                                "default": 50
                            }
                        }
                    }
                }
            }
        }
    }
}
```

### Example Config

**File:** `config.example.json`

```json
{
    "plex": {
        "enabled": true,
        "hostname": "192.168.1.10",
        "port": 32400,
        "token": "your-plex-token",
        "libraries": ["Movies", "TV Shows"],
        "musicEnabled": true,
        "musicLibraries": ["Music", "Classical"],
        "musicFilters": {
            "genres": ["Rock", "Jazz", "Classical"],
            "artists": [],
            "minRating": 0
        }
    },
    "wallart": {
        "gridSize": "4x4",
        "layout": "grid",
        "gamesOnly": false,
        "musicMode": {
            "enabled": false,
            "displayStyle": "covers-only",
            "showArtist": true,
            "showAlbumTitle": true,
            "showYear": true,
            "showGenre": false,
            "animation": "vinyl-spin",
            "sorting": {
                "mode": "weighted-random",
                "recentWeight": 20,
                "popularWeight": 30,
                "randomWeight": 50
            }
        }
    }
}
```

---

## Implementation Checklist

### Phase 1: Config & Schema ✅

- [ ] Update `config.schema.json` with music properties
- [ ] Update `config.example.json` with music examples
- [ ] Add validation in `config/validators.js`
- [ ] Test config validation

### Phase 2: Plex Music API (See plex-music-api-spec.md)

- [ ] Implement `fetchMusic()` in `sources/plex.js`
- [ ] Add music metadata extraction
- [ ] Add filtering logic (genre, artist, rating)
- [ ] Add sorting algorithms
- [ ] Test with real Plex server

### Phase 3: Backend Routes (See plex-music-routes.md)

- [ ] Add `/api/admin/plex/music-libraries` endpoint
- [ ] Add `/api/admin/plex/music-genres` endpoint
- [ ] Add `/api/admin/plex/music-artists` endpoint
- [ ] Update `/get-media` to include music
- [ ] Add Swagger documentation

### Phase 4: Admin UI (See plex-music-admin-ui.md)

- [ ] Add music section to Plex config
- [ ] Add music library selector
- [ ] Add genre filter UI
- [ ] Add artist filter UI
- [ ] Add music display settings to Wallart tab
- [ ] Test admin interface

### Phase 5: Wallart Music Mode (See plex-music-wallart.md)

- [ ] Add Music Only toggle
- [ ] Implement square grid layout (1:1 ratio)
- [ ] Implement Hero + Grid layout
- [ ] Add three display styles
- [ ] Add music-specific animations
- [ ] Add responsive design
- [ ] Test on multiple screen sizes

### Phase 6: Testing

- [ ] Unit tests for Plex music fetching
- [ ] Unit tests for music filtering
- [ ] Unit tests for sorting algorithms
- [ ] Integration tests for music API
- [ ] UI tests for music mode
- [ ] Manual testing with various Plex libraries
- [ ] Performance testing with large libraries (10,000+ albums)

---

## Success Criteria

1. ✅ Music albums display in square grid (1:1 aspect ratio)
2. ✅ Music-Only mode works independently (no mixing)
3. ✅ All metadata extracted and accessible
4. ✅ Genre and artist filtering works correctly
5. ✅ Hero + Grid layout properly displays 1 hero + 16 albums
6. ✅ Three display styles function correctly
7. ✅ Vinyl spin animation works smoothly
8. ✅ Admin UI allows full music configuration
9. ✅ Performance acceptable with 1,000+ albums
10. ✅ Test coverage ≥ 90%

---

## Next Steps

1. Review and approve this plan
2. Read detailed specs in companion documents:
    - `plex-music-api-spec.md` - API implementation
    - `plex-music-routes.md` - Backend routes
    - `plex-music-admin-ui.md` - Admin interface
    - `plex-music-wallart.md` - Frontend display
3. Start implementation Phase 1 (Config)
4. Iterate through phases sequentially

---

**Document Status:** Complete and ready for implementation
