# Posterrama Module Architecture

**Version**: 2.8.8  
**Last Updated**: October 28, 2025  
**Refactoring Status**: 70.2% reduction complete (5,919 lines from 19,864 original)

---

## 📐 Architecture Overview

Posterrama has been refactored from a monolithic 19,864-line `server.js` into a clean modular architecture with **31 specialized modules** organized into three layers:

```
posterrama/
├── server.js (5,919 lines) ─── Core server & initialization
├── routes/ (17 modules) ────── HTTP endpoints organized by domain
├── lib/ (14 modules) ──────────  Business logic & helpers
└── middleware/ ──────────────── Request processing pipeline
```

---

## 🏗️ Module Layers

### Layer 1: Core Server (`server.js`)

**Lines**: 5,919 (70.2% reduction from original)  
**Purpose**: Application initialization, dependency wiring, server startup

**Responsibilities**:

- Environment initialization
- Express app configuration
- Module mounting and dependency injection
- WebSocket hub initialization
- Server startup/shutdown

**Key Sections**:

- Imports and dependency loading (lines 1-200)
- App initialization and middleware setup (lines 200-600)
- Module router mounting (lines 600-2,500)
- Admin API endpoints (lines 2,500-5,300)
- Server startup logic (lines 5,300-5,919)

---

### Layer 2: Route Modules (`routes/`)

**Total**: 17 modules, 8,360 lines  
**Purpose**: HTTP endpoint definitions grouped by functional domain

All route modules follow the **Factory Pattern** with dependency injection:

```javascript
module.exports = function createXRouter({
    logger,
    config,
    dependencies...
}) {
    const router = express.Router();

    router.get('/endpoint', asyncHandler(async (req, res) => {
        // Handler logic
    }));

    return router;
};
```

#### Routes Module Inventory

| Module                 | Lines  | Endpoints | Purpose                                                 |
| ---------------------- | ------ | --------- | ------------------------------------------------------- |
| **admin-config.js**    | ~400   | 8         | Configuration management, validation, backup/restore    |
| **admin-libraries.js** | ~800   | 12        | Plex/Jellyfin library management, connection testing    |
| **auth-admin.js**      | ~600   | 10        | Authentication, login, logout, password management, 2FA |
| **devices.js**         | ~1,200 | 18        | Device registration, pairing, commands, groups          |
| **frontend-pages.js**  | 581    | 12        | HTML page serving (screensaver, cinema, wallart, admin) |
| **groups.js**          | ~300   | 8         | Device group management                                 |
| **health.js**          | 93     | 2         | Health checks, diagnostics                              |
| **local-directory.js** | 1,397  | 20+       | Local media management, uploads, posterpack generation  |
| **media.js**           | ~900   | 6         | Media aggregation, filtering, search                    |
| **metrics-testing.js** | ~200   | 5         | Metrics configuration, test endpoints                   |
| **profile-photo.js**   | ~150   | 4         | Avatar upload/retrieval/deletion                        |
| **public-api.js**      | ~100   | 3         | Public API endpoints (/api/v1/\*)                       |
| **quality-ratings.js** | ~120   | 4         | Rating and quality management                           |
| **session-auth.js**    | ~700   | 8         | Session management, API keys, tokens                    |
| **swagger.js**         | ~150   | 3         | API documentation endpoints                             |
| **system-admin.js**    | ~900   | 14        | System operations (restart, updates, cache management)  |
| **websocket.js**       | ~769   | -         | WebSocket connection handling                           |

---

### Layer 3: Library Modules (`lib/`)

**Total**: 14 modules, 4,479 lines  
**Purpose**: Business logic, utilities, and helper functions

#### Library Module Inventory

| Module                      | Lines | Purpose                                      |
| --------------------------- | ----- | -------------------------------------------- |
| **cache-utils.js**          | ~200  | Cache configuration and management           |
| **config-helpers.js**       | 364   | Config file operations, env management       |
| **image-proxy.js**          | ~600  | Image proxying, fallback generation          |
| **init.js**                 | 268   | Environment initialization, asset versioning |
| **jellyfin-helpers.js**     | ~400  | Jellyfin API client management               |
| **local-directory-init.js** | ~300  | Local directory source initialization        |
| **media-aggregator.js**     | ~500  | Multi-source media aggregation               |
| **plex-helpers.js**         | ~600  | Plex API client management                   |
| **playlist-cache.js**       | ~800  | Playlist caching and refresh logic           |
| **preset-helpers.js**       | ~200  | Device preset management                     |
| **server-test-helpers.js**  | ~100  | Server connection testing                    |
| **session-helpers.js**      | ~300  | Session utilities                            |
| **utils-helpers.js**        | 89    | General utility functions                    |
| **websocket-handlers.js**   | ~758  | WebSocket message handling                   |

---

## 🔗 Dependency Graph

