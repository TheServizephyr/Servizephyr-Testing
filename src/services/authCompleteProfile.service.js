const { FieldValue, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { verifyAndGetUid } = require('./authIdentity.service');

function generateDisplayId(prefix, timestamp) {
  let date = new Date();
  if (timestamp) {
    if (typeof timestamp?.toDate === 'function') {
      date = timestamp.toDate();
    } else if (typeof timestamp?.seconds === 'number') {
      date = new Date(timestamp.seconds * 1000);
    } else {
      const parsed = new Date(timestamp);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    }
  }

  const yy = String(date.getFullYear()).slice(-2);
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const HH = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const rr = Math.floor(10 + Math.random() * 90).toString();

  return `${prefix}${yy}${MM}${dd}${HH}${mm}${rr}`;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function slugifyName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `biz-${Date.now().toString().slice(-8)}`;
}

function resolveBusinessCollectionName(businessType) {
  const normalized = String(businessType || '').trim().toLowerCase();
  if (normalized === 'restaurant') return { normalized: 'restaurant', collection: 'restaurants' };
  if (normalized === 'shop' || normalized === 'store') return { normalized: 'store', collection: 'shops' };
  if (normalized === 'street-vendor' || normalized === 'street_vendor') {
    return { normalized: 'street-vendor', collection: 'street_vendors' };
  }
  return null;
}

function mergeAddresses(existing = [], incoming = []) {
  const seen = new Set();
  const result = [];
  const add = (address) => {
    if (!address || typeof address !== 'object') return;
    const key = String(address.id || `${address.full || ''}|${address.latitude || ''}|${address.longitude || ''}`).trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(address);
  };

  existing.forEach(add);
  incoming.forEach(add);
  return result;
}

async function migrateGuestToUserLite({ firestore, uid, normalizedPhone, userRef }) {
  if (!normalizedPhone) return { migrated: false };

  const guestQuery = await firestore
    .collection('guest_profiles')
    .where('phone', '==', normalizedPhone)
    .limit(1)
    .get();

  if (guestQuery.empty) {
    return { migrated: false };
  }

  const guestDoc = guestQuery.docs[0];
  const guestId = guestDoc.id;
  if (!guestId || guestId === uid) {
    return { migrated: false };
  }

  const guestData = guestDoc.data() || {};
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};

  const existingAddresses = Array.isArray(userData.addresses) ? userData.addresses : [];
  const guestAddresses = Array.isArray(guestData.addresses) ? guestData.addresses : [];
  const mergedAddresses = mergeAddresses(existingAddresses, guestAddresses);

  const batch = firestore.batch();
  batch.set(
    userRef,
    {
      addresses: mergedAddresses,
      migratedFromGuest: guestId,
      migratedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const ordersQuery = await firestore.collection('orders').where('userId', '==', guestId).get();
  ordersQuery.docs.forEach((orderDoc) => {
    batch.update(orderDoc.ref, {
      userId: uid,
      migratedFromGuest: guestId,
    });
  });

  batch.delete(guestDoc.ref);
  await batch.commit();

  return {
    migrated: true,
    guestId,
    addressesMigrated: guestAddresses.length,
    ordersMigrated: ordersQuery.size,
  };
}

async function postAuthCompleteProfile(req) {
  const uid = await verifyAndGetUid(req, { checkRevoked: false });
  const firestore = await getFirestore();
  const body = req.body || {};

  const finalUserData = body.finalUserData || {};
  const businessData = body.businessData || null;
  const businessType = body.businessType;

  if (!finalUserData || !finalUserData.role || !finalUserData.phone) {
    throw new HttpError(400, 'User role and phone are missing in payload.');
  }

  const role = String(finalUserData.role || '').trim();
  const isBusinessOwner = (
    role === 'restaurant-owner'
    || role === 'shop-owner'
    || role === 'store-owner'
    || role === 'street-vendor'
  );

  if (isBusinessOwner && !businessData) {
    throw new HttpError(400, 'Business data is required for owners.');
  }

  if (businessData && (!businessData.address || !businessData.address.street || !businessData.address.city)) {
    throw new HttpError(400, 'A structured address is required for businesses.');
  }

  const normalizedPhone = normalizePhone(finalUserData.phone);
  const userRef = firestore.collection('users').doc(uid);
  const nowForId = new Date();

  const mergedUserData = {
    ...finalUserData,
    customerId: finalUserData.customerId || generateDisplayId('CS_', nowForId),
    createdAt: FieldValue.serverTimestamp(),
  };

  await userRef.set(mergedUserData, { merge: true });
  const migrationResult = await migrateGuestToUserLite({
    firestore,
    uid,
    normalizedPhone,
    userRef,
  });

  const batch = firestore.batch();
  if (role === 'rider') {
    const driverRef = firestore.collection('drivers').doc(uid);
    batch.set(
      driverRef,
      {
        uid,
        role: 'rider',
        email: finalUserData.email,
        name: finalUserData.name,
        phone: finalUserData.phone,
        profilePictureUrl: finalUserData.profilePictureUrl,
        createdAt: FieldValue.serverTimestamp(),
        status: 'offline',
        currentLocation: null,
        currentRestaurantId: null,
        allowInCommunityPool: false,
        walletBalance: 0,
      },
      { merge: true }
    );
  } else if (isBusinessOwner && businessData) {
    const businessTypeResolved = resolveBusinessCollectionName(businessType);
    if (!businessTypeResolved) {
      throw new HttpError(400, 'Invalid business type.');
    }

    const businessId = slugifyName(businessData.name);
    const businessRef = firestore.collection(businessTypeResolved.collection).doc(businessId);
    const finalBusinessData = {
      ...businessData,
      businessType: businessTypeResolved.normalized,
      ownerId: uid,
      merchantId: generateDisplayId('RS_', nowForId),
      createdAt: FieldValue.serverTimestamp(),
      approvalStatus: 'pending',
      restrictedFeatures: [],
      suspensionRemark: '',
      razorpayAccountId: '',
      isOpen: true,
      deliveryEnabled: true,
      pickupEnabled: true,
      dineInEnabled: true,
      deliveryOnlinePaymentEnabled: true,
      deliveryCodEnabled: true,
      pickupOnlinePaymentEnabled: true,
      pickupPodEnabled: true,
      dineInOnlinePaymentEnabled: true,
      dineInPayAtCounterEnabled: true,
    };

    batch.set(businessRef, finalBusinessData, { merge: true });
  }

  await batch.commit();

  return {
    message: 'Profile completed successfully!',
    role,
    migration: migrationResult,
  };
}

module.exports = {
  postAuthCompleteProfile,
};
