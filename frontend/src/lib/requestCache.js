/**
 * Request-Scoped Cache Utility
 * 
 * Purpose: Prevent duplicate Firestore reads within a SINGLE API request
 * 
 * How it works:
 * - Creates an in-memory Map for the request lifetime
 * - First access: fetches from Firestore + caches
 * - Subsequent access: returns cached value
 * 
 * IMPORTANT:
 * - This is NOT Redis (server-wide cache)
 * - This is request-scoped (lives only for one API call)
 * - Serverless-friendly (no global state)
 * 
 * Example:
 * const cache = createRequestCache();
 * 
 * // First call - fetches from Firestore
 * const order1 = await cache.get('order:123', () => orderRef.get());
 * 
 * // Second call - returns cached value (no Firestore read!)
 * const order2 = await cache.get('order:123', () => orderRef.get());
 */

export function createRequestCache() {
    const cache = new Map();

    return {
        /**
         * Get value from cache or fetch if not present
         * @param {string} key - Unique cache key (e.g., 'order:123', 'restaurant:abc')
         * @param {Function} fetcher - Async function to fetch data if not in cache
         * @returns {Promise<any>} Cached or freshly fetched data
         */
        async get(key, fetcher) {
            // Check if already in cache
            if (cache.has(key)) {
                return cache.get(key);
            }

            // Not in cache - fetch it
            const data = await fetcher();

            // Store in cache for subsequent access
            cache.set(key, data);

            return data;
        },

        /**
         * Get the number of cached entries
         * Useful for debugging and monitoring
         * @returns {number} Number of cached items
         */
        size() {
            return cache.size;
        },

        /**
         * Check if a key exists in cache
         * @param {string} key - Cache key to check
         * @returns {boolean} True if key exists
         */
        has(key) {
            return cache.has(key);
        }
    };
}
