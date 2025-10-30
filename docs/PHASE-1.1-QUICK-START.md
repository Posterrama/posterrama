# Phase 1.1 Quick Start Guide

**Status**: Ready to begin  
**Updated**: October 27, 2025  
**Current Progress**: 18.5% complete (3,680 / 19,864 lines extracted)

---

## 🎯 Next Extraction: groups.js

**Target**: `/api/groups/*` routes (~400 lines)  
**Effort**: 1.5 hours  
**Risk**: Very Low ⭐  
**Priority**: #1 (easiest starting point)

### Step-by-Step Checklist

#### 1. Analyze Route Boundaries (10 mins)

```bash
# Find all groups routes
grep -n "app\.(get|post|put|delete|patch)" server.js | grep -i "groups"

# Check dependencies
grep -n "groupsStore" server.js
grep -n "validateGroup" server.js
```

#### 2. Create Route Module (45 mins)

Create `routes/groups.js`:

```javascript
/**
 * Groups Management Routes
 * Handles device group CRUD operations
 */
const express = require('express');
const router = express.Router();
const groupsStore = require('../utils/groupsStore');
const { asyncHandler } = require('../middleware/errorHandler');
const { isAuthenticated } = require('../lib/auth-helpers');
// Import other dependencies as needed

// GET /api/groups
router.get(
    '/',
    asyncHandler(async (req, res) => {
        // Move route handler logic here
    })
);

// POST /api/groups
router.post(
    '/',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        // Move route handler logic here
    })
);

// Add other routes...

module.exports = router;
```

#### 3. Update server.js (15 mins)

```javascript
// Import at top of file
const groupsRouter = require('./routes/groups');

// Mount router (after middleware setup)
app.use('/api/groups', groupsRouter);

// Remove old inline routes (search and delete)
// app.get('/api/groups', ...)
// app.post('/api/groups', ...)
```

#### 4. Test & Verify (20 mins)

```bash
# Run full test suite
npm test

# Check for lint errors
npm run lint

# Start server and verify
npm start

# Test endpoints manually
curl http://localhost:4000/api/groups
curl -X POST http://localhost:4000/api/groups \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Group"}'
```

#### 5. Commit (5 mins)

```bash
git add -A
git commit -m "refactor: extract groups routes to routes/groups.js (400 lines)

Extract all /api/groups/* endpoints to dedicated route module.

Changes:
- Create routes/groups.js with Express Router
  * GET /api/groups - List all groups
  * POST /api/groups - Create group
  * GET /api/groups/:id - Get group details
  * PUT /api/groups/:id - Update group
  * DELETE /api/groups/:id - Delete group
  * POST /api/groups/:id/devices - Add device to group
  * DELETE /api/groups/:id/devices/:deviceId - Remove device

- Update server.js (16,184 → ~15,784 lines)
  * Import and mount groupsRouter
  * Remove inline group routes

Dependencies:
- groupsStore for persistence
- auth-helpers for authentication
- errorHandler for async wrapping

Progress: 20.5% reduction (4,080 / 19,864 lines extracted)"
```

---

## 📋 Extraction Queue (Priority Order)

### Week 1: Low Risk (Target: 3 modules, ~1,100 lines)

| #   | Module    | Lines | Effort | Risk        | Routes Pattern                       |
| --- | --------- | ----- | ------ | ----------- | ------------------------------------ |
| 1   | groups.js | ~400  | 1.5h   | ⭐ Very Low | `/api/groups/*`                      |
| 2   | static.js | ~300  | 1h     | ⭐ Very Low | `/local-media/*`, static assets      |
| 3   | config.js | ~400  | 2h     | ⭐⭐ Low    | `/get-config`, `/api/admin/config/*` |

### Week 2: Medium Risk (Target: 2 modules, ~1,100 lines)

| #   | Module   | Lines | Effort | Risk          | Routes Pattern                                     |
| --- | -------- | ----- | ------ | ------------- | -------------------------------------------------- |
| 4   | auth.js  | ~500  | 3h     | ⭐⭐⭐ Medium | `/login`, `/logout`, `/api/auth/*`                 |
| 5   | media.js | ~600  | 4h     | ⭐⭐⭐ Medium | `/get-media`, `/api/media/*`, `/api/poster-info/*` |

### Week 3: High Risk (Target: 2 modules, ~1,800 lines)

| #   | Module     | Lines | Effort | Risk               | Routes Pattern                       |
| --- | ---------- | ----- | ------ | ------------------ | ------------------------------------ |
| 6   | devices.js | ~800  | 5h     | ⭐⭐⭐⭐ High      | `/api/devices/*`, pairing, WebSocket |
| 7   | admin.js   | ~1000 | 6h     | ⭐⭐⭐⭐⭐ Highest | Remaining `/api/admin/*`             |

---

## ✅ Quality Gates (Must Pass Every Time)

Before committing ANY extraction:

