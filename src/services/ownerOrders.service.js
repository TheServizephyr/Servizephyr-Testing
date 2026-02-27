const { getDatabase, FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS, hasPermission } = require('./accessControl.service');
const { emitOrderEvent } = require('./orderEvents.service');

const VALID_STATUSES = new Set([
  'pending',
  'confirmed',
  'preparing',
  'prepared',
  'ready_for_pickup',
  'dispatched',
  'reached_restaurant',
  'picked_up',
  'on_the_way',
  'delivery_attempted',
  'failed_delivery',
  'returned_to_restaurant',
  'delivered',
  'rejected',
  'ready',
  'cancelled',
]);

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toIso(value) {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

function normalizeMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return amount;
}

function normalizeIndianPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function resolveCustomerPhone(orderData = {}) {
  const candidates = [
    orderData.customerPhone,
    orderData.phone,
    orderData.customer?.phone,
    orderData.customerDetails?.phone,
  ];
  for (const candidate of candidates) {
    const phone = normalizeIndianPhone(candidate);
    if (phone && phone.length >= 10) return phone;
  }
  const legacy = parseMaybeJson(orderData.customer_details) || parseMaybeJson(orderData.customerDetails);
  if (legacy?.phone) {
    const phone = normalizeIndianPhone(legacy.phone);
    if (phone && phone.length >= 10) return phone;
  }
  return '';
}

