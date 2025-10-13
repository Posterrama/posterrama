# Modes Refactor – TODO Checklist

Purpose: split each display mode into its own self-contained page (no duplication), keep index.html minimal, and unify navigation/preview flows.

Last updated: 2025-10-13

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
    - URL building test for `buildUrlForMode()`

## Open TODOs (actionable)

1. Freeze baseline artifacts

- [ ] Capture 2–3 screenshots of each mode and note reload behavior from `public/device-mgmt.js`

2. Finish mode isolation (no legacy bleed)

- [ ] Remove remaining mode logic dependencies from `public/script.js` on mode pages; ensure each page includes only its own mode JS/CSS + `core.js`
- [ ] Move any remaining mode-specific styles out of shared/inline locations

3. Trim `public/index.html` to be a landing-only page

- [ ] Remove the mode-detect redirect script
- [ ] Remove inline wallart CSS block
- [ ] Decide behavior for `/`: (A) keep as landing, or (B) 302 to `/screensaver` and implement on server

4. Admin preview isolation

- [ ] Add `preview-wallart.html/js/css` and `preview-screensaver.html/js/css` (or document why not needed)
- [ ] Audit and fix selector bleed (prefer classes over IDs for shared overlay names)

5. Service worker consistency

- [ ] Register SW once per page (or centralize in `core.js`) with a stamped URL
- [ ] Test update flow and cache-busting when switching modes

6. Logging and metrics

- [ ] Align device access logs for all three modes (consistent shape)
- [ ] Verify hourly de-dup reset logic
- [ ] Optional: add lightweight hit counters per mode

7. Tests (expand)

- [ ] Route tests: assert stamped assets are referenced in `/cinema`, `/wallart`, `/screensaver`
- [ ] Unit tests for `getActiveMode()` and `navigateToMode()`
- [ ] 1–2 preview isolation tests to prevent CSS bleed

8. Lint and cleanup pass

- [ ] Fix ESLint rule violations instead of suppressing:
    - `no-empty` in `public/device-mgmt.js`, `public/preview-cinema.js`
    - `no-inner-declarations` in `public/script.js`
    - `no-useless-escape` in `server.js`
- [ ] Run `npm run lint:fix`; manually resolve leftovers

9. Migration docs

- [ ] Draft `docs/modes-refactor.md` with final structure, file map, and troubleshooting
- [ ] Include notes on proxies/subpaths, previews, and SW expectations

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
