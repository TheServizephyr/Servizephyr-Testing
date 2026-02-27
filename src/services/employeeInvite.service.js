const { FieldValue, getAuth, getFirestore, verifyIdToken } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

const ROLE_PERMISSIONS = {
  manager: [
    'view_dashboard',
    'view_analytics',
    'view_orders',
    'view_all_orders',
    'create_order',
    'update_order_status',
    'mark_order_ready',
    'mark_order_preparing',
    'cancel_order',
    'mark_order_served',
    'manage_dine_in',
    'view_tables',
    'assign_table',
    'add_to_tab',
    'close_tab',
    'generate_bill',
    'process_payment',
    'view_payments',
    'view_menu',
    'edit_menu',
    'add_menu_item',
    'delete_menu_item',
    'toggle_item_stock',
    'manual_billing:read',
    'manual_billing:write',
    'view_employees',
    'manage_employees',
    'invite_employee',
    'view_customers',
    'manage_customers',
    'view_settings',
    'manage_settings',
    'view_delivery',
    'manage_delivery',
    'assign_rider',
    'view_coupons',
    'manage_coupons',
    'view_bookings',
    'manage_bookings',
  ],
  chef: [
    'view_orders',
    'view_kitchen_orders',
    'mark_order_ready',
    'mark_order_preparing',
    'view_menu',
    'toggle_item_stock',
  ],
  waiter: [
    'view_orders',
    'view_dine_in_orders',
    'create_order',
    'mark_order_served',
    'manage_dine_in',
    'view_tables',
    'assign_table',
    'add_to_tab',
    'close_tab',
    'generate_bill',
    'view_menu',
  ],
  cashier: [
    'view_orders',
    'view_all_orders',
    'create_order',
    'manage_dine_in',
    'view_tables',
    'add_to_tab',
    'close_tab',
    'generate_bill',
    'process_payment',
    'view_payments',
    'manual_billing:read',
    'manual_billing:write',
    'view_menu',
  ],
  order_taker: ['view_orders', 'view_dine_in_orders', 'create_order', 'view_menu', 'view_tables'],
  custom: [],
};

const ROLE_DISPLAY_NAMES = {
  manager: 'Manager (All except Payouts)',
  chef: 'Chef (Kitchen & Orders only)',
  waiter: 'Waiter (Orders, Dine-in, Bookings)',
  cashier: 'Cashier (Orders & Billing)',
  order_taker: 'Order Taker (Create orders only)',
  custom: 'Custom (Select pages)',
};

const STORE_ROLE_DISPLAY_NAMES = {
  manager: 'Store Manager (Operations & Orders)',
  chef: 'Packing Staff (Order Processing)',
  waiter: 'Counter Staff (Customer Assistance)',
  cashier: 'Billing Staff (Payments & Orders)',
  order_taker: 'Sales Assistant (Create orders)',
  custom: 'Custom (Select pages)',
};

const STREET_VENDOR_ROLE_DISPLAY_NAMES = {
  manager: 'Operations Manager (Orders & Stall Ops)',
  chef: 'Cooking Staff (Preparation & Orders)',
  waiter: 'Service Staff (Customer Handling)',
  cashier: 'Billing Staff (Payments & Orders)',
  order_taker: 'Order Assistant (Create orders)',
  custom: 'Custom (Select pages)',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function getRoleDisplayName(role, collectionName) {
  const safeRole = normalizeRole(role);
  const safeCollection = normalizeText(collectionName).toLowerCase();

  if (safeCollection === 'shops') {
    return STORE_ROLE_DISPLAY_NAMES[safeRole] || ROLE_DISPLAY_NAMES[safeRole] || safeRole;
  }
  if (safeCollection === 'street_vendors') {
    return STREET_VENDOR_ROLE_DISPLAY_NAMES[safeRole] || ROLE_DISPLAY_NAMES[safeRole] || safeRole;
  }
  return ROLE_DISPLAY_NAMES[safeRole] || safeRole;
}

function resolvePermissions(inviteData = {}) {
  const permissions = Array.isArray(inviteData.permissions) ? inviteData.permissions : [];
  if (permissions.length > 0) return permissions;
  return ROLE_PERMISSIONS[normalizeRole(inviteData.role)] || [];
}

function getRedirectPath(inviteData = {}) {
  const ownerId = normalizeText(inviteData.ownerId);
  if (normalizeText(inviteData.collectionName).toLowerCase() === 'street_vendors') {
    return `/street-vendor-dashboard?employee_of=${ownerId}`;
  }
  return `/owner-dashboard/live-orders?employee_of=${ownerId}`;
}

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Authorization token is missing or malformed.');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError(401, 'Authorization token is missing or malformed.');
  }
  return token;
}

