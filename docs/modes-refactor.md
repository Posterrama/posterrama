# Modes Refactor – Architecture Documentation

**Status**: Complete (Oct 2025)  
**Version**: 2.5.2+

## Overview

Posterrama's display modes (Cinema, Wallart, Screensaver) are now fully isolated, self-contained pages with dedicated display modules. The legacy `script.js` orchestrator has been removed, and each mode loads only its required assets.

**Index.html is now a pure landing shell** - all mode-specific DOM, logic, and controls have been moved to their respective mode pages (cinema.html, wallart.html, screensaver.html).

### Key Goals Achieved

- **Isolation**: Each mode has its own HTML, CSS, and JS - no cross-contamination
- **Direct Switching**: Mode transitions are instant and subpath-safe
- **Preview Support**: Admin preview pages use iframes for proper isolation
- **Service Worker**: Centralized registration with cache-busting and update handling
- **Entry Route**: Configurable root behavior (landing page or redirect to active mode)
- **Clean Landing**: index.html contains only PWA/meta tags and promo box (no mode markup)

## Architecture

### File Structure

```
public/
├── index.html                    # Landing page (root route) - PURE SHELL ONLY
│                                 # Contains: PWA meta, promo box, loader
│                                 # No mode DOM (no layers, controls, poster-wrapper)
├── cinema.html                   # Cinema mode page
├── wallart.html                  # Wallart mode page
├── screensaver.html              # Screensaver mode page
├── preview-wallart.html          # Admin preview (wallart)
├── preview-screensaver.html      # Admin preview (screensaver)
├── preview-shell.html            # Preview iframe shell (pv-* namespace)
│
├── core.js                       # Shared utilities (all modes)
│   ├── fetchConfig()            # Fetch /get-config with no-cache
│   ├── getActiveMode()          # Determine active mode from config
│   ├── buildUrlForMode()        # Subpath-safe URL building
│   ├── navigateToMode()         # Debounced mode navigation
│   ├── startAutoExitPoll()      # Keep page in correct mode
│   ├── throttleReload()         # Throttled page reload (SW updates)
│   └── bootstrapLogger()        # Client logger initialization
│
├── landing.js                    # Landing page logic (root only)
│   ├── showPromoBox()           # Display promo content
│   ├── hideLoader()             # Hide spinner
│   └── Guards: never runs on /cinema, /wallart, /screensaver
│
├── device-mgmt.js                # Device pairing & WebSocket
├── client-logger.js              # Client-side logging (POSTERRAMA_DEBUG)
├── lazy-loading.js               # Image lazy loading
├── sw.js                         # Service Worker (caching, offline)
│
├── cinema/
│   ├── cinema-display.js        # Cinema poster display & ambilight
│   ├── cinema-display.css       # Cinema-specific styles
│   └── cinema-bootstrap.js      # Initial media fetch & loader hide
│
├── wallart/
│   ├── wallart-display.js       # Wallart poster rotation & controls
│   └── wallart.css              # Wallart-specific styles
│
└── screensaver/
    ├── screensaver.js           # Screensaver transitions & Ken Burns
    └── screensaver.css          # Screensaver-specific styles
```

### Route Mapping

| Route                  | HTML File                  | Display Module                              | Description                              |
| ---------------------- | -------------------------- | ------------------------------------------- | ---------------------------------------- |
| `/` or `/index.html`   | `index.html`               | `landing.js`                                | Landing page or redirect (config-driven) |
| `/cinema`              | `cinema.html`              | `cinema-display.js` + `cinema-bootstrap.js` | Cinema mode (single poster, ambilight)   |
| `/wallart`             | `wallart.html`             | `wallart-display.js`                        | Wallart mode (rotation, controls)        |
| `/screensaver`         | `screensaver.html`         | `screensaver.js`                            | Screensaver mode (Ken Burns, clock)      |
| `/preview-wallart`     | `preview-wallart.html`     | `wallart-display.js`                        | Admin preview (wallart)                  |
| `/preview-screensaver` | `preview-screensaver.html` | `screensaver.js`                            | Admin preview (screensaver)              |
| `/preview-shell`       | `preview-shell.html`       | `preview-shell.js`                          | Preview iframe wrapper                   |

