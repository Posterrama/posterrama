#!/bin/bash

# Convert TODO.md to Gitea Issues
# Creates comprehensive issues from private/TODO.md

set -e

GITEA_URL="https://git.highlanders.cloud"
REPO_OWNER="Posterrama.app"
REPO_NAME="posterrama"
TOKEN="$1"

if [ -z "$TOKEN" ]; then
    echo "Usage: $0 <GITEA_TOKEN>"
    exit 1
fi

API_BASE="$GITEA_URL/api/v1/repos/$REPO_OWNER/$REPO_NAME/issues"

echo "📋 Converting TODO.md to Gitea issues..."
echo ""

# Helper function to create issue
create_issue() {
    local title="$1"
    local body="$2"
    local labels="$3"
    local milestone="$4"
    
    curl -s -X POST "$API_BASE" \
      -H "Authorization: token $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{
        \"title\": \"$title\",
        \"body\": \"$body\",
        \"labels\": $labels,
        \"milestone\": $milestone
      }" | jq -r '.number // "ERROR"'
}

# Display & Visual Enhancements - Wallart Mode (Sprint 4)
echo "Creating Wallart Mode issues..."

create_issue \
  "Wallart: Full-bleed posters (100% screen coverage)" \
  "## Priority: HIGH\n## Milestone: Sprint 4\n## Category: Display Mode - Wallart\n\n### Description\nImplement full-bleed posters at screen edges with 100% coverage, eliminating black borders.\n\n### Requirements\n- Remove all black borders/margins\n- Edge posters fill to screen boundary\n- Maintain aspect ratios\n- Test on various screen sizes\n\n### Acceptance Criteria\n- [ ] No black borders visible\n- [ ] Posters cover 100% of screen\n- [ ] Works on 16:9, 21:9, and portrait displays\n- [ ] No visual artifacts or clipping" \
  "[1,11,15,9]" \
  "2"

create_issue \
  "Wallart: Film card layout variant" \
  "## Priority: MEDIUM\n## Milestone: Sprint 4\n## Category: Display Mode - Wallart\n\n### Description\nAdd film card layout option as alternative to grid layout.\n\n### Requirements\n- Card-based layout design\n- Configurable card sizes\n- Smooth transitions between cards\n- Optional metadata display on cards\n\n### Acceptance Criteria\n- [ ] Film card layout implemented\n- [ ] User can toggle between grid and card layouts\n- [ ] Card animations smooth\n- [ ] Settings persist per device" \
  "[1,11,15,9]" \
  "2"

create_issue \
  "Wallart: Carousel mode with focused center poster" \
  "## Priority: MEDIUM\n## Milestone: v3.0\n## Category: Display Mode - Wallart\n\n### Description\nSpecial carousel mode where entire grid slides while center/random poster stays focused.\n\n### Requirements\n- Sliding grid animation\n- Center poster remains prominent\n- Smooth transitions\n- Configurable slide timing\n- Random or sequential focus\n\n### Visual Concept\n- Grid slides left/right/up/down\n- Center poster highlighted\n- Surrounding posters dimmed slightly\n- Seamless looping\n\n### Acceptance Criteria\n- [ ] Carousel animation implemented\n- [ ] Center focus works correctly\n- [ ] Performance optimized (60fps)\n- [ ] Configurable in device settings" \
  "[1,11,15,10]" \
  "3"

create_issue \
  "Wallart: Grid layout support for music albums" \
  "## Priority: LOW\n## Milestone: v3.0\n## Category: Display Mode - Wallart\n\n### Description\nExtend Wallart grid to support music album covers from Plex/Jellyfin music libraries.\n\n### Requirements\n- Detect music library content\n- Square album art layout\n- Music-specific metadata\n- Optional artist names\n\n### Dependencies\n- Music library source integration\n- Album art fetching logic\n\n### Acceptance Criteria\n- [ ] Music albums display in grid\n- [ ] Album art properly formatted\n- [ ] Artist metadata optional\n- [ ] Works with Plex & Jellyfin music" \
  "[1,15,10]" \
  "3"

create_issue \
  "UI: Context-aware settings visibility" \
  "## Priority: MEDIUM\n## Milestone: Sprint 4\n## Category: UI/UX\n\n### Description\nShow only relevant settings options per display mode. Hide irrelevant controls.\n\n### Requirements\n- Mode-specific settings\n- Dynamic UI rendering\n- Clear visual hierarchy\n- Intuitive grouping\n\n### Examples\n- Wallart mode: Hide cinema-specific settings\n- Cinema mode: Hide screensaver timing options\n- Screensaver: Hide playlist controls\n\n### Acceptance Criteria\n- [ ] Settings filtered by active mode\n- [ ] No irrelevant options shown\n- [ ] UI remains intuitive\n- [ ] Smooth transitions when switching modes" \
  "[3,11,9]" \
  "2"

