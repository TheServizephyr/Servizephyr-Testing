const { randomUUID } = require('crypto');
const { FieldValue, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { verifyAndGetUid } = require('./authIdentity.service');
const { deobfuscateGuestId, obfuscateGuestId } = require('../utils/guest');

function randomToken(length = 24) {
  return randomUUID().replace(/-/g, '').slice(0, length);
}

function minuteKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}-${min}`;
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  if (realIp) return realIp;
  return 'unknown';
}

async function checkIpRateLimit({ firestore, ip, limitPerMinute = 20 }) {
  const safeIp = String(ip || 'unknown').replace(/[:.]/g, '_');
  const key = minuteKey();
  const ref = firestore.collection('rate_limits').doc(`ip_${safeIp}_${key}`);

  try {
    return await firestore.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) {
        transaction.set(ref, {
          ip,
          minute: key,
          count: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { allowed: true };
      }

      const currentCount = Number(snap.data()?.count || 0);
      if (currentCount >= limitPerMinute) {
        return { allowed: false };
      }

      transaction.update(ref, {
        count: FieldValue.increment(1),
      });
      return { allowed: true };
    });
  } catch {
    return { allowed: false };
  }
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function postAuthGenerateSessionToken(req) {
  const firestore = await getFirestore();
  const body = req.body || {};
  const tableId = String(body.tableId || '').trim();
  const restaurantId = String(body.restaurantId || '').trim();

  if (tableId && restaurantId) {
    const clientIp = getClientIp(req);
    const rate = await checkIpRateLimit({ firestore, ip: clientIp, limitPerMinute: 12 });
    if (!rate.allowed) {
      throw new HttpError(429, 'Too many requests. Please try again shortly.');
    }

    const normalizedTableId = tableId.toUpperCase();
    const [exactTableDoc, normalizedTableDoc] = await Promise.all([
      firestore.collection('restaurants').doc(restaurantId).collection('tables').doc(tableId).get(),
      firestore.collection('restaurants').doc(restaurantId).collection('tables').doc(normalizedTableId).get(),
    ]);

    if (!exactTableDoc.exists && !normalizedTableDoc.exists) {
      throw new HttpError(404, 'Invalid table for this restaurant.');
    }

    const effectiveTableId = normalizedTableDoc.exists ? normalizedTableId : tableId;
    const activeTokenQuery = await firestore
      .collection('auth_tokens')
      .where('tableId', '==', effectiveTableId)
      .where('restaurantId', '==', restaurantId)
      .where('expiresAt', '>', new Date())
      .limit(1)
      .get();

    if (!activeTokenQuery.empty) {
      throw new HttpError(409, 'This table is currently occupied. Please use the original device or see the host for assistance.');
    }

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);

    await firestore.collection('auth_tokens').doc(token).set({
      tableId: effectiveTableId,
      restaurantId,
      expiresAt,
      type: 'dine-in',
    });

    return { token, expiresAt };
  }

  const uid = await verifyAndGetUid(req, { checkRevoked: false });
  const userDoc = await firestore.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    throw new HttpError(404, 'User profile not found. Please complete your profile.');
  }

  const userData = userDoc.data() || {};
  const phone = String(userData.phone || '').trim();
  if (!phone) {
    throw new HttpError(400, 'Phone number not found in your profile. Please update it.');
  }

  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const ref = obfuscateGuestId(uid);

  await firestore.collection('auth_tokens').doc(token).set({
    phone,
    expiresAt,
    uid,
    userId: uid,
    type: 'whatsapp',
  });

  return { phone, ref, token, expiresAt };
}

async function postAuthVerifyToken(req) {
  const firestore = await getFirestore();
  const body = req.body || {};

  const phone = String(body.phone || '').trim();
  const token = String(body.token || '').trim();
  const tableId = String(body.tableId || '').trim();
  const ref = String(body.ref || '').trim();

  if (!token) {
    throw new HttpError(400, 'Session token is required.');
  }

  const tokenRef = firestore.collection('auth_tokens').doc(token);
  const tokenDoc = await tokenRef.get();
  if (!tokenDoc.exists) {
    throw new HttpError(403, 'Invalid or expired session token.');
  }

  const tokenData = tokenDoc.data() || {};
  const expiresAt = toDate(tokenData.expiresAt);
  if (!expiresAt || Date.now() > expiresAt.getTime()) {
    await tokenRef.delete();
    throw new HttpError(403, 'Your session has expired. Please request a new link.');
  }

  if (tokenData.type === 'dine-in') {
    if (!tableId || String(tokenData.tableId || '') !== tableId) {
      throw new HttpError(403, 'Invalid table for this session.');
    }

    return {
      payload: { message: 'Token is valid.', type: 'dine-in' },
      cookie: null,
    };
  }

  if (ref) {
    const guestId = deobfuscateGuestId(ref);
    if (!guestId) {
      throw new HttpError(400, 'Invalid link format.');
    }

    const tokenUserId = String(tokenData.userId || tokenData.guestId || '').trim();
    if (!tokenUserId || tokenUserId !== guestId) {
      throw new HttpError(403, 'Invalid session link.');
    }

    return {
      payload: {
        message: 'Token is valid.',
        type: 'guest',
        guestId,
      },
      cookie: {
        name: 'auth_guest_session',
        value: String(guestId),
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      },
    };
  }

  if (tokenData.type === 'whatsapp' || tokenData.type === 'tracking') {
    const tokenPhone = String(tokenData.phone || '').trim();
    if (tokenPhone && (!phone || tokenPhone !== phone)) {
      throw new HttpError(403, 'Invalid session.');
    }

    return {
      payload: {
        message: 'Token is valid.',
        type: 'legacy_phone',
      },
      cookie: null,
    };
  }

  throw new HttpError(400, 'Unknown token type.');
}

module.exports = {
  postAuthGenerateSessionToken,
  postAuthVerifyToken,
};
