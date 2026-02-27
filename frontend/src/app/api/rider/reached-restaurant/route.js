
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API reached-restaurant] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider

        const { orderIds } = await req.json();
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ message: 'Order IDs array is required.' }, { status: 400 });
        }

        console.log(`[API reached-restaurant] Rider ${uid} reached restaurant for orders: ${orderIds.join(', ')}`);

        const batch = firestore.batch();
        const ordersCollectionRef = firestore.collection('orders');

        // 🔒 SECURITY: Validate each order before updating
        for (const orderId of orderIds) {
            const orderRef = ordersCollectionRef.doc(orderId);
            const orderSnap = await orderRef.get();

            // Check if order exists
            if (!orderSnap.exists) {
                console.error(`[API reached-restaurant] Order ${orderId} not found.`);
                return NextResponse.json({ message: `Order ${orderId} not found.` }, { status: 404 });
            }

            const orderData = orderSnap.data();

            // 🔒 SECURITY CHECK 1: Is this order assigned to THIS rider?
            if (orderData.deliveryBoyId !== uid) {
                console.warn(`[API reached-restaurant] SECURITY ALERT: Rider ${uid} attempted to update order ${orderId} assigned to ${orderData.deliveryBoyId}.`);
                return NextResponse.json(
                    { message: `Unauthorized: Order ${orderId} is not assigned to you.` },
                    { status: 403 }
                );
            }

            // 🔒 SECURITY CHECK 2: Is order in correct state?
            if (orderData.status !== 'dispatched') {
                console.warn(`[API reached-restaurant] Order ${orderId} has invalid status: ${orderData.status}. Expected 'dispatched'.`);
                return NextResponse.json(
                    { message: `Order ${orderId} must be in 'dispatched' state. Current status: ${orderData.status}` },
                    { status: 400 }
                );
            }

            // ✅ All security checks passed → update status
            batch.update(orderRef, {
                status: 'reached_restaurant',
                statusHistory: FieldValue.arrayUnion({
                    status: 'reached_restaurant',
                    timestamp: new Date(),
                    updatedBy: uid
                })
            });
        }

        await batch.commit();

        console.log(`[API reached-restaurant] Orders updated to 'reached_restaurant' successfully.`);
        return NextResponse.json({ message: 'Arrived at restaurant. Waiting for food pickup.' }, { status: 200 });

    } catch (error) {
        console.error("[API reached-restaurant] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
