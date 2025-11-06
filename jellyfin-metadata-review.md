# Jellyfin Metadata Analysis - Missing Fields Review

## Current Extraction Status (lib/jellyfin-helpers.js)

### ✅ Already Extracted (Phase 1-6):

- **Basic Info**: Name, OriginalTitle, SortName, ProductionYear, Overview, Taglines
- **IDs**: Id, ProviderIds (IMDB, TMDB, TVDB, TvRage)
- **Ratings**: CommunityRating, OfficialRating, CriticRating, UserData.Rating
- **Images**: All ImageTags (Primary, Backdrop, Logo, Banner, Thumb, Disc), BackdropImageTags array
- **People**: People array (Actors, Directors, Writers, Producers) with thumbnails
- **Technical**: MediaSources, MediaStreams, audio/video/subtitle tracks
- **Quality**: Video resolution, HDR detection, Dolby Vision, 3D, codecs
- **Files**: Path, Size, Container, Bitrate, streaming support flags
- **User Data**: PlayCount, LastPlayedDate, Rating
- **Dates**: DateCreated, DateLastSaved, PremiereDate, RunTimeTicks
- **Collections**: Studios, ProductionLocations, Genres

### ❓ Potentially Missing Fields (Need Verification):

#### 1. **Ratings & Reviews**

- `CriticRatingSummary` - Text summary of critic reviews
- `AwardSummary` - Award information
- `Metascore` - Metacritic score (may be in ProviderIds)

#### 2. **Hierarchy & Series Info** (for TV Shows/Seasons/Episodes)

- `SeriesId` - Parent series ID
- `SeriesName` - Parent series name
- `SeasonId` - Parent season ID
- `SeasonName` - Parent season name
- `IndexNumber` - Episode/season number
- `ParentIndexNumber` - Season number (for episodes)
- `AbsoluteEpisodeNumber` - Absolute episode count across all seasons
- `AirsBeforeSeasonNumber`, `AirsAfterSeasonNumber`, `AirsBeforeEpisodeNumber`

#### 3. **Advanced Image Types**

- `ImageTags.Art` - Widescreen art
- `ImageTags.Box` - Box set art
- `ImageTags.BoxRear` - Box rear art
- `ImageTags.Screenshot` - Screenshot images
- `ImageTags.Menu` - Menu image
- `ParentLogoImageTag` - Parent logo
- `ParentBackdropImageTags` - Parent backdrop
- `ParentArtImageTag` - Parent art
- `SeriesPrimaryImageTag` - Series primary image

#### 4. **Playback & Progress**

- `UserData.PlaybackPositionTicks` - Resume position (viewOffset equivalent)
- `UserData.PlayedPercentage` - Percentage watched
- `UserData.UnplayedItemCount` - Unwatched items in series/collection
- `UserData.IsFavorite` - User favorite flag
- `UserData.Likes` - User like/dislike
- `UserData.Key` - User data key

#### 5. **Content Metadata**

- `CustomRating` - Custom rating field
- `TotalBitrate` - Total bitrate
- `IsHD` - HD flag
- `IsFolder` - Folder/collection flag
- `ParentId` - Parent item ID
- `Path` - File system path (partially extracted in MediaSources)
- `LockedFields` - Fields locked from editing
- `LockData` - Whether metadata is locked
- `Width`, `Height` - Direct video dimensions

#### 6. **Collections & Relationships**

- `CollectionType` - Type of collection
- `AlbumArtist`, `AlbumArtists` - For music (if supporting music later)
- `Artists` - Artists array (music)
- `SeriesStudio` - Studio for series

#### 7. **Advanced Technical**

- `Container` - Already partially extracted
- `IsInterlaced` - Interlaced video flag
- `SupportsExternalStream` - External stream support
- `DefaultAudioStreamIndex` - Default audio track
- `DefaultSubtitleStreamIndex` - Default subtitle track
- `HasSubtitles` - Boolean subtitle flag
- `PreferredMetadataLanguage` - Metadata language
- `PreferredMetadataCountryCode` - Metadata country

#### 8. **Chapter & Marker Data**

- `Chapters` - Chapter markers (already extracted in Phase 3 for Plex)
- `HasChapters` - Boolean chapter flag

#### 9. **Extras & Special Features**

- Already handled via `HasSpecialFeatures` + API call
- Could add: `SpecialFeatureCount`, `LocalTrailerCount`

#### 10. **Network & Availability**

- `AirTime` - Original air time
- `AirDays` - Days of week aired
- `Status` - Series status (Continuing, Ended)
- `EndDate` - Series end date

## Comparison with Plex Fields Added

### Plex Fields Added (Phase 7) - Jellyfin Equivalents:

