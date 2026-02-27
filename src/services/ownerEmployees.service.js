const { randomBytes } = require('crypto');
const { FieldValue } = require('../lib/firebaseAdmin');
const { config } = require('../config/env');
const { HttpError } = require('../utils/httpError');
const { normalizeBusinessType } = require('./business.service');
const { resolveOwnerContext } = require('./accessControl.service');

const EMPLOYEE_ROLES = ['manager', 'chef', 'waiter', 'cashier', 'order_taker', 'custom'];
const OWNER_ALLOWED_ROLES = new Set(['owner', 'street-vendor', 'manager']);
const REMOVE_ALLOWED_ROLES = new Set(['owner', 'street-vendor']);

const ROLE_LEVEL = {
  owner: 100,
  'street-vendor': 100,
  manager: 80,
  cashier: 50,
  waiter: 40,
  chef: 40,
  order_taker: 20,
  custom: 10,
};

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

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'street_vendor') return 'street-vendor';
  if (normalized === 'restaurant-owner' || normalized === 'shop-owner' || normalized === 'store-owner') {
    return 'owner';
  }
  return normalized;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function toBusinessType(collectionName, businessType) {
  const normalized = normalizeBusinessType(businessType, collectionName);
  return normalized || 'restaurant';
}

function getRoleLevel(role) {
  return ROLE_LEVEL[normalizeRole(role)] || 0;
}

function canManageRole(actorRole, targetRole) {
  return getRoleLevel(actorRole) > getRoleLevel(targetRole);
}

function ensureActionRole(owner, allowedRoles = OWNER_ALLOWED_ROLES) {
  if (owner.isAdminImpersonation) return;
  const callerRole = normalizeRole(owner.callerRole);
  if (allowedRoles.has(callerRole)) return;
  throw new HttpError(403, 'Access denied: insufficient privileges for employee management.');
}

function getRoleDisplayName(role, businessType = 'restaurant') {
  const normalizedRole = normalizeRole(role);
  if (businessType === 'store') {
    return STORE_ROLE_DISPLAY_NAMES[normalizedRole] || ROLE_DISPLAY_NAMES[normalizedRole] || normalizedRole;
  }
  if (businessType === 'street-vendor') {
    return STREET_VENDOR_ROLE_DISPLAY_NAMES[normalizedRole] || ROLE_DISPLAY_NAMES[normalizedRole] || normalizedRole;
  }
  return ROLE_DISPLAY_NAMES[normalizedRole] || normalizedRole;
}

function getInvitableRoles(callerRole) {
  const role = normalizeRole(callerRole);
  return EMPLOYEE_ROLES.filter((value) => canManageRole(role, value));
}

function generateInviteCode() {
  return randomBytes(16).toString('hex');
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function getOwnerRoleDisplayLabel(businessType) {
  if (businessType === 'store') return 'Store Owner';
  if (businessType === 'street-vendor') return 'Street Vendor Owner';
  return 'Restaurant Owner';
}

function mergeEmployeeRecords({ legacyEmployees = [], employeeDocs = [] }) {
  const byUserId = new Map();

  employeeDocs.forEach((doc) => {
    const data = doc.data() || {};
    byUserId.set(doc.id, {
      userId: doc.id,
      ...data,
      role: normalizeRole(data.role || ''),
      status: String(data.status || 'active').trim().toLowerCase() || 'active',
    });
  });

  legacyEmployees.forEach((entry) => {
    const userId = normalizeText(entry?.userId);
    if (!userId) return;
    const existing = byUserId.get(userId) || {};
    byUserId.set(userId, {
      ...entry,
      ...existing,
      userId,
      role: normalizeRole(existing.role || entry.role || ''),
      status: String(existing.status || entry.status || 'active').trim().toLowerCase() || 'active',
    });
  });

  return byUserId;
}

function validateInvitePayload({ email, role, customRoleName, customAllowedPages }) {
  if (!email || !role) {
    throw new HttpError(400, 'Email and role are required.');
  }

  const safeRole = normalizeRole(role);
  if (!EMPLOYEE_ROLES.includes(safeRole)) {
    throw new HttpError(
      400,
      `Invalid role. Must be one of: ${EMPLOYEE_ROLES.join(', ')}.`
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new HttpError(400, 'Invalid email format.');
  }

  if (safeRole === 'custom') {
    if (!normalizeText(customRoleName)) {
      throw new HttpError(400, 'Custom role requires a role name.');
    }
    if (!Array.isArray(customAllowedPages) || customAllowedPages.length === 0) {
      throw new HttpError(400, 'Custom role requires at least one allowed page.');
    }
  }

  return safeRole;
}

async function findActiveEmployeeByEmail({ businessRef, email }) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail) return false;

  try {
    const indexed = await businessRef
      .collection('employees')
      .where('email', '==', safeEmail)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    return !indexed.empty;
  } catch {
    const fallback = await businessRef.collection('employees').get();
    return fallback.docs.some((doc) => {
      const data = doc.data() || {};
      return normalizeEmail(data.email) === safeEmail && String(data.status || 'active') === 'active';
    });
  }
}

