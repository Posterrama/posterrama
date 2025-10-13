# Modes Refactor – TODO Checklist

Purpose: split each display mode into its own self-contained page (no duplication), keep index.html minimal, and unify navigation/preview flows.

Last updated: 2025-10-13

## Current baseline (implemented)

- Dedicated routes: `/cinema`, `/wallart`, `/screensaver`
- Direct switching between modes (subpath-aware) in `public/script.js`
- `cinema.html` with `cinema/cinema-display.js` and `cinema/cinema-display.css`

## Checklist

1. Freeze current behavior baseline

- [ ] Verify `/cinema`, `/wallart`, `/screensaver` render and live-switch correctly
- [ ] Capture 2–3 screenshots; note reload behavior from `device-mgmt.js`

2. Create shared core utilities (public/core.js)

- [ ] `fetchConfig(opts)` with no-cache headers
- [ ] `getActiveMode(cfg)` → `cinema | wallart | screensaver`
- [ ] `buildBasePath()` + `buildUrlForMode(mode)` (reverse-proxy/subpath safe)
- [ ] `navigateToMode(mode, { replace=true })` (debounced, single-flight)
- [ ] `throttleReload()` and `bootstrapLogger()`
- [ ] Export as `window.PosterramaCore`

3. Split mode-specific JS/CSS

- [ ] Screensaver: `public/screensaver/screensaver.js`, `public/screensaver/screensaver.css`
- [ ] Wallart: `public/wallart/wallart-display.js`, `public/wallart/wallart.css`
- [ ] Move mode logic out of `public/script.js` and mode styles out of shared CSS/inline
- [ ] Keep cinema as-is (already split)
- [ ] Each page includes only its own mode JS/CSS + core.js

4. Trim index.html to landing only

- [ ] Remove mode-detect script and inline wallart CSS
- [ ] Keep PWA/meta/promo content only
- [ ] Decide: (A) keep `/` as landing, or (B) 302 `/` → `/screensaver`

5. Wire assets with versioning

- [ ] Update `server.js` stamping to include:
    - `wallart/wallart-display.js(.css)`
    - `screensaver/screensaver.js(.css)`
    - `core.js` on all three mode routes
- [ ] Confirm cache headers and stamping for each route

6. Unify auto-exit/navigation

- [ ] Replace per-page inline logic with `core.navigateToMode()` for polling + live-apply
- [ ] Ensure subpath-aware behavior and a single timer per page

7. Admin preview isolation

- [ ] Ensure each mode’s preview loads only its CSS/JS
- [ ] Add `preview-wallart.html/js/css` and `preview-screensaver.html/js/css` if needed
- [ ] Fix selector bleed (prefer classes over IDs for shared overlay names)

8. Service worker consistency

- [ ] Register SW once per page (or in `core.js`), always with stamped URL
- [ ] Test update flow and cache-busting when switching modes

9. Logging and metrics

- [ ] Align device access logs for all three modes (consistent shape)
- [ ] Verify hourly de-dup reset logic
- [ ] Optional: lightweight hit counters per mode

10. Tests (Jest + supertest)

- [ ] Route tests: `/cinema`, `/wallart`, `/screensaver` → 200 and stamped assets
- [ ] Unit tests: `getActiveMode()`, `buildUrlForMode()`, `navigateToMode()`
- [ ] 1–2 preview isolation tests to prevent CSS bleed

11. Lint and cleanup pass

- [ ] Fix ESLint issues:
    - `no-empty` in `public/device-mgmt.js`, `public/preview-cinema.js`
    - `no-inner-declarations` in `public/script.js`
    - `no-useless-escape` in `server.js`
- [ ] Run `npm run lint:fix`; manually resolve leftovers

12. Migration notes (docs)

- [ ] Draft `docs/modes-refactor.md` with final structure, file map, and troubleshooting
- [ ] Add notes on proxies/subpaths, previews, and SW expectations

## Acceptance criteria

- Each route loads only its mode’s JS/CSS and DOM
- Direct switching is instant and subpath-safe
- No CSS/JS bleed between modes or previews
- Lint/test pipeline passes

## Pointers

- Mode pages: `public/cinema.html`, `public/wallart.html`, `public/screensaver.html`
- Mode scripts: `public/cinema/cinema-display.js`, (to create) `public/wallart/wallart-display.js`, `public/screensaver/screensaver.js`
- Shared script to add: `public/core.js`
- Server stamping: `server.js` (routes: `/cinema`, `/wallart`, `/screensaver`)