### Server Routes (server.js)

Each mode route:

1. Serves the corresponding HTML file
2. Injects asset versioning stamps (`?v={{ASSET_VERSION}}`)
3. Sets appropriate cache headers
4. Handles `.html` extension aliases

Root route (`/`):

- Reads `config.json` fresh each request (no restart required)
- Respects `rootRoute.behavior` setting (landing or redirect)
- Handles `X-Forwarded-Prefix` for reverse proxies
- Sets `Cache-Control: no-store` on redirects

## Mode-Specific Implementation

### Cinema Mode

**Files**: `cinema.html`, `cinema/cinema-display.js`, `cinema/cinema-bootstrap.js`

**Flow**:

1. `cinema.html` loads → early guard checks if cinema enabled
2. `cinema-bootstrap.js` fetches `/get-config` and `/get-media?count=1`
3. Dispatches `mediaUpdated` CustomEvent with media data
4. `cinema-display.js` listens for event and updates:
    - Poster image
    - Footer (title, year, resolution, audio, aspect ratio)
    - Ambilight effect
    - Hides loader

**Key Features**:

- Single poster display (no rotation)
- Ambilight background effect
- No on-screen controls
- Auto-exit if cinema disabled (via `startAutoExitPoll`)

**Bootstrap Pattern**:

```javascript
// cinema-bootstrap.js
const media = await fetchMedia();
window.dispatchEvent(
    new CustomEvent('mediaUpdated', {
        detail: { media: media[0] },
    })
);
document.getElementById('loader').style.display = 'none';
```

### Wallart Mode

**Files**: `wallart.html`, `wallart/wallart-display.js`, `wallart/wallart.css`

**Flow**:

1. `wallart.html` loads → sets `window.appConfig`, `window.wallartConfig`, `window.mediaQueue`
2. `wallart-display.js` initializes rotation and controls
3. Exposes `window.__posterramaPlayback` (next, prev, pause, resume)
4. Device management handles WebSocket commands

**Key Features**:

- Poster rotation with configurable interval
- On-screen controls (prev, pause/resume, next)
- Clock widget support
- ClearLogo display
- Ken Burns animation option
- Exposed playback API for device commands

**Playback API**:

```javascript
window.__posterramaPlayback = {
    next: () => {
        /* unpause + immediate refresh */
    },
    prev: () => {
        /* unpause + immediate refresh */
    },
    pause: () => {
        /* set paused state */
    },
    resume: () => {
        /* unpause + immediate refresh */
    },
};
```

### Screensaver Mode

**Files**: `screensaver.html`, `screensaver/screensaver.js`, `screensaver/screensaver.css`

**Flow**:

1. `screensaver.html` loads → sets initial state
2. `screensaver.js` initializes transitions (fade/slide/Ken Burns)
3. Rotation uses multiple queue items
4. Similar controls and widget support as wallart

**Key Features**:

- Multiple transition modes (fade, slide, Ken Burns)
- Clock widget support
- ClearLogo display
- On-screen controls (prev, pause/resume, next)
- Modular fallback orchestration

**Transition System**:

- Layer-based transitions (layer-a ↔ layer-b)
- Configurable duration and effects
- Multiple items in queue for variety

### Landing Page (index.html)

**Status**: Pure marketing shell (as of Oct 2025)

**Purpose**: PWA manifest, SEO metadata, promo box for mode selection

**What it contains**:

- `#loader` - Initial loading spinner
- `#error-message` - Error display
- `#promo-box` - Marketing content with mode selection buttons

**What it does NOT contain**:

- No mode-specific DOM (no layers, controls, poster-wrapper, clock widget)
- No MODE_HINT detection logic
- No wallart/cinema/screensaver markup
- All mode DOM lives in dedicated mode pages

**Behavior**:

- Can serve as landing page (shows promo) OR
- Redirect to active mode (via admin config: `rootRoute.behavior`)
- landing.js handles promo display and loader hiding
- No mode orchestration happens here

**Migration Note**: Prior to Oct 2025, index.html contained screensaver layers, controls, and MODE_HINT logic. These were removed to achieve true isolation.

## Shared Utilities (core.js)

### fetchConfig()

```javascript
const config = await Core.fetchConfig();
// Returns full config with no-cache headers
```

