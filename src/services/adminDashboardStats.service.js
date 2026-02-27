const { resolveAdminContext } = require('./adminAccess.service');

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function countDocsSafe(queryBuilder) {
  try {
    const countSnap = await queryBuilder().count().get();
    return Number(countSnap?.data()?.count || 0);
  } catch {
    const snap = await queryBuilder().get();
    return snap.size || 0;
  }
}

async function getAdminDashboardStats(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });

  const [pendingRestaurants, pendingShops, pendingStreetVendors] = await Promise.all([
    countDocsSafe(() => firestore.collection('restaurants').where('approvalStatus', '==', 'pending')),
    countDocsSafe(() => firestore.collection('shops').where('approvalStatus', '==', 'pending')),
    countDocsSafe(() => firestore.collection('street_vendors').where('approvalStatus', '==', 'pending')),
  ]);

  const [totalRestaurants, totalShops, totalStreetVendors] = await Promise.all([
    countDocsSafe(() => firestore.collection('restaurants')),
    countDocsSafe(() => firestore.collection('shops')),
    countDocsSafe(() => firestore.collection('street_vendors')),
  ]);

  const totalUsers = await countDocsSafe(() => firestore.collection('users'));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let todayOrdersSnap;
  try {
    todayOrdersSnap = await firestore.collection('orders').where('orderDate', '>=', todayStart).get();
  } catch {
    const fallback = await firestore.collection('orders').limit(4000).get();
    todayOrdersSnap = {
      docs: fallback.docs.filter((doc) => {
        const orderDate = toDate(doc.data()?.orderDate);
        return orderDate && orderDate >= todayStart;
      }),
      size: 0,
    };
    todayOrdersSnap.size = todayOrdersSnap.docs.length;
  }

  const todayOrders = todayOrdersSnap.size || 0;
  const todayRevenue = (todayOrdersSnap.docs || []).reduce((sum, doc) => {
    const amount = Number(doc.data()?.totalAmount || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  let recentUsersSnap;
  try {
    recentUsersSnap = await firestore.collection('users').orderBy('createdAt', 'desc').limit(4).get();
  } catch {
    const fallback = await firestore.collection('users').get();
    const sorted = fallback.docs.sort((a, b) => {
      const at = toDate(a.data()?.createdAt)?.getTime() || 0;
      const bt = toDate(b.data()?.createdAt)?.getTime() || 0;
      return bt - at;
    });
    recentUsersSnap = {
      docs: sorted.slice(0, 4),
    };
  }

  const recentSignups = (recentUsersSnap.docs || []).map((doc) => {
    const data = doc.data() || {};
    const createdAt = toDate(data.createdAt)?.toISOString() || new Date().toISOString();

    const businessType = String(data.businessType || '').toLowerCase();
    const role = String(data.role || '').toLowerCase();
    let type = 'User';
    if (businessType === 'restaurant') type = 'Restaurant';
    else if (businessType === 'shop' || businessType === 'store') type = 'Store';
    else if (businessType === 'street-vendor' || businessType === 'street_vendor') type = 'Street Vendor';
    else if (role === 'customer') type = 'Customer';

    return {
      type,
      name: data.name || 'Unnamed User',
      time: createdAt,
    };
  });

  const weeklyOrderData = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const count = await countDocsSafe(() =>
      firestore.collection('orders').where('orderDate', '>=', startOfDay).where('orderDate', '<=', endOfDay)
    );

    weeklyOrderData.push({
      day: date.toLocaleDateString('en-US', { weekday: 'short' }),
      orders: count,
    });
  }

  return {
    pendingApprovals: pendingRestaurants + pendingShops + pendingStreetVendors,
    totalListings: totalRestaurants + totalShops + totalStreetVendors,
    totalUsers,
    todayOrders,
    todayRevenue,
    recentSignups,
    weeklyOrderData,
  };
}

module.exports = {
  getAdminDashboardStats,
};