function resolveCustomerName(orderData = {}) {
  const candidates = [
    orderData.customerName,
    orderData.name,
    orderData.customer?.name,
    orderData.customerDetails?.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const legacy = parseMaybeJson(orderData.customer_details) || parseMaybeJson(orderData.customerDetails);
  if (legacy?.name && String(legacy.name).trim()) return String(legacy.name).trim();
  return 'Customer';
}

function redactOrderForViewer(orderData = {}, canViewCustomerDetails = true, canViewPaymentDetails = true) {
  const redacted = { ...orderData };

  if (!canViewCustomerDetails) {
    delete redacted.customerName;
    delete redacted.customerPhone;
    delete redacted.customerAddress;
    delete redacted.customerId;
    delete redacted.userId;
    delete redacted.customer;
  }

  if (!canViewPaymentDetails) {
    delete redacted.paymentDetails;
    delete redacted.paymentMethod;
    delete redacted.paymentStatus;
    delete redacted.paymentRequestSentAt;
    delete redacted.paymentRequestSentBy;
    delete redacted.paymentRequestSentByRole;
    delete redacted.paymentRequestStatus;
    delete redacted.paymentRequestLink;
    delete redacted.paymentRequestImage;
    delete redacted.paymentRequestAmount;
    delete redacted.paymentRequestCount;
    delete redacted.paymentConfirmedVia;
    delete redacted.paymentConfirmedBy;
    delete redacted.paymentConfirmedAt;
    delete redacted.subtotal;
    delete redacted.cgst;
    delete redacted.sgst;
    delete redacted.deliveryCharge;
    delete redacted.discount;
    delete redacted.totalAmount;
    delete redacted.amount;
  }

  return redacted;
}

function mapOrderForList(orderDoc, canViewCustomerDetails, canViewPaymentDetails) {
  const data = orderDoc.data() || {};
  const statusHistory = (Array.isArray(data.statusHistory) ? data.statusHistory : []).map((entry) => ({
    ...entry,
    timestamp: toIso(entry?.timestamp) || entry?.timestamp || null,
  }));
  const itemsWithQty = (Array.isArray(data.items) ? data.items : []).map((item) => ({
    ...item,
    qty: item?.quantity || item?.qty || 1,
  }));

  return redactOrderForViewer(
    {
      id: orderDoc.id,
      ...data,
      items: itemsWithQty,
      orderDate: toIso(data.orderDate) || data.orderDate || null,
      customer: data.customerName || null,
      amount: data.totalAmount || 0,
      statusHistory,
    },
    canViewCustomerDetails,
    canViewPaymentDetails
  );
}

function compareByOrderDateDesc(a, b) {
  const aTime = toDate(a?.orderDate || a?.createdAt)?.getTime() || 0;
  const bTime = toDate(b?.orderDate || b?.createdAt)?.getTime() || 0;
  return bTime - aTime;
}

async function fetchOrdersForRestaurant({ firestore, businessId, startDate, endDate, limit = 50 }) {
  const ordersRef = firestore.collection('orders');

  try {
    let query = ordersRef.where('restaurantId', '==', businessId);
    if (startDate && endDate) {
      query = query.where('orderDate', '>=', startDate).where('orderDate', '<=', endDate);
    }
    const snap = await query.orderBy('orderDate', 'desc').limit(limit).get();
    return snap.docs;
  } catch {
    // Index fallback for legacy datasets.
    const fallback = await ordersRef.where('restaurantId', '==', businessId).limit(300).get();
    const filtered = fallback.docs.filter((doc) => {
      if (!startDate || !endDate) return true;
      const orderDate = toDate(doc.data()?.orderDate);
      if (!orderDate) return false;
      return orderDate >= startDate && orderDate <= endDate;
    });
    filtered.sort((a, b) => {
      const at = toDate(a.data()?.orderDate)?.getTime() || 0;
      const bt = toDate(b.data()?.orderDate)?.getTime() || 0;
      return bt - at;
    });
    return filtered.slice(0, limit);
  }
}

function getAllowedNextStatuses(orderData = {}) {
  const deliveryType = String(orderData.deliveryType || '').toLowerCase();
  const isPickup = deliveryType === 'pickup';
  const isDelivery = deliveryType === 'delivery';
  const isDineIn = deliveryType === 'dine-in'
    || orderData.diningPreference === 'dine-in'
    || !!orderData.tableId
    || !!orderData.dineInTabId
    || !!orderData.tabId;

  if (isPickup) {
    return {
      pending: new Set(['confirmed', 'rejected']),
      confirmed: new Set(['preparing']),
      preparing: new Set(['ready_for_pickup']),
      ready_for_pickup: new Set(['picked_up']),
    };
  }

  if (isDineIn) {
    return {
      pending: new Set(['confirmed', 'rejected']),
      confirmed: new Set(['preparing']),
      preparing: new Set(['ready', 'ready_for_pickup']),
      ready: new Set(['delivered']),
      ready_for_pickup: new Set(['delivered']),
    };
  }

  if (isDelivery) {
    return {
      pending: new Set(['confirmed', 'rejected']),
      confirmed: new Set(['preparing']),
      preparing: new Set(['prepared']),
      prepared: new Set(['ready_for_pickup']),
      ready_for_pickup: new Set(['dispatched']),
      dispatched: new Set(['delivered']),
    };
  }

  return {
    pending: new Set(['confirmed', 'rejected']),
    confirmed: new Set(['preparing']),
    preparing: new Set(['ready', 'ready_for_pickup']),
    ready: new Set(['delivered']),
    ready_for_pickup: new Set(['delivered']),
  };
}

function canTransition(orderData, fromStatus, toStatus) {
  const current = String(fromStatus || '').toLowerCase();
  const next = String(toStatus || '').toLowerCase();
  if (current === next) return true;
  if (next === 'rejected') return current === 'pending';
  if (['delivered', 'rejected', 'picked_up', 'cancelled'].includes(current)) return false;

  const allowed = getAllowedNextStatuses(orderData);
  if (allowed[current]?.has(next)) return true;

  const previous = Object.entries(allowed)
    .filter(([, nextSet]) => nextSet?.has(current))
    .map(([value]) => value);
  return previous.includes(next);
}

function ensurePermission(context, permission, message) {
  if (!hasPermission(context, permission)) {
    throw new HttpError(403, message || 'Access denied.');
  }
}

function buildPaymentRequest({ orderData, businessData }) {
  const upiId = String(businessData?.upiId || '').trim().toLowerCase();
  if (!upiId || !upiId.includes('@')) {
    throw new HttpError(400, 'UPI ID is not configured for this outlet.');
  }

  const amount = normalizeMoney(orderData.totalAmount || orderData.amount || 0);
  if (amount <= 0) {
    throw new HttpError(400, 'Order amount is invalid for payment request.');
  }

  const payeeName = String(businessData?.upiPayeeName || businessData?.name || 'ServiZephyr')
    .trim()
    .slice(0, 50);
  const orderDisplayId = orderData.customerOrderId
    ? `#${orderData.customerOrderId}`
    : `#${String(orderData.id || '').slice(0, 8)}`;
  const tr = `ORD${String(orderData.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-12)}${Date.now()
    .toString()
    .slice(-4)}`;

  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: `Order ${orderDisplayId}`,
    tr,
  });

  return {
    amount,
    upiId,
    upiLink: `upi://pay?${params.toString()}`,
    orderDisplayId,
    tr,
  };
}

