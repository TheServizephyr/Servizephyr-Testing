// Track Page Constants - Shared across all tracking pages

// Final states where polling should STOP
export const FINAL_STATES = new Set([
    'delivered',
    'cancelled',
    'rejected',
    'completed'
]);

// Check if order is in final state (O(1) lookup)
export const isFinalState = (status) => FINAL_STATES.has(status);

// Adaptive polling intervals based on order status (in milliseconds)
export const getPollingInterval = (status) => {
    const intervals = {
        // Early stages - slower polling (kitchen hasn't started)
        'pending': 45000,        // 45s
        'accepted': 45000,       // 45s
        'confirmed': 45000,      // 45s

        // Mid stages - moderate (cooking in progress)
        'preparing': 30000,      // 30s

        // Late stages - faster (critical moments)
        'ready': 15000,          // 15s - ready for pickup/dispatch
        'ready_for_pickup': 15000, // 15s

        // Active delivery - fastest (rider on the way)
        'out_for_delivery': 10000,  // 10s
        'dispatched': 10000,         // 10s

        // Final states - NO POLLING!
        'delivered': null,
        'cancelled': null,
        'rejected': null,
        'completed': null
    };

    return intervals[status] || 30000; // Default 30s for unknown states
};

// Maximum polling time (60 minutes)
export const POLLING_MAX_TIME = 60 * 60 * 1000; // 60 minutes

// Get polling start time from localStorage (refresh-safe)
export const getPollingStartTime = (orderId) => {
    const key = `polling_start_${orderId}`;
    const stored = localStorage.getItem(key);

    if (stored) {
        return parseInt(stored, 10);
    }

    const now = Date.now();
    localStorage.setItem(key, now.toString());
    return now;
};

// Clear polling timer (call when order is final)
export const clearPollingTimer = (orderId) => {
    const key = `polling_start_${orderId}`;
    localStorage.removeItem(key);
};

// Check if polling has exceeded max time
export const hasExceededPollingTime = (orderId) => {
    const startTime = getPollingStartTime(orderId);
    return (Date.now() - startTime) > POLLING_MAX_TIME;
};
