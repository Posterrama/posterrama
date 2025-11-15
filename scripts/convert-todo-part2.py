#!/usr/bin/env python3
"""Part 2: Cross-mode features & Content management"""

import requests
import sys

GITEA_URL = "https://git.highlanders.cloud"
REPO_OWNER = "Posterrama.app"
REPO_NAME = "posterrama"

def create_issue(token, title, body, labels=None, milestone=None):
    url = f"{GITEA_URL}/api/v1/repos/{REPO_OWNER}/{REPO_NAME}/issues"
    data = {"title": title, "body": body}
    if labels:
        data["labels"] = labels
    if milestone:
        data["milestone"] = milestone
    
    headers = {"Authorization": f"token {token}", "Content-Type": "application/json"}
    
    try:
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 201:
            print(f"✅ Created issue #{response.json().get('number')}: {title}")
        else:
            print(f"❌ Failed: {title}")
    except Exception as e:
        print(f"❌ Exception: {e}")

def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    
    token = sys.argv[1]
    print("📋 Creating part 2: Cross-mode & Content...\n")
    
    # Cross-mode features
    print("Creating Cross-Mode features...")
    
    create_issue(token, "Display: Faster transitions with longer still time",
        """## Priority: HIGH
## Milestone: Sprint 4

### Description
Optimize transition timing: faster slide transitions but longer time displaying each poster.

### Current State
- Transitions feel slow (1-2s)
- Posters don't stay long enough to appreciate

### Proposed Settings
- Transition duration: 0.5s (down from 1-2s)
- Display duration: 8-12s (up from 5-7s)
- User configurable per mode

### Acceptance Criteria
- [ ] Transitions <1s
- [ ] Display time 8-12s default
- [ ] User configurable in settings
- [ ] Smooth 60fps transitions
- [ ] Works on all display modes""", [3, 15, 8], 2)
    
    create_issue(token, "Display: Portrait orientation optimization",
        """## Priority: HIGH
## Milestone: Sprint 4

### Description
Optimize all display modes for portrait orientation (vertical displays/monitors).

### Requirements
- Detect portrait orientation automatically
- Adjust layouts for vertical space
- Poster selection favors portrait aspect ratios
- UI adapts to vertical orientation

### Display Modes to Update
- Wallart: Vertical grid layouts
- Cinema: Portrait-optimized cards
- Screensaver: Vertical poster arrangements

### Acceptance Criteria
- [ ] All modes work beautifully in portrait
- [ ] Automatic orientation detection
- [ ] Portrait posters preferred when vertical
- [ ] No black bars or wasted space
- [ ] Tested on actual vertical displays""", [3, 15, 8], 2)
    
    create_issue(token, "Display: Trailer playback support",
        """## Priority: LOW
## Milestone: v3.0

### Description
Add support for playing movie/show trailers in Cinema mode.

### Requirements
- Fetch trailers from TMDB/Plex
- Video playback integration
- Automatic trailer rotation
- Volume controls with mute option
- Configurable frequency

### User Experience
- Trailers play between static posters
- Optional: Play only in certain time windows
- Configurable: trailer frequency/duration

### Acceptance Criteria
- [ ] Trailer fetching works (TMDB API)
- [ ] Video playback smooth
- [ ] Volume configurable
- [ ] Optional mute mode
- [ ] Graceful fallback if no trailers available""", [1, 15, 10], 3)
    
    create_issue(token, "Display: Motion posters with AI generation",
        """## Priority: LOW
## Milestone: Future
## Labels: needs-discussion

### Description
Generate motion/animated versions of static posters using AI.

### Concept
- Use AI to add subtle motion to posters
- Ken Burns effect (slow zoom/pan)
- Parallax layers for depth
- Subtle particle effects

### Technologies to Explore
- Stable Diffusion animation
- CSS 3D transforms
- Canvas animations
- WebGL effects

### Acceptance Criteria
- [ ] AI motion generation POC
- [ ] Performance acceptable (60fps)
- [ ] Optional feature (can disable)
- [ ] Visually stunning results

### Notes
⚠️ Experimental - requires research and feasibility testing.""", [1, 15, 17, 10], 4)
    
    create_issue(token, "Display: Font/size/color customization",
        """## Priority: LOW
## Milestone: v3.0

### Description
Allow customization of text fonts, sizes, and colors across display modes.

### Customization Options
- Font family selection
- Font size scaling
- Text color/opacity
- Background overlays
- Shadow/outline effects

### Per-Mode Settings
- Cinema: Title/metadata styling
- Wallart: Optional text overlays
- Screensaver: Clock/date styling

### Acceptance Criteria
- [ ] Font selection (system + web fonts)
- [ ] Size/color pickers in admin
- [ ] Live preview of changes
- [ ] Per-device customization
- [ ] Preset themes available""", [1, 11, 10], 3)
    
    create_issue(token, "Display: Artist card with sliding accent animation",
        """## Priority: LOW
## Milestone: v3.0

### Description
Create artist card layout with sliding blue accent and smooth metadata reveal animation.

### Visual Design
- Artist photo/album art
- Sliding colored accent bar (blue)
- Metadata slides in from side
- Smooth easing transitions

### Use Cases
- Music mode artist displays
- Wallart music library
- Album slideshow mode

### Acceptance Criteria
- [ ] Artist card component created
- [ ] Sliding accent animation smooth
- [ ] Metadata reveal timing perfect
- [ ] Works with music libraries
- [ ] Configurable accent color""", [1, 11, 10], 3)
    
    # Content & Media
    print("\nCreating Content & Media issues...")
    
    create_issue(token, "Content: Per-device media source selection",
        """## Priority: HIGH
## Milestone: Sprint 4

### Description
Allow each device to select which media sources to use (Plex/Jellyfin/TMDB/RomM/Local).

### Current Limitation
- All devices use same global sources
- No per-device customization possible

### Requirements
- Device settings: source selection checkboxes
- Support multiple sources per device
- Fallback to global config if not set
- Source priority ordering

### Implementation
- Add `sources: []` array to device config
- Merge device sources with global sources
- Update `/get-config` endpoint logic
- Admin UI for source selection per device

### Acceptance Criteria
- [ ] Device can select which sources to use
- [ ] Multiple sources supported per device
- [ ] Source priority configurable
- [ ] Backwards compatible (defaults to global)
- [ ] Works with all source types""", [1, 13, 8], 2)
    
    create_issue(token, "Content: Per-device custom image uploads",
        """## Priority: MEDIUM
## Milestone: Sprint 4

### Description
Allow uploading custom images specific to individual devices.

### Requirements
- Upload interface in device settings
- Store device-specific images separately
- Include in device's playlist only
- Manage/delete uploaded images

### Use Cases
- Family photos on living room display
- Art gallery on bedroom display
- Company logos on office displays
- Custom backgrounds per location

### Acceptance Criteria
- [ ] Upload images per device via admin
- [ ] Images appear in device playlist only
- [ ] Delete/manage device-specific images
- [ ] No cross-device contamination
- [ ] Image metadata tracking (uploaded by, date)""", [1, 13, 9], 2)
    
    create_issue(token, "Content: Custom source plugin system",
        """## Priority: LOW
## Milestone: v3.0

### Description
Create plugin system for adding custom content sources beyond built-in ones.

### Requirements
- Plugin API specification
- Plugin discovery/loading
- Source adapter interface
- Configuration schema
- Documentation

### Plugin Capabilities
- Fetch media items
- Provide metadata
- Image URL resolution
- Custom filtering

### Example Plugins
- Instagram feed
- Flickr galleries
- NASA image of the day
- Custom API endpoints

### Acceptance Criteria
- [ ] Plugin API documented
- [ ] Example plugin created
- [ ] Plugin loading system works
- [ ] Plugins configurable in admin
- [ ] Error handling for bad plugins""", [1, 12, 13, 10], 3)
    
    create_issue(token, "Content: Emby media server integration",
        """## Priority: LOW
## Milestone: v3.0

### Description
Add Emby as supported media server (alongside Plex & Jellyfin).

### Requirements
- Emby API client
- Authentication handling
- Media fetching
- Image proxy support
- Library browsing

### Implementation
- Create `sources/emby.js`
- Emby HTTP client in `utils/`
- Configuration schema
- Admin UI for Emby setup
- Tests for Emby integration

### Acceptance Criteria
- [ ] Emby connection works
- [ ] Media items fetch correctly
- [ ] Images display properly
- [ ] All display modes support Emby
- [ ] Documented in setup guide""", [1, 13, 10], 3)
    
    print("\n✅ Part 2 complete!")

if __name__ == "__main__":
    main()