### Visual Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          server.js (5,919)                       │
│  Core: Initialization, Express setup, Module mounting           │
└────────┬────────────────────────────────────┬───────────────────┘
         │                                     │
         ├─────────────┐                       │
         ▼             ▼                       ▼
    ┌─────────┐  ┌─────────┐          ┌──────────────┐
    │ Routes  │  │   Lib   │          │  Middleware  │
    │ (8,360) │  │ (4,479) │          │   (various)  │
    └────┬────┘  └────┬────┘          └──────┬───────┘
         │            │                      │
         ├────────────┼──────────────────────┘
         │            │
         ▼            ▼
    ┌────────────────────────────┐
    │      Utils & Sources       │
    │   logger, cache, errors    │
    │  plex, jellyfin, tmdb      │
    └────────────────────────────┘
```

### High-Level Dependencies

```
server.js (Core Application)
  │
  ├─> routes/* (17 modules - HTTP endpoints)
  │   │
  │   ├─> admin-config.js → lib/config-helpers, lib/preset-helpers
  │   ├─> admin-libraries.js → lib/plex-helpers, lib/jellyfin-helpers
  │   ├─> auth-admin.js → middleware/rateLimiter, lib/session-helpers
  │   ├─> devices.js → lib/preset-helpers, lib/websocket-handlers
  │   ├─> frontend-pages.js → lib/init (asset versioning)
  │   ├─> groups.js → utils/groupsStore
  │   ├─> local-directory.js → lib/local-directory-init, sources/local
  │   ├─> media.js → lib/media-aggregator, lib/playlist-cache
  │   ├─> profile-photo.js → lib/utils-helpers
  │   └─> [other routes] → [various lib dependencies]
  │
  ├─> lib/* (14 modules - Business logic)
  │   │
  │   ├─> cache-utils.js → utils/cache
  │   ├─> config-helpers.js → utils/configBackup
  │   ├─> init.js → utils/logger, fs operations
  │   ├─> jellyfin-helpers.js → utils/cache, utils/jellyfin-http-client
  │   ├─> local-directory-init.js → sources/local
  │   ├─> media-aggregator.js → sources/*, lib/playlist-cache
  │   ├─> plex-helpers.js → utils/cache, utils/plex-http-client
  │   ├─> playlist-cache.js → lib/cache-utils, lib/media-aggregator
  │   └─> [other lib modules] → [various util dependencies]
  │
  ├─> middleware/* (Request processing pipeline)
  │   │
  │   ├─> cache.js → utils/cache
  │   ├─> errorHandler.js → utils/logger, utils/errors
  │   ├─> metrics.js → utils/metrics
  │   ├─> rateLimiter.js → express-rate-limit
  │   └─> validate.js → validation schemas
  │
  └─> utils/* & sources/* (Shared utilities & data sources)
      │
      ├─> utils/logger.js (Winston logging)
      ├─> utils/cache.js (Multi-tier caching)
      ├─> utils/errors.js (Custom error classes)
      ├─> sources/plex.js (Plex adapter)
      ├─> sources/jellyfin.js (Jellyfin adapter)
      ├─> sources/tmdb.js (TMDB adapter)
      └─> sources/local.js (Local directory adapter)
```

### Key Module Dependencies

#### Routes → Lib Dependencies

- **admin-libraries.js** → `plex-helpers`, `jellyfin-helpers`, `server-test-helpers`
- **devices.js** → `preset-helpers`, `websocket-handlers`
- **frontend-pages.js** → `init` (asset versioning)
- **local-directory.js** → `local-directory-init`, `plex-helpers`, `jellyfin-helpers`
- **media.js** → `media-aggregator`, `playlist-cache`

#### Lib → Lib Dependencies

- **media-aggregator.js** → `playlist-cache`, `plex-helpers`, `jellyfin-helpers`
- **playlist-cache.js** → `cache-utils`, `media-aggregator`
- **plex-helpers.js** → `cache-utils`
- **jellyfin-helpers.js** → `cache-utils`

#### Shared Utilities (used everywhere)

- **utils/logger.js** - Logging throughout application
- **utils/cache.js** - Multi-tier caching
- **utils/errors.js** - Error classes
- **middleware/index.js** - Request processing pipeline

---

## 🎨 Design Patterns

### 1. Factory Pattern with Dependency Injection

**Used in**: All route modules, most lib modules

**Benefits**:

- Testability (easy to mock dependencies)
- No hidden global state
- Explicit dependency declaration
- Easy to refactor and reorganize

**Example**:

```javascript
// routes/example.js
module.exports = function createExampleRouter({ logger, config, asyncHandler, someService }) {
    const router = express.Router();

    router.get(
        '/example',
        asyncHandler(async (req, res) => {
            logger.info('Example endpoint called');
            const result = await someService.doSomething();
            res.json(result);
        })
    );

    return router;
};

// server.js
const createExampleRouter = require('./routes/example');
const exampleRouter = createExampleRouter({
    logger,
    config,
    asyncHandler,
    someService: myServiceInstance,
});
app.use('/', exampleRouter);
```

### 2. Async Handler Wrapper

**Used in**: All async route handlers

**Purpose**: Centralized error handling for async operations

**Example**:

```javascript
router.get(
    '/endpoint',
    asyncHandler(async (req, res) => {
        const data = await someAsyncOperation();
        res.json(data);
    })
);
```

### 3. Middleware Pipeline

**Used in**: All requests flow through middleware stack

**Stages**:

1. Security (CORS, CSP, rate limiting)
2. Request parsing (body parser, cookie parser)
3. Session management
4. Authentication/authorization
5. User context enrichment
6. Metrics collection
7. Request logging

### 4. Centralized Caching

**Used in**: Plex, Jellyfin, TMDB, playlist data

**Layers**:

- Memory cache (fast, volatile)
- Disk cache (persistent)
- HTTP cache headers (client-side)

---

## 📊 Module Metrics

### Code Distribution

```
Total Lines: 18,758
├── server.js:  5,919 (31.5%)
├── routes/:    8,360 (44.6%)
├── lib/:       4,479 (23.9%)
```

### Extraction Efficiency

- **Original monolith**: 19,864 lines
- **Extracted modules**: 12,839 lines
- **Cleanup/dedup**: 1,106 lines removed
- **Final reduction**: 70.2%

### Quality Metrics

- **Tests passing**: 2,034/2,057 (98.9%)
- **Test suites passing**: 167/174 (96.0%)
- **Coverage**: ~92% statements
- **Lint errors**: 0 in all modules
- **Breaking changes**: 0

---

## 🚀 Module Loading Order

The application initializes modules in this order:

1. **Environment & Logging** (`lib/init.js`, `utils/logger.js`)
2. **Configuration** (`lib/config-helpers.js`, `config.json`)
3. **Core Dependencies** (Express, session, bcrypt, etc.)
4. **Utilities** (`utils/*`)
5. **Middleware** (`middleware/*`)
6. **Business Logic** (`lib/*`)
7. **Data Sources** (`sources/*`)
8. **Routes** (`routes/*` - mounted in server.js)
9. **WebSocket Hub** (`utils/wsHub.js`)
10. **Server Startup** (Express `.listen()`)

---

## 🧪 Testing Strategy

### Unit Tests

- Individual functions in `lib/*` and `utils/*`
- Middleware behavior in isolation
- Mock all external dependencies

### Integration Tests

- Route handlers with mocked dependencies
- Multi-module interactions
- Database and cache operations

### E2E Tests

- Full request/response cycles
- WebSocket communication
- Device pairing workflows

### Coverage Targets

- **Global**: 80% statements, 65% branches
- **Well-tested modules**: 85-100%
- **Complex modules**: 60-75%

---

## 🔧 Development Guidelines

### Adding a New Route Module

1. **Create the module**:

```javascript
// routes/my-feature.js
module.exports = function createMyFeatureRouter({
    logger,
    config,
    asyncHandler,
    // ... other dependencies
}) {
    const router = express.Router();

    // Add routes with full paths
    router.get(
        '/api/my-feature/endpoint',
        asyncHandler(async (req, res) => {
            // Handler logic
        })
    );

    return router;
};
```

2. **Mount in server.js**:

```javascript
const createMyFeatureRouter = require('./routes/my-feature');
const myFeatureRouter = createMyFeatureRouter({
    logger,
    config,
    asyncHandler,
    // ... pass dependencies
});
app.use('/', myFeatureRouter); // Mount at root
```

3. **Add tests**:

```javascript
// __tests__/routes/my-feature.test.js
describe('MyFeature Router', () => {
    // Test all endpoints
});
```

4. **Update documentation**:

- Add entry to MODULE-ARCHITECTURE.md
- Update API documentation
- Add Swagger annotations

### Adding a New Lib Module

1. **Create the module**:

```javascript
// lib/my-helper.js
module.exports = function createMyHelper({ logger, config }) {
    return {
        doSomething: async () => {
            logger.info('Doing something');
            // Implementation
        },
    };
};
```

2. **Export and use**:

```javascript
// server.js or other module
const createMyHelper = require('./lib/my-helper');
const myHelper = createMyHelper({ logger, config });
```

---

## 📚 Further Reading

- [REFACTORING-PROGRESS.md](./REFACTORING-PROGRESS.md) - Detailed refactoring history
- [SERVER-REFACTORING-PLAN.md](./SERVER-REFACTORING-PLAN.md) - Strategic planning and analysis
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development setup and workflows
- [API Documentation](../swagger.js) - OpenAPI/Swagger specifications

---

## 🎯 Best Practices

### ✅ Do

- Use factory pattern for all modules
- Inject all dependencies explicitly
- Use full paths in routes (e.g., `/api/feature/endpoint`)
- Mount routers at `/` in server.js
- Add comprehensive Swagger documentation
- Write unit tests for all new code
- Log important operations
- Handle errors gracefully with asyncHandler

### ❌ Don't

- Use global variables (except essential globals like `logger`)
- Import modules circularly
- Mount routers with path prefixes (causes double prefixes)
- Skip error handling
- Forget to clean up resources (connections, timers)
- Mix concerns (routes should not contain business logic)
- Hardcode configuration (use config.json)

---

**Document Maintenance**: Update this file when:

- Adding new modules
- Changing module structure
- Updating dependencies between modules
- Making architectural decisions
