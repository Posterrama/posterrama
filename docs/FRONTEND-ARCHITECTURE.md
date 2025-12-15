# Posterrama Frontend Architecture

**Version:** 2.9.9
**Last Updated:** December 14, 2025

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [File Structure](#file-structure)
4. [Display Modes](#display-modes)
5. [Core Utilities](#core-utilities)
6. [State Management](#state-management)
7. [Build System](#build-system)
8. [Development Workflow](#development-workflow)
9. [Code Patterns](#code-patterns)
10. [Testing](#testing)

---

## Overview

Posterrama's frontend is a **Multi-Page Application (MPA)** built with **vanilla JavaScript** (no framework). It consists of three primary display modes (Screensaver, Wallart, Cinema) plus an admin interface for configuration.

**Key Characteristics:**

- **No Build Step:** Static assets are served directly from `public/`
- **Vanilla JS:** No React/Vue/Angular - pure JavaScript with IIFE module pattern
- **Event-Driven:** CustomEvents, BroadcastChannel, WebSocket for inter-component communication
- **PWA-Enabled:** Service Worker for offline caching and installability
- **Responsive:** Mobile-first design with adaptive layouts

---

## Technology Stack

| Technology             | Purpose                   | Version |
| ---------------------- | ------------------------- | ------- |
| **Vanilla JavaScript** | Core logic (ES6+)         | -       |
| **CSS3**               | Styling (no preprocessor) | -       |
| **Service Worker**     | Offline caching, PWA      | v2.2.6  |
| **WebSocket**          | Real-time device control  | -       |
| **Fetch API**          | HTTP requests             | -       |

**Browser Support:**

- Chrome/Edge 79+
- Firefox 72+
- Safari 13+
- No IE11 support (uses ES6+ features)

---

## File Structure

```
public/
├── index.html # Landing page (mode selector)
├── login.html # Admin login
├── admin.html # Admin dashboard (26,564 LOC - TO BE SPLIT)
├── setup.html # Device setup flow
├── 2fa-verify.html # 2FA verification
│
├── Display Modes
│ ├── screensaver.html # Screensaver mode entry point
│ ├── wallart.html # Wallart mode entry point
│ ├── cinema.html # Cinema mode entry point
│ ├── screensaver/
│ │ ├── screensaver.js # Screensaver display logic (1,144 LOC)
│ │ └── screensaver.css # Screensaver styles
│ ├── wallart/
│ │ ├── wallart-display.js # Wallart grid layout logic (2,474 LOC)
│ │ ├── wallart.css # Wallart styles
│ │ └── wallart-keyboard.js # Keyboard shortcuts
│ └── cinema/
│ ├── cinema-display.js # Cinema display logic (2,070 LOC)
│ ├── cinema-bootstrap.js # Cinema initialization (1,125 LOC)
│ ├── cinema-ui.js # Cinema UI controls (884 LOC)
│ └── cinema.css # Cinema styles
│
├── Core Modules (New - Extracted 2025-11-15)
│ ├── error-handler.js # Global error handler (127 LOC)
│ ├── mode-redirect.js # Mode switching logic (152 LOC)
│ ├── display-mode-init.js # Display mode initialization (32 LOC)
│ └── screensaver-bootstrap.js # Screensaver init (177 LOC)
│
├── Utilities (Legacy - Global Window Objects)
│ ├── core.js # Core utilities (548 LOC)
│ ├── device-mgmt.js # Device management (2,513 LOC - TO BE SPLIT)
│ ├── utils.js # Shared helpers
│ ├── lazy-loading.js # Image lazy loading
│ ├── client-logger.js # Client-side logging
│ └── notify.js # Toast notifications
│
├── Admin (Monolith - TO BE SPLIT)
│ ├── admin.js # Admin dashboard logic (26,564 LOC!)
│ └── admin.css # Admin styles (15,503 LOC!)
│
├── Assets
│ ├── style.css # Global styles
│ ├── icons/ # PWA icons
│ ├── favicon.ico # Favicon
│ └── manifest.json # PWA manifest
│
└── Service Worker
 └── sw.js # Service Worker (800 media item cache)
```

---

## Display Modes

### 1. Screensaver Mode

**Purpose:** Simple slideshow with clock widget and automatic media rotation

**Entry Point:** `screensaver.html`
**Logic:** `screensaver/screensaver.js` (1,144 LOC)
**Bootstrap:** `screensaver-bootstrap.js` (177 LOC)

**Features:**

- Automatic media queue fetching (12 items)
- Clock widget with customizable position
- Fade transitions between posters
- Service Worker integration for offline caching
- Auto-exit polling (checks if mode should switch)

**Initialization Flow:**

```
1. Load screensaver-bootstrap.js (module)
2. Force Service Worker update
3. Fetch config from /get-config
4. Initialize device management (optional)
5. Fetch media queue from /get-media
6. Start PosterramaScreensaver.start()
7. Hide loader, start slideshow
```

**Key Functions:**

- `startScreensaver()` - Main initialization
- `ensureConfig()` - Load config into window.appConfig
- `ensureMediaQueue()` - Fetch media into window.mediaQueue

---

### 2. Wallart Mode

**Purpose:** Grid layout with hero poster rotation and music mode support

**Entry Point:** `wallart.html`
**Logic:** `wallart/wallart-display.js` (2,474 LOC)

**Features:**

- Responsive grid layout (dynamic column/row calculation)
- Hero poster rotation (large poster + grid posters)
- Music mode (album art display)
- Keyboard shortcuts (arrow keys, spacebar)
- Density settings (low, medium, high, very high)
- Mixed media support (movies + TV shows)

**Layout Algorithm:**

```javascript
// wallart-display.js
function calculateLayout(density, viewport) {
    // 1. Determine base poster width based on density
    // 2. Calculate columns = floor(viewport.width / posterWidth)
    // 3. Calculate rows based on aspect ratio
    // 4. Determine if hero poster should be shown
    // 5. Return layout object with dimensions
}
```

**Initialization Flow:**

```
1. Mode redirect check (via mode-redirect.js)
2. Load config and verify wallart enabled
3. Calculate grid layout based on viewport
4. Fetch media queue
5. Render hero poster + grid
6. Start rotation timer
7. Load promo overlay (if enabled)
```

---

### 3. Cinema Mode

**Purpose:** Immersive single-poster display with metadata overlay

**Entry Point:** `cinema.html`
**Logic:** `cinema/cinema-display.js` (2,070 LOC), `cinema-bootstrap.js` (1,125 LOC)

**Features:**

- Full-screen poster display
- Metadata overlay (title, year, rating, plot)
- Auto-rotation with configurable duration
- Seamless transitions
- Remote control via WebSocket
- Device-specific overrides

**Initialization Flow:**

```
1. Early guard: check if cinema mode enabled
2. Load display-mode-init.js for device init + auto-exit
3. Bootstrap cinema display
4. Fetch single media item
5. Render poster + metadata
6. Start auto-rotation timer
```

**Remote Control:**

- WebSocket commands: `nextPoster`, `prevPoster`, `pause`, `play`
- Device ID from localStorage (via device-mgmt.js)

---

## Core Utilities

### core.js (548 LOC)

**Purpose:** Shared utility functions exposed via `window.PosterramaCore`

**Key Functions:**

```javascript
window.PosterramaCore = {
 // Config management
 fetchConfig(extra = {}) → Promise<Object>,

 // Mode detection
 getActiveMode(cfg) → 'screensaver' | 'wallart' | 'cinema',

 // Navigation
 buildUrlForMode(mode) → string,
 navigateToMode(mode) → void,

 // Auto-exit polling (mode switching check)
 startAutoExitPoll({ currentMode, intervalMs }) → void,

 // Service Worker
 registerServiceWorker() → Promise<void>,

 // Promo overlay
 loadPromoOverlay(cfg) → void,
};
```

**Usage Pattern:**

```javascript
// Fetch config with device headers
const cfg = await window.PosterramaCore.fetchConfig();

// Navigate to different mode
window.PosterramaCore.navigateToMode('wallart');

// Start auto-exit polling (checks every 15s if mode should change)
window.PosterramaCore.startAutoExitPoll({
    currentMode: 'cinema',
    intervalMs: 15000,
});
```

---

### device-mgmt.js (2,513 LOC - TO BE SPLIT)

**Purpose:** Device registration, heartbeat, WebSocket, and pairing UI

**Key Responsibilities:**

- Device identity (localStorage + IndexedDB)
- Device registration with server
- Heartbeat mechanism (keep-alive)
- WebSocket connection for remote control
- Pairing overlay UI
- Command handling

**Planned Split:**

```
device-management/
├── device-identity.js # localStorage + IndexedDB (~400 LOC)
├── device-network.js # Registration, heartbeat (~600 LOC)
├── device-websocket.js # WebSocket, commands (~700 LOC)
├── device-ui.js # Pairing overlay, setup (~600 LOC)
└── device-commands.js # Command handlers (~600 LOC)
```

**Exposed API:**

```javascript
window.PosterramaDevice = {
 init(cfg) → void,
 getState() → { deviceId, installId, hardwareId },
 sendCommand(cmd) → Promise<void>,
 updatePresence() → Promise<void>,
};
```

---

### mode-redirect.js (152 LOC - NEW)

**Purpose:** Automatic mode switching logic (extracted from inline scripts)

**Key Functions:**

```javascript
// Check if we should redirect to different mode
await checkModeRedirect('wallart', '__wallartModeVerified');

// Load promo overlay if enabled
await loadPromoOverlayIfEnabled();

// Utility functions
isPreviewMode() → boolean
isOnModePage() → boolean
buildModeUrl(mode) → string
fetchConfig() → Promise<Object>
getActiveMode(config) → 'screensaver' | 'wallart' | 'cinema'
```

---

### error-handler.js (127 LOC - NEW)

**Purpose:** Global error catching and telemetry

**Features:**

- Catches uncaught errors (`window.onerror`)
- Catches unhandled promise rejections (`unhandledrejection`)
- Rate limiting (max 50 errors per session)
- Error sanitization (truncate to 1000 chars)
- Server telemetry (`POST /api/telemetry/error`)

**Usage:**

```javascript
// Auto-initialized when imported
import './error-handler.js';

// Manual error logging
import { logError } from './error-handler.js';
logError(new Error('Something went wrong'), {
    context: 'media-fetch',
    userId: 123,
});
```

---

## State Management

**Current Approach:** Global `window.*` properties (30+ globals)

**Key Global State:**

```javascript
window.appConfig; // Current configuration
window.mediaQueue; // Media items array
window.__posterramaPaused; // Playback paused flag
window.__wallartModeVerified; // Mode verification flag
window.MODE_HINT; // Server-side mode hint
window.IS_PREVIEW; // Preview mode flag
window.PosterramaCore; // Core utilities
window.PosterramaDevice; // Device management
window.PosterramaScreensaver; // Screensaver module
```

**️ Technical Debt:** Global state is fragmented and unpredictable.

**Recommended Migration:** Zustand or Redux Toolkit (see FRONTEND-ANALYSIS Part 4)

---

## Build System

Posterrama serves frontend assets directly from `public/`.

- No bundler-driven build pipeline is required to run or deploy.
- JavaScript is a mix of legacy IIFE-style globals (`window.*`) and newer module-style patterns in a few places.

If you need minification or bundling, treat it as an optional future enhancement rather than an assumed part of the runtime.

---

## Development Workflow

### Local Development

```bash
# Start backend server (serves frontend from public/)
npm start

# Access app
http://localhost:4000
```

### Testing

```bash
npm test
```

---

## Code Patterns

### 1. IIFE Module Pattern (Legacy)

```javascript
// core.js
(function () {
    const Core = {};

    Core.fetchConfig = async function () {
        // ...
    };

    // Export to global namespace
    window.PosterramaCore = Core;
})();
```

**Pros:** No build step required, works in all browsers
**Cons:** Pollutes global namespace, no tree shaking, no type safety

---

### 2. ES Module Pattern (New)

```javascript
// mode-redirect.js
export async function checkModeRedirect(currentMode, verifiedFlag) {
    // ...
}

export function isPreviewMode() {
    // ...
}
```

**Usage:**

```html
<script type="module">
    import { checkModeRedirect } from './mode-redirect.js';
    await checkModeRedirect('wallart', '__wallartModeVerified');
</script>
```

**Pros:** Clean exports, better IDE support
**Cons:** Requires `type="module"` in HTML

---

### 3. Event-Driven Communication

```javascript
// Dispatch custom event
window.dispatchEvent(
    new CustomEvent('posterrama:mode-changed', {
        detail: { mode: 'cinema' },
    })
);

// Listen for event
window.addEventListener('posterrama:mode-changed', event => {
    console.log('Mode changed to:', event.detail.mode);
});
```

**Used For:**

- Mode switching notifications
- Media queue updates
- Device status changes

---

### 4. BroadcastChannel (Cross-Tab Communication)

```javascript
const bc = new BroadcastChannel('posterrama-sync');

// Send message
bc.postMessage({ type: 'config-updated' });

// Receive message
bc.onmessage = event => {
    if (event.data.type === 'config-updated') {
        location.reload();
    }
};
```

**Used For:**

- Admin config changes (notify display modes)
- Cross-tab state synchronization

---

### 5. WebSocket (Real-Time Control)

```javascript
// device-mgmt.js
const ws = new WebSocket(`wss://${host}/ws/devices`);

ws.onmessage = event => {
    const cmd = JSON.parse(event.data);
    if (cmd.type === 'nextPoster') {
        // Handle command
    }
};

// Send command
ws.send(JSON.stringify({ type: 'heartbeat', deviceId: 'abc123' }));
```

**Used For:**

- Device remote control
- Heartbeat keep-alive
- Admin → device commands

---

## Testing

### Current State

**Test runner:** Jest (`npm test`)

**Frontend-related coverage:** tests under `__tests__/public/` (focused on browser-facing JS/CSS behaviors).

---

### Recommended Testing Strategy

**Unit/Integration Tests (Jest):**

- Prefer testing public-facing behavior via JSDOM where feasible.
- Keep tests close to the existing structure under `__tests__/public/`.

**E2E Tests (Playwright):**

```javascript
// __tests__/frontend/e2e/mode-switching.spec.js
import { test, expect } from '@playwright/test';

test('should switch from screensaver to wallart', async ({ page }) => {
    // 1. Load screensaver mode
    await page.goto('/screensaver');
    await expect(page.locator('body[data-mode="screensaver"]')).toBeVisible();

    // 2. Enable wallart mode via admin
    await page.goto('/admin');
    await page.click('[data-testid="wallart-toggle"]');
    await page.click('[data-testid="save-button"]');

    // 3. Verify redirect to wallart
    await page.waitForURL('/wallart');
    await expect(page.locator('body[data-mode="wallart"]')).toBeVisible();
});
```

---

## Common Tasks

### Add a New Display Mode

1. Create `public/new-mode.html`
2. Create `public/new-mode/new-mode-display.js`
3. Create `public/new-mode/new-mode.css`
4. Add mode detection to `core.js`:

```javascript
Core.getActiveMode = function (cfg) {
    if (cfg.newModeEnabled) return 'new-mode';
    // ... existing logic
};
```

5. Add route in `server.js`:

```javascript
app.get('/new-mode', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/new-mode.html'));
});
```

---

### Debug Mode Switching Issues

1. Enable debug logging:

```javascript
window.debugLog = (event, data) => {
    console.log(`[DEBUG] ${event}`, data);
};
```

2. Check mode verification flags:

```javascript
console.log('Wallart verified:', window.__wallartModeVerified);
```

3. Check auto-exit polling:

```javascript
// Should log every 15s
window.PosterramaCore.startAutoExitPoll({ currentMode: 'cinema', intervalMs: 15000 });
```

---

### Add Global Utility Function

**Option 1: Add to core.js (Legacy)**

```javascript
// core.js
Core.newFunction = function () {
    // ...
};
```

**Option 2: Create New Module (Recommended)**

```javascript
// public/my-utility.js
export function myNewFunction() {
    // ...
}
```

Then import where needed:

```html
<script type="module">
    import { myNewFunction } from './my-utility.js';
    myNewFunction();
</script>
```

---

## Performance Optimization

### Current Metrics

- **Bundle Size:** 3.6MB unminified (admin.js 1.3MB, admin.css 460KB)
- **Load Time:** ~3-5s TTI (Time to Interactive)
- **Performance Baseline:** (automated audit tooling removed)

### Quick Wins

1. **Enable Minification:** Optional (no build step today)
2. **Extract Inline Scripts:** Done (mode-redirect.js, error-handler.js)
3. **Add `type="module"` to scripts:** TODO
4. **Code splitting:** TODO (requires admin.js split)
5. **Image optimization:** TODO (WebP/AVIF support)

---

## Security Considerations

1. **XSS Prevention:**

- Audit all `innerHTML` usage
- Use `textContent` when possible
- Sanitize user input

2. **Authentication:**

- Admin routes require JWT token
- 2FA support available
- Token stored in HttpOnly cookie (recommended vs localStorage)

3. **WebSocket Security:**

- Device ID validation
- Rate limiting on commands
- TLS/WSS in production

---

## Browser Compatibility

| Feature          | Chrome | Firefox | Safari | Edge |
| ---------------- | ------ | ------- | ------ | ---- |
| ES6 Modules      | 61+    | 60+     | 10.1+  | 16+  |
| Service Worker   | 40+    | 44+     | 11.1+  | 17+  |
| WebSocket        | 43+    | 48+     | 10+    | 14+  |
| BroadcastChannel | 54+    | 38+     | 15.4+  | 79+  |
| Fetch API        | 42+    | 39+     | 10.1+  | 14+  |

**Minimum Supported:**

- Chrome/Edge 79+
- Firefox 72+
- Safari 13+

---

## Troubleshooting

### Issue: Mode redirect loop

**Symptom:** Page keeps reloading
**Cause:** Mode verification flag not set
**Fix:**

```javascript
// Ensure flag is set after mode check
window.__wallartModeVerified = true;
```

---

### Issue: Media queue empty

**Symptom:** "No media available"
**Cause:** `/get-media` endpoint returning empty array
**Fix:**

1. Check backend logs for errors
2. Verify media sources configured (Plex/Jellyfin/TMDB)
3. Check `config.json` for correct source settings

---

### Issue: WebSocket connection fails

**Symptom:** Device commands not working
**Cause:** WebSocket connection refused
**Fix:**

1. Check device registration: `window.PosterramaDevice.getState()`
2. Verify WebSocket endpoint: `wss://host/ws/devices`
3. Check backend WebSocket server logs
4. Ensure device ID in localStorage

---

## Resources

- **Architecture (diagrams):** [docs/ARCHITECTURE-DIAGRAMS.md](./ARCHITECTURE-DIAGRAMS.md)
- **Frontend Analysis:** [docs/FRONTEND-ANALYSIS.md](./FRONTEND-ANALYSIS.md)
- **API Documentation:** http://localhost:4000/api-docs
- **GitHub Repository:** https://github.com/Posterrama/posterrama

---

**End of Architecture Documentation**

**Last Updated:** November 15, 2025
**Maintainer:** Posterrama Team
**Questions?** Open an issue on GitHub
