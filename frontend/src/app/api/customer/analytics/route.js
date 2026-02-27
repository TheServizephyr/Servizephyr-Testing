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

const ONLINE_METHODS = new Set(['online', 'razorpay', 'phonepe', 'upi', 'card', 'wallet']);
const CASH_METHODS = new Set(['cod', 'cash', 'pay_at_counter', 'counter']);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toAmount = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
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

const normalizeMethod = (value) => String(value || '').trim().toLowerCase();
const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

const normalizeDeliveryType = (value) => {
    const type = String(value || '').trim().toLowerCase();
    if (!type) return 'unknown';
    if (type === 'dine-in') return 'dine-in';
    if (type === 'pickup') return 'pickup';
    if (type.includes('street')) return 'street-vendor';
    if (type === 'delivery') return 'delivery';
    return type;
};

const getWeekStart = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);
    return start;
};

const getDateKey = (date) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const getMonthKey = (date) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
};

const detectPaymentBucket = (order = {}) => {
    const rootMethod = normalizeMethod(order.paymentMethod);
    if (ONLINE_METHODS.has(rootMethod)) return 'online';
    if (CASH_METHODS.has(rootMethod)) return 'cash';

    const details = Array.isArray(order.paymentDetails)
        ? order.paymentDetails
        : (order.paymentDetails ? [order.paymentDetails] : []);

    let hasOnline = false;
    let hasCash = false;
    for (const payment of details) {
        const method = normalizeMethod(payment?.method);
        const status = normalizeStatus(payment?.status);
        const paid = !status || status === 'paid' || status === 'completed' || status === 'success' || status === 'pending';

        if (!paid) continue;
        if (ONLINE_METHODS.has(method)) hasOnline = true;
        if (CASH_METHODS.has(method)) hasCash = true;
    }

    if (hasOnline && hasCash) return 'mixed';
    if (hasOnline) return 'online';
    if (hasCash) return 'cash';
    return 'other';
};

const getPeakWindow = (hourly) => {
    const buckets = [
        { key: 'Breakfast', start: 6, end: 11 },
        { key: 'Lunch', start: 11, end: 16 },
        { key: 'Evening', start: 16, end: 20 },
        { key: 'Dinner', start: 20, end: 24 },
        { key: 'Late Night', start: 0, end: 6 },
    ];

    let winner = { key: 'N/A', count: 0 };
    for (const bucket of buckets) {
        let sum = 0;
        for (let hour = bucket.start; hour < bucket.end; hour += 1) {
            sum += hourly[hour] || 0;
        }
        if (sum > winner.count) {
            winner = { key: bucket.key, count: sum };
        }
    }
    return winner;
};

const computeStreaks = (dateKeysSet) => {
    if (!dateKeysSet || dateKeysSet.size === 0) {
        return { currentStreak: 0, longestStreak: 0 };
    }

    const keys = Array.from(dateKeysSet).sort();
    const millis = keys.map((key) => new Date(`${key}T00:00:00.000Z`).getTime());
    const oneDay = 24 * 60 * 60 * 1000;

    let longest = 1;
    let running = 1;
    for (let i = 1; i < millis.length; i += 1) {
        if (millis[i] - millis[i - 1] === oneDay) {
            running += 1;
            if (running > longest) longest = running;
        } else {
            running = 1;
        }
    }

    const todayKey = getDateKey(new Date(Date.now() + IST_OFFSET_MS));
    const yesterdayKey = getDateKey(new Date(Date.now() + IST_OFFSET_MS - oneDay));
    const latestKey = keys[keys.length - 1];

    let current = 0;
    if (latestKey === todayKey || latestKey === yesterdayKey) {
        current = 1;
        for (let i = keys.length - 1; i > 0; i -= 1) {
            const curr = new Date(`${keys[i]}T00:00:00.000Z`).getTime();
            const prev = new Date(`${keys[i - 1]}T00:00:00.000Z`).getTime();
            if (curr - prev === oneDay) {
                current += 1;
            } else {
                break;
            }
        }
    }

    return { currentStreak: current, longestStreak: longest };
};

