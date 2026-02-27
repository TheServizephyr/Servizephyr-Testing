const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

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

function normalizeDate(value, fallback) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

async function getOwnerDineInHistory(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_DINE_IN_ORDERS, PERMISSIONS.MANAGE_DINE_IN],
  });

  const startDate = req.query.startDate
    ? startOfDay(normalizeDate(req.query.startDate, new Date()))
    : startOfDay(new Date());
  const endDate = req.query.endDate
    ? endOfDay(normalizeDate(req.query.endDate, new Date()))
    : endOfDay(new Date());

  let docs = [];
  try {
    const snap = await owner.firestore
      .collection('orders')
      .where('restaurantId', '==', owner.businessId)
      .where('deliveryType', '==', 'dine-in')
      .where('orderDate', '>=', startDate)
      .where('orderDate', '<=', endDate)
      .orderBy('orderDate', 'desc')
      .get();
    docs = snap.docs;
  } catch {
    const fallback = await owner.firestore
      .collection('orders')
      .where('restaurantId', '==', owner.businessId)
      .where('deliveryType', '==', 'dine-in')
      .get();
    docs = fallback.docs
      .filter((doc) => {
        const orderDate = doc.data()?.orderDate?.toDate?.() || new Date(doc.data()?.orderDate || 0);
        return orderDate >= startDate && orderDate <= endDate;
      })
      .sort((a, b) => {
        const at = a.data()?.orderDate?.toMillis?.() || 0;
        const bt = b.data()?.orderDate?.toMillis?.() || 0;
        return bt - at;
      });
  }

  const completedOrders = [];
  const cancelledOrders = [];

  docs.forEach((doc) => {
    const orderData = { id: doc.id, ...(doc.data() || {}) };
    const status = String(orderData.status || '').toLowerCase();

    if (status === 'cancelled' || status === 'rejected') {
      cancelledOrders.push(orderData);
      return;
    }
    if (orderData.cleaned === true) {
      completedOrders.push(orderData);
      return;
    }
    if (status === 'delivered' && String(orderData.paymentStatus || '').toLowerCase() === 'paid') {
      completedOrders.push(orderData);
    }
  });

  return {
    completedOrders,
    cancelledOrders,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    totalCompleted: completedOrders.length,
    totalCancelled: cancelledOrders.length,
  };
}

async function postOwnerDineInHistoryUndo(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN, PERMISSIONS.UPDATE_ORDER_STATUS],
  });

  const orderId = String(body.orderId || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  if (!orderId || !action) {
    throw new HttpError(400, 'Missing orderId or action');
  }

  const orderRef = owner.firestore.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpError(404, 'Order not found');
  }

  const orderData = orderSnap.data() || {};
  if (String(orderData.restaurantId || '') !== owner.businessId) {
    throw new HttpError(403, 'Unauthorized');
  }

  if (action === 'uncleaned') {
    await orderRef.update({
      cleaned: false,
      cleanedAt: null,
    });
    return {
      success: true,
      message: 'Order uncleaned - returned to dashboard',
    };
  }

  if (action === 'uncancel') {
    await orderRef.update({
      status: 'confirmed',
      rejectionReason: null,
      cancelledAt: null,
    });
    return {
      success: true,
      message: 'Order restored to confirmed status',
    };
  }

  throw new HttpError(400, 'Invalid action');
}

module.exports = {
  getOwnerDineInHistory,
  postOwnerDineInHistoryUndo,
};
