const { FieldValue, getDatabase } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveRiderContext } = require('./accessControl.service');
const { emitOrderEvent } = require('./orderEvents.service');

const RIDER_MUTABLE_STATUSES = new Set([
  'ready_for_pickup',
  'dispatched',
  'reached_restaurant',
  'picked_up',
  'on_the_way',
  'rider_arrived',
  'delivery_attempted',
  'failed_delivery',
  'returned_to_restaurant',
  'delivered',
]);

const FINAL_ORDER_STATUSES = new Set(['delivered', 'rejected', 'cancelled', 'served', 'paid', 'returned_to_restaurant']);
const ACTIVE_RIDER_ORDER_STATUSES = new Set([
  'ready_for_pickup',
  'dispatched',
  'reached_restaurant',
  'picked_up',
  'on_the_way',
  'rider_arrived',
  'delivery_attempted',
  'failed_delivery',
]);

const STATUS_TRANSITIONS = {
  ready_for_pickup: new Set(['on_the_way', 'dispatched']),
  dispatched: new Set(['reached_restaurant', 'ready_for_pickup', 'on_the_way']),
  reached_restaurant: new Set(['picked_up', 'on_the_way']),
  picked_up: new Set(['on_the_way']),
  on_the_way: new Set(['rider_arrived', 'ready_for_pickup', 'delivery_attempted']),
  rider_arrived: new Set(['delivered', 'on_the_way']),
  delivery_attempted: new Set(['failed_delivery', 'on_the_way']),
  failed_delivery: new Set(['returned_to_restaurant', 'on_the_way']),
  returned_to_restaurant: new Set([]),
  delivered: new Set([]),
};

const BUSINESS_COLLECTION_PRIORITY = ['restaurants', 'shops', 'street_vendors'];
const BUSINESS_COLLECTION_BY_TYPE = {
  restaurant: 'restaurants',
  store: 'shops',
  shop: 'shops',
  'street-vendor': 'street_vendors',
  street_vendor: 'street_vendors',
};

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBusinessType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'shop') return 'store';
  if (normalized === 'street_vendor') return 'street-vendor';
  return normalized;
}

function parseUniqueOrderIds(orderIds) {
  if (!Array.isArray(orderIds)) return [];
  return Array.from(new Set(orderIds.map((value) => String(value || '').trim()).filter(Boolean)));
}

function sanitizeUpiId(value) {
  return String(value || '').trim().toLowerCase();
}

function toMoney(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return amount;
}

function buildManualUpiLink({ upiId, amount, orderLabel, payeeName }) {
  const params = new URLSearchParams({
    pa: upiId,
    pn: String(payeeName || 'ServiZephyr').slice(0, 50),
    am: amount.toFixed(2),
    cu: 'INR',
    tn: `Order ${orderLabel}`,
    tr: `RIDER${Date.now().toString().slice(-8)}`,
  });
  return `upi://pay?${params.toString()}`;
}

function canRiderTransition(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus);
  const to = normalizeStatus(toStatus);
  if (from === to) return true;
  const allowed = STATUS_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.has(to);
}

function ensureOrderAssigned(orderData, riderUid, orderId) {
  const assigned = String(orderData?.deliveryBoyId || '').trim();
  if (!assigned || assigned !== riderUid) {
    throw new HttpError(403, `Unauthorized for order ${orderId}.`);
  }
}

async function acceptRiderOrders(req, body = {}) {
  const rider = await resolveRiderContext(req, { checkRevoked: true });
  const firestore = rider.firestore;
  const safeIds = parseUniqueOrderIds(body.orderIds);
  if (!safeIds.length) {
    throw new HttpError(400, 'Order IDs array is required.');
  }

  const snaps = await Promise.all(safeIds.map((id) => firestore.collection('orders').doc(id).get()));
  for (const snap of snaps) {
    if (!snap.exists) throw new HttpError(404, `Order ${snap.id} not found.`);
    const data = snap.data() || {};
    ensureOrderAssigned(data, rider.uid, snap.id);
    const current = normalizeStatus(data.status);
    if (!['reached_restaurant', 'picked_up'].includes(current)) {
      throw new HttpError(
        400,
        `Order ${snap.id} must be in reached_restaurant state before pickup (current: ${current || 'unknown'}).`
      );
    }
  }

  const batch = firestore.batch();
  snaps.forEach((snap) => {
    const data = snap.data() || {};
    const current = normalizeStatus(data.status);
    if (current === 'picked_up') return;
    batch.update(snap.ref, {
      status: 'picked_up',
      statusHistory: FieldValue.arrayUnion({
        status: 'picked_up',
        timestamp: new Date(),
        updatedBy: rider.uid,
      }),
      updatedAt: new Date(),
    });
  });
  batch.update(rider.driverRef, {
    status: 'on-delivery',
    updatedAt: new Date(),
  });
  await batch.commit();

  safeIds.forEach((orderId) => {
    const data = snaps.find((snap) => snap.id === orderId)?.data() || {};
    emitOrderEvent({
      eventType: 'order.status.updated',
      businessId: data.restaurantId || '',
      riderId: rider.uid,
      orderId,
      data: { status: 'picked_up' },
    });
  });

  return {
    payload: {
      message: 'Orders accepted successfully.',
    },
    context: rider,
  };
}

