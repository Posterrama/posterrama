// Posterrama PWA Service Worker
// Version 2.2.1 - Network-first for HTML, SWR for static assets, enhanced media caching

const CACHE_NAME = 'posterrama-pwa-v2.2.1';
const MEDIA_CACHE_NAME = 'posterrama-media-v1.1.0';

// Cache limits to avoid QuotaExceededError
const MEDIA_CACHE_MAX_ITEMS = 800; // cap media entries
const APP_CACHE_MAX_ITEMS = 200; // cap app/static entries

const STATIC_ASSETS = [
    '/',
    '/index.html',
    // Note: CSS/JS are versioned via query params; we'll cache them at runtime (SWR)
    '/manifest.json',
    '/favicon.ico',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    // Admin assets
    // Admin assets are also versioned; cached at runtime
    '/admin-help.js',
];

// Install event - cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('[SW] Installation failed:', error);
            })
    );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME && cacheName !== MEDIA_CACHE_NAME) {
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                return self.clients.claim();
            })
    );
});

// Fetch event - enhanced caching strategy
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip non-same-origin requests (external APIs, CDNs)
    if (url.origin !== location.origin) {
        return;
    }

    // Skip API requests (let them go to network)
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Always fetch latest admin scripts from network (no SW cache). Fallback to cache only if offline.
    if (url.pathname === '/admin.js' || url.pathname === '/admin2.js') {
        event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)));
        return;
    }

    // Handle poster/fanart/clearlogo images with cache-first strategy and intelligent preloading
    if (
        url.pathname.includes('/image_cache/') ||
        url.pathname.includes('/posters/') ||
        url.pathname.includes('/fanart/') ||
        (url.pathname === '/image' && url.searchParams.has('path'))
    ) {
        event.respondWith(
            caches.open(MEDIA_CACHE_NAME).then(cache => {
                return cache.match(request).then(cachedResponse => {
                    if (cachedResponse) {
                        // Serve from cache immediately
                        return cachedResponse;
                    }

                    return fetch(request)
                        .then(networkResponse => {
                            // Only cache successful responses
                            if (networkResponse.ok) {
                                const responseClone = networkResponse.clone();
                                return safeCachePut(
                                    cache,
                                    request,
                                    responseClone,
                                    MEDIA_CACHE_MAX_ITEMS
                                )
                                    .catch(() => undefined)
                                    .then(() => networkResponse);
                            }
                            return networkResponse;
                        })
                        .catch(() => {
                            // Return a placeholder or offline indicator for images
                            console.warn(
                                '[SW] Media unavailable offline:',
                                url.pathname + (url.search ? '?...' : '')
                            );
                            return new Response('', { status: 404, statusText: 'Offline' });
                        });
                });
            })
        );
        return;
    }

    // HTML/navigation requests: network-first with cache fallback
    const acceptsHTML = request.headers.get('accept')?.includes('text/html');
    if (request.mode === 'navigate' || acceptsHTML || url.pathname.endsWith('.html')) {
        event.respondWith(
            fetch(request)
                .then(networkResponse => {
                    const copy = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        safeCachePut(cache, request, copy, APP_CACHE_MAX_ITEMS).catch(
                            () => undefined
                        );
                    });
                    return networkResponse;
                })
                .catch(() => {
                    // Fallback to cached shell
                    return caches.match(request).then(resp => resp || caches.match('/index.html'));
                })
        );
        return;
    }

    // Static asset requests (.css, .js, images): stale-while-revalidate
    if (isStaticAsset(url.pathname)) {
        event.respondWith(
            caches.match(request).then(cached => {
                const fetchPromise = fetch(request)
                    .then(networkResponse => {
                        if (networkResponse && networkResponse.ok) {
                            const copy = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                safeCachePut(cache, request, copy, APP_CACHE_MAX_ITEMS).catch(
                                    () => undefined
                                );
                            });
                        }
                        return networkResponse;
                    })
                    .catch(() => undefined);

                // Return cached immediately if present, else wait for network
                return cached || fetchPromise || new Response('Offline', { status: 503 });
            })
        );
        return;
    }

    // Default: try network, then cache
    event.respondWith(
        fetch(request)
            .then(networkResponse => networkResponse)
            .catch(() => caches.match(request))
    );
});

// Helper function to check if a path is a static asset
function isStaticAsset(pathname) {
    const staticExtensions = [
        '.css',
        '.js',
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.svg',
        '.ico',
        '.json',
    ];
    return staticExtensions.some(ext => pathname.endsWith(ext));
}

// Message event for cache management and preloading
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches
                .keys()
                .then(cacheNames => {
                    return Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
                })
                .then(() => {
                    event.ports[0].postMessage({ success: true });
                })
        );
    }

    // Handle preemptive poster caching
    if (event.data && event.data.type === 'PRELOAD_POSTERS') {
        event.waitUntil(
            preloadPosters(event.data.urls).then(results => {
                if (event.ports && event.ports[0]) {
                    event.ports[0].postMessage({
                        success: true,
                        preloadedCount: results.filter(r => r.success).length,
                        totalCount: results.length,
                    });
                }
            })
        );
    }
});

// Preemptive poster caching function
async function preloadPosters(urls) {
    if (!urls || !Array.isArray(urls)) return [];

    const results = [];
    const cache = await caches.open(MEDIA_CACHE_NAME);

    // Throttle concurrency to avoid bursts
    const BATCH_SIZE = 8;
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(async url => {
                try {
                    const cached = await cache.match(url);
                    if (cached) return { url, success: true, cached: true };

                    const response = await fetch(url);
                    if (response.ok) {
                        await safeCachePut(cache, url, response.clone(), MEDIA_CACHE_MAX_ITEMS);
                        return { url, success: true, cached: false };
                    } else {
                        return { url, success: false, error: `HTTP ${response.status}` };
                    }
                } catch (error) {
                    console.warn('[SW] Failed to preload:', url, error);
                    return { url, success: false, error: error.message };
                }
            })
        );
        results.push(...batchResults);
    }

    return results;
}

// Background sync for offline actions (if supported)
if ('sync' in self.registration) {
    self.addEventListener('sync', event => {
        if (event.tag === 'posterrama-sync') {
            // Handle offline actions when coming back online
        }
    });
}

// ---- Helper: safe cache put with pruning and item limit ----
async function safeCachePut(cache, request, response, maxItems) {
    try {
        await cache.put(request, response);
        await enforceCacheLimit(cache, maxItems);
    } catch (err) {
        // On quota errors or any failure, prune and retry once
        try {
            await enforceCacheLimit(cache, maxItems);
            await cache.put(request, response);
        } catch (e) {
            // Give up silently; avoid crashing the fetch handler
            // Optional: console.warn('[SW] cache.put failed after prune:', e);
        }
    }
}

async function enforceCacheLimit(cache, maxItems) {
    try {
        const keys = await cache.keys();
        if (keys.length <= maxItems) return;
        const toDelete = keys.length - maxItems;
        // Delete oldest entries first (keys() is insertion order in practice)
        for (let i = 0; i < toDelete; i++) {
            await cache.delete(keys[i]);
        }
    } catch (err) {
        // Ignore pruning errors
    }
}
