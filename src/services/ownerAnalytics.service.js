const { HttpError } = require('../utils/httpError');
const { normalizeBusinessType } = require('./business.service');
const { resolveOwnerContext } = require('./accessControl.service');

const LOST_ORDER_STATUSES = new Set(['rejected', 'cancelled', 'failed_delivery', 'returned_to_restaurant']);
const RIDER_COMPLETED_STATUSES = new Set(['delivered', 'picked_up']);

const ORDER_SELECT_FIELDS = [
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
  'deliveryType',
];

function toAmount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function timestampToDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isGuestUserId(userId) {
  const value = String(userId || '').trim();
  return !value || value.startsWith('g_') || value.startsWith('anon_');
}

function isManualCallOrder(order) {
  return (
    order?.isManualCallOrder === true
    || String(order?.orderSource || '').toLowerCase() === 'manual_call'
  );
}

function isLostOrder(status) {
  return LOST_ORDER_STATUSES.has(String(status || '').toLowerCase());
}

function calcChange(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function detectOnlinePayment(order) {
  let isOnline = false;

  if (Array.isArray(order?.paymentDetails)) {
    isOnline = order.paymentDetails.some((payment) =>
      (payment?.method === 'razorpay' || payment?.method === 'phonepe' || payment?.method === 'online')
      && (payment?.status === 'completed' || payment?.status === 'success' || payment?.status === 'paid')
    );
  } else if (order?.paymentDetails?.method) {
    isOnline = (
      order.paymentDetails.method === 'razorpay'
      || order.paymentDetails.method === 'phonepe'
      || order.paymentDetails.method === 'online'
    );
  }

  if (!isOnline && order?.paymentMethod) {
    isOnline = (
      order.paymentMethod === 'razorpay'
      || order.paymentMethod === 'phonepe'
      || order.paymentMethod === 'online'
    );
  }
  if (String(order?.paymentStatus || '').toLowerCase() === 'paid') isOnline = true;
  return isOnline;
}

function getOrderCustomerIdentity(order, fallbackId = '') {
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
}

function getCounterBillCustomerIdentity(bill, fallbackId = '') {
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
}

function getOrCreateCustomerMix(map, identity) {
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
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDayMonth(date) {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

function formatIsoDay(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addSalesByDay(salesByDay, salesDayOrder, date, amount) {
  if (!date || !Number.isFinite(amount)) return;
  const dayKey = formatDayMonth(date);
  salesByDay[dayKey] = (salesByDay[dayKey] || 0) + amount;
  if (!salesDayOrder[dayKey]) {
    salesDayOrder[dayKey] = date.getTime();
  }
}

function getWeekRange(date) {
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
}

function getWeekKey(date) {
  const { weekStart, weekEnd } = getWeekRange(date);
  return `${formatIsoDay(weekStart)}__${formatIsoDay(weekEnd)}`;
}

function mapRiderSummary(bucketMap, type) {
  return Array.from(bucketMap.entries())
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
}

function parseFilterRange({ filter, fromDate, toDate }) {
  const now = new Date();
  let startDate;
  let prevStartDate;
  let endDate;

  if (filter === 'Custom Range' && fromDate && toDate) {
    startDate = new Date(fromDate);
    if (Number.isNaN(startDate.getTime())) throw new HttpError(400, 'Invalid from date.');
    endDate = new Date(toDate);
    if (Number.isNaN(endDate.getTime())) throw new HttpError(400, 'Invalid to date.');

    const durationMs = Math.max(0, endDate.getTime() - startDate.getTime());
    prevStartDate = new Date(startDate.getTime() - durationMs);
  } else {
    endDate = new Date();
    switch (filter) {
      case 'This Week': {
        const base = new Date();
        startDate = new Date(base.setDate(base.getDate() - base.getDay()));
        prevStartDate = new Date(startDate.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      }
      case 'This Year':
        startDate = new Date(now.getFullYear(), 0, 1);
        prevStartDate = new Date(now.getFullYear() - 1, 0, 1);
        break;
      case 'Today': {
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        startDate = dayStart;
        prevStartDate = new Date(dayStart.getTime() - (24 * 60 * 60 * 1000));
        break;
      }
      case 'This Month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        break;
    }
  }

  startDate.setHours(0, 0, 0, 0);
  prevStartDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  const prevEndDate = new Date(startDate.getTime() - 1);
  return { startDate, endDate, prevStartDate, prevEndDate };
}

async function fetchOrdersByRange({ firestore, businessId, startDate, endDate, selectFields = ORDER_SELECT_FIELDS }) {
  const ordersRef = firestore.collection('orders');
  try {
    let query = ordersRef
      .where('restaurantId', '==', businessId)
      .where('orderDate', '>=', startDate)
      .where('orderDate', '<=', endDate);
    if (typeof query.select === 'function' && Array.isArray(selectFields) && selectFields.length) {
      query = query.select(...selectFields);
    }
    const snap = await query.get();
    return snap.docs || [];
  } catch {
    const fallback = await ordersRef.where('restaurantId', '==', businessId).limit(1200).get();
    return (fallback.docs || []).filter((doc) => {
      const orderDate = timestampToDate(doc.data()?.orderDate);
      return orderDate && orderDate >= startDate && orderDate <= endDate;
    });
  }
}

async function fetchCounterBillsByRange({ businessRef, startDate, endDate }) {
  const historyRef = businessRef.collection('custom_bill_history');
  try {
    const query = await historyRef
      .where('printedAt', '>=', startDate)
      .where('printedAt', '<=', endDate)
      .get();
    return query.docs || [];
  } catch {
    const fallback = await historyRef.limit(1200).get();
    return (fallback.docs || []).filter((doc) => {
      const data = doc.data() || {};
      const printedAt = timestampToDate(data.printedAt) || timestampToDate(data.createdAt);
      return printedAt && printedAt >= startDate && printedAt <= endDate;
    });
  }
}

function toRiderMeta(doc) {
  const data = doc.data() || {};
  return {
    riderId: doc.id,
    name: data.displayName || data.name || 'Rider',
    phone: normalizePhone(data.phone || ''),
  };
}

async function getOwnerAnalytics(req) {
  const owner = await resolveOwnerContext(req, {
    allowEmployee: true,
    allowAdminImpersonation: true,
  });

  const businessData = owner.businessData || {};
  const businessRef = owner.businessSnap.ref;
  const firestore = owner.firestore;

  const filter = String(req.query.filter || 'This Month');
  const fromDate = String(req.query.from || '');
  const toDate = String(req.query.to || '');

  const { startDate, endDate, prevStartDate, prevEndDate } = parseFilterRange({
    filter,
    fromDate,
    toDate,
  });

  const [
    currentPeriodOrders,
    prevPeriodOrders,
    currentCounterBills,
    prevCounterBills,
    menuSnap,
    customersSnap,
    ridersSnap,
  ] = await Promise.all([
    fetchOrdersByRange({
      firestore,
      businessId: owner.businessId,
      startDate,
      endDate,
      selectFields: ORDER_SELECT_FIELDS,
    }),
    fetchOrdersByRange({
      firestore,
      businessId: owner.businessId,
      startDate: prevStartDate,
      endDate: prevEndDate,
      selectFields: ['status', 'totalAmount', 'orderDate'],
    }),
    fetchCounterBillsByRange({
      businessRef,
      startDate,
      endDate,
    }),
    fetchCounterBillsByRange({
      businessRef,
      startDate: prevStartDate,
      endDate: prevEndDate,
    }),
    businessRef.collection('menu').get(),
    businessRef.collection('customers').get(),
    businessRef.collection('deliveryBoys').get(),
  ]);

  let currentSales = 0;
  let currentOrdersCount = 0;
  let cashRevenue = 0;
  let onlineRevenue = 0;
  const paymentMethodRevenue = {
    Online: 0,
    Cash: 0,
  };
  const hourlyOrders = Array(24).fill(0);
  const prepTimes = [];
  const salesByDay = {};
  const salesDayOrder = {};
  const uniqueCustomerPhonesThisPeriod = new Set();
  const customerOrderMixMap = new Map();

  let onlineOrderCount = 0;
  let onlineOrderRevenue = 0;
  let manualCallOrderCount = 0;
  let manualCallOrderRevenue = 0;
  let counterBillCount = 0;
  let counterBillRevenue = 0;

  let totalRejections = 0;
  let missedRevenue = 0;
  const missedItems = {};
  const rejectionReasons = {};

  const customerTypeMix = {
    uid: { onlineOrders: 0, manualCallOrders: 0, counterBills: 0 },
    guest: { onlineOrders: 0, manualCallOrders: 0, counterBills: 0 },
  };

  currentPeriodOrders.forEach((doc) => {
    const data = doc.data() || {};
    const status = String(data.status || '').toLowerCase();

    if (isLostOrder(status)) {
      totalRejections += 1;
      const reason = String(data.rejectionReason || data.cancellationReason || 'Other');
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
      const istDate = new Date(orderDate.getTime() + (5.5 * 60 * 60 * 1000));
      hourlyOrders[istDate.getHours()] += 1;
    }

    const manualCall = isManualCallOrder(data);
    if (manualCall) {
      manualCallOrderCount += 1;
      manualCallOrderRevenue += amount;
    } else {
      onlineOrderCount += 1;
      onlineOrderRevenue += amount;
    }

    const isOnlinePayment = detectOnlinePayment(data);
    if (isOnlinePayment) {
      onlineRevenue += amount;
      paymentMethodRevenue.Online += amount;
    } else {
      cashRevenue += amount;
      paymentMethodRevenue.Cash += amount;
    }

    const readyAt = timestampToDate(data.readyAt);
    if (readyAt && orderDate) {
      const prepTime = (readyAt.getTime() - orderDate.getTime()) / (1000 * 60);
      if (prepTime > 0 && prepTime < 120) prepTimes.push(prepTime);
    }

    const normalizedPhone = normalizePhone(data.customerPhone || data.phone);
    if (normalizedPhone) {
      uniqueCustomerPhonesThisPeriod.add(normalizedPhone);
    }

    const customerIdentity = getOrderCustomerIdentity(data, doc.id);
    const customerMix = getOrCreateCustomerMix(customerOrderMixMap, customerIdentity);
    customerMix.totalSpent += amount;
    if (manualCall) {
      customerMix.manualCallOrders += 1;
      customerMix.manualCallRevenue += amount;
      customerTypeMix[customerIdentity.customerType].manualCallOrders += 1;
    } else {
      customerMix.onlineOrders += 1;
      customerMix.onlineRevenue += amount;
      customerTypeMix[customerIdentity.customerType].onlineOrders += 1;
    }
  });

  currentCounterBills.forEach((doc) => {
    const data = doc.data() || {};
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

  let prevSales = 0;
  let prevOrdersCount = 0;
  let prevCounterBillRevenue = 0;
  let prevCounterBillCount = 0;

  prevPeriodOrders.forEach((doc) => {
    const data = doc.data() || {};
    if (isLostOrder(data.status)) return;
    prevSales += toAmount(data.totalAmount);
    prevOrdersCount += 1;
  });

  prevCounterBills.forEach((doc) => {
    const data = doc.data() || {};
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

  const paymentMethodsData = Object.entries(paymentMethodRevenue)
    .map(([name, value]) => ({ name, value }));

  const rejectionReasonsData = Object.entries(rejectionReasons)
    .map(([name, value]) => ({ name, value }));

  const missedItemsData = Object.entries(missedItems)
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const avgPrepTime = prepTimes.length > 0
    ? prepTimes.reduce((sum, value) => sum + value, 0) / prepTimes.length
    : 0;

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

  const menuItems = (menuSnap.docs || []).map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const itemSales = {};

  currentPeriodOrders.forEach((doc) => {
    const data = doc.data() || {};
    if (isLostOrder(data.status)) return;
    (Array.isArray(data.items) ? data.items : []).forEach((item) => {
      const itemName = String(item?.name || 'Item').split(' (')[0];
      if (!itemSales[itemName]) itemSales[itemName] = 0;
      itemSales[itemName] += toAmount(item?.quantity || 0);
    });
  });

  const menuPerformance = menuItems.map((item) => {
    const unitsSold = itemSales[item.name] || 0;
    const fallbackPrice = toAmount(item?.price || 0);
    const price = toAmount(item?.portions?.[0]?.price || fallbackPrice);
    const foodCost = price * 0.4;
    const revenue = unitsSold * price;
    const totalCost = unitsSold * foodCost;
    const totalProfit = revenue - totalCost;
    const profitMargin = revenue > 0 ? (totalProfit / revenue) * 100 : 0;
    return {
      ...item,
      imageUrl: String(item.imageUrl || '/logo.png'),
      unitsSold,
      revenue,
      totalCost,
      totalProfit,
      profitMargin,
      popularity: unitsSold,
      profitability: profitMargin,
    };
  });

  const allCustomers = (customersSnap.docs || []).map((doc) => ({ phone: doc.id, ...(doc.data() || {}) }));
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const newThisMonth = allCustomers.filter((customer) => {
    const joinedAt = timestampToDate(customer.joinedAt);
    return joinedAt && joinedAt >= monthStart;
  });

  const repeatCustomers = allCustomers.filter((customer) => toAmount(customer.totalOrders) > 1);

  const returningThisPeriod = Array.from(uniqueCustomerPhonesThisPeriod).filter((phone) => {
    const customer = allCustomers.find((entry) => normalizePhone(entry.phone) === normalizePhone(phone));
    const joinedAt = timestampToDate(customer?.joinedAt);
    return joinedAt && joinedAt < startDate;
  });

  const topLoyalCustomers = allCustomers
    .filter((customer) => toAmount(customer.totalOrders) > 0)
    .sort((a, b) => toAmount(b.totalOrders) - toAmount(a.totalOrders))
    .slice(0, 5)
    .map((customer) => ({
      name: customer.name || 'Customer',
      phone: normalizePhone(customer.phone || ''),
      orders: toAmount(customer.totalOrders),
      totalSpent: toAmount(customer.totalSpend),
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

  const riderMetaById = new Map();
  (ridersSnap.docs || []).forEach((doc) => {
    const rider = toRiderMeta(doc);
    riderMetaById.set(rider.riderId, rider);
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
      const meta = riderMetaById.get(riderId) || {
        riderId,
        name: 'Rider',
        phone: '',
      };
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

  currentPeriodOrders.forEach((doc) => {
    const data = doc.data() || {};
    const riderId = String(data.deliveryBoyId || '').trim();
    const status = String(data.status || '').toLowerCase();
    const orderDate = timestampToDate(data.orderDate);

    if (!riderId || !orderDate || isLostOrder(status)) return;

    const amount = toAmount(data.totalAmount);
    const completed = RIDER_COMPLETED_STATUSES.has(status);
    const dayKey = formatIsoDay(orderDate);
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
        weekStart: formatIsoDay(weekStart),
        weekEnd: formatIsoDay(weekEnd),
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
        weekStart: formatIsoDay(weekStart),
        weekEnd: formatIsoDay(weekEnd),
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

  const aiInsights = [];
  if (missedRevenue > 0 && missedItemsData.length > 0) {
    const topMissed = missedItemsData[0];
    aiInsights.push({
      type: 'warning',
      message: `Boss, aaj aapne Rs ${Math.round(missedRevenue)} ka nuksan kiya kyunki '${topMissed.name}' cancel hua. Stock check karo!`,
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
      message: `Average order value Rs ${Math.round(aov)} hai. Combo offers dalo toh zyada paisa banega!`,
    });
  }

  if (manualCallOrderCount > onlineOrderCount && manualCallOrderCount > 0) {
    aiInsights.push({
      type: 'suggestion',
      message: `Call orders (${manualCallOrderCount}) online orders (${onlineOrderCount}) se zyada hain. WhatsApp CTA push karke conversion improve ho sakta hai.`,
    });
  }

  if (customerStats.repeatRate > 50) {
    aiInsights.push({
      type: 'success',
      message: `Badhiya! ${customerStats.repeatRate}% customers wapas aa rahe hain. Matlab service acchi chal rahi hai!`,
    });
  }

  const businessType = normalizeBusinessType(businessData.businessType, owner.collectionName) || 'restaurant';

  return {
    salesData,
    menuPerformance,
    customerStats,
    riderAnalytics,
    aiInsights,
    businessInfo: {
      businessType,
    },
  };
}

module.exports = {
  getOwnerAnalytics,
};
