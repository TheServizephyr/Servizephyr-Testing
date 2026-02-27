import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const { searchParams } = new URL(req.url);
        const listingId = searchParams.get('id');
        const businessType = searchParams.get('type'); // 'restaurant', 'store', 'street-vendor'

        if (!listingId || !businessType) {
            return NextResponse.json(
                { message: 'Missing required parameters: id and type' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();

        // Get listing details
        let collectionName;
        if (businessType === 'restaurant') {
            collectionName = 'restaurants';
        } else if (businessType === 'shop' || businessType === 'store') {
            collectionName = 'shops';
        } else if (businessType === 'street-vendor') {
            collectionName = 'street_vendors';
        } else {
            return NextResponse.json(
                { message: 'Invalid business type' },
                { status: 400 }
            );
        }

        const listingRef = firestore.collection(collectionName).doc(listingId);
        const listingSnap = await listingRef.get();

        if (!listingSnap.exists) {
            return NextResponse.json(
                { message: 'Listing not found' },
                { status: 404 }
            );
        }

        const listingData = listingSnap.data();

        // Get all orders for this listing
        const ordersSnap = await firestore.collection('orders')
            .where('restaurantId', '==', listingId)
            .get();

        // Calculate analytics
        let totalOrders = 0;
        let totalRevenue = 0;
        let uniqueCustomers = new Set();
        let totalItems = 0;
        const dailyData = {};

        // Initialize last 7 days
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            dailyData[dateKey] = { orders: 0, revenue: 0 };
        }

        ordersSnap.docs.forEach(doc => {
            const order = doc.data();
            totalOrders++;
            const amount = order.totalAmount || 0;
            totalRevenue += amount;

            if (order.customerId) {
                uniqueCustomers.add(order.customerId);
            }

            const items = order.items || [];
            totalItems += items.length;

            // Add to daily data
            const orderDate = order.orderDate?.toDate?.() || new Date(order.orderDate);
            const dateKey = orderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            if (dailyData[dateKey]) {
                dailyData[dateKey].orders++;
                dailyData[dateKey].revenue += amount;
            }
        });

        // Calculate average order value
        const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

        // Get recent orders for timeline
        const recentOrdersSnap = await firestore.collection('orders')
            .where('restaurantId', '==', listingId)
            .orderBy('orderDate', 'desc')
            .limit(5)
            .get();

        const recentOrders = recentOrdersSnap.docs.map(doc => {
            const order = doc.data();
            return {
                id: doc.id,
                customerName: order.customerName || 'Unknown',
                amount: order.totalAmount || 0,
                status: order.orderStatus || 'Pending',
                itemCount: (order.items || []).length,
                date: order.orderDate?.toDate?.()?.toISOString() || new Date().toISOString()
            };
        });

        // Convert dailyData object to array for chart
        const chartData = Object.entries(dailyData).map(([date, data]) => ({
            date,
            orders: data.orders,
            revenue: data.revenue
        }));

        return NextResponse.json({
            listing: {
                id: listingId,
                name: listingData.name || 'Unnamed',
                type: businessType
            },
            analytics: {
                totalOrders,
                totalRevenue: Math.round(totalRevenue * 100) / 100,
                uniqueCustomers: uniqueCustomers.size,
                totalItems,
                avgOrderValue,
                recentOrders,
                chartData
            }
        }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/listing-analytics ERROR:", error);
        return NextResponse.json(
            { message: 'Internal Server Error', error: error.message },
            { status: 500 }
        );
    }
}
