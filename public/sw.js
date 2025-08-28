// Posterrama PWA Service Worker
// Version 2.2.0 - Network-first for HTML, SWR for static assets, enhanced media caching

const CACHE_NAME = 'posterrama-pwa-v2.2.0';
const MEDIA_CACHE_NAME = 'posterrama-media-v1.1.0';

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
                                // Clone response for caching
                                const responseClone = networkResponse.clone();
                                cache.put(request, responseClone);

                                const imageType = url.searchParams
                                    .get('path')
                                    ?.includes('clearLogo')
                                    ? 'clearlogo'
                                    : url.searchParams.get('path')?.includes('thumb')
                                      ? 'poster'
                                      : 'fanart';
                                // Cached successfully
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
                    // Cache a fresh copy for offline use
                    const copy = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
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
                            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
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

    for (const url of urls) {
        try {
            // Check if already cached
            const cached = await cache.match(url);
            if (cached) {
                results.push({ url, success: true, cached: true });
                continue;
            }

            // Fetch and cache
            const response = await fetch(url);
            if (response.ok) {
                await cache.put(url, response.clone());
                results.push({ url, success: true, cached: false });
            } else {
                results.push({ url, success: false, error: `HTTP ${response.status}` });
            }
        } catch (error) {
            results.push({ url, success: false, error: error.message });
            console.warn('[SW] Failed to preload:', url, error);
        }
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