```bash
# 1. All tests must pass
npm test
# Expected: 2045+ passing, 12 known flaky excluded

# 2. Zero lint errors
npm run lint
# Expected: clean exit, no errors

# 3. Coverage maintained
npm run test:coverage
# Expected: 92%+ statements coverage

# 4. Server starts
npm start
# Expected: "posterrama.app is listening on http://localhost:4000"

# 5. Manual endpoint test
curl http://localhost:4000/health
# Expected: {"status":"ok","uptime":...}
```

If ANY gate fails → **DO NOT COMMIT** → Fix issues → Re-test

---

## 🔧 Common Patterns

### Express Router Template

```javascript
const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');

// All routes are relative to mount point
// If mounted at /api/groups, then '/' = /api/groups
router.get(
    '/',
    asyncHandler(async (req, res) => {
        res.json({ data: [] });
    })
);

module.exports = router;
```

### Mounting in server.js

```javascript
// Import
const groupsRouter = require('./routes/groups');

// Mount (order matters - after middleware, before error handlers)
app.use('/api/groups', groupsRouter);
```

### Finding Route Boundaries

```bash
# Find all routes for a pattern
grep -n "app\.(get|post|put|delete)" server.js | grep "/api/groups"

# Find route handler end (look for closing });)
sed -n '5000,5100p' server.js  # Print lines 5000-5100

# Count lines between markers
awk '/app.get.*groups/,/^\);/' server.js | wc -l
```

### Handling Shared Dependencies

**Problem**: Route needs `config`, `logger`, `isDebug`

**Solution 1**: Pass via router factory

```javascript
// routes/groups.js
module.exports = (config, logger, isDebug) => {
    const router = express.Router();
    // Use config, logger, isDebug in handlers
    return router;
};

// server.js
const groupsRouter = require('./routes/groups')(config, logger, isDebug);
```

**Solution 2**: Import directly (preferred for globals)

```javascript
// routes/groups.js
const logger = require('../utils/logger');
const { readConfig } = require('../lib/config-helpers');
```

---

## 🚨 Common Pitfalls & Solutions

### Problem: Route not responding after extraction

**Cause**: Route path mismatch

```javascript
// WRONG - duplicates /api/groups
app.use('/api/groups', groupsRouter);
router.get('/api/groups', ...);  // Results in /api/groups/api/groups

// CORRECT - relative paths in router
app.use('/api/groups', groupsRouter);
router.get('/', ...);  // Results in /api/groups
router.get('/:id', ...);  // Results in /api/groups/:id
```

### Problem: Middleware not applied

**Cause**: Mount order matters

```javascript
// WRONG - router mounted before auth middleware
app.use('/api/groups', groupsRouter);
app.use(isAuthenticated);

// CORRECT - middleware first, then routers
app.use(isAuthenticated);
app.use('/api/groups', groupsRouter);
```

### Problem: Tests fail with "Cannot find module"

**Cause**: Missing relative path adjustment

```javascript
// WRONG - assumes routes/ is at project root
const logger = require('./utils/logger');

// CORRECT - routes/ is one level deep
const logger = require('../utils/logger');
```

---

## 📊 Progress Tracking

Update after EACH successful extraction:

```bash
# Count current lines
wc -l server.js routes/*.js lib/*.js

# Calculate progress
echo "scale=2; (19864 - $(wc -l < server.js)) / 19864 * 100" | bc

# Update MATURITY-ROADMAP.md with:
# - New line counts
# - Extraction description
# - Updated progress percentage
# - Add commit hash to history
```

---

## 🎓 Learning from Phase 1.0

**What Worked Well**:

- ✅ Small commits (100-300 lines) are manageable
- ✅ Dependency injection via wrappers prevents coupling
- ✅ Full test suite catches breaking changes early
- ✅ Grep searches find all usages reliably
- ✅ Format + lint before commit reduces friction

**What to Improve**:

- ⚠️ Extract large functions (>500 lines) to helpers first
- ⚠️ Document state management patterns (getters/setters)
- ⚠️ Add route-specific tests for new modules
- ⚠️ Keep router factory pattern consistent

---

## 🔗 Quick Links

- [MATURITY-ROADMAP.md](./MATURITY-ROADMAP.md) - Full roadmap
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Dev setup guide
- [Package.json scripts](../package.json) - Available npm commands
- [Test coverage report](../coverage/index.html) - Coverage details

---

## 💡 Tips for Success

1. **Start fresh** - Clear terminal, close unused files
2. **One extraction at a time** - Don't start next until previous is committed
3. **Test early and often** - Run tests after moving each route
4. **Use git diff** - Review changes before committing
5. **Take breaks** - Complex extractions need focus
6. **Ask for help** - If stuck >30 mins, document issue and move on
7. **Celebrate wins** - Each successful extraction is progress! 🎉

---

**Ready to begin?** → Start with [groups.js extraction](#1-analyze-route-boundaries-10-mins)
