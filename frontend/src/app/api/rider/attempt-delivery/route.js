
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API attempt-delivery] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider

        const { orderIds } = await req.json();
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ message: 'Order IDs array is required.' }, { status: 400 });
        }

        console.log(`[API attempt-delivery] Rider ${uid} attempting delivery for orders: ${orderIds.join(', ')}`);

        const batch = firestore.batch();
        const ordersCollectionRef = firestore.collection('orders');

        // 🔒 SECURITY: Validate each order before updating
        for (const orderId of orderIds) {
            const orderRef = ordersCollectionRef.doc(orderId);
            const orderSnap = await orderRef.get();

            // Check if order exists
            if (!orderSnap.exists) {
                console.error(`[API attempt-delivery] Order ${orderId} not found.`);
                return NextResponse.json({ message: `Order ${orderId} not found.` }, { status: 404 });
            }

            const orderData = orderSnap.data();

            // 🔒 SECURITY CHECK 1: Is this order assigned to THIS rider?
            if (orderData.deliveryBoyId !== uid) {
                console.warn(`[API attempt-delivery] SECURITY ALERT: Rider ${uid} attempted to update order ${orderId} assigned to ${orderData.deliveryBoyId}.`);
                return NextResponse.json(
                    { message: `Unauthorized: Order ${orderId} is not assigned to you.` },
                    { status: 403 }
                );
            }

            // 🔒 SECURITY CHECK 2: Is order in correct state?
            if (orderData.status !== 'on_the_way') {
                console.warn(`[API attempt-delivery] Order ${orderId} has invalid status: ${orderData.status}. Expected 'on_the_way'.`);
                return NextResponse.json(
                    { message: `Order ${orderId} must be 'on_the_way'. Current status: ${orderData.status}` },
                    { status: 400 }
                );
            }

            // ✅ All security checks passed → mark delivery attempted
            batch.update(orderRef, {
                status: 'delivery_attempted',
                statusHistory: FieldValue.arrayUnion({
                    status: 'delivery_attempted',
                    timestamp: new Date(),
                    updatedBy: uid
                })
            });
        }

        await batch.commit();

        console.log(`[API attempt-delivery] Orders marked as 'delivery_attempted' successfully.`);
        return NextResponse.json({ message: 'Delivery attempt recorded. Customer not responding?' }, { status: 200 });

    } catch (error) {
        console.error("[API attempt-delivery] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
