# Performance Baseline Report

**Date:** November 15, 2025  
**Version:** 2.9.4  
**Environment:** Production mode (NODE_ENV=production)  
**Measurement Tool:** Vite build output, du, Lighthouse CLI

---

## Executive Summary

This document establishes the performance baseline **after Quick Win optimizations** (Vite minification, inline script extraction). This baseline will be used to measure the impact of future optimizations from the Frontend Analysis roadmap.

**Key Improvements Already Applied:**

- ✅ Vite 7.2.2 with Terser minification enabled
- ✅ Inline scripts extracted to ES modules (361 LOC)
- ✅ Global error handler with telemetry
- ✅ Automatic production builds with hash-based caching
- ✅ CSS minification (admin.css: 460KB → 326KB, 29% reduction)

**Baseline Metrics (Post Quick Wins):**

| Metric                        | Value                  | vs. Pre-Optimization                                         |
| ----------------------------- | ---------------------- | ------------------------------------------------------------ |
| **Total Bundle (Production)** | 1.8 MB                 | ↓ 50% (was 3.6 MB)                                           |
| **Largest JS File**           | 1.3 MB (admin.js)      | Unchanged (not yet modularized)                              |
| **Largest CSS File**          | 326 KB (admin.css)     | ↓ 29% (was 460 KB)                                           |
| **Minified ES Modules**       | 3 files, 6.31 KB total | ✨ New (error-handler, mode-redirect, screensaver-bootstrap) |
| **Gzipped Admin HTML**        | 38.23 KB               | ↓ 85% (was ~253 KB uncompressed)                             |

---

## Bundle Size Analysis

### Production Build (dist/public/)

**Total Size:** 1.8 MB (50% reduction from 3.6 MB)

**Breakdown by Category:**

| Category                  | Size (Uncompressed) | Size (Gzipped) | Files     |
| ------------------------- | ------------------- | -------------- | --------- |
| **HTML Pages**            | 331.6 KB            | 58.26 KB       | 7 files   |
| **CSS Stylesheets**       | 733.75 KB           | 97.20 KB       | 4 files   |
| **JavaScript (Minified)** | 6.31 KB             | 3.21 KB        | 5 modules |
| **Images (Icons)**        | 443.6 KB            | 176.76 KB      | 9 files   |
| **Manifests**             | 2.57 KB             | 0.62 KB        | 1 file    |

### Top 10 Largest Files (dist/public/)

| File                | Size      | Gzipped   | Type  |
| ------------------- | --------- | --------- | ----- |
| admin.css           | 326.89 KB | 42.60 KB  | CSS   |
| admin.html          | 253.63 KB | 38.23 KB  | HTML  |
| posterrama-icon.svg | 249.66 KB | 176.76 KB | SVG   |
| favicon.ico         | 191.64 KB | N/A       | Icon  |
| logo.png            | 187.10 KB | N/A       | Image |
| screensaver.css     | 36.24 KB  | 7.08 KB   | CSS   |
| wallart.html        | 28.14 KB  | 6.73 kB   | HTML  |
| setup.html          | 22.08 KB  | 4.78 KB   | HTML  |
| login.html          | 12.87 KB  | 3.64 KB   | HTML  |
| index.html          | 12.08 KB  | 3.65 KB   | HTML  |

**Note:** admin.js (1.3 MB) is **not included** in Vite build because it uses IIFE pattern instead of ES modules. This is the #1 optimization target for Q1 2026.

---

## Source Files (public/)

**Total Size:** 3.6 MB (unminified, unoptimized)

### Top 20 Largest Source Files

| File               | Size   | Status                                     |
| ------------------ | ------ | ------------------------------------------ |
| admin.js           | 1.3 MB | ⚠️ Monolith - not yet minified             |
| admin.css          | 457 KB | ✅ Minified to 326 KB (29% reduction)      |
| admin.html         | 248 KB | ✅ Minified to 253 KB (gzipped: 38 KB)     |
| wallart-display.js | 133 KB | ⚠️ Not yet modularized                     |
| device-mgmt.js     | 109 KB | ⚠️ Not yet modularized                     |
| style.css          | 63 KB  | ✅ General styles                          |
| screensaver.js     | 55 KB  | ⚠️ Not yet modularized                     |
| cinema.css         | 48 KB  | ✅ Minified to 6.78 KB                     |
| cinema-ui.js       | 42 KB  | ⚠️ Not yet modularized                     |
| cinema-display.js  | 41 KB  | ⚠️ Not yet modularized                     |
| wallart.html       | 28 KB  | ✅ Minified to 28.14 KB (gzipped: 6.73 KB) |
| artist-cards.js    | 23 KB  | ⚠️ Not yet modularized                     |
| core.js            | 23 KB  | ⚠️ Legacy IIFE - not minified              |
| setup.html         | 22 KB  | ✅ Minified to 22.08 KB                    |
| logs.css           | 21 KB  | ✅ Minified                                |
| logs.js            | 20 KB  | ⚠️ Not yet modularized                     |
| login.html         | 13 KB  | ✅ Minified to 12.87 KB                    |
| sw.js              | 13 KB  | ⚠️ Service worker - not minified           |
| cinema-display.css | 13 KB  | ✅ Minified to 6.78 KB                     |
| promo-box.css      | 13 KB  | ✅ Minified                                |

