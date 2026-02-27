

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper

    // --- ADMIN IMPERSONATION & EMPLOYEE ACCESS LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing customers for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        // Verify employee has access to this owner's data
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }

        console.log(`[API Employee Access] ${uid} accessing ${employeeOfOwnerId}'s customers`);
        targetOwnerId = employeeOfOwnerId;
    }
    // Owner access
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const query = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!query.empty) {
            const doc = query.docs[0];
            return { uid: targetOwnerId, businessId: doc.id, collectionName: collectionName, isAdmin: userRole === 'admin' };
        }
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}

const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIso = (value) => {
    const date = toDate(value);
    return date ? date.toISOString() : null;
};

const normalizePhone = (phone) => {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
};

const getWeekRanges = () => {
    const now = new Date();
    const current = new Date(now);
    current.setHours(0, 0, 0, 0);
    const day = current.getDay(); // 0=Sun
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(current);
    weekStart.setDate(current.getDate() + diffToMonday);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(weekStart.getDate() - 7);
    const prevWeekEnd = new Date(weekEnd);
    prevWeekEnd.setDate(weekEnd.getDate() - 7);

    return { weekStart, weekEnd, prevWeekStart, prevWeekEnd };
};

const REWARD_ELIGIBILITY_RULES = Object.freeze({
    minOrdersPerWeek: 3,
    requireKnownCustomerProfile: true,
});

const getCustomerStatus = (customer) => {
    if (!customer) return 'New';
    if (customer.status === 'unclaimed') return 'Claimed';

    const lastOrder = toDate(customer.lastOrderDate);
    if (!lastOrder) return 'New';

    const daysSinceLastOrder = (Date.now() - lastOrder.getTime()) / (1000 * 60 * 60 * 24);
    if ((customer.totalOrders || 0) > 10) return 'Loyal';
    if (daysSinceLastOrder > 60) return 'At Risk';
    if ((customer.totalOrders || 0) <= 2) return 'New';
    return 'Active';
};

const enrichCustomers = (customers) =>
    customers.map((customer) => ({
        ...customer,
        statusTag: getCustomerStatus(customer),
        lastOrderDate: toIso(customer.lastOrderDate),
        joinedAt: toIso(customer.joinedAt),
    }));

async function queryOrdersByRange(firestore, businessId, startDate, endDate) {
    const base = firestore
        .collection('orders')
        .where('restaurantId', '==', businessId)
        .where('orderDate', '>=', startDate)
        .where('orderDate', '<=', endDate)
        .select(
            'status',
            'customerId',
            'userId',
            'customerPhone',
            'phone',
            'customerName',
            'customerEmail',
            'orderDate',
            'grandTotal',
            'totalAmount',
            'amount'
        );

    try {
        const snap = await base.orderBy('orderDate', 'desc').get();
        return snap.docs;
    } catch (_) {
        const snap = await base.get();
        return snap.docs;
    }
}

function getOrderCustomerIdentity(orderData, orderDocId, customerLookupById, customerLookupByPhone) {
    const candidateIds = [
        orderData.customerId,
        orderData.userId,
    ].filter(Boolean).map(String);

    for (const id of candidateIds) {
        if (customerLookupById.has(id)) {
            return customerLookupById.get(id);
        }
    }

    const orderPhone = normalizePhone(orderData.customerPhone || orderData.phone);
    if (orderPhone && customerLookupByPhone.has(orderPhone)) {
        return customerLookupByPhone.get(orderPhone);
    }

    if (candidateIds.length > 0) return candidateIds[0];
    if (orderPhone) return `guest_phone_${orderPhone}`;
    return `guest_order_${orderDocId || 'unknown'}`;
}

