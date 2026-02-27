import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authentication

        const { orderId, paymentStatus, paymentMethod } = await req.json();

        if (!orderId || !paymentStatus) {
            return NextResponse.json({ message: 'Order ID and payment status required.' }, { status: 400 });
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
        }

        const orderData = orderDoc.data();

        // 🔒 Security: Ensure rider owns this order
        if (orderData.deliveryBoyId !== uid) {
            return NextResponse.json({ message: 'Unauthorized.' }, { status: 403 });
        }

        // Update payment status AND method
        await orderRef.update({
            paymentStatus: paymentStatus,
            paymentMethod: paymentMethod || orderData.paymentMethod || 'online', // Default or update
            lastUpdated: FieldValue.serverTimestamp()
        });

        return NextResponse.json({ success: true, message: 'Payment status updated.' });

    } catch (error) {
        console.error("Error updating payment status:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
