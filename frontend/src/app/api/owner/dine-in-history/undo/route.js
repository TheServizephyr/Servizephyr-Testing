import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

async function getBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);
    const searchParams = req.nextUrl.searchParams;

    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    let businessRef;
    if (impersonatedOwnerId) {
        businessRef = firestore.collection('users').doc(impersonatedOwnerId);
    } else if (employeeOfOwnerId) {
        businessRef = firestore.collection('users').doc(employeeOfOwnerId);
    } else {
        businessRef = firestore.collection('users').doc(uid);
    }

    const businessSnap = await businessRef.get();
    if (!businessSnap.exists) {
        throw { message: 'Business not found', status: 404 };
    }

    return businessRef;
}

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const businessRef = await getBusinessRef(req);

        const body = await req.json();
        const { orderId, action } = body;

        if (!orderId || !action) {
            return NextResponse.json(
                { error: 'Missing orderId or action' },
                { status: 400 }
            );
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) {
            return NextResponse.json(
                { error: 'Order not found' },
                { status: 404 }
            );
        }

        const orderData = orderSnap.data();

        // Verify ownership
        if (orderData.restaurantId !== businessRef.id) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 403 }
            );
        }

        // Undo action based on type
        if (action === 'uncleaned') {
            // Remove cleaned flag to restore to dashboard
            await orderRef.update({
                cleaned: false,
                cleanedAt: null
            });

            console.log(`[Undo] Removed cleaned flag from order ${orderId}`);

            return NextResponse.json({
                success: true,
                message: 'Order uncleaned - returned to dashboard'
            });

        } else if (action === 'uncancel') {
            // Change back to previous status (assuming 'confirmed' or 'preparing')
            await orderRef.update({
                status: 'confirmed',
                rejectionReason: null,
                cancelledAt: null
            });

            console.log(`[Undo] Uncancelled order ${orderId}`);

            return NextResponse.json({
                success: true,
                message: 'Order restored to confirmed status'
            });

        } else {
            return NextResponse.json(
                { error: 'Invalid action' },
                { status: 400 }
            );
        }

    } catch (error) {
        console.error('[Undo API] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to undo action' },
            { status: error.status || 500 }
        );
    }
}
