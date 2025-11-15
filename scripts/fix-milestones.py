#!/usr/bin/env python3
"""
Fix Posterrama milestones and issue assignments
1. Delete wrong Sprint 4 milestone (conflicts with backend-analysis Sprint 4)
2. Create version-based milestones (v2.9.5, v2.9.6, v2.9.7, v3.0.0)
3. Update all issues with correct milestones based on complexity
4. Add labels to issues #1-#7
"""

import requests
import sys

GITEA_URL = "https://git.highlanders.cloud"
REPO = "Posterrama.app/posterrama"
TOKEN = "059bdfe35a47875ee1b73650738b44ae85e7113b"

def api_call(method, endpoint, data=None):
    url = f"{GITEA_URL}/api/v1/repos/{REPO}{endpoint}"
    headers = {"Authorization": f"token {TOKEN}", "Content-Type": "application/json"}
    
    if method == "GET":
        response = requests.get(url, headers=headers)
    elif method == "POST":
        response = requests.post(url, json=data, headers=headers)
    elif method == "PATCH":
        response = requests.patch(url, json=data, headers=headers)
    elif method == "DELETE":
        response = requests.delete(url, headers=headers)
    
    return response

print("🔧 Fixing Posterrama milestones and issues...\n")

# Step 1: Delete wrong milestones (keep Sprint 3 for current work)
print("Step 1: Cleaning up milestones...")

# Delete "Sprint 4 - Display Enhancements" (ID 2) - conflicts with backend Sprint 4
response = api_call("DELETE", "/milestones/2")
if response.status_code == 204:
    print("✅ Deleted: Sprint 4 - Display Enhancements")
else:
    print(f"⚠️  Could not delete Sprint 4: {response.status_code}")

# Keep Sprint 3 (ID 1) for current work
# Keep v3.0 (ID 3) but will update it
# Keep Future (ID 4)

# Step 2: Create version-based milestones
print("\nStep 2: Creating version milestones...")

milestones_to_create = [
    {
        "title": "v2.9.5 - Quick Wins",
        "description": "Easy improvements and fixes (1-2h each)",
        "due_on": "2025-11-25T23:59:59Z"
    },
    {
        "title": "v2.9.6 - Display Polish",
        "description": "Display mode improvements (2-4h each)",
        "due_on": "2025-12-05T23:59:59Z"
    },
    {
        "title": "v2.9.7 - Content Features",
        "description": "Content and media enhancements (4-8h each)",
        "due_on": "2025-12-15T23:59:59Z"
    }
]

new_milestones = {}
for ms in milestones_to_create:
    response = api_call("POST", "/milestones", ms)
    if response.status_code == 201:
        ms_id = response.json()['id']
        new_milestones[ms['title'].split(' - ')[0]] = ms_id
        print(f"✅ Created: {ms['title']} (ID: {ms_id})")
    else:
        print(f"❌ Failed to create {ms['title']}: {response.status_code}")

# Update v3.0 title
response = api_call("PATCH", "/milestones/3", {
    "title": "v3.0.0 - Major Features",
    "description": "Platform apps, plugins, major architecture changes",
    "due_on": "2026-01-31T23:59:59Z"
})
if response.status_code == 200:
    print("✅ Updated: v3.0.0 - Major Features")

print(f"\n📊 Milestone IDs:")
print(f"  Sprint 3 (current): 1")
print(f"  v2.9.5: {new_milestones.get('v2.9.5', 'N/A')}")
print(f"  v2.9.6: {new_milestones.get('v2.9.6', 'N/A')}")
print(f"  v2.9.7: {new_milestones.get('v2.9.7', 'N/A')}")
print(f"  v3.0.0: 3")
print(f"  Future: 4")

# Step 3: Fix issues #1-#7 (add labels and milestones)
print("\nStep 3: Fixing issues #1-#7...")

