#!/bin/bash

# Script to create Gitea issues from backend analysis with correct label IDs
# Usage: export GITEA_TOKEN=$(cat ~/.gitea-token) && ./create-backend-issues.sh

set -e

# Configuration
GITEA_URL="${GITEA_URL:-https://git.highlanders.cloud}"
GITEA_OWNER="${GITEA_OWNER:-Posterrama.app}"
GITEA_REPO="${GITEA_REPO:-posterrama}"
GITEA_TOKEN="${GITEA_TOKEN:-}"

# Check if token is provided
if [ -z "$GITEA_TOKEN" ]; then
    echo "Error: GITEA_TOKEN environment variable not set"
    echo "Usage: export GITEA_TOKEN=\$(cat ~/.gitea-token) && ./create-backend-issues.sh"
    exit 1
fi

API_URL="$GITEA_URL/api/v1/repos/$GITEA_OWNER/$GITEA_REPO/issues"

echo "Creating Backend Analysis Issues"
echo "=================================="
echo "Repository: $GITEA_OWNER/$GITEA_REPO"
echo "API URL: $API_URL"
echo ""

# Label IDs (from Gitea API)
# 1:feature 2:bug 3:enhancement 4:documentation 5:performance 6:security
# 7:priority:critical 8:priority:high 9:priority:medium 10:priority:low
# 12:api 13:backend 14:frontend 15:display-mode 11:ui/ux
# 16:blocked 17:needs-discussion 18:good-first-issue

# Function to create issue
create_issue() {
    local title="$1"
    local body="$2"
    local label_ids="$3"  # Comma-separated label IDs
    
    echo "Creating: $title"
    
    # Build labels array with IDs
    IFS=',' read -ra LABEL_ARRAY <<< "$label_ids"
    labels_json="["
    for label_id in "${LABEL_ARRAY[@]}"; do
        labels_json+="${label_id},"
    done
    labels_json="${labels_json%,}]"
    
    # Create JSON payload
    json_payload=$(jq -n \
        --arg title "$title" \
        --arg body "$body" \
        --argjson labels "$labels_json" \
        '{
            title: $title,
            body: $body,
            labels: $labels
        }')
    
    # Make API request
    response=$(curl -s -X POST \
        -H "Authorization: token $GITEA_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$json_payload" \
        "$API_URL")
    
    # Check if successful
    issue_number=$(echo "$response" | jq -r '.number')
    if [ "$issue_number" != "null" ] && [ -n "$issue_number" ]; then
        echo "✅ Issue #$issue_number created"
        echo "   URL: $GITEA_URL/$GITEA_OWNER/$GITEA_REPO/issues/$issue_number"
    else
        echo "❌ Failed"
        echo "   Response: $response"
    fi
    echo ""
}

# Issue #81: API Versioning Implementation
# Labels: enhancement(3), api(12), documentation(4)
create_issue \
    "API Versioning Implementation" \
    "## Problem

Current API has no versioning, making breaking changes difficult to manage and deprecation complicated.

## Proposed Solution

