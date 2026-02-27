import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

/**
 * PATCH /api/order/update
 * Customer-side endpoint to update order payment status
 */
export async function PATCH(req) {
    try {
        const firestore = await getFirestore();
        const body = await req.json();

        const { orderId, dineInTabId, paymentStatus, paymentMethod, trackingToken } = body;

        if (!orderId && !dineInTabId) {
            return NextResponse.json(
                { message: 'Either orderId or dineInTabId is required.' },
                { status: 400 }
            );
        }

        // 🔐 AUTH & OWNERSHIP CHECK
        let uid = null;
        try {
            uid = await verifyAndGetUid(req);
        } catch (e) {
            // Might be a guest user parsing a public tracking page using a trackingToken
        }


        console.log('[API][PATCH /order/update] Updating payment status:', {
            orderId,
            dineInTabId,
            paymentStatus,
            paymentMethod,
            hasToken: !!trackingToken
        });

        // Find orders to update
        let ordersToUpdate = [];

        let queryTabId = dineInTabId;

        // If orderId looks like a tab ID, treat it as such
        if (!queryTabId && orderId && orderId.startsWith('tab_')) {
            queryTabId = orderId;
        }

        if (queryTabId) {
            // Update all orders in the tab
            const ordersSnap = await firestore
                .collection('orders')
                .where('dineInTabId', '==', queryTabId)
                .where('status', '!=', 'rejected')
                .get();

            // Check authorization: User must own at least ONE order in the tab
            if (!ordersSnap.empty) {
                const isValidToken = trackingToken && ordersSnap.docs.some(doc => doc.data().trackingToken === trackingToken);
                const isValidOwner = uid && ordersSnap.docs.some(doc => {
                    const data = doc.data();
                    return uid === data.userId || uid === data.customerId || uid === data.restaurantId;
                });

                if (!isValidToken && !isValidOwner) {
                    return NextResponse.json({ message: 'Unauthorized. You do not own this order tab.' }, { status: 403 });
                }
            }

            ordersToUpdate = ordersSnap.docs;
        } else if (orderId) {
            // Update single order
            const orderDoc = await firestore.collection('orders').doc(orderId).get();
            if (orderDoc.exists) {
                const orderData = orderDoc.data();
                // Ownership check
                const isValidToken = trackingToken && orderData.trackingToken === trackingToken;
                const isValidOwner = uid && (uid === orderData.userId || uid === orderData.customerId || uid === orderData.restaurantId);

                if (!isValidToken && !isValidOwner) {
                    return NextResponse.json({ message: 'Unauthorized. You do not own this order.' }, { status: 403 });
                }
                ordersToUpdate = [orderDoc];
            }
        }

        if (ordersToUpdate.length === 0) {
            return NextResponse.json(
                { message: 'No orders found to update.' },
                { status: 404 }
            );
        }

        // Update payment status for all orders
        const batch = firestore.batch();
        const updateData = {};

        if (paymentStatus) {
            updateData.paymentStatus = paymentStatus;
        }
        if (paymentMethod) {
            updateData.paymentMethod = paymentMethod;
        }

        ordersToUpdate.forEach(doc => {
            batch.update(doc.ref, updateData);
        });

        await batch.commit();

        console.log(`[API][PATCH /order/update] Updated ${ordersToUpdate.length} orders`);

        return NextResponse.json({
            success: true,
            message: `Payment status updated for ${ordersToUpdate.length} order(s)`,
            updatedOrders: ordersToUpdate.length
        });

    } catch (error) {
        console.error('[API][PATCH /order/update] Error:', error);
        return NextResponse.json(
            { message: 'Failed to update order', error: error.message },
            { status: 500 }
        );
    }
}
