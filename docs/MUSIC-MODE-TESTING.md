# Music Mode Manual Testing Checklist

## Prerequisites

- [ ] Plex Media Server running and accessible
- [ ] Music library configured in Plex with album art
- [ ] Posterrama instance running (development or production)
- [ ] Admin access credentials

## Phase 1: Configuration

### Step 1: Admin UI Configuration

1. [ ] Navigate to admin interface (http://localhost:4000/admin.html)
2. [ ] Log in with admin credentials
3. [ ] Scroll to "Music Mode" card
4. [ ] Enable music mode toggle
5. [ ] Verify card expands to show configuration options

### Step 2: Plex Server Configuration

1. [ ] In "Media Servers" section, ensure Plex is enabled
2. [ ] Verify Plex server URL is correct (e.g., http://localhost:32400)
3. [ ] Verify Plex token is set
4. [ ] Click "Test Connection" if available
5. [ ] Note any connection errors in console

### Step 3: Music Library Selection

1. [ ] In Music Mode card, click "Refresh Libraries" button
2. [ ] Verify music libraries appear in dropdown
3. [ ] Select desired music library (e.g., "Music")
4. [ ] Verify library is selected

### Step 4: Display Settings

1. [ ] Set display style (albumCover / artistPhoto / mixed)
2. [ ] Set animation type (fade / slide / zoom / none)
3. [ ] Set grid size (2×2 / 3×3 / 4×4 / 5×5)
4. [ ] Set layout (grid / carousel / masonry)

### Step 5: Metadata Visibility

1. [ ] Check/uncheck "Show Artist Name"
2. [ ] Check/uncheck "Show Album Title"
3. [ ] Check/uncheck "Show Release Year"
4. [ ] Check/uncheck "Show Genre"
5. [ ] Note: At least one should be enabled to see overlays

### Step 6: Filtering (Optional)

1. [ ] Click "Load Genres" button
2. [ ] Verify genre list appears with counts
3. [ ] Select desired genres (e.g., Rock, Jazz)
4. [ ] Click "Load Artists" button
5. [ ] Verify artist list appears
6. [ ] Select desired artists (if any)
7. [ ] Set minimum rating (0-10, e.g., 7.0)

### Step 7: Save Configuration

1. [ ] Scroll to top of admin page
2. [ ] Click "Save Configuration" button
3. [ ] Verify success message appears
4. [ ] Check browser console for any errors

## Phase 2: Backend Verification

### Step 8: API Endpoint Testing

1. [ ] Open browser developer tools (F12)
2. [ ] Go to Network tab
3. [ ] Navigate to http://localhost:4000/get-media?musicMode=1&count=20
4. [ ] Verify response status is 200 OK
5. [ ] Verify response contains JSON array of albums
6. [ ] Verify each album has:
    - [ ] `id` property
    - [ ] `type: "music"`
    - [ ] `title` property
    - [ ] `artist` property
    - [ ] `posterUrl` property
    - [ ] `year` property (if available)
    - [ ] `genre` property (if available)

### Step 9: Filter Verification

1. [ ] Check if genres match selected filters
2. [ ] Check if artists match selected filters
3. [ ] Check if ratings are >= minimum rating
4. [ ] Note any albums that don't match filters

## Phase 3: Wallart Display Testing

### Step 10: Basic Display

1. [ ] Navigate to http://localhost:4000/wallart.html
2. [ ] Wait for display to load
3. [ ] Verify album covers appear in grid
4. [ ] Verify covers are **square** (not stretched portrait like movies)
5. [ ] Verify no console errors

### Step 11: Metadata Overlay Testing

1. [ ] Look at each album tile
2. [ ] Verify gradient overlay appears at bottom
3. [ ] Verify configured metadata fields are visible:
    - [ ] Artist name (if enabled)
    - [ ] Album title (if enabled)
    - [ ] Release year (if enabled)
    - [ ] Genre (if enabled)
4. [ ] Verify text is readable over album art
5. [ ] Verify no overlays appear if all visibility options disabled

### Step 12: Animation Testing

1. [ ] Wait for automatic transitions
2. [ ] Verify animation type matches config (fade/slide/zoom)
3. [ ] Verify transitions are smooth
4. [ ] Verify no flickering or visual glitches

### Step 13: Grid Layout Testing

1. [ ] Go back to admin, change grid size to 2×2
2. [ ] Save and reload wallart display
3. [ ] Verify 2×2 grid (4 albums visible)
4. [ ] Repeat for 3×3, 4×4, 5×5
5. [ ] Verify layouts adjust correctly

### Step 14: Edge Cases

1. [ ] Test with album missing cover art
    - [ ] Verify placeholder or fallback appears
2. [ ] Test with album missing artist
    - [ ] Verify no artist name shows (or "Unknown Artist")
3. [ ] Test with album missing genre
    - [ ] Verify genre field doesn't appear in overlay
4. [ ] Test with very long album/artist names
    - [ ] Verify text doesn't overflow or break layout

## Phase 4: Compatibility Testing

### Step 15: Browser Testing

Test on multiple browsers:

- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari (macOS/iOS)
- [ ] Edge

For each browser:

- [ ] Verify album covers load
- [ ] Verify overlays render correctly
- [ ] Verify animations work
- [ ] Check console for errors

### Step 16: Device Testing

- [ ] Desktop (1920×1080)
- [ ] Laptop (1366×768)
- [ ] Tablet landscape (1024×768)
- [ ] Tablet portrait (768×1024)
- [ ] Phone landscape (if applicable)

### Step 17: Performance Testing

1. [ ] Load wallart with 500+ albums configured
2. [ ] Monitor browser memory usage
3. [ ] Verify smooth transitions
4. [ ] Check for memory leaks (leave running 30+ minutes)
5. [ ] Verify no crashes or freezing

## Phase 5: Fallback Testing

### Step 18: Disabled Music Mode

1. [ ] In admin, disable music mode
2. [ ] Save configuration
3. [ ] Reload wallart display
4. [ ] Verify regular movie/show posters appear
5. [ ] Verify no music albums show

### Step 19: Missing Configuration

1. [ ] Remove music library selection
2. [ ] Save configuration
3. [ ] Reload wallart display
4. [ ] Verify fallback to regular media
5. [ ] Check console for graceful error messages

### Step 20: Network Error Simulation

1. [ ] Stop Plex Media Server
2. [ ] Reload wallart display
3. [ ] Verify graceful fallback (no crash)
4. [ ] Verify error logged to console
5. [ ] Restart Plex and verify recovery

## Phase 6: Integration Testing

### Step 21: Mode Switching

1. [ ] Enable music mode, verify wallart shows albums
2. [ ] Disable music mode, verify wallart shows movies
3. [ ] Re-enable music mode, verify albums return
4. [ ] Verify no caching issues between modes

### Step 22: Games Only Mode Conflict

1. [ ] Enable music mode
2. [ ] Try to enable games only mode
3. [ ] Verify mutual exclusivity (one disables the other)
4. [ ] Verify wallart respects active mode

### Step 23: Concurrent Clients

1. [ ] Open wallart display in multiple browser tabs
2. [ ] Verify each loads albums independently
3. [ ] Verify no interference between clients

## Checklist Summary

**Configuration**: ☐ Steps 1-7
**Backend**: ☐ Steps 8-9
**Display**: ☐ Steps 10-14
**Compatibility**: ☐ Steps 15-17
**Fallbacks**: ☐ Steps 18-20
**Integration**: ☐ Steps 21-23

## Common Issues & Solutions

| Issue                    | Solution                                                   |
| ------------------------ | ---------------------------------------------------------- |
| No albums appear         | Check Plex server connection, verify music library exists  |
| Album covers stretched   | Verify `type: "music"` in API response                     |
| No metadata overlays     | Enable at least one visibility option in config            |
| Animations stuttering    | Check browser performance, reduce grid size                |
| Network errors           | Verify Plex server URL and token are correct               |
| Empty genre/artist lists | Click "Load Genres/Artists" button after selecting library |

## Notes

- All checkboxes should be ☑ for complete testing
- Document any issues found with screenshots
- Test on target deployment environment before production