### getActiveMode(config)

```javascript
const mode = Core.getActiveMode(config);
// Returns: 'cinema' | 'wallart' | 'screensaver'
```

### buildUrlForMode(mode, search)

```javascript
const url = Core.buildUrlForMode('cinema');
// Returns: '/cinema' or '/subpath/cinema' (subpath-safe)
```

### navigateToMode(mode, options)

```javascript
Core.navigateToMode('wallart', { replace: true });
// Debounced, subpath-aware navigation
```

### startAutoExitPoll(options)

```javascript
Core.startAutoExitPoll({
    currentMode: 'cinema',
    intervalMs: 15000,
});
// Polls config and redirects if mode disabled
```

## Service Worker

**File**: `public/sw.js`

**Registration**: Centralized in `core.js`

- Auto-registers on pages that include `core.js`
- Uses stamped URL when `window.__swUrl` provided
- Listens for `controllerchange` → triggers throttled reload

**Caching Strategy**:

```javascript
STATIC_ASSETS = [
    '/',
    '/index.html',
    '/cinema',
    '/wallart',
    '/screensaver',
    '/core.js',
    '/device-mgmt.js',
    '/client-logger.js',
    '/cinema/cinema-display.js',
    '/cinema/cinema-display.css',
    '/wallart/wallart-display.js',
    '/wallart/wallart.css',
    '/screensaver/screensaver.js',
    '/screensaver/screensaver.css',
    // ... fonts, icons, etc.
];
```

**Navigation Fallback**:

- `/cinema` → falls back to `/cinema.html`
- `/wallart` → falls back to `/wallart.html`
- `/screensaver` → falls back to `/screensaver.html`
- Other routes → fall back to `/index.html`

**Update Flow**:

1. New SW installed → `controllerchange` event fires
2. `core.js` throttles reload (prevents rapid reloads)
3. Page reloads to use new SW and cached assets

## CSS Isolation

### Shared Element IDs

Each mode uses common element IDs for similar purposes:

| ID                       | Purpose             | Used By              |
| ------------------------ | ------------------- | -------------------- |
| `loader`                 | Loading spinner     | All modes            |
| `error-message`          | Error display       | All modes            |
| `info-container`         | Media info wrapper  | All modes            |
| `poster-wrapper`         | Poster container    | All modes            |
| `poster`                 | Main poster element | All modes            |
| `layer-a`, `layer-b`     | Background layers   | Wallart, Screensaver |
| `clock-widget-container` | Clock display       | Wallart, Screensaver |
| `controls-container`     | Playback controls   | Wallart, Screensaver |
| `clearlogo-container`    | ClearLogo image     | Wallart, Screensaver |

**Isolation Strategy**:

- Each mode page loads independently (separate browsing contexts)
- Preview pages use iframes for DOM isolation
- Preview shell uses `pv-*` prefixed IDs (no conflicts)
- Mode-specific styles scope via `data-mode` attribute:
    ```css
    body[data-mode='wallart'] #loader {
        /* wallart-specific */
    }
    ```

### Scoping Best Practices

**Good** (scoped):

```css
.wallart-mode #loader {
    /* styles */
}
body[data-mode='cinema'] #poster {
    /* styles */
}
```

**Avoid** (global):

```css
#loader {
    /* affects all modes if pages somehow co-exist */
}
```

## Entry Route Configuration

**Location**: Admin UI → Settings → Entry Route

**Options**:

1. **Landing Page** (default)
    - Shows promo box with mode selection
    - URL: `/` or `/index.html`
    - File: `public/index.html` + `landing.js`

2. **Redirect to Active Mode**
    - Immediate redirect to cinema/wallart/screensaver
    - Determined by config (`cinemaMode` or `wallartMode.enabled`)
    - No intermediate landing page

**Configuration**:

```json
{
    "rootRoute": {
        "behavior": "landing", // or "redirect"
        "target": null // auto-determined from active modes
    }
}
```

**Server Behavior**:

- Root route reads `config.json` fresh each request
- No server restart required for changes
- Handles `X-Forwarded-Prefix` for reverse proxies
- WebSocket broadcasts changes to connected devices

## Device Management

**File**: `public/device-mgmt.js`

