import { useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook for adaptive polling with visibility awareness and Activity backoff.
 * 
 * @param {Function} callback - The async function to call
 * @param {object} options - Configuration options
 * @param {number} options.interval - Base interval in ms (default: 15000)
 * @param {number} options.backoffFactor - Multiplier for hidden tab (default: 4)
 * @param {boolean} options.enabled - Whether polling is active
 * @param {Array} options.deps - Dependencies to restart polling
 */
export function usePolling(callback, {
    interval = 15000,
    backoffFactor = 4,
    enabled = true,
    deps = []
} = {}) {
    const savedCallback = useRef(callback);
    const intervalRef = useRef(null);
    const isVisible = useRef(true);

    useEffect(() => {
        savedCallback.current = callback;
    }, [callback]);

    const runPolling = useCallback(async () => {
        if (!enabled) return;

        // Skip if tab is hidden and we want to stop entirely, 
        // OR slow down if we just want backoff.
        // For simplicity, we slow down by backoffFactor.
        const currentInterval = document.visibilityState === 'visible'
            ? interval
            : interval * backoffFactor;

        try {
            await savedCallback.current();
        } catch (error) {
            console.error('[usePolling] Callback failed:', error);
        }

        intervalRef.current = setTimeout(runPolling, currentInterval);
    }, [enabled, interval, backoffFactor]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                // Instantly trigger refresh on focus if it was slowed down
                if (intervalRef.current) {
                    clearTimeout(intervalRef.current);
                    runPolling();
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        if (enabled) {
            runPolling();
        }

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (intervalRef.current) clearTimeout(intervalRef.current);
        };
    }, [enabled, runPolling, ...deps]);

    return {
        refresh: () => {
            if (intervalRef.current) clearTimeout(intervalRef.current);
            runPolling();
        }
    };
}
