const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calcChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function getFilterRanges(filter) {
  const now = new Date();
  let startDate;
  let prevStartDate;

  if (filter === 'This Week') {
    const current = new Date();
    const day = current.getDay();
    startDate = new Date(current);
    startDate.setDate(current.getDate() - day);
    startDate.setHours(0, 0, 0, 0);

    prevStartDate = new Date(startDate);
    prevStartDate.setDate(startDate.getDate() - 7);
  } else if (filter === 'This Month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  } else {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    prevStartDate = new Date(startDate);
    prevStartDate.setDate(startDate.getDate() - 1);
  }

  return { startDate, prevStartDate };
}

function splitOrdersByRange(docs, startDate, prevStartDate) {
  const current = [];
  const previous = [];

  docs.forEach((doc) => {
    const data = doc.data() || {};
    const orderDate = toDate(data.orderDate);
    if (!orderDate) return;
    if (orderDate >= startDate) {
      current.push({ id: doc.id, ...data, orderDate });
    } else if (orderDate >= prevStartDate && orderDate < startDate) {
      previous.push({ id: doc.id, ...data, orderDate });
    }
  });

  return { current, previous };
}

async function fetchOrdersSince(owner, fromDate) {
  const baseQuery = owner.firestore
    .collection('orders')
    .where('restaurantId', '==', owner.businessId)
    .where('orderDate', '>=', fromDate);

  try {
    const snap = await baseQuery.orderBy('orderDate', 'desc').get();
    return snap.docs;
  } catch {
    const fallback = await baseQuery.get();
    return fallback.docs;
  }
}

async function fetchLiveOrders(owner) {
  try {
    const liveSnap = await owner.firestore
      .collection('orders')
      .where('restaurantId', '==', owner.businessId)
      .where('status', 'in', ['pending', 'confirmed'])
      .orderBy('orderDate', 'desc')
      .limit(3)
      .get();
    return liveSnap.docs;
  } catch {
    const fallback = await owner.firestore
      .collection('orders')
      .where('restaurantId', '==', owner.businessId)
      .where('status', 'in', ['pending', 'confirmed'])
      .get();
    return fallback.docs
      .sort((a, b) => {
        const at = toDate(a.data()?.orderDate)?.getTime() || 0;
        const bt = toDate(b.data()?.orderDate)?.getTime() || 0;
        return bt - at;
      })
      .slice(0, 3);
  }
}

async function fetchSalesChartOrders(owner, sevenDaysAgo) {
  const base = owner.firestore
    .collection('orders')
    .where('restaurantId', '==', owner.businessId)
    .where('orderDate', '>=', sevenDaysAgo);
  try {
    const snap = await base.orderBy('orderDate').get();
    return snap.docs;
  } catch {
    const fallback = await base.get();
    return fallback.docs;
  }
}

async function getOwnerDashboardData(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_ORDERS],
  });

  const filter = String(req.query.filter || 'Today');
  const { startDate, prevStartDate } = getFilterRanges(filter);
  const now = new Date();

  const [ordersSinceDocs, newCustomersSnap, liveOrdersDocs, chartDocs, menuSnap] = await Promise.all([
    fetchOrdersSince(owner, prevStartDate),
    owner.businessSnap.ref.collection('customers').where('lastOrderDate', '>=', startDate).get(),
    fetchLiveOrders(owner),
    fetchSalesChartOrders(owner, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    owner.businessSnap.ref.collection('menu').get(),
  ]);

  const { current: currentOrders, previous: prevOrders } = splitOrdersByRange(
    ordersSinceDocs,
    startDate,
    prevStartDate
  );

  const currentNonRejected = currentOrders.filter(
    (order) => String(order.status || '').toLowerCase() !== 'rejected'
  );
  const prevNonRejected = prevOrders.filter(
    (order) => String(order.status || '').toLowerCase() !== 'rejected'
  );

  const sales = currentNonRejected.reduce((sum, order) => sum + toNumber(order.totalAmount, 0), 0);
  const prevSales = prevNonRejected.reduce((sum, order) => sum + toNumber(order.totalAmount, 0), 0);

  const avgOrderValue = currentNonRejected.length > 0 ? sales / currentNonRejected.length : 0;
  const prevAvgOrderValue = prevNonRejected.length > 0 ? prevSales / prevNonRejected.length : 0;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayRejections = ordersSinceDocs.filter((doc) => {
    const data = doc.data() || {};
    const status = String(data.status || '').toLowerCase();
    if (status !== 'rejected') return false;
    const orderDate = toDate(data.orderDate);
    return orderDate && orderDate >= todayStart;
  }).length;

  const stats = {
    sales,
    salesChange: calcChange(sales, prevSales),
    orders: currentNonRejected.length,
    ordersChange: calcChange(currentNonRejected.length, prevNonRejected.length),
    newCustomers: newCustomersSnap.size,
    newCustomersChange: 0,
    avgOrderValue,
    avgOrderValueChange: calcChange(avgOrderValue, prevAvgOrderValue),
    todayRejections,
  };

  const liveOrders = liveOrdersDocs.map((doc) => {
    const orderData = doc.data() || {};
    return {
      id: doc.id,
      customer: orderData.customerName,
      amount: orderData.totalAmount,
      items: (orderData.items || []).map((item) => ({
        name: item.name,
        quantity: item.qty,
      })),
    };
  });

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const salesByDay = {};
  daysOfWeek.forEach((day) => {
    salesByDay[day] = 0;
  });
  chartDocs.forEach((doc) => {
    const data = doc.data() || {};
    const orderDate = toDate(data.orderDate);
    if (!orderDate) return;
    const day = orderDate.toLocaleDateString('en-US', { weekday: 'short' });
    salesByDay[day] = (salesByDay[day] || 0) + toNumber(data.totalAmount, 0);
  });
  const todayDayIndex = new Date().getDay();
  const orderedDays = [...daysOfWeek.slice(todayDayIndex + 1), ...daysOfWeek.slice(0, todayDayIndex + 1)];
  const salesChart = orderedDays.map((day) => ({
    day,
    sales: salesByDay[day] || 0,
  }));

  const topItemCounts = {};
  currentNonRejected.slice(0, 50).forEach((order) => {
    (order.items || []).forEach((item) => {
      const itemName = String(item.name || '');
      if (!itemName) return;
      topItemCounts[itemName] = (topItemCounts[itemName] || 0) + toNumber(item.quantity, 0);
    });
  });
  const topSellingNames = Object.entries(topItemCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name]) => name);

  const menuItems = menuSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const topItems = menuItems
    .filter((item) => topSellingNames.includes(item.name))
    .map((item, index) => ({
      name: item.name,
      count: topItemCounts[item.name],
      imageUrl: item.imageUrl || `https://picsum.photos/seed/dish${index + 1}/200/200`,
    }));

  return {
    stats,
    liveOrders,
    salesChart,
    topItems,
  };
}

module.exports = {
  getOwnerDashboardData,
};