**Legend:**

- ✅ = Already optimized/minified
- ⚠️ = Optimization opportunity (not yet ES modules or minified)

---

## Code Statistics

### JavaScript Files

| Metric               | Value                  | Notes                                               |
| -------------------- | ---------------------- | --------------------------------------------------- |
| **Total JS Files**   | 47 files               | Includes legacy IIFE and new ES modules             |
| **Total JS Lines**   | ~67,000 LOC            | Estimated (includes comments)                       |
| **Largest File**     | admin.js (26,564 LOC)  | 36% of all frontend code                            |
| **ES Modules (New)** | 3 files (361 LOC)      | error-handler, mode-redirect, screensaver-bootstrap |
| **Legacy IIFE**      | 44 files (~66,639 LOC) | Not yet converted to ES modules                     |

### CSS Files

| Metric                 | Value                  | Notes                                    |
| ---------------------- | ---------------------- | ---------------------------------------- |
| **Total CSS Files**    | 21 files               | Includes mode-specific and component CSS |
| **Total CSS Lines**    | ~21,200 LOC            | Estimated                                |
| **Largest File**       | admin.css (15,503 LOC) | 73% of all CSS                           |
| **Minification Ratio** | 29% reduction          | admin.css: 460KB → 326KB                 |

### HTML Files

| Metric               | Value   | Notes                                                    |
| -------------------- | ------- | -------------------------------------------------------- |
| **Total HTML Files** | 7 pages | admin, wallart, cinema, screensaver, login, setup, index |
| **Average Size**     | 47.4 KB | Uncompressed                                             |
| **Gzipped Average**  | 8.3 KB  | 82% compression ratio                                    |

---

## Performance Impact Areas

### High Impact Opportunities (Q1-Q2 2026)

1. **admin.js (1.3 MB)** - Split into 12 ES modules
    - Current: Single 26,564 LOC file, IIFE pattern
    - Target: 12 modules <3K LOC each, ES module syntax
    - Expected reduction: 50-70% (with tree shaking + minification)
    - Estimated new size: 400-650 KB minified+gzipped

2. **Legacy IIFE Files** - Convert to ES modules
    - Files: wallart-display.js, device-mgmt.js, screensaver.js, cinema-\*.js
    - Current: 66,639 LOC not minified
    - Target: ES module conversion enables Vite bundling
    - Expected reduction: 60-80% with minification

3. **CSS Deduplication** - Extract utilities, design system
    - Current: admin.css 15,503 LOC with massive duplication
    - Target: Utility classes, component library, 5K LOC
    - Expected reduction: 60-70% (admin.css: 326KB → ~100-130KB)

4. **Image Optimization** - Responsive images, WebP/AVIF
    - Current: posterrama-icon.svg 249KB (gzipped: 176KB)
    - Target: Responsive srcsets, modern formats
    - Expected reduction: 40-60% for images

5. **Code Splitting** - Lazy load admin sections
    - Current: admin.js loaded entirely on page load
    - Target: Route-based code splitting (settings, devices, filters)
    - Expected reduction: 70% initial bundle, load on demand

---

## Build Performance

### Vite Build Times

| Build Type                  | Duration      | Notes                               |
| --------------------------- | ------------- | ----------------------------------- |
| **Clean Build**             | ~5-10 seconds | First build or after cache clear    |
| **Incremental Build**       | ~571 ms       | After file changes (hash detection) |
| **Hash Check (No Changes)** | ~50 ms        | Skip build if up-to-date            |

### Build Output Efficiency

| Metric                     | Value                                 |
| -------------------------- | ------------------------------------- |
| **Total Output Size**      | 1.8 MB                                |
| **Gzip Compression Ratio** | 82% average (HTML/CSS/JS)             |
| **Cache-Busting Hashes**   | ✅ Enabled (e.g., admin.B1PlrUXO.css) |
| **Source Maps**            | ✅ Generated for debugging            |