async function getOwnerOrders(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_ORDERS],
  });
  const firestore = owner.firestore;
  const businessData = owner.businessData || {};
  const businessId = owner.businessId;

  const canViewCustomerDetails = hasPermission(owner, PERMISSIONS.VIEW_CUSTOMERS);
  const canViewPaymentDetails = hasPermission(owner, PERMISSIONS.VIEW_PAYMENTS);

  const orderId = String(req.query.id || '').trim();
  const customerId = String(req.query.customerId || '').trim();

  if (orderId) {
    const orderRef = firestore.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) throw new HttpError(404, 'Order not found.');

    const orderData = orderDoc.data() || {};
    if (String(orderData.restaurantId || '').trim() !== businessId) {
      throw new HttpError(403, 'Access denied to this order.');
    }

    const responseOrder = redactOrderForViewer(
      {
        id: orderDoc.id,
        ...orderData,
        orderDate: toIso(orderData.orderDate) || orderData.orderDate || null,
      },
      canViewCustomerDetails,
      canViewPaymentDetails
    );

    let customer = null;
    if (customerId && canViewCustomerDetails) {
      const customerDoc = await firestore
        .collection(owner.collectionName)
        .doc(businessId)
        .collection('customers')
        .doc(customerId)
        .get();
      if (customerDoc.exists) customer = customerDoc.data() || null;
    }

    return {
      payload: {
        order: responseOrder,
        restaurant: businessData,
        customer,
        canViewCustomerDetails,
        canViewPaymentDetails,
      },
      context: owner,
    };
  }

  const startDateRaw = String(req.query.startDate || '').trim();
  const endDateRaw = String(req.query.endDate || '').trim();
  const startDate = startDateRaw ? new Date(startDateRaw) : null;
  const endDate = endDateRaw ? new Date(endDateRaw) : null;

  let docs = [];
  if (customerId) {
    try {
      const primary = await firestore
        .collection('orders')
        .where('restaurantId', '==', businessId)
        .where('customerId', '==', customerId)
        .orderBy('orderDate', 'desc')
        .limit(40)
        .get();
      docs = primary.docs;
      if (docs.length === 0) {
        const fallback = await firestore
          .collection('orders')
          .where('restaurantId', '==', businessId)
          .where('userId', '==', customerId)
          .orderBy('orderDate', 'desc')
          .limit(40)
          .get();
        docs = fallback.docs;
      }
    } catch {
      const fallback = await firestore.collection('orders').where('restaurantId', '==', businessId).limit(300).get();
      docs = fallback.docs.filter((doc) => {
        const data = doc.data() || {};
        return String(data.customerId || data.userId || '').trim() === customerId;
      });
      docs.sort((a, b) => compareByOrderDateDesc(a.data(), b.data()));
      docs = docs.slice(0, 40);
    }
  } else {
    docs = await fetchOrdersForRestaurant({
      firestore,
      businessId,
      startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate : null,
      endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : null,
      limit: 80,
    });
  }

  const orders = docs
    .map((doc) => mapOrderForList(doc, canViewCustomerDetails, canViewPaymentDetails))
    .sort(compareByOrderDateDesc);

  return {
    payload: {
      orders,
    },
    context: owner,
  };
}

