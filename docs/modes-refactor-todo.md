# Modes Refactor – TODO Checklist

Purpose: split each display mode into its own self-contained page (no duplication), keep index.html minimal, and unify navigation/preview flows.

Last updated: 2025-10-15 (post cinema spinner fix + script.js cleanup)

## Status snapshot (Oct 15)

- Routes/page split completed for all three modes; navigation normalization bug covered by tests and fixed.
- Wallart is fully isolated (no legacy orchestrator). Screensaver extraction completed — no legacy `script.js` bleed on `/screensaver` (verified by route tests).
- Core navigation/helpers live in `public/core.js` and are subpath-safe; stamped assets wired for all mode pages and previews.
- Entry Route behavior implemented: root (`/`) now serves landing or redirects per admin config; includes X-Forwarded-Prefix handling and tests.
- Service Worker: centralized registration in `core.js`; controllerchange triggers throttled reload; stamped `sw.js` honored. Unit + integration-lite tests added.
- Admin preview pages added: `/preview-wallart` and `/preview-screensaver` with stamped assets; isolation tests assert correct assets and absence of legacy orchestrator.
- **Cinema spinner fix**: Added `cinema-bootstrap.js` to fetch initial media and dispatch `mediaUpdated` event; spinner now hides on load. SW precaches mode routes with path-based fallbacks.
- **script.js cleanup**: Removed 6000+ lines of deprecated code with unclosed comment blocks; file now minimal (25 lines) and passes lint. Removed from `.eslintignore`.
- Lint/test/security pipeline is green; coverage ~92% statements across repo.
- Admin/UI cleanup: empty catch blocks annotated where needed; no-empty passes.

## Completed ✅

- Dedicated routes: `/cinema`, `/wallart`, `/screensaver`
- Direct switching between modes (subpath-aware) available and validated in practice
- `cinema.html` with `cinema/cinema-display.js` and `cinema/cinema-display.css`
- Shared core utilities in `public/core.js`:
    - `fetchConfig()` with no-cache headers
    - `getActiveMode(cfg)` → `cinema | wallart | screensaver`
    - `buildBasePath()` + `buildUrlForMode(mode)` (reverse-proxy/subpath safe)
    - `navigateToMode(mode, { replace=true })` (debounced)
    - `throttleReload()` and `bootstrapLogger()`
    - Exported as `window.PosterramaCore`
- Mode modules split:
    - Screensaver: `public/screensaver/screensaver.js`, `public/screensaver/screensaver.css`
    - Wallart: `public/wallart/wallart-display.js`, `public/wallart/wallart.css`
    - Screensaver extraction finalized: timers/transitions/rotation moved; `/screensaver` no longer includes `script.js`.
- Server asset stamping wired for `core.js`, `wallart/wallart-display.js(.css)`, `screensaver/screensaver.js(.css)` and preview assets.
- Unified auto-exit/navigation via `Core.startAutoExitPoll` with subpath-safe behavior
- Basic tests:
    - Route tests for `/cinema`, `/wallart`, `/screensaver` (200 + HTML content-type)
    - URL building tests for `buildUrlForMode()` and navigation regression (`navigateToMode` leading slash)
    - Route tests assert stamped, per-mode assets are referenced for all three pages
    - Preview route tests for `/preview-wallart` and `/preview-screensaver` assert stamped assets and no legacy `script.js` includes (also validates `.html` aliases)
    - Navigation regression test added after wallart→cinema missing-slash bug (commit: fix(navigation) + test)

- Wallart page bootstrap (no legacy orchestrator):
    - Ensures `window.appConfig`, `window.wallartConfig`, and `window.mediaQueue` are set before start
    - Device management initialized on wallart (`PosterramaDevice.init`) for heartbeats + WS live logs
    - Module exposes `__posterramaCurrentMedia`, `__posterramaCurrentMediaId`, `__posterramaPaused`, and minimal `__posterramaPlayback` (next/prev/pause/resume)
    - Debug parity: `client-logger` bridged to legacy `POSTERRAMA_DEBUG`; wallart now emits rich debug logs with `?debug=true`

- Screensaver stability:
    - Modular fallback implements rotation (fade/slide/Ken Burns) and uses multiple queue items

- Cinema bootstrap and spinner fix:
    - Created `cinema-bootstrap.js` to fetch initial config and media
    - Dispatches `mediaUpdated` event to trigger cinema-display.js
    - Loader properly hidden after media loads
    - Service Worker precaches `/cinema`, `/wallart`, `/screensaver` with path-based fallbacks
    - Cinema fully migrated off legacy orchestrator

- Index/landing cleanup (first pass):
    - Removed index auto-redirect and legacy inline wallart CSS (kept landing minimal)
    - Landing.js scoped to root page only with multiple guards (never runs on mode routes)

- Legacy orchestrator removed:
    - Deleted `public/script.js` (previously 6000+ lines of deprecated code)
    - All modes now use dedicated display modules
    - No runtime references to script.js remain

## Open TODOs (organized by priority) 🔜

P1 — Core refactor completion (highest impact)

2. Entry route decision for `/`

