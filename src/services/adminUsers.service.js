const { getAuth } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveAdminContext } = require('./adminAccess.service');

function normalizeText(value) {
  return String(value || '').trim();
}

function toIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function pickTimestamp(data, fields) {
  for (const field of fields) {
    const iso = toIso(data?.[field]);
    if (iso) return iso;
  }
  return null;
}

function firstAddressText(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return 'No Address';
  const addr = addresses[0] || {};
  return addr.full
    || [
      addr.street,
      addr.area,
      addr.city,
      addr.state,
      addr.postalCode,
      addr.country,
    ].filter(Boolean).join(', ')
    || 'No Address';
}

function normalizeAddress(address = {}) {
  return {
    full: address.full
      || [
        address.street,
        address.area,
        address.city,
        address.state,
        address.postalCode,
        address.country,
      ].filter(Boolean).join(', '),
    ...address,
  };
}

function normalizeRoleLabel(data = {}) {
  if (data.role === 'admin' || data.isAdmin) return 'Admin';
  if (data.businessType === 'restaurant' || data.role === 'owner') return 'Owner';
  if (data.businessType === 'shop' || data.businessType === 'store') return 'Store Owner';
  if (data.businessType === 'street-vendor' || data.businessType === 'street_vendor') return 'Street Vendor';
  if (data.role === 'rider' || data.role === 'delivery') return 'Rider';
  return 'Customer';
}

async function getGuestLastActivity({ firestore, guestId }) {
  try {
    const snap = await firestore
      .collection('orders')
      .where('userId', '==', guestId)
      .orderBy('orderDate', 'desc')
      .limit(1)
      .get();
    if (!snap.empty) {
      return pickTimestamp(snap.docs[0].data() || {}, ['orderDate', 'createdAt', 'updatedAt']);
    }
  } catch {
    return null;
  }
  return null;
}

function sortByJoinDateDescending(users = []) {
  users.sort((a, b) => {
    const dateA = new Date(a.joinDate);
    const dateB = new Date(b.joinDate);

    const isValidA = !Number.isNaN(dateA.getTime()) && a.joinDate !== 'Unknown';
    const isValidB = !Number.isNaN(dateB.getTime()) && b.joinDate !== 'Unknown';

    if (isValidA && isValidB) return dateB.getTime() - dateA.getTime();
    if (isValidA && !isValidB) return -1;
    if (!isValidA && isValidB) return 1;
    return 0;
  });
  return users;
}

async function getAdminUsers(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });

  const [usersSnap, guestProfilesSnap] = await Promise.all([
    firestore.collection('users').get(),
    firestore.collection('guest_profiles').get(),
  ]);

  const users = usersSnap.docs
    .map((doc) => {
      const data = doc.data() || {};
      if (data.isDeleted) return null;

      const joinDate = pickTimestamp(data, ['createdAt', 'created_at', 'registeredAt', 'timestamp', 'joinedAt']) || 'Unknown';
      const lastActivity = pickTimestamp(data, ['lastActivityAt', 'lastSeen', 'updatedAt', 'lastLoginAt', 'lastOrderAt']) || joinDate;

      return {
        id: doc.id,
        userType: 'user',
        name: data.name || 'Unnamed User',
        email: data.email || 'No Email',
        phone: data.phone || data.phoneNumber || 'No Phone',
        role: normalizeRoleLabel(data),
        joinDate,
        status: data.status || 'Active',
        profilePictureUrl: data.profilePictureUrl || '',
        address: firstAddressText(data.addresses),
        lastActivity,
      };
    })
    .filter(Boolean);

  const guestUsers = await Promise.all(
    guestProfilesSnap.docs.map(async (doc) => {
      const data = doc.data() || {};
      if (data.isDeleted) return null;

      const joinDate = pickTimestamp(data, ['createdAt']) || 'Unknown';
      let lastActivity = pickTimestamp(data, ['lastActivityAt', 'lastSeen', 'updatedAt', 'lastOrderAt']) || null;
      if (!lastActivity) {
        lastActivity = await getGuestLastActivity({ firestore, guestId: doc.id });
      }

      const status = data.status === 'Blocked' || data.blocked ? 'Blocked' : 'Active';
      const phone = data.phone || 'No Phone';
      const suffix = phone !== 'No Phone' ? String(phone).slice(-4) : String(doc.id).slice(-4);

      return {
        id: doc.id,
        userType: 'guest',
        name: data.name || `Guest ${suffix}`,
        email: data.email || 'Guest (No Email)',
        phone,
        role: 'Guest Customer',
        joinDate,
        status,
        profilePictureUrl: data.profilePictureUrl || '',
        address: firstAddressText(data.addresses),
        lastActivity: lastActivity || joinDate,
      };
    })
  );

  const mergedUsers = sortByJoinDateDescending([...users, ...guestUsers.filter(Boolean)]);
  return { users: mergedUsers };
}