async function resolveAuthenticatedUser(req) {
  const token = extractBearerToken(req);

  let decoded;
  try {
    decoded = await verifyIdToken(token, false);
  } catch (error) {
    throw new HttpError(401, `Token verification failed: ${error?.message || 'invalid token'}`);
  }

  const uid = normalizeText(decoded?.uid);
  if (!uid) throw new HttpError(401, 'Invalid authorization token.');

  const firestore = await getFirestore();
  const userRef = firestore.collection('users').doc(uid);
  const userDoc = await userRef.get();
  const userData = userDoc.exists ? (userDoc.data() || {}) : {};

  let authEmail = normalizeEmail(decoded?.email || userData.email);
  if (!authEmail) {
    try {
      const auth = await getAuth();
      const userRecord = await auth.getUser(uid);
      authEmail = normalizeEmail(userRecord.email || '');
    } catch {
      authEmail = normalizeEmail(userData.email || '');
    }
  }

  return {
    firestore,
    uid,
    userRef,
    userDoc,
    userData,
    authEmail,
  };
}

async function resolveInvitation(firestore, inviteCode) {
  const safeCode = normalizeText(inviteCode);
  if (!safeCode) {
    throw new HttpError(400, 'Invite code is required.');
  }

  const inviteRef = firestore.collection('employee_invitations').doc(safeCode);
  const inviteDoc = await inviteRef.get();
  if (!inviteDoc.exists) {
    throw new HttpError(404, 'Invalid or expired invitation link.');
  }

  return {
    inviteRef,
    inviteDoc,
    inviteData: inviteDoc.data() || {},
  };
}

async function ensurePendingInvitation({ inviteRef, inviteData, throwOnInvalid = true }) {
  const status = normalizeText(inviteData.status).toLowerCase();
  if (status && status !== 'pending') {
    if (throwOnInvalid) {
      throw new HttpError(400, `This invitation has already been ${status}.`);
    }
    return {
      valid: false,
      status,
      message: `This invitation has been ${status}.`,
    };
  }

  const expiresAt = toDate(inviteData.expiresAt);
  if (expiresAt && new Date() > expiresAt) {
    await inviteRef.set({ status: 'expired' }, { merge: true });
    if (throwOnInvalid) {
      throw new HttpError(410, 'This invitation has expired. Please ask the owner to send a new one.');
    }
    return {
      valid: false,
      status: 'expired',
      message: 'This invitation has expired.',
    };
  }

  return {
    valid: true,
    status: 'pending',
    message: null,
  };
}

async function getEmployeeInvitePreview(req) {
  const firestore = await getFirestore();
  const inviteCode = normalizeText(req.query?.code);
  if (!inviteCode) {
    throw new HttpError(400, 'Invite code is required.');
  }

  const { inviteRef, inviteData } = await resolveInvitation(firestore, inviteCode);

  const validity = await ensurePendingInvitation({
    inviteRef,
    inviteData,
    throwOnInvalid: false,
  });

  if (!validity.valid) {
    return {
      status: 200,
      payload: {
        valid: false,
        message: validity.message,
        status: validity.status,
      },
    };
  }

  return {
    status: 200,
    payload: {
      valid: true,
      invitation: {
        outletName: inviteData.outletName,
        role: inviteData.role,
        roleDisplay: getRoleDisplayName(inviteData.role, inviteData.collectionName),
        invitedEmail: inviteData.email,
        invitedName: inviteData.name,
        expiresAt: toIso(inviteData.expiresAt),
      },
    },
  };
}

function buildLinkedOutletEntry(inviteData, permissions) {
  const role = normalizeRole(inviteData.role);
  const linkedOutlet = {
    outletId: inviteData.outletId,
    outletName: inviteData.outletName,
    collectionName: inviteData.collectionName,
    ownerId: inviteData.ownerId,
    employeeRole: role,
    permissions,
    status: 'active',
    joinedAt: new Date(),
    isActive: true,
  };

  if (role === 'custom') {
    linkedOutlet.customRoleName = inviteData.customRoleName;
    linkedOutlet.customAllowedPages = inviteData.customAllowedPages;
  }

  return linkedOutlet;
}

function buildOutletEmployeeEntry({ uid, inviteData, userData, name, phone, permissions }) {
  const role = normalizeRole(inviteData.role);
  const outletEmployee = {
    userId: uid,
    email: userData.email || inviteData.email,
    name: name || userData.name || inviteData.name || '',
    phone: phone || userData.phone || '',
    role,
    permissions,
    status: 'active',
    addedAt: new Date(),
    addedBy: inviteData.invitedBy,
  };

  if (role === 'custom') {
    outletEmployee.customRoleName = inviteData.customRoleName;
    outletEmployee.customAllowedPages = inviteData.customAllowedPages;
  }

  return outletEmployee;
}