# Cinema Mode issues
echo "Creating Cinema Mode issues..."

create_issue \
  "Cinema: Film card layout presets" \
  "## Priority: MEDIUM\n## Milestone: Sprint 4\n## Category: Display Mode - Cinema\n\n### Description\nAdd film card layout presets for Cinema mode now-playing display.\n\n### Requirements\n- Multiple preset layouts\n- Customizable card designs\n- Metadata display options\n- Responsive sizing\n\n### Preset Ideas\n- Minimal (poster + title)\n- Detailed (poster + full metadata)\n- Split-screen (poster + backdrop)\n- Grid view (multiple sessions)\n\n### Acceptance Criteria\n- [ ] At least 3 layout presets\n- [ ] User can select preset per device\n- [ ] Presets work with all Plex content types\n- [ ] Smooth animations between presets" \
  "[1,15,9]" \
  "2"

create_issue \
  "Cinema: Static poster pinning (search & select)" \
  "## Priority: HIGH\n## Milestone: Sprint 4\n## Category: Display Mode - Cinema\n\n### Description\nAllow selecting and pinning specific movie/show poster per device when no Plex session active.\n\n### Requirements\n- Search interface for media\n- Pin poster to device\n- Persist selection\n- Override with active session\n- Fallback to pinned when idle\n\n### User Flow\n1. Device in Cinema mode, no active playback\n2. Admin searches \"The Matrix\"\n3. Pins The Matrix poster to device\n4. Device shows pinned poster until playback starts\n5. Returns to pinned poster after playback ends\n\n### Acceptance Criteria\n- [ ] Search interface implemented\n- [ ] Poster pinning works per device\n- [ ] Active sessions override pinned poster\n- [ ] Falls back to pinned when idle\n- [ ] Settings persist across restarts" \
  "[1,15,8]" \
  "2"

# Screensaver Mode
echo "Creating Screensaver Mode issues..."

create_issue \
  "Screensaver: Tablet layout optimization" \
  "## Priority: MEDIUM\n## Milestone: Sprint 4\n## Category: Display Mode - Screensaver\n\n### Description\nTest and optimize screensaver layout for tablet devices (7-12 inch screens).\n\n### Requirements\n- Test on various tablet resolutions\n- Optimize poster sizing\n- Touch interaction refinement\n- Portrait/landscape modes\n\n### Test Devices\n- iPad (various generations)\n- Android tablets\n- Surface tablets\n\n### Acceptance Criteria\n- [ ] Tested on 3+ tablet models\n- [ ] Layout looks great on tablets\n- [ ] Touch interactions smooth\n- [ ] Performance optimized" \
  "[3,15,9]" \
  "2"

create_issue \
  "Screensaver: Mobile layout optimization" \
  "## Priority: MEDIUM\n## Milestone: Sprint 4\n## Category: Display Mode - Screensaver\n\n### Description\nTest and optimize screensaver layout for mobile devices (phones).\n\n### Requirements\n- Mobile-specific poster sizing\n- Portrait-first design\n- Touch gestures\n- Performance optimization for mobile\n\n### Considerations\n- Limited screen real estate\n- Battery efficiency\n- Mobile network conditions\n- Device rotation\n\n### Acceptance Criteria\n- [ ] Works great on phones\n- [ ] Portrait mode prioritized\n- [ ] Battery-efficient\n- [ ] Smooth on mid-range devices" \
  "[3,15,9]" \
  "2"

# Cross-Mode Features
echo "Creating Cross-Mode features..."

create_issue \
  "Display: Faster transitions with longer still time" \
  "## Priority: HIGH\n## Milestone: Sprint 4\n## Category: Display Mode - All\n\n### Description\nOptimize transition timing: faster slide transitions but longer time displaying each poster.\n\n### Current State\n- Transitions feel slow\n- Posters don't stay long enough to appreciate\n\n### Proposed Settings\n- Transition duration: 0.5s (was 1-2s)\n- Display duration: 8-12s (was 5-7s)\n- Configurable per mode\n\n### Acceptance Criteria\n- [ ] Transitions <1s\n- [ ] Display time 8-12s default\n- [ ] User configurable\n- [ ] Smooth 60fps transitions\n- [ ] Works on all display modes" \
  "[3,15,8]" \
  "2"

