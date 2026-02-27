// ServiZephyr Service Worker - Basic PWA Support
const CACHE_VERSION = '2026-02-14-22-25'; // Update this on each deployment
const CACHE_NAME = `servizephyr-v${CACHE_VERSION}`;
const urlsToCache = [
    '/offline.html'
];

// Install event - cache essential files only
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Opened cache');
                return cache.addAll(urlsToCache);
            })
            .catch((err) => {
                console.error('[SW] Cache install failed:', err);
            })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - network first, minimal caching
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip chrome extensions and other non-http requests
    if (!event.request.url.startsWith('http')) return;

    // CRITICAL: Skip API calls - don't cache them!
    if (event.request.url.includes('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response('Network error', {
                    status: 503,
                    statusText: 'Service Unavailable'
                })
            )
        );
        return;
    }

    // CRITICAL: Skip Next.js static assets - they have version hashes
    // Caching these causes stale chunk issues after deployments
    if (event.request.url.includes('/_next/')) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response('Asset unavailable', {
                    status: 503,
                    statusText: 'Service Unavailable'
                })
            )
        );
        return;
    }

    // For navigation requests, just fetch from network
    // Only use cache as fallback for offline
    event.respondWith(
        fetch(event.request)
            .catch(async () => {
                // Network failed, try cache for navigation requests
                if (event.request.mode === 'navigate') {
                    const offlinePage = await caches.match('/offline.html');
                    if (offlinePage) return offlinePage;
                    return new Response('Offline', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
                    });
                }
                const cachedResponse = await caches.match(event.request);
                if (cachedResponse) return cachedResponse;
                return new Response('Resource unavailable', {
                    status: 503,
                    statusText: 'Service Unavailable'
                });
            })
    );
});
