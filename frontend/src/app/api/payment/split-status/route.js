

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const splitId = searchParams.get('splitId');

    console.log(`[API /payment/split-status] GET request received for splitId: ${splitId}`);

    if (!splitId) {
        console.error("[API /payment/split-status] Error: Split session ID is required.");
        return NextResponse.json({ message: 'Split session ID is required.' }, { status: 400 });
    }

    try {
        const firestore = await getFirestore();
        const splitDocRef = firestore.collection('split_payments').doc(splitId);
        
        console.log(`[API /payment/split-status] Fetching Firestore document at: ${splitDocRef.path}`);
        const docSnap = await splitDocRef.get();

        if (!docSnap.exists) {
            console.warn(`[API /payment/split-status] Document not found for splitId: ${splitId}`);
            return NextResponse.json({ message: 'Split payment session not found.' }, { status: 404 });
        }

        const data = docSnap.data();
        console.log(`[API /payment/split-status] Successfully fetched data for splitId: ${splitId}. Status: ${data.status}, Shares Paid: ${data.shares?.filter(s => s.status === 'paid').length}/${data.splitCount}`);

        // If the session is completed, we need to provide the tracking token for the base order
        if (data.status === 'completed') {
            console.log(`[API /payment/split-status] Split session completed. Fetching tracking token for base order: ${data.baseOrderId}`);
            const orderDocRef = firestore.collection('orders').doc(data.baseOrderId);
            const orderDoc = await orderDocRef.get();
            if (orderDoc.exists()) {
                data.trackingToken = orderDoc.data().trackingToken || null;
                console.log(`[API /payment/split-status] Tracking token found: ${!!data.trackingToken}`);
            } else {
                 console.warn(`[API /payment/split-status] Base order ${data.baseOrderId} not found.`);
            }
        }

        return NextResponse.json(data, { status: 200 });

    } catch (error) {
        console.error(`[API /payment/split-status] CRITICAL: Error fetching split session ${splitId}:`, error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
