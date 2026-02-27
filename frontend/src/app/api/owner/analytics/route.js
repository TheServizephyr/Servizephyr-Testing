import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

const LOST_ORDER_STATUSES = new Set(['rejected', 'cancelled', 'failed_delivery', 'returned_to_restaurant']);

const toAmount = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

const normalizePhone = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length >= 10 ? digits.slice(-10) : digits;
};

const timestampToDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value?.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isGuestUserId = (userId) => {
    const value = String(userId || '').trim();
    return !value || value.startsWith('g_') || value.startsWith('anon_');
};

const isManualCallOrder = (order) =>
    order?.isManualCallOrder === true ||
    String(order?.orderSource || '').toLowerCase() === 'manual_call';

const isLostOrder = (status) => LOST_ORDER_STATUSES.has(String(status || '').toLowerCase());

const calcChange = (current, previous) => {
    if (!Number.isFinite(previous) || previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
};

const detectOnlinePayment = (order) => {
    let isOnline = false;

    if (Array.isArray(order?.paymentDetails)) {
        isOnline = order.paymentDetails.some((payment) =>
            (payment?.method === 'razorpay' || payment?.method === 'phonepe') &&
            (payment?.status === 'completed' || payment?.status === 'success' || payment?.status === 'paid')
        );
    } else if (order?.paymentDetails?.method) {
        isOnline = order.paymentDetails.method === 'razorpay' || order.paymentDetails.method === 'phonepe';
    }

    if (!isOnline && order?.paymentMethod) {
        isOnline = order.paymentMethod === 'razorpay' || order.paymentMethod === 'phonepe' || order.paymentMethod === 'online';
    }

    if (order?.paymentStatus === 'paid') isOnline = true;
    return isOnline;
};

const getOrderCustomerIdentity = (order, fallbackId = '') => {
    const rawUserId = String(order?.userId || order?.customerId || '').trim();
    const phone = normalizePhone(order?.customerPhone || order?.phone || '');
    const name = String(order?.customerName || order?.name || 'Guest').trim() || 'Guest';

    if (rawUserId && !isGuestUserId(rawUserId)) {
        return {
            key: `uid:${rawUserId}`,
            customerType: 'uid',
            customerId: rawUserId,
            name,
            phone,
        };
    }

    if (phone) {
        return {
            key: `guest:${phone}`,
            customerType: 'guest',
            customerId: phone,
            name,
            phone,
        };
    }

    if (rawUserId) {
        return {
            key: `guest:${rawUserId}`,
            customerType: 'guest',
            customerId: rawUserId,
            name,
            phone: '',
        };
    }

    return {
        key: `guest:unknown:${fallbackId || 'na'}`,
        customerType: 'guest',
        customerId: fallbackId || null,
        name,
        phone: '',
    };
};

const getCounterBillCustomerIdentity = (bill, fallbackId = '') => {
    const explicitType = String(bill?.customerType || '').toLowerCase() === 'uid' ? 'uid' : 'guest';
    const rawCustomerId = String(bill?.customerId || '').trim();
    const phone = normalizePhone(bill?.customerPhone || bill?.phone || '');
    const name = String(bill?.customerName || bill?.name || 'Walk-in').trim() || 'Walk-in';

    if (explicitType === 'uid' && rawCustomerId) {
        return {
            key: `uid:${rawCustomerId}`,
            customerType: 'uid',
            customerId: rawCustomerId,
            name,
            phone,
        };
    }

    if (phone) {
        return {
            key: `guest:${phone}`,
            customerType: 'guest',
            customerId: phone,
            name,
            phone,
        };
    }

    if (rawCustomerId) {
        return {
            key: `guest:${rawCustomerId}`,
            customerType: 'guest',
            customerId: rawCustomerId,
            name,
            phone: '',
        };
    }

    return {
        key: `guest:counter:${fallbackId || 'na'}`,
        customerType: 'guest',
        customerId: fallbackId || null,
        name,
        phone: '',
    };
};

const getOrCreateCustomerMix = (map, identity) => {
    if (!map.has(identity.key)) {
        map.set(identity.key, {
            customerKey: identity.key,
            customerType: identity.customerType,
            customerId: identity.customerId || null,
            name: identity.name || 'Customer',
            phone: identity.phone || '',
            onlineOrders: 0,
            manualCallOrders: 0,
            counterBills: 0,
            onlineRevenue: 0,
            manualCallRevenue: 0,
            counterBillRevenue: 0,
            totalSpent: 0,
        });
    }
    return map.get(identity.key);
};

const addSalesByDay = (salesByDay, salesDayOrder, date, amount) => {
    if (!date || !Number.isFinite(amount)) return;
    const dayKey = format(date, 'dd/MM');
    salesByDay[dayKey] = (salesByDay[dayKey] || 0) + amount;
    if (!salesDayOrder[dayKey]) {
        salesDayOrder[dayKey] = date.getTime();
    }
};

const RIDER_COMPLETED_STATUSES = new Set(['delivered', 'picked_up']);

const getDayKey = (date) => format(date, 'yyyy-MM-dd');

const getWeekRange = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    return { weekStart, weekEnd };
};

