# Sprint 3 Gitea Issues Template

**Date:** November 15, 2025  
**Repository:** https://git.highlanders.cloud/Posterrama.app/posterrama

Copy-paste these into Gitea issue creation form.

---

## Issue #12: Technical Debt Marker Audit

**Labels:** `enhancement`, `low-priority`  
**Milestone:** Sprint 3  
**Effort:** 3 hours

### Description

Audit and resolve all TODO/FIXME/HACK markers in the codebase.

### Current State

- Scattered TODO/FIXME comments throughout codebase
- No central tracking of technical debt
- Unclear prioritization

### Tasks

1. Search all TODO/FIXME/HACK comments
2. Create Gitea issues for legitimate items
3. Remove obsolete markers
4. Document debt in central location
5. Add to Sprint 4+ roadmap

### Acceptance Criteria

- [ ] All TODO/FIXME audited
- [ ] Gitea issues created for valid items
- [ ] Obsolete markers removed
- [ ] Technical debt documented

### Files Affected

All source files

### Related

Part of Sprint 3: Code Quality improvements

---

## Issue #13: Refactor Large Route Handlers

**Labels:** `enhancement`, `medium-priority`  
**Milestone:** Sprint 3  
**Effort:** 6 hours

### Description

Refactor large route handlers in routes/ for better organization and testability.

### Current State

- Some route handlers exceed 100 lines
- Mixed business logic with routing
- Difficult to unit test
- Poor separation of concerns

### Target Files

- `routes/api-playlists.js` (~200 lines)
- `routes/api-admin.js` (complex logic)
- `routes/media-images.js` (image processing)

### Refactoring Strategy

1. Extract business logic to lib/ or services/
2. Keep routes thin (routing + validation only)
3. Add unit tests for extracted logic
4. Improve error handling

### Acceptance Criteria

- [ ] Route handlers < 50 lines each
- [ ] Business logic in lib/services
- [ ] Unit tests for extracted code
- [ ] All existing tests still pass
- [ ] No regression in functionality

### Benefits

- Better code organization
- Improved testability
- Easier maintenance
- Clear separation of concerns

---

## Issue #16: Extract Common HTTP Client Base Class

**Labels:** `enhancement`, `low-priority`  
**Milestone:** Sprint 3  
**Effort:** 4 hours

### Description

Create base HTTP client class to reduce duplication across Plex, Jellyfin, and ROMM clients.

### Current State

**Duplicate code in:**

- `utils/plex-http-client.js`
- `utils/jellyfin-http-client.js`
- `utils/romm-http-client.js`

**Duplicated patterns:**

- Request timeout handling
- Error retry logic (3 retries)
- Response validation
- Debug logging
- Request deduplication

### Implementation Plan

1. Create `utils/base-http-client.js`
2. Extract common methods:
    - `request(method, path, options)`
    - `get(path, options)`
    - `post(path, data, options)`
    - `handleTimeout()`
    - `handleRetry()`
3. Refactor existing clients to extend base
4. Add tests for base class
5. Verify all integrations still work

### Acceptance Criteria

- [ ] BaseHttpClient class created
- [ ] 100-150 lines of duplication removed
- [ ] All HTTP clients extend base
- [ ] Existing tests pass
- [ ] New tests for base class (>80% coverage)
- [ ] No breaking changes

### Benefits

- Reduce code duplication
- Consistent error handling
- Easier to add metrics/tracing
- Better testability

---

## Issue #18: Add JSDoc Comments to Core Modules

**Labels:** `documentation`, `low-priority`  
**Milestone:** Sprint 3  
**Effort:** 6 hours

### Description

Add comprehensive JSDoc documentation to improve IDE support and onboarding.

### Current State

- Minimal JSDoc coverage
- IDE autocomplete limited
- New developers struggle with API signatures
- No type hints in VS Code

### Target Modules

1. **Core Libraries** (2h)
    - `lib/jellyfin-helpers.js`
    - `lib/plex-helpers.js`
    - `lib/playlist-helpers.js`

2. **HTTP Clients** (2h)
    - `utils/plex-http-client.js`
    - `utils/jellyfin-http-client.js`
    - `utils/romm-http-client.js`

3. **Utilities** (2h)
    - `utils/cache.js`
    - `utils/wsHub.js`
    - `utils/deviceStore.js`

### JSDoc Template

```javascript
/**
 * Fetches media items from Jellyfin server
 * @param {Object} params - Query parameters
 * @param {string} params.userId - Jellyfin user ID
 * @param {number} [params.limit=50] - Max items to return
 * @param {string[]} [params.includeItemTypes] - Item types filter
 * @returns {Promise<Object[]>} Array of media items
 * @throws {AppError} When Jellyfin API is unreachable
 */
```

### Acceptance Criteria

- [ ] JSDoc for all public functions
- [ ] Parameter types documented
- [ ] Return types documented
- [ ] Examples for complex functions
- [ ] IDE autocomplete works
- [ ] No JSDoc validation errors

### Benefits

- Better IDE support
- Easier onboarding
- Fewer runtime errors
- Self-documenting code

---

## Issue #25: Optimize Image Processing with Streaming

**Labels:** `performance`, `low-priority`  
**Milestone:** Sprint 3  
**Effort:** 4 hours

### Description

Optimize image processing in routes/media-images.js using streams instead of buffers for better memory usage.

### Current State

```javascript
// routes/media-images.js - Current approach
const imageBuffer = await fetchImageBuffer(url);
const processed = await sharp(imageBuffer).resize(width, height).toBuffer();
res.send(processed);
```

**Problem:**

- Loads entire image into memory
- High memory usage for large images
- Limits concurrent processing

### Proposed Solution

```javascript
// Stream-based approach
const imageStream = await fetchImageStream(url);
const transform = sharp().resize(width, height).jpeg({ quality: 80 });

imageStream.pipe(transform).pipe(res);
```

### Implementation Steps

1. Update HTTP clients to support streaming
2. Refactor image routes to use streams
3. Add stream error handling
4. Update tests for streaming
5. Benchmark memory usage

### Files to Update

- `routes/media-images.js` (main changes)
- `utils/plex-http-client.js` (add stream support)
- `utils/jellyfin-http-client.js` (add stream support)
- `__tests__/routes/media-images.test.js`

### Acceptance Criteria

- [ ] Image processing uses streams
- [ ] Memory usage reduced by 30-50%
- [ ] No quality degradation
- [ ] Error handling for stream failures
- [ ] All tests pass
- [ ] Performance benchmarks documented

### Benefits

- Lower memory footprint
- Better scalability
- Handle larger images
- Improved performance

### Performance Target

- Memory usage: <50MB per request (vs ~150MB current)
- Throughput: +20% concurrent requests

---

## Instructions

### Option 1: Manual Creation (Recommended)

1. Go to https://git.highlanders.cloud/Posterrama.app/posterrama/issues/new
2. Copy each issue template above
3. Add appropriate labels and milestone

### Option 2: Generate New Token

If you want to use the API script:

1. Go to https://git.highlanders.cloud/user/settings/applications
2. Create token with scopes: `write:issue`, `write:repository`
3. Run: `./scripts/create-sprint3-issues.sh <NEW_TOKEN>`

### Labels to Create (if not exist)

- `enhancement` - Feature improvements
- `documentation` - Documentation updates
- `performance` - Performance optimizations
- `low-priority` - Can be deferred
- `medium-priority` - Should be addressed soon