async function hasPendingInvite({ firestore, outletId, email }) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail) return false;

  try {
    const query = await firestore
      .collection('employee_invitations')
      .where('outletId', '==', outletId)
      .where('status', '==', 'pending')
      .get();
    return query.docs.some((doc) => normalizeEmail(doc.data()?.email) === safeEmail);
  } catch {
    const fallback = await firestore
      .collection('employee_invitations')
      .where('outletId', '==', outletId)
      .get();
    return fallback.docs.some((doc) => {
      const data = doc.data() || {};
      return String(data.status || '').toLowerCase() === 'pending' && normalizeEmail(data.email) === safeEmail;
    });
  }
}

async function getOwnerEmployees(req) {
  const owner = await resolveOwnerContext(req, {
    allowEmployee: true,
    allowAdminImpersonation: true,
  });
  ensureActionRole(owner, OWNER_ALLOWED_ROLES);

  const businessData = owner.businessData || {};
  const businessRef = owner.businessSnap.ref;
  const businessType = toBusinessType(owner.collectionName, businessData.businessType);
  const callerRole = owner.isAdminImpersonation ? 'owner' : normalizeRole(owner.callerRole);

  const [employeeDocsSnap, pendingInvitesSnap] = await Promise.all([
    businessRef.collection('employees').get(),
    (async () => {
      try {
        return await owner.firestore
          .collection('employee_invitations')
          .where('outletId', '==', owner.businessId)
          .where('status', '==', 'pending')
          .get();
      } catch {
        return owner.firestore
          .collection('employee_invitations')
          .where('outletId', '==', owner.businessId)
          .get();
      }
    })(),
  ]);

  const legacyEmployees = Array.isArray(businessData.employees) ? businessData.employees : [];
  const mergedEmployees = mergeEmployeeRecords({
    legacyEmployees,
    employeeDocs: employeeDocsSnap.docs,
  });

  mergedEmployees.delete(owner.ownerUid);

  const employees = Array.from(mergedEmployees.values())
    .map((employee) => ({
      ...employee,
      role: normalizeRole(employee.role || ''),
      roleDisplay: normalizeRole(employee.role) === 'custom'
        ? (normalizeText(employee.customRoleName) || 'Custom')
        : getRoleDisplayName(employee.role, businessType),
      hierarchyOrder: getRoleLevel(employee.role),
      status: String(employee.status || 'active').trim().toLowerCase() || 'active',
    }))
    .sort((a, b) => {
      const levelDiff = (b.hierarchyOrder || 0) - (a.hierarchyOrder || 0);
      if (levelDiff !== 0) return levelDiff;
      const aName = normalizeText(a.name).toLowerCase();
      const bName = normalizeText(b.name).toLowerCase();
      return aName.localeCompare(bName);
    });

  const ownerEntry = {
    userId: owner.ownerUid,
    email: businessData.ownerEmail || businessData.email || '',
    name: businessData.ownerName || businessData.name || 'Owner',
    phone: businessData.ownerPhone || businessData.phone || '',
    role: 'owner',
    roleDisplay: getOwnerRoleDisplayLabel(businessType),
    status: 'active',
    hierarchyOrder: getRoleLevel('owner'),
    isOwner: true,
  };

  const pendingInvites = pendingInvitesSnap.docs
    .map((doc) => {
      const data = doc.data() || {};
      if (String(data.status || '').toLowerCase() !== 'pending') return null;
      const inviteRole = normalizeRole(data.role);
      return {
        id: doc.id,
        ...data,
        role: inviteRole,
        roleDisplay: inviteRole === 'custom'
          ? (normalizeText(data.customRoleName) || 'Custom')
          : getRoleDisplayName(inviteRole, businessType),
        status: 'pending',
        createdAt: toIso(data.createdAt) || data.createdAt || null,
        expiresAt: toIso(data.expiresAt) || data.expiresAt || null,
        hierarchyOrder: getRoleLevel(inviteRole),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.hierarchyOrder || 0) - (a.hierarchyOrder || 0));

  const invitableRoles = getInvitableRoles(callerRole).map((role) => ({
    value: role,
    label: getRoleDisplayName(role, businessType),
  }));

  const canInvite = owner.isAdminImpersonation || OWNER_ALLOWED_ROLES.has(callerRole);
  const canManage = owner.isAdminImpersonation || OWNER_ALLOWED_ROLES.has(callerRole);

  return {
    employees: [ownerEntry, ...employees],
    pendingInvites,
    invitableRoles,
    currentUserId: owner.actorUid,
    canInvite,
    canManage,
  };
}

async function createOwnerEmployeeInvite(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    allowEmployee: true,
    allowAdminImpersonation: true,
  });
  ensureActionRole(owner, OWNER_ALLOWED_ROLES);

  const callerRole = owner.isAdminImpersonation ? 'owner' : normalizeRole(owner.callerRole);
  const body = req.body || {};

  const email = normalizeEmail(body.email);
  const name = normalizeText(body.name);
  const phone = normalizeText(body.phone);
  const customRoleName = normalizeText(body.customRoleName);
  const customAllowedPages = Array.isArray(body.customAllowedPages) ? body.customAllowedPages : [];
  const customPermissions = Array.isArray(body.customPermissions) ? body.customPermissions : null;
  const role = validateInvitePayload({
    email,
    role: body.role,
    customRoleName,
    customAllowedPages,
  });

  if (!canManageRole(callerRole, role)) {
    throw new HttpError(403, `You cannot invite ${role}.`);
  }

  const businessData = owner.businessData || {};
  const businessRef = owner.businessSnap.ref;
  const businessType = toBusinessType(owner.collectionName, businessData.businessType);

  const duplicateInSubCollection = await findActiveEmployeeByEmail({
    businessRef,
    email,
  });
  if (duplicateInSubCollection) {
    throw new HttpError(409, 'This email is already an employee at this outlet.');
  }

  const duplicateInLegacyArray = (Array.isArray(businessData.employees) ? businessData.employees : [])
    .some((entry) =>
      normalizeEmail(entry?.email) === email
      && String(entry?.status || 'active').trim().toLowerCase() === 'active'
    );
  if (duplicateInLegacyArray) {
    throw new HttpError(409, 'This email is already an employee at this outlet.');
  }

  const alreadyInvited = await hasPendingInvite({
    firestore: owner.firestore,
    outletId: owner.businessId,
    email,
  });
  if (alreadyInvited) {
    throw new HttpError(409, 'An invitation is already pending for this email.');
  }

  const inviteCode = generateInviteCode();
  const permissions = customPermissions || ROLE_PERMISSIONS[role] || [];
  const inviteRef = owner.firestore.collection('employee_invitations').doc(inviteCode);

  await inviteRef.set({
    inviteCode,
    email,
    name,
    phone,
    role,
    permissions,
    outletId: owner.businessId,
    outletName: businessData.name || 'Outlet',
    collectionName: owner.collectionName,
    ownerId: owner.ownerUid,
    invitedBy: owner.actorUid,
    invitedByName: normalizeText(body.invitedByName) || normalizeText(businessData.name) || owner.actorUid,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    ...(role === 'custom'
      ? {
        customRoleName,
        customAllowedPages,
      }
      : {}),
  });

  const appBase = config.publicBaseUrl || config.legacy.baseUrl || 'https://www.servizephyr.com';
  const inviteLink = `${appBase.replace(/\/+$/, '')}/join/${inviteCode}`;

  return {
    message: 'Invitation sent successfully!',
    invitation: {
      email,
      role,
      roleDisplay: role === 'custom' ? customRoleName : getRoleDisplayName(role, businessType),
      inviteLink,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    },
  };
}

