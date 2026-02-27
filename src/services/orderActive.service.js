const { getFirestore, verifyIdToken } = require('../lib/firebaseAdmin');
const { deobfuscateGuestId, normalizePhone, toDateSafe } = require('../utils/guest');
const { HttpError } = require('../utils/httpError');

const ACTIVE_STATUSES = new Set([
  'pending',
  'placed',
  'accepted',
  'confirmed',
  'preparing',
  'prepared',
  'ready',
  'ready_for_pickup',
  'dispatched',
  'on_the_way',
  'rider_arrived',
]);

const PRIVILEGED_ROLES = new Set([
  'admin',
  'owner',
  'restaurant-owner',
  'shop-owner',
  'street-vendor',
  'manager',
]);

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice('Bearer '.length).trim();
}

async function resolveUidFromToken(req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    const decoded = await verifyIdToken(token);
    return decoded.uid || null;
  } catch {
    return null;
  }
}

async function hasBusinessAccess({ firestore, uid, restaurantId }) {
  if (!uid || !restaurantId) return false;

  const userDoc = await firestore.collection('users').doc(uid).get();
  if (!userDoc.exists) return false;
  const userData = userDoc.data() || {};
  const role = String(userData.role || '').trim().toLowerCase();

  if (role === 'admin') return true;
  if (!PRIVILEGED_ROLES.has(role)) return false;

  for (const collectionName of ['restaurants', 'shops', 'street_vendors']) {
    const businessDoc = await firestore.collection(collectionName).doc(restaurantId).get();
    if (!businessDoc.exists) continue;
    const businessData = businessDoc.data() || {};
    if (String(businessData.ownerId || '').trim() === uid) return true;
    break;
  }

  if (!Array.isArray(userData.linkedOutlets)) return false;
  return userData.linkedOutlets.some(
    (outlet) => outlet?.outletId === restaurantId && String(outlet?.status || '').toLowerCase() === 'active'
  );
}

async function authorizeTabRead({ req, firestore, tabId, docs = [] }) {
  const queryToken = String(req.query.token || '').trim();
  if (queryToken) {
    const matched = docs.some((doc) => {
      const data = doc.data() || {};
      return queryToken === String(data.trackingToken || '')
        || queryToken === String(data.dineInToken || '');
    });
    if (matched) return;
  }

  const bearerUid = await resolveUidFromToken(req);
  if (bearerUid) {
    const matched = docs.some((doc) => {
      const data = doc.data() || {};
      return bearerUid === String(data.userId || '')
        || bearerUid === String(data.customerId || '')
        || bearerUid === String(data.deliveryBoyId || '');
    });
    if (matched) return;

    const restaurantId = String(docs[0]?.data()?.restaurantId || '').trim();
    const businessAccess = await hasBusinessAccess({
      firestore,
      uid: bearerUid,
      restaurantId,
    });
    if (businessAccess) return;
  }

  throw new HttpError(401, `Unauthorized for tab ${tabId}.`);
}

async function authorizeCustomerActiveRequest({ req, firestore, normalizedPhone, targetGuestId }) {
  const bearerUid = await resolveUidFromToken(req);
  if (bearerUid) {
    if (targetGuestId && bearerUid === targetGuestId) return { authorized: true, bearerUid };
    if (normalizedPhone) {
      const userByPhone = await firestore.collection('users').where('phone', '==', normalizedPhone).limit(1).get();
      if (!userByPhone.empty && userByPhone.docs[0].id === bearerUid) {
        return { authorized: true, bearerUid };
      }
      const guestByPhone = await firestore.collection('guest_profiles').where('phone', '==', normalizedPhone).limit(1).get();
      if (!guestByPhone.empty && guestByPhone.docs[0].id === bearerUid) {
        return { authorized: true, bearerUid };
      }
    }
  }

  if (targetGuestId) return { authorized: true, bearerUid: null };

  const token = String(req.query.token || '').trim();
  if (token) {
    const tokenDoc = await firestore.collection('auth_tokens').doc(token).get();
    if (tokenDoc.exists) {
      const data = tokenDoc.data() || {};
      if (targetGuestId && (data.userId === targetGuestId || data.guestId === targetGuestId)) {
        return { authorized: true, bearerUid: null };
      }
      if (normalizedPhone && (data.phone === normalizedPhone || data.userId === normalizedPhone || data.guestId === normalizedPhone)) {
        return { authorized: true, bearerUid: null };
      }
    }
  }

  return { authorized: false, bearerUid: null };
}

function sortByNewest(a, b) {
  const aTime = toDateSafe(a.orderDate || a.createdAt)?.getTime() || 0;
  const bTime = toDateSafe(b.orderDate || b.createdAt)?.getTime() || 0;
  return bTime - aTime;
}

function mapActiveOrder(doc) {
  const d = doc.data() || {};
  return {
    orderId: doc.id,
    status: d.status,
    trackingToken: d.trackingToken || d.token || null,
    restaurantId: d.restaurantId || null,
    restaurantName: d.restaurantName || d.businessName || 'Restaurant',
    totalAmount: Number(d.grandTotal || d.totalAmount || 0),
    items: Array.isArray(d.items) ? d.items : [],
    deliveryType: d.deliveryType || 'delivery',
    orderDate: d.orderDate || null,
    createdAt: d.createdAt || null,
    customerOrderId: d.customerOrderId || null,
  };
}