async function updateOwnerOrders(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.UPDATE_ORDER_STATUS, PERMISSIONS.PROCESS_PAYMENT, PERMISSIONS.REFUND_ORDER],
  });

  const firestore = owner.firestore;
  const businessId = owner.businessId;
  const businessData = owner.businessData || {};
  const body = req.body || {};
  const database = await getDatabase();

  const idsToUpdate = Array.isArray(body.idsToUpdate) ? body.idsToUpdate : [];
  const orderIds = Array.isArray(body.orderIds) ? body.orderIds : [];
  const orderId = String(body.orderId || '').trim();
  const cashRefundOrderIds = Array.isArray(body.cashRefundOrderIds) ? body.cashRefundOrderIds : [];
  const action = String(body.action || '').trim().toLowerCase();

  let targetOrderIds = [...idsToUpdate];
  if (targetOrderIds.length === 0) targetOrderIds = [...orderIds];
  if (targetOrderIds.length === 0 && orderId) targetOrderIds = [orderId];
  targetOrderIds = Array.from(new Set(targetOrderIds.map((value) => String(value || '').trim()).filter(Boolean)));

  if (targetOrderIds.length === 0 && action !== 'markcashrefunded') {
    throw new HttpError(400, 'No order IDs provided.');
  }

  const allIds = Array.from(new Set([...targetOrderIds, ...cashRefundOrderIds.map((v) => String(v || '').trim())].filter(Boolean)));
  const snapshots = await Promise.all(allIds.map((id) => firestore.collection('orders').doc(id).get()));
  const orderMap = new Map();
  snapshots.forEach((snap) => {
    if (snap.exists) orderMap.set(snap.id, snap);
  });

  if (!orderMap.size) throw new HttpError(404, 'No orders found.');

  for (const id of allIds) {
    const snap = orderMap.get(id);
    if (!snap) throw new HttpError(404, `Order ${id} not found.`);
    const data = snap.data() || {};
    if (String(data.restaurantId || '').trim() !== businessId) {
      throw new HttpError(403, `Access denied to order ${id}.`);
    }
  }

  if (action === 'send_payment_request') {
    ensurePermission(owner, PERMISSIONS.PROCESS_PAYMENT, 'Access denied: cannot request payments.');
    if (targetOrderIds.length !== 1) {
      throw new HttpError(400, 'Exactly one order is required for payment request.');
    }
    const targetId = targetOrderIds[0];
    const snap = orderMap.get(targetId);
    const data = { id: targetId, ...(snap.data() || {}) };

    if (String(data.paymentStatus || '').toLowerCase() === 'paid') {
      throw new HttpError(400, 'Order is already paid.');
    }

    const paymentRequest = buildPaymentRequest({ orderData: data, businessData });
    await snap.ref.update({
      paymentRequestStatus: 'sent',
      paymentRequestSentAt: FieldValue.serverTimestamp(),
      paymentRequestSentBy: owner.actorUid,
      paymentRequestSentByRole: owner.callerRole,
      paymentRequestAmount: paymentRequest.amount,
      paymentRequestLink: paymentRequest.upiLink,
      paymentRequestCount: FieldValue.increment(1),
      updatedAt: new Date(),
    });

    emitOrderEvent({
      eventType: 'order.payment_request.sent',
      businessId,
      orderId: targetId,
      data: {
        paymentRequestStatus: 'sent',
        paymentRequestAmount: paymentRequest.amount,
      },
    });

    return {
      payload: {
        message: 'Payment request prepared successfully.',
        orderId: targetId,
        upiLink: paymentRequest.upiLink,
        amount: paymentRequest.amount,
      },
      context: owner,
    };
  }

  if (action === 'mark_manual_paid') {
    ensurePermission(owner, PERMISSIONS.PROCESS_PAYMENT, 'Access denied: cannot confirm payments.');
    if (targetOrderIds.length !== 1) {
      throw new HttpError(400, 'Exactly one order is required to mark paid.');
    }

    const targetId = targetOrderIds[0];
    const snap = orderMap.get(targetId);
    const data = snap.data() || {};
    if (String(data.paymentStatus || '').toLowerCase() === 'paid') {
      throw new HttpError(400, 'Order is already marked as paid.');
    }

    const amount = normalizeMoney(data.totalAmount || data.amount || 0);
    await snap.ref.update({
      paymentStatus: 'paid',
      paymentMethod: 'upi_manual',
      paymentConfirmedVia: 'manual_upi',
      paymentConfirmedBy: owner.actorUid,
      paymentConfirmedAt: FieldValue.serverTimestamp(),
      paymentRequestStatus: 'completed',
      paidAmount: amount,
      paymentDetails: FieldValue.arrayUnion({
        method: 'upi_manual',
        amount,
        status: 'paid',
        confirmedBy: owner.actorUid,
        timestamp: new Date(),
      }),
      updatedAt: new Date(),
    });

    emitOrderEvent({
      eventType: 'order.payment.manual_paid',
      businessId,
      orderId: targetId,
      data: {
        paymentStatus: 'paid',
        paymentMethod: 'upi_manual',
      },
    });

    return {
      payload: {
        message: 'Order marked as paid successfully.',
        orderId: targetId,
      },
      context: owner,
    };
  }

  const batch = firestore.batch();
  const sideEffects = [];

  const markCashRefunded = toBool(body.isCashRefund, false) || action === 'markcashrefunded';
  const refundTargetIds = cashRefundOrderIds.length > 0 ? cashRefundOrderIds : targetOrderIds;
  if (markCashRefunded && refundTargetIds.length > 0) {
    ensurePermission(owner, PERMISSIONS.REFUND_ORDER, 'Access denied: cannot mark refunds.');
    refundTargetIds.forEach((idRaw) => {
      const id = String(idRaw || '').trim();
      const snap = orderMap.get(id);
      if (!snap) return;
      batch.update(snap.ref, {
        cashRefunded: true,
        cashRefundedAt: FieldValue.serverTimestamp(),
        updatedAt: new Date(),
      });
    });
  }

  const paymentStatus = String(body.paymentStatus || '').trim().toLowerCase();
  const paymentMethod = String(body.paymentMethod || '').trim().toLowerCase();
  if (paymentStatus && targetOrderIds.length > 0) {
    ensurePermission(owner, PERMISSIONS.PROCESS_PAYMENT, 'Access denied: cannot update payment status.');
    targetOrderIds.forEach((id) => {
      const snap = orderMap.get(id);
      if (!snap) return;
      const updateData = {
        paymentStatus,
        updatedAt: new Date(),
      };
      if (paymentMethod) updateData.paymentMethod = paymentMethod;
      batch.update(snap.ref, updateData);
    });
  }

  const newStatus = String(body.newStatus || '').trim().toLowerCase();
  const deliveryBoyId = String(body.deliveryBoyId || '').trim();
  const rejectionReason = String(body.rejectionReason || '').trim();
  const shouldRefund = body.shouldRefund !== false;

  if (newStatus) {
    if (!VALID_STATUSES.has(newStatus)) {
      throw new HttpError(400, 'Invalid status provided.');
    }

    const permission = deliveryBoyId ? PERMISSIONS.ASSIGN_RIDER : PERMISSIONS.UPDATE_ORDER_STATUS;
    ensurePermission(owner, permission, 'Access denied: cannot update order status.');

    for (const id of targetOrderIds) {
      const snap = orderMap.get(id);
      if (!snap) continue;
      const orderData = snap.data() || {};
      const currentStatus = String(orderData.status || '').toLowerCase();
      if (!canTransition(orderData, currentStatus, newStatus)) {
        throw new HttpError(400, `Invalid status transition for order ${id}: ${currentStatus} -> ${newStatus}.`);
      }

      const updateData = {
        status: newStatus,
        statusHistory: FieldValue.arrayUnion({
          status: newStatus,
          timestamp: new Date(),
          updatedBy: owner.actorUid,
          updatedByRole: owner.callerRole,
        }),
        updatedAt: new Date(),
      };

      if (newStatus === 'rejected' && rejectionReason) {
        updateData.rejectionReason = rejectionReason;
      }
      if (deliveryBoyId && (newStatus === 'ready_for_pickup' || newStatus === 'dispatched')) {
        updateData.deliveryBoyId = deliveryBoyId;
      }

      batch.update(snap.ref, updateData);
      sideEffects.push({
        id,
        riderId: deliveryBoyId || String(orderData.deliveryBoyId || '').trim(),
        status: newStatus,
        shouldRefund: shouldRefund && (newStatus === 'rejected' || newStatus === 'cancelled'),
      });
    }
  }

  await batch.commit();

  // Side effects are best-effort and must not fail the request.
  await Promise.allSettled(
    sideEffects.map(async (effect) => {
      const snap = orderMap.get(effect.id);
      const orderData = snap ? (snap.data() || {}) : {};

      emitOrderEvent({
        eventType: 'order.status.updated',
        businessId,
        riderId: effect.riderId,
        orderId: effect.id,
        data: {
          status: effect.status,
          customerPhone: resolveCustomerPhone(orderData) || null,
          customerName: resolveCustomerName(orderData),
        },
      });

      try {
        const trackingPath = `delivery_tracking/${effect.id}`;
        if (['delivered', 'rejected', 'cancelled', 'served', 'paid'].includes(effect.status)) {
          await database.ref(trackingPath).remove();
        } else {
          await database.ref(trackingPath).set({
            status: effect.status,
            updatedAt: Date.now(),
            token: orderData.trackingToken || orderData.sessionToken || null,
          });
        }
      } catch {
        // Non-blocking
      }
    })
  );

  return {
    payload: {
      message: 'Orders updated successfully.',
      processedCount: allIds.length,
    },
    context: owner,
  };
}

module.exports = {
  getOwnerOrders,
  updateOwnerOrders,
};
