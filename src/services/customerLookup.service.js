const { randomUUID } = require('crypto');
const { getFirestore, verifyIdToken, FieldValue } = require('../lib/firebaseAdmin');
const { deobfuscateGuestId, normalizePhone } = require('../utils/guest');
const { HttpError } = require('../utils/httpError');

function getCookieValue(req, name) {
  const cookieHeader = String(req.headers.cookie || '');
  if (!cookieHeader) return '';
  const parts = cookieHeader.split(';').map((chunk) => chunk.trim());
  const pair = parts.find((chunk) => chunk.startsWith(`${name}=`));
  if (!pair) return '';
  return decodeURIComponent(pair.slice(name.length + 1));
}

function pickPhone(profileData = {}, fallback = '') {
  const candidates = [
    profileData?.phone,
    profileData?.phoneNumber,
    profileData?.whatsappNumber,
    profileData?.addresses?.[0]?.phone,
    fallback,
  ];

  for (const candidate of candidates) {
    const normalized = normalizePhone(candidate);
    if (normalized.length === 10) return normalized;
  }
  return normalizePhone(fallback);
}

function mapCustomerPayload(data = {}, fallbackPhone = '', isGuest = false) {
  return {
    name: data.name || (isGuest ? 'Guest' : 'User'),
    phone: pickPhone(data, fallbackPhone),
    addresses: Array.isArray(data.addresses) ? data.addresses : [],
    isVerified: !isGuest,
    isGuest,
  };
}

async function getOrCreateGuestProfile(firestore, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const userQuery = await firestore.collection('users').where('phone', '==', normalizedPhone).limit(1).get();
  if (!userQuery.empty) {
    return { userId: userQuery.docs[0].id, isGuest: false };
  }

  const guestQuery = await firestore.collection('guest_profiles').where('phone', '==', normalizedPhone).limit(1).get();
  if (!guestQuery.empty) {
    return { userId: guestQuery.docs[0].id, isGuest: true };
  }

  const guestId = `g_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await firestore.collection('guest_profiles').doc(guestId).set({
    phone: normalizedPhone,
    createdAt: FieldValue.serverTimestamp(),
    addresses: [],
  });
  return { userId: guestId, isGuest: true };
}

async function lookupById({ firestore, targetUserId }) {
  const guestDoc = await firestore.collection('guest_profiles').doc(targetUserId).get();
  if (guestDoc.exists) {
    return mapCustomerPayload(guestDoc.data() || {}, '', true);
  }

  const userDoc = await firestore.collection('users').doc(targetUserId).get();
  if (userDoc.exists) {
    return mapCustomerPayload(userDoc.data() || {}, '', false);
  }

  throw new HttpError(404, 'User not found.');
}

async function getLoggedInUid(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return '';
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return '';
  try {
    const decoded = await verifyIdToken(idToken);
    return decoded.uid || '';
  } catch {
    return '';
  }
}

async function lookupCustomer(req) {
  const firestore = await getFirestore();
  const body = req.body || {};
  const phone = String(body.phone || '');
  const explicitGuestId =
    typeof body.guestId === 'string' ? body.guestId.trim() : String(body.guestId || '').trim();
  const ref = String(body.ref || '').trim();
  const cookieGuestId = String(getCookieValue(req, 'auth_guest_session') || '').trim();

  const refId = ref ? deobfuscateGuestId(ref) : null;
  const loggedInUid = await getLoggedInUid(req);

  const targetUserId = refId || explicitGuestId || cookieGuestId || loggedInUid;
  if (targetUserId) {
    return lookupById({ firestore, targetUserId });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new HttpError(400, 'User identifier required.');
  }

  const profileResult = await getOrCreateGuestProfile(firestore, normalizedPhone);
  if (!profileResult || !profileResult.userId) {
    throw new HttpError(404, 'User not found.');
  }

  if (profileResult.isGuest) {
    const guestDoc = await firestore.collection('guest_profiles').doc(profileResult.userId).get();
    if (!guestDoc.exists) throw new HttpError(404, 'User not found.');
    return mapCustomerPayload(guestDoc.data() || {}, normalizedPhone, true);
  }

  const userDoc = await firestore.collection('users').doc(profileResult.userId).get();
  if (!userDoc.exists) throw new HttpError(404, 'User not found.');
  return mapCustomerPayload(userDoc.data() || {}, normalizedPhone, false);
}

module.exports = {
  lookupCustomer,
};