**Features**:

- Device pairing via QR code
- WebSocket connection to `/ws/devices`
- Command handling (power, mode switch, playback controls)
- Heartbeat system (reports current media)
- Live log streaming

**Integration**:

- Included in all mode pages
- Sets `window.PosterramaDevice` API
- Exposes current media via `window.__posterramaCurrentMedia`
- Playback commands call `window.__posterramaPlayback` hooks

## Admin Preview System

**Purpose**: Allow testing mode appearance without full-screen device

**Components**:

1. **Preview Shell** (`preview-shell.html`)
    - Iframe wrapper with toolbar
    - PiP mode support
    - Uses `pv-*` namespace (no ID conflicts)

2. **Preview Content** (`preview-wallart.html`, `preview-screensaver.html`)
    - Identical to mode pages but served at different route
    - Includes preview-specific JS for frame communication
    - Uses same display modules as main mode pages

**Isolation**:

- Preview shell IDs: `pv-shell`, `pv-toolbar`, `pv-iframe`, `pv-pip`
- Preview content IDs: same as mode pages (isolated by iframe)
- No CSS bleed between shell and content

## Subpath / Reverse Proxy Support

**Detection**: `core.js` uses `document.querySelector('base[href]')`

**Affected Functions**:

- `buildBasePath()` → returns `/` or `/subpath/`
- `buildUrlForMode(mode)` → returns `/subpath/cinema`
- `navigateToMode(mode)` → uses subpath-aware URLs

**Server Requirements**:

- Set `X-Forwarded-Prefix` header if behind reverse proxy
- Root route respects this header for redirects
- Asset stamping includes subpath in URLs

**Example**:

```nginx
location /posterrama/ {
    proxy_pass http://localhost:4000/;
    proxy_set_header X-Forwarded-Prefix /posterrama;
}
```

## Testing

### Test Coverage

**Integration Tests**:

- Route tests (cinema, wallart, screensaver serve correct HTML)
- Preview route tests (stamped assets, no script.js)
- Root route redirect tests (landing vs redirect behavior)
- Service Worker registration test (core.js)
- Navigation tests (buildUrlForMode, subpath safety)

**Unit Tests**:

- Wallart playback tests (15 tests: pause/resume, next/prev)
- CSS isolation tests (11 tests: shared IDs, iframe isolation)

**Test Files**:

```
__tests__/
├── api/
│   ├── cinema-routes.test.js
│   ├── wallart-routes.test.js
│   ├── screensaver-routes.test.js
│   ├── preview-routes.test.js
│   └── root-route.redirect.test.js
├── css-isolation.test.js
├── wallart-playback.test.js
└── utils/
    └── core.test.js
```

### Running Tests

```bash
# All tests
npm test

# Specific suite
npm test -- css-isolation.test.js

# With coverage
npm run test:coverage

# Watch mode
npm test -- --watch
```

## Troubleshooting

### Spinner Never Disappears (Cinema)

**Symptoms**: Cinema page loads but shows spinner indefinitely

**Causes**:

1. `/get-config` or `/get-media` endpoint failing
2. `cinema-bootstrap.js` not loaded/executed
3. No media available in library

**Debug Steps**:

```javascript
// Open browser console
console.log(window.PosterramaCore); // Should be defined
console.log(await fetch('/get-config')); // Should return 200
console.log(await fetch('/get-media?count=1')); // Should return media
```

**Solutions**:

- Check browser console for errors
- Verify media sources configured in admin
- Check server logs for API errors
- Clear browser cache and reload

### Promo Box Shows on Mode Pages

**Symptoms**: Landing page promo appears on `/cinema`, `/wallart`, or `/screensaver`

**Causes**:

