#!/bin/bash

# Sprint 3 Gitea Issues Creation Script
# Usage: ./create-sprint3-issues.sh <GITEA_TOKEN>

set -e

GITEA_URL="https://git.highlanders.cloud"
REPO_OWNER="Posterrama.app"
REPO_NAME="posterrama"
TOKEN="$1"

if [ -z "$TOKEN" ]; then
    echo "Usage: $0 <GITEA_TOKEN>"
    echo "Get token from: $GITEA_URL/user/settings/applications"
    exit 1
fi

API_BASE="$GITEA_URL/api/v1/repos/$REPO_OWNER/$REPO_NAME/issues"

# Issue #12: Technical Debt Marker Audit
echo "Creating Issue #12: Technical Debt Marker Audit..."
curl -X POST "$API_BASE" \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Technical Debt Marker Audit",
    "body": "## Priority: LOW\n## Effort: 3 hours\n## Sprint: 3\n\n### Description\nAudit and resolve all TODO/FIXME/HACK markers in the codebase.\n\n### Current State\n- Scattered TODO/FIXME comments throughout codebase\n- No central tracking of technical debt\n- Unclear prioritization\n\n### Tasks\n1. Search all TODO/FIXME/HACK comments\n2. Create Gitea issues for legitimate items\n3. Remove obsolete markers\n4. Document debt in central location\n5. Add to Sprint 4+ roadmap\n\n### Acceptance Criteria\n- [ ] All TODO/FIXME audited\n- [ ] Gitea issues created for valid items\n- [ ] Obsolete markers removed\n- [ ] Technical debt documented\n\n### Files Affected\nAll source files\n\n### Related Issues\nPart of Sprint 3: Code Quality improvements",
    "labels": [1, 4]
  }'

echo -e "\n\nCreating Issue #13: Refactor Large Route Handlers..."
curl -X POST "$API_BASE" \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Refactor Large Route Handlers",
    "body": "## Priority: MEDIUM\n## Effort: 6 hours\n## Sprint: 3\n\n### Description\nRefactor large route handlers in routes/ for better organization and testability.\n\n### Current State\n- Some route handlers exceed 100 lines\n- Mixed business logic with routing\n- Difficult to unit test\n- Poor separation of concerns\n\n### Target Files\n- `routes/api-playlists.js` (~200 lines)\n- `routes/api-admin.js` (complex logic)\n- `routes/media-images.js` (image processing)\n\n### Refactoring Strategy\n1. Extract business logic to lib/ or services/\n2. Keep routes thin (routing + validation only)\n3. Add unit tests for extracted logic\n4. Improve error handling\n\n### Acceptance Criteria\n- [ ] Route handlers < 50 lines each\n- [ ] Business logic in lib/services\n- [ ] Unit tests for extracted code\n- [ ] All existing tests still pass\n- [ ] No regression in functionality\n\n### Benefits\n- Better code organization\n- Improved testability\n- Easier maintenance\n- Clear separation of concerns",
    "labels": [1, 3]
  }'

echo -e "\n\nCreating Issue #16: Extract Common HTTP Client Base..."
curl -X POST "$API_BASE" \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Extract Common HTTP Client Base Class",
    "body": "## Priority: LOW\n## Effort: 4 hours\n## Sprint: 3\n\n### Description\nCreate base HTTP client class to reduce duplication across Plex, Jellyfin, and ROMM clients.\n\n### Current State\n**Duplicate code in:**\n- `utils/plex-http-client.js`\n- `utils/jellyfin-http-client.js`\n- `utils/romm-http-client.js`\n\n**Duplicated patterns:**\n- Request timeout handling\n- Error retry logic (3 retries)\n- Response validation\n- Debug logging\n- Request deduplication\n\n### Implementation Plan\n1. Create `utils/base-http-client.js`\n2. Extract common methods:\n   - `request(method, path, options)`\n   - `get(path, options)`\n   - `post(path, data, options)`\n   - `handleTimeout()`\n   - `handleRetry()`\n3. Refactor existing clients to extend base\n4. Add tests for base class\n5. Verify all integrations still work\n\n### Acceptance Criteria\n- [ ] BaseHttpClient class created\n- [ ] 100-150 lines of duplication removed\n- [ ] All HTTP clients extend base\n- [ ] Existing tests pass\n- [ ] New tests for base class (>80% coverage)\n- [ ] No breaking changes\n\n### Benefits\n- Reduce code duplication\n- Consistent error handling\n- Easier to add metrics/tracing\n- Better testability",
    "labels": [1, 4]
  }'

