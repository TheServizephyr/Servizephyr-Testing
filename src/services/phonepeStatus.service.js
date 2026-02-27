const { getFirestore, verifyIdToken } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { getPhonePeOrderStatus, isPhonePePaymentSuccess } = require('./phonepe.service');

const PRIVILEGED_ROLES = new Set([
  'admin',
  'owner',
  'restaurant-owner',
  'shop-owner',
  'street-vendor',
  'manager',
]);

const FORWARD_ONLY_STATUSES = new Set([
  'confirmed',
  'preparing',
  'ready',
  'ready_for_pickup',
  'dispatched',
  'on_the_way',
  'reached_restaurant',
  'picked_up',
  'delivery_attempted',
  'failed_delivery',
  'returned_to_restaurant',
  'delivered',
  'rejected',
  'cancelled',
  'served',
  'paid',
]);

function extractBearer(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice('Bearer '.length).trim();
}

function getQueryToken(req) {
  return String(req.query.token || '').trim();
}

async function decodeBearerUid(req) {
  const token = extractBearer(req);
  if (!token) return '';
  try {
    const decoded = await verifyIdToken(token);
    return decoded?.uid || '';
  } catch {
    return '';
  }
}

async function hasBusinessAccess({ firestore, uid, restaurantId }) {
  if (!uid || !restaurantId) return false;

  const userDoc = await firestore.collection('users').doc(uid).get();
  if (!userDoc.exists) return false;
  const userData = userDoc.data() || {};
  const role = String(userData.role || '').trim().toLowerCase();

  if (role === 'admin') return true;
  if (!PRIVILEGED_ROLES.has(role)) return false;

  for (const collectionName of ['restaurants', 'shops', 'street_vendors']) {
    const businessDoc = await firestore.collection(collectionName).doc(restaurantId).get();
    if (businessDoc.exists) {
      const businessData = businessDoc.data() || {};
      if (businessData.ownerId === uid) return true;
      break;
    }
  }

  if (Array.isArray(userData.linkedOutlets)) {
    return userData.linkedOutlets.some(
      (outlet) => outlet?.outletId === restaurantId && outlet?.status === 'active'
    );
  }

  return false;
}

async function authorizeStatusRead({ req, firestore, orderId, orderData }) {
  const uid = await decodeBearerUid(req);
  if (uid) {
    if (uid === orderData.userId || uid === orderData.customerId) {
      return true;
    }
    const restaurantId = String(orderData.restaurantId || '').trim();
    const privileged = await hasBusinessAccess({ firestore, uid, restaurantId });
    if (privileged) return true;
  }

  const queryToken = getQueryToken(req);
  if (queryToken) {
    if (queryToken === String(orderData.trackingToken || '')) return true;
    if (queryToken === String(orderData.dineInToken || '')) return true;
  }

  throw new HttpError(401, `Unauthorized for order ${orderId}`);
}

async function maybeSyncPaidState({ orderRef, orderData, phonePeOrderId, paymentState }) {
  if (!isPhonePePaymentSuccess(paymentState)) return;
  if (String(orderData.paymentStatus || '').toLowerCase() === 'paid') return;

  const currentStatus = String(orderData.status || '').toLowerCase();
  const updateData = {
    paymentStatus: 'paid',
    paymentMethod: 'phonepe',
    phonePeOrderId,
    updatedAt: new Date(),
  };

  if (!FORWARD_ONLY_STATUSES.has(currentStatus)) {
    updateData.status = 'pending';
  }

  await orderRef.update(updateData);
}

async function getPhonePeStatusForOrder({ req, orderId }) {
  const safeOrderId = String(orderId || '').trim();
  if (!safeOrderId) {
    throw new HttpError(400, 'Order ID is required');
  }

  const firestore = await getFirestore();
  const orderRef = firestore.collection('orders').doc(safeOrderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) {
    throw new HttpError(404, 'Order not found');
  }

  const orderData = orderDoc.data() || {};
  await authorizeStatusRead({
    req,
    firestore,
    orderId: safeOrderId,
    orderData,
  });

  const gatewayPayload = await getPhonePeOrderStatus({ orderId: safeOrderId });
  await maybeSyncPaidState({
    orderRef,
    orderData,
    phonePeOrderId: safeOrderId,
    paymentState: gatewayPayload?.state,
  });

  return {
    success: true,
    data: gatewayPayload,
  };
}

module.exports = {
  getPhonePeStatusForOrder,
};