issues_1_7 = [
    {"num": 1, "labels": [3, 13, 10], "milestone": 1},  # Tech debt audit -> Sprint 3, LOW
    {"num": 2, "labels": [3, 13, 9], "milestone": 1},   # Refactor routes -> Sprint 3, MEDIUM
    {"num": 3, "labels": [3, 13, 10], "milestone": 1},  # HTTP base class -> Sprint 3, LOW
    {"num": 4, "labels": [4, 13, 10], "milestone": 1},  # JSDoc -> Sprint 3, LOW
    {"num": 5, "labels": [5, 13, 10], "milestone": 1},  # Stream images -> Sprint 3, LOW
    {"num": 6, "labels": [3, 13, 10], "milestone": new_milestones.get('v2.9.5', 4)},  # Upload user -> v2.9.5
    {"num": 7, "labels": [3, 14, 10], "milestone": new_milestones.get('v2.9.5', 4)},  # Cinema dynamic name -> v2.9.5
]

for issue in issues_1_7:
    response = api_call("PATCH", f"/issues/{issue['num']}", {
        "labels": issue['labels'],
        "milestone": issue['milestone']
    })
    if response.status_code == 200:
        print(f"✅ Updated issue #{issue['num']}")
    else:
        print(f"❌ Failed to update issue #{issue['num']}: {response.status_code}")

# Step 4: Reassign all other issues to proper milestones
print("\nStep 4: Reassigning issues to version-based milestones...")

# Get milestone IDs
v2_9_5 = new_milestones.get('v2.9.5', 4)
v2_9_6 = new_milestones.get('v2.9.6', 4)
v2_9_7 = new_milestones.get('v2.9.7', 4)
v3_0_0 = 3
future = 4

issue_assignments = {
    # Quick wins (v2.9.5) - 1-2h each
    22: v2_9_6,  # Full-bleed posters (display work)
    26: v2_9_5,  # Context-aware settings (UI filtering)
    31: v2_9_5,  # Faster transitions (config change)
    38: v2_9_6,  # Per-device uploads (extend existing)
    54: v2_9_6,  # Mobile admin (responsive fixes)
    
    # Display polish (v2.9.6) - 2-4h each
    23: v2_9_6,  # Film card layout
    27: v2_9_6,  # Cinema presets
    28: v2_9_7,  # Static poster pinning (needs search)
    29: v2_9_6,  # Tablet optimization
    30: v2_9_6,  # Mobile optimization
    32: v2_9_6,  # Portrait orientation
    
    # Content features (v2.9.7) - 4-8h each
    37: v2_9_7,  # Per-device sources
    41: v2_9_7,  # Curated playlists
    42: v2_9_5,  # On this day (simple)
    43: v2_9_6,  # New to Plex (medium)
    
    # Major features (v3.0.0) - 8h+
    24: v3_0_0,  # Carousel mode (complex animation)
    25: v3_0_0,  # Music albums (new source type)
    33: v3_0_0,  # Trailer playback (video integration)
    35: v3_0_0,  # Font customization (theme system)
    36: v3_0_0,  # Artist card (music mode)
    39: v3_0_0,  # Plugin system (architecture)
    40: v3_0_0,  # Emby integration (new source)
    44: v3_0_0,  # Apple TV app
    45: v3_0_0,  # Android TV app
    46: v3_0_0,  # Smart TV apps
    47: v3_0_0,  # Raspberry Pi builds
    48: v3_0_0,  # Time-based switching
    50: v3_0_0,  # Scene presets
    51: v3_0_0,  # OAuth
    52: v3_0_0,  # RBAC
    53: v3_0_0,  # User management
    55: v3_0_0,  # Accessibility
    
    # Future (experimental/research)
    34: future,  # Motion posters AI (experimental)
    49: future,  # Weather-based (nice to have)
}

for issue_num, milestone_id in issue_assignments.items():
    response = api_call("PATCH", f"/issues/{issue_num}", {"milestone": milestone_id})
    if response.status_code == 200:
        print(f"✅ Reassigned issue #{issue_num}")
    else:
        print(f"⚠️  Issue #{issue_num}: {response.status_code}")

print("\n✅ All done!")
print("\n📊 Final milestone distribution:")
print(f"  Sprint 3: Issues #1-5 (current work)")
print(f"  v2.9.5: Quick wins (1-2h)")
print(f"  v2.9.6: Display polish (2-4h)")
print(f"  v2.9.7: Content features (4-8h)")
print(f"  v3.0.0: Major features (8h+)")
print(f"  Future: Experimental/research")