echo -e "\n\nCreating Issue #18: Add JSDoc Comments..."
curl -X POST "$API_BASE" \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Add JSDoc Comments to Core Modules",
    "body": "## Priority: LOW\n## Effort: 6 hours\n## Sprint: 3\n\n### Description\nAdd comprehensive JSDoc documentation to improve IDE support and onboarding.\n\n### Current State\n- Minimal JSDoc coverage\n- IDE autocomplete limited\n- New developers struggle with API signatures\n- No type hints in VS Code\n\n### Target Modules\n1. **Core Libraries** (2h)\n   - `lib/jellyfin-helpers.js`\n   - `lib/plex-helpers.js`\n   - `lib/playlist-helpers.js`\n\n2. **HTTP Clients** (2h)\n   - `utils/plex-http-client.js`\n   - `utils/jellyfin-http-client.js`\n   - `utils/romm-http-client.js`\n\n3. **Utilities** (2h)\n   - `utils/cache.js`\n   - `utils/wsHub.js`\n   - `utils/deviceStore.js`\n\n### JSDoc Template\n```javascript\n/**\n * Fetches media items from Jellyfin server\n * @param {Object} params - Query parameters\n * @param {string} params.userId - Jellyfin user ID\n * @param {number} [params.limit=50] - Max items to return\n * @param {string[]} [params.includeItemTypes] - Item types filter\n * @returns {Promise<Object[]>} Array of media items\n * @throws {AppError} When Jellyfin API is unreachable\n */\n```\n\n### Acceptance Criteria\n- [ ] JSDoc for all public functions\n- [ ] Parameter types documented\n- [ ] Return types documented\n- [ ] Examples for complex functions\n- [ ] IDE autocomplete works\n- [ ] No JSDoc validation errors\n\n### Benefits\n- Better IDE support\n- Easier onboarding\n- Fewer runtime errors\n- Self-documenting code",
    "labels": [1, 4]
  }'

echo -e "\n\nCreating Issue #25: Stream Image Processing..."
curl -X POST "$API_BASE" \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Optimize Image Processing with Streaming",
    "body": "## Priority: LOW\n## Effort: 4 hours\n## Sprint: 3\n\n### Description\nOptimize image processing in routes/media-images.js using streams instead of buffers for better memory usage.\n\n### Current State\n```javascript\n// routes/media-images.js - Current approach\nconst imageBuffer = await fetchImageBuffer(url);\nconst processed = await sharp(imageBuffer)\n    .resize(width, height)\n    .toBuffer();\nres.send(processed);\n```\n\n**Problem:**\n- Loads entire image into memory\n- High memory usage for large images\n- Limits concurrent processing\n\n### Proposed Solution\n```javascript\n// Stream-based approach\nconst imageStream = await fetchImageStream(url);\nconst transform = sharp()\n    .resize(width, height)\n    .jpeg({ quality: 80 });\n\nimageStream.pipe(transform).pipe(res);\n```\n\n### Implementation Steps\n1. Update HTTP clients to support streaming\n2. Refactor image routes to use streams\n3. Add stream error handling\n4. Update tests for streaming\n5. Benchmark memory usage\n\n### Files to Update\n- `routes/media-images.js` (main changes)\n- `utils/plex-http-client.js` (add stream support)\n- `utils/jellyfin-http-client.js` (add stream support)\n- `__tests__/routes/media-images.test.js`\n\n### Acceptance Criteria\n- [ ] Image processing uses streams\n- [ ] Memory usage reduced by 30-50%\n- [ ] No quality degradation\n- [ ] Error handling for stream failures\n- [ ] All tests pass\n- [ ] Performance benchmarks documented\n\n### Benefits\n- Lower memory footprint\n- Better scalability\n- Handle larger images\n- Improved performance\n\n### Performance Target\n- Memory usage: <50MB per request (vs ~150MB current)\n- Throughput: +20% concurrent requests",
    "labels": [2, 4]
  }'

echo -e "\n\n✅ All Sprint 3 issues created successfully!"
echo "View them at: $GITEA_URL/$REPO_OWNER/$REPO_NAME/issues"
