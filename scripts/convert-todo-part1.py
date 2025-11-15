#!/usr/bin/env python3
"""
Convert TODO.md to Gitea Issues
Properly handles JSON escaping and creates comprehensive issues
"""

import requests
import json
import sys

GITEA_URL = "https://git.highlanders.cloud"
REPO_OWNER = "Posterrama.app"
REPO_NAME = "posterrama"

def create_issue(token, title, body, labels=None, milestone=None):
    """Create a Gitea issue"""
    url = f"{GITEA_URL}/api/v1/repos/{REPO_OWNER}/{REPO_NAME}/issues"
    
    data = {
        "title": title,
        "body": body
    }
    
    if labels:
        data["labels"] = labels
    if milestone:
        data["milestone"] = milestone
    
    headers = {
        "Authorization": f"token {token}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 201:
            issue_num = response.json().get('number')
            print(f"✅ Created issue #{issue_num}: {title}")
            return issue_num
        else:
            print(f"❌ Failed to create '{title}': {response.status_code}")
            print(f"   Response: {response.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Exception creating '{title}': {e}")
        return None

def main():
    if len(sys.argv) < 2:
        print("Usage: ./convert-todo-to-issues.py <GITEA_TOKEN>")
        sys.exit(1)
    
    token = sys.argv[1]
    
    print("📋 Converting TODO.md to Gitea issues...\n")
    
    # Wallart Mode issues
    print("Creating Wallart Mode issues...")
    
    create_issue(token,
        "Wallart: Full-bleed posters (100% screen coverage)",
        """## Priority: HIGH
## Milestone: Sprint 4
## Category: Display Mode - Wallart

### Description
Implement full-bleed posters at screen edges with 100% coverage, eliminating black borders.

### Requirements
- Remove all black borders/margins
- Edge posters fill to screen boundary
- Maintain aspect ratios
- Test on various screen sizes

### Acceptance Criteria
- [ ] No black borders visible
- [ ] Posters cover 100% of screen
- [ ] Works on 16:9, 21:9, and portrait displays
- [ ] No visual artifacts or clipping""",
        [1, 11, 15, 9], 2)
    
    create_issue(token,
        "Wallart: Film card layout variant",
        """## Priority: MEDIUM
## Milestone: Sprint 4
## Category: Display Mode - Wallart

### Description
Add film card layout option as alternative to grid layout.

### Requirements
- Card-based layout design
- Configurable card sizes
- Smooth transitions between cards
- Optional metadata display on cards

### Acceptance Criteria
- [ ] Film card layout implemented
- [ ] User can toggle between grid and card layouts
- [ ] Card animations smooth
- [ ] Settings persist per device""",
        [1, 11, 15, 9], 2)
    
    create_issue(token,
        "Wallart: Carousel mode with focused center poster",
        """## Priority: MEDIUM
## Milestone: v3.0
## Category: Display Mode - Wallart

### Description
Special carousel mode where entire grid slides while center/random poster stays focused.

### Requirements
- Sliding grid animation
- Center poster remains prominent
- Smooth transitions
- Configurable slide timing
- Random or sequential focus

### Visual Concept
- Grid slides left/right/up/down
- Center poster highlighted
- Surrounding posters dimmed slightly
- Seamless looping

### Acceptance Criteria
- [ ] Carousel animation implemented
- [ ] Center focus works correctly
- [ ] Performance optimized (60fps)
- [ ] Configurable in device settings""",
        [1, 11, 15, 10], 3)
    
    create_issue(token,
        "Wallart: Grid layout support for music albums",
        """## Priority: LOW
## Milestone: v3.0
## Category: Display Mode - Wallart

### Description
Extend Wallart grid to support music album covers from Plex/Jellyfin music libraries.

### Requirements
- Detect music library content
- Square album art layout
- Music-specific metadata
- Optional artist names

### Dependencies
- Music library source integration
- Album art fetching logic

### Acceptance Criteria
- [ ] Music albums display in grid
- [ ] Album art properly formatted
- [ ] Artist metadata optional
- [ ] Works with Plex & Jellyfin music""",
        [1, 15, 10], 3)
    
    create_issue(token,
        "UI: Context-aware settings visibility",
        """## Priority: MEDIUM
## Milestone: Sprint 4
## Category: UI/UX

### Description
Show only relevant settings options per display mode. Hide irrelevant controls.

### Requirements
- Mode-specific settings
- Dynamic UI rendering
- Clear visual hierarchy
- Intuitive grouping

### Examples
- Wallart mode: Hide cinema-specific settings
- Cinema mode: Hide screensaver timing options
- Screensaver: Hide playlist controls

### Acceptance Criteria
- [ ] Settings filtered by active mode
- [ ] No irrelevant options shown
- [ ] UI remains intuitive
- [ ] Smooth transitions when switching modes""",
        [3, 11, 9], 2)
    
    # Cinema Mode
    print("\nCreating Cinema Mode issues...")
    
    create_issue(token,
        "Cinema: Film card layout presets",
        """## Priority: MEDIUM
## Milestone: Sprint 4
## Category: Display Mode - Cinema

### Description
Add film card layout presets for Cinema mode now-playing display.

### Requirements
- Multiple preset layouts
- Customizable card designs
- Metadata display options
- Responsive sizing

### Preset Ideas
- Minimal (poster + title)
- Detailed (poster + full metadata)
- Split-screen (poster + backdrop)
- Grid view (multiple sessions)

### Acceptance Criteria
- [ ] At least 3 layout presets
- [ ] User can select preset per device
- [ ] Presets work with all Plex content types
- [ ] Smooth animations between presets""",
        [1, 15, 9], 2)
    
    create_issue(token,
        "Cinema: Static poster pinning (search & select)",
        """## Priority: HIGH
## Milestone: Sprint 4
## Category: Display Mode - Cinema

### Description
Allow selecting and pinning specific movie/show poster per device when no Plex session active.

### Requirements
- Search interface for media
- Pin poster to device
- Persist selection
- Override with active session
- Fallback to pinned when idle

### User Flow
1. Device in Cinema mode, no active playback
2. Admin searches "The Matrix"
3. Pins The Matrix poster to device
4. Device shows pinned poster until playback starts
5. Returns to pinned poster after playback ends

### Acceptance Criteria
- [ ] Search interface implemented
- [ ] Poster pinning works per device
- [ ] Active sessions override pinned poster
- [ ] Falls back to pinned when idle
- [ ] Settings persist across restarts""",
        [1, 15, 8], 2)
    
    # Screensaver Mode
    print("\nCreating Screensaver Mode issues...")
    
    create_issue(token,
        "Screensaver: Tablet layout optimization",
        """## Priority: MEDIUM
## Milestone: Sprint 4
## Category: Display Mode - Screensaver

### Description
Test and optimize screensaver layout for tablet devices (7-12 inch screens).

### Requirements
- Test on various tablet resolutions
- Optimize poster sizing
- Touch interaction refinement
- Portrait/landscape modes

### Test Devices
- iPad (various generations)
- Android tablets
- Surface tablets

### Acceptance Criteria
- [ ] Tested on 3+ tablet models
- [ ] Layout looks great on tablets
- [ ] Touch interactions smooth
- [ ] Performance optimized""",
        [3, 15, 9], 2)
    
    create_issue(token,
        "Screensaver: Mobile layout optimization",
        """## Priority: MEDIUM
## Milestone: Sprint 4
## Category: Display Mode - Screensaver

### Description
Test and optimize screensaver layout for mobile devices (phones).

### Requirements
- Mobile-specific poster sizing
- Portrait-first design
- Touch gestures
- Performance optimization for mobile

### Considerations
- Limited screen real estate
- Battery efficiency
- Mobile network conditions
- Device rotation

### Acceptance Criteria
- [ ] Works great on phones
- [ ] Portrait mode prioritized
- [ ] Battery-efficient
- [ ] Smooth on mid-range devices""",
        [3, 15, 9], 2)
    
    print("\n✅ TODO.md conversion complete!")
    print(f"View at: {GITEA_URL}/{REPO_OWNER}/{REPO_NAME}/issues")

if __name__ == "__main__":
    main()
