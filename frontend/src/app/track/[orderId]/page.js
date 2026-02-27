
import { redirect } from 'next/navigation';

/**
 * TRACKING ROUTER
 * 
 * Central routing logic for all tracking pages.
 * Determines correct tracking flow based on order type and redirects.
 * 
 * Flows:
 * - Street vendor → /track/pre-order/[id]
 * - Dine-in → /track/dine-in/[id]
 * - Delivery/Pickup → /track/delivery/[id]
 */

export default async function TrackingRouter({ params, searchParams }) {
    const { orderId } = params;
    const token = searchParams?.token || '';
    const phone = searchParams?.phone || '';

    try {
        // Fetch order data to determine tracking flow
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        // Pass token to API for auth check
        const queryParams = new URLSearchParams();
        if (token) queryParams.set('token', token);

        const res = await fetch(`${baseUrl}/api/order/status/${orderId}?${queryParams.toString()}`, {
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            console.warn(`[TrackingRouter] Order ${orderId} not found, defaulting to delivery`);
            // Default to delivery page on error (will handle its own error display)
            redirect(`/track/delivery/${orderId}?token=${token}${phone ? `&phone=${phone}` : ''}`);
        }

        const data = await res.json();
        const { order, restaurant } = data;

        // Determine tracking flow
        const flow = determineTrackingFlow(order, restaurant);

        console.log(`[TrackingRouter] Order ${orderId} → ${flow} flow`);

        // Build redirect URL with preserved query parameters
        const params = new URLSearchParams();
        if (token) params.set('token', token);
        if (phone) params.set('phone', phone);

        const redirectUrl = `/track/${flow}/${orderId}?${params.toString()}`;
        redirect(redirectUrl);

    } catch (error) {
        console.error(`[TrackingRouter] Error routing order ${orderId}:`, error);
        // Fallback to delivery on any error
        redirect(`/track/delivery/${orderId}?token=${token}${phone ? `&phone=${phone}` : ''}`);
    }
}

/**
 * Determines the appropriate tracking flow based on order and restaurant data
 */
function determineTrackingFlow(order, restaurant) {
    // DEBUG LOGGING
    console.log('[Router] Determining flow for order:', order?.id);
    console.log('[Router] Restaurant type:', restaurant?.businessType);
    console.log('[Router] Delivery type:', order?.deliveryType);
    console.log('[Router] Has dineInTabId:', !!order?.dineInTabId, order?.dineInTabId);
    console.log('[Router] Has tableId:', !!order?.tableId, order?.tableId);

    // Priority 1: Street vendor business type → pre-order flow
    if (restaurant?.businessType === 'street-vendor') {
        console.log('[Router] ✅ Routing to PRE-ORDER (street vendor)');
        return 'pre-order';
    }

    // Priority 2: Dine-in indicators → dine-in flow
    const isDineIn =
        order?.dineInTabId ||          // Has tab ID
        order?.tableId ||               // Has table assignment
        order?.diningPreference === 'dine-in' ||  // Explicitly dine-in (new field)
        order?.deliveryType === 'dine-in';        // Legacy field support

    if (isDineIn) {
        console.log('[Router] ✅ Routing to DINE-IN');
        return 'dine-in';
    }

    // Default: delivery flow (handles both delivery and pickup)
    console.log('[Router] ⚠️ Routing to DELIVERY (default)');
    return 'delivery';
}