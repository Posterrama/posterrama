# Posterrama – AI Agent Onboarding Guide

**Posterrama** (v2.9.4) is a Node.js/Express media server aggregation app that turns any screen into a dynamic poster gallery. It unifies Plex, Jellyfin, TMDB, and local libraries with three display modes (Screensaver, Wallart, Cinema), real-time device management over WebSocket, and comprehensive API documentation at `/api-docs`.

## Architecture Quick Reference

**Modular architecture** – Routes extracted to `routes/` directory, core logic in `lib/`, utilities in `utils/`. Main `server.js` (~5.6k lines) orchestrates initialization and route registration.

### Key Components

- **Routes**: Modular Express routers in `routes/` (admin-\*, api-\*, device-\*, media-\*)
- **Sources**: Media server adapters in `sources/` (plex.js, jellyfin.js, tmdb.js)
- **HTTP Clients**: Dedicated clients in `utils/` (plex-http-client.js, jellyfin-http-client.js)
- **Core Libraries**: Business logic in `lib/` (jellyfin-helpers.js, plex-helpers.js)
- **Utilities**: Shared utilities (logger.js, cache.js, wsHub.js, deviceStore.js)

### Key Features

- **Multi-Source Integration**: Plex, Jellyfin, TMDB with unified API endpoints
- **Advanced Caching**: Memory, disk, and HTTP caching with intelligent invalidation
- **Admin Interface**: Full configuration management, server monitoring, and genre filtering
- **Image Processing**: Lazy loading, optimization, fallback handling with custom SVG placeholders
- **API Documentation**: Comprehensive Swagger/OpenAPI documentation at `/api-docs`
- **Production Ready**: PM2 process management, comprehensive logging, health checks

## Build & Development Workflow

### Prerequisites

- **Node.js**: >=18.0.0 (confirmed working with Node 18+)
- **npm**: Package management and script execution
- **PM2**: Production process management (optional for development)

### Essential Commands

**Development Workflow:**

```bash
npm install           # Install dependencies
npm start            # Start development server on http://localhost:4000
npm test             # Run test suite (2400+ tests, 92%+ coverage)
npm run lint         # ESLint code quality checks
npm run format       # Prettier code formatting (auto-fix)
```

**Quality Assurance:**

```bash
npm run test:coverage      # Generate test coverage reports (target: 92%+)
npm run quality:all       # Complete quality pipeline (lint + format + test + security)
npm run deps:audit        # Security vulnerability scanning
```

**Production (PM2):**

```bash
pm2 delete posterrama && pm2 start ecosystem.config.js  # Full restart with .env reload
pm2 logs posterrama       # View logs
pm2 restart posterrama    # Quick restart (less reliable for .env changes)
```

## Quick Reference

**Core Files:**

- `server.js` – Main Express app, routes registration, Swagger at `/api-docs`
- `routes/` – Modular Express routers (admin-\*, api-\*, device-\*, media-\*)
- `sources/` – Media adapters: plex.js, jellyfin.js, tmdb.js (fetchMedia, getMetrics, resetMetrics)
- `utils/` – logger.js, cache.js, wsHub.js, deviceStore.js, \*-http-client.js
- `lib/` – jellyfin-helpers.js, plex-helpers.js

**Patterns:**

- **Logging**: `logger.info/warn/error/debug` (Winston, console redirected)
- **Caching**: `CacheManager` from utils/cache.js (memory/disk/HTTP with TTL)
- **HTTP**: Use utils/jellyfin-http-client.js, utils/plex-http-client.js
- **WebSocket**: `/ws/devices` via wsHub.sendCommandAwait(deviceId, {type, payload})

**Jellyfin Debug:**

```bash
# .env: JELLYFIN_HTTP_DEBUG=true
pm2 delete posterrama && pm2 start ecosystem.config.js
tail -f logs/combined.log | grep JellyfinHttpClient | jq -r '.message'
```

## Policy Addendum (2025-11-13)

The AI assistant MUST:

1. Respond only in English (no automatic language switching, even if the user uses another language, unless explicitly instructed to translate or answer in that language).
2. NOT modify `README.md` or other top-level docs automatically. Documentation changes must be explicitly requested by the user each time.
3. Prefer implementing code + tests over documentation edits when both are possible and the user has not explicitly requested docs.
4. When a feature impacts the README, propose the diff in the response (English) and wait for explicit confirmation before applying, unless the user explicitly said to update the README now.
5. Treat configuration schema changes as requiring: (a) schema edit, (b) example config consistency check, (c) validation path review, (d) at least one test covering new validation logic.

Enforcement: If an instruction conflicts with this addendum, clarify with the user before proceeding.
