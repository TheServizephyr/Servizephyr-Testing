const { FieldValue, getFirestore, verifyIdToken } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { getPhonePeAccessToken } = require('./phonepe.service');

const PHONEPE_BASE_URL = String(process.env.PHONEPE_BASE_URL || '').trim().replace(/\/+$/, '');

function extractBearer(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Authorization token missing or malformed.');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError(401, 'Authorization token missing or malformed.');
  }
  return token;
}

async function verifyAdmin(req, firestore) {
  const token = extractBearer(req);
  let decoded;
  try {
    decoded = await verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, 'Token verification failed.');
  }

  const uid = String(decoded?.uid || '').trim();
  if (!uid) throw new HttpError(401, 'Invalid token.');

  const userDoc = await firestore.collection('users').doc(uid).get();
  const role = String(userDoc.data()?.role || '').trim().toLowerCase();
  if (role !== 'admin') {
    throw new HttpError(403, 'Admin access required.');
  }
  return { uid };
}

function toAmountInPaise(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Order ID and valid amount are required.');
  }
  return Math.round(amount * 100);
}

function parsePhonePeError(payload, fallback) {
  return payload?.message || payload?.error?.message || payload?.code || fallback;
}

async function createPhonePeRefund(req, body = {}) {
  if (!PHONEPE_BASE_URL) {
    throw new HttpError(500, 'PhonePe is not configured.');
  }

  const firestore = await getFirestore();
  await verifyAdmin(req, firestore);

  const orderId = String(body.orderId || '').trim();
  const reason = String(body.reason || '').trim() || 'Customer requested refund';
  const amountInPaise = toAmountInPaise(body.amount);
  if (!orderId) {
    throw new HttpError(400, 'Order ID and valid amount are required.');
  }

  const orderRef = firestore.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpError(404, 'Order not found.');
  }

  const accessToken = await getPhonePeAccessToken();
  const refundId = `REFUND_${orderId}_${Date.now()}`;

  const response = await fetch(`${PHONEPE_BASE_URL}/payments/v2/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `O-Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      merchantRefundId: refundId,
      merchantOrderId: orderId,
      amount: amountInPaise,
      reason,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, parsePhonePeError(payload, 'PhonePe refund request failed.'));
  }

  await orderRef.update({
    refundStatus: 'initiated',
    refundId,
    refundAmount: amountInPaise / 100,
    refundReason: reason,
    refundInitiatedAt: FieldValue.serverTimestamp(),
    updatedAt: new Date(),
  });

  return {
    success: true,
    refundId,
    data: payload,
  };
}

module.exports = {
  createPhonePeRefund,
};
