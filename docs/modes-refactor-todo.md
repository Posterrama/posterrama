# Modes Refactor – TODO Checklist

Purpose: split each display mode into its own self-contained page (no duplication), keep index.html minimal, and unify navigation/preview flows.

Last updated: 2025-10-15 (post Entry Route + SW registration pass)

## Status snapshot (Oct 15)

- Routes/page split completed for all three modes; navigation normalization bug covered by tests and fixed.
- Wallart is fully isolated (no legacy orchestrator); Screensaver still leans on legacy `script.js` for full behavior.
- Core navigation/helpers live in `public/core.js` and are subpath-safe; stamped assets wired for all mode pages.
- Entry Route behavior implemented: root (`/`) now serves landing or redirects per admin config; includes X-Forwarded-Prefix handling and tests.
- Lint/test/security pipeline is green; coverage ~92% statements across repo.
- Admin UI cleanup: all empty catch blocks in `public/admin.js` annotated; no-empty now passes (supports the refactor by reducing noise and risk while touching mode pages).

## Completed

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
- Server asset stamping wired for `core.js`, `wallart/wallart-display.js(.css)`, `screensaver/screensaver.js(.css)`
- Unified auto-exit/navigation via `Core.startAutoExitPoll` with subpath-safe behavior
- Basic tests:
    - Route tests for `/cinema`, `/wallart`, `/screensaver` (200 + HTML content-type)
    - URL building tests for `buildUrlForMode()` and navigation regression (`navigateToMode` leading slash)
    - Route tests assert stamped, per-mode assets are referenced for all three pages
    - Navigation regression test added after wallart→cinema missing-slash bug (commit: fix(navigation) + test)

- Wallart page bootstrap (no legacy orchestrator):
    - Ensures `window.appConfig`, `window.wallartConfig`, and `window.mediaQueue` are set before start
    - Device management initialized on wallart (`PosterramaDevice.init`) for heartbeats + WS live logs
    - Module exposes `__posterramaCurrentMedia`, `__posterramaCurrentMediaId`, `__posterramaPaused`, and minimal `__posterramaPlayback` (next/prev/pause/resume)
    - Debug parity: `client-logger` bridged to legacy `POSTERRAMA_DEBUG`; wallart now emits rich debug logs with `?debug=true`

- Screensaver stability:
    - Modular fallback implements rotation (fade/slide/Ken Burns) and uses multiple queue items
    - Page prefers legacy `script.js` orchestrator for now to preserve full behavior and logs; module is retained as fallback

- Index/landing cleanup (first pass):
    - Removed index auto-redirect and legacy inline wallart CSS (kept landing minimal)

## Open TODOs (organized by priority)

P1 — Core refactor completion (highest impact)

1. Screensaver extraction (no legacy bleed)

- [x] Move remaining logic from `public/script.js` (slideshow timers, Ken Burns, source switching) into `public/screensaver/screensaver.js`
- [x] Remove `script.js` include from `/screensaver` once feature parity is verified
- [x] Port any mode-specific styles out of global CSS (audit `style.css` for screensaver/wallart/cinema selectors)
    - Note: residual base styles remain in `style.css` intentionally (shared loader, base layout) — mode-specific CSS is now `screensaver/screensaver.css`.
    - Regression guard: `/screensaver` HTML must not contain `script.js`; tests added/extended.

2. Entry route decision for `/`

- [x] Implemented: `/` behavior configurable via admin UI (landing or redirect to active mode). Server handles X-Forwarded-Prefix, sets no-store on redirects, and broadcasts client navigation on target change. Tests added for redirect behavior and WS broadcast.

3. Service worker consistency

- [x] Centralize registration via `core.js` (auto-registers on pages that include `core.js`: cinema, wallart, screensaver). Existing per-page registration (admin, index) remains for redundancy. Minimal unit test added.
- [ ] Test cache-busting and update flow when switching modes (add integration test that navigates across modes and asserts controllerchange/update flow)

P2 — Isolation, previews, and tests

4. Admin preview isolation

- [ ] Add `preview-wallart.html/js/css` and `preview-screensaver.html/js/css` (or document why not needed)
- [ ] Audit/fix selector bleed (prefer classes over IDs)

5. Tests expansion

- [ ] 1–2 preview isolation tests to prevent CSS bleed
- [ ] Wallart unit tests: pause/resume halts refresh; `__posterramaPlayback` hooks trigger immediate refresh

6. Logging and metrics alignment

- [ ] Align device access log shape for all modes
- [ ] Verify hourly de-dup reset logic
- [ ] Optional: add per-mode hit counters

P3 — Cleanup and docs

7. Lint/cleanup

- [x] Remove blanket no-empty disables; annotate individual sites
- [x] public/script.js: empty catches annotated (done)
- [x] public/admin.js: empty catches annotated (done)
- [ ] Audit remaining `POSTERRAMA_DEBUG` gating for potential dead code
- [ ] After screensaver extraction: trim unused from `script.js`; delete file
- [ ] Run `npm run lint:fix` and manually resolve leftovers (post-extraction)

8. Docs

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

- Add dedicated preview pages (or document why avoided); ensure no selector bleed
- Wire to existing assets with stamped URLs; simple smoke test per preview

Phase 3 — Service worker consistency (1 day)

- Centralize registration via `core.js` or per-page with stamping
- Verify update flow and cache-busting during mode switches

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
