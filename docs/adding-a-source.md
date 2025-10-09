# Adding a new media source

This codebase uses adapter classes per source with a small, consistent contract so they’re easy to add and test.

Core files to study:

- `sources/jellyfin.js`, `sources/plex.js` — real adapters
- `sources/example.js` — minimal template
- `utils/jellyfin-http-client.js`, `utils/plex-http-client.js` — HTTP helpers
- `utils/example-http-client.js`, `utils/example-processors.js` — example client + item processor
- `utils/cache.js`, `utils/logger.js` — preferred caching and logging

Adapter contract:

- constructor(serverConfig, getClient, processItem, getLibraries, shuffleArray, rtMinScore, isDebug)
- async fetchMedia(libraryNames, type, count)
- getMetrics(), resetMetrics()
- Optional: getAvailableRatings()

Checklist:

1. Create `sources/<name>.js` based on `sources/example.js`.
2. Use a dedicated HTTP client in `utils/` (create one if needed) instead of raw fetch/axios. See `utils/example-http-client.js`.
3. Paginate: fetch all items per library, then filter across the full set (see Jellyfin adapter for the pattern).
4. Normalize items in `processItem` so the UI gets consistent fields (title, poster path/URL, rating, year, etc.).
    - See `utils/example-processors.js` for a starter.
5. Maintain `this.metrics` and compute `filterEfficiency` in `getMetrics()`.
6. Shuffle with `shuffleArray` and cap to `count`.
7. Wire into `server.js` routes and add to Swagger docs in `swagger.js` if you expose new endpoints/options.
8. Add tests: copy `__tests__/sources/example.test.js` and extend with your source’s behaviors.

Quick dev checks:

- GET `/health`, `/get-config` to validate server and config
- Open `/api-docs` for Swagger
- Logs: `logs/combined.log` (tests keep logs in-memory via `logger.memoryLogs`)

Notes:

- `server.js` auto-creates `.env` and `config.json` and never overrides `NODE_ENV`.
- Posters are cached to `image_cache/`. Respect existing cache headers and paths.

Minimal usage sketch (inside your adapter constructor call site):

```js
const { createExampleClient } = require('../utils/example-http-client');
const { processExampleItem } = require('../utils/example-processors');

source = new MyNewSource(
    server,
    createExampleClient, // getClient(server)
    processExampleItem, // processItem(raw, ctx)
    getMyNewLibraries, // like getJellyfinLibraries -> Map(name -> {id})
    shuffleArray,
    config.rottenTomatoesMinimumScore,
    isDebug
);
```
