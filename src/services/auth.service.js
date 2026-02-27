const { getAuth, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { verifyAndGetUid } = require('./authIdentity.service');

const OWNER_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function getBusinessTypeFromRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'shop-owner') return 'store';
  if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street-vendor';
  if (normalized === 'restaurant-owner') return 'restaurant';
  return null;
}

async function resolveBusinessType(firestore, uid, role, currentBusinessType) {
  if (currentBusinessType) {
    const normalized = String(currentBusinessType).trim().toLowerCase();
    if (normalized === 'street_vendor') return 'street-vendor';
    if (normalized === 'shop') return 'store';
    return normalized;
  }

  const roleMappedType = getBusinessTypeFromRole(role);
  if (roleMappedType) return roleMappedType;
  if (!OWNER_ROLES.has(normalizeRole(role))) return null;

  const checks = [
    { collection: 'restaurants', type: 'restaurant' },
    { collection: 'shops', type: 'store' },
    { collection: 'street_vendors', type: 'street-vendor' },
  ];

  for (const check of checks) {
    const snap = await firestore
      .collection(check.collection)
      .where('ownerId', '==', uid)
      .limit(1)
      .get();
    if (!snap.empty) return check.type;
  }

  return null;
}

async function postAuthLogin(req) {
  const auth = await getAuth();
  const body = req.body || {};
  const email = String(body.email || '').trim();
  const password = String(body.password || '').trim();

  if (!email || !password) {
    throw new HttpError(400, 'Email and password are required.');
  }

  try {
    const userRecord = await auth.getUserByEmail(email);
    if (!userRecord) {
      throw new HttpError(401, 'Invalid credentials. User not found.');
    }

    if (!userRecord.emailVerified) {
      throw new HttpError(403, 'Your account is not verified. Please check your email for a verification link.');
    }

    const role = userRecord.customClaims?.role || null;
    const isNewUser = !role;

    return {
      message: 'Server acknowledged login. Client should now have ID token.',
      role,
      isNewUser,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.code === 'auth/user-not-found') {
      throw new HttpError(401, 'Invalid credentials. User not found.');
    }
    if (
      error?.code === 'auth/argument-error'
      && String(error?.message || '').includes('Firebase ID token has incorrect "aud" (audience) claim')
    ) {
      throw new HttpError(500, `Critical Backend Mismatch: ${error.message}`);
    }
    throw new HttpError(500, `Backend Error: ${error.message}`);
  }
}

async function postAuthLoginGoogleAck() {
  return {
    message: 'Client-side authentication acknowledged. The client is responsible for handling user redirection based on their role.',
  };
}

async function postAuthForgotPassword(req) {
  const auth = await getAuth();
  const email = String(req.body?.email || '').trim();
  if (!email) {
    throw new HttpError(400, 'Email is required.');
  }

  try {
    await auth.generatePasswordResetLink(email);
    return { message: 'If an account with this email exists, a reset link has been sent.' };
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      return { message: 'If an account with this email exists, a reset link has been sent.' };
    }
    throw new HttpError(500, `Backend Error: ${error.message}`);
  }
}

async function postAuthSignupOwnerDeprecated() {
  return {
    status: 410,
    payload: {
      message: 'This signup method is deprecated. Please use Google Sign-In on the homepage.',
    },
  };
}

async function postAuthCheckRole(req) {
  const uid = await verifyAndGetUid(req, { checkRevoked: false });
  const firestore = await getFirestore();

  const userDoc = await firestore.collection('users').doc(uid).get();
  if (userDoc.exists) {
    const userData = userDoc.data() || {};
    const role = userData.role;
    const businessType = await resolveBusinessType(firestore, uid, role, userData.businessType || null);
    const linkedOutlets = Array.isArray(userData.linkedOutlets) ? userData.linkedOutlets : [];

    const hasEmployeeRole = linkedOutlets.some((outlet) => outlet?.status === 'active');
    const normalizedRole = normalizeRole(role);
    const isOwnerOrVendor = (
      normalizedRole === 'owner'
      || normalizedRole === 'street-vendor'
      || normalizedRole === 'restaurant-owner'
      || normalizedRole === 'shop-owner'
    );

    if (hasEmployeeRole && (isOwnerOrVendor || normalizedRole === 'customer' || normalizedRole === 'admin')) {
      return {
        role,
        businessType,
        hasMultipleRoles: true,
        linkedOutlets: linkedOutlets
          .filter((outlet) => outlet?.status === 'active')
          .map((outlet) => ({
            outletId: outlet.outletId,
            outletName: outlet.outletName,
            employeeRole: outlet.employeeRole,
            collectionName: outlet.collectionName,
            ownerId: outlet.ownerId,
          })),
      };
    }

    if (hasEmployeeRole && (!role || normalizedRole === 'customer' || normalizedRole === 'employee')) {
      const primaryOutlet = linkedOutlets.find((outlet) => outlet?.status === 'active' && outlet?.isActive);
      const firstActiveOutlet = linkedOutlets.find((outlet) => outlet?.status === 'active');
      const outlet = primaryOutlet || firstActiveOutlet;
      if (outlet) {
        const redirectTo = outlet.collectionName === 'street_vendors'
          ? '/street-vendor-dashboard'
          : '/owner-dashboard/live-orders';

        return {
          role: 'employee',
          employeeRole: outlet.employeeRole,
          businessType: null,
          redirectTo,
          outletName: outlet.outletName,
        };
      }
    }

    const auth = await getAuth();
    const userRecord = await auth.getUser(uid);
    const customClaims = userRecord.customClaims || {};

    if (normalizedRole === 'admin' && !customClaims?.isAdmin) {
      await auth.setCustomUserClaims(uid, { isAdmin: true });
    } else if (normalizedRole !== 'admin' && customClaims?.isAdmin) {
      await auth.setCustomUserClaims(uid, { isAdmin: null });
    }

    if (role) {
      return { role, businessType };
    }
  }

  const driverDoc = await firestore.collection('drivers').doc(uid).get();
  if (driverDoc.exists) {
    return { role: 'rider', businessType: null };
  }

  throw new HttpError(404, 'User profile not found.');
}

module.exports = {
  postAuthLogin,
  postAuthLoginGoogleAck,
  postAuthForgotPassword,
  postAuthSignupOwnerDeprecated,
  postAuthCheckRole,
};