- [x] Implemented: `/` behavior configurable via admin UI (landing or redirect to active mode). Server handles X-Forwarded-Prefix, sets no-store on redirects, and broadcasts client navigation on target change. Tests added for redirect behavior and WS broadcast.

3. Service worker consistency

- [x] Centralize registration via `core.js` (auto-registers on pages that include `core.js`: cinema, wallart, screensaver). Existing per-page registration (admin, index) remains for redundancy. Minimal unit test added.
- [x] Test cache-busting and update flow: added integration-lite test simulating controllerchange; core now listens for `controllerchange` and triggers a throttled reload. Registration prefers stamped `window.__swUrl` when provided.

P2 — Isolation, previews, and tests

4. Admin preview isolation

- [x] Add `preview-wallart.html/js/css` and `preview-screensaver.html/js/css`
- [x] Add server stamping routes for `/preview-wallart` and `/preview-screensaver`
- [x] Add preview route tests (stamped assets, no legacy `script.js`, .html aliases)
- [x] Audit/fix selector bleed (prefer classes over IDs)
    - Audit completed via CSS isolation tests
    - Documented all shared IDs across modes (loader, poster, info-container, etc.)
    - Verified preview shell uses separate pv-\* namespace
    - Confirmed iframe isolation prevents CSS bleed
    - Future refactor: consider mode-prefixed IDs (cinema-loader, wallart-loader) for stronger isolation

5. Tests expansion

- [x] Preview route tests added
- [x] CSS isolation tests (11 tests covering shared IDs, iframe isolation, mode scoping)
- [x] Wallart unit tests: pause/resume halts refresh; `__posterramaPlayback` hooks trigger immediate refresh (15 tests)

6. Logging and metrics alignment

- [ ] Align device access log shape for all modes
- [ ] Verify hourly de-dup reset logic
- [ ] Optional: add per-mode hit counters

P3 — Cleanup and docs

7. Lint/cleanup

- [x] Remove blanket no-empty disables; annotate individual sites
- [x] public/script.js: empty catches annotated (done)
- [x] public/admin.js: empty catches annotated (done)
- [x] Previews formatted and linted; server preview stamping formatted and annotated
- [x] Audit remaining `POSTERRAMA_DEBUG` gating for potential dead code
    - Audit complete: only used in screensaver.js and wallart-display.js as fallback when logger.isDebug() unavailable
    - Also set by client-logger.js based on localStorage('posterrama_debug')
    - No dead code found; pattern is intentional backwards-compat
- [x] Cinema migration off `script.js` (cinema already using cinema-display.js and cinema-bootstrap.js)
- [x] Delete `public/script.js` and update references; run `npm run lint` ✓ passes8. Docs

- [ ] Draft `docs/modes-refactor.md` with final structure, file map, troubleshooting
- [ ] Include notes on proxies/subpaths, previews, and SW expectations

## Acceptance criteria

- Each route loads only its mode’s JS/CSS and DOM
- Direct switching is instant and subpath-safe
- No CSS/JS bleed between modes or previews
- Lint/test pipeline passes

## Plan of approach (incremental, low-risk)

Phase 1 — Screensaver extraction (2–3 days)

- Create a minimal orchestration layer in `public/screensaver/screensaver.js` mirroring `script.js` behavior (timers, transitions, queues)
- Feature-by-feature lift-and-shift with toggle flag to fall back to legacy if needed
- Add a small test to validate rotation and that multiple items cycle without leaks

Phase 2 — Admin preview isolation (1–2 days)

- Add dedicated preview pages; ensure no selector bleed
- Wire to existing assets with stamped URLs; smoke test per preview
- Status: routes + assets + basic tests completed

Phase 3 — Service worker consistency (1 day)

- Centralize registration via `core.js` or per-page with stamping
- Verify update flow and cache-busting during mode switches
- Status: completed (controllerchange handling + tests green)

Phase 4 — Cleanup and docs (1–2 days)

- Remove `script.js` include from `/screensaver`; prune dead code; run lint:fix
- Draft `docs/modes-refactor.md` with file map, subpath rules, SW behavior

Success criteria per phase

- Phase 1: `/screensaver` no longer includes `script.js`; parity smoke test passes
- Phase 2: Previews load without affecting mode pages; basic isolation tests pass
- Phase 3: SW updates reliably across mode switches; no stale assets
- Phase 4: Lint/test pipeline green; doc added and linked

Risks & mitigations

- SW caching complexity → use stamped URLs everywhere; add a manual cache-bust command in dev
- Legacy code dependencies in `script.js` → lift incrementally with a feature flag to fall back
- Selector bleed → prefer BEM-like class scoping and avoid global IDs in shared overlays

## Pointers

- Mode pages: `public/cinema.html`, `public/wallart.html`, `public/screensaver.html`
- Mode scripts: `public/cinema/cinema-display.js`, `public/wallart/wallart-display.js`, `public/screensaver/screensaver.js`
- Shared script: `public/core.js`
- Server stamping: `server.js` (routes: `/cinema`, `/wallart`, `/screensaver`)