Implement versioned API endpoints with deprecation strategy:
- \`/api/v1/*\` (current endpoints)
- \`/api/v2/*\` (future breaking changes)
- \`/api/latest/*\` (alias to current version)

## Implementation Steps

### 1. Version Routing (4 hours)
Create \`routes/api-versioning.js\` to route to different API versions.

### 2. Deprecation Strategy (2 hours)
Implement \`middleware/api-deprecation.js\` with Warning headers for deprecated versions.

### 3. Documentation Update (2 hours)
- Update Swagger to show version paths
- Document versioning policy
- Add deprecation timeline

### 4. Migration Plan (2 hours)
- Move current routes to /api/v1
- Update client applications
- Set 6-month deprecation timeline

## Estimated Effort
10-12 hours (1.5 days)

## Impact
- ✅ Backward compatibility maintained
- ✅ Easier API evolution
- ✅ Better client communication
- ✅ Reduced breaking change risk

## Priority
MEDIUM

## References
- API-PRODUCTION-READINESS.md
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "3,12,4,9"

# Issue #82: Encrypt 2FA Secrets at Rest
# Labels: security(6), enhancement(3), priority:medium(9)
create_issue \
    "Encrypt 2FA Secrets at Rest" \
    "## Problem

2FA secrets currently stored base32-encoded but not encrypted at rest. Potential security risk if config.json is compromised.

## Proposed Solution

Implement AES-256-GCM encryption for 2FA secrets using key derivation from environment variable.

## Implementation Steps

### 1. Encryption Service (3 hours)
Create \`lib/encryption.js\` with AES-256-GCM encryption implementation.

### 2. Migration Script (2 hours)
Create \`scripts/migrate-2fa-secrets.js\` to encrypt existing secrets.

### 3. Update Auth Routes (1 hour)
Modify \`routes/auth.js\` to decrypt secrets for verification.

### 4. Documentation (1 hour)
- Update setup guide
- Document ENCRYPTION_KEY requirement
- Add to environment variable validation

## Estimated Effort
7-8 hours (1 day)

## Impact
- ✅ Enhanced security (defense in depth)
- ✅ Compliance with best practices
- ✅ Protection against config.json compromise

## Priority
MEDIUM

## Dependencies
- ENCRYPTION_KEY environment variable (32+ bytes recommended)
- One-time migration of existing secrets

## References
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "6,3,9"

# Issue #83: Extract WebSocket Server Setup
# Labels: enhancement(3), backend(13), priority:low(10)
create_issue \
    "Extract WebSocket Server Setup" \
    "## Problem

WebSocket logic currently in server.js (~600 lines), reducing clarity of server orchestration.

## Proposed Solution

Extract to dedicated module \`lib/websocket-server.js\` for better separation of concerns.

## Implementation

Create \`lib/websocket-server.js\` with \`createWebSocketServer()\` function that encapsulates all WebSocket setup logic.

Update \`server.js\` to use the new module.

## Estimated Effort
4-6 hours

## Impact
- ✅ Reduced server.js size (~600 lines)
- ✅ Improved testability
- ✅ Better separation of concerns

## Priority
LOW

## References
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "3,13,10"

# Issue #84: Extract Helper Functions from server.js
# Labels: enhancement(3), backend(13), priority:low(10)
create_issue \
    "Extract Helper Functions from server.js" \
    "## Problem

server.js contains ~1,200 lines of helper functions that could be moved to appropriate lib/ modules.

## Proposed Solution

Systematically extract helper functions to focused modules:
- Media transformation helpers → \`lib/media-helpers.js\`
- Configuration helpers → \`lib/config-helpers.js\`
- Utility functions → appropriate utils/ files

## Implementation Steps

1. **Identify helper categories** (1 hour)
2. **Create target modules** (2 hours)
3. **Extract functions** (2 hours)
4. **Testing & validation** (2 hours)

## Estimated Effort
6-8 hours

## Impact
- ✅ Cleaner server.js (~1,200 lines reduction)
- ✅ Better code organization
- ✅ Improved reusability
- ✅ Easier testing

## Priority
LOW

## Risk
LOW - Pure functions are easy to extract

## References
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "3,13,10"

# Issue #85: Split Cache Module (Optional)
# Labels: enhancement(3), backend(13), priority:low(10)
create_issue \
    "Split Cache Module (Optional)" \
    "## Problem

utils/cache.js is large (2,143 lines) but cohesive. Only split if adding significant new features.

## When to Consider

Only implement if:
- Adding new caching tiers
- Implementing distributed cache
- Adding complex cache policies
- Cache module becomes difficult to maintain

## Current Assessment

**Not recommended yet:**
- ✅ File is large but cohesive
- ✅ Single responsibility (caching)
- ✅ Excellent test coverage (97%)
- ⚠️ Splitting might reduce cohesion

## Proposed Solution

Split into focused submodules:
- \`utils/cache/memory.js\`
- \`utils/cache/disk.js\`
- \`utils/cache/http.js\`
- \`utils/cache/metrics.js\`

## Estimated Effort
4-6 hours

## Priority
LOW (Optional - evaluate need first)

## Risk
MEDIUM - Complex module, splitting might reduce clarity

## References
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "3,13,10"

# Issue #86: Performance Monitoring Dashboard
# Labels: enhancement(3), performance(5), priority:low(10)
create_issue \
    "Performance Monitoring Dashboard" \
    "## Problem

Metrics collected but not visualized. No real-time performance monitoring. Difficult to identify trends.

## Proposed Solution

### Option 1: Built-in Dashboard (8-12 hours)
Create admin dashboard showing:
- Request latency (P50, P95, P99)
- Cache performance (hit rate, memory)
- WebSocket connections (active devices, latency)
- Media source health (Plex, Jellyfin, TMDB)

### Option 2: Prometheus + Grafana (16-20 hours)
Expose Prometheus metrics endpoint and integrate with Grafana for advanced monitoring.

## Implementation Steps

1. **Create metrics endpoint** (3 hours)
2. **Build dashboard UI** (5 hours)
3. **Add charts and visualizations** (3 hours)
4. **Testing and documentation** (1 hour)

## Estimated Effort
- Built-in: 8-12 hours
- External: 16-20 hours

## Impact
- ✅ Real-time visibility
- ✅ Trend identification
- ✅ Proactive issue detection
- ✅ Performance optimization insights

## Priority
LOW

## Dependencies
External option requires Prometheus + Grafana setup

## References
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "3,5,10"

# Issue #87: CDN Integration for Static Assets
# Labels: enhancement(3), performance(5), priority:low(10)
create_issue \
    "CDN Integration for Static Assets" \
    "## Problem

Server serves all static assets, increasing load and latency for global users.

## Proposed Solution

Integrate CDN (CloudFlare, AWS CloudFront, or similar) for static asset delivery.

## Implementation Steps

1. **CDN Configuration** (2 hours)
   - Set up CDN service
   - Configure origin server
   - Set cache rules

2. **Asset URL Rewriting** (2 hours)
   - Create \`lib/cdn-helper.js\`
   - Update asset references

3. **Update Templates** (2 hours)
   - Modify HTML templates
   - Update CSS/JS references

4. **Testing** (2 hours)
   - Verify asset loading
   - Test cache headers
   - Load testing

## Estimated Effort
4-8 hours

## Impact
- ✅ Reduced server load
- ✅ Improved global latency
- ✅ Better scalability
- ✅ Reduced bandwidth costs

## Priority
LOW

## Dependencies
- CDN service account
- DNS configuration
- SSL certificate

## References
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "3,5,10"

# Issue #88: Security Headers Audit
# Labels: security(6), enhancement(3), priority:low(10)
create_issue \
    "Security Headers Audit" \
    "## Problem

Current security headers are good but could be tightened, especially CSP 'unsafe-inline' directives.

## Proposed Solution

Audit and improve security headers:

### 1. Content Security Policy Review (2 hours)
- Replace 'unsafe-inline' with nonces
- Restrict imgSrc to specific domains
- Add additional security directives

### 2. Add Permissions-Policy Header (1 hour)
Disable unnecessary browser features.

### 3. Testing (1 hour)
- Test with securityheaders.com
- Verify all functionality works

## Estimated Effort
2-4 hours

## Impact
- ✅ Reduced XSS attack surface
- ✅ Better defense in depth
- ✅ Compliance with security best practices

## Priority
LOW

## References
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "6,3,10"

# Issue #89: Database Migration (Future Consideration)
# Labels: enhancement(3), backend(13), priority:low(10)
create_issue \
    "Database Migration (Future Consideration)" \
    "## Problem

File-based storage limits scalability for very large deployments (100+ concurrent devices).

## When to Consider

Only migrate if:
- ✅ Cluster mode implemented (Issue #80)
- ✅ 100+ concurrent devices needed
- ✅ Complex query requirements emerge
- ✅ Multi-tenant deployment needed

## Current Assessment

**Not recommended yet:**
- ✅ Current file-based solution works well
- ✅ Simple, reliable, easy to backup
- ⚠️ Database adds complexity

## Proposed Solution

Migrate to PostgreSQL or SQLite for:
- Device states
- Sessions
- Media library cache
- User preferences

Keep config.json for basic settings.

## Estimated Effort
40-60 hours

## Priority
FUTURE (only if needed)

## Dependencies
- Cluster mode (Issue #80)
- Database server setup
- Migration tooling

## References
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "3,13,10"

# Issue #90: Shared Transformation Logic Extraction (Optional)
# Labels: enhancement(3), backend(13), priority:low(10)
create_issue \
    "Shared Transformation Logic Extraction (Optional)" \
    "## Problem

Similar transformation patterns in plex-helpers.js and jellyfin-helpers.js.

## When to Consider

Only extract if:
- Adding more media sources
- Duplication becomes maintenance burden
- Common bugs found in both implementations

## Current Assessment

**Not recommended yet:**
- ✅ Current code is clear and maintainable
- ✅ Excellent test coverage
- ⚠️ Abstraction would be complex
- ⚠️ Only 2 sources currently

## Proposed Solution

Extract common transformation logic to \`lib/media-transformer.js\`.

## Estimated Effort
8-12 hours

## Priority
LOW (Optional - evaluate need first)

## Risk
MEDIUM - Complex abstraction might reduce clarity

## References
- docs/ISSUES-FROM-BACKEND-ANALYSIS.md" \
    "3,13,10"

echo "=================================="
echo "✅ Finished creating all issues!"
echo ""
echo "View all issues at:"
echo "$GITEA_URL/$GITEA_OWNER/$GITEA_REPO/issues"
echo ""
echo "Next steps:"
echo "1. Assign milestones in Gitea UI (Sprint 4, 5, 8, Future)"
echo "2. Review and adjust priorities if needed"
echo "3. Start working on Sprint 4!"
