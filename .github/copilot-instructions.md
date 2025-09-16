# Posterrama Repository - AI Agent Onboarding Guide

## Repository Overview

**Posterrama** is a Node.js/Express media server aggregation application (v2.5.2) that provides unified poster galleries from multiple media sources. It acts as a centralized interface for browsing movies and TV shows across Plex, Jellyfin, TMDB, and TVDB libraries with intelligent caching, filtering, and responsive design.

### Key Features

- **Multi-Source Integration**: Plex, Jellyfin, TMDB, TVDB with unified API endpoints
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
npm install           # Install dependencies (681 total packages)
npm start            # Start development server on http://localhost:4000
npm test             # Run 681 tests across 47 suites (expect some failures)
npm run lint         # ESLint code quality checks (expect 20+ errors currently)
npm run format       # Prettier code formatting (auto-fix)
```

**Quality Assurance:**

```bash
npm run test:coverage      # Generate test coverage reports (target: 87%+)
npm run quality:all       # Complete quality pipeline (lint + format + test + security)
npm run deps:audit        # Security vulnerability scanning (8 known vulnerabilities)
npm run deps:health       # Dependency health analysis
```

**Production Deployment:**

```bash
npm run release:patch     # Automated patch release with git tagging
npm run push             # Deploy to production without version bump
```

## Posterrama – AI agent quickstart (v2.5.2)

Purpose: make code changes fast without guesswork. This repo is a Node.js/Express app that aggregates media from Plex/Jellyfin/TMDB/TVDB, serves an admin UI, and drives devices over WebSocket.

Architecture (files to know):

- server.js – single Express app. Auto-creates .env and config.json on first run, reloads .env (never overrides NODE_ENV), wires routes, Swagger at /api-docs, and boots WS hub.
- sources/ (plex.js, jellyfin.js, tmdb.js, tvdb.js) – adapters with a common shape: fetchMedia(libraryNames, type, count), getMetrics(), resetMetrics(). They compute filterEfficiency and maintain metrics.
- utils/logger.js – Winston logger; console.\* is redirected to logger. In tests, console noise is suppressed and logs are kept in-memory for admin. Use logger.info/warn/error/debug.
- utils/cache.js – in-memory cache with TTL, ETag, optional persistence; provides CacheManager and initializeCache/cacheMiddleware. Prefer this over ad‑hoc maps.
- utils/wsHub.js – device WebSocket hub at /ws/devices. Single active connection per device, ACK pattern via sendCommandAwait(..., {timeoutMs}). Auth uses deviceStore.verifyDevice.
- utils/deviceStore.js – JSON-backed device registry with secret hashing, pairing codes, per-device settings overrides.
- public/ – admin and display assets. server.js does cache‑busting via content mtime.

Run and test:

- Node >= 18. npm install → npm start (http://localhost:4000). Health: GET /health. Media: /get-media. Docs: /api-docs.
- npm test, npm run test:coverage. Lint/format: npm run lint, npm run lint:fix, npm run format, npm run format:check.
- Useful scripts: npm run config:validate, npm run deps:security-audit, npm run deps:health, npm run quality:all, npm run hooks:setup.

Patterns and conventions:

- Logging: import utils/logger and call logger.debug/info/warn/error. For admin live feed, logs are kept in memory (logger.memoryLogs) and streamed via logger.events.
- Caching: use utils/cache CacheManager. Example flow: if (!cache.has(key)) cache.set(key, data, ttlMs); then read via cache.get(key)?.value. Avoid reinventing ETag/TTL.
- Source adapters: follow sources/jellyfin.js style (paginate, gather all items, then filter/shuffle; update this.metrics; expose getAvailableRatings when helpful). Keep adapter pure; network I/O via dedicated http clients in utils/\*-http-client.js.
- WebSocket control: init hub with wsHub.init(server, { path: '/ws/devices', verifyDevice }); use wsHub.sendCommandAwait(deviceId, {type, payload}) for actions; use wsHub.sendApplySettings(deviceId, override) for live per-device settings.
- Config: server copies config.example.json → config.json and ensures SESSION_SECRET in .env (auto‑generates under PM2 when missing). Don’t override NODE_ENV from .env.
- Images: posters cached to image_cache/. If adding new image flows, respect this directory and existing cache headers.

Adding a new media source:

1. Create sources/<name>.js implementing fetchMedia(), getMetrics(), resetMetrics(). 2) Reuse utils/cache for heavy calls. 3) Wire into server.js routes and Swagger. 4) Add tests under **tests**/sources/ using Jest + supertest patterns.

Quick checks while developing:

- curl http://localhost:4000/health, curl http://localhost:4000/get-config, open /api-docs.
- Logs: tail logs/combined.log; in tests, rely on in‑memory logger and avoid asserting on console.

Integration touchpoints:

- Plex/Jellyfin API usage is encapsulated (utils/plex-http-client.js, utils/jellyfin-http-client.js). Prefer these helpers over raw fetch/axios.
- Admin/Web UI relies on versioned assets; when adding new files in public/, ensure server.js cache‑busting list includes them if critical.
- For new sources, starter utilities exist: utils/example-http-client.js and utils/example-processors.js.

Reference map: server.js, sources/, utils/logger.js, utils/cache.js, utils/wsHub.js, utils/deviceStore.js, config/, public/.

Last verified: 2025‑09 (repo v2.5.2). If anything seems off (paths/endpoints), search the named files first, then adjust here.

- **utils/cache.js**: Multi-tier caching (memory/disk) with TTL and size management

## Policy Addendum (2025-09-16)

The AI assistant MUST:

1. Respond only in English (no automatic language switching, even if the user uses another language, unless explicitly instructed to translate or answer in that language).
2. NOT modify `README.md` or other top-level docs automatically. Documentation changes must be explicitly requested by the user each time.
3. Prefer implementing code + tests over documentation edits when both are possible and the user has not explicitly requested docs.
4. When a feature impacts the README, propose the diff in the response (English) and wait for explicit confirmation before applying, unless the user explicitly said to update the README now.
5. Treat configuration schema changes as requiring: (a) schema edit, (b) example config consistency check, (c) validation path review, (d) at least one test covering new validation logic.

Enforcement: If an instruction conflicts with this addendum, clarify with the user before proceeding.