async function getRemainingActiveOrders({ firestore, riderUid, excludingOrderIds = [] }) {
  const excluded = new Set(parseUniqueOrderIds(excludingOrderIds));
  let snap;
  try {
    snap = await firestore
      .collection('orders')
      .where('deliveryBoyId', '==', riderUid)
      .where('status', 'in', Array.from(ACTIVE_RIDER_ORDER_STATUSES))
      .get();
  } catch {
    const fallback = await firestore.collection('orders').where('deliveryBoyId', '==', riderUid).limit(200).get();
    const docs = fallback.docs.filter((doc) =>
      ACTIVE_RIDER_ORDER_STATUSES.has(normalizeStatus(doc.data()?.status))
    );
    snap = { docs };
  }

  const remaining = (snap.docs || []).filter((doc) => !excluded.has(doc.id));
  return remaining;
}

async function syncRealtimeTracking({ orderId, orderData, newStatus, riderUid }) {
  try {
    const database = await getDatabase();
    const path = `delivery_tracking/${orderId}`;
    if (FINAL_ORDER_STATUSES.has(normalizeStatus(newStatus))) {
      await database.ref(path).remove();
      return;
    }
    await database.ref(path).set({
      status: newStatus,
      updatedAt: Date.now(),
      riderId: riderUid,
      token: orderData?.trackingToken || orderData?.sessionToken || null,
    });
  } catch {
    // Non-blocking RTDB sync
  }
}

async function updateRiderOrderStatus(req, body = {}) {
  const rider = await resolveRiderContext(req, { checkRevoked: true });
  const firestore = rider.firestore;

  const orderId = String(body.orderId || '').trim();
  const newStatus = normalizeStatus(body.newStatus);
  if (!orderId || !newStatus) {
    throw new HttpError(400, 'Order ID and new status are required.');
  }
  if (!RIDER_MUTABLE_STATUSES.has(newStatus)) {
    throw new HttpError(400, 'Invalid status provided for rider update.');
  }

  const orderRef = firestore.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new HttpError(404, 'Order not found.');
  const orderData = orderSnap.data() || {};

  ensureOrderAssigned(orderData, rider.uid, orderId);
  const currentStatus = normalizeStatus(orderData.status);
  if (!canRiderTransition(currentStatus, newStatus)) {
    throw new HttpError(400, `Invalid status transition: ${currentStatus || 'unknown'} -> ${newStatus}`);
  }

  const updateData = {
    status: newStatus,
    statusHistory: FieldValue.arrayUnion({
      status: newStatus,
      timestamp: new Date(),
      updatedBy: rider.uid,
    }),
    updatedAt: new Date(),
  };

  if (newStatus === 'delivered') {
    updateData.deliveredAt = FieldValue.serverTimestamp();
  }

  const batch = firestore.batch();
  batch.update(orderRef, updateData);

  const remaining = await getRemainingActiveOrders({
    firestore,
    riderUid: rider.uid,
    excludingOrderIds: [orderId],
  });
  if (newStatus === 'delivered' || newStatus === 'returned_to_restaurant') {
    if (remaining.length === 0) {
      batch.update(rider.driverRef, {
        status: 'online',
        updatedAt: new Date(),
      });
    }
  } else {
    batch.update(rider.driverRef, {
      status: 'on-delivery',
      updatedAt: new Date(),
    });
  }

  await batch.commit();
  await syncRealtimeTracking({
    orderId,
    orderData,
    newStatus,
    riderUid: rider.uid,
  });

  emitOrderEvent({
    eventType: 'order.status.updated',
    businessId: orderData.restaurantId || '',
    riderId: rider.uid,
    orderId,
    data: {
      status: newStatus,
      previousStatus: currentStatus,
    },
  });

  return {
    payload: {
      message: 'Order status updated successfully.',
    },
    context: rider,
  };
}

function buildLifecycleUpdate({ riderUid, newStatus, reason = '' }) {
  const updateData = {
    status: newStatus,
    statusHistory: FieldValue.arrayUnion({
      status: newStatus,
      timestamp: new Date(),
      updatedBy: riderUid,
      ...(reason ? { reason } : {}),
    }),
    updatedAt: new Date(),
  };

  if (newStatus === 'failed_delivery') {
    updateData.failureReason = reason || 'Customer unreachable';
    updateData.failureTimestamp = new Date();
  }
  if (newStatus === 'returned_to_restaurant') {
    updateData.returnedTimestamp = new Date();
  }
  if (newStatus === 'delivered') {
    updateData.deliveredAt = FieldValue.serverTimestamp();
  }

  return updateData;
}