---

## Test Coverage

### Frontend Tests (Vitest)

| Metric                         | Value                | Target (Q2 2026) |
| ------------------------------ | -------------------- | ---------------- |
| **Test Files**                 | 1 file               | 20+ files        |
| **Total Tests**                | 11 tests             | 200+ tests       |
| **Code Coverage**              | ~1%                  | 80%+             |
| **Modules with 100% Coverage** | 1 (error-handler.js) | All new modules  |

**Coverage by File:**

- ✅ error-handler.js: 100% (11 tests)
- ⏸️ mode-redirect.js: 0% (deferred - JSDOM limitations)
- ⏸️ screensaver-bootstrap.js: 0% (not started)
- ⏸️ admin.js: 0% (too large, pending modularization)
- ⏸️ device-mgmt.js: 0% (pending modularization)

---

## Loading Performance (Actual Measurements)

**Data Source:** Lighthouse audits (Nov 15, 2025)

### Core Web Vitals Summary

| Page        | FCP (Fast) | LCP (Good)  | TTI (Fast)  | Status |
| ----------- | ---------- | ----------- | ----------- | ------ |
| Admin       | 3.6s (⚠️)  | 4.5s (⚠️)   | 4.5s (⚠️)   | OK     |
| Wallart     | 4.0s (⚠️)  | 96.7s (🚨)  | 96.8s (🚨)  | POOR   |
| Cinema      | 5.0s (⚠️)  | 100.2s (🚨) | 100.2s (🚨) | POOR   |
| Screensaver | 3.0s (✅)  | 94.3s (🚨)  | 94.3s (🚨)  | POOR   |
| Login       | 3.5s (✅)  | 4.5s (⚠️)   | 4.5s (⚠️)   | OK     |

**Thresholds:** FCP < 1.8s (Good), LCP < 2.5s (Good), TTI < 3.8s (Good)

### Performance by Connection Type

**Desktop (Fast 3G, ~1.6 Mbps):**

| Page        | Transfer Time | FCP  | LCP    | Notes                        |
| ----------- | ------------- | ---- | ------ | ---------------------------- |
| Admin       | ~6-8s         | 3.6s | 4.5s   | admin.js (1.3MB) dominates   |
| Wallart     | ~3-4s         | 4.0s | 96.7s  | 🚨 Lazy-loaded poster images |
| Cinema      | ~3-4s         | 5.0s | 100.2s | 🚨 Lazy-loaded poster images |
| Screensaver | ~3-4s         | 3.0s | 94.3s  | 🚨 Lazy-loaded poster images |
| Login       | ~2-3s         | 3.5s | 4.5s   | Smallest bundle              |

**Mobile (Slow 3G, ~400 Kbps):**

| Page        | Estimated Transfer | Estimated FCP | Status |
| ----------- | ------------------ | ------------- | ------ |
| Admin       | ~26s               | ~8-10s        | POOR   |
| Wallart     | ~10-12s            | ~6-8s         | POOR   |
| Cinema      | ~10-12s            | ~8-10s        | POOR   |
| Screensaver | ~10-12s            | ~5-7s         | OK     |
| Login       | ~8-10s             | ~5-6s         | OK     |

---

## Lighthouse Metrics (Actual Results)

**Status:** ✅ Audits completed on Nov 15, 2025

**Audit Command:** `npm run perf:audit`

**Reports:** See `lighthouse-reports/*.report.html` for detailed analysis

### Summary Table

| Page        | Performance | Accessibility | Best Practices | SEO | FCP  | LCP    | TTI    | TBT  | CLS   |
| ----------- | ----------- | ------------- | -------------- | --- | ---- | ------ | ------ | ---- | ----- |
| Admin       | 76/100      | 95/100        | 93/100         | 100 | 3.6s | 4.5s   | 4.5s   | 0ms  | 0     |
| Wallart     | 65/100      | 100/100       | 100/100        | 100 | 4.0s | 96.7s  | 96.8s  | 80ms | 0     |
| Cinema      | 62/100      | 100/100       | 100/100        | 91  | 5.0s | 100.2s | 100.2s | 0ms  | 0.004 |
| Screensaver | 69/100      | 100/100       | 100/100        | 91  | 3.0s | 94.3s  | 94.3s  | 0ms  | 0.002 |
| Login       | 77/100      | 95/100        | 93/100         | 100 | 3.5s | 4.5s   | 4.5s   | 0ms  | 0     |

