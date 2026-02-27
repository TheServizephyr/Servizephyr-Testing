const { randomUUID } = require('crypto');
const { HttpError } = require('../utils/httpError');
const { resolveAdminContext } = require('./adminAccess.service');

const BUSINESS_COLLECTIONS = [
  { name: 'restaurants', businessType: 'restaurant' },
  { name: 'shops', businessType: 'store' },
  { name: 'street_vendors', businessType: 'street-vendor' },
];

function toIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function pickTimestamp(data, fields) {
  for (const field of fields) {
    const parsed = toIso(data?.[field]);
    if (parsed) return parsed;
  }
  return null;
}

function generateRequestId() {
  try {
    return randomUUID();
  } catch {
    return `checkid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function normalizeOrder(doc) {
  const data = doc.data() || {};
  const items = Array.isArray(data.items) ? data.items : [];

  return {
    firestoreOrderId: doc.id,
    customerOrderId: data.customerOrderId || null,
    status: data.status || 'unknown',
    orderDate: pickTimestamp(data, ['orderDate', 'createdAt', 'updatedAt']),
    deliveryType: data.deliveryType || 'delivery',
    paymentMethod: data.paymentMethod || null,
    paymentStatus: data.paymentStatus || null,
    restaurantId: data.restaurantId || null,
    userId: data.userId || data.customerId || null,
    customerName: data.customerName || null,
    customerPhone: data.customerPhone || null,
    customerAddress: data.customerAddress || data?.customer?.address?.full || data?.customer?.address || null,
    subtotal: Number(data.subtotal || 0),
    cgst: Number(data.cgst || 0),
    sgst: Number(data.sgst || 0),
    gstAmount: Number(data.gstAmount || 0),
    deliveryCharge: Number(data.deliveryCharge || 0),
    tipAmount: Number(data.tipAmount || 0),
    grandTotal: Number(data.grandTotal ?? data.totalAmount ?? data.amount ?? 0),
    items: items.map((item) => {
      const qty = Number(item.quantity ?? item.qty ?? 1);
      const price = Number(item.price ?? item.basePrice ?? item.mrp ?? 0);
      const lineTotal = Number(item.total ?? item.itemTotal ?? qty * price);
      return {
        name: item.name || 'Unnamed Item',
        qty,
        price,
        total: lineTotal,
      };
    }),
    statusHistory: (Array.isArray(data.statusHistory) ? data.statusHistory : []).map((entry) => ({
      status: entry.status || 'unknown',
      timestamp: toIso(entry.timestamp) || null,
      notes: entry.notes || null,
    })),
  };
}

async function queryOrdersWithFallback(baseQuery, limit = 20) {
  try {
    const snap = await baseQuery.orderBy('orderDate', 'desc').limit(limit).get();
    return snap.docs;
  } catch {
    const snap = await baseQuery.limit(limit).get();
    return snap.docs;
  }
}

async function findBusinessByDocId(firestore, businessId) {
  if (!businessId) return null;

  for (const config of BUSINESS_COLLECTIONS) {
    const snap = await firestore.collection(config.name).doc(businessId).get();
    if (snap.exists) {
      const data = snap.data() || {};
      return {
        businessId: snap.id,
        businessType: data.businessType || config.businessType,
        collectionName: config.name,
        name: data.name || 'Unnamed Business',
        merchantId: data.merchantId || null,
        ownerId: data.ownerId || null,
        approvalStatus: data.approvalStatus || 'pending',
        createdAt: pickTimestamp(data, ['createdAt', 'created_at']),
        updatedAt: pickTimestamp(data, ['updatedAt', 'lastSeen']),
      };
    }
  }

  return null;
}

async function findBusinessByMerchantId(firestore, merchantId) {
  const tasks = BUSINESS_COLLECTIONS.map(async (config) => {
    const snap = await firestore
      .collection(config.name)
      .where('merchantId', '==', merchantId)
      .limit(1)
      .get();

    if (snap.empty) return null;
    const doc = snap.docs[0];
    const data = doc.data() || {};

    return {
      businessId: doc.id,
      businessType: data.businessType || config.businessType,
      collectionName: config.name,
      name: data.name || 'Unnamed Business',
      merchantId: data.merchantId || merchantId,
      ownerId: data.ownerId || null,
      approvalStatus: data.approvalStatus || 'pending',
      createdAt: pickTimestamp(data, ['createdAt', 'created_at']),
      updatedAt: pickTimestamp(data, ['updatedAt', 'lastSeen']),
      raw: data,
    };
  });

  const results = await Promise.all(tasks);
  return results.find(Boolean) || null;
}

async function getOwnerInfo(firestore, ownerId) {
  if (!ownerId) return null;
  const ownerDoc = await firestore.collection('users').doc(ownerId).get();
  if (!ownerDoc.exists) return null;

  const data = ownerDoc.data() || {};
  return {
    ownerId,
    name: data.name || 'N/A',
    email: data.email || 'N/A',
    phone: data.phone || data.phoneNumber || 'N/A',
    status: data.status || 'Active',
  };
}

async function getCustomerProfileByUid(firestore, uid) {
  if (!uid) return null;

  if (String(uid).startsWith('g_')) {
    const guestDoc = await firestore.collection('guest_profiles').doc(uid).get();
    if (!guestDoc.exists) return null;
    const data = guestDoc.data() || {};

    return {
      userType: 'guest',
      uid,
      customerId: data.customerId || null,
      name: data.name || 'Guest Customer',
      email: data.email || null,
      phone: data.phone || null,
      status: data.status === 'Blocked' || data.blocked ? 'Blocked' : 'Active',
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
      createdAt: pickTimestamp(data, ['createdAt']),
      updatedAt: pickTimestamp(data, ['updatedAt', 'lastActivityAt', 'lastSeen']),
    };
  }

  const userDoc = await firestore.collection('users').doc(uid).get();
  if (!userDoc.exists) return null;
  const data = userDoc.data() || {};

  return {
    userType: 'user',
    uid,
    customerId: data.customerId || null,
    name: data.name || 'Customer',
    email: data.email || null,
    phone: data.phone || data.phoneNumber || null,
    status: data.status || 'Active',
    addresses: Array.isArray(data.addresses) ? data.addresses : [],
    createdAt: pickTimestamp(data, ['createdAt', 'created_at', 'registeredAt', 'joinedAt']),
    updatedAt: pickTimestamp(data, ['updatedAt', 'lastActivityAt', 'lastSeen', 'lastLoginAt']),
  };
}

async function getCustomerResult(firestore, customerDisplayId) {
  const userSnap = await firestore
    .collection('users')
    .where('customerId', '==', customerDisplayId)
    .limit(1)
    .get();

  let userProfile = null;
  if (!userSnap.empty) {
    const userDoc = userSnap.docs[0];
    const data = userDoc.data() || {};
    userProfile = {
      userType: 'user',
      uid: userDoc.id,
      customerId: data.customerId || customerDisplayId,
      name: data.name || 'Customer',
      email: data.email || null,
      phone: data.phone || data.phoneNumber || null,
      status: data.status || 'Active',
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
      createdAt: pickTimestamp(data, ['createdAt', 'created_at', 'registeredAt', 'joinedAt']),
      updatedAt: pickTimestamp(data, ['updatedAt', 'lastActivityAt', 'lastSeen', 'lastLoginAt']),
    };
  } else {
    const guestSnap = await firestore
      .collection('guest_profiles')
      .where('customerId', '==', customerDisplayId)
      .limit(1)
      .get();
    if (!guestSnap.empty) {
      const guestDoc = guestSnap.docs[0];
      const data = guestDoc.data() || {};
      userProfile = {
        userType: 'guest',
        uid: guestDoc.id,
        customerId: data.customerId || customerDisplayId,
        name: data.name || 'Guest Customer',
        email: data.email || null,
        phone: data.phone || null,
        status: data.status === 'Blocked' || data.blocked ? 'Blocked' : 'Active',
        addresses: Array.isArray(data.addresses) ? data.addresses : [],
        createdAt: pickTimestamp(data, ['createdAt']),
        updatedAt: pickTimestamp(data, ['updatedAt', 'lastActivityAt', 'lastSeen']),
      };
    }
  }

  if (!userProfile) return null;

  const [byUserId, byCustomerId] = await Promise.all([
    queryOrdersWithFallback(firestore.collection('orders').where('userId', '==', userProfile.uid), 20),
    queryOrdersWithFallback(firestore.collection('orders').where('customerId', '==', userProfile.uid), 20),
  ]);

  const orderMap = new Map();
  [...byUserId, ...byCustomerId].forEach((doc) => {
    orderMap.set(doc.id, doc);
  });

  const orders = Array.from(orderMap.values())
    .map((doc) => normalizeOrder(doc))
    .sort((a, b) => new Date(b.orderDate || 0).getTime() - new Date(a.orderDate || 0).getTime())
    .slice(0, 20);

  const totalSpent = orders.reduce((sum, order) => sum + (Number(order.grandTotal) || 0), 0);
  const lastActivity = orders[0]?.orderDate || userProfile.updatedAt || userProfile.createdAt;

  const linkedBusinessIds = [...new Set(orders.map((order) => order.restaurantId).filter(Boolean))].slice(0, 8);
  const linkedBusinesses = [];
  for (const businessId of linkedBusinessIds) {
    const businessInfo = await findBusinessByDocId(firestore, businessId);
    if (businessInfo) linkedBusinesses.push(businessInfo);
  }

  return {
    searchedId: customerDisplayId,
    customer: userProfile,
    stats: {
      totalOrders: orders.length,
      totalSpent,
      lastActivity,
    },
    linkedBusinesses,
    recentOrders: orders,
  };
}

async function getRestaurantResult(firestore, merchantId) {
  const business = await findBusinessByMerchantId(firestore, merchantId);
  if (!business) return null;

  const owner = await getOwnerInfo(firestore, business.ownerId);
  const orderDocs = await queryOrdersWithFallback(
    firestore.collection('orders').where('restaurantId', '==', business.businessId),
    30
  );
  const orders = orderDocs
    .map((doc) => normalizeOrder(doc))
    .sort((a, b) => new Date(b.orderDate || 0).getTime() - new Date(a.orderDate || 0).getTime());

  const totalRevenue = orders.reduce((sum, order) => sum + (Number(order.grandTotal) || 0), 0);
  const lastActivity = orders[0]?.orderDate || business.updatedAt || business.createdAt;

  return {
    searchedId: merchantId,
    restaurant: business,
    owner,
    stats: {
      totalOrders: orders.length,
      totalRevenue,
      lastActivity,
    },
    recentOrders: orders.slice(0, 20),
  };
}

async function getOrderResult(firestore, orderSearchId) {
  let orderDoc = null;

  const byCustomerOrderId = await firestore
    .collection('orders')
    .where('customerOrderId', '==', orderSearchId)
    .limit(1)
    .get();
  if (!byCustomerOrderId.empty) {
    orderDoc = byCustomerOrderId.docs[0];
  }

  if (!orderDoc) {
    const numericId = Number(orderSearchId);
    if (Number.isFinite(numericId)) {
      const byNumeric = await firestore
        .collection('orders')
        .where('customerOrderId', '==', numericId)
        .limit(1)
        .get();
      if (!byNumeric.empty) {
        orderDoc = byNumeric.docs[0];
      }
    }
  }

  if (!orderDoc) {
    const byFirestoreId = await firestore.collection('orders').doc(orderSearchId).get();
    if (byFirestoreId.exists) {
      orderDoc = byFirestoreId;
    }
  }

  if (!orderDoc) return null;

  const order = normalizeOrder(orderDoc);
  const [restaurant, customer] = await Promise.all([
    findBusinessByDocId(firestore, order.restaurantId),
    getCustomerProfileByUid(firestore, order.userId),
  ]);

  return {
    searchedId: orderSearchId,
    order,
    customer: customer || {
      uid: order.userId,
      name: order.customerName || 'N/A',
      phone: order.customerPhone || null,
      addresses: order.customerAddress ? [{ full: order.customerAddress }] : [],
    },
    restaurant,
  };
}

function buildResultSummary(type, data) {
  if (!data) return { found: false };

  if (type === 'customer') {
    return {
      found: true,
      entity: 'customer',
      customerUid: data.customer?.uid || null,
      customerId: data.customer?.customerId || data.searchedId || null,
      totalOrders: data.stats?.totalOrders ?? 0,
      totalSpent: data.stats?.totalSpent ?? 0,
      linkedBusinesses: (data.linkedBusinesses || []).length,
      lastActivity: data.stats?.lastActivity || null,
    };
  }

  if (type === 'restaurant') {
    return {
      found: true,
      entity: 'restaurant',
      businessId: data.restaurant?.businessId || null,
      merchantId: data.restaurant?.merchantId || data.searchedId || null,
      businessType: data.restaurant?.businessType || null,
      totalOrders: data.stats?.totalOrders ?? 0,
      totalRevenue: data.stats?.totalRevenue ?? 0,
      lastActivity: data.stats?.lastActivity || null,
    };
  }

  return {
    found: true,
    entity: 'order',
    firestoreOrderId: data.order?.firestoreOrderId || null,
    customerOrderId: data.order?.customerOrderId || null,
    status: data.order?.status || null,
    orderDate: data.order?.orderDate || null,
    grandTotal: data.order?.grandTotal ?? 0,
    restaurantId: data.order?.restaurantId || null,
    userId: data.order?.userId || null,
    itemCount: Array.isArray(data.order?.items) ? data.order.items.length : 0,
  };
}

async function checkAdminIds(req) {
  const adminContext = await resolveAdminContext(req, { checkRevoked: false });
  const { firestore } = adminContext;

  const body = req.body || {};
  const normalizedType = String(body.type || '').trim().toLowerCase();
  const normalizedId = String(body.id || '').trim();

  if (!normalizedType || !normalizedId) {
    throw new HttpError(400, 'Both type and id are required.');
  }

  let data = null;
  if (normalizedType === 'customer') {
    data = await getCustomerResult(firestore, normalizedId);
    if (!data) throw new HttpError(404, `No customer found for ID ${normalizedId}.`);
  } else if (normalizedType === 'restaurant') {
    data = await getRestaurantResult(firestore, normalizedId);
    if (!data) throw new HttpError(404, `No restaurant found for ID ${normalizedId}.`);
  } else if (normalizedType === 'order') {
    data = await getOrderResult(firestore, normalizedId);
    if (!data) throw new HttpError(404, `No order found for ID ${normalizedId}.`);
  } else {
    throw new HttpError(400, 'Invalid type. Use customer, restaurant, or order.');
  }

  const requestId = generateRequestId();
  const searchedAt = new Date().toISOString();
  const audit = {
    event: 'admin_check_ids_lookup',
    requestId,
    searchedAt,
    searchType: normalizedType,
    searchedId: normalizedId,
    searchedBy: {
      uid: adminContext?.uid || null,
      email: adminContext?.userData?.email || null,
      role: adminContext?.userData?.role || 'admin',
    },
    endpoint: '/api/admin/check-ids',
    resultSummary: buildResultSummary(normalizedType, data),
  };

  return {
    type: normalizedType,
    data,
    audit,
  };
}

module.exports = {
  checkAdminIds,
};
