

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const firestore = await getFirestore();

        // 1. Pending Approvals from both collections
        const pendingRestaurantsSnap = await firestore.collection('restaurants').where('approvalStatus', '==', 'pending').count().get();
        const pendingShopsSnap = await firestore.collection('shops').where('approvalStatus', '==', 'pending').count().get();
        const pendingApprovals = pendingRestaurantsSnap.data().count + pendingShopsSnap.data().count;


        // 2. Total Listings from both collections
        const totalRestoSnap = await firestore.collection('restaurants').count().get();
        const totalShopsSnap = await firestore.collection('shops').count().get();
        const totalListings = totalRestoSnap.data().count + totalShopsSnap.data().count;

        // 3. Total Users
        const totalUsersSnap = await firestore.collection('users').count().get();
        const totalUsers = totalUsersSnap.data().count;

        // 4. Today's metrics
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayOrdersSnap = await firestore.collection('orders').where('orderDate', '>=', today).get();
        const todayOrders = todayOrdersSnap.size;
        const todayRevenue = todayOrdersSnap.docs.reduce((sum, doc) => sum + (doc.data().totalAmount || 0), 0);

        // 5. Recent Signups
        const recentUsersSnap = await firestore.collection('users').orderBy('createdAt', 'desc').limit(4).get();
        const recentSignups = recentUsersSnap.docs.map(doc => {
            const data = doc.data();
            const signupTime = data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString();

            let userType = 'User';
            if (data.businessType === 'restaurant') {
                userType = 'Restaurant';
            } else if (data.businessType === 'shop' || data.businessType === 'store') {
                userType = 'Store';
            } else if (data.role === 'customer') {
                userType = 'Customer'
            }

            return {
                type: userType,
                name: data.name || 'Unnamed User',
                time: signupTime,
            };
        });

        // 6. Weekly Order Data
        const weeklyOrderData = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const day = date.toLocaleDateString('en-US', { weekday: 'short' });

            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);

            const daySnap = await firestore.collection('orders')
                .where('orderDate', '>=', startOfDay)
                .where('orderDate', '<=', endOfDay)
                .count().get();

            weeklyOrderData.push({ day, orders: daySnap.data().count });
        }


        return NextResponse.json({
            pendingApprovals,
            totalListings,
            totalUsers,
            todayOrders,
            todayRevenue,
            recentSignups,
            weeklyOrderData
        }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/dashboard-stats ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
