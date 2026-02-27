/**
 * ServiZephyr Feature Flags
 * 
 * Centralized feature flag management for safe rollouts and A/B testing.
 * All flags default to FALSE for production safety.
 */

export const FEATURE_FLAGS = {
    /**
     * Phase 5 Step 1-2: Service Layer for Order Create
     * 
     * When TRUE: Uses new orderService.createOrderV2()
     * When FALSE: Uses legacy inline implementation
     * 
     * Status: READY (COD tested)
     * Default: FALSE (gradual rollout)
     */
    USE_NEW_ORDER_SERVICE: process.env.NEXT_PUBLIC_USE_NEW_ORDER_SERVICE === 'true',

    /**
     * Phase 5 Stage 3: Online Payments in V2
     * 
     * When TRUE: V2 handles online payments (Razorpay/PhonePe)
     * When FALSE: V2 falls back to V1 for online payments
     * 
     * Status: IN DEVELOPMENT
     * Default: FALSE (safe fallback to V1)
     * 
     * Hybrid Strategy:
     * - COD/Counter → V2 (already working)
     * - Online → V1 fallback (until this flag enabled)
     */
    USE_V2_ONLINE_PAYMENT: process.env.NEXT_PUBLIC_USE_V2_ONLINE_PAYMENT === 'true',

    /**
     * Phase 2: New Dine-In Endpoints (Subcollection Migration)
     * 
     * When TRUE: Uses new /api/owner/dinein-tabs/* endpoints  
     * When FALSE: Uses legacy /api/dinein/* endpoints
     * 
     * Status: STABLE ✅ (Tested and deployed)
     * Default: TRUE (new endpoints active)
     * 
     * New Architecture Benefits:
     * - Atomic tab creation with transactions
     * - Payment locking during processing
     * - Source of truth recalculation
     * - Integrity verification
     * - Token-based security
     * 
     * Endpoints:
     * - /api/owner/dinein-tabs/create
     * - /api/owner/dinein-tabs/join
     * - /api/owner/dinein-tabs/settle
     * - /api/owner/dinein-tabs/cleanup
     */
    USE_NEW_DINEIN_ENDPOINTS: process.env.NEXT_PUBLIC_USE_NEW_DINEIN_ENDPOINTS !== 'false', // Default TRUE
};