function findLegacyEmployeeIndex(employees, userId) {
  return employees.findIndex((entry) => normalizeText(entry?.userId) === normalizeText(userId));
}

async function patchOwnerEmployee(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    allowEmployee: true,
    allowAdminImpersonation: true,
  });
  ensureActionRole(owner, OWNER_ALLOWED_ROLES);

  const callerRole = owner.isAdminImpersonation ? 'owner' : normalizeRole(owner.callerRole);
  const businessData = owner.businessData || {};
  const businessRef = owner.businessSnap.ref;

  const body = req.body || {};
  const employeeId = normalizeText(body.employeeId);
  const action = normalizeText(body.action).toLowerCase();

  if (!employeeId || !action) {
    throw new HttpError(400, 'Employee ID and action are required.');
  }

  const employeeRef = businessRef.collection('employees').doc(employeeId);
  const employeeDoc = await employeeRef.get();

  const legacyEmployees = Array.isArray(businessData.employees) ? [...businessData.employees] : [];
  const legacyIndex = findLegacyEmployeeIndex(legacyEmployees, employeeId);
  const legacyEmployee = legacyIndex >= 0 ? legacyEmployees[legacyIndex] : null;

  if (!employeeDoc.exists && !legacyEmployee) {
    throw new HttpError(404, 'Employee not found.');
  }

  const currentEmployee = employeeDoc.exists
    ? { userId: employeeDoc.id, ...(employeeDoc.data() || {}) }
    : { userId: employeeId, ...(legacyEmployee || {}) };

  const targetRole = normalizeRole(currentEmployee.role);
  if (!canManageRole(callerRole, targetRole)) {
    throw new HttpError(403, 'You cannot manage employees at or above your level.');
  }

  const updates = {};
  switch (action) {
    case 'deactivate':
      updates.status = 'inactive';
      updates.deactivatedAt = new Date();
      updates.deactivatedBy = owner.actorUid;
      break;
    case 'reactivate':
      updates.status = 'active';
      updates.reactivatedAt = new Date();
      updates.reactivatedBy = owner.actorUid;
      break;
    case 'updaterole': {
      const newRole = normalizeRole(body.newRole);
      if (!EMPLOYEE_ROLES.includes(newRole)) {
        throw new HttpError(400, 'Invalid new role.');
      }
      if (!canManageRole(callerRole, newRole)) {
        throw new HttpError(403, 'You cannot assign this role.');
      }
      updates.role = newRole;
      updates.permissions = ROLE_PERMISSIONS[newRole] || [];
      break;
    }
    case 'updatepermissions':
      if (!Array.isArray(body.newPermissions)) {
        throw new HttpError(400, 'New permissions array required.');
      }
      updates.permissions = body.newPermissions;
      break;
    default:
      throw new HttpError(400, 'Invalid action.');
  }

  updates.updatedAt = new Date();
  updates.updatedBy = owner.actorUid;

  const batch = owner.firestore.batch();

  if (employeeDoc.exists) {
    batch.set(employeeRef, updates, { merge: true });
  } else {
    batch.set(employeeRef, {
      ...currentEmployee,
      ...updates,
      addedAt: currentEmployee.addedAt || new Date(),
    }, { merge: true });
  }

  const nextLegacyEmployees = [...legacyEmployees];
  if (legacyIndex >= 0) {
    nextLegacyEmployees[legacyIndex] = {
      ...nextLegacyEmployees[legacyIndex],
      ...updates,
    };
  } else {
    nextLegacyEmployees.push({
      userId: employeeId,
      ...currentEmployee,
      ...updates,
    });
  }

  batch.update(businessRef, {
    employees: nextLegacyEmployees,
    updatedAt: new Date(),
  });

  await batch.commit();

  const employeeUserRef = owner.firestore.collection('users').doc(employeeId);
  const employeeUserDoc = await employeeUserRef.get();
  if (employeeUserDoc.exists) {
    const employeeUserData = employeeUserDoc.data() || {};
    const linkedOutlets = Array.isArray(employeeUserData.linkedOutlets)
      ? [...employeeUserData.linkedOutlets]
      : [];

    const outletIndex = linkedOutlets.findIndex(
      (entry) => normalizeText(entry?.outletId) === owner.businessId
    );

    if (outletIndex >= 0) {
      const nextOutlet = { ...linkedOutlets[outletIndex] };
      if (updates.status) nextOutlet.status = updates.status;
      if (updates.role) nextOutlet.employeeRole = updates.role;
      if (updates.permissions) nextOutlet.permissions = updates.permissions;
      linkedOutlets[outletIndex] = nextOutlet;
      await employeeUserRef.update({ linkedOutlets });
    }
  }

  return {
    message: `Employee ${action} successfully.`,
    employee: {
      ...currentEmployee,
      ...updates,
      userId: employeeId,
    },
  };
}