| Plex Field             | Jellyfin Equivalent                  | Currently Extracted? |
| ---------------------- | ------------------------------------ | -------------------- |
| `ratingImage`          | No direct equivalent                 | N/A                  |
| `audienceRatingImage`  | No direct equivalent                 | N/A                  |
| `ratingCount`          | `CommunityRating` count?             | ❌ No count field    |
| `viewOffset`           | `UserData.PlaybackPositionTicks`     | ❌ Missing           |
| `viewCount`            | `UserData.PlayCount`                 | ✅ Yes               |
| `leafCount`            | `ChildCount` or `RecursiveItemCount` | ❌ Missing           |
| `viewedLeafCount`      | `UserData.UnplayedItemCount` inverse | ❌ Missing           |
| `index`                | `IndexNumber`                        | ❌ Missing           |
| `parentIndex`          | `ParentIndexNumber`                  | ❌ Missing           |
| `absoluteIndex`        | `AbsoluteEpisodeNumber`              | ❌ Missing           |
| `parentKey`            | `ParentId`                           | ❌ Missing           |
| `grandparentKey`       | `SeriesId`                           | ❌ Missing           |
| `parentRatingKey`      | `ParentId`                           | ❌ Missing           |
| `grandparentRatingKey` | `SeriesId`                           | ❌ Missing           |
| `parentTitle`          | `SeasonName`                         | ❌ Missing           |
| `grandparentTitle`     | `SeriesName`                         | ❌ Missing           |
| `parentThumb`          | `ParentPrimaryImageTag`              | ❌ Missing           |
| `grandparentThumb`     | `SeriesPrimaryImageTag`              | ❌ Missing           |
| `grandparentArt`       | `ParentArtImageTag`                  | ❌ Missing           |
| `parentHero`           | No direct equivalent                 | N/A                  |
| `grandparentHero`      | No direct equivalent                 | N/A                  |
| `heroUrl`              | `ImageTags.Art` or screenshot        | ❌ Missing           |
| `compositeUrl`         | Collection composite?                | N/A                  |
| `backgroundSquareUrl`  | `ImageTags.Box` or Art               | ❌ Missing           |
| `skipChildren`         | No equivalent                        | N/A                  |
| `skipParent`           | No equivalent                        | N/A                  |
| `primaryExtraKey`      | Related to extras?                   | N/A                  |
| `chapterSource`        | `HasChapters` flag?                  | ❌ Missing           |
| `reviews`              | `CriticRatingSummary`?               | ❌ Missing           |
| `commonSenseMedia`     | No direct equivalent                 | N/A                  |

## Recommended Additions for Jellyfin (Phase 7):

### High Priority (Direct Equivalents to Plex):

1. ✅ `viewOffset` ← `UserData.PlaybackPositionTicks`
2. ✅ `index` ← `IndexNumber`
3. ✅ `parentIndex` ← `ParentIndexNumber`
4. ✅ `absoluteIndex` ← `AbsoluteEpisodeNumber`
5. ✅ `parentKey` / `parentId` ← `ParentId`
6. ✅ `grandparentKey` / `seriesId` ← `SeriesId`
7. ✅ `parentTitle` / `seasonName` ← `SeasonName`
8. ✅ `grandparentTitle` / `seriesName` ← `SeriesName`
9. ✅ `leafCount` ← `ChildCount` or `RecursiveItemCount`
10. ✅ `viewedLeafCount` ← Calculate from `UserData.UnplayedItemCount`

### Medium Priority (Image URLs):

11. ✅ `heroUrl` / `artUrl` ← `ImageTags.Art`
12. ✅ `boxUrl` / `boxSetUrl` ← `ImageTags.Box`
13. ✅ `screenshotUrl` ← `ImageTags.Screenshot`
14. ✅ `parentThumbUrl` ← `ParentPrimaryImageTag`
15. ✅ `seriesThumbUrl` ← `SeriesPrimaryImageTag`

### Low Priority (Advanced Metadata):

16. ⚪ `criticRatingSummary` ← `CriticRatingSummary`
17. ⚪ `hasChapters` ← `HasChapters`
18. ⚪ `isFavorite` ← `UserData.IsFavorite`
19. ⚪ `isHD` ← `IsHD`
20. ⚪ `status` ← `Status` (for series)
21. ⚪ `airTime` ← `AirTime`
22. ⚪ `lockedFields` ← `LockedFields`

## Implementation Plan:

### Step 1: Add High Priority Fields (Hierarchy & Progress)

These align with the Plex Phase 7 additions and are critical for TV show organization.

### Step 2: Add Medium Priority Fields (Advanced Images)

Complete image coverage similar to Plex hero/composite/square.

### Step 3: Add Low Priority Fields (Metadata Enrichment)

Additional metadata that enhances but isn't critical.

### Step 4: Update Posterpack Metadata

Ensure all new Jellyfin fields are included in posterpack metadata.json generation.

## Testing Strategy:

1. Enable Jellyfin server in config
2. Run list-jellyfin-items.js to find test items
3. Run test-jellyfin-metadata-extraction.js for validation
4. Compare field coverage with Plex extraction
5. Verify posterpack includes all fields
