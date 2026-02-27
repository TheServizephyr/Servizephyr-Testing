
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API accept-order] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider

        const { orderIds } = await req.json(); // Accept an array of order IDs
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ message: 'Order IDs array is required.' }, { status: 400 });
        }

        console.log(`[API accept-order] Rider ${uid} is accepting orders: ${orderIds.join(', ')}`);

        const batch = firestore.batch();
        const ordersCollectionRef = firestore.collection('orders');

        // 🔒 SECURITY: Validate each order before accepting
        for (const orderId of orderIds) {
            const orderRef = ordersCollectionRef.doc(orderId);
            const orderSnap = await orderRef.get();

            // Check if order exists
            if (!orderSnap.exists) {
                console.error(`[API accept-order] Order ${orderId} not found.`);
                return NextResponse.json({ message: `Order ${orderId} not found.` }, { status: 404 });
            }

            const orderData = orderSnap.data();

            // 🔒 SECURITY CHECK 1: Is this order assigned to THIS rider?
            if (orderData.deliveryBoyId !== uid) {
                console.warn(`[API accept-order] SECURITY ALERT: Rider ${uid} attempted to accept order ${orderId} assigned to ${orderData.deliveryBoyId}.`);
                return NextResponse.json(
                    { message: `Unauthorized: Order ${orderId} is not assigned to you.` },
                    { status: 403 }
                );
            }

            // 🔒 SECURITY CHECK 2: Is order in correct state?
            // ✅ STEP 4C: Rider must reach restaurant BEFORE picking up food
            if (orderData.status !== 'reached_restaurant') {
                console.warn(`[API accept-order] Order ${orderId} has invalid status: ${orderData.status}. Expected 'reached_restaurant'.`);
                return NextResponse.json(
                    { message: `Order ${orderId} - You must reach the restaurant first. Current status: ${orderData.status}` },
                    { status: 400 }
                );
            }

            // ✅ All security checks passed → update to picked_up
            batch.update(orderRef, {
                status: 'picked_up',
                statusHistory: FieldValue.arrayUnion({
                    status: 'picked_up',
                    timestamp: new Date(),
                    updatedBy: uid
                })
            });
        }

        // Update the rider's main status to 'on-delivery'
        const driverRef = firestore.collection('drivers').doc(uid);
        batch.update(driverRef, { status: 'on-delivery' });

        await batch.commit();

        console.log(`[API accept-order] Orders updated to 'picked_up' successfully.`);
        return NextResponse.json({ message: 'Orders accepted! Food picked up from restaurant.' }, { status: 200 });

    } catch (error) {
        console.error("[API accept-order] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
