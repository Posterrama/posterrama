# Memory Profiling Session (Task D)

**Status:** Guide Created  
**Effort:** 30 minutes  
**Date:** 2025-11-15  
**Purpose:** Document actual memory usage patterns for performance baseline

## Overview

This guide provides step-by-step instructions for profiling Posterrama's memory usage using Chrome DevTools. The goal is to establish actual memory baselines and compare them with estimated values from PERFORMANCE-BASELINE.md.

## Prerequisites

- Chrome/Chromium browser with DevTools
- Posterrama server running (`pm2 start`)
- Access to admin interface (`http://localhost:4000/admin`)
- Access to display modes (screensaver, wallart, cinema)

## Profiling Methodology

### 1. Admin Page Memory Profile

**Why Admin?**

- Largest JavaScript bundle (admin.js: 1.3MB)
- Most complex DOM (dynamic tables, forms, modals)
- Long-running page (users keep it open)
- Highest risk for memory leaks

#### Steps:

```
1. Open Chrome DevTools (F12)
2. Navigate to Memory tab
3. Select "Heap snapshot"
4. Navigate to http://localhost:4000/admin
5. Wait for full page load (spinner disappears)
6. Click "Take snapshot"
7. Save snapshot: "admin-initial.heapsnapshot"
```

#### Metrics to Capture:

- **Heap Size:** Total memory allocated
- **Shallow Size:** Memory held by objects themselves
- **Retained Size:** Memory held by objects + dependencies
- **DOM Nodes:** Number of DOM elements
- **Event Listeners:** Number of attached listeners
- **Detached DOM:** Orphaned elements (memory leak indicator)

#### Expected Baseline (Estimated):

```
Heap Size: 15-25 MB
DOM Nodes: 500-800
Event Listeners: 100-200
Detached DOM: <10 (healthy)
```

### 2. Display Mode Memory Profiles

**Why Display Modes?**

- Long-running pages (24/7 operation)
- Poster rotation cycles (potential accumulation)
- WebSocket connections (potential leaks)
- Image loading/unloading (GC patterns)

#### Screensaver Profile:

```
1. Navigate to http://localhost:4000/screensaver
2. Wait for first poster load
3. Take heap snapshot: "screensaver-initial.heapsnapshot"
4. Wait through 3 poster rotations (~5 minutes)
5. Take second snapshot: "screensaver-after-rotation.heapsnapshot"
6. Compare snapshots for growth
```

#### Expected Baseline (Estimated):

```
Initial Heap: 8-12 MB
After Rotation: 10-15 MB (slight growth acceptable)
DOM Nodes: 50-100
Event Listeners: 20-40
Detached DOM: <5
```

#### Wallart Profile:

```
1. Navigate to http://localhost:4000/wallart
2. Wait for grid initialization
3. Take heap snapshot: "wallart-initial.heapsnapshot"
4. Wait through 2 grid cycles (~10 minutes)
5. Take second snapshot: "wallart-after-cycles.heapsnapshot"
6. Compare snapshots for growth
```

#### Expected Baseline (Estimated):

```
Initial Heap: 10-15 MB
After Cycles: 12-18 MB
DOM Nodes: 100-200 (grid elements)
Event Listeners: 30-60
Detached DOM: <10
```

#### Cinema Profile:

```
1. Navigate to http://localhost:4000/cinema
2. Wait for first poster + ambilight
3. Take heap snapshot: "cinema-initial.heapsnapshot"
4. Wait through rotation (if enabled)
5. Take second snapshot: "cinema-after-rotation.heapsnapshot"
```

#### Expected Baseline (Estimated):

```
Initial Heap: 8-12 MB
DOM Nodes: 40-80
Event Listeners: 15-30
Detached DOM: <5
```

## Memory Leak Detection

### Symptoms of Memory Leaks:

1. **Heap growth over time** (>20% increase per cycle)
2. **Detached DOM nodes** accumulating (>50)
3. **Event listeners** not cleaned up
4. **Timers/intervals** not cleared
5. **WebSocket connections** not closed

### Comparison Snapshots:

```javascript
// In DevTools Console, compare two snapshots:
// 1. Click snapshot 2
// 2. Change view to "Comparison"
// 3. Select snapshot 1 as baseline
// 4. Look for objects with positive delta

// Key indicators:
// - HTMLImageElement +10 (poster cache accumulation)
// - EventListener +20 (listener leak)
// - Timer +5 (setInterval not cleared)
```

### Allocation Timeline:

```
1. DevTools → Memory → Allocation instrumentation on timeline
2. Start recording
3. Navigate to display mode
4. Watch for sustained growth (red bars not dropping)
5. Stop recording after 2 minutes
6. Identify allocations not garbage collected
```

## Performance Profiling (Chrome Performance Tab)

### Long Task Detection:

```
1. DevTools → Performance tab
2. Click Record
3. Navigate to display mode
4. Wait for 2 poster rotations
5. Stop recording
6. Analyze "Main" thread:
   - Tasks >50ms (yellow/red)
   - JavaScript execution time
   - Rendering/painting time
```

#### Healthy Patterns:

- No tasks >100ms (blocking)
- Smooth 60fps during transitions
- Idle time between poster changes
- GC pauses <20ms

#### Problem Indicators:

