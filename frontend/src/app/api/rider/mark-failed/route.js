
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API mark-failed] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider

        const { orderIds, reason } = await req.json();
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ message: 'Order IDs array is required.' }, { status: 400 });
        }

        console.log(`[API mark-failed] Rider ${uid} marking orders as failed: ${orderIds.join(', ')}`);

        const batch = firestore.batch();
        const ordersCollectionRef = firestore.collection('orders');

        // 🔒 SECURITY: Validate each order before updating
        for (const orderId of orderIds) {
            const orderRef = ordersCollectionRef.doc(orderId);
            const orderSnap = await orderRef.get();

            // Check if order exists
            if (!orderSnap.exists) {
                console.error(`[API mark-failed] Order ${orderId} not found.`);
                return NextResponse.json({ message: `Order ${orderId} not found.` }, { status: 404 });
            }

            const orderData = orderSnap.data();

            // 🔒 SECURITY CHECK 1: Is this order assigned to THIS rider?
            if (orderData.deliveryBoyId !== uid) {
                console.warn(`[API mark-failed] SECURITY ALERT: Rider ${uid} attempted to update order ${orderId} assigned to ${orderData.deliveryBoyId}.`);
                return NextResponse.json(
                    { message: `Unauthorized: Order ${orderId} is not assigned to you.` },
                    { status: 403 }
                );
            }

            // 🔒 SECURITY CHECK 2: Is order in correct state?
            if (orderData.status !== 'delivery_attempted') {
                console.warn(`[API mark-failed] Order ${orderId} has invalid status: ${orderData.status}. Expected 'delivery_attempted'.`);
                return NextResponse.json(
                    { message: `Order ${orderId} must be in 'delivery_attempted' state. Current status: ${orderData.status}` },
                    { status: 400 }
                );
            }

            // ✅ All security checks passed → mark as failed
            batch.update(orderRef, {
                status: 'failed_delivery',
                failureReason: reason || 'Customer unreachable',
                failureTimestamp: new Date(),
                statusHistory: FieldValue.arrayUnion({
                    status: 'failed_delivery',
                    timestamp: new Date(),
                    updatedBy: uid,
                    reason: reason || 'Customer unreachable'
                })
            });
        }

        await batch.commit();

        console.log(`[API mark-failed] Orders marked as 'failed_delivery' successfully.`);
        return NextResponse.json({ message: 'Delivery marked as failed. Return parcel to restaurant.' }, { status: 200 });

    } catch (error) {
        console.error("[API mark-failed] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
