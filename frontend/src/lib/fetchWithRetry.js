/**
 * Fetch with automatic retry and exponential backoff
 * Handles network glitches gracefully without overwhelming server
 * 
 * @param {string} url - API endpoint
 * @param {object} options - Fetch options
 * @param {number} retries - Max retry attempts (default: 3)
 * @param {number} delay - Initial delay in ms (default: 800)
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(
    url,
    options,
    retries = 3,
    delay = 800
) {
    try {
        const response = await fetch(url, options);

        // Don't retry on client errors (400-499 except 429 rate limit)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            return response;
        }

        // Retry on 429 (rate limit) or 5xx (server errors)
        if (response.status === 429 || response.status >= 500) {
            throw new Error(`Server error: ${response.status}`);
        }

        return response;

    } catch (err) {
        if (retries <= 0) {
            throw err;
        }

        console.log(`[Retry] Attempt failed, retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(res => setTimeout(res, delay));

        // Exponential backoff: 800ms → 1600ms → 3200ms
        return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
}
