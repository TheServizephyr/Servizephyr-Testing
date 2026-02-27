import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { startOfDay, endOfDay } from 'date-fns';

async function getBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    let finalUserId = uid;

    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }
        finalUserId = employeeOfOwnerId;
    }
    // Owner access
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'admin'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops'];
    for (const collection of collectionsToTry) {
        const query = await firestore.collection(collection).where('ownerId', '==', finalUserId).limit(1).get();
        if (!query.empty) {
            return query.docs[0].ref;
        }
    }

    throw { message: 'No business associated with this request.', status: 404 };
}

export async function GET(req) {
    const firestore = await getFirestore();

    try {
        const businessRef = await getBusinessRef(req);
        if (!businessRef) throw { message: 'Business reference not found.', status: 404 };

        const { searchParams } = new URL(req.url, `http://${req.headers.host}`);

        // Date range filtering - default to today
        const startDateParam = searchParams.get('startDate');
        const endDateParam = searchParams.get('endDate');
        const today = new Date();

        const startDate = startDateParam ? startOfDay(new Date(startDateParam)) : startOfDay(today);
        const endDate = endDateParam ? endOfDay(new Date(endDateParam)) : endOfDay(today);

        console.log(`[Dine-In History] Fetching from ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Fetch dine-in orders with indexed date range.
        const ordersQuery = firestore.collection('orders')
            .where('restaurantId', '==', businessRef.id)
            .where('deliveryType', '==', 'dine-in')
            .where('orderDate', '>=', startDate)
            .where('orderDate', '<=', endDate)
            .orderBy('orderDate', 'desc');

        const ordersSnap = await ordersQuery.get();

        const completedOrders = [];
        const cancelledOrders = [];

        ordersSnap.forEach(doc => {
            const orderData = { id: doc.id, ...doc.data() };

            // Categorize orders
            if (orderData.status === 'cancelled' || orderData.status === 'rejected') {
                cancelledOrders.push(orderData);
            } else if (orderData.cleaned === true) {
                // ✅ Cleaned orders go to completed
                completedOrders.push(orderData);
            } else if (orderData.status === 'delivered' && orderData.paymentStatus === 'paid') {
                completedOrders.push(orderData);
            }
        });

        return NextResponse.json({
            completedOrders,
            cancelledOrders,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            totalCompleted: completedOrders.length,
            totalCancelled: cancelledOrders.length
        });

    } catch (error) {
        console.error('[Dine-In History API] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch history' },
            { status: error.status || 500 }
        );
    }
}
