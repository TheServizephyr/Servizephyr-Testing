/**
 * VENDOR ORDERS STORAGE
 * 
 * Manages multiple street vendor orders in localStorage without requiring login.
 * Each vendor has an array of active orders stored locally on customer's device.
 * 
 * Storage Key: vendorOrders_{restaurantId}
 * Auto-cleanup: Orders older than 24h are removed
 */

const STORAGE_PREFIX = 'vendorOrders_';
const MAX_AGE_HOURS = 24;

/**
 * Get all orders for a specific vendor
 */
export function getVendorOrders(restaurantId) {
    if (typeof window === 'undefined') return [];

    try {
        const key = `${STORAGE_PREFIX}${restaurantId}`;
        const data = localStorage.getItem(key);

        if (!data) return [];

        const parsed = JSON.parse(data);

        // Auto-cleanup old orders
        const now = Date.now();
        const maxAge = MAX_AGE_HOURS * 60 * 60 * 1000;

        const activeOrders = (parsed.orders || []).filter(order => {
            const age = now - order.timestamp;
            return age < maxAge;
        });

        // Save cleaned data back
        if (activeOrders.length !== (parsed.orders || []).length) {
            localStorage.setItem(key, JSON.stringify({ orders: activeOrders }));
        }

        return activeOrders;
    } catch (err) {
        console.error('[VendorOrdersStorage] Error getting orders:', err);
        return [];
    }
}

/**
 * Add a new order to vendor's order list
 */
export function addVendorOrder(restaurantId, orderData) {
    if (typeof window === 'undefined') return;

    try {
        const key = `${STORAGE_PREFIX}${restaurantId}`;
        const existing = getVendorOrders(restaurantId);

        const newOrder = {
            orderId: orderData.orderId,
            token: orderData.token,
            customerOrderId: orderData.customerOrderId || null, // NEW: Customer-facing ID
            timestamp: Date.now(),
            totalAmount: orderData.totalAmount || 0,
            itemCount: orderData.itemCount || 0
        };

        // Add to beginning (newest first)
        const updated = [newOrder, ...existing];

        localStorage.setItem(key, JSON.stringify({ orders: updated }));
        console.log(`[VendorOrdersStorage] Added order ${newOrder.orderId} (CustomerID: ${newOrder.customerOrderId}) for vendor ${restaurantId}`);

        return updated;
    } catch (err) {
        console.error('[VendorOrdersStorage] Error adding order:', err);
    }
}

/**
 * Remove a specific order (e.g., when delivered/cancelled)
 */
export function removeVendorOrder(restaurantId, orderId) {
    if (typeof window === 'undefined') return;

    try {
        const key = `${STORAGE_PREFIX}${restaurantId}`;
        const existing = getVendorOrders(restaurantId);

        const filtered = existing.filter(order => order.orderId !== orderId);

        if (filtered.length === 0) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify({ orders: filtered }));
        }

        console.log(`[VendorOrdersStorage] Removed order ${orderId}`);
    } catch (err) {
        console.error('[VendorOrdersStorage] Error removing order:', err);
    }
}

/**
 * Clear all orders for a vendor
 */
export function clearVendorOrders(restaurantId) {
    if (typeof window === 'undefined') return;

    try {
        const key = `${STORAGE_PREFIX}${restaurantId}`;
        localStorage.removeItem(key);
        console.log(`[VendorOrdersStorage] Cleared all orders for vendor ${restaurantId}`);
    } catch (err) {
        console.error('[VendorOrdersStorage] Error clearing orders:', err);
    }
}

/**
 * Update order status in localStorage (for completion tracking)
 */
export function updateVendorOrderStatus(restaurantId, orderId, newStatus) {
    if (typeof window === 'undefined') return;

    try {
        const key = `${STORAGE_PREFIX}${restaurantId}`;
        const existing = getVendorOrders(restaurantId);

        const updated = existing.map(order =>
            order.orderId === orderId
                ? { ...order, status: newStatus, lastUpdated: Date.now() }
                : order
        );

        localStorage.setItem(key, JSON.stringify({ orders: updated }));
        console.log(`[VendorOrdersStorage] Updated order ${orderId} status to ${newStatus}`);
    } catch (err) {
        console.error('[VendorOrdersStorage] Error updating order status:', err);
    }
}

/**
 * Check if an order exists in storage
 */
export function hasVendorOrder(restaurantId, orderId) {
    const orders = getVendorOrders(restaurantId);
    return orders.some(order => order.orderId === orderId);
}