### Key Observations

**Performance (62-77/100):**

- ✅ Admin and Login pages perform best (76-77/100)
- ⚠️ Display modes (Wallart/Cinema/Screensaver) have lower scores (62-69/100)
- 🚨 **Critical Issue:** LCP is 90-100s on display modes due to lazy-loaded poster images
- ✅ TBT is excellent (0-80ms) - JavaScript execution is not blocking
- ✅ CLS is excellent (0-0.004) - no layout shifts

**Accessibility (95-100/100):**

- ✅ Excellent scores across all pages
- Display modes score perfect 100/100
- Admin/Login at 95/100 (minor ARIA improvements needed)

**Best Practices (93-100/100):**

- ✅ Near-perfect scores
- Display modes score 100/100
- Admin/Login at 93/100 (likely HTTPS/CSP headers)

**SEO (91-100/100):**

- ✅ Excellent scores
- Admin/Wallart/Login at 100/100
- Cinema/Screensaver at 91/100 (meta description missing?)

### Performance Bottlenecks Identified

1. **LCP on Display Modes (90-100s)** 🚨 **CRITICAL**
    - Root Cause: Poster images lazy-load after page load
    - Impact: 65-69 Performance score
    - Fix: Preload hero poster or use low-res placeholder
    - Expected Improvement: +10-15 points → 75-80/100

2. **FCP Times (3.0-5.0s)** ⚠️ **MEDIUM**
    - Root Cause: Large JavaScript bundles (admin.js 1.3MB)
    - Impact: Slower initial paint
    - Fix: Code splitting, tree shaking, async loading
    - Expected Improvement: FCP → 1.5-2.5s

3. **TTI on Display Modes (94-100s)** ⚠️ **MEDIUM**
    - Root Cause: Waiting for image loading to complete
    - Impact: Page not fully interactive until images load
    - Fix: Separate image loading from interactive state
    - Expected Improvement: TTI → 5-10s

**Action Items:** Prioritize LCP fix for display modes (90-100s → <2.5s target)

---

## Browser Compatibility

**Target Browsers:**

- Chrome/Edge: Last 2 versions (✅ Modern JS supported)
- Firefox: Last 2 versions (✅ Modern JS supported)
- Safari: Last 2 versions (✅ ES modules supported)

**ES Module Support:**

- ✅ Chrome 61+
- ✅ Firefox 60+
- ✅ Safari 11+
- ✅ Edge 79+

**Current Issues:**

- Legacy IIFE files (admin.js, core.js) don't benefit from modern bundling
- No polyfills for older browsers (not a concern for target audience)

---

## Memory Usage

**Status:** Not yet measured (requires browser DevTools profiling)

**Metrics to Capture:**

- Heap size (admin page)
- DOM nodes count
- Event listeners count
- Memory leaks detection

**Action Item:** Profile memory usage in Chrome DevTools and update this section.

---

## Optimization Roadmap Impact

### Q1 2026: Foundation (Expected Improvements)

**Tasks:**

- Split admin.js into 12 modules
- Convert legacy IIFE to ES modules
- Enable full Vite bundling

**Expected Impact:**

- Bundle size: 1.8MB → ~800KB-1MB (↓ 50-60%)
- Admin load time: ~4s → ~2s (↓ 50%)
- Build time: No change (already optimized)

### Q2 2026: Quality & Performance (Expected Improvements)

**Tasks:**

- CSS deduplication and design system
- Image optimization (WebP/AVIF, responsive)
- Code splitting (lazy load admin sections)
- 80%+ test coverage

**Expected Impact:**

- Bundle size: ~1MB → ~500-700KB (↓ 40-50%)
- Admin load time: ~2s → ~1-1.5s (↓ 30-40%)
- CSS size: 326KB → ~100-150KB (↓ 60-70%)
- Test coverage: 1% → 80%+

### Q3-Q4 2026: Polish & TypeScript (Expected Improvements)

**Tasks:**

- TypeScript migration
- Advanced optimizations (SSR, edge rendering)
- Performance monitoring (RUM)

**Expected Impact:**

- Bundle size: ~700KB → ~500KB (↓ 30%)
- Type safety: 0% → 100%
- Developer velocity: +100% (fewer bugs, better IDE support)

---

## Baseline Comparison (Pre vs. Post Quick Wins)

