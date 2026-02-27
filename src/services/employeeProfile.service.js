const { getAuth, getFirestore, verifyIdToken } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

const OWNER_LIKE_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || '').trim();
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

function isOwnerLikeUser(userData = {}) {
  const role = normalizeRole(userData.role);
  return OWNER_LIKE_ROLES.has(role) || Boolean(userData.businessType);
}

function filterActiveEmployees(docs, ownerId) {
  const scopedOwnerId = normalizeText(ownerId);
  return (docs || []).filter((doc) => {
    const data = doc.data() || {};
    if (String(data.status || '').toLowerCase() !== 'active') return false;
    if (!scopedOwnerId) return true;
    return normalizeText(data.ownerId) === scopedOwnerId;
  });
}

async function resolveCurrentUser(req) {
  const token = extractBearerToken(req);
  let decoded;
  try {
    decoded = await verifyIdToken(token, false);
  } catch {
    throw new HttpError(401, 'Token verification failed.');
  }

  const uid = normalizeText(decoded?.uid);
  if (!uid) throw new HttpError(401, 'Invalid token.');

  const [firestore, auth] = await Promise.all([getFirestore(), getAuth()]);
  const userDoc = await firestore.collection('users').doc(uid).get();
  const userData = userDoc.exists ? (userDoc.data() || {}) : {};

  let authEmail = normalizeEmail(decoded?.email || userData.email);
  if (!authEmail) {
    try {
      const userRecord = await auth.getUser(uid);
      authEmail = normalizeEmail(userRecord.email || '');
    } catch {
      authEmail = normalizeEmail(userData.email || '');
    }
  }

  return {
    uid,
    firestore,
    auth,
    userDoc,
    userData,
    authEmail,
  };
}

async function findEmployeeRecord({ firestore, uid, authEmail, ownerId }) {
  let matchingEmployees = [];

  try {
    const byUidSnap = await firestore.collectionGroup('employees').where('userId', '==', uid).get();
    matchingEmployees = filterActiveEmployees(byUidSnap.docs, ownerId);
  } catch {
    matchingEmployees = [];
  }

  if (matchingEmployees.length > 0) return matchingEmployees[0];

  const normalizedEmail = normalizeEmail(authEmail);
  if (!normalizedEmail) return null;

  try {
    const byEmailSnap = await firestore
      .collectionGroup('employees')
      .where('email', '==', normalizedEmail)
      .get();
    const emailMatches = filterActiveEmployees(byEmailSnap.docs, ownerId);
    return emailMatches[0] || null;
  } catch {
    return null;
  }
}

function mapEmployeeResponse(doc) {
  const data = doc.data() || {};
  return {
    isEmployee: true,
    role: data.role || null,
    ownerId: data.ownerId || null,
    outletId: data.outletId || data.ownerId || null,
    name: data.name || null,
    phone: data.phone || null,
  };
}

async function getEmployeeMe(req) {
  const ownerId = normalizeText(req.query.employee_of);
  const context = await resolveCurrentUser(req);
  const { uid, userData, firestore, authEmail } = context;

  if (!ownerId && isOwnerLikeUser(userData)) {
    return {
      isEmployee: false,
      role: 'owner',
      ownerId: uid,
      name: userData.name || null,
      phone: userData.phone || null,
    };
  }

  const employeeDoc = await findEmployeeRecord({
    firestore,
    uid,
    authEmail,
    ownerId,
  });

  if (!employeeDoc) {
    return {
      isEmployee: false,
      role: null,
      message: 'User is not an employee of this outlet',
    };
  }

  return mapEmployeeResponse(employeeDoc);
}

async function patchEmployeeMe(req) {
  const ownerId = normalizeText(req.query.employee_of);
  const context = await resolveCurrentUser(req);
  const { uid, userData, firestore, authEmail } = context;

  const body = req.body || {};
  const name = body.name !== undefined ? normalizeText(body.name) : undefined;
  const phone = body.phone !== undefined ? normalizeText(body.phone) : undefined;

  if (name === undefined && phone === undefined) {
    throw new HttpError(400, 'At least one field (name or phone) is required.');
  }

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;

  if (!ownerId && isOwnerLikeUser(userData)) {
    await firestore.collection('users').doc(uid).set(updateData, { merge: true });
    return {
      message: 'Profile updated successfully',
      name: name !== undefined ? name : (userData.name || null),
      phone: phone !== undefined ? phone : (userData.phone || null),
    };
  }

  const employeeDoc = await findEmployeeRecord({
    firestore,
    uid,
    authEmail,
    ownerId,
  });

  if (!employeeDoc) {
    throw new HttpError(404, 'Employee record not found.');
  }

  await employeeDoc.ref.update(updateData);
  await firestore.collection('users').doc(uid).set(updateData, { merge: true });

  const employeeData = employeeDoc.data() || {};

  return {
    message: 'Profile updated successfully',
    name: name !== undefined ? name : (employeeData.name || null),
    phone: phone !== undefined ? phone : (employeeData.phone || null),
  };
}

module.exports = {
  getEmployeeMe,
  patchEmployeeMe,
};