function buildUserUpdateData({ userData, inviteData, name, phone, linkedOutletEntry }) {
  const currentRoles = Array.isArray(userData.roles) ? [...userData.roles] : [];
  const hasEmployeeRole = currentRoles.includes('employee');
  const nextRoles = hasEmployeeRole ? currentRoles : [...currentRoles, 'employee'];

  if (nextRoles.length === 1 && nextRoles[0] === 'employee') {
    nextRoles.unshift('customer');
  }

  const currentLinkedOutlets = Array.isArray(userData.linkedOutlets) ? userData.linkedOutlets : [];
  const filteredLinkedOutlets = currentLinkedOutlets.filter(
    (entry) => normalizeText(entry?.outletId) !== normalizeText(inviteData.outletId)
  );
  const linkedOutlets = [...filteredLinkedOutlets, linkedOutletEntry];

  const updateData = {
    roles: nextRoles,
    linkedOutlets,
  };

  if (name && !userData.name) updateData.name = name;
  if (phone && !userData.phone) updateData.phone = phone;
  if (!userData.email && inviteData.email) updateData.email = inviteData.email;
  if (!userData.createdAt) updateData.createdAt = FieldValue.serverTimestamp();
  if (!userData.role) updateData.role = 'employee';

  return updateData;
}

async function acceptEmployeeInvite(req) {
  const context = await resolveAuthenticatedUser(req);
  const { firestore, uid, userRef, userData, authEmail } = context;
  const body = req.body || {};

  const inviteCode = normalizeText(body.inviteCode);
  const name = normalizeText(body.name);
  const phone = normalizeText(body.phone);

  const { inviteRef, inviteData } = await resolveInvitation(firestore, inviteCode);
  await ensurePendingInvitation({ inviteRef, inviteData, throwOnInvalid: true });

  const inviteEmail = normalizeEmail(inviteData.email);
  if (authEmail && inviteEmail && authEmail !== inviteEmail) {
    throw new HttpError(
      403,
      `This invitation was sent to ${inviteData.email}. Please sign in with that email.`
    );
  }

  const collectionName = normalizeText(inviteData.collectionName);
  const outletId = normalizeText(inviteData.outletId);
  if (!collectionName || !outletId) {
    throw new HttpError(400, 'Invitation is missing outlet details.');
  }

  const outletRef = firestore.collection(collectionName).doc(outletId);
  const outletDoc = await outletRef.get();
  if (!outletDoc.exists) {
    throw new HttpError(404, 'Outlet linked to this invitation no longer exists.');
  }

  const permissions = resolvePermissions(inviteData);
  const outletEmployeeEntry = buildOutletEmployeeEntry({
    uid,
    inviteData,
    userData,
    name,
    phone,
    permissions,
  });
  const linkedOutletEntry = buildLinkedOutletEntry(inviteData, permissions);
  const userUpdateData = buildUserUpdateData({
    userData,
    inviteData,
    name,
    phone,
    linkedOutletEntry,
  });

  const employeeSubDocRef = outletRef.collection('employees').doc(uid);
  const employeeSubDocPayload = {
    userId: uid,
    ownerId: inviteData.ownerId || outletId,
    outletId,
    collectionName,
    email: outletEmployeeEntry.email || null,
    name: outletEmployeeEntry.name || '',
    phone: outletEmployeeEntry.phone || '',
    role: outletEmployeeEntry.role,
    permissions: outletEmployeeEntry.permissions || [],
    status: 'active',
    addedAt: FieldValue.serverTimestamp(),
    addedBy: inviteData.invitedBy || inviteData.ownerId || null,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (outletEmployeeEntry.role === 'custom') {
    employeeSubDocPayload.customRoleName = inviteData.customRoleName || 'Custom';
    employeeSubDocPayload.customAllowedPages = Array.isArray(inviteData.customAllowedPages)
      ? inviteData.customAllowedPages
      : [];
  }

  const batch = firestore.batch();
  batch.set(
    outletRef,
    {
      employees: FieldValue.arrayUnion(outletEmployeeEntry),
      features: {
        employeeManagement: true,
      },
      updatedAt: new Date(),
    },
    { merge: true }
  );
  batch.set(employeeSubDocRef, employeeSubDocPayload, { merge: true });
  batch.set(userRef, userUpdateData, { merge: true });
  batch.set(
    inviteRef,
    {
      status: 'accepted',
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedBy: uid,
    },
    { merge: true }
  );

  await batch.commit();

  return {
    message: 'Welcome to the team!',
    employee: {
      outletId: inviteData.outletId,
      outletName: inviteData.outletName,
      role: outletEmployeeEntry.role,
      roleDisplay: getRoleDisplayName(inviteData.role, inviteData.collectionName),
      permissions: linkedOutletEntry.permissions,
    },
    redirectTo: getRedirectPath(inviteData),
  };
}

module.exports = {
  acceptEmployeeInvite,
  getEmployeeInvitePreview,
};
