const crypto = require('crypto');
const Razorpay = require('razorpay');
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
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
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

function parseJsonSafe(text, fallback = null) {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function parseMaybeJson(value, fallback) {
  if (typeof value !== 'string') return value === undefined ? fallback : value;
  const parsed = parseJsonSafe(value, undefined);
  return parsed === undefined ? fallback : parsed;
}

function normalizePaymentDetails(existing) {
  if (Array.isArray(existing)) {
    return existing.filter((item) => item && typeof item === 'object');
  }
  if (existing && typeof existing === 'object') return [existing];
  return [];
}

function paymentKey(payment = {}) {
  return [
    String(payment.razorpay_payment_id || ''),
    String(payment.razorpay_order_id || ''),
    String(payment.split_share_index ?? ''),
    String(payment.notes || ''),
  ].join('|');
}

function appendUniquePayments(existing, additions) {
  const base = normalizePaymentDetails(existing);
  const seen = new Set(base.map(paymentKey));
  for (const payment of additions) {
    const key = paymentKey(payment);
    if (seen.has(key)) continue;
    base.push(payment);
    seen.add(key);
  }
  return base;
}

function normalizeStatusHistory(existing) {
  if (!Array.isArray(existing)) return [];
  return existing.filter((item) => item && typeof item === 'object');
}

function appendStatusHistory(existing, nextEntry) {
  const base = normalizeStatusHistory(existing);
  base.push(nextEntry);
  if (base.length > 80) {
    return base.slice(base.length - 80);
  }
  return base;
}

function extractBodyBuffer(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  return Buffer.from('');
}

function verifyWebhookSignature({ secret, signature, bodyBuffer }) {
  if (!secret) {
    throw new HttpError(500, 'RAZORPAY_WEBHOOK_SECRET is not configured');
  }
  if (!signature) {
    throw new HttpError(401, 'Razorpay signature is missing');
  }

  const digest = crypto.createHmac('sha256', secret).update(bodyBuffer).digest('hex');
  const valid = timingSafeEqualHex(digest, signature);
  if (!valid) {
    throw new HttpError(403, 'Invalid Razorpay signature');
  }
}

function createRazorpayClientIfAvailable() {
  const keyId = String(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (!keyId || !keySecret) return null;
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function extractNotesOrderId(notes = {}) {
  const candidates = [
    notes.orderId,
    notes.order_id,
    notes.firestore_order_id,
    notes.firestoreOrderId,
    notes.baseOrderId,
    notes.base_order_id,
    notes.receipt,
  ];
  for (const candidate of candidates) {
    const safe = String(candidate || '').trim();
    if (safe) return safe;
  }
  return '';
}

function normalizeCapturedPayment(paymentEntity, amountInRupees, extra = {}) {
  return {
    method: 'razorpay',
    amount: amountInRupees,
    razorpay_payment_id: paymentEntity.id || null,
    razorpay_order_id: paymentEntity.order_id || null,
    status: 'paid',
    timestamp: new Date(),
    ...extra,
  };
}

function normalizeOrderUpdateStatus(currentStatus) {
  const normalized = String(currentStatus || '').toLowerCase();
  if (FORWARD_ONLY_STATUSES.has(normalized)) return null;
  return 'pending';
}

async function resolveOrderIdFromRazorpayOrder(razorpayOrderId) {
  const safeOrderId = String(razorpayOrderId || '').trim();
  if (!safeOrderId) return '';
  const client = createRazorpayClientIfAvailable();
  if (!client) return '';

  try {
    const order = await client.orders.fetch(safeOrderId);
    const receipt = String(order?.receipt || '').trim();
    if (receipt) return receipt;
  } catch (error) {
    logger.warn(
      {
        razorpayOrderId: safeOrderId,
        err: error?.message || String(error),
      },
      'Failed to fetch Razorpay order details while resolving receipt'
    );
  }
  return '';
}

async function processSplitPaymentCaptured({ firestore, paymentEntity, paymentId }) {
  const notes = paymentEntity.notes || {};
  const splitId = String(notes.split_session_id || '').trim();
  if (!splitId) return { handled: false };

  const splitRef = firestore.collection('split_payments').doc(splitId);
  const processedRef = firestore.collection('processed_payments').doc(paymentId);

  const result = await firestore.runTransaction(async (tx) => {
    const processedSnap = await tx.get(processedRef);
    if (processedSnap.exists) {
      return { handled: true, duplicate: true, splitId };
    }

    const splitSnap = await tx.get(splitRef);
    if (!splitSnap.exists) {
      tx.set(processedRef, {
        type: 'split',
        status: 'split_not_found',
        splitId,
        paymentId,
        processedAt: FieldValue.serverTimestamp(),
      });
      return { handled: true, splitId, splitMissing: true };
    }

    const splitData = splitSnap.data() || {};
    const shares = Array.isArray(splitData.shares) ? splitData.shares : [];
    const isPayRemaining = String(notes.type || '').trim() === 'pay_remaining';

    const shareIndicesToUpdate = [];
    if (isPayRemaining) {
      shares.forEach((share, index) => {
        if (String(share?.status || '').toLowerCase() !== 'paid') {
          shareIndicesToUpdate.push(index);
        }
      });
    } else {
      const expectedOrderId = String(paymentEntity.order_id || '').trim();
      const shareIndex = shares.findIndex(
        (share) => String(share?.razorpay_order_id || '').trim() === expectedOrderId
      );
      if (shareIndex >= 0) shareIndicesToUpdate.push(shareIndex);
    }

    if (shareIndicesToUpdate.length === 0) {
      tx.set(processedRef, {
        type: 'split',
        status: 'no_matching_share',
        splitId,
        paymentId,
        razorpayOrderId: paymentEntity.order_id || null,
        processedAt: FieldValue.serverTimestamp(),
      });
      return { handled: true, splitId, noMatch: true };
    }

    const amountInRupees = toMoney(paymentEntity.amount, 0) / 100;
    shareIndicesToUpdate.forEach((index) => {
      shares[index] = {
        ...shares[index],
        status: 'paid',
        razorpay_payment_id: paymentEntity.id || null,
      };
    });

    const paidShares = shares.filter(
      (share) => String(share?.status || '').toLowerCase() === 'paid'
    );
    const splitCount = Number(splitData.splitCount || shares.length || 0);
    const fullyPaid = splitCount > 0 && paidShares.length >= splitCount;

    const splitUpdate = {
      shares,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (fullyPaid) {
      splitUpdate.status = 'completed';
      splitUpdate.completedAt = FieldValue.serverTimestamp();
    }
    tx.update(splitRef, splitUpdate);

    const baseOrderId = String(splitData.baseOrderId || '').trim();
    if (baseOrderId) {
      const baseOrderRef = firestore.collection('orders').doc(baseOrderId);
      const baseOrderSnap = await tx.get(baseOrderRef);
      if (baseOrderSnap.exists) {
        const baseOrderData = baseOrderSnap.data() || {};
        const paymentEntries = shareIndicesToUpdate.map((index) =>
          normalizeCapturedPayment(paymentEntity, toMoney(shares[index]?.amount, amountInRupees), {
            split_share_index: index,
            payer_name: shares[index]?.name || `Person ${index + 1}`,
          })
        );

        const baseUpdate = {
          paymentMethod: 'razorpay',
          updatedAt: new Date(),
          paymentDetails: appendUniquePayments(baseOrderData.paymentDetails, paymentEntries),
        };

        if (fullyPaid) {
          baseUpdate.paymentStatus = 'paid';
          const nextStatus = normalizeOrderUpdateStatus(baseOrderData.status);
          if (nextStatus) baseUpdate.status = nextStatus;
        }

        if (
          fullyPaid &&
          Array.isArray(splitData.pendingItems) &&
          splitData.pendingItems.length > 0
        ) {
          const currentItems = Array.isArray(baseOrderData.items) ? baseOrderData.items : [];
          const pendingSubtotal = toMoney(splitData.pendingSubtotal, 0);
          const pendingCgst = toMoney(splitData.pendingCgst, 0);
          const pendingSgst = toMoney(splitData.pendingSgst, 0);
          baseUpdate.items = [...currentItems, ...splitData.pendingItems];
          baseUpdate.subtotal = toMoney(baseOrderData.subtotal, 0) + pendingSubtotal;
          baseUpdate.cgst = toMoney(baseOrderData.cgst, 0) + pendingCgst;
          baseUpdate.sgst = toMoney(baseOrderData.sgst, 0) + pendingSgst;
          baseUpdate.totalAmount =
            toMoney(baseOrderData.totalAmount, 0) + pendingSubtotal + pendingCgst + pendingSgst;
          baseUpdate.statusHistory = appendStatusHistory(baseOrderData.statusHistory, {
            status: 'updated',
            timestamp: new Date(),
            notes: `Added ${splitData.pendingItems.length} item(s) via split payment`,
          });
        }

        tx.update(baseOrderRef, baseUpdate);
      }
    }

    tx.set(processedRef, {
      type: 'split',
      status: fullyPaid ? 'completed' : 'partial',
      splitId,
      paymentId,
      razorpayOrderId: paymentEntity.order_id || null,
      baseOrderId: splitData.baseOrderId || null,
      processedAt: FieldValue.serverTimestamp(),
    });

    return { handled: true, splitId, fullyPaid };
  });

  return result;
}

async function processAddonPaymentCaptured({ firestore, paymentEntity, paymentId }) {
  const notes = paymentEntity.notes || {};
  if (String(notes.type || '').trim() !== 'addon') {
    return { handled: false };
  }

  const orderId = extractNotesOrderId(notes);
  if (!orderId) return { handled: true, skipped: true, reason: 'missing_order_id' };

  const processedRef = firestore.collection('processed_payments').doc(paymentId);
  const orderRef = firestore.collection('orders').doc(orderId);

  const result = await firestore.runTransaction(async (tx) => {
    const processedSnap = await tx.get(processedRef);
    if (processedSnap.exists) {
      return { handled: true, duplicate: true, orderId };
    }

    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      tx.set(processedRef, {
        type: 'addon',
        status: 'order_not_found',
        orderId,
        paymentId,
        processedAt: FieldValue.serverTimestamp(),
      });
      return { handled: true, orderMissing: true, orderId };
    }

    const orderData = orderSnap.data() || {};
    const existingItems = Array.isArray(orderData.items) ? orderData.items : [];
    const itemsToAddRaw = parseMaybeJson(notes.items, []);
    const itemsToAdd = Array.isArray(itemsToAddRaw) ? itemsToAddRaw : [];

    const paymentDetail = normalizeCapturedPayment(
      paymentEntity,
      toMoney(paymentEntity.amount, 0) / 100,
      { notes: 'Add-on payment' }
    );

    const orderUpdate = {
      items: [...existingItems, ...itemsToAdd],
      subtotal: toMoney(orderData.subtotal, 0) + toMoney(notes.subtotal, 0),
      cgst: toMoney(orderData.cgst, 0) + toMoney(notes.cgst, 0),
      sgst: toMoney(orderData.sgst, 0) + toMoney(notes.sgst, 0),
      totalAmount: toMoney(orderData.totalAmount, 0) + toMoney(notes.grandTotal, 0),
      paymentMethod: 'razorpay',
      paymentDetails: appendUniquePayments(orderData.paymentDetails, [paymentDetail]),
      statusHistory: appendStatusHistory(orderData.statusHistory, {
        status: 'updated',
        timestamp: new Date(),
        notes: `Added ${itemsToAdd.length} item(s) via online add-on`,
      }),
      updatedAt: new Date(),
    };
    tx.update(orderRef, orderUpdate);

    tx.set(processedRef, {
      type: 'addon',
      status: 'processed',
      orderId,
      paymentId,
      razorpayOrderId: paymentEntity.order_id || null,
      processedAt: FieldValue.serverTimestamp(),
    });

    return { handled: true, orderId };
  });

  return result;
}

async function resolveOrderIdForPayment(paymentEntity) {
  const notesOrderId = extractNotesOrderId(paymentEntity.notes || {});
  if (notesOrderId) return notesOrderId;
  return resolveOrderIdFromRazorpayOrder(paymentEntity.order_id);
}

async function processRegularPaymentCaptured({ firestore, paymentEntity, paymentId }) {
  const orderId = await resolveOrderIdForPayment(paymentEntity);
  if (!orderId) {
    logger.warn(
      {
        paymentId,
        razorpayOrderId: paymentEntity.order_id || null,
      },
      'Razorpay captured payment could not be linked to any order'
    );
    return { handled: true, unlinked: true };
  }

  const processedRef = firestore.collection('processed_payments').doc(paymentId);
  const orderRef = firestore.collection('orders').doc(orderId);

  const result = await firestore.runTransaction(async (tx) => {
    const processedSnap = await tx.get(processedRef);
    if (processedSnap.exists) {
      return { handled: true, duplicate: true, orderId };
    }

    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      tx.set(processedRef, {
        type: 'payment',
        status: 'order_not_found',
        orderId,
        paymentId,
        processedAt: FieldValue.serverTimestamp(),
      });
      return { handled: true, orderMissing: true, orderId };
    }

    const orderData = orderSnap.data() || {};
    const paymentAmount = toMoney(paymentEntity.amount, 0) / 100;
    const paymentDetail = normalizeCapturedPayment(paymentEntity, paymentAmount);

    const updateData = {
      paymentMethod: 'razorpay',
      paymentStatus: 'paid',
      paidAmount: paymentAmount,
      paymentDetails: appendUniquePayments(orderData.paymentDetails, [paymentDetail]),
      updatedAt: new Date(),
    };

    const nextStatus = normalizeOrderUpdateStatus(orderData.status);
    if (nextStatus) {
      updateData.status = nextStatus;
    }

    tx.update(orderRef, updateData);

    tx.set(processedRef, {
      type: 'payment',
      status: 'processed',
      orderId,
      paymentId,
      razorpayOrderId: paymentEntity.order_id || null,
      processedAt: FieldValue.serverTimestamp(),
    });

    return { handled: true, orderId };
  });

  return result;
}

async function processPaymentCaptured({ firestore, payload }) {
  const paymentEntity = payload?.payment?.entity;
  if (!paymentEntity || typeof paymentEntity !== 'object') {
    return { status: 'ignored', reason: 'missing_payment_entity' };
  }

  const paymentId = String(paymentEntity.id || '').trim();
  if (!paymentId) {
    return { status: 'ignored', reason: 'missing_payment_id' };
  }

  const splitResult = await processSplitPaymentCaptured({
    firestore,
    paymentEntity,
    paymentId,
  });
  if (splitResult.handled) return { status: 'processed', mode: 'split', ...splitResult };

  const addonResult = await processAddonPaymentCaptured({
    firestore,
    paymentEntity,
    paymentId,
  });
  if (addonResult.handled) return { status: 'processed', mode: 'addon', ...addonResult };

  const regularResult = await processRegularPaymentCaptured({
    firestore,
    paymentEntity,
    paymentId,
  });
  return { status: 'processed', mode: 'regular', ...regularResult };
}

async function processPaymentFailed({ firestore, payload }) {
  const paymentEntity = payload?.payment?.entity;
  if (!paymentEntity || typeof paymentEntity !== 'object') {
    return { status: 'ignored', reason: 'missing_payment_entity' };
  }

  const orderId = await resolveOrderIdForPayment(paymentEntity);
  if (!orderId) return { status: 'ignored', reason: 'unlinked_order' };

  const orderRef = firestore.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return { status: 'ignored', reason: 'order_not_found' };

  await orderRef.update({
    paymentMethod: 'razorpay',
    paymentStatus: 'failed',
    paymentFailureReason:
      paymentEntity?.error_description ||
      paymentEntity?.error_reason ||
      paymentEntity?.error_code ||
      'Payment failed',
    updatedAt: new Date(),
  });

  return { status: 'processed', orderId };
}

async function processRazorpayWebhook(req) {
  const bodyBuffer = extractBodyBuffer(req);
  const signature = String(req.headers['x-razorpay-signature'] || '').trim();
  const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  verifyWebhookSignature({ secret, signature, bodyBuffer });

  const rawText = bodyBuffer.toString('utf8');
  const eventData = parseJsonSafe(rawText, null);
  if (!eventData || typeof eventData !== 'object') {
    throw new HttpError(400, 'Invalid Razorpay webhook payload');
  }

  const event = String(eventData.event || '').trim();
  if (!event) {
    throw new HttpError(400, 'Missing Razorpay webhook event type');
  }

  const firestore = await getFirestore();
  let result = { status: 'ignored', reason: 'event_not_supported' };

  switch (event) {
    case 'payment.captured':
      result = await processPaymentCaptured({
        firestore,
        payload: eventData.payload || {},
      });
      break;
    case 'payment.failed':
      result = await processPaymentFailed({
        firestore,
        payload: eventData.payload || {},
      });
      break;
    default:
      result = { status: 'ignored', reason: 'event_not_supported', event };
      break;
  }

  logger.info(
    {
      event,
      result,
    },
    'Razorpay webhook processed'
  );

  return {
    status: 'ok',
    event,
    result,
  };
}

module.exports = {
  processRazorpayWebhook,
};
