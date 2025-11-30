# Posterrama AI Agent Instructions

Posterrama (v2.9.x) is a Node.js/Express media server aggregation app. It unifies Plex, Jellyfin, TMDB, and local libraries into dynamic displays (Screensaver, Wallart, Cinema).

## Architecture & Patterns

### Core Structure

- **Entry Point**: `server.js` (~7k lines) is the main orchestrator. It initializes the environment, validates config, and mounts routes.
- **Route Factories**: Routes in `routes/` are typically exported as **factory functions** that accept dependencies (e.g., `createMediaRouter(config, logger)`).
    - _Pattern_: `const createXRouter = require('./routes/x'); app.use('/path', createXRouter(deps));`
- **Business Logic**:
    - `lib/`: Domain logic (e.g., `plex-helpers.js`, `jellyfin-helpers.js`).
    - `sources/`: Media server adapters (standardized interface: `fetchMedia`, `getMetrics`).
    - `utils/`: Shared utilities (`logger.js`, `cache.js`, `wsHub.js`).

### Key Mechanisms

- **Dependency Injection**: Most modules receive `config` and `logger` rather than importing global singletons.
- **Caching**: `utils/cache.js` implements a tiered `CacheManager` (L1 Memory -> L2 -> L3 Disk) with LRU eviction.
- **Async Handling**: Use `asyncHandler` middleware wrapper for all async route handlers to catch errors.
- **Configuration**:
    - stored in `config.json`.
    - Validated at startup via `config/validators.js`.
    - _Rule_: Schema changes require updates to `config.schema.json`, `config/validators.js`, and `config.example.json`.
- **Real-time**: `utils/wsHub.js` handles WebSocket connections for device management.

## Development Workflow

### Build & Run

- **Backend**: `npm start` (runs `server.js`).
- **Frontend**: `npm run dev` (Vite) or `npm run build` (Vite build).
- **Production**: `pm2 start ecosystem.config.js`.

### Testing Strategy

- **Backend Unit/Integration**: `npm test` (Jest).
- **Frontend**: `npm run test:frontend` (Vitest).
- **Quality**: `npm run quality:all` (runs lint, format, type-check, and tests).
- **Linting**: `npm run lint` (ESLint) and `npm run format` (Prettier).

## Critical Implementation Details

- **Logging**: Always use `utils/logger.js` (`logger.info`, `logger.error`). Do not use `console.log`.
- **HTTP Clients**: Use dedicated clients in `utils/` (`plex-http-client.js`, `jellyfin-http-client.js`) which handle retries and headers.
- **API Docs**: Swagger/OpenAPI definitions are in `server.js` (JSDoc comments) and `swagger.js`.

## Policy Addendum (2025-11-13)

The AI assistant MUST:

1. Respond only in English.
2. NOT modify `README.md` or other top-level docs automatically.
3. Prefer implementing code + tests over documentation edits.
4. Propose `README.md` diffs in chat for user confirmation before applying.
5. Treat configuration schema changes as requiring: schema edit, example update, validation update, and tests.