function computeLeaderboardMetrics(customers, ordersDocs, weekStart, weekEnd) {
    const customerById = new Map();
    const customerByPhone = new Map();

    customers.forEach((customer) => {
        const baseId = String(customer.id);
        customerById.set(baseId, baseId);
        if (customer.userId) customerById.set(String(customer.userId), baseId);
        if (customer.uid) customerById.set(String(customer.uid), baseId);
        const phone = normalizePhone(customer.phone || customer.phoneNumber);
        if (phone) customerByPhone.set(phone, baseId);
    });

    const emptyMetric = (customer, fallbackId) => ({
        customerId: customer?.id || fallbackId,
        name: customer?.name || 'Guest Customer',
        email: customer?.email || '',
        phone: customer?.phone || customer?.phoneNumber || '',
        hasProfile: Boolean(customer),
        totalSpendAllTime: Number(customer?.totalSpend || 0),
        totalOrdersAllTime: Number(customer?.totalOrders || 0),
        statusTag: customer?.statusTag || getCustomerStatus(customer),
        lastOrderDate: customer?.lastOrderDate || null,
        weeklyOrders: 0,
        weeklySpend: 0,
        orderDates: [],
        avgOrderValue: 0,
        avgGapHours: 999,
        frequencyPerDay: 0,
        score: 0,
        rank: null,
    });

    const metricByCustomer = new Map();
    customers.forEach((customer) => {
        metricByCustomer.set(customer.id, emptyMetric(customer, customer.id));
    });

    const nonCountableStatuses = new Set(['cancelled', 'rejected', 'failed', 'payment_failed']);

    ordersDocs.forEach((doc) => {
        const data = doc.data() || {};
        const normalizedStatus = String(data.status || '').toLowerCase();
        if (nonCountableStatuses.has(normalizedStatus)) {
            return;
        }

        const identity = getOrderCustomerIdentity(data, doc.id, customerById, customerByPhone);
        if (!metricByCustomer.has(identity)) {
            metricByCustomer.set(identity, emptyMetric(null, identity));
        }
        const metric = metricByCustomer.get(identity);
        const date = toDate(data.orderDate) || new Date();
        const grandTotal = Number(data.grandTotal ?? data.totalAmount ?? data.amount ?? 0) || 0;

        if ((!metric.name || metric.name === 'Guest Customer') && data.customerName) {
            metric.name = String(data.customerName);
        }
        if (!metric.phone && (data.customerPhone || data.phone)) {
            metric.phone = String(data.customerPhone || data.phone);
        }
        if (!metric.email && data.customerEmail) {
            metric.email = String(data.customerEmail).toLowerCase();
        }
        if (!metric.lastOrderDate) {
            metric.lastOrderDate = date.toISOString();
        }

        metric.weeklyOrders += 1;
        metric.weeklySpend += grandTotal;
        metric.orderDates.push(date);
    });

    const allMetrics = Array.from(metricByCustomer.values());
    allMetrics.forEach((metric) => {
        metric.orderDates.sort((a, b) => a - b);
        metric.avgOrderValue = metric.weeklyOrders > 0 ? metric.weeklySpend / metric.weeklyOrders : 0;
        metric.frequencyPerDay = metric.weeklyOrders / 7;

        if (metric.orderDates.length >= 2) {
            let totalGapHours = 0;
            for (let i = 1; i < metric.orderDates.length; i++) {
                totalGapHours += (metric.orderDates[i] - metric.orderDates[i - 1]) / (1000 * 60 * 60);
            }
            metric.avgGapHours = totalGapHours / (metric.orderDates.length - 1);
        } else if (metric.orderDates.length === 1) {
            metric.avgGapHours = 168;
        } else {
            metric.avgGapHours = 999;
        }
    });

    const maxOrders = Math.max(1, ...allMetrics.map((m) => m.weeklyOrders));
    const maxAvgOrderValue = Math.max(1, ...allMetrics.map((m) => m.avgOrderValue));
    const maxInverseGap = Math.max(0.000001, ...allMetrics.map((m) => (m.avgGapHours > 0 ? 1 / m.avgGapHours : 0)));

    allMetrics.forEach((metric) => {
        const countScore = metric.weeklyOrders / maxOrders;
        const valueScore = metric.avgOrderValue / maxAvgOrderValue;
        const speedScore = ((metric.avgGapHours > 0 ? 1 / metric.avgGapHours : 0) / maxInverseGap);
        const weighted = (countScore * 0.6) + (valueScore * 0.25) + (speedScore * 0.15);
        metric.score = Number((weighted * 100).toFixed(2));
    });

    const pointTable = [...allMetrics]
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.weeklySpend !== a.weeklySpend) return b.weeklySpend - a.weeklySpend;
            return b.weeklyOrders - a.weeklyOrders;
        })
        .map((metric, idx) => ({
            ...metric,
            rank: idx + 1,
            weekStart: weekStart.toISOString(),
            weekEnd: weekEnd.toISOString(),
        }));

    const pointTableWithEligibility = pointTable.map((metric) => {
        const reasons = [];
        if ((metric.weeklyOrders || 0) < REWARD_ELIGIBILITY_RULES.minOrdersPerWeek) {
            reasons.push(`Needs at least ${REWARD_ELIGIBILITY_RULES.minOrdersPerWeek} orders this week`);
        }
        if (REWARD_ELIGIBILITY_RULES.requireKnownCustomerProfile && !metric.hasProfile) {
            reasons.push('Customer profile is guest/unmapped');
        }

        return {
            ...metric,
            rewardEligible: reasons.length === 0,
            rewardIneligibleReasons: reasons,
            rewardIneligibleReason: reasons[0] || '',
        };
    });

    const top10 = pointTableWithEligibility.filter((m) => m.weeklyOrders > 0).slice(0, 10);
    const rewardEligibleTop10 = top10.filter((m) => m.rewardEligible);
    const bottom10 = [...pointTableWithEligibility]
        .sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            if (a.weeklyOrders !== b.weeklyOrders) return a.weeklyOrders - b.weeklyOrders;
            return a.weeklySpend - b.weeklySpend;
        })
        .slice(0, 10)
        .map((m, idx) => ({ ...m, bottomRank: idx + 1 }));

    return { pointTable: pointTableWithEligibility, top10, bottom10, rewardEligibleTop10 };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const customersRef = firestore.collection(collectionName).doc(businessId).collection('customers');
        const customersSnap = await customersRef.orderBy('totalSpend', 'desc').get();

        const rawCustomers = customersSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                lastOrderDate: data.lastOrderDate,
            };
        });

        const customers = enrichCustomers(rawCustomers);

        const totalCustomers = customers.length;
        const topSpender = customers.length > 0 ? customers.reduce((prev, current) => ((prev.totalSpend || 0) > (current.totalSpend || 0)) ? prev : current, {}) : {};
        const topOrderer = customers.length > 0 ? customers.reduce((prev, current) => ((prev.totalOrders || 0) > (current.totalOrders || 0)) ? prev : current, {}) : {};

        const newThisMonth = customers.filter(c => {
            const joinOrLast = toDate(c.joinedAt) || toDate(c.lastOrderDate);
            if (!joinOrLast) return false;
            const now = new Date();
            return joinOrLast.getMonth() === now.getMonth() && joinOrLast.getFullYear() === now.getFullYear();
        }).length;

        const repeatCustomers = customers.filter(c => (c.totalOrders || 0) > 1).length;
        const loyalCustomers = customers.filter(c => c.statusTag === 'Loyal').length;
        const atRiskCustomers = customers.filter(c => c.statusTag === 'At Risk').length;
        const inactiveCustomers = customers.filter(c => {
            const last = toDate(c.lastOrderDate);
            if (!last) return true;
            return (Date.now() - last.getTime()) > (45 * 24 * 60 * 60 * 1000);
        }).length;

        const { weekStart, weekEnd, prevWeekStart, prevWeekEnd } = getWeekRanges();
        const [thisWeekOrderDocs, prevWeekOrderDocs] = await Promise.all([
            queryOrdersByRange(firestore, businessId, weekStart, weekEnd),
            queryOrdersByRange(firestore, businessId, prevWeekStart, prevWeekEnd),
        ]);

        const currentWeekBoard = computeLeaderboardMetrics(customers, thisWeekOrderDocs, weekStart, weekEnd);
        const previousWeekBoard = computeLeaderboardMetrics(customers, prevWeekOrderDocs, prevWeekStart, prevWeekEnd);
        const activeThisWeek = currentWeekBoard.pointTable.filter((c) => c.weeklyOrders > 0).length;

        const stats = {
            totalCustomers,
            newThisMonth: newThisMonth,
            repeatRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) : 0,
            topSpender,
            topOrderer,
            loyalCustomers,
            atRiskCustomers,
            inactiveCustomers,
            activeThisWeek,
            weeklyOrders: currentWeekBoard.pointTable.reduce((sum, row) => sum + (row.weeklyOrders || 0), 0),
            weeklyRevenue: Number(currentWeekBoard.pointTable.reduce((sum, row) => sum + (row.weeklySpend || 0), 0).toFixed(2)),
            previousWeekOrders: previousWeekBoard.pointTable.reduce((sum, row) => sum + (row.weeklyOrders || 0), 0),
            previousWeekRevenue: Number(previousWeekBoard.pointTable.reduce((sum, row) => sum + (row.weeklySpend || 0), 0).toFixed(2)),
        };

        const leaderboard = {
            period: {
                weekStart: weekStart.toISOString(),
                weekEnd: weekEnd.toISOString(),
                label: `${weekStart.toLocaleDateString('en-IN')} - ${weekEnd.toLocaleDateString('en-IN')}`,
                lastUpdatedAt: new Date().toISOString(),
            },
            scoringModel: {
                formula: 'score = (weeklyOrderCountWeight 60%) + (avgOrderValueWeight 25%) + (repeatSpeedWeight 15%)',
                notes: 'Weekly reset is automatic every Monday because leaderboard always computes within current week range.',
            },
            eligibilityRules: {
                ...REWARD_ELIGIBILITY_RULES,
                notes: `Reward eligible only if customer has at least ${REWARD_ELIGIBILITY_RULES.minOrdersPerWeek} orders in current week.`,
            },
            top10: currentWeekBoard.top10,
            top10Eligible: currentWeekBoard.rewardEligibleTop10,
            bottom10: currentWeekBoard.bottom10,
            pointTable: currentWeekBoard.pointTable.slice(0, 100),
            rewardSummary: {
                currentWeekTop10Count: currentWeekBoard.top10.length,
                currentWeekEligibleInTop10: currentWeekBoard.rewardEligibleTop10.length,
                previousWeekTop10Count: previousWeekBoard.top10.length,
                previousWeekEligibleInTop10: previousWeekBoard.rewardEligibleTop10.length,
            },
            previousWeekWinners: {
                weekStart: prevWeekStart.toISOString(),
                weekEnd: prevWeekEnd.toISOString(),
                top10: previousWeekBoard.top10,
                top10Eligible: previousWeekBoard.rewardEligibleTop10,
            },
        };

        return NextResponse.json({ customers, stats, leaderboard }, { status: 200 });

    } catch (error) {
        console.error("GET CUSTOMERS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const { customerId, notes } = await req.json();

        if (!customerId || notes === undefined) {
            return NextResponse.json({ message: 'Customer ID and notes are required.' }, { status: 400 });
        }

        const customerRef = firestore.collection(collectionName).doc(businessId).collection('customers').doc(customerId);

        const customerSnap = await customerRef.get();
        if (!customerSnap.exists) {
            return NextResponse.json({ message: 'Customer not found in this business.' }, { status: 404 });
        }

        await customerRef.update({ notes: notes });

        return NextResponse.json({ message: 'Customer notes updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("PATCH CUSTOMER ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

