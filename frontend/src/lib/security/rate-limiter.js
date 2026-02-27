/**
 * Simple In-Memory Rate Limiter
 * 
 * ⚠️ IMPORTANT: This is in-memory only.
 * - Works for single server or low traffic
 * - Multi-instance deployments (Vercel serverless) = limits NOT shared
 * - Future: Migrate to Redis/Vercel KV for distributed rate limiting
 * 
 * Usage:
 *   const limiter = new RateLimiter('employee_invite', 10, 60000);
 *   const result = limiter.check('user123', 'outlet456');
 *   if (!result.allowed) return 429;
 */

class RateLimiter {
    /**
     * @param {string} action - Action name for logging
     * @param {number} maxRequests - Max requests allowed in window
     * @param {number} windowMs - Time window in milliseconds
     */
    constructor(action, maxRequests, windowMs) {
        this.action = action;
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = new Map(); // key -> [timestamps]
    }

    /**
     * Check if request is allowed
     * @param {string} userId - User ID
     * @param {string} outletId - Outlet ID (optional, for multi-outlet fairness)
     * @returns {{allowed: boolean, retryAfter?: number, remaining?: number}}
     */
    check(userId, outletId = null) {
        // Use composite key for multi-outlet fairness
        const key = outletId ? `${userId}:${outletId}` : userId;
        const now = Date.now();
        const userRequests = this.requests.get(key) || [];

        // Remove timestamps outside the current window
        const validRequests = userRequests.filter(
            timestamp => now - timestamp < this.windowMs
        );

        // Check if limit exceeded
        if (validRequests.length >= this.maxRequests) {
            const oldestRequest = validRequests[0];
            const retryAfter = Math.ceil((oldestRequest + this.windowMs - now) / 1000);

            return {
                allowed: false,
                retryAfter,
                remaining: 0
            };
        }

        // Add current request timestamp
        validRequests.push(now);
        this.requests.set(key, validRequests);

        return {
            allowed: true,
            remaining: this.maxRequests - validRequests.length
        };
    }

    /**
     * Cleanup old entries to prevent memory leaks
     * Called periodically by cleanup interval
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, timestamps] of this.requests.entries()) {
            const valid = timestamps.filter(t => now - t < this.windowMs);

            if (valid.length === 0) {
                this.requests.delete(key);
                cleaned++;
            } else {
                this.requests.set(key, valid);
            }
        }

        if (cleaned > 0) {
            console.log(`[RATE_LIMITER] Cleaned ${cleaned} expired entries for ${this.action}`);
        }
    }

    /**
     * Get current stats (for monitoring/debugging)
     */
    getStats() {
        return {
            action: this.action,
            activeKeys: this.requests.size,
            maxRequests: this.maxRequests,
            windowMs: this.windowMs
        };
    }
}

// ============================================
// CONFIGURED RATE LIMITERS
// ============================================

// Employee Operations (10 per minute)
export const employeeInviteLimiter = new RateLimiter('employee_invite', 10, 60000);
export const employeeRemoveLimiter = new RateLimiter('employee_remove', 10, 60000);
export const roleChangeLimiter = new RateLimiter('role_change', 10, 60000);

// Menu Operations
export const menuPriceLimiter = new RateLimiter('menu_price_update', 20, 60000); // 20/min for bulk updates
export const menuDeleteLimiter = new RateLimiter('menu_delete', 10, 60000);

// Financial Operations (stricter limits)
export const refundLimiter = new RateLimiter('refund', 5, 60000); // 5/min - high risk

// Marketing Operations
export const couponLimiter = new RateLimiter('coupon_operation', 15, 60000); // 15/min

// ============================================
// CLEANUP SCHEDULER
// ============================================

// Run cleanup every 5 minutes to prevent memory leaks
setInterval(() => {
    try {
        employeeInviteLimiter.cleanup();
        employeeRemoveLimiter.cleanup();
        roleChangeLimiter.cleanup();
        menuPriceLimiter.cleanup();
        menuDeleteLimiter.cleanup();
        refundLimiter.cleanup();
        couponLimiter.cleanup();
    } catch (error) {
        console.error('[RATE_LIMITER] Cleanup error:', error);
    }
}, 5 * 60 * 1000);

// Log stats every 30 minutes (for monitoring)
if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
        console.log('[RATE_LIMITER] Stats:', {
            employee: employeeInviteLimiter.getStats(),
            menu: menuPriceLimiter.getStats(),
            refund: refundLimiter.getStats(),
            coupon: couponLimiter.getStats()
        });
    }, 30 * 60 * 1000);
}

export default RateLimiter;