- Tasks >200ms (jank)
- Dropped frames during transitions
- Long GC pauses (>50ms)
- CPU pegged at 100%

## Network Performance

### Resource Loading Analysis:

```
1. DevTools → Network tab
2. Filter: Img
3. Navigate to display mode
4. Monitor poster loading:
   - Time to first byte (TTFB)
   - Download time
   - Cache hits vs misses
```

#### Expected Metrics:

- TTFB: <100ms (cached), <500ms (uncached)
- Download: 200-500KB per poster (compressed)
- Cache hit rate: >80% after first load
- Parallel requests: 2-6 simultaneous

## Documentation Update

After profiling, update `docs/PERFORMANCE-BASELINE.md`:

```markdown
### Memory Usage (Actual - 2025-11-15)

| Page        | Heap Size | DOM Nodes | Listeners | Detached | Growth Rate |
| ----------- | --------- | --------- | --------- | -------- | ----------- |
| Admin       | 18.2 MB   | 642       | 156       | 3        | N/A         |
| Screensaver | 9.4 MB    | 68        | 24        | 1        | +1.2MB/hr   |
| Wallart     | 13.1 MB   | 142       | 38        | 4        | +1.8MB/hr   |
| Cinema      | 10.2 MB   | 52        | 18        | 0        | +0.8MB/hr   |

**Notes:**

- All pages show healthy memory patterns
- Detached DOM <5 indicates no major leaks
- Growth rates are acceptable for 24/7 operation
- GC successfully reclaims memory between rotations
```

## Automated Memory Testing (Future)

### Puppeteer Memory Test Script:

```javascript
// scripts/test-memory.js
const puppeteer = require('puppeteer');

async function profileMemory(url) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto(url);
    await page.waitForSelector('#poster');

    const metrics = await page.metrics();
    console.log(`${url}:`, {
        jsHeapSize: (metrics.JSHeapUsedSize / 1024 / 1024).toFixed(2) + ' MB',
        nodes: metrics.Nodes,
        listeners: metrics.JSEventListeners,
    });

    await browser.close();
}

// Run profiling
profileMemory('http://localhost:4000/admin');
profileMemory('http://localhost:4000/screensaver');
profileMemory('http://localhost:4000/wallart');
profileMemory('http://localhost:4000/cinema');
```

### NPM Script:

```json
{
    "scripts": {
        "perf:memory": "node scripts/test-memory.js"
    }
}
```

## Common Issues & Solutions

### Issue: Heap growing indefinitely

**Cause:** Event listeners not removed, timers not cleared
**Solution:** Review cleanup in:

- `public/screensaver/screensaver.js` - rotation timer cleanup
- `public/wallart/wallart-display.js` - cycle timer cleanup
- `public/device-mgmt.js` - WebSocket cleanup

### Issue: Detached DOM accumulating

**Cause:** DOM references held after removal
**Solution:** Clear references:

```javascript
// Bad: Element still referenced
let posterEl = document.getElementById('poster');
posterEl.remove(); // Element detached but not GC'd

// Good: Clear reference
let posterEl = document.getElementById('poster');
posterEl.remove();
posterEl = null; // Allow GC
```

### Issue: Images not garbage collected

**Cause:** Image cache holding references
**Solution:** Implement LRU cache with size limit:

```javascript
// In wallart-display.js
const imageCache = new Map();
const MAX_CACHE_SIZE = 50;

function cacheImage(url, img) {
    if (imageCache.size >= MAX_CACHE_SIZE) {
        const firstKey = imageCache.keys().next().value;
        imageCache.delete(firstKey);
    }
    imageCache.set(url, img);
}
```

## Benchmarking Commands

### Quick Memory Check (via Console):

```javascript
// In DevTools Console on any page:
console.log({
    heap: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
    total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
    limit: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB',
});
```

### Monitor Memory Over Time:

```javascript
// Run in console, logs memory every 10 seconds:
setInterval(() => {
    const used = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
    console.log(`[${new Date().toLocaleTimeString()}] Heap: ${used} MB`);
}, 10000);
```

## Success Criteria

✅ **Healthy Memory Profile:**

- Heap size <30MB (admin), <20MB (display modes)
- Detached DOM <10 nodes
- Event listeners cleaned up after navigation
- Heap growth <5MB/hour during normal operation
- GC successfully reclaims memory

❌ **Memory Leak Indicators:**

- Heap growth >10MB/hour
- Detached DOM >50 nodes
- Event listeners accumulating
- Tasks >200ms blocking main thread
- GC pauses >100ms

## Next Steps

1. **Run manual profiling session** (30 minutes)
2. **Capture heap snapshots** for all 4 pages
3. **Document actual metrics** in PERFORMANCE-BASELINE.md
4. **Compare vs estimates** (validate or adjust)
5. **Identify any leaks** (detached DOM, listeners)
6. **Create monitoring dashboard** (optional: Grafana)

## References

- **Chrome DevTools Memory Profiler:** https://developer.chrome.com/docs/devtools/memory-problems/
- **Heap Snapshots Guide:** https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots/
- **Memory Leak Patterns:** https://web.dev/detached-window-memory-leaks/
- **Performance API:** https://developer.mozilla.org/en-US/docs/Web/API/Performance
- **Performance Baseline:** `docs/PERFORMANCE-BASELINE.md`
