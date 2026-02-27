import { getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv'; // ✅ For cache invalidation
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

async function getBusinessRef(firestore, restaurantId) {
    let businessRef = firestore.collection('restaurants').doc(restaurantId);
    let businessSnap = await businessRef.get();

    if (businessSnap.exists) {
        return businessRef;
    }

    businessRef = firestore.collection('shops').doc(restaurantId);
    businessSnap = await businessRef.get();

    if (businessSnap.exists) {
        return businessRef;
    }

    return null;
}

export async function POST(req) {
    console.log('[API /order/cancel] POST request received');

    try {
        const firestore = await getFirestore();
        const body = await req.json();

        const {
            orderId,
            cancelledBy, // 'owner' or 'customer'
            reason = 'No reason provided',
            dineInTabId,
            restaurantId
        } = body;

        if (!orderId) {
            return NextResponse.json({ message: 'Order ID is required.' }, { status: 400 });
        }

        if (!cancelledBy || !['owner', 'customer'].includes(cancelledBy)) {
            return NextResponse.json({ message: 'Invalid cancelledBy value. Must be "owner" or "customer".' }, { status: 400 });
        }

        // 🔐 AUTH & OWNERSHIP CHECK
        const uid = await verifyAndGetUid(req);

        // Fetch order for verification
        const orderRef = firestore.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) {
            return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
        }

        const orderData = orderSnap.data();
        const effectiveRestaurantId = restaurantId || orderData.restaurantId;
        const effectiveDineInTabId = dineInTabId || orderData.dineInTabId;

        // Validate Ownership
        if (cancelledBy === 'customer') {
            if (uid !== orderData.userId && uid !== orderData.customerId) {
                console.warn(`[API /order/cancel] Unauthorized cancellation attempt: User ${uid} tried cancelling Order ${orderId}`);
                return NextResponse.json({ message: 'Unauthorized. You do not own this order.' }, { status: 403 });
            }
        } else if (cancelledBy === 'owner') {
            let ownerContext = null;
            try {
                ownerContext = await verifyOwnerWithAudit(
                    req,
                    'cancel_order',
                    { orderId, restaurantId: effectiveRestaurantId },
                    false,
                    [PERMISSIONS.CANCEL_ORDER, PERMISSIONS.UPDATE_ORDER_STATUS]
                );
            } catch (ownerErr) {
                console.warn(`[API /order/cancel] Owner verification failed: ${ownerErr.message}`);
                return NextResponse.json({ message: ownerErr.message || 'Unauthorized.' }, { status: ownerErr.status || 403 });
            }

            if (!ownerContext || ownerContext.businessId !== effectiveRestaurantId) {
                console.warn(`[API /order/cancel] Unauthorized owner-cancellation attempt: User ${uid} for Restaurant ${effectiveRestaurantId}`);
                return NextResponse.json({ message: 'Unauthorized. You are not the owner of this business.' }, { status: 403 });
            }
        }


        if (!effectiveRestaurantId) {
            return NextResponse.json({ message: 'Restaurant ID is required.' }, { status: 400 });
        }

        console.log('[API /order/cancel] Order found:', orderData.status, 'Amount:', orderData.totalAmount);

        // Check if already cancelled
        if (orderData.status === 'cancelled') {
            return NextResponse.json({ message: 'Order is already cancelled.' }, { status: 400 });
        }

        // Permission check: Customer can only cancel pending/confirmed orders
        if (cancelledBy === 'customer') {
            const allowedStatuses = ['pending', 'confirmed'];
            if (!allowedStatuses.includes(orderData.status)) {
                return NextResponse.json({
                    message: `Cannot cancel order. Order is already in "${orderData.status}" status. You can only cancel pending or confirmed orders.`
                }, { status: 403 });
            }
        }

        // Owner can cancel at any status (no restriction)
        console.log(`[API /order/cancel] Cancellation permitted for ${cancelledBy}`);

        // Start batch update
        const batch = firestore.batch();

        // Update order document
        batch.update(orderRef, {
            status: 'cancelled',
            paymentStatus: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledBy: cancelledBy,
            cancellationReason: reason
        });

        // Update dineInTabs totalBill (decrement)
        if (effectiveDineInTabId && orderData.totalAmount) {
            const businessRef = await getBusinessRef(firestore, effectiveRestaurantId);
            if (businessRef) {
                const tabRef = businessRef.collection('dineInTabs').doc(effectiveDineInTabId);
                const tabSnap = await tabRef.get(); // Check existence first

                if (tabSnap.exists) {
                    batch.update(tabRef, {
                        totalBill: FieldValue.increment(-orderData.totalAmount) // Decrement amount
                    });
                    console.log(`[API /order/cancel] Decrementing tab ${effectiveDineInTabId} totalBill by ₹${orderData.totalAmount}`);
                } else {
                    console.warn(`[API /order/cancel] Warning: Tab ${effectiveDineInTabId} not found. Skipping totalBill update.`);
                }
            }
        }

        // Commit batch
        await batch.commit();

        // If this was the last active order on a dine-in tab, auto-close stale tab + sync table occupancy.
        if (effectiveRestaurantId && effectiveDineInTabId && orderData.deliveryType === 'dine-in') {
            try {
                const businessRef = await getBusinessRef(firestore, effectiveRestaurantId);
                if (businessRef) {
                    const remainingOrdersSnap = await firestore.collection('orders')
                        .where('restaurantId', '==', effectiveRestaurantId)
                        .where('deliveryType', '==', 'dine-in')
                        .where('dineInTabId', '==', effectiveDineInTabId)
                        .where('status', 'not-in', ['rejected', 'cancelled', 'picked_up'])
                        .limit(1)
                        .get();

                    if (remainingOrdersSnap.empty) {
                        const tabRef = businessRef.collection('dineInTabs').doc(effectiveDineInTabId);
                        await tabRef.set({
                            status: 'closed',
                            closedAt: FieldValue.serverTimestamp(),
                            cleanedAt: FieldValue.serverTimestamp()
                        }, { merge: true });

                        if (orderData.tableId) {
                            const activeTabsSnap = await businessRef.collection('dineInTabs')
                                .where('tableId', '==', orderData.tableId)
                                .where('status', '==', 'active')
                                .get();
                            const recalculatedPax = activeTabsSnap.docs.reduce((sum, doc) => sum + (doc.data()?.pax_count || 0), 0);
                            await businessRef.collection('tables').doc(orderData.tableId).set({
                                current_pax: recalculatedPax,
                                state: recalculatedPax > 0 ? 'occupied' : 'available',
                                updatedAt: FieldValue.serverTimestamp()
                            }, { merge: true });
                        }
                    }
                }
            } catch (syncErr) {
                console.warn('[API /order/cancel] Tab/table sync after cancellation failed:', syncErr?.message || syncErr);
                // Non-fatal: cancellation already committed.
            }
        }

        // ✅ CACHE INVALIDATION: Clear cached order status
        const cacheKey = `order_status:${orderId}`;
        const isKvAvailable = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

        if (isKvAvailable) {
            try {
                await kv.del(cacheKey);
                console.log(`[API /order/cancel] 🗑️ Cleared cache: ${cacheKey}`);
            } catch (cacheError) {
                console.warn('[API /order/cancel] Failed to clear cache:', cacheError);
                // Don't fail the cancel operation if cache clear fails
            }
        }

        console.log(`[API /order/cancel] Order ${orderId} cancelled successfully by ${cancelledBy}`);

        return NextResponse.json({
            message: 'Order cancelled successfully.',
            orderId: orderId,
            refundAmount: orderData.totalAmount,
            cancelledBy: cancelledBy
        }, { status: 200 });

    } catch (error) {
        console.error('[API /order/cancel] Error:', error);
        return NextResponse.json({
            message: `Internal Server Error: ${error.message}`
        }, { status: 500 });
    }
}
