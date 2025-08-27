# Posterrama AI Development Instructions

## 🎯 Project Overview

Posterrama is a Node.js/Express app that transforms screens into cinematic poster displays. It aggregates media from multiple sources (Plex, Jellyfin, TMDB, TVDB) and presents them in smooth, configurable slideshow modes.

## 🏗️ Architecture Patterns

### Core Structure

- **`server.js`** - Monolithic Express server (~8000 lines) with embedded API routes, auth, and config management
- **`sources/`** - Media source adapters with standardized class interfaces (`PlexSource`, `JellyfinSource`, etc.)
- **`middleware/`** - Centralized Express middleware in `middleware/index.js` (security, compression, CORS, metrics)
- **`utils/`** - Shared utilities (cache, logger, health checks, GitHub integration, metrics)
- **`public/`** - Frontend SPA with multiple modes (screensaver, wallart, admin panel)

### Configuration Management

```javascript
// Always use config.json as single source of truth
const config = require('./config.json');
// Schema validation via config.schema.json
// Auto-creates from config.example.json on first run
```

### Media Source Pattern

All sources implement consistent interface:

```javascript
class SourceName {
    constructor(serverConfig, dependencies...) { /* standardized params */ }
    async getMedia() { /* returns normalized media array */ }
    getMetrics() { /* performance tracking */ }
}
```

## 🔧 Critical Development Workflows

### Testing Commands

```bash
npm test                    # Run all tests (681 tests in 47 suites)
npm run test:coverage      # Generate coverage report (target: 87%+)
npm run lint               # ESLint + Prettier checks
npm run quality:all        # Full quality pipeline
```

### PM2 Process Management

```bash
pm2 start ecosystem.config.js    # Production deployment
pm2 logs posterrama-app          # View logs
pm2 restart posterrama-app       # Restart server
```

### Admin Setup Flow

1. First run auto-creates `.env` and `config.json` from examples
2. Navigate to `/admin/setup` for initial admin user creation
3. Admin panel at `/admin` with 2FA support

## 📊 API Conventions

### Route Organization

- **Public API**: `/get-config`, `/get-media`, `/health`
- **Admin API**: `/api/admin/*` (authenticated)
- **API v1 Aliases**: `/api/v1/*` redirects to main endpoints
- **Frontend Routes**: `/admin/*` (authenticated), `/` (public viewer)

### Response Patterns

```javascript
// Success responses
res.json({ success: true, data: result });
// Error responses
throw new ApiError(400, 'Descriptive message');
// Use asyncHandler() wrapper for async routes
```

### Authentication

- Session-based auth for web UI (`req.session.isAuthenticated`)
- API key auth via `Authorization: Bearer <token>` header
- 2FA support with TOTP (speakeasy)

## 🎨 Frontend Architecture

### Display Modes

- **Screensaver**: Single poster transitions (`/`)
- **Wallart**: Multi-poster grid with 13+ animation types
- **Admin Panel**: Configuration interface (`/admin`)

### Asset Versioning

All static assets use `?v=${version}` cache busting:

```javascript
// Auto-injected into HTML templates
script.js?v=1.9.5
style.css?v=1.9.5
```

## 🔍 Debugging & Monitoring

### Environment Variables

```bash
DEBUG=true              # Enable verbose logging
NODE_ENV=test          # Test mode with relaxed rate limits
SESSION_SECRET=xyz     # Required for sessions
```

### Health Monitoring

- `/health` - Basic health check
- `/health/detailed` - Comprehensive system status
- Automatic memory usage logging every 5 minutes
- Built-in metrics collection (`utils/metrics.js`)

## 🧪 Testing Conventions

### Test Structure

```
__tests__/
├── api/          # HTTP endpoint tests
├── middleware/   # Express middleware tests
├── sources/      # Media source integration tests
└── utils/        # Utility function tests
```

### Coverage Targets

- **Statements**: 87%+ (current: 85.91%)
- Use `jest.config.js` thresholds to prevent regressions
- Focus on `middleware/validation.js` (31% coverage) for quick wins

### Mock Patterns

```javascript
// Standard mocking in tests
jest.mock('../../utils/logger');
jest.mock('../../sources/plex');
// Use asyncHandler for route error handling
```

## 💡 Common Patterns

### Cache Management

```javascript
const { cacheManager } = require('./utils/cache');
await cacheManager.set(key, data, ttl);
const cached = await cacheManager.get(key);
```

### Error Handling

```javascript
const { ApiError } = require('./utils/errors');
// Consistent error classes with proper HTTP status codes
```

### Config Updates

```javascript
// Always validate against config.schema.json
// Use writeConfig() helper in server.js for persistence
```

## ⚠️ Critical Notes

- **Single server.js**: Most routes embedded in main file (~8000 lines)
- **No database**: Uses file-based config + memory cache + image cache directory
- **Auto-setup**: Missing config files auto-created from examples
- **Rate limiting**: Different limits for public/admin/test environments
- **Multi-source**: Media aggregated from multiple external APIs
- **Live config**: Admin changes update config.json and restart sources