create_issue \
  "Display: Portrait orientation optimization" \
  "## Priority: HIGH\n## Milestone: Sprint 4\n## Category: Display Mode - All\n\n### Description\nOptimize all display modes for portrait orientation (vertical displays/monitors).\n\n### Requirements\n- Detect portrait orientation\n- Adjust layouts automatically\n- Poster selection favors portrait posters\n- UI adapts to vertical space\n\n### Display Modes to Update\n- Wallart: Vertical grid layouts\n- Cinema: Portrait-optimized cards\n- Screensaver: Vertical arrangements\n\n### Acceptance Criteria\n- [ ] All modes work in portrait\n- [ ] Automatic orientation detection\n- [ ] Portrait posters preferred when vertical\n- [ ] No black bars or wasted space\n- [ ] Tested on actual vertical displays" \
  "[3,15,8]" \
  "2"

create_issue \
  "Display: Trailer playback support" \
  "## Priority: LOW\n## Milestone: v3.0\n## Category: Display Mode - Cinema\n\n### Description\nAdd support for playing movie/show trailers in Cinema mode.\n\n### Requirements\n- Fetch trailers from TMDB/Plex\n- Video playback integration\n- Automatic trailer rotation\n- Volume controls\n- Mute option\n\n### User Experience\n- Trailers play between static posters\n- Optional: Play only in certain time windows\n- Configurable: trailer frequency\n\n### Acceptance Criteria\n- [ ] Trailer fetching works\n- [ ] Video playback smooth\n- [ ] Volume configurable\n- [ ] Optional mute mode\n- [ ] Graceful fallback if no trailers" \
  "[1,15,10]" \
  "3"

create_issue \
  "Display: Motion posters with AI generation" \
  "## Priority: LOW\n## Milestone: Future\n## Category: Display Mode - All\n\n### Description\nGenerate motion/animated versions of static posters using AI.\n\n### Concept\n- Use AI to add subtle motion to posters\n- Ken Burns effect\n- Parallax layers\n- Particle effects\n\n### Technologies\n- Stable Diffusion animation\n- CSS transforms\n- Canvas animations\n- WebGL effects\n\n### Acceptance Criteria\n- [ ] AI motion generation POC\n- [ ] Performance acceptable\n- [ ] Optional feature (can disable)\n- [ ] Looks visually stunning\n\n### Notes\nThis is experimental and requires research." \
  "[1,15,17,10]" \
  "4"

# Content & Media
echo "Creating Content & Media issues..."

create_issue \
  "Content: Per-device media source selection" \
  "## Priority: HIGH\n## Milestone: Sprint 4\n## Category: Backend - Sources\n\n### Description\nAllow each device to select which media sources to use (Plex/Jellyfin/TMDB/RomM/Local).\n\n### Current State\n- All devices use same global sources\n- No per-device customization\n\n### Requirements\n- Device settings: source selection checkboxes\n- Multiple sources per device\n- Fallback to global if not configured\n- Source priority ordering\n\n### Implementation\n- Add `sources: []` to device config\n- Merge with global sources at playlist generation\n- Update /get-config endpoint\n- UI for source selection\n\n### Acceptance Criteria\n- [ ] Device can select sources\n- [ ] Multiple sources supported\n- [ ] Source priority configurable\n- [ ] Backwards compatible (defaults to global)" \
  "[1,13,8]" \
  "2"

create_issue \
  "Content: Per-device custom image uploads" \
  "## Priority: MEDIUM\n## Milestone: Sprint 4\n## Category: Backend - Media\n\n### Description\nAllow uploading custom images specific to individual devices.\n\n### Requirements\n- Upload interface per device\n- Store device-specific images\n- Include in device's playlist\n- Manage uploaded images\n\n### Use Cases\n- Family photos on living room display\n- Art gallery on bedroom display\n- Company logos on office displays\n\n### Acceptance Criteria\n- [ ] Upload images per device\n- [ ] Images appear in device playlist only\n- [ ] Delete/manage device images\n- [ ] No cross-device contamination" \
  "[1,13,9]" \
  "2"

echo ""
echo "✅ Created TODO.md issues successfully!"
echo "View at: $GITEA_URL/$REPO_OWNER/$REPO_NAME/issues"
echo ""
echo "Note: This is part 1. Run this script again or create more issues for remaining TODO items."