async function bulkTransitionRiderOrders(req, body = {}, options = {}) {
  const rider = await resolveRiderContext(req, { checkRevoked: true });
  const firestore = rider.firestore;
  const safeIds = parseUniqueOrderIds(body.orderIds);
  if (!safeIds.length) {
    throw new HttpError(400, 'Order IDs array is required.');
  }

  const fromStatuses = Array.isArray(options.fromStatuses)
    ? options.fromStatuses.map((status) => normalizeStatus(status))
    : [];
  const targetStatus = normalizeStatus(options.targetStatus);
  if (!targetStatus || !fromStatuses.length) {
    throw new HttpError(500, 'Bulk transition configuration is invalid.');
  }

  const snaps = await Promise.all(safeIds.map((id) => firestore.collection('orders').doc(id).get()));
  for (const snap of snaps) {
    if (!snap.exists) throw new HttpError(404, `Order ${snap.id} not found.`);
    const data = snap.data() || {};
    ensureOrderAssigned(data, rider.uid, snap.id);

    const current = normalizeStatus(data.status);
    if (!fromStatuses.includes(current)) {
      throw new HttpError(
        400,
        `Order ${snap.id} must be in ${fromStatuses.join(' or ')} state. Current status: ${current || 'unknown'}`
      );
    }
  }

  const reason = String(body.reason || '').trim();
  const batch = firestore.batch();
  snaps.forEach((snap) => {
    batch.update(
      snap.ref,
      buildLifecycleUpdate({
        riderUid: rider.uid,
        newStatus: targetStatus,
        reason,
      })
    );
  });

  const shouldSetOnline = options.setOnlineWhenNoActive === true;
  if (shouldSetOnline) {
    const remaining = await getRemainingActiveOrders({
      firestore,
      riderUid: rider.uid,
      excludingOrderIds: safeIds,
    });
    if (remaining.length === 0) {
      batch.update(rider.driverRef, {
        status: 'online',
        updatedAt: new Date(),
      });
    }
  } else if (options.setOnDelivery !== false) {
    batch.update(rider.driverRef, {
      status: 'on-delivery',
      updatedAt: new Date(),
    });
  }

  await batch.commit();

  await Promise.allSettled(
    safeIds.map(async (orderId) => {
      const orderData = snaps.find((snap) => snap.id === orderId)?.data() || {};
      await syncRealtimeTracking({
        orderId,
        orderData,
        newStatus: targetStatus,
        riderUid: rider.uid,
      });
      emitOrderEvent({
        eventType: 'order.status.updated',
        businessId: orderData.restaurantId || '',
        riderId: rider.uid,
        orderId,
        data: {
          status: targetStatus,
        },
      });
    })
  );

  return {
    payload: {
      message: String(options.successMessage || 'Order status updated successfully.'),
    },
    context: rider,
  };
}

async function reachedRestaurantRiderOrders(req, body = {}) {
  return bulkTransitionRiderOrders(req, body, {
    fromStatuses: ['dispatched'],
    targetStatus: 'reached_restaurant',
    successMessage: 'Arrived at restaurant. Waiting for food pickup.',
    setOnDelivery: true,
  });
}

async function startRiderDelivery(req, body = {}) {
  return bulkTransitionRiderOrders(req, body, {
    fromStatuses: ['picked_up'],
    targetStatus: 'on_the_way',
    successMessage: 'Delivery started! En route to customer.',
    setOnDelivery: true,
  });
}

async function attemptRiderDelivery(req, body = {}) {
  return bulkTransitionRiderOrders(req, body, {
    fromStatuses: ['on_the_way'],
    targetStatus: 'delivery_attempted',
    successMessage: 'Delivery attempt recorded.',
    setOnDelivery: true,
  });
}

async function markRiderDeliveryFailed(req, body = {}) {
  return bulkTransitionRiderOrders(req, body, {
    fromStatuses: ['delivery_attempted'],
    targetStatus: 'failed_delivery',
    successMessage: 'Delivery marked as failed. Return parcel to restaurant.',
    setOnDelivery: true,
  });
}

async function returnRiderOrders(req, body = {}) {
  return bulkTransitionRiderOrders(req, body, {
    fromStatuses: ['failed_delivery'],
    targetStatus: 'returned_to_restaurant',
    successMessage: 'Order returned.',
    setOnlineWhenNoActive: true,
    setOnDelivery: false,
  });
}

