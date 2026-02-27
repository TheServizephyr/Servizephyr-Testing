const { getFirestore, verifyIdToken } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

const OWNER_LIKE_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);
const DEFAULT_COLLECTION_ORDER = ['restaurants', 'shops', 'street_vendors'];

const PERMISSIONS = {
  VIEW_ORDERS: 'view_orders',
  UPDATE_ORDER_STATUS: 'update_order_status',
  VIEW_DINE_IN_ORDERS: 'view_dine_in_orders',
  MANAGE_DINE_IN: 'manage_dine_in',
  MANUAL_BILLING_READ: 'manual_billing_read',
  MANUAL_BILLING_WRITE: 'manual_billing_write',
  VIEW_MENU: 'view_menu',
  EDIT_MENU: 'edit_menu',
  TOGGLE_ITEM_STOCK: 'toggle_item_stock',
  PROCESS_PAYMENT: 'process_payment',
  REFUND_ORDER: 'refund_order',
  ASSIGN_RIDER: 'assign_rider',
  VIEW_PAYMENTS: 'view_payments',
  VIEW_CUSTOMERS: 'view_customers',
};

const ROLE_PERMISSIONS = {
  owner: Object.values(PERMISSIONS),
  'street-vendor': Object.values(PERMISSIONS),
  manager: [
    PERMISSIONS.VIEW_ORDERS,
    PERMISSIONS.UPDATE_ORDER_STATUS,
    PERMISSIONS.VIEW_DINE_IN_ORDERS,
    PERMISSIONS.MANAGE_DINE_IN,
    PERMISSIONS.MANUAL_BILLING_READ,
    PERMISSIONS.MANUAL_BILLING_WRITE,
    PERMISSIONS.VIEW_MENU,
    PERMISSIONS.EDIT_MENU,
    PERMISSIONS.TOGGLE_ITEM_STOCK,
    PERMISSIONS.PROCESS_PAYMENT,
    PERMISSIONS.ASSIGN_RIDER,
    PERMISSIONS.VIEW_PAYMENTS,
    PERMISSIONS.VIEW_CUSTOMERS,
  ],
  chef: [PERMISSIONS.VIEW_ORDERS, PERMISSIONS.VIEW_MENU, PERMISSIONS.TOGGLE_ITEM_STOCK],
  waiter: [
    PERMISSIONS.VIEW_ORDERS,
    PERMISSIONS.VIEW_DINE_IN_ORDERS,
    PERMISSIONS.MANAGE_DINE_IN,
    PERMISSIONS.VIEW_MENU,
    PERMISSIONS.MANUAL_BILLING_READ,
  ],
  cashier: [
    PERMISSIONS.VIEW_ORDERS,
    PERMISSIONS.VIEW_DINE_IN_ORDERS,
    PERMISSIONS.VIEW_MENU,
    PERMISSIONS.MANUAL_BILLING_READ,
    PERMISSIONS.MANUAL_BILLING_WRITE,
    PERMISSIONS.PROCESS_PAYMENT,
    PERMISSIONS.VIEW_PAYMENTS,
  ],
  order_taker: [PERMISSIONS.VIEW_ORDERS, PERMISSIONS.VIEW_MENU, PERMISSIONS.MANUAL_BILLING_READ],
};

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'restaurant-owner' || normalized === 'shop-owner' || normalized === 'store-owner') {
    return 'owner';
  }
  if (normalized === 'street_vendor') return 'street-vendor';
  return normalized;
}

function normalizeBusinessType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'street_vendor' || normalized === 'street-vendor') return 'street-vendor';
  if (normalized === 'restaurant') return 'restaurant';
  return '';
}

function getCollectionFromBusinessType(type) {
  const normalized = normalizeBusinessType(type);
  if (normalized === 'store') return 'shops';
  if (normalized === 'street-vendor') return 'street_vendors';
  if (normalized === 'restaurant') return 'restaurants';
  return '';
}

function getBusinessTypeFromRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'shop-owner') return 'store';
  if (normalized === 'street-vendor') return 'street-vendor';
  if (normalized === 'restaurant-owner' || normalized === 'owner') return 'restaurant';
  return '';
}

