#!/bin/bash

# Gitea Labels & Milestones Setup Script
# Creates standard labels and milestones for issue tracking

set -e

GITEA_URL="https://git.highlanders.cloud"
REPO_OWNER="Posterrama.app"
REPO_NAME="posterrama"
TOKEN="$1"

if [ -z "$TOKEN" ]; then
    echo "Usage: $0 <GITEA_TOKEN>"
    exit 1
fi

API_BASE="$GITEA_URL/api/v1/repos/$REPO_OWNER/$REPO_NAME"

echo "🏷️  Creating labels..."

# Type Labels
curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"feature","color":"#0e8a16","description":"New feature or request"}' 2>/dev/null || echo "Label 'feature' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"bug","color":"#d73a4a","description":"Something is not working"}' 2>/dev/null || echo "Label 'bug' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"enhancement","color":"#a2eeef","description":"Improvement to existing feature"}' 2>/dev/null || echo "Label 'enhancement' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"documentation","color":"#0075ca","description":"Documentation improvements"}' 2>/dev/null || echo "Label 'documentation' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"performance","color":"#fbca04","description":"Performance optimization"}' 2>/dev/null || echo "Label 'performance' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"security","color":"#b60205","description":"Security related"}' 2>/dev/null || echo "Label 'security' may already exist"

# Priority Labels
curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"priority:critical","color":"#b60205","description":"Critical priority - fix ASAP"}' 2>/dev/null || echo "Label 'priority:critical' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"priority:high","color":"#d93f0b","description":"High priority"}' 2>/dev/null || echo "Label 'priority:high' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"priority:medium","color":"#fbca04","description":"Medium priority"}' 2>/dev/null || echo "Label 'priority:medium' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"priority:low","color":"#0e8a16","description":"Low priority"}' 2>/dev/null || echo "Label 'priority:low' may already exist"

# Category Labels
curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"ui/ux","color":"#e99695","description":"User interface and experience"}' 2>/dev/null || echo "Label 'ui/ux' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"api","color":"#5319e7","description":"API related"}' 2>/dev/null || echo "Label 'api' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"backend","color":"#d4c5f9","description":"Backend/server related"}' 2>/dev/null || echo "Label 'backend' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"frontend","color":"#c5def5","description":"Frontend/client related"}' 2>/dev/null || echo "Label 'frontend' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"display-mode","color":"#bfdadc","description":"Display mode related (Cinema/Wallart/Screensaver)"}' 2>/dev/null || echo "Label 'display-mode' may already exist"

# Status Labels
curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"blocked","color":"#d93f0b","description":"Blocked by dependencies"}' 2>/dev/null || echo "Label 'blocked' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"needs-discussion","color":"#d876e3","description":"Needs team discussion"}' 2>/dev/null || echo "Label 'needs-discussion' may already exist"

curl -X POST "$API_BASE/labels" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"good-first-issue","color":"#7057ff","description":"Good for newcomers"}' 2>/dev/null || echo "Label 'good-first-issue' may already exist"

echo ""
echo "📅 Creating milestones..."

# Milestones
curl -X POST "$API_BASE/milestones" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Sprint 3 - Code Quality","description":"Code refactoring, JSDoc, technical debt","due_on":"2025-11-30T23:59:59Z"}' 2>/dev/null || echo "Milestone 'Sprint 3' may already exist"

curl -X POST "$API_BASE/milestones" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Sprint 4 - Display Enhancements","description":"Wallart, Cinema, Screensaver improvements","due_on":"2025-12-15T23:59:59Z"}' 2>/dev/null || echo "Milestone 'Sprint 4' may already exist"

curl -X POST "$API_BASE/milestones" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"v3.0 - Major Features","description":"Platform apps, plugins, user management","due_on":"2026-01-31T23:59:59Z"}' 2>/dev/null || echo "Milestone 'v3.0' may already exist"

curl -X POST "$API_BASE/milestones" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Future - Nice to Have","description":"Long-term ideas and wishlist items"}' 2>/dev/null || echo "Milestone 'Future' may already exist"

echo ""
echo "✅ Labels and milestones setup complete!"
echo "View at: $GITEA_URL/$REPO_OWNER/$REPO_NAME/labels"
