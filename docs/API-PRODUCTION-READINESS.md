# API Production Readiness

**Version:** 2.9.3  
**Production Readiness:** 85%  
**Last Updated:** November 11, 2025

---

## Executive Summary

The Posterrama API is **85% production-ready**. All documentation and OpenAPI compliance work is complete. The remaining 15% requires architectural improvements (breaking changes with backwards compatibility).

**Status:**

- ✅ Phase 1 Complete: OpenAPI compliance, security schemes, examples
- ❌ Phase 0 Pending: RESTful paths, API versioning, consistent prefixes

**Why Fix Now:**

- ✅ No external API consumers exist
- ✅ Breaking changes are safe to implement
- ✅ 6-month deprecation window maintains compatibility

---

## Current State

| Metric                  | Status                     |
| ----------------------- | -------------------------- |
| Production Readiness    | 85%                        |
| Total Endpoints         | 166 documented, 128 routes |
| OpenAPI Examples        | 92/92 (100%)               |
| Security Schemes        | 2 (consolidated)           |
| **Non-RESTful paths**   | **5 endpoints** 🔴         |
| **API Versioning**      | **Backwards** 🔴           |
| **Inconsistent prefix** | **Yes** 🟡                 |

---

## Completed Work ✅

### Phase 1: OpenAPI Compliance (November 11, 2025)

- ✅ Added examples to all 92 endpoints (0% → 100%)
- ✅ Consolidated security schemes (6 → 2)
- ✅ Enhanced endpoint documentation
- ✅ Updated intro with all features (RomM, Music Mode, Games Mode)
- ✅ Removed all duplicate schemes
- **Impact:** Zero-risk documentation improvements only

---

## Remaining Issues

Three architectural improvements remain. All require code changes but include backwards compatibility via redirects.

### Issue 1: Non-RESTful Paths 🔴

**Problem:** 5 endpoints have verbs in URLs (violates REST principles)

**Examples:**

```
/get-media              → /api/v1/media
/get-media-by-key/:key  → /api/v1/media/:key
/get-config             → /api/v1/config
/bypass-check           → /api/v1/devices/bypass-status
/clear-reload           → /api/v1/devices/reload
```

**Why Fix:** REST uses nouns in URLs, verbs in HTTP methods (`GET /media` not `GET /get-media`)

**Impact:** All display modes and admin UI use these endpoints

**Files to Update:**

- `routes/media.js`, `routes/devices.js`, `server.js`
- `public/*.js` (screensaver, wallart, cinema, admin)
- `__tests__/**/*.test.js` (10+ test files)

**Effort:** 5-7 hours

---

### Issue 2: Backwards API Versioning 🔴

**Problem:** `/api/v1/*` paths redirect TO legacy paths (should be opposite)

**Current (Wrong):**

```javascript
app.get('/api/v1/media', (req, res) => {
    req.url = '/get-media'; // Redirects to legacy
    app._router.handle(req, res);
});
```

**Desired:**

```javascript
// v1 is canonical
app.get('/api/v1/media', validateQuery, cache, async (req, res) => {
    // ... actual implementation ...
});

// Legacy redirects to v1
app.get('/get-media', (req, res) => {
    res.set('Deprecation', 'true');
    res.set('Sunset', 'Sat, 1 Jun 2026 00:00:00 GMT');
    res.redirect(308, `/api/v1/media${req.url.substring(10)}`);
});
```

**Why Fix:** Cannot introduce v2 API or deprecate old paths properly

**Router Mounts to Change:**

```
app.use('/api/devices', ...) → app.use('/api/v1/devices', ...)
app.use('/api/groups', ...)  → app.use('/api/v1/groups', ...)
app.use('/', mediaRouter)    → app.use('/api/v1', mediaRouter)
```

**Effort:** 6-8 hours

---

### Issue 3: Inconsistent `/api` Prefix 🟡

**Problem:** Media routes at root level, others under `/api`

**Current:**

```
/api/devices/*  ✅ Properly prefixed
/api/groups/*   ✅ Properly prefixed
/get-media      ❌ Root level
/get-config     ❌ Root level
```

**Desired:** All APIs under `/api/v1/*`, HTML at root

```
/api/v1/devices/*  ← From /api/devices
/api/v1/groups/*   ← From /api/groups
/api/v1/media      ← From /get-media
/api/v1/config     ← From /get-config

/admin, /cinema, /screensaver, /wallart  ← Stay at root (HTML pages)
```

**Status:** Automatically resolved by Issue 2 (no separate work needed)

---

## Implementation Strategy

### Phased Approach (Backwards Compatible)

**Critical Lesson:** Previous aggressive migration broke device management, image delivery, and client state. Must maintain backwards compatibility throughout.

#### Phase 0.1: Add `/api/v1/*` Aliases (Non-Breaking)

**Time:** 6-8 hours  
**Status:** Not started