const getWeekKey = (date) => {
    const { weekStart, weekEnd } = getWeekRange(date);
    return `${format(weekStart, 'yyyy-MM-dd')}__${format(weekEnd, 'yyyy-MM-dd')}`;
};

const mapRiderSummary = (bucketMap, type) =>
    Array.from(bucketMap.entries())
        .map(([key, row]) => {
            if (type === 'day') {
                return {
                    dayKey: key,
                    date: key,
                    assignedOrders: row.assignedOrders,
                    completedOrders: row.completedOrders,
                    collection: row.collection,
                    orders: row.orders.sort((a, b) => b.orderDateTs - a.orderDateTs),
                };
            }

            return {
                weekKey: key,
                weekStart: row.weekStart,
                weekEnd: row.weekEnd,
                assignedOrders: row.assignedOrders,
                completedOrders: row.completedOrders,
                collection: row.collection,
                orders: row.orders.sort((a, b) => b.orderDateTs - a.orderDateTs),
            };
        })
        .sort((a, b) => {
            const aTs = type === 'day' ? new Date(a.date).getTime() : new Date(a.weekStart).getTime();
            const bTs = type === 'day' ? new Date(b.date).getTime() : new Date(b.weekStart).getTime();
            return bTs - aTs;
        });

export async function GET(req) {
    try {
        const firestore = await getFirestore();

        const { businessId: restaurantId, businessSnap, collectionName } = await verifyOwnerWithAudit(
            req,
            'view_analytics',
            {},
            false,
            PERMISSIONS.VIEW_ANALYTICS
        );
        const restaurantData = businessSnap.data() || {};

        const url = new URL(req.url, `http://${req.headers.host}`);
        const filter = url.searchParams.get('filter') || 'This Month';
        const fromDate = url.searchParams.get('from');
        const toDate = url.searchParams.get('to');

        let startDate;
        let prevStartDate;
        const now = new Date();

        if (filter === 'Custom Range' && fromDate && toDate) {
            startDate = new Date(fromDate);
            const duration = Math.max(0, new Date(toDate).getTime() - startDate.getTime());
            prevStartDate = new Date(startDate.getTime() - duration);
        } else {
            switch (filter) {
                case 'This Week':
                    startDate = new Date(now.setDate(now.getDate() - now.getDay()));
                    prevStartDate = new Date(new Date().setDate(startDate.getDate() - 7));
                    break;
                case 'This Year':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    prevStartDate = new Date(now.getFullYear() - 1, 0, 1);
                    break;
                case 'Today':
                    startDate = new Date(now.setHours(0, 0, 0, 0));
                    prevStartDate = new Date(new Date().setDate(startDate.getDate() - 1));
                    break;
                case 'This Month':
                default:
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    prevStartDate = new Date(new Date().setMonth(startDate.getMonth() - 1));
                    break;
            }
        }

        startDate.setHours(0, 0, 0, 0);
        prevStartDate.setHours(0, 0, 0, 0);

        const endDate = filter === 'Custom Range' && toDate ? new Date(toDate) : new Date();
        endDate.setHours(23, 59, 59, 999);

        const ordersRef = firestore.collection('orders').where('restaurantId', '==', restaurantId);
        const businessCollectionName = collectionName;
        const businessRef = firestore.collection(businessCollectionName).doc(restaurantId);
        const customBillHistoryRef = businessRef.collection('custom_bill_history');

        const [
            currentPeriodOrdersSnap,
            prevPeriodOrdersSnap,
            currentCounterBillsSnap,
            prevCounterBillsSnap,
            allMenuSnap,
            allCustomersSnap,
            ridersSnap,
        ] = await Promise.all([
            ordersRef
                .where('orderDate', '>=', startDate)
                .where('orderDate', '<=', endDate)
                .select(
                    'status',
                    'rejectionReason',
                    'cancellationReason',
                    'totalAmount',
                    'items',
                    'orderDate',
                    'isManualCallOrder',
                    'orderSource',
                    'paymentDetails',
                    'paymentMethod',
                    'paymentStatus',
                    'readyAt',
                    'customerPhone',
                    'phone',
                    'customerName',
                    'name',
                    'userId',
                    'customerId',
                    'customerOrderId',
                    'deliveryBoyId',
                    'deliveryType'
                )
                .get(),
            ordersRef
                .where('orderDate', '>=', prevStartDate)
                .where('orderDate', '<', startDate)
                .select('status', 'totalAmount')
                .get(),
            customBillHistoryRef
                .where('printedAt', '>=', startDate)
                .where('printedAt', '<=', endDate)
                .select(
                    'totalAmount',
                    'grandTotal',
                    'printedAt',
                    'createdAt',
                    'customerType',
                    'customerId',
                    'customerPhone',
                    'phone',
                    'customerName',
                    'name'
                )
                .get(),
            customBillHistoryRef
                .where('printedAt', '>=', prevStartDate)
                .where('printedAt', '<', startDate)
                .select('totalAmount', 'grandTotal')
                .get(),
            businessRef.collection('menu').select('name', 'portions').get(),
            businessRef.collection('customers').select('name', 'joinedAt', 'totalOrders', 'totalSpend', 'phone').get(),
            businessRef.collection('deliveryBoys').select('name', 'displayName', 'phone').get(),
        ]);

        // ---- SALES METRICS ----
        let currentSales = 0;
        let currentOrdersCount = 0;
        let cashRevenue = 0;
        let onlineRevenue = 0;
        const paymentMethodCounts = { Online: 0, Cash: 0 };
        const hourlyOrders = Array(24).fill(0);
        const prepTimes = [];
        const customerOrderDates = {};
        const uniqueCustomerPhonesThisPeriod = new Set();
        const customerOrderMixMap = new Map();
        const salesByDay = {};
        const salesDayOrder = {};

        let onlineOrderCount = 0;
        let onlineOrderRevenue = 0;
        let manualCallOrderCount = 0;
        let manualCallOrderRevenue = 0;
        let counterBillCount = 0;
        let counterBillRevenue = 0;

        const customerTypeMix = {
            uid: { onlineOrders: 0, manualCallOrders: 0, counterBills: 0 },
            guest: { onlineOrders: 0, manualCallOrders: 0, counterBills: 0 },
        };

        // Rejection Metrics
        let totalRejections = 0;
        let missedRevenue = 0;
        const missedItems = {};
        const rejectionReasons = {};

        currentPeriodOrdersSnap.forEach((doc) => {
            const data = doc.data();
            const status = data.status || 'pending';

            if (isLostOrder(status)) {
                totalRejections += 1;
                const reason = data.rejectionReason || data.cancellationReason || 'Other';
                rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
                missedRevenue += toAmount(data.totalAmount);

                if (reason === 'out_of_stock' && Array.isArray(data.items)) {
                    data.items.forEach((item) => {
                        const baseItemName = String(item?.name || 'Item').split(' (')[0];
                        if (!missedItems[baseItemName]) {
                            missedItems[baseItemName] = { count: 0, revenue: 0 };
                        }
                        missedItems[baseItemName].count += 1;
                        missedItems[baseItemName].revenue += toAmount(item?.price) * toAmount(item?.quantity || 1);
                    });
                }
                return;
            }

            const amount = toAmount(data.totalAmount);
            const orderDate = timestampToDate(data.orderDate);
            currentOrdersCount += 1;
            currentSales += amount;
            addSalesByDay(salesByDay, salesDayOrder, orderDate, amount);

            if (orderDate) {
                const istDate = new Date(orderDate.getTime() + 5.5 * 60 * 60 * 1000);
                hourlyOrders[istDate.getHours()] += 1;
            }

            const manualCallOrder = isManualCallOrder(data);
            if (manualCallOrder) {
                manualCallOrderCount += 1;
                manualCallOrderRevenue += amount;
            } else {
                onlineOrderCount += 1;
                onlineOrderRevenue += amount;
            }

            const isOnlinePayment = detectOnlinePayment(data);
            if (isOnlinePayment) {
                paymentMethodCounts.Online += 1;
                onlineRevenue += amount;
            } else {
                paymentMethodCounts.Cash += 1;
                cashRevenue += amount;
            }

            const readyAt = timestampToDate(data.readyAt);
            if (readyAt && orderDate) {
                const prepTime = (readyAt.getTime() - orderDate.getTime()) / (1000 * 60);
                if (prepTime > 0 && prepTime < 120) prepTimes.push(prepTime);
            }

            const normalizedPhone = normalizePhone(data.customerPhone || data.phone);
            if (normalizedPhone) {
                uniqueCustomerPhonesThisPeriod.add(normalizedPhone);
                if (!customerOrderDates[normalizedPhone]) customerOrderDates[normalizedPhone] = [];
                if (orderDate) customerOrderDates[normalizedPhone].push(orderDate);
            }

            const customerIdentity = getOrderCustomerIdentity(data, doc.id);
            const customerMix = getOrCreateCustomerMix(customerOrderMixMap, customerIdentity);
            customerMix.totalSpent += amount;
            if (manualCallOrder) {
                customerMix.manualCallOrders += 1;
                customerMix.manualCallRevenue += amount;
                customerTypeMix[customerIdentity.customerType].manualCallOrders += 1;
            } else {
                customerMix.onlineOrders += 1;
                customerMix.onlineRevenue += amount;
                customerTypeMix[customerIdentity.customerType].onlineOrders += 1;
            }
        });

        currentCounterBillsSnap.forEach((doc) => {
            const data = doc.data();
            const amount = toAmount(data.totalAmount || data.grandTotal);
            const printedAt = timestampToDate(data.printedAt) || timestampToDate(data.createdAt);

            counterBillCount += 1;
            counterBillRevenue += amount;
            addSalesByDay(salesByDay, salesDayOrder, printedAt, amount);

            const customerIdentity = getCounterBillCustomerIdentity(data, doc.id);
            const customerMix = getOrCreateCustomerMix(customerOrderMixMap, customerIdentity);
            customerMix.counterBills += 1;
            customerMix.counterBillRevenue += amount;
            customerMix.totalSpent += amount;
            customerTypeMix[customerIdentity.customerType].counterBills += 1;
        });

        // ---- PREVIOUS PERIOD COMPARISON ----
        let prevSales = 0;
        let prevOrdersCount = 0;
        let prevCounterBillRevenue = 0;
        let prevCounterBillCount = 0;

        prevPeriodOrdersSnap.forEach((doc) => {
            const data = doc.data();
            if (isLostOrder(data.status)) return;
            prevSales += toAmount(data.totalAmount);
            prevOrdersCount += 1;
        });

        prevCounterBillsSnap.forEach((doc) => {
            const data = doc.data();
            prevCounterBillRevenue += toAmount(data.totalAmount || data.grandTotal);
            prevCounterBillCount += 1;
        });

        const totalBusinessRevenue = currentSales + counterBillRevenue;
        const prevTotalBusinessRevenue = prevSales + prevCounterBillRevenue;
        const totalBusinessOrders = currentOrdersCount + counterBillCount;
        const prevTotalBusinessOrders = prevOrdersCount + prevCounterBillCount;

        const salesTrend = Object.entries(salesByDay)
            .sort((a, b) => (salesDayOrder[a[0]] || 0) - (salesDayOrder[b[0]] || 0))
            .map(([day, sales]) => ({ day, sales }));

        const paymentMethodsData = Object.entries(paymentMethodCounts).map(([name, value]) => ({ name, value }));
        const rejectionReasonsData = Object.entries(rejectionReasons).map(([name, value]) => ({ name, value }));
        const missedItemsData = Object.entries(missedItems)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        const avgPrepTime = prepTimes.length > 0 ? prepTimes.reduce((sum, value) => sum + value, 0) / prepTimes.length : 0;
        const peakHours = hourlyOrders
            .map((count, hour) => ({ hour, count }))
            .filter((entry) => entry.count > 0)
            .sort((a, b) => b.count - a.count);

        const orderSourceBreakdown = [
            { name: 'Online Orders', value: onlineOrderCount, revenue: onlineOrderRevenue },
            { name: 'Manual Call Orders', value: manualCallOrderCount, revenue: manualCallOrderRevenue },
            { name: 'Offline Counter Bills', value: counterBillCount, revenue: counterBillRevenue },
        ];

        const salesData = {
            kpis: {
                totalRevenue: totalBusinessRevenue,
                totalOrders: totalBusinessOrders,
                avgOrderValue: totalBusinessOrders > 0 ? totalBusinessRevenue / totalBusinessOrders : 0,
                cashRevenue,
                onlineRevenue,
                revenueChange: calcChange(totalBusinessRevenue, prevTotalBusinessRevenue),
                ordersChange: calcChange(totalBusinessOrders, prevTotalBusinessOrders),
                avgValueChange: calcChange(
                    totalBusinessOrders > 0 ? totalBusinessRevenue / totalBusinessOrders : 0,
                    prevTotalBusinessOrders > 0 ? prevTotalBusinessRevenue / prevTotalBusinessOrders : 0
                ),
                totalRejections,
                missedRevenue,
                avgPrepTime: Math.round(avgPrepTime),
                onlineOrders: onlineOrderCount,
                manualCallOrders: manualCallOrderCount,
                counterBills: counterBillCount,
                onlineOrderRevenue,
                manualCallRevenue: manualCallOrderRevenue,
                counterBillRevenue,
            },
            salesTrend,
            paymentMethods: paymentMethodsData,
            rejectionReasons: rejectionReasonsData,
            peakHours,
            missedOpportunities: missedItemsData,
            orderSourceBreakdown,
        };

        // ---- MENU PERFORMANCE ----
        const menuItems = allMenuSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const itemSales = {};

        currentPeriodOrdersSnap.forEach((doc) => {
            const data = doc.data();
            if (isLostOrder(data.status)) return;
            (data.items || []).forEach((item) => {
                const baseName = String(item?.name || 'Item').split(' (')[0];
                if (!itemSales[baseName]) itemSales[baseName] = 0;
                itemSales[baseName] += toAmount(item?.quantity || 0);
            });
        });

        const menuPerformance = menuItems.map((item) => {
            const unitsSold = itemSales[item.name] || 0;
            const price = toAmount(item?.portions?.[0]?.price || 0);
            const foodCost = price * 0.4;
            const revenue = unitsSold * price;
            const totalCost = unitsSold * foodCost;
            const totalProfit = revenue - totalCost;
            const profitMargin = revenue > 0 ? (totalProfit / revenue) * 100 : 0;
            return {
                ...item,
                unitsSold,
                revenue,
                totalCost,
                totalProfit,
                profitMargin,
                popularity: unitsSold,
                profitability: profitMargin,
            };
        });

        // ---- CUSTOMER STATS ----
        const allCustomers = allCustomersSnap.docs.map((doc) => ({ phone: doc.id, ...doc.data() }));
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const newThisMonth = allCustomers.filter((customer) => {
            const joinedAt = timestampToDate(customer.joinedAt);
            return joinedAt && joinedAt > monthStart;
        });
        const repeatCustomers = allCustomers.filter((customer) => toAmount(customer.totalOrders) > 1);

        const returningThisPeriod = Array.from(uniqueCustomerPhonesThisPeriod).filter((phone) => {
            const customer = allCustomers.find((entry) => entry.phone === phone);
            const joinedAt = timestampToDate(customer?.joinedAt);
            return joinedAt && joinedAt < startDate;
        });

        const topLoyalCustomers = allCustomers
            .filter((customer) => toAmount(customer.totalOrders) > 0)
            .sort((a, b) => toAmount(b.totalOrders) - toAmount(a.totalOrders))
            .slice(0, 5)
            .map((customer) => ({
                name: customer.name || 'Customer',
                phone: customer.phone,
                orders: toAmount(customer.totalOrders),
                totalSpent: toAmount(customer.totalSpent),
            }));

        const customerOrderMix = Array.from(customerOrderMixMap.values())
            .map((row) => ({
                ...row,
                totalInteractions: row.onlineOrders + row.manualCallOrders + row.counterBills,
            }))
            .sort((a, b) => {
                if (b.totalInteractions !== a.totalInteractions) return b.totalInteractions - a.totalInteractions;
                return b.totalSpent - a.totalSpent;
            })
            .slice(0, 20);

        const customerStats = {
            totalCustomers: allCustomers.length,
            newThisMonth: newThisMonth.length,
            repeatRate: allCustomers.length > 0 ? Math.round((repeatCustomers.length / allCustomers.length) * 100) : 0,
            newThisPeriod: Math.max(0, uniqueCustomerPhonesThisPeriod.size - returningThisPeriod.length),
            returningThisPeriod: returningThisPeriod.length,
            topLoyalCustomers,
            customerTypeMix,
            customerOrderMix,
        };

        // ---- RIDER ANALYTICS ----
        const riderMetaById = new Map();
        ridersSnap.forEach((doc) => {
            const rider = doc.data() || {};
            riderMetaById.set(doc.id, {
                riderId: doc.id,
                name: rider.displayName || rider.name || 'Rider',
                phone: normalizePhone(rider.phone || ''),
            });
        });

        const riderStatsById = new Map();
        const combinedDaily = new Map();
        const combinedWeekly = new Map();

        const createSummaryBucket = () => ({
            assignedOrders: 0,
            completedOrders: 0,
            collection: 0,
            orders: [],
        });

        const getOrCreateRider = (riderId) => {
            if (!riderStatsById.has(riderId)) {
                const meta = riderMetaById.get(riderId) || { riderId, name: 'Rider', phone: '' };
                riderStatsById.set(riderId, {
                    riderId,
                    name: meta.name || 'Rider',
                    phone: meta.phone || '',
                    totalAssignedOrders: 0,
                    totalCompletedOrders: 0,
                    totalCollection: 0,
                    dayWise: new Map(),
                    weekWise: new Map(),
                    orders: [],
                });
            }
            return riderStatsById.get(riderId);
        };

        currentPeriodOrdersSnap.forEach((doc) => {
            const data = doc.data() || {};
            const riderId = String(data.deliveryBoyId || '').trim();
            const status = String(data.status || '').toLowerCase();
            const orderDate = timestampToDate(data.orderDate);

            if (!riderId || !orderDate || isLostOrder(status)) return;

            const amount = toAmount(data.totalAmount);
            const completed = RIDER_COMPLETED_STATUSES.has(status);
            const dayKey = getDayKey(orderDate);
            const weekKey = getWeekKey(orderDate);
            const { weekStart, weekEnd } = getWeekRange(orderDate);

            const orderRow = {
                id: doc.id,
                customerOrderId: data.customerOrderId || null,
                customerName: data.customerName || data.name || 'Customer',
                customerPhone: normalizePhone(data.customerPhone || data.phone || ''),
                deliveryType: data.deliveryType || null,
                status,
                amount,
                orderDate: orderDate.toISOString(),
                orderDateTs: orderDate.getTime(),
            };

            const rider = getOrCreateRider(riderId);
            rider.totalAssignedOrders += 1;
            rider.totalCompletedOrders += completed ? 1 : 0;
            rider.totalCollection += completed ? amount : 0;
            rider.orders.push(orderRow);

            if (!rider.dayWise.has(dayKey)) rider.dayWise.set(dayKey, createSummaryBucket());
            const riderDay = rider.dayWise.get(dayKey);
            riderDay.assignedOrders += 1;
            riderDay.completedOrders += completed ? 1 : 0;
            riderDay.collection += completed ? amount : 0;
            riderDay.orders.push(orderRow);

            if (!rider.weekWise.has(weekKey)) {
                rider.weekWise.set(weekKey, {
                    ...createSummaryBucket(),
                    weekStart: format(weekStart, 'yyyy-MM-dd'),
                    weekEnd: format(weekEnd, 'yyyy-MM-dd'),
                });
            }
            const riderWeek = rider.weekWise.get(weekKey);
            riderWeek.assignedOrders += 1;
            riderWeek.completedOrders += completed ? 1 : 0;
            riderWeek.collection += completed ? amount : 0;
            riderWeek.orders.push(orderRow);

            if (!combinedDaily.has(dayKey)) combinedDaily.set(dayKey, createSummaryBucket());
            const allDay = combinedDaily.get(dayKey);
            allDay.assignedOrders += 1;
            allDay.completedOrders += completed ? 1 : 0;
            allDay.collection += completed ? amount : 0;
            allDay.orders.push({ ...orderRow, riderId, riderName: rider.name });

            if (!combinedWeekly.has(weekKey)) {
                combinedWeekly.set(weekKey, {
                    ...createSummaryBucket(),
                    weekStart: format(weekStart, 'yyyy-MM-dd'),
                    weekEnd: format(weekEnd, 'yyyy-MM-dd'),
                });
            }
            const allWeek = combinedWeekly.get(weekKey);
            allWeek.assignedOrders += 1;
            allWeek.completedOrders += completed ? 1 : 0;
            allWeek.collection += completed ? amount : 0;
            allWeek.orders.push({ ...orderRow, riderId, riderName: rider.name });
        });

        const riderSummaries = Array.from(riderStatsById.values())
            .map((rider) => ({
                riderId: rider.riderId,
                riderName: rider.name,
                riderPhone: rider.phone,
                totalAssignedOrders: rider.totalAssignedOrders,
                totalCompletedOrders: rider.totalCompletedOrders,
                totalCollection: rider.totalCollection,
                completionRate: rider.totalAssignedOrders > 0
                    ? Math.round((rider.totalCompletedOrders / rider.totalAssignedOrders) * 100)
                    : 0,
                dayWise: mapRiderSummary(rider.dayWise, 'day'),
                weekWise: mapRiderSummary(rider.weekWise, 'week'),
                orders: rider.orders.sort((a, b) => b.orderDateTs - a.orderDateTs),
            }))
            .sort((a, b) => {
                if (b.totalCollection !== a.totalCollection) return b.totalCollection - a.totalCollection;
                return b.totalCompletedOrders - a.totalCompletedOrders;
            });

        const riderAnalytics = {
            totalRiders: riderMetaById.size,
            activeRidersInPeriod: riderSummaries.length,
            totalAssignedOrders: riderSummaries.reduce((sum, rider) => sum + rider.totalAssignedOrders, 0),
            totalCompletedOrders: riderSummaries.reduce((sum, rider) => sum + rider.totalCompletedOrders, 0),
            totalCollection: riderSummaries.reduce((sum, rider) => sum + rider.totalCollection, 0),
            combinedDayWise: mapRiderSummary(combinedDaily, 'day'),
            combinedWeekWise: mapRiderSummary(combinedWeekly, 'week'),
            riders: riderSummaries,
        };

        // ---- AI INSIGHTS ----
        const aiInsights = [];
        if (missedRevenue > 0 && missedItemsData.length > 0) {
            const topMissed = missedItemsData[0];
            aiInsights.push({
                type: 'warning',
                message: `Boss, aaj aapne ₹${Math.round(missedRevenue)} ka nuksan kiya kyunki '${topMissed.name}' cancel hua. Stock check karo!`,
            });
        }
        if (peakHours.length > 0) {
            const peak = peakHours[0];
            const peakTime = peak.hour >= 12 ? `${peak.hour > 12 ? peak.hour - 12 : peak.hour} PM` : `${peak.hour} AM`;
            aiInsights.push({
                type: 'tip',
                message: `Aapka sabse busy time ${peakTime} hai (${peak.count} orders). Uss time se pehle ready raho!`,
            });
        }
        const aov = totalBusinessOrders > 0 ? totalBusinessRevenue / totalBusinessOrders : 0;
        if (aov > 0 && aov < 100) {
            aiInsights.push({
                type: 'suggestion',
                message: `Average order value ₹${Math.round(aov)} hai. Combo offers dalo toh zyada paisa banega!`,
            });
        }
        if (manualCallOrderCount > onlineOrderCount && manualCallOrderCount > 0) {
            aiInsights.push({
                type: 'suggestion',
                message: `Call orders (${manualCallOrderCount}) online orders (${onlineOrderCount}) se zyada hain. WhatsApp CTA push karke conversion aur improve ho sakta hai.`,
            });
        }
        if (customerStats.repeatRate > 50) {
            aiInsights.push({
                type: 'success',
                message: `Badhiya! ${customerStats.repeatRate}% customers wapas aa rahe hain. Matlab khana accha hai!`,
            });
        }

        const businessTypeRaw = restaurantData.businessType || collectionName.slice(0, -1);
        const businessType = businessTypeRaw === 'shop' ? 'store' : businessTypeRaw;

        return NextResponse.json(
            {
                salesData,
                menuPerformance,
                customerStats,
                riderAnalytics,
                aiInsights,
                businessInfo: {
                    businessType,
                },
            },
            { status: 200 }
        );
    } catch (error) {
        console.error('ANALYTICS API ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