async function updateRiderPaymentStatus(req, body = {}) {
  const rider = await resolveRiderContext(req, { checkRevoked: true });
  const firestore = rider.firestore;

  const orderId = String(body.orderId || '').trim();
  const paymentStatus = String(body.paymentStatus || '').trim().toLowerCase();
  const paymentMethod = String(body.paymentMethod || '').trim().toLowerCase();
  if (!orderId || !paymentStatus) {
    throw new HttpError(400, 'Order ID and payment status required.');
  }

  const orderRef = firestore.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new HttpError(404, 'Order not found.');

  const orderData = orderSnap.data() || {};
  ensureOrderAssigned(orderData, rider.uid, orderId);

  await orderRef.update({
    paymentStatus,
    paymentMethod: paymentMethod || String(orderData.paymentMethod || '').trim() || 'online',
    lastUpdated: FieldValue.serverTimestamp(),
    updatedAt: new Date(),
  });

  emitOrderEvent({
    eventType: 'order.payment.updated',
    businessId: orderData.restaurantId || '',
    riderId: rider.uid,
    orderId,
    data: {
      paymentStatus,
      paymentMethod: paymentMethod || String(orderData.paymentMethod || '').trim() || 'online',
    },
  });

  return {
    payload: {
      success: true,
      message: 'Payment status updated.',
    },
    context: rider,
  };
}

async function resolveBusinessForOrder({ firestore, orderData }) {
  const businessId = String(orderData?.restaurantId || '').trim();
  if (!businessId) {
    throw new HttpError(400, 'Business ID is missing on this order.');
  }

  const preferredCollection = BUSINESS_COLLECTION_BY_TYPE[normalizeBusinessType(orderData?.businessType)];
  const candidates = preferredCollection
    ? [preferredCollection, ...BUSINESS_COLLECTION_PRIORITY.filter((name) => name !== preferredCollection)]
    : BUSINESS_COLLECTION_PRIORITY;

  for (const collectionName of candidates) {
    const doc = await firestore.collection(collectionName).doc(businessId).get();
    if (doc.exists) {
      return {
        collectionName,
        businessId: doc.id,
        businessData: doc.data() || {},
      };
    }
  }

  throw new HttpError(404, 'Business not found for this order.');
}

async function sendRiderPaymentRequest(req, body = {}) {
  const rider = await resolveRiderContext(req, { checkRevoked: true });
  const firestore = rider.firestore;
  const orderId = String(body.orderId || '').trim();
  if (!orderId) {
    throw new HttpError(400, 'Order ID is required.');
  }

  const orderRef = firestore.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new HttpError(404, 'Order not found.');

  const orderData = orderSnap.data() || {};
  ensureOrderAssigned(orderData, rider.uid, orderId);

  if (normalizeStatus(orderData.paymentStatus) === 'paid') {
    throw new HttpError(400, 'Order payment is already marked as paid.');
  }

  const business = await resolveBusinessForOrder({ firestore, orderData });
  const upiId = sanitizeUpiId(business.businessData.upiId);
  if (!upiId || !upiId.includes('@')) {
    throw new HttpError(400, 'Restaurant UPI ID is not configured yet.');
  }

  const amount = toMoney(orderData.totalAmount || orderData.amount || 0);
  if (amount <= 0) {
    throw new HttpError(400, 'Order amount is invalid for payment request.');
  }

  const orderLabel = String(
    orderData.orderDisplayId || orderData.customerOrderId || orderData.orderNumber || orderId
  ).trim();
  const payeeName = String(business.businessData.upiPayeeName || business.businessData.name || 'ServiZephyr').trim();
  const upiLink = buildManualUpiLink({
    upiId,
    amount,
    orderLabel,
    payeeName,
  });

  await orderRef.update({
    paymentRequestSentAt: FieldValue.serverTimestamp(),
    paymentRequestSentBy: rider.uid,
    paymentRequestSentByRole: 'rider',
    paymentRequestStatus: 'sent',
    paymentRequestLink: upiLink,
    paymentRequestAmount: amount,
    paymentRequestCount: FieldValue.increment(1),
    updatedAt: new Date(),
  });

  emitOrderEvent({
    eventType: 'order.payment_request.sent',
    businessId: business.businessId,
    riderId: rider.uid,
    orderId,
    data: {
      paymentRequestStatus: 'sent',
      paymentRequestAmount: amount,
    },
  });

  return {
    payload: {
      success: true,
      message: 'Payment request generated successfully.',
      orderId,
      upiLink,
      amount,
    },
    context: rider,
  };
}

module.exports = {
  acceptRiderOrders,
  updateRiderOrderStatus,
  reachedRestaurantRiderOrders,
  startRiderDelivery,
  attemptRiderDelivery,
  markRiderDeliveryFailed,
  returnRiderOrders,
  updateRiderPaymentStatus,
  sendRiderPaymentRequest,
};