1. `landing.js` guards failed (shouldn't happen with current implementation)
2. Wrong HTML file served (server route issue)
3. Browser cached old version

**Debug Steps**:

```bash
# Check which HTML is served
curl http://localhost:4000/cinema | grep -o '<title>[^<]*'
# Should show: <title>Posterrama Cinema

# Check for landing.js include
curl http://localhost:4000/cinema | grep landing.js
# Should be empty (no landing.js on cinema page)
```

**Solutions**:

- Hard refresh (Ctrl+Shift+R)
- Clear Service Worker cache
- Check server logs for route handling
- Verify `cinema.html` doesn't include `landing.js`

### Service Worker Not Updating

**Symptoms**: Changes to CSS/JS not visible after deployment

**Causes**:

1. Asset version not incremented
2. Service Worker cache not invalidating
3. Browser holding old SW version

**Debug Steps**:

```javascript
// Check SW version
navigator.serviceWorker.getRegistration().then(reg => {
    console.log('Active SW:', reg.active);
    console.log('Waiting SW:', reg.waiting);
});

// Check asset versions
console.log(window.__assetVersions);
```

**Solutions**:

```bash
# Force SW update (browser console)
navigator.serviceWorker.getRegistration().then(reg => {
    reg.unregister().then(() => location.reload());
});

# Increment version in server.js
# getAssetVersions() uses file mtime, so touch files:
touch public/sw.js
pm2 restart posterrama
```

### Mode Switching Not Working

**Symptoms**: Clicking mode buttons doesn't navigate

**Causes**:

1. `core.js` not loaded
2. JavaScript errors blocking navigation
3. Config fetch failing

**Debug Steps**:

```javascript
// Test navigation
window.PosterramaCore.navigateToMode('wallart');

// Test config fetch
window.PosterramaCore.fetchConfig().then(console.log);

// Test URL building
window.PosterramaCore.buildUrlForMode('cinema');
```

**Solutions**:

- Check browser console for errors
- Verify `core.js` loaded and executed
- Test `/get-config` endpoint directly
- Clear browser cache

### Auto-Exit Not Working

**Symptoms**: Page stays in disabled mode

**Causes**:

1. `startAutoExitPoll` not called
2. Polling interval too long (default 15s)
3. Config fetch failing

**Debug Steps**:

```javascript
// Check if auto-exit running
console.log(window.__posterramaAutoExitTimer);

// Manually trigger check
window.PosterramaCore.startAutoExitPoll({
    currentMode: 'cinema',
    intervalMs: 5000,
});
```

**Solutions**:

- Verify `startAutoExitPoll` called in mode HTML
- Reduce interval for faster response
- Check `/get-config` endpoint availability

### Preview Iframe Not Loading

**Symptoms**: Preview page shows empty frame or errors

**Causes**:

1. Preview route not returning correct HTML
2. CORS/CSP blocking iframe
3. Preview JS not loaded

**Debug Steps**:

```bash
# Check preview route
curl http://localhost:4000/preview-wallart | head -20

# Check for errors in browser console (iframe context)
# Open preview-shell.html and inspect iframe
```

**Solutions**:

- Verify preview routes in `server.js`
- Check CSP headers (should allow same-origin frames)
- Test preview URL directly (not in iframe)
- Clear browser cache

### Reverse Proxy / Subpath Issues

**Symptoms**: Assets 404, navigation broken when behind proxy

**Causes**:

1. `X-Forwarded-Prefix` not set
2. `<base href>` not configured
3. Absolute URLs used instead of relative

**Debug Steps**:

```javascript
// Check base path detection
console.log(window.PosterramaCore.buildBasePath());
// Should return '/subpath/' if behind proxy

// Check URL building
console.log(window.PosterramaCore.buildUrlForMode('cinema'));
// Should include subpath
```

**Solutions**:

```nginx
# Nginx config
location /posterrama/ {
    proxy_pass http://localhost:4000/;
    proxy_set_header X-Forwarded-Prefix /posterrama;
    proxy_set_header Host $host;
}
```

```html
<!-- Add to HTML if needed -->
<base href="/posterrama/" />
```

## Migration Guide

### From Legacy script.js

If you have customizations in old `script.js`:

1. **Identify Mode**: Determine if code is cinema/wallart/screensaver specific
2. **Find Target**: Locate equivalent function in new display module
3. **Migrate Logic**: Copy logic to appropriate module
4. **Test**: Verify functionality in target mode

**Common Migrations**:

| Legacy Location            | New Location                                  |
| -------------------------- | --------------------------------------------- |
| `script.js` timer logic    | `screensaver.js` or `wallart-display.js`      |
| `script.js` poster updates | `cinema-display.js` (updateCinemaDisplay)     |
| `script.js` Ken Burns      | `screensaver.js` (applyKenBurnsEffect)        |
| `script.js` controls       | `wallart-display.js` (\_\_posterramaPlayback) |

### Adding a New Mode

1. **Create HTML**: `public/newmode.html`
2. **Create Module**: `public/newmode/newmode-display.js`
3. **Create Styles**: `public/newmode/newmode-display.css`
4. **Add Route**: In `server.js`, add GET route with asset stamping
5. **Update SW**: Add mode to `STATIC_ASSETS` in `sw.js`
6. **Add Config**: Update config schema for new mode enable flag
7. **Test**: Add route test and isolation test

## Performance Considerations

### Asset Loading

- **Critical CSS**: Inlined in HTML or loaded with high priority
- **Non-critical JS**: Loaded at end of `<body>`
- **Fonts**: Preconnect to Google Fonts for faster load
- **Images**: Lazy loaded via `lazy-loading.js`

### Service Worker Caching

- **Static Assets**: Cached indefinitely with version stamps
- **Config**: No-cache headers (`/get-config`)
- **Media**: Standard cache with HTTP headers
- **HTML**: Network-first for latest content

### Runtime Performance

- **Debouncing**: Navigation and config polling debounced
- **Throttling**: SW reload throttled (10s minimum)
- **Event Delegation**: Single listeners on containers
- **RAF**: Animations use requestAnimationFrame

## Security Notes

### Device Pairing

- Secrets hashed with bcrypt
- WebSocket requires valid device ID + secret
- ACK pattern for command confirmation

### Content Security Policy

- Same-origin frames allowed (for previews)
- External resources: Google Fonts only
- Inline scripts: Minimal, scoped

### API Endpoints

- Config endpoint: Read-only, no auth (device context)
- Admin endpoints: Session-based auth
- Device WS: Secret-based auth per device

## Future Improvements

### Potential Enhancements

1. **Mode-Prefixed IDs**: `cinema-loader`, `wallart-loader` for stronger isolation
2. **CSS Modules**: Scoped styles with build step
3. **TypeScript**: Type safety for core utilities
4. **E2E Tests**: Playwright/Cypress for full user flows
5. **Performance Monitoring**: Real User Monitoring (RUM)

### Known Limitations

1. ~~**Shared IDs**: All modes use same IDs (isolated by browsing context)~~ ✓ Resolved - each mode has dedicated HTML
2. **No Hot Reload**: Dev requires manual refresh
3. **Single Active SW**: Can't have multiple SW versions simultaneously
4. **Config Polling**: 15s delay for auto-exit (by design)

## References

- **Project Structure**: [DEVELOPMENT.md](./DEVELOPMENT.md)
- **API Documentation**: [/api-docs](http://localhost:4000/api-docs) (Swagger)
- **Adding Sources**: [adding-a-source.md](./adding-a-source.md)
- **Coverage Exclusions**: [coverage-exclusions.md](./coverage-exclusions.md)
- **Todo Tracker**: [modes-refactor-todo.md](./modes-refactor-todo.md)

## Changelog

### 2025-10-15: Index.html Pure Landing Shell

- ✅ Removed all mode-specific DOM from index.html
    - Removed: screensaver layers, clock widget, ClearLogo, info container, controls, branding
    - Removed: MODE_HINT class detection logic
    - Result: 94 lines removed (314 → 220 lines)
- ✅ index.html now contains only: loader, error-message, promo-box
- ✅ Mode-specific markup lives exclusively in dedicated mode pages
- ✅ landing.js unchanged (still targets #loader and #promo-box)
- ✅ Tests pass, lint clean

### 2025-10-15: Modes Refactor Complete

- ✅ Deleted legacy `script.js` (25 lines stub removed)
- ✅ All modes migrated to dedicated display modules
- ✅ CSS isolation tests added (11 tests)
- ✅ Wallart playback tests added (15 tests)
- ✅ Service Worker centralized in core.js
- ✅ Entry Route configuration implemented
- ✅ Preview system with iframe isolation
- ✅ POSTERRAMA_DEBUG audit (no dead code)
- ✅ Documentation complete

**Test Coverage**: 1256/1258 passing (99.8%)  
**Lint Status**: Clean ✓