async function deleteOwnerEmployee(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    allowEmployee: true,
    allowAdminImpersonation: true,
  });
  ensureActionRole(owner, REMOVE_ALLOWED_ROLES);

  const callerRole = owner.isAdminImpersonation ? 'owner' : normalizeRole(owner.callerRole);
  const businessRef = owner.businessSnap.ref;
  const businessData = owner.businessData || {};
  const inviteCode = normalizeText(req.query.inviteCode);
  const employeeId = normalizeText(req.query.employeeId);

  if (!inviteCode && !employeeId) {
    throw new HttpError(400, 'Employee ID or invite code required.');
  }

  if (inviteCode) {
    const inviteRef = owner.firestore.collection('employee_invitations').doc(inviteCode);
    const inviteDoc = await inviteRef.get();
    if (!inviteDoc.exists || normalizeText(inviteDoc.data()?.outletId) !== owner.businessId) {
      throw new HttpError(404, 'Invitation not found.');
    }
    await inviteRef.update({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: owner.actorUid,
    });
    return {
      message: 'Invitation cancelled.',
    };
  }

  const employeeRef = businessRef.collection('employees').doc(employeeId);
  const employeeDoc = await employeeRef.get();
  const legacyEmployees = Array.isArray(businessData.employees) ? [...businessData.employees] : [];
  const legacyIndex = findLegacyEmployeeIndex(legacyEmployees, employeeId);
  const legacyEmployee = legacyIndex >= 0 ? legacyEmployees[legacyIndex] : null;

  if (!employeeDoc.exists && !legacyEmployee) {
    throw new HttpError(404, 'Employee not found.');
  }

  const currentEmployee = employeeDoc.exists
    ? { userId: employeeDoc.id, ...(employeeDoc.data() || {}) }
    : { userId: employeeId, ...(legacyEmployee || {}) };

  if (!canManageRole(callerRole, normalizeRole(currentEmployee.role))) {
    throw new HttpError(403, 'You cannot remove employees at or above your level.');
  }

  const batch = owner.firestore.batch();
  if (employeeDoc.exists) {
    batch.delete(employeeRef);
  }

  const nextLegacyEmployees = legacyEmployees.filter(
    (entry) => normalizeText(entry?.userId) !== employeeId
  );
  batch.update(businessRef, {
    employees: nextLegacyEmployees,
    updatedAt: new Date(),
  });

  await batch.commit();

  const employeeUserRef = owner.firestore.collection('users').doc(employeeId);
  const employeeUserDoc = await employeeUserRef.get();
  if (employeeUserDoc.exists) {
    const employeeUserData = employeeUserDoc.data() || {};
    const linkedOutlets = Array.isArray(employeeUserData.linkedOutlets)
      ? employeeUserData.linkedOutlets
      : [];
    const nextLinkedOutlets = linkedOutlets.filter(
      (entry) => normalizeText(entry?.outletId) !== owner.businessId
    );

    const updateData = {
      linkedOutlets: nextLinkedOutlets,
    };

    if (nextLinkedOutlets.length === 0) {
      const currentRoles = Array.isArray(employeeUserData.roles) ? employeeUserData.roles : [];
      const nextRoles = currentRoles.filter((role) => normalizeRole(role) !== 'employee');
      updateData.roles = nextRoles.length > 0 ? nextRoles : ['customer'];
      updateData.role = updateData.roles[0];
    }

    await employeeUserRef.update(updateData);
  }

  return {
    message: 'Employee removed successfully.',
  };
}

module.exports = {
  getOwnerEmployees,
  createOwnerEmployeeInvite,
  patchOwnerEmployee,
  deleteOwnerEmployee,
};
