

import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const LOST_STATUSES = new Set([
    'rejected',
    'cancelled',
    'failed_delivery',
    'returned_to_restaurant',
    'awaiting_payment',
    'payment_failed',
]);

const toAmount = (value, fallback = 0) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : fallback;
};

const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value?.toDate === 'function') {
        const parsed = value.toDate();
        return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getWeekStart = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);
    return start;
};

export async function GET(req) {
    try {
        const uid = await verifyAndGetUid(req); // Use central helper
        const firestore = await getFirestore();

        const [ordersByUserIdSnap, ordersByLegacyCustomerIdSnap] = await Promise.all([
            firestore.collection('orders')
                .where('userId', '==', uid)
                .select('orderDate', 'restaurantName', 'restaurantId', 'items', 'discount', 'status', 'totalAmount')
                .get(),
            firestore.collection('orders')
                .where('customerId', '==', uid)
                .select('orderDate', 'restaurantName', 'restaurantId', 'items', 'discount', 'status', 'totalAmount')
                .get(),
        ]);

        const uniqueOrders = new Map();
        ordersByUserIdSnap.forEach((doc) => uniqueOrders.set(doc.id, doc.data()));
        ordersByLegacyCustomerIdSnap.forEach((doc) => uniqueOrders.set(doc.id, doc.data()));

        if (uniqueOrders.size === 0) {
            return NextResponse.json({
                quickReorder: null,
                myRestaurants: [],
                myStats: { totalSavings: 0, topRestaurant: 'N/A', topDish: 'N/A' },
                analyticsPreview: {
                    spendThisWeek: 0,
                    spendThisMonth: 0,
                    spendThisYear: 0,
                    totalSpendAllTime: 0,
                    totalOrdersAllTime: 0,
                    activeRestaurants: 0,
                },
            }, { status: 200 });
        }

        const orders = Array.from(uniqueOrders.values());
        
        orders.sort((a, b) => (toDate(b.orderDate)?.getTime() || 0) - (toDate(a.orderDate)?.getTime() || 0));

        const lastOrder = orders[0];
        const quickReorder = {
            restaurantName: lastOrder.restaurantName,
            dishName: lastOrder.items[0]?.name || 'your last item',
            restaurantId: lastOrder.restaurantId,
        };

        const restaurantMap = new Map();
        orders.forEach(order => {
            if (!restaurantMap.has(order.restaurantId)) {
                restaurantMap.set(order.restaurantId, { name: order.restaurantName, id: order.restaurantId });
            }
        });
        const myRestaurants = Array.from(restaurantMap.values()).slice(0, 5);

        let totalSavings = 0;
        const restaurantFrequency = {};
        const dishFrequency = {};
        let totalSpendAllTime = 0;
        let totalOrdersAllTime = 0;
        let spendThisWeek = 0;
        let spendThisMonth = 0;
        let spendThisYear = 0;

        const now = new Date();
        const weekStart = getWeekStart(now);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const yearStart = new Date(now.getFullYear(), 0, 1);

        orders.forEach(order => {
            totalSavings += order.discount || 0;
            const status = String(order.status || '').toLowerCase();
            const isCountable = !LOST_STATUSES.has(status);
            const orderDate = toDate(order.orderDate);
            const orderAmount = Math.max(0, toAmount(order.totalAmount));

            if (isCountable) {
              totalSpendAllTime += orderAmount;
              totalOrdersAllTime += 1;

              if (orderDate && orderDate >= weekStart) spendThisWeek += orderAmount;
              if (orderDate && orderDate >= monthStart) spendThisMonth += orderAmount;
              if (orderDate && orderDate >= yearStart) spendThisYear += orderAmount;
            }

            if (order.restaurantName) {
              restaurantFrequency[order.restaurantName] = (restaurantFrequency[order.restaurantName] || 0) + 1;
            }
            (order.items || []).forEach(item => {
                if(item.name) {
                  const itemQuantity = Number(item.quantity ?? item.qty ?? 1) || 1;
                  dishFrequency[item.name] = (dishFrequency[item.name] || 0) + itemQuantity;
                }
            });
        });

        const topRestaurant = Object.keys(restaurantFrequency).length > 0 
            ? Object.entries(restaurantFrequency).sort((a, b) => b[1] - a[1])[0][0] 
            : 'N/A';
            
        const topDish = Object.keys(dishFrequency).length > 0 
            ? Object.entries(dishFrequency).sort((a, b) => b[1] - a[1])[0][0]
            : 'N/A';

        const myStats = { totalSavings, topRestaurant, topDish };
        const analyticsPreview = {
            spendThisWeek: Number(spendThisWeek.toFixed(2)),
            spendThisMonth: Number(spendThisMonth.toFixed(2)),
            spendThisYear: Number(spendThisYear.toFixed(2)),
            totalSpendAllTime: Number(totalSpendAllTime.toFixed(2)),
            totalOrdersAllTime,
            activeRestaurants: restaurantMap.size,
        };

        const finalPayload = { quickReorder, myRestaurants, myStats, analyticsPreview };

        return NextResponse.json(finalPayload, { status: 200 });

    } catch (error) {
        console.error("[API hub-data] CRITICAL ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
