const Razorpay = require('razorpay');
const { randomUUID } = require('crypto');
const { getFirestore, FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

function createRazorpayClient() {
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new HttpError(500, 'Payment gateway is not configured on the server.');
  }
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function toMoney(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

async function getSplitPaymentStatus(splitId) {
  const safeSplitId = String(splitId || '').trim();
  if (!safeSplitId) {
    throw new HttpError(400, 'Split session ID is required.');
  }

  const firestore = await getFirestore();
  const splitDoc = await firestore.collection('split_payments').doc(safeSplitId).get();
  if (!splitDoc.exists) {
    throw new HttpError(404, 'Split payment session not found.');
  }

  const data = splitDoc.data() || {};
  if (data.status === 'completed' && data.baseOrderId) {
    const orderDoc = await firestore.collection('orders').doc(data.baseOrderId).get();
    if (orderDoc.exists) {
      data.trackingToken = orderDoc.data()?.trackingToken || null;
    }
  }

  return data;
}

async function createSplitSession({
  razorpay,
  firestore,
  splitCount,
  baseOrderId,
  restaurantId,
  totalAmount,
  pendingItems,
  pendingSubtotal,
  pendingCgst,
  pendingSgst,
}) {
  const count = Number(splitCount || 0);
  if (!count || count < 2) {
    throw new HttpError(400, 'Split count must be at least 2.');
  }
  if (!baseOrderId || !restaurantId) {
    throw new HttpError(400, 'baseOrderId and restaurantId are required for split session.');
  }
  const amount = toMoney(totalAmount, 0);
  if (!amount || amount < 1) {
    throw new HttpError(400, 'A valid total amount is required for split session.');
  }

  const splitId = `split_${baseOrderId}`;
  const splitRef = firestore.collection('split_payments').doc(splitId);
  const amountPerSharePaise = Math.round((amount / count) * 100);
  const shares = [];

  for (let i = 0; i < count; i += 1) {
    const order = await razorpay.orders.create({
      amount: amountPerSharePaise,
      currency: 'INR',
      receipt: `share_${splitId}_${i}`,
      notes: {
        split_session_id: splitId,
        base_order_id: String(baseOrderId),
        share_number: String(i),
      },
    });

    shares.push({
      shareId: i,
      razorpay_order_id: order.id,
      amount: amountPerSharePaise / 100,
      status: 'pending',
    });
  }

  await splitRef.set({
    id: splitId,
    baseOrderId: String(baseOrderId),
    restaurantId: String(restaurantId),
    totalAmount: amount,
    splitCount: count,
    shares,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    isPublic: true,
    pendingItems: Array.isArray(pendingItems) ? pendingItems : [],
    pendingSubtotal: toMoney(pendingSubtotal, 0),
    pendingCgst: toMoney(pendingCgst, 0),
    pendingSgst: toMoney(pendingSgst, 0),
  });

  return { message: 'Split session created', splitId };
}

async function createPayRemainingOrder({ razorpay, firestore, splitSessionId }) {
  const safeSessionId = String(splitSessionId || '').trim();
  if (!safeSessionId) throw new HttpError(400, 'splitSessionId is required.');

  const splitRef = firestore.collection('split_payments').doc(safeSessionId);
  return firestore.runTransaction(async (tx) => {
    const splitDoc = await tx.get(splitRef);
    if (!splitDoc.exists) {
      throw new HttpError(404, 'Split session not found.');
    }
    const splitData = splitDoc.data() || {};
    const shares = Array.isArray(splitData.shares) ? splitData.shares : [];
    const pendingShares = shares.filter((share) => share.status !== 'paid');
    if (!pendingShares.length) {
      throw new HttpError(400, 'All shares are already paid.');
    }

    const remainingAmount = pendingShares.reduce((sum, share) => sum + toMoney(share.amount, 0), 0);
    if (remainingAmount <= 0) {
      throw new HttpError(400, 'Remaining amount must be greater than zero.');
    }

    const order = await razorpay.orders.create({
      amount: Math.round(remainingAmount * 100),
      currency: 'INR',
      receipt: `rem_${randomUUID().replace(/-/g, '').slice(0, 15)}`,
      notes: {
        split_session_id: safeSessionId,
        type: 'pay_remaining',
      },
    });

    return order;
  });
}

async function createSimplePaymentOrder({ razorpay, subtotal, totalAmount, notes }) {
  const amount = subtotal !== undefined ? toMoney(subtotal, 0) : toMoney(totalAmount, 0);
  if (!amount || amount < 1) {
    throw new HttpError(400, 'A valid amount is required for payment order.');
  }

  const splitSessionId = notes?.split_session_id ? String(notes.split_session_id) : null;
  const order = await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: `receipt_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
    notes: {
      ...(splitSessionId ? { split_session_id: splitSessionId } : {}),
    },
  });

  return order;
}

async function createPaymentOrder(body = {}) {
  const razorpay = createRazorpayClient();
  const firestore = await getFirestore();

  const grandTotal = toMoney(body.grandTotal, NaN);
  const totalAmount = Number.isFinite(grandTotal) ? grandTotal : toMoney(body.totalAmount, NaN);
  const subtotal = toMoney(body.subtotal, NaN);
  const splitCount = body.splitCount;
  const baseOrderId = body.baseOrderId;
  const restaurantId = body.restaurantId;
  const isPayRemaining = body.isPayRemaining === true;
  const splitSessionId = body.splitSessionId;

  if (splitCount && baseOrderId && restaurantId && Number.isFinite(totalAmount)) {
    return createSplitSession({
      razorpay,
      firestore,
      splitCount,
      baseOrderId,
      restaurantId,
      totalAmount,
      pendingItems: body.pendingItems,
      pendingSubtotal: body.pendingSubtotal,
      pendingCgst: body.pendingCgst,
      pendingSgst: body.pendingSgst,
    });
  }

  if (isPayRemaining && splitSessionId) {
    return createPayRemainingOrder({
      razorpay,
      firestore,
      splitSessionId,
    });
  }

  return createSimplePaymentOrder({
    razorpay,
    subtotal: Number.isFinite(subtotal) ? subtotal : undefined,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : undefined,
    notes: body.notes || {},
  });
}

module.exports = {
  createPaymentOrder,
  getSplitPaymentStatus,
};