1. Create `/api/v1` router mount in `server.js`
2. Add new RESTful paths as **aliases** to existing implementations
3. Both old and new paths work simultaneously
4. Add tests for new paths
5. **No frontend changes yet**

**New Paths Added:**

```
/api/v1/media              → alias for /get-media
/api/v1/media/:key         → alias for /get-media-by-key/:key
/api/v1/config             → alias for /get-config
/api/v1/devices/bypass-status → alias for /api/devices/bypass-check
/api/v1/devices/reload     → alias for /api/devices/clear-reload
```

#### Phase 0.2: Update Frontend (Non-Breaking)

**Time:** 4-6 hours  
**Depends:** Phase 0.1 complete

1. Update one frontend component at a time
2. Test thoroughly after each update
3. Backend still supports both paths
4. Monitor logs for old path usage

**Files:** `public/screensaver.js`, `public/wallart.js`, `public/cinema.js`, `public/admin.js`

#### Phase 0.3: Migrate Backend Logic (Breaking w/ Redirects)

**Time:** 6-8 hours  
**Depends:** Phase 0.2 complete

1. Move implementation from legacy paths to `/api/v1/*`
2. Convert old paths to 308 redirects with deprecation headers
3. Add `Sunset: Sat, 1 Jun 2026` (6-month window)
4. Update OpenAPI spec
5. Version bump to v3.0.0

**Deprecation Headers:**

```javascript
res.set('Deprecation', 'true');
res.set('Sunset', 'Sat, 1 Jun 2026 00:00:00 GMT');
res.set('Link', '</api/v1/media>; rel="successor-version"');
```

**Total Time:** 16-22 hours (split across 3 phases)

---

## Testing Requirements

Must verify after each implementation phase:

### Display Modes

- [ ] Screensaver mode loads and cycles posters
- [ ] Wallart mode displays artist cards with albums
- [ ] Cinema mode shows trailers with metadata
- [ ] All modes respect device settings

### Device Management

- [ ] Device registration works
- [ ] Pairing code flow functional
- [ ] Heartbeat monitoring active
- [ ] WebSocket commands delivered
- [ ] Group broadcasting works

### Admin Interface

- [ ] Configuration loads correctly
- [ ] Settings can be saved
- [ ] Connection tests work
- [ ] Live log streaming functional

### API Health

- [ ] All 681 tests pass
- [ ] OpenAPI spec validates
- [ ] `/health` endpoint returns OK
- [ ] No console errors or 404s

---

## Files Requiring Updates

### Backend

- `server.js` - Create `/api/v1` router, add aliases/redirects
- `routes/media.js` - Update path definitions
- `routes/devices.js` - Rename endpoints
- `swagger.js` - Update OpenAPI documentation

### Frontend

- `public/screensaver/screensaver.js` - `/get-media` → `/api/v1/media`
- `public/wallart/wallart.js` - `/get-media` → `/api/v1/media`
- `public/cinema/cinema.js` - `/get-media` → `/api/v1/media`
- `public/admin.js` - `/get-config` → `/api/v1/config`

### Tests

- `__tests__/routes/media-music-mode.test.js` - 10+ path references
- `__tests__/api/public-endpoints-validation.test.js` - Path tests
- `__tests__/middleware/errorHandler.comprehensive.test.js` - Endpoint suggestions
- `__tests__/integration/*.test.js` - Integration tests
- `__tests__/devices/*.test.js` - Device endpoint tests

### Middleware

- `middleware/errorHandler.js` - Update `findSimilarEndpoints()` with v1 paths

---

## Timeline

### Phase 0.1: Add Aliases (Week 1)

**6-8 hours** - Add `/api/v1/*` alongside existing paths

### Phase 0.2: Update Frontend (Week 2)

**4-6 hours** - Migrate frontend to new paths

### Phase 0.3: Migrate Backend (Week 3)

**6-8 hours** - Move logic to v1, add redirects, deploy v3.0.0

### Legacy Removal (June 2026)

**6 months** - Deprecation window, then remove old paths in v3.1.0

**Total Effort:** 16-22 hours split across 3 phases

---

## Benefits

- ✅ RESTful API design (industry standard)
- ✅ Proper API versioning (enables future v2)
- ✅ Clean deprecation strategy
- ✅ Better developer experience
- ✅ Easier to maintain long-term
- ✅ Clear API/HTML separation

---

## Version History

| Version | Date       | Changes                                           |
| ------- | ---------- | ------------------------------------------------- |
| 1.0     | 2025-11-11 | Initial assessment                                |
| 1.1     | 2025-11-11 | Code-verified corrections, removed false issues   |
| 1.2     | 2025-11-11 | Phase 1 completed (OpenAPI compliance)            |
| 1.3     | 2025-11-11 | Consolidated, removed completed work, streamlined |

---

**Next Action:** Begin Phase 0.1 when ready to implement breaking changes

---

_All issues code-verified. Phase 1 (documentation) complete. Phase 0 (architecture) pending._
