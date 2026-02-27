
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API return-order] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider

        const { orderIds } = await req.json();
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ message: 'Order IDs array is required.' }, { status: 400 });
        }

        console.log(`[API return-order] Rider ${uid} returning orders to restaurant: ${orderIds.join(', ')}`);

        const batch = firestore.batch();
        const ordersCollectionRef = firestore.collection('orders');

        // 🔒 SECURITY: Validate each order before updating
        for (const orderId of orderIds) {
            const orderRef = ordersCollectionRef.doc(orderId);
            const orderSnap = await orderRef.get();

            // Check if order exists
            if (!orderSnap.exists) {
                console.error(`[API return-order] Order ${orderId} not found.`);
                return NextResponse.json({ message: `Order ${orderId} not found.` }, { status: 404 });
            }

            const orderData = orderSnap.data();

            // 🔒 SECURITY CHECK 1: Is this order assigned to THIS rider?
            if (orderData.deliveryBoyId !== uid) {
                console.warn(`[API return-order] SECURITY ALERT: Rider ${uid} attempted to update order ${orderId} assigned to ${orderData.deliveryBoyId}.`);
                return NextResponse.json(
                    { message: `Unauthorized: Order ${orderId} is not assigned to you.` },
                    { status: 403 }
                );
            }

            // 🔒 SECURITY CHECK 2: Is order in correct state?
            if (orderData.status !== 'failed_delivery') {
                console.warn(`[API return-order] Order ${orderId} has invalid status: ${orderData.status}. Expected 'failed_delivery'.`);
                return NextResponse.json(
                    { message: `Order ${orderId} must be in 'failed_delivery' state. Current status: ${orderData.status}` },
                    { status: 400 }
                );
            }

            // ✅ All security checks passed → mark as returned
            batch.update(orderRef, {
                status: 'returned_to_restaurant',
                returnedTimestamp: new Date(),
                statusHistory: FieldValue.arrayUnion({
                    status: 'returned_to_restaurant',
                    timestamp: new Date(),
                    updatedBy: uid
                })
            });
        }

        // ✅ STEP 5D: Check if rider has any remaining active orders
        const remainingOrdersQuery = firestore.collection('orders')
            .where('deliveryBoyId', '==', uid)
            .where('status', 'in', ['dispatched', 'reached_restaurant', 'picked_up', 'on_the_way', 'delivery_attempted']);

        const remainingOrdersSnap = await remainingOrdersQuery.get();

        // Filter out orders we're currently returning
        const actualRemainingOrders = remainingOrdersSnap.docs.filter(doc => !orderIds.includes(doc.id));

        // If no active orders left, set rider status back to online
        if (actualRemainingOrders.length === 0) {
            console.log(`[API return-order] No active orders remaining. Setting rider ${uid} status to 'online'.`);
            const driverRef = firestore.collection('drivers').doc(uid);
            batch.update(driverRef, { status: 'online' });
        }

        await batch.commit();

        console.log(`[API return-order] Orders returned to restaurant successfully.`);
        return NextResponse.json({
            message: actualRemainingOrders.length === 0
                ? 'Order returned. You are now available for new deliveries.'
                : 'Order returned. Continue with remaining deliveries.'
        }, { status: 200 });

    } catch (error) {
        console.error("[API return-order] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