function getPreferredCollections(role, userBusinessType) {
  const businessType = normalizeBusinessType(userBusinessType) || getBusinessTypeFromRole(role);
  const preferred = getCollectionFromBusinessType(businessType);
  if (!preferred) return DEFAULT_COLLECTION_ORDER;
  return [preferred, ...DEFAULT_COLLECTION_ORDER.filter((value) => value !== preferred)];
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function extractBearerToken(req) {
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

function getPermissionsForRole(role) {
  const normalized = normalizeRole(role);
  return ROLE_PERMISSIONS[normalized] || [];
}

function hasPermission(context, permission) {
  if (!permission) return true;
  if (context.isAdminImpersonation) return true;
  const normalizedRole = normalizeRole(context.callerRole);
  if (normalizedRole === 'owner' || normalizedRole === 'street-vendor') return true;
  const permissions = Array.isArray(context.callerPermissions) ? context.callerPermissions : [];
  return permissions.includes(permission);
}

function ensureAnyPermission(context, requiredPermissions = []) {
  if (!requiredPermissions.length) return;
  const ok = requiredPermissions.some((permission) => hasPermission(context, permission));
  if (!ok) {
    throw new HttpError(
      403,
      `Access denied. Missing permission (${requiredPermissions.join(' OR ')}).`
    );
  }
}

async function getRequesterContext(req, checkRevoked = false) {
  const token = extractBearerToken(req);
  let decoded;
  try {
    decoded = await verifyIdToken(token, checkRevoked);
  } catch {
    throw new HttpError(401, 'Token verification failed.');
  }
  const uid = String(decoded?.uid || '').trim();
  if (!uid) throw new HttpError(401, 'Invalid token.');

  const firestore = await getFirestore();
  const userDoc = await firestore.collection('users').doc(uid).get();
  const userData = userDoc.exists ? (userDoc.data() || {}) : {};
  const role = normalizeRole(userData.role || '');

  return {
    firestore,
    uid,
    userDoc,
    userData,
    role,
  };
}

async function resolveBusinessById({ firestore, businessId }) {
  const safeBusinessId = String(businessId || '').trim();
  if (!safeBusinessId) return null;

  for (const collectionName of DEFAULT_COLLECTION_ORDER) {
    const doc = await firestore.collection(collectionName).doc(safeBusinessId).get();
    if (doc.exists) {
      return {
        businessId: doc.id,
        businessSnap: doc,
        collectionName,
      };
    }
  }

  return null;
}

function matchLinkedOutletByOwner(linkedOutlets, ownerUid) {
  if (!Array.isArray(linkedOutlets) || !ownerUid) return null;
  return (
    linkedOutlets.find(
      (outlet) => outlet?.ownerId === ownerUid && String(outlet?.status || '').toLowerCase() === 'active'
    ) || null
  );
}

async function resolveBusinessForOwner({
  firestore,
  targetOwnerUid,
  preferredCollections,
  explicitBusinessId,
  linkedOutlet,
}) {
  if (explicitBusinessId) {
    const explicit = await resolveBusinessById({ firestore, businessId: explicitBusinessId });
    if (!explicit) {
      throw new HttpError(404, 'Business not found.');
    }
    const ownerId = String(explicit.businessSnap.data()?.ownerId || '').trim();
    if (ownerId && ownerId === targetOwnerUid) return explicit;
    if (linkedOutlet && linkedOutlet.outletId === explicit.businessId) return explicit;
    throw new HttpError(403, 'Access denied for requested business.');
  }

  if (linkedOutlet?.outletId && linkedOutlet?.collectionName) {
    const doc = await firestore
      .collection(linkedOutlet.collectionName)
      .doc(linkedOutlet.outletId)
      .get();
    if (doc.exists) {
      return {
        businessId: doc.id,
        businessSnap: doc,
        collectionName: linkedOutlet.collectionName,
      };
    }
  }

  for (const collectionName of preferredCollections) {
    const snap = await firestore
      .collection(collectionName)
      .where('ownerId', '==', targetOwnerUid)
      .limit(1)
      .get();
    if (!snap.empty) {
      return {
        businessId: snap.docs[0].id,
        businessSnap: snap.docs[0],
        collectionName,
      };
    }
  }

  throw new HttpError(404, 'No business associated with this owner.');
}

async function resolveOwnerContext(req, options = {}) {
  const checkRevoked = parseBoolean(options.checkRevoked, false);
  const allowEmployee = options.allowEmployee !== false;
  const allowAdminImpersonation = options.allowAdminImpersonation !== false;
  const requiredPermissions = Array.isArray(options.requiredPermissions)
    ? options.requiredPermissions
    : (options.requiredPermissions ? [options.requiredPermissions] : []);

  const requester = await getRequesterContext(req, checkRevoked);
  const { firestore, uid, userData } = requester;
  const requesterRole = requester.role;

  const queryImpersonateOwner = String(req.query.impersonate_owner_id || '').trim();
  const queryEmployeeOf = String(req.query.employee_of || '').trim();

  let ownerUid = uid;
  let isAdminImpersonation = false;
  let linkedOutlet = null;

  if (allowAdminImpersonation && requesterRole === 'admin' && queryImpersonateOwner) {
    ownerUid = queryImpersonateOwner;
    isAdminImpersonation = true;
  } else if (allowEmployee && queryEmployeeOf) {
    const match = matchLinkedOutletByOwner(userData.linkedOutlets, queryEmployeeOf);
    if (!match) {
      throw new HttpError(403, 'Access denied: you are not an active employee for this outlet.');
    }
    ownerUid = queryEmployeeOf;
    linkedOutlet = match;
  } else {
    const hasOwnerRole = OWNER_LIKE_ROLES.has(String(userData.role || '').trim().toLowerCase())
      || normalizeRole(userData.role || '') === 'owner';
    if (!hasOwnerRole && requesterRole !== 'admin') {
      throw new HttpError(403, 'Access denied: insufficient privileges.');
    }
  }

  const explicitBusinessId = String(
    req.query.businessId || req.query.restaurantId || req.query.outletId || ''
  ).trim();

  const roleForLookup = isAdminImpersonation ? 'owner' : (linkedOutlet?.employeeRole || requesterRole);
  const preferredCollections = getPreferredCollections(roleForLookup, userData.businessType);
  const business = await resolveBusinessForOwner({
    firestore,
    targetOwnerUid: ownerUid,
    preferredCollections,
    explicitBusinessId,
    linkedOutlet,
  });

  const callerRole = normalizeRole(
    isAdminImpersonation ? 'owner' : (linkedOutlet?.employeeRole || userData.role || requesterRole)
  );
  const callerPermissions = isAdminImpersonation
    ? Object.values(PERMISSIONS)
    : (
      Array.isArray(linkedOutlet?.permissions) && linkedOutlet.permissions.length > 0
        ? linkedOutlet.permissions
        : getPermissionsForRole(callerRole)
    );

  const context = {
    firestore,
    actorUid: uid,
    ownerUid,
    businessId: business.businessId,
    businessSnap: business.businessSnap,
    businessData: business.businessSnap.data() || {},
    collectionName: business.collectionName,
    callerRole,
    callerPermissions,
    isAdminImpersonation,
    linkedOutlet,
  };

  ensureAnyPermission(context, requiredPermissions);
  return context;
}

async function resolveRiderContext(req, options = {}) {
  const checkRevoked = parseBoolean(options.checkRevoked, false);
  const requester = await getRequesterContext(req, checkRevoked);
  const { firestore, uid, userData } = requester;

  const driverRef = firestore.collection('drivers').doc(uid);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) {
    throw new HttpError(404, 'Rider profile not found.');
  }

  return {
    firestore,
    uid,
    driverRef,
    driverData: driverSnap.data() || {},
    userData,
    role: normalizeRole(userData.role || ''),
  };
}

module.exports = {
  PERMISSIONS,
  normalizeRole,
  hasPermission,
  resolveOwnerContext,
  resolveRiderContext,
};
