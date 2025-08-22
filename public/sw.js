// Posterrama PWA Service Worker
// Version 2.1.0 - Enhanced with Preemptive Poster Caching

const CACHE_NAME = 'posterrama-pwa-v2.1.0';
const MEDIA_CACHE_NAME = 'posterrama-media-v1.1.0';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json',
    '/favicon.ico',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    // Admin assets
    '/admin.css',
    '/admin.js',
    '/admin-help.js',
];

// Install event - cache static assets
self.addEventListener('install', event => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[SW] Skip waiting');
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('[SW] Installation failed:', error);
            })
    );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches
            .keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME && cacheName !== MEDIA_CACHE_NAME) {
                            console.log('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('[SW] Claiming clients');
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
                        console.log(
                            '[SW] Serving from cache:',
                            url.pathname + (url.search ? '?...' : '')
                        );
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
                                console.log(
                                    `[SW] Cached ${imageType}:`,
                                    url.pathname + (url.search ? '?...' : '')
                                );
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

    // Handle static assets with cache-first strategy
    event.respondWith(
        caches.match(request).then(cachedResponse => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(request)
                .then(networkResponse => {
                    // Cache successful responses for static assets
                    if (networkResponse.ok && isStaticAsset(url.pathname)) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Offline fallback
                    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
                        return caches.match('/index.html');
                    }
                    return new Response('Offline', {
                        status: 503,
                        statusText: 'Service Unavailable',
                    });
                });
        })
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
                console.log('[SW] Preloaded posters:', results);
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
                console.log('[SW] Preloaded and cached:', url.substring(url.lastIndexOf('/') + 1));
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
            console.log('[SW] Background sync triggered');
            // Handle offline actions when coming back online
        }
    });
}