export async function GET(req) {
    try {
        const uid = await verifyAndGetUid(req);
        const firestore = await getFirestore();

        const [
            userDoc,
            userIdOrdersSnap,
            legacyOrdersSnap,
            joinedRestaurantsSnap,
        ] = await Promise.all([
            firestore.collection('users').doc(uid).get(),
            firestore.collection('orders')
                .where('userId', '==', uid)
                .select(
                    'customerOrderId',
                    'restaurantId',
                    'restaurantName',
                    'items',
                    'status',
                    'orderDate',
                    'totalAmount',
                    'subtotal',
                    'discount',
                    'loyaltyDiscount',
                    'coupon',
                    'deliveryType',
                    'paymentMethod',
                    'paymentDetails'
                )
                .get(),
            firestore.collection('orders')
                .where('customerId', '==', uid)
                .select(
                    'customerOrderId',
                    'restaurantId',
                    'restaurantName',
                    'items',
                    'status',
                    'orderDate',
                    'totalAmount',
                    'subtotal',
                    'discount',
                    'loyaltyDiscount',
                    'coupon',
                    'deliveryType',
                    'paymentMethod',
                    'paymentDetails'
                )
                .get(),
            firestore.collection('users').doc(uid).collection('joined_restaurants')
                .select('restaurantName', 'totalSpend', 'totalOrders', 'loyaltyPoints', 'lastOrderDate')
                .get(),
        ]);

        const now = new Date();
        const weekStart = getWeekStart(now);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const yearStart = new Date(now.getFullYear(), 0, 1);

        const uniqueOrders = new Map();
        userIdOrdersSnap.forEach((doc) => uniqueOrders.set(doc.id, { id: doc.id, ...doc.data() }));
        legacyOrdersSnap.forEach((doc) => uniqueOrders.set(doc.id, { id: doc.id, ...doc.data() }));

        const restaurantStats = new Map();
        const dishStats = new Map();
        const monthlyMap = new Map();
        const deliveryTypeMap = new Map();
        const paymentMap = new Map();
        const statusMap = new Map();
        const dateKeysSet = new Set();
        const hourlyOrders = Array(24).fill(0);
        const weekdayOrders = Array(7).fill(0);
        const recentOrders = [];
        const orderTimeline = [];

        let spendThisWeek = 0;
        let spendThisMonth = 0;
        let spendThisYear = 0;
        let totalEligibleOrders = 0;
        let eligibleSpendFromOrders = 0;
        let totalSaved = 0;
        let savedThisMonth = 0;
        let couponUses = 0;

        uniqueOrders.forEach((order) => {
            const status = normalizeStatus(order.status || 'pending');
            statusMap.set(status, (statusMap.get(status) || 0) + 1);

            const orderDate = toDate(order.orderDate);
            const amount = Math.max(0, toAmount(order.totalAmount, toAmount(order.subtotal)));
            const subtotal = Math.max(0, toAmount(order.subtotal, amount));

            if (!orderDate) return;

            const discount = Math.max(
                toAmount(order.discount, 0),
                toAmount(order.loyaltyDiscount, 0)
            );
            if (discount > 0) {
                totalSaved += discount;
                if (orderDate >= monthStart) savedThisMonth += discount;
            }
            if (order.coupon) couponUses += 1;

            const monthKey = getMonthKey(new Date(orderDate.getTime() + IST_OFFSET_MS));
            const monthRow = monthlyMap.get(monthKey) || { monthKey, spend: 0, orders: 0 };
            monthRow.spend += amount;
            monthRow.orders += 1;
            monthlyMap.set(monthKey, monthRow);

            const dateKey = getDateKey(new Date(orderDate.getTime() + IST_OFFSET_MS));
            dateKeysSet.add(dateKey);

            const istDate = new Date(orderDate.getTime() + IST_OFFSET_MS);
            hourlyOrders[istDate.getUTCHours()] += 1;
            weekdayOrders[istDate.getUTCDay()] += 1;

            const isLost = LOST_STATUSES.has(status);
            const items = Array.isArray(order.items) ? order.items : [];

            orderTimeline.push({
                id: order.id,
                customerOrderId: order.customerOrderId || null,
                restaurantId: String(order.restaurantId || '').trim() || 'unknown',
                restaurantName: String(order.restaurantName || 'Unknown Restaurant').trim(),
                amount: Number(amount.toFixed(2)),
                status,
                isLost,
                orderDate: orderDate.toISOString(),
                deliveryType: normalizeDeliveryType(order.deliveryType),
                paymentMethod: normalizeMethod(order.paymentMethod) || detectPaymentBucket(order),
                savings: Number(discount.toFixed(2)),
                items: items.slice(0, 5).map((item) => ({
                    name: String(item?.name || 'Item'),
                    quantity: Math.max(1, toAmount(item?.quantity ?? item?.qty, 1)),
                    spend: Number(Math.max(0, toAmount(item?.totalPrice, toAmount(item?.price) * Math.max(1, toAmount(item?.quantity ?? item?.qty, 1)))).toFixed(2)),
                })),
            });

            if (isLost) return;

            totalEligibleOrders += 1;
            eligibleSpendFromOrders += amount;

            if (orderDate >= weekStart) spendThisWeek += amount;
            if (orderDate >= monthStart) spendThisMonth += amount;
            if (orderDate >= yearStart) spendThisYear += amount;

            const restaurantId = String(order.restaurantId || '').trim() || 'unknown';
            const restaurantName = String(order.restaurantName || 'Unknown Restaurant').trim();
            const restaurantRow = restaurantStats.get(restaurantId) || {
                restaurantId,
                restaurantName,
                spend: 0,
                orders: 0,
                avgOrderValue: 0,
                lastOrderDate: null,
                loyaltyPoints: 0,
            };

            restaurantRow.spend += amount;
            restaurantRow.orders += 1;
            restaurantRow.avgOrderValue = restaurantRow.orders > 0 ? (restaurantRow.spend / restaurantRow.orders) : 0;
            restaurantRow.lastOrderDate = !restaurantRow.lastOrderDate || orderDate > restaurantRow.lastOrderDate
                ? orderDate
                : restaurantRow.lastOrderDate;
            restaurantStats.set(restaurantId, restaurantRow);

            const deliveryType = normalizeDeliveryType(order.deliveryType);
            const deliveryRow = deliveryTypeMap.get(deliveryType) || { type: deliveryType, count: 0, spend: 0 };
            deliveryRow.count += 1;
            deliveryRow.spend += amount;
            deliveryTypeMap.set(deliveryType, deliveryRow);

            const paymentBucket = detectPaymentBucket(order);
            const paymentRow = paymentMap.get(paymentBucket) || { method: paymentBucket, count: 0, spend: 0 };
            paymentRow.count += 1;
            paymentRow.spend += amount;
            paymentMap.set(paymentBucket, paymentRow);

            for (const item of items) {
                const dishName = String(item?.name || '').trim();
                if (!dishName) continue;
                const qty = Math.max(1, toAmount(item?.quantity ?? item?.qty, 1));
                const itemPrice = Math.max(0, toAmount(item?.price, 0));
                const itemTotal = Math.max(0, toAmount(item?.totalPrice, itemPrice * qty));
                const dishRow = dishStats.get(dishName) || { name: dishName, quantity: 0, spend: 0, orders: 0 };
                dishRow.quantity += qty;
                dishRow.spend += itemTotal;
                dishRow.orders += 1;
                dishStats.set(dishName, dishRow);
            }

            recentOrders.push({
                id: order.id,
                customerOrderId: order.customerOrderId || null,
                restaurantId,
                restaurantName,
                amount,
                status,
                orderDate: orderDate.toISOString(),
                itemPreview: items.slice(0, 2).map((item) => `${Math.max(1, toAmount(item?.quantity ?? item?.qty, 1))}x ${item?.name || 'Item'}`),
            });
        });

        const joinedRestaurants = [];
        let loyaltyTotalFromRestaurants = 0;
        joinedRestaurantsSnap.forEach((doc) => {
            const data = doc.data() || {};
            const loyaltyPoints = Math.max(0, toAmount(data.loyaltyPoints, 0));
            loyaltyTotalFromRestaurants += loyaltyPoints;
            joinedRestaurants.push({
                restaurantId: doc.id,
                restaurantName: data.restaurantName || restaurantStats.get(doc.id)?.restaurantName || 'Restaurant',
                loyaltyPoints,
                totalSpend: Math.max(0, toAmount(data.totalSpend, restaurantStats.get(doc.id)?.spend || 0)),
                totalOrders: Math.max(0, toAmount(data.totalOrders, restaurantStats.get(doc.id)?.orders || 0)),
                lastOrderDate: toDate(data.lastOrderDate)?.toISOString() || restaurantStats.get(doc.id)?.lastOrderDate?.toISOString() || null,
            });
        });

        restaurantStats.forEach((row) => {
            if (!joinedRestaurants.find((entry) => entry.restaurantId === row.restaurantId)) {
                joinedRestaurants.push({
                    restaurantId: row.restaurantId,
                    restaurantName: row.restaurantName,
                    loyaltyPoints: 0,
                    totalSpend: row.spend,
                    totalOrders: row.orders,
                    lastOrderDate: row.lastOrderDate?.toISOString() || null,
                });
            }
        });

        joinedRestaurants.forEach((row) => {
            if (restaurantStats.has(row.restaurantId)) {
                restaurantStats.get(row.restaurantId).loyaltyPoints = row.loyaltyPoints;
            }
        });

        const userData = userDoc.exists ? (userDoc.data() || {}) : {};
        const userTotalSpend = Math.max(0, toAmount(userData.totalSpend, eligibleSpendFromOrders));
        const userTotalOrders = Math.max(0, toAmount(userData.totalOrders, totalEligibleOrders));
        const userLoyaltyPoints = Math.max(
            0,
            toAmount(userData.loyaltyPoints, loyaltyTotalFromRestaurants)
        );

        const topRestaurants = Array.from(restaurantStats.values())
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 12)
            .map((row) => ({
                ...row,
                spend: Number(row.spend.toFixed(2)),
                avgOrderValue: Number(row.avgOrderValue.toFixed(2)),
                lastOrderDate: row.lastOrderDate?.toISOString() || null,
            }));

        const topDishes = Array.from(dishStats.values())
            .sort((a, b) => {
                if (b.quantity !== a.quantity) return b.quantity - a.quantity;
                return b.spend - a.spend;
            })
            .slice(0, 15)
            .map((row) => ({
                ...row,
                spend: Number(row.spend.toFixed(2)),
            }));

        const monthlyTrend = Array.from(monthlyMap.values())
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
            .slice(-12)
            .map((row) => ({
                ...row,
                spend: Number(row.spend.toFixed(2)),
            }));

        const paymentBreakdown = Array.from(paymentMap.values())
            .sort((a, b) => b.spend - a.spend)
            .map((row) => ({
                ...row,
                spend: Number(row.spend.toFixed(2)),
            }));

        const deliveryBreakdown = Array.from(deliveryTypeMap.values())
            .sort((a, b) => b.spend - a.spend)
            .map((row) => ({
                ...row,
                spend: Number(row.spend.toFixed(2)),
            }));

        const statusBreakdown = Array.from(statusMap.entries())
            .map(([status, count]) => ({ status, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const weekdayPattern = weekdayOrders.map((count, index) => ({
            day: WEEKDAY_LABELS[index],
            count,
        }));

        const hourlyPattern = hourlyOrders.map((count, hour) => ({
            hour,
            count,
        }));

        const peakWindow = getPeakWindow(hourlyOrders);
        const streaks = computeStreaks(dateKeysSet);

        recentOrders.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
        orderTimeline.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

        return NextResponse.json(
            {
                generatedAt: new Date().toISOString(),
                summary: {
                    totalSpendAllTime: Number(userTotalSpend.toFixed(2)),
                    totalOrdersAllTime: userTotalOrders,
                    averageOrderValue: userTotalOrders > 0 ? Number((userTotalSpend / userTotalOrders).toFixed(2)) : 0,
                    spendThisWeek: Number(spendThisWeek.toFixed(2)),
                    spendThisMonth: Number(spendThisMonth.toFixed(2)),
                    spendThisYear: Number(spendThisYear.toFixed(2)),
                    activeRestaurants: restaurantStats.size,
                    activeOrderingDays: dateKeysSet.size,
                    currentStreakDays: streaks.currentStreak,
                    longestStreakDays: streaks.longestStreak,
                },
                savings: {
                    totalSaved: Number(totalSaved.toFixed(2)),
                    savedThisMonth: Number(savedThisMonth.toFixed(2)),
                    couponUses,
                },
                loyalty: {
                    totalPoints: userLoyaltyPoints,
                    restaurants: joinedRestaurants
                        .sort((a, b) => b.loyaltyPoints - a.loyaltyPoints)
                        .slice(0, 20),
                },
                topRestaurants,
                topDishes,
                monthlyTrend,
                behavior: {
                    peakWindow: peakWindow.key,
                    peakWindowOrders: peakWindow.count,
                    paymentBreakdown,
                    deliveryBreakdown,
                    statusBreakdown,
                    weekdayPattern,
                    hourlyPattern,
                },
                recentOrders: recentOrders.slice(0, 8),
                orderTimeline: orderTimeline.slice(0, 1200),
            },
            {
                status: 200,
                headers: {
                    'Cache-Control': 'private, max-age=60',
                },
            }
        );
    } catch (error) {
        console.error('[API /customer/analytics] Error:', error);
        return NextResponse.json(
            { message: error.message || 'Internal Server Error' },
            { status: error.status || 500 }
        );
    }
}