async function loadActiveOrdersByCustomer({ firestore, req }) {
  const phone = String(req.query.phone || '');
  const ref = String(req.query.ref || '');
  const normalizedPhone = normalizePhone(phone);
  const targetGuestId = ref ? deobfuscateGuestId(ref) : null;

  if (ref && !targetGuestId) {
    throw new HttpError(400, 'Invalid ref');
  }

  const authResult = await authorizeCustomerActiveRequest({
    req,
    firestore,
    normalizedPhone,
    targetGuestId,
  });
  if (!authResult.authorized) {
    throw new HttpError(401, 'Unauthorized. Please login.');
  }

  const userIdCandidates = new Set();
  if (authResult.bearerUid) userIdCandidates.add(authResult.bearerUid);
  if (targetGuestId) userIdCandidates.add(targetGuestId);

  if (normalizedPhone) {
    const [userByPhone, guestByPhone] = await Promise.all([
      firestore.collection('users').where('phone', '==', normalizedPhone).limit(1).get(),
      firestore.collection('guest_profiles').where('phone', '==', normalizedPhone).limit(1).get(),
    ]);
    if (!userByPhone.empty) userIdCandidates.add(userByPhone.docs[0].id);
    if (!guestByPhone.empty) userIdCandidates.add(guestByPhone.docs[0].id);
  }

  const snapshots = [];
  for (const userId of userIdCandidates) {
    // No status filter at DB level to reduce index dependency; filter in memory.
    // This can be tuned later with targeted composite indexes.
    const snap = await firestore.collection('orders').where('userId', '==', userId).limit(40).get();
    snapshots.push(snap);
  }

  if (snapshots.every((snap) => snap.empty) && normalizedPhone) {
    const [phoneSnap, nestedPhoneSnap] = await Promise.all([
      firestore.collection('orders').where('customerPhone', '==', normalizedPhone).limit(40).get(),
      firestore.collection('orders').where('customer.phone', '==', normalizedPhone).limit(40).get(),
    ]);
    snapshots.push(phoneSnap, nestedPhoneSnap);
  }

  const unique = new Map();
  snapshots.forEach((snap) => {
    snap.forEach((doc) => {
      const data = doc.data() || {};
      if (!ACTIVE_STATUSES.has(String(data.status || '').toLowerCase())) return;

      const createdAt = toDateSafe(data.orderDate || data.createdAt);
      const now = Date.now();
      if (createdAt && (now - createdAt.getTime()) > (24 * 60 * 60 * 1000)) return;

      unique.set(doc.id, doc);
    });
  });

  const activeOrders = Array.from(unique.values()).map(mapActiveOrder).sort(sortByNewest);
  return { activeOrders };
}

async function loadActiveOrderByTab({ firestore, req, tabId }) {
  const [snap1, snap2] = await Promise.all([
    firestore.collection('orders').where('dineInTabId', '==', tabId).limit(80).get(),
    firestore.collection('orders').where('tabId', '==', tabId).limit(80).get(),
  ]);

  const unique = new Map();
  snap1.forEach((doc) => unique.set(doc.id, doc));
  snap2.forEach((doc) => unique.set(doc.id, doc));

  const first = Array.from(unique.values())[0];
  const firstData = first ? first.data() || {} : null;
  if (firstData?.restaurantId && firstData?.dineInToken) {
    const tokenSnap = await firestore
      .collection('orders')
      .where('restaurantId', '==', firstData.restaurantId)
      .where('dineInToken', '==', firstData.dineInToken)
      .limit(120)
      .get();
    tokenSnap.forEach((doc) => unique.set(doc.id, doc));
  }

  if (unique.size === 0) {
    throw new HttpError(404, 'No orders found for this tab');
  }

  const docs = Array.from(unique.values());
  await authorizeTabRead({
    req,
    firestore,
    tabId,
    docs,
  });

  const sortedDocs = docs.sort((a, b) => {
    const aTime = toDateSafe(a.data()?.createdAt)?.getTime() || 0;
    const bTime = toDateSafe(b.data()?.createdAt)?.getTime() || 0;
    return aTime - bTime;
  });

  let subtotal = 0;
  let tabName = '';
  let customerName = '';
  const items = [];

  sortedDocs.forEach((doc) => {
    const d = doc.data() || {};
    const status = String(d.status || '').toLowerCase();
    if (['cancelled', 'rejected', 'picked_up'].includes(status)) return;

    items.push(...(Array.isArray(d.items) ? d.items : []));
    subtotal += Number(d.totalAmount || d.grandTotal || d.subtotal || 0);
    if (!tabName) tabName = d.tab_name || d.customerName || '';
    if (!customerName) customerName = d.customerName || '';
  });

  return {
    items,
    subtotal,
    totalAmount: subtotal,
    grandTotal: subtotal,
    tab_name: tabName,
    customerName,
  };
}

async function getActiveOrders(req) {
  const tabId = String(req.query.tabId || '').trim();
  const phone = String(req.query.phone || '').trim();
  const ref = String(req.query.ref || '').trim();

  if (!tabId && !phone && !ref) {
    throw new HttpError(400, 'TabId, Phone, or Ref is required');
  }

  const firestore = await getFirestore();
  if (tabId) {
    return loadActiveOrderByTab({ firestore, req, tabId });
  }
  return loadActiveOrdersByCustomer({ firestore, req });
}

module.exports = { getActiveOrders };
