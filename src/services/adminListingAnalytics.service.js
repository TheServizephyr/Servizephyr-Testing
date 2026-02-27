const { HttpError } = require('../utils/httpError');
const { resolveAdminContext } = require('./adminAccess.service');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeBusinessType(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'street_vendor') return 'street-vendor';
  return normalized;
}

function resolveCollectionFromBusinessType(businessType) {
  const normalized = normalizeBusinessType(businessType);
  if (normalized === 'restaurant') return 'restaurants';
  if (normalized === 'store') return 'shops';
  if (normalized === 'street-vendor') return 'street_vendors';
  return null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function initDailyData() {
  const dailyData = {};
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    dailyData[dateKey] = { orders: 0, revenue: 0 };
  }
  return dailyData;
}

async function getRecentOrders({ firestore, listingId }) {
  try {
    const recentOrdersSnap = await firestore
      .collection('orders')
      .where('restaurantId', '==', listingId)
      .orderBy('orderDate', 'desc')
      .limit(5)
      .get();

    return recentOrdersSnap.docs.map((doc) => {
      const order = doc.data() || {};
      return {
        id: doc.id,
        customerName: order.customerName || 'Unknown',
        amount: toNumber(order.totalAmount, 0),
        status: order.orderStatus || order.status || 'Pending',
        itemCount: Array.isArray(order.items) ? order.items.length : 0,
        date: toDate(order.orderDate)?.toISOString() || new Date().toISOString(),
      };
    });
  } catch {
    const fallback = await firestore
      .collection('orders')
      .where('restaurantId', '==', listingId)
      .limit(80)
      .get();

    return fallback.docs
      .map((doc) => {
        const order = doc.data() || {};
        return {
          id: doc.id,
          customerName: order.customerName || 'Unknown',
          amount: toNumber(order.totalAmount, 0),
          status: order.orderStatus || order.status || 'Pending',
          itemCount: Array.isArray(order.items) ? order.items.length : 0,
          date: toDate(order.orderDate)?.toISOString() || new Date().toISOString(),
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);
  }
}

async function getAdminListingAnalytics(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });
  const listingId = normalizeText(req.query?.id);
  const businessType = normalizeBusinessType(req.query?.type);

  if (!listingId || !businessType) {
    throw new HttpError(400, 'Missing required parameters: id and type');
  }

  const collectionName = resolveCollectionFromBusinessType(businessType);
  if (!collectionName) {
    throw new HttpError(400, 'Invalid business type');
  }

  const listingRef = firestore.collection(collectionName).doc(listingId);
  const listingSnap = await listingRef.get();
  if (!listingSnap.exists) {
    throw new HttpError(404, 'Listing not found');
  }

  const listingData = listingSnap.data() || {};
  const ordersSnap = await firestore.collection('orders').where('restaurantId', '==', listingId).get();

  let totalOrders = 0;
  let totalRevenue = 0;
  const uniqueCustomers = new Set();
  let totalItems = 0;
  const dailyData = initDailyData();

  ordersSnap.docs.forEach((doc) => {
    const order = doc.data() || {};
    totalOrders += 1;

    const amount = toNumber(order.totalAmount, 0);
    totalRevenue += amount;

    if (order.customerId) {
      uniqueCustomers.add(String(order.customerId));
    }

    const items = Array.isArray(order.items) ? order.items : [];
    totalItems += items.length;

    const orderDate = toDate(order.orderDate);
    if (!orderDate) return;
    const dateKey = orderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (dailyData[dateKey]) {
      dailyData[dateKey].orders += 1;
      dailyData[dateKey].revenue += amount;
    }
  });

  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  const recentOrders = await getRecentOrders({ firestore, listingId });
  const chartData = Object.entries(dailyData).map(([date, data]) => ({
    date,
    orders: data.orders,
    revenue: data.revenue,
  }));

  return {
    listing: {
      id: listingId,
      name: listingData.name || 'Unnamed',
      type: businessType,
    },
    analytics: {
      totalOrders,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      uniqueCustomers: uniqueCustomers.size,
      totalItems,
      avgOrderValue,
      recentOrders,
      chartData,
    },
  };
}

module.exports = {
  getAdminListingAnalytics,
};
