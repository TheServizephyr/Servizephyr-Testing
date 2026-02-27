const Razorpay = require('razorpay');
const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveRazorpayInstance() {
  const keyId = String(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (!keyId || !keySecret) {
    throw new HttpError(500, 'Payment gateway not configured');
  }
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function calculateAlreadyRefundedFromItems(orderData) {
  const refundedItemIds = Array.isArray(orderData?.refundedItems) ? orderData.refundedItems : [];
  if (refundedItemIds.length === 0) {
    return toNumber(orderData?.refundAmount, 0);
  }

  const orderItems = Array.isArray(orderData?.items) ? orderData.items : [];
  let total = 0;
  refundedItemIds.forEach((itemId) => {
    const item = orderItems.find((entry) => (entry?.id || entry?.name) === itemId);
    if (!item) return;
    const price = toNumber(item.totalPrice ?? item.price, 0);
    const qty = Math.max(1, parseInt(item.quantity || item.qty || 1, 10));
    total += price * qty;
  });
  return total;
}

function calculatePartialItemsAmount(orderData, itemIds) {
  const orderItems = Array.isArray(orderData?.items) ? orderData.items : [];
  let itemsTotal = 0;
  itemIds.forEach((itemId) => {
    const item = orderItems.find((entry) => entry?.id === itemId || entry?.name === itemId);
    if (!item) return;
    const itemPrice = toNumber(item.totalPrice ?? item.price, 0);
    const itemQty = Math.max(1, parseInt(item.quantity || item.qty || 1, 10));
    itemsTotal += itemPrice * itemQty;
  });

  const subtotal = toNumber(orderData?.subtotal ?? orderData?.totalAmount, 0);
  const taxAmount = toNumber(orderData?.totalAmount, 0) - subtotal;
  const taxRatio = subtotal > 0 ? taxAmount / subtotal : 0;
  return itemsTotal + (itemsTotal * taxRatio);
}

async function postOwnerRefund(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.REFUND_ORDER, PERMISSIONS.VIEW_PAYMENTS],
  });

  const orderId = String(body.orderId || '').trim();
  const refundType = String(body.refundType || '').trim().toLowerCase();
  const items = Array.isArray(body.items) ? body.items : [];
  const reason = String(body.reason || '').trim();
  const notes = String(body.notes || '').trim();

  if (!orderId || !refundType || !reason) {
    throw new HttpError(400, 'Missing required fields: orderId, refundType, reason');
  }
  if (refundType === 'partial' && items.length === 0) {
    throw new HttpError(400, 'Items array required for partial refund');
  }

  const orderRef = owner.firestore.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpError(404, 'Order not found');
  }

  const orderData = orderSnap.data() || {};
  if (String(orderData.restaurantId || '').trim() !== owner.businessId) {
    throw new HttpError(403, 'Access denied: Order does not belong to this business');
  }

  if (String(orderData.refundStatus || '').toLowerCase() === 'completed') {
    throw new HttpError(400, 'Order has already been fully refunded');
  }

  const validStatuses = new Set(['completed', 'delivered', 'cancelled']);
  if (!validStatuses.has(String(orderData.status || '').toLowerCase())) {
    throw new HttpError(
      400,
      `Cannot refund order with status: ${orderData.status}. Order must be completed, delivered, or cancelled.`
    );
  }

  const orderDate = toDate(orderData.orderDate);
  if (orderDate) {
    const daysSinceOrder = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceOrder > 7) {
      throw new HttpError(400, 'Refund period expired. Refunds are only allowed within 7 days of order.');
    }
  }

  const paymentDetails = Array.isArray(orderData.paymentDetails) ? orderData.paymentDetails : [];
  if (paymentDetails.length === 0) {
    throw new HttpError(400, 'No payment information found for this order');
  }

  const razorpayPayments = paymentDetails.filter((payment) => (
    payment?.method === 'razorpay' && payment?.razorpay_payment_id
  ));
  if (razorpayPayments.length === 0) {
    throw new HttpError(400, 'No Razorpay payment found. Only online payments can be refunded.');
  }

  const onlinePaymentAmount = razorpayPayments.reduce((sum, payment) => sum + toNumber(payment.amount, 0), 0);
  const actuallyAlreadyRefunded = calculateAlreadyRefundedFromItems(orderData);

  let refundAmount = 0;
  if (refundType === 'full') {
    refundAmount = Math.max(0, onlinePaymentAmount - actuallyAlreadyRefunded);
  } else if (refundType === 'partial') {
    const partialWithTax = calculatePartialItemsAmount(orderData, items);
    refundAmount = Math.min(partialWithTax, onlinePaymentAmount);
  } else {
    throw new HttpError(400, 'refundType must be full or partial');
  }

  if (refundAmount <= 0) {
    throw new HttpError(400, 'Invalid refund amount calculated');
  }

  const maxRefundable = onlinePaymentAmount - actuallyAlreadyRefunded;
  if (refundAmount > maxRefundable) {
    throw new HttpError(
      400,
      `Refund amount (Rs ${refundAmount.toFixed(2)}) exceeds remaining refundable amount (Rs ${maxRefundable.toFixed(2)})`
    );
  }

  const razorpay = resolveRazorpayInstance();
  let remainingRefund = refundAmount;
  const refundResults = [];

  for (const payment of razorpayPayments) {
    if (remainingRefund <= 0) break;

    const refundForThisPayment = Math.min(toNumber(payment.amount, 0), remainingRefund);
    try {
      const refundData = await razorpay.payments.refund(payment.razorpay_payment_id, {
        amount: Math.round(refundForThisPayment * 100),
        speed: 'normal',
        notes: {
          orderId,
          reason,
          refundType,
          notes: notes || '',
          splitPayment: razorpayPayments.length > 1,
        },
      });

      refundResults.push({
        paymentId: payment.razorpay_payment_id,
        refundId: refundData.id,
        amount: refundForThisPayment,
        status: refundData.status,
        created_at: refundData.created_at,
      });
      remainingRefund -= refundForThisPayment;
    } catch {
      // Try remaining payments even if one attempt fails.
    }
  }

  if (refundResults.length === 0) {
    throw new HttpError(500, 'All refund attempts failed. Please try again or contact support.');
  }

  const totalRefundedFromRazorpay = refundResults.reduce((sum, entry) => sum + toNumber(entry.amount, 0), 0);
  const totalRefunded = actuallyAlreadyRefunded + totalRefundedFromRazorpay;
  const isFullyRefunded = totalRefunded >= toNumber(orderData.totalAmount, 0);

  const updateData = {
    refundStatus: isFullyRefunded ? 'completed' : 'partial',
    refundAmount: totalRefunded,
    refundReason: reason,
    refundDate: FieldValue.serverTimestamp(),
    refundIds: refundResults.map((result) => result.refundId),
    partiallyRefunded: !isFullyRefunded,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (refundType === 'partial' && items.length > 0) {
    updateData.refundedItems = FieldValue.arrayUnion(...items);
  }

  await orderRef.update(updateData);

  for (const result of refundResults) {
    await owner.firestore.collection('refunds').doc(result.refundId).set({
      refundId: result.refundId,
      orderId,
      paymentId: result.paymentId,
      amount: result.amount,
      currency: 'INR',
      status: result.status,
      refundType,
      reason,
      notes: notes || '',
      vendorId: owner.businessId,
      customerId: orderData.customerId || orderData.userId || null,
      items: refundType === 'partial' ? items : [],
      createdAt: FieldValue.serverTimestamp(),
      processedAt: result.created_at ? new Date(result.created_at * 1000) : FieldValue.serverTimestamp(),
    });
  }

  return {
    success: true,
    message: `Refund of Rs ${totalRefundedFromRazorpay.toFixed(2)} processed successfully`,
    refundIds: refundResults.map((result) => result.refundId),
    amount: totalRefundedFromRazorpay,
    status: refundResults[0].status,
    expectedCreditDays: '5-7 working days',
  };
}

module.exports = {
  postOwnerRefund,
};
