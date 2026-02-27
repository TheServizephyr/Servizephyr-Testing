const crypto = require('crypto');
const { getFirestore, FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { logger } = require('../lib/logger');

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

function toMoney(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return amount;
}

function toHexBuffer(value) {
  const safe = String(value || '').trim();
  if (!safe || safe.length % 2 !== 0 || /[^a-fA-F0-9]/.test(safe)) return null;
  return Buffer.from(safe, 'hex');
}

function timingSafeEqualHex(a, b) {
  const left = toHexBuffer(a);
  const right = toHexBuffer(b);
  if (!left || !right) return false;
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getExpectedAuthHash() {
  const username = String(process.env.PHONEPE_WEBHOOK_USERNAME || '').trim();
  const password = String(process.env.PHONEPE_WEBHOOK_PASSWORD || '').trim();
  if (!username || !password) return null;
  return crypto.createHash('sha256').update(`${username}:${password}`).digest('hex');
}

function verifyPhonePeWebhookAuth(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader) {
    throw new HttpError(401, 'Unauthorized');
  }

  const expectedHash = getExpectedAuthHash();
  if (!expectedHash) {
    throw new HttpError(500, 'PhonePe webhook credentials are not configured');
  }

  const receivedHash = authHeader.replace(/^SHA256\s+/i, '').trim();
  const isValid = timingSafeEqualHex(receivedHash, expectedHash);
  if (!isValid) {
    throw new HttpError(401, 'Unauthorized');
  }
}

async function handleAddonPaymentCompleted({ firestore, merchantOrderId, payload }) {
  const addonRef = firestore.collection('phonepe_pending_addons').doc(merchantOrderId);
  const addonDoc = await addonRef.get();
  if (!addonDoc.exists) {
    logger.warn({ merchantOrderId }, 'PhonePe add-on metadata missing');
    return;
  }

  const addonData = addonDoc.data() || {};
  const originalOrderId = String(addonData.orderId || '').trim();
  if (!originalOrderId) {
    logger.warn({ merchantOrderId }, 'PhonePe add-on metadata missing original order id');
    return;
  }

  const orderRef = firestore.collection('orders').doc(originalOrderId);

  await firestore.runTransaction(async (tx) => {
    const orderDoc = await tx.get(orderRef);
    if (!orderDoc.exists) {
      throw new HttpError(404, `Original order ${originalOrderId} not found`);
    }

    const orderData = orderDoc.data() || {};
    const now = new Date();

    const existingItems = Array.isArray(orderData.items) ? orderData.items : [];
    const addonItems = Array.isArray(addonData.items) ? addonData.items : [];
    const existingItemsWithTimestamp = existingItems.map((item) => ({
      ...item,
      addedAt: item.addedAt || orderData.orderDate?.toDate?.() || new Date(orderData.orderDate || now),
      isAddon: item.isAddon || false,
    }));
    const addonItemsWithTimestamp = addonItems.map((item) => ({
      ...item,
      addedAt: now,
      isAddon: true,
    }));

    tx.update(orderRef, {
      items: [...existingItemsWithTimestamp, ...addonItemsWithTimestamp],
      subtotal: toMoney(orderData.subtotal, 0) + toMoney(addonData.subtotal, 0),
      cgst: toMoney(orderData.cgst, 0) + toMoney(addonData.cgst, 0),
      sgst: toMoney(orderData.sgst, 0) + toMoney(addonData.sgst, 0),
      totalAmount: toMoney(orderData.totalAmount, 0) + toMoney(addonData.grandTotal, 0),
      paymentDetails: FieldValue.arrayUnion({
        method: 'phonepe',
        amount: toMoney(payload?.amount, 0) / 100,
        phonePeOrderId: payload?.orderId || null,
        phonePeTransactionId: payload?.paymentDetails?.[0]?.transactionId || null,
        status: 'paid',
        timestamp: now,
        isAddon: true,
      }),
      statusHistory: FieldValue.arrayUnion({
        status: 'updated',
        timestamp: now,
        notes: `Added ${addonItems.length} item(s) via PhonePe add-on payment`,
      }),
      updatedAt: now,
    });

    tx.update(addonRef, {
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function handleOrderCompleted(payload) {
  const firestore = await getFirestore();
  const merchantOrderId = String(payload?.merchantOrderId || '').trim();
  if (!merchantOrderId) return;

  if (merchantOrderId.startsWith('addon_')) {
    await handleAddonPaymentCompleted({ firestore, merchantOrderId, payload });
    return;
  }

  const orderRef = firestore.collection('orders').doc(merchantOrderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) {
    logger.warn({ merchantOrderId }, 'PhonePe completed event received but order not found');
    return;
  }

  const orderData = orderDoc.data() || {};
  const currentStatus = String(orderData.status || '').toLowerCase();
  const updateData = {
    paymentStatus: 'paid',
    paymentMethod: 'phonepe',
    phonePeOrderId: payload?.orderId || null,
    phonePeTransactionId: payload?.paymentDetails?.[0]?.transactionId || null,
    phonePePaymentMode: payload?.paymentDetails?.[0]?.paymentMode || null,
    paidAmount: toMoney(payload?.amount, 0) / 100,
    paymentDetails: FieldValue.arrayUnion({
      method: 'phonepe',
      amount: toMoney(payload?.amount, 0) / 100,
      phonePeOrderId: payload?.orderId || null,
      phonePeTransactionId: payload?.paymentDetails?.[0]?.transactionId || null,
      status: 'paid',
      timestamp: new Date(),
    }),
    updatedAt: new Date(),
  };

  if (!FORWARD_ONLY_STATUSES.has(currentStatus)) {
    updateData.status = 'pending';
  }

  await orderRef.update(updateData);
}

async function handleOrderFailed(payload) {
  const firestore = await getFirestore();
  const merchantOrderId = String(payload?.merchantOrderId || '').trim();
  if (!merchantOrderId) return;

  const orderRef = firestore.collection('orders').doc(merchantOrderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) return;

  await orderRef.update({
    paymentStatus: 'failed',
    paymentMethod: 'phonepe',
    phonePeOrderId: payload?.orderId || null,
    paymentFailureReason: payload?.errorCode || 'Unknown error',
    paymentFailureDetails: payload?.detailedErrorCode || '',
    updatedAt: new Date(),
  });
}

async function handleRefundCompleted(payload) {
  const firestore = await getFirestore();
  const merchantOrderId = String(payload?.originalMerchantOrderId || '').trim();
  if (!merchantOrderId) return;

  const orderRef = firestore.collection('orders').doc(merchantOrderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) return;

  await orderRef.update({
    refundStatus: 'completed',
    phonePeRefundId: payload?.refundId || null,
    refundedAmount: toMoney(payload?.amount, 0) / 100,
    refundCompletedAt: payload?.timestamp ? new Date(payload.timestamp) : new Date(),
    updatedAt: new Date(),
  });
}

async function handleRefundFailed(payload) {
  const firestore = await getFirestore();
  const merchantOrderId = String(payload?.originalMerchantOrderId || '').trim();
  if (!merchantOrderId) return;

  const orderRef = firestore.collection('orders').doc(merchantOrderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) return;

  await orderRef.update({
    refundStatus: 'failed',
    phonePeRefundId: payload?.refundId || null,
    refundFailureReason: payload?.errorCode || 'Unknown error',
    refundFailureDetails: payload?.detailedErrorCode || '',
    updatedAt: new Date(),
  });
}

async function processPhonePeWebhook({ req, body }) {
  verifyPhonePeWebhookAuth(req);

  const event = String(body?.event || '').trim();
  const payload = body?.payload;
  if (!event || !payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Invalid payload');
  }

  switch (event) {
    case 'checkout.order.completed':
      await handleOrderCompleted(payload);
      break;
    case 'checkout.order.failed':
      await handleOrderFailed(payload);
      break;
    case 'pg.refund.completed':
      await handleRefundCompleted(payload);
      break;
    case 'pg.refund.failed':
      await handleRefundFailed(payload);
      break;
    default:
      logger.warn({ event }, 'Unhandled PhonePe webhook event');
      break;
  }

  return { success: true, message: 'Webhook processed' };
}

module.exports = {
  processPhonePeWebhook,
};