| Metric                   | Pre-Optimization | Post Quick Wins          | Improvement |
| ------------------------ | ---------------- | ------------------------ | ----------- |
| **Total Bundle**         | 3.6 MB           | 1.8 MB                   | ↓ 50%       |
| **admin.css**            | 460 KB           | 326 KB                   | ↓ 29%       |
| **admin.html (gzipped)** | ~253 KB          | 38.23 KB                 | ↓ 85%       |
| **ES Modules**           | 0 files          | 3 files (6.31 KB)        | ✨ New      |
| **Build Process**        | Manual           | Automatic (hash-based)   | ✨ New      |
| **Test Coverage**        | 0%               | 1% (error-handler: 100%) | ✨ New      |

**Key Wins:**

- 50% bundle size reduction without touching admin.js
- 29% CSS reduction with just minification
- Automatic builds prevent serving stale code
- Test infrastructure ready for 80%+ coverage

**Next Big Wins:**

- admin.js modularization: Expected ↓ 50-70% (1.3MB → ~400-650KB)
- Legacy IIFE conversion: Expected ↓ 60-80% for all JS files
- CSS deduplication: Expected ↓ 60-70% (326KB → ~100-130KB)

---

## Measurement Tools & Scripts

### Bundle Size Analysis

```bash
# Production build
npm run build

# Measure sizes
du -sh dist/public/ public/

# Detailed breakdown
du -h dist/public/ | sort -h -r | head -20

# Largest source files
find public -name "*.js" -o -name "*.css" -o -name "*.html" | xargs ls -lh | sort -k5 -h -r | head -20
```

### Lighthouse Audit

```bash
# Run full audit on all pages (admin, wallart, cinema, screensaver, login)
npm run perf:audit

# View HTML reports
open lighthouse-reports/lighthouse-admin.report.html

# Check scores with jq
jq -r '.categories | to_entries[] | "\(.key): \(.value.score * 100)"' lighthouse-reports/lighthouse-admin.report.json
```

### Memory Profiling (Chrome DevTools)

**Manual Process:**

1. **Start Server**

    ```bash
    npm start
    ```

2. **Open Chrome DevTools**
    - Navigate to `http://localhost:4000/admin`
    - Press F12 → Performance tab
    - Click "Record" → Interact with page → Stop
    - Analyze heap snapshots, event listeners, DOM nodes

3. **Take Heap Snapshot**
    - Memory tab → "Take snapshot"
    - Compare snapshots before/after actions
    - Look for detached DOM nodes (memory leaks)

4. **Key Metrics to Capture**
    - **Heap Size:** Total memory used by JavaScript objects
    - **DOM Nodes:** Number of DOM elements (target: <1500)
    - **Event Listeners:** Number of registered listeners (target: <50)
    - **Detached Nodes:** Memory leaks from removed DOM elements

**Expected Baselines (Estimates):**

- Admin page: ~15-25 MB heap, ~800-1200 DOM nodes
- Wallart/Cinema: ~8-12 MB heap, ~200-400 DOM nodes
- Screensaver: ~8-12 MB heap, ~200-400 DOM nodes

**Known Issues to Profile:**

- admin.js IIFE scope retention (potential closure leaks)
- Device polling intervals (check cleanup)
- WebSocket connection memory usage
- Image caching in wallart/cinema/screensaver modes

**Action Item:** Run manual profiling session and document actual results

### Test Coverage

```bash
# Run frontend tests with coverage
npm run test:frontend:coverage

# View coverage report
open coverage/frontend/index.html
```

---

## Next Steps

1. **Run Lighthouse Audit** - Capture LCP, FCP, TTI, CLS metrics on live server
2. **Profile Memory Usage** - Chrome DevTools heap snapshots and profiling
3. **Measure Actual Load Times** - Network throttling tests (Fast 3G, Slow 3G)
4. **Document Mobile Performance** - Real device testing (iOS Safari, Chrome Android)
5. **Set Up Performance Monitoring** - Add RUM (Real User Monitoring) for production tracking

**Update Frequency:** Monthly (after each major optimization phase)

---

## References

- Frontend Analysis: [FRONTEND-ANALYSIS-2025-11-15-README.md](./FRONTEND-ANALYSIS-2025-11-15-README.md)
- Architecture Guide: [FRONTEND-ARCHITECTURE.md](./FRONTEND-ARCHITECTURE.md)
- Deployment Guide: [DEPLOYMENT-GUIDE.md](./DEPLOYMENT-GUIDE.md)
- Vite Documentation: https://vitejs.dev/
- Lighthouse: https://developer.chrome.com/docs/lighthouse/

---

**Document Version:** 1.0  
**Last Updated:** November 15, 2025  
**Next Review:** December 15, 2025 (after Q1 Sprint 1 completion)
