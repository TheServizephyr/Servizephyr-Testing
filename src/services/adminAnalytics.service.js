const { HttpError } = require('../utils/httpError');
const { resolveAdminContext } = require('./adminAccess.service');

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function toIsoDay(date) {
  const d = normalizeDate(date);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAmount(order = {}) {
  const candidates = [order.totalAmount, order.grandTotal, order.amount];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function normalizeQty(item = {}) {
  const qty = Number(item.qty ?? item.quantity ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function parseRange(query = {}) {
  const now = new Date();
  const rawStart = query.start;
  const rawEnd = query.end;

  const endCandidate = normalizeDate(rawEnd || now);
  const end = endOfDay(endCandidate || now);

  const fallbackStart = new Date(end);
  fallbackStart.setDate(fallbackStart.getDate() - 40);
  const startCandidate = normalizeDate(rawStart || fallbackStart);
  const start = startOfDay(startCandidate || fallbackStart);

  if (start > end) {
    return { start: startOfDay(end), end };
  }
  return { start, end };
}

function daySeriesTemplate(start, end) {
  const map = new Map();
  const cursor = new Date(start);
  while (cursor <= end) {
    const dayKey = toIsoDay(cursor);
    map.set(dayKey, { revenue: 0, customers: 0, owners: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return map;
}

function classifyUserRole(user = {}) {
  const role = String(user.role || '').trim().toLowerCase();
  const businessType = String(user.businessType || '').trim().toLowerCase();

  const isOwnerLike = (
    role.includes('owner')
    || role === 'manager'
    || role === 'street-vendor'
    || role === 'restaurant-owner'
    || role === 'shop-owner'
    || ['restaurant', 'shop', 'store', 'street-vendor', 'street_vendor'].includes(businessType)
  );

  return isOwnerLike ? 'owner' : 'customer';
}

async function resolveListingName(firestore, id) {
  const [restaurant, shop, vendor] = await Promise.all([
    firestore.collection('restaurants').doc(id).get(),
    firestore.collection('shops').doc(id).get(),
    firestore.collection('street_vendors').doc(id).get(),
  ]);

  if (restaurant.exists) return restaurant.data()?.name || 'Unnamed Restaurant';
  if (shop.exists) return shop.data()?.name || 'Unnamed Store';
  if (vendor.exists) return vendor.data()?.name || 'Unnamed Vendor';
  return `Listing ${id.slice(0, 6)}`;
}

async function resolveListingNames(firestore, ids = []) {
  if (!ids.length) return {};
  const result = {};
  await Promise.all(ids.map(async (id) => {
    result[id] = await resolveListingName(firestore, id);
  }));
  return result;
}

async function getAdminAnalytics(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });

  const { start, end } = parseRange(req.query || {});
  if (!start || !end) {
    throw new HttpError(400, 'Invalid date range.');
  }

  const [ordersSnap, usersSnap] = await Promise.all([
    firestore.collection('orders')
      .where('orderDate', '>=', start)
      .where('orderDate', '<=', end)
      .get(),
    firestore.collection('users')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .get(),
  ]);

  const days = daySeriesTemplate(start, end);
  const revenueByListing = new Map();
  const itemStats = new Map();

  ordersSnap.docs.forEach((doc) => {
    const order = doc.data() || {};
    const orderDate = timestampToDate(order.orderDate);
    const dayKey = toIsoDay(orderDate);
    if (!dayKey || !days.has(dayKey)) return;

    const amount = normalizeAmount(order);
    days.get(dayKey).revenue += amount;

    const listingId = String(order.restaurantId || '').trim();
    if (listingId) {
      const prev = revenueByListing.get(listingId) || { revenue: 0 };
      prev.revenue += amount;
      revenueByListing.set(listingId, prev);
    }

    const items = Array.isArray(order.items) ? order.items : [];
    items.forEach((item) => {
      const itemName = String(item?.name || item?.title || 'Unknown Item').trim();
      if (!itemName) return;
      const qty = normalizeQty(item);
      const prev = itemStats.get(itemName) || { orders: 0 };
      prev.orders += qty;
      itemStats.set(itemName, prev);
    });
  });

  usersSnap.docs.forEach((doc) => {
    const user = doc.data() || {};
    const createdAt = timestampToDate(user.createdAt);
    const dayKey = toIsoDay(createdAt);
    if (!dayKey || !days.has(dayKey)) return;

    const type = classifyUserRole(user);
    if (type === 'owner') {
      days.get(dayKey).owners += 1;
    } else {
      days.get(dayKey).customers += 1;
    }
  });

  const revenueData = Array.from(days.entries()).map(([date, value]) => ({
    date,
    revenue: Math.round((value.revenue || 0) * 100) / 100,
  }));

  const userData = Array.from(days.entries()).map(([date, value]) => ({
    date,
    customers: value.customers || 0,
    owners: value.owners || 0,
  }));

  const topListingEntries = Array.from(revenueByListing.entries())
    .sort((a, b) => (b[1].revenue || 0) - (a[1].revenue || 0))
    .slice(0, 10);

  const topListingIds = topListingEntries.map(([id]) => id);
  const listingNames = await resolveListingNames(firestore, topListingIds);

  const topRestaurants = topListingEntries.map(([id, stats]) => ({
    id,
    name: listingNames[id] || `Listing ${id.slice(0, 6)}`,
    revenue: Math.round((stats.revenue || 0) * 100) / 100,
  }));

  const topItems = Array.from(itemStats.entries())
    .sort((a, b) => (b[1].orders || 0) - (a[1].orders || 0))
    .slice(0, 10)
    .map(([name, stats]) => ({
      name,
      orders: stats.orders || 0,
    }));

  return {
    range: {
      start: toIsoDay(start),
      end: toIsoDay(end),
    },
    totals: {
      orderCount: ordersSnap.size,
      userSignups: usersSnap.size,
    },
    revenueData,
    userData,
    topRestaurants,
    topItems,
  };
}

module.exports = {
  getAdminAnalytics,
};
