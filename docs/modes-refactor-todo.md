# Modes Refactor – TODO Checklist

Purpose: split each display mode into its own self-contained page (no duplication), keep index.html minimal, and unify navigation/preview flows.

Last updated: 2025-10-14

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

## Open TODOs (actionable)

1. Freeze baseline artifacts

- [ ] Capture 2–3 screenshots of each mode and note reload behavior from `public/device-mgmt.js`

2. Finish mode isolation (no legacy bleed)

- [ ] Screensaver: consolidate remaining logic from `public/script.js` (slideshow timers, Ken Burns orchestration, source switching) into `public/screensaver/screensaver.js` and then remove `script.js` include from `/screensaver`
- [ ] Move any remaining mode-specific styles out of shared/inline locations (audit global `style.css` for wallart / cinema selectors)
- [x] Wallart is isolated (no `script.js` on `/wallart`)

3. Trim `public/index.html` to be a landing-only page

- [x] Remove the mode-detect redirect script
- [x] Remove inline wallart CSS block
- [ ] Decide behavior for `/`: (A) keep as landing, or (B) 302 to `/screensaver` on server (pending product decision)

4. Admin preview isolation

- [ ] Add `preview-wallart.html/js/css` and `preview-screensaver.html/js/css` (or document why not needed)
- [ ] Audit and fix selector bleed (prefer classes over IDs for shared overlay names)

5. Service worker consistency

- [ ] Register SW once per page (or centralize in `core.js`) with a stamped URL (current state: SW logic still only in legacy context)
- [ ] Test update flow and cache-busting when switching modes

6. Logging and metrics

- [ ] Align device access logs for all three modes (consistent shape)
- [ ] Verify hourly de-dup reset logic
- [ ] Optional: add lightweight hit counters per mode

7. Tests (expand)

- [x] Route tests: assert stamped assets are referenced in `/cinema`, `/wallart`, `/screensaver`
- [x] Regression tests: `buildUrlForMode()` + `navigateToMode()` (leading slash normalization) in `__tests__/public/core.navigation.test.js`
- [x] Unit test for `getActiveMode()` (straightforward conditional mapping)
- [ ] 1–2 preview isolation tests to prevent CSS bleed

8. Debug and diagnostics

- [x] Replace remaining `POSTERRAMA_DEBUG` checks in modules with `window.logger.isDebug()`; then remove the bridge in `client-logger.js` (PHASE 2 complete: wallart, screensaver, script.js migrated; bridge removal deferred until admin preview audited)
- [ ] Add minimal wallart unit tests: pause/resume halts refresh; `__posterramaPlayback` hooks trigger an immediate refresh
- [ ] Verify device-mgmt heartbeat payload on wallart includes title/thumb when available

9. Lint and cleanup pass

- [x] Remove blanket `/* eslint-disable no-empty */` in `public/script.js` & `public/admin.js` (surfaced individual empty blocks)
- [ ] Stage batch annotations/removals of remaining empty catch blocks (target ~25 per PR) – Phase 1 (10) + Batch 2 (~20) + Batch 3 (~10) done in script.js; proceed with Batch 4
- [ ] Audit remaining `POSTERRAMA_DEBUG` gating for potential dead code
- [ ] After screensaver extraction, trim unused functions in `script.js` and eventually delete file
- [ ] Run `npm run lint:fix`; manually resolve leftovers

10. Migration docs

- [ ] Draft `docs/modes-refactor.md` with final structure, file map, and troubleshooting
- [ ] Include notes on proxies/subpaths, previews, and SW expectations

11. Navigation hardening follow-ups

- [x] Fix wallart→cinema missing slash (core.js normalization)
- [x] Add regression test suite for navigation
- [x] Add edge-case test for nested deep subpath (`/a/b/c/wallart`) and origin-only paths (`/`)

## Acceptance criteria

- Each route loads only its mode’s JS/CSS and DOM
- Direct switching is instant and subpath-safe
- No CSS/JS bleed between modes or previews
- Lint/test pipeline passes

## Pointers

- Mode pages: `public/cinema.html`, `public/wallart.html`, `public/screensaver.html`
- Mode scripts: `public/cinema/cinema-display.js`, `public/wallart/wallart-display.js`, `public/screensaver/screensaver.js`
- Shared script: `public/core.js`
- Server stamping: `server.js` (routes: `/cinema`, `/wallart`, `/screensaver`)