async function patchAdminUsers(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: true });
  const auth = await getAuth();
  const body = req.body || {};

  const userId = normalizeText(body.userId);
  const status = normalizeText(body.status);
  const userType = normalizeText(body.userType || 'user').toLowerCase();
  const action = normalizeText(body.action || 'status').toLowerCase();

  if (!userId) {
    throw new HttpError(400, 'Missing required fields');
  }

  if (action === 'remove') {
    if (userType === 'guest') {
      await firestore.collection('guest_profiles').doc(userId).set(
        {
          isDeleted: true,
          status: 'Removed',
          removedAt: new Date(),
        },
        { merge: true }
      );
      return { message: 'Guest removed successfully' };
    }

    if (userType === 'user') {
      await firestore.collection('users').doc(userId).set(
        {
          isDeleted: true,
          status: 'Removed',
          removedAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      await auth.updateUser(userId, { disabled: true });
      return { message: 'User removed successfully' };
    }

    throw new HttpError(400, 'Invalid user type for remove action.');
  }

  const validStatuses = new Set(['Active', 'Blocked']);
  if (!status || !validStatuses.has(status)) {
    throw new HttpError(400, 'Invalid status provided');
  }

  if (userType === 'guest') {
    await firestore.collection('guest_profiles').doc(userId).set(
      {
        status,
        blocked: status === 'Blocked',
        updatedAt: new Date(),
      },
      { merge: true }
    );
    return { message: 'Guest status updated successfully' };
  }

  await firestore.collection('users').doc(userId).set(
    {
      status,
      updatedAt: new Date(),
    },
    { merge: true }
  );
  await auth.updateUser(userId, {
    disabled: status === 'Blocked',
  });

  return { message: 'User status updated successfully' };
}

async function fetchUserActivity({ firestore, userId }) {
  let ordersSnap;
  try {
    ordersSnap = await firestore
      .collection('orders')
      .where('userId', '==', userId)
      .orderBy('orderDate', 'desc')
      .limit(50)
      .get();
  } catch {
    ordersSnap = await firestore
      .collection('orders')
      .where('userId', '==', userId)
      .limit(50)
      .get();
  }

  return ordersSnap.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        orderId: doc.id,
        customerOrderId: data.customerOrderId || null,
        status: data.status || 'unknown',
        orderDate: pickTimestamp(data, ['orderDate', 'createdAt', 'updatedAt']),
        totalAmount: data.grandTotal ?? data.totalAmount ?? data.subtotal ?? 0,
        restaurantId: data.restaurantId || '',
        deliveryType: data.deliveryType || 'delivery',
      };
    })
    .sort((a, b) => new Date(b.orderDate || 0).getTime() - new Date(a.orderDate || 0).getTime());
}

async function getAdminUserById(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });
  const userId = normalizeText(req.params?.userId);
  const userType = normalizeText(req.query?.userType || 'user').toLowerCase();

  if (!userId) {
    throw new HttpError(400, 'userId is required');
  }

  let profile;
  let raw;
  if (userType === 'guest') {
    const guestDoc = await firestore.collection('guest_profiles').doc(userId).get();
    if (!guestDoc.exists) {
      throw new HttpError(404, 'Guest profile not found');
    }

    raw = guestDoc.data() || {};
    profile = {
      id: guestDoc.id,
      userType: 'guest',
      name: raw.name || `Guest ${String(raw.phone || guestDoc.id).slice(-4)}`,
      email: raw.email || 'Guest (No Email)',
      phone: raw.phone || 'No Phone',
      status: raw.status === 'Blocked' || raw.blocked ? 'Blocked' : 'Active',
      role: 'Guest Customer',
      joinDate: pickTimestamp(raw, ['createdAt']) || 'Unknown',
      addresses: Array.isArray(raw.addresses) ? raw.addresses.map(normalizeAddress) : [],
      profilePictureUrl: raw.profilePictureUrl || '',
    };
  } else {
    const userDoc = await firestore.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpError(404, 'User not found');
    }

    raw = userDoc.data() || {};
    profile = {
      id: userDoc.id,
      userType: 'user',
      name: raw.name || 'Unnamed User',
      email: raw.email || 'No Email',
      phone: raw.phone || raw.phoneNumber || 'No Phone',
      status: raw.status || 'Active',
      role: normalizeRoleLabel(raw),
      joinDate: pickTimestamp(raw, ['createdAt', 'created_at', 'registeredAt', 'timestamp', 'joinedAt']) || 'Unknown',
      addresses: Array.isArray(raw.addresses) ? raw.addresses.map(normalizeAddress) : [],
      profilePictureUrl: raw.profilePictureUrl || '',
    };
  }

  const activity = await fetchUserActivity({ firestore, userId });

  if (profile.addresses.length === 0 && activity.length > 0) {
    try {
      const latestOrderDoc = await firestore.collection('orders').doc(activity[0].orderId).get();
      const latestData = latestOrderDoc.exists ? (latestOrderDoc.data() || {}) : {};
      const customerAddress = latestData.customer?.address || latestData.address;
      if (customerAddress) {
        profile.addresses = [normalizeAddress(customerAddress)];
      }
    } catch {
      // no-op
    }
  }

  const lastOrderCustomerOrderId = activity[0]?.customerOrderId || null;
  const profileLastActivity = pickTimestamp(raw, ['lastActivityAt', 'lastSeen', 'updatedAt', 'lastLoginAt', 'lastOrderAt']) || null;
  const lastActivity = activity[0]?.orderDate || profileLastActivity || profile.joinDate;

  return {
    user: {
      ...profile,
      totalOrders: activity.length,
      lastActivity,
      lastOrderCustomerOrderId,
    },
    activity,
  };
}

module.exports = {
  getAdminUsers,
  patchAdminUsers,
  getAdminUserById,
};
