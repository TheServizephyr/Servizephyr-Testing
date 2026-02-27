const { getFirestore, verifyIdToken } = require('../lib/firebaseAdmin');
const { getCache, setCache } = require('../lib/cache');
const { config } = require('../config/env');
const { HttpError } = require('../utils/httpError');
const { toDateSafe } = require('../utils/guest');
const { normalizeBusinessType } = require('./business.service');

const FINAL_STATES = new Set(['delivered', 'cancelled', 'rejected']);

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice('Bearer '.length).trim();
}

async function verifyReaderIdentity(req, orderData) {
  const trackingToken = String(req.query.token || '').trim();
  if (trackingToken && trackingToken === String(orderData.trackingToken || '')) {
    return true;
  }

  const bearer = extractBearerToken(req);
  if (!bearer) return false;
  try {
    const decoded = await verifyIdToken(bearer);
    const uid = decoded.uid;
    if (!uid) return false;
    return (
      uid === orderData.userId ||
      uid === orderData.customerId ||
      uid === orderData.restaurantId
    );
  } catch {
    return false;
  }
}

async function getOrderSnapshot({ firestore, orderId }) {
  if (orderId.startsWith('tab_')) {
    const tabOrdersQuery = await firestore
      .collection('orders')
      .where('dineInTabId', '==', orderId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (tabOrdersQuery.empty) {
      throw new HttpError(404, 'No orders found for this tab.');
    }
    return tabOrdersQuery.docs[0];
  }

  const snap = await firestore.collection('orders').doc(orderId).get();
  if (!snap.exists) throw new HttpError(404, 'Order not found.');
  return snap;
}

function mapLitePayload(orderDoc) {
  const orderData = orderDoc.data() || {};
  return {
    order: {
      id: orderDoc.id,
      customerOrderId: orderData.customerOrderId || null,
      restaurantId: orderData.restaurantId || null,
      status: orderData.status || 'pending',
      customerName: orderData.customerName || null,
      customerPhone: orderData.customerPhone || null,
      deliveryType: orderData.deliveryType || 'delivery',
      dineInToken: orderData.dineInToken || null,
      tableId: orderData.tableId || null,
      dineInTabId: orderData.dineInTabId || orderData.tabId || null,
      isCarOrder: orderData.isCarOrder || orderData.deliveryType === 'car-order',
      carSpot: orderData.carSpot || null,
      carDetails: orderData.carDetails || null,
      trackingToken: orderData.trackingToken || null,
      createdAt: toDateSafe(orderData.createdAt),
    },
  };
}

async function aggregateDineInLikeOrders({ firestore, orderData }) {
  if (!['dine-in', 'car-order'].includes(String(orderData.deliveryType || '').toLowerCase())) {
    return null;
  }

  const unique = new Map();
  const dineInToken = String(orderData.dineInToken || '').trim();
  const tabId = String(orderData.dineInTabId || orderData.tabId || '').trim();

  if (dineInToken) {
    const tokenSnap = await firestore
      .collection('orders')
      .where('restaurantId', '==', orderData.restaurantId)
      .where('dineInToken', '==', dineInToken)
      .limit(120)
      .get();
    tokenSnap.forEach((doc) => unique.set(doc.id, doc));
  } else if (tabId) {
    const [snap1, snap2] = await Promise.all([
      firestore
        .collection('orders')
        .where('restaurantId', '==', orderData.restaurantId)
        .where('dineInTabId', '==', tabId)
        .limit(120)
        .get(),
      firestore
        .collection('orders')
        .where('restaurantId', '==', orderData.restaurantId)
        .where('tabId', '==', tabId)
        .limit(120)
        .get(),
    ]);
    snap1.forEach((doc) => unique.set(doc.id, doc));
    snap2.forEach((doc) => unique.set(doc.id, doc));
  }

  if (unique.size === 0) return null;

  const batches = [];
  let subtotal = 0;
  let cgst = 0;
  let sgst = 0;
  let deliveryCharge = 0;
  let totalAmount = 0;
  let hasPaid = false;
  let hasPayAtCounter = false;
  const items = [];

  const docs = Array.from(unique.values()).sort((a, b) => {
    const aTime = toDateSafe(a.data()?.createdAt)?.getTime() || 0;
    const bTime = toDateSafe(b.data()?.createdAt)?.getTime() || 0;
    return aTime - bTime;
  });

  docs.forEach((doc) => {
    const d = doc.data() || {};
    batches.push({ id: doc.id, ...d });
    if (d.paymentStatus === 'paid') hasPaid = true;
    if (d.paymentStatus === 'pay_at_counter') hasPayAtCounter = true;

    if (!['rejected', 'cancelled'].includes(String(d.status || '').toLowerCase())) {
      items.push(...(Array.isArray(d.items) ? d.items : []));
      subtotal += Number(d.subtotal || 0);
      cgst += Number(d.cgst || 0);
      sgst += Number(d.sgst || 0);
      deliveryCharge += Number(d.deliveryCharge || 0);
      totalAmount += Number(d.totalAmount || 0);
    }
  });

  let paymentStatus = 'pending';
  if (hasPaid) paymentStatus = 'paid';
  else if (hasPayAtCounter) paymentStatus = 'pay_at_counter';

  return {
    batches,
    items,
    subtotal,
    cgst,
    sgst,
    deliveryCharge,
    totalAmount,
    paymentStatus,
  };
}

async function buildFullPayload({ firestore, orderDoc }) {
  const orderData = orderDoc.data() || {};
  const businessType = normalizeBusinessType(orderData.businessType, null);
  const collectionName =
    businessType === 'street-vendor' ? 'street_vendors' : (businessType === 'store' ? 'shops' : 'restaurants');

  const businessDoc = await firestore.collection(collectionName).doc(orderData.restaurantId).get();
  if (!businessDoc.exists) {
    throw new HttpError(404, 'Business associated with order not found.');
  }
  const businessData = businessDoc.data() || {};

  const aggregated = await aggregateDineInLikeOrders({ firestore, orderData });

  const effectiveItems = aggregated?.items || (Array.isArray(orderData.items) ? orderData.items : []);
  const effectiveSubtotal = aggregated?.subtotal ?? Number(orderData.subtotal || 0);
  const effectiveCgst = aggregated?.cgst ?? Number(orderData.cgst || 0);
  const effectiveSgst = aggregated?.sgst ?? Number(orderData.sgst || 0);
  const effectiveDeliveryCharge = aggregated?.deliveryCharge ?? Number(orderData.deliveryCharge || 0);
  const effectiveTotalAmount = aggregated?.totalAmount ?? Number(orderData.totalAmount || 0);
  const effectivePaymentStatus = aggregated?.paymentStatus || orderData.paymentStatus || 'pending';

  let deliveryBoy = null;
  if (orderData.deliveryBoyId) {
    const driverDoc = await firestore.collection('drivers').doc(orderData.deliveryBoyId).get();
    if (driverDoc.exists) {
      const driverData = driverDoc.data() || {};
      deliveryBoy = {
        id: driverDoc.id,
        name: driverData.name || driverData.fullName || 'Delivery Partner',
        photoUrl: driverData.profilePictureUrl || driverData.photoURL || driverData.photoUrl || null,
        rating: driverData.avgRating || 4.5,
        phone: driverData.phone || driverData.phoneNumber || null,
        location: driverData.currentLocation || driverData.location || null,
        isOnline: true,
      };
    }
  }

  const restaurantLocation =
    (businessData.address && typeof businessData.address.latitude === 'number' && typeof businessData.address.longitude === 'number')
      ? { lat: businessData.address.latitude, lng: businessData.address.longitude }
      : null;

  const restaurantPhone =
    orderData.restaurantPhone ||
    businessData.ownerPhone ||
    businessData.phone ||
    businessData.phoneNumber ||
    businessData.contactPhone ||
    businessData.mobileNumber ||
    null;

  return {
    order: {
      id: orderDoc.id,
      customerOrderId: orderData.customerOrderId || null,
      restaurantId: orderData.restaurantId || null,
      status: orderData.status || 'pending',
      customerLocation: orderData.customerLocation || null,
      restaurantLocation,
      customerName: orderData.customerName || null,
      customerAddress: orderData.customerAddress || null,
      customerPhone: orderData.customerPhone || null,
      createdAt: toDateSafe(orderData.createdAt),
      items: effectiveItems,
      batches: aggregated?.batches || [],
      subtotal: effectiveSubtotal,
      cgst: effectiveCgst,
      sgst: effectiveSgst,
      deliveryCharge: effectiveDeliveryCharge,
      totalAmount: effectiveTotalAmount,
      paymentStatus: effectivePaymentStatus,
      paymentDetails: orderData.paymentDetails || null,
      deliveryType: orderData.deliveryType || 'delivery',
      dineInToken: orderData.dineInToken || null,
      tableId: orderData.tableId || null,
      dineInTabId: orderData.dineInTabId || orderData.tabId || null,
      isCarOrder: orderData.isCarOrder || orderData.deliveryType === 'car-order',
      carSpot: orderData.carSpot || null,
      carDetails: orderData.carDetails || null,
      trackingToken: orderData.trackingToken || null,
    },
    restaurant: {
      id: businessDoc.id,
      name: businessData.name || '',
      address: businessData.address || null,
      ownerPhone: restaurantPhone,
      phone: restaurantPhone,
      businessType: normalizeBusinessType(businessData.businessType, collectionName),
    },
    deliveryBoy,
  };
}

async function getOrderStatus({ req, orderId }) {
  const safeOrderId = String(orderId || '').trim();
  if (!safeOrderId) throw new HttpError(400, 'Order ID is missing.');

  const liteMode = ['1', 'true', 'yes'].includes(String(req.query.lite || '').toLowerCase());
  const cacheKey = `order_status:${safeOrderId}:${liteMode ? 'lite' : 'full'}`;

  const cached = await getCache(cacheKey);
  if (cached.hit && cached.value) {
    return {
      payload: cached.value,
      cacheStatus: cached.source === 'memory' ? 'L1-HIT' : 'HIT',
      liteMode,
    };
  }

  const firestore = await getFirestore();
  const orderDoc = await getOrderSnapshot({ firestore, orderId: safeOrderId });
  const orderData = orderDoc.data() || {};

  const isAuthorized = await verifyReaderIdentity(req, orderData);
  if (!isAuthorized) {
    throw new HttpError(403, 'Unauthorized. Invalid or missing tracking token.');
  }

  if (liteMode) {
    const payload = mapLitePayload(orderDoc);
    const statusLower = String(orderData.status || '').toLowerCase();
    if (!FINAL_STATES.has(statusLower)) {
      await setCache(cacheKey, payload, config.cache.orderStatusLiteTtlSec);
    }
    return { payload, cacheStatus: 'MISS', liteMode };
  }

  const payload = await buildFullPayload({ firestore, orderDoc });
  const statusLower = String(orderData.status || '').toLowerCase();
  if (!FINAL_STATES.has(statusLower)) {
    await setCache(cacheKey, payload, config.cache.orderStatusFullTtlSec);
  }

  return { payload, cacheStatus: FINAL_STATES.has(statusLower) ? 'SKIP' : 'MISS', liteMode };
}

module.exports = { getOrderStatus };
