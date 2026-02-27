import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// POST: Mark dine-in orders as paid after successful payment
export async function POST(req) {
    try {
        const { tabId, restaurantId, paymentDetails } = await req.json();

        if (!tabId || !restaurantId) {
            return NextResponse.json({ message: 'TabId and RestaurantId required' }, { status: 400 });
        }

        // 🔐 AUTH & OWNERSHIP CHECK
        const ownerContext = await verifyOwnerWithAudit(
            req,
            'mark_dine_in_paid',
            { tabId, restaurantId },
            false,
            [PERMISSIONS.PROCESS_PAYMENT, PERMISSIONS.MANAGE_DINE_IN]
        );
        if (!ownerContext || ownerContext.businessId !== restaurantId) {
            console.warn(`[Mark Paid] Unauthorized attempt for Restaurant ${restaurantId}`);
            return NextResponse.json({ message: 'Unauthorized. Ownership verification failed.' }, { status: 403 });
        }


        const firestore = await getFirestore();

        // Fetch all orders for this tab
        const ordersQuery = await firestore.collection('orders')
            .where('dineInTabId', '==', tabId)
            .where('restaurantId', '==', restaurantId)
            .where('status', 'not-in', ['rejected', 'picked_up'])
            .get();

        if (ordersQuery.empty) {
            return NextResponse.json({ message: 'No orders found for this tab' }, { status: 404 });
        }

        const batch = firestore.batch();

        // Mark all orders as paid
        ordersQuery.docs.forEach(doc => {
            batch.update(doc.ref, {
                paymentStatus: 'paid',
                paymentMethod: 'razorpay',
                paymentDetails: paymentDetails,
                paidAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
        });

        await batch.commit();

        console.log(`[Mark Paid] Marked ${ordersQuery.size} orders as paid for tab ${tabId}`);

        return NextResponse.json({
            message: 'Orders marked as paid successfully',
            orderCount: ordersQuery.size,
            tabId
        }, { status: 200 });

    } catch (error) {
        console.error('[Mark Paid] Error:', error);
        return NextResponse.json(
            { message: error?.message || 'Internal Server Error' },
            { status: error?.status || 500 }
        );
    }
}
