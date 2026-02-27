const { getAuth, FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveAdminContext } = require('./adminAccess.service');

const TIMESTAMP_FIELDS = ['createdAt', 'created_at', 'registeredAt', 'timestamp', 'createdDate'];

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

function capitalizeStatus(status) {
  const safeStatus = normalizeText(status).toLowerCase() || 'pending';
  return safeStatus.charAt(0).toUpperCase() + safeStatus.slice(1);
}

function resolveBusinessType(collectionName, businessType) {
  const normalized = normalizeText(businessType).toLowerCase();
  if (normalized === 'shop') return 'store';
  if (normalized === 'street_vendor') return 'street-vendor';
  if (normalized) return normalized;
  if (collectionName === 'shops') return 'store';
  if (collectionName === 'street_vendors') return 'street-vendor';
  return 'restaurant';
}

function resolveCollectionFromBusinessType(businessType) {
  const normalized = normalizeText(businessType).toLowerCase();
  if (normalized === 'restaurant') return 'restaurants';
  if (normalized === 'shop' || normalized === 'store') return 'shops';
  if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street_vendors';
  return null;
}

function pickOnboardedDate(data = {}) {
  for (const field of TIMESTAMP_FIELDS) {
    const iso = toIso(data[field]);
    if (iso) return iso;
  }
  return 'Unknown';
}

async function resolveOwnerIdentity({ firestore, auth, ownerId }) {
  const safeOwnerId = normalizeText(ownerId);
  if (!safeOwnerId) {
    return {
      ownerName: 'N/A',
      ownerEmail: 'N/A',
      ownerPhone: 'N/A',
    };
  }

  const fallback = {
    ownerName: 'N/A',
    ownerEmail: 'N/A',
    ownerPhone: 'N/A',
  };

  try {
    const userDoc = await firestore.collection('users').doc(safeOwnerId).get();
    if (userDoc.exists) {
      const userData = userDoc.data() || {};
      return {
        ownerName: userData.name || userData.displayName || 'No Name',
        ownerEmail: userData.email || 'No Email',
        ownerPhone: userData.phoneNumber || userData.phone || 'No Phone',
      };
    }
  } catch {
    return fallback;
  }

  try {
    const userRecord = await auth.getUser(safeOwnerId);
    return {
      ownerName: userRecord.displayName || 'No Name',
      ownerEmail: userRecord.email || 'No Email',
      ownerPhone: userRecord.phoneNumber || 'No Phone',
    };
  } catch {
    return fallback;
  }
}

async function fetchCollectionListings({ firestore, auth, collectionName }) {
  const snapshot = await firestore.collection(collectionName).get();
  const listings = await Promise.all(
    snapshot.docs.map(async (doc) => {
      const data = doc.data() || {};
      if (Object.keys(data).length === 0) return null;

      const ownerId = normalizeText(data.ownerId);
      const ownerIdentity = await resolveOwnerIdentity({
        firestore,
        auth,
        ownerId,
      });

      return {
        id: doc.id,
        name: data.name || 'Unnamed Business',
        ownerId: ownerId || null,
        ownerName: ownerIdentity.ownerName,
        ownerEmail: ownerIdentity.ownerEmail,
        ownerPhone: ownerIdentity.ownerPhone,
        onboarded: pickOnboardedDate(data),
        status: capitalizeStatus(data.approvalStatus),
        restrictedFeatures: Array.isArray(data.restrictedFeatures) ? data.restrictedFeatures : [],
        suspensionRemark: data.suspensionRemark || '',
        businessType: resolveBusinessType(collectionName, data.businessType),
      };
    })
  );

  return listings.filter(Boolean);
}

function sortListingsByOnboarded(listings = []) {
  listings.sort((a, b) => {
    const dateA = new Date(a.onboarded);
    const dateB = new Date(b.onboarded);

    const isValidA = !Number.isNaN(dateA.getTime()) && a.onboarded !== 'Unknown';
    const isValidB = !Number.isNaN(dateB.getTime()) && b.onboarded !== 'Unknown';

    if (isValidA && isValidB) return dateB.getTime() - dateA.getTime();
    if (isValidA && !isValidB) return -1;
    if (!isValidA && isValidB) return 1;
    return 0;
  });

  return listings;
}

async function getAdminListings(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });
  const auth = await getAuth();

  const [restaurants, shops, streetVendors] = await Promise.all([
    fetchCollectionListings({ firestore, auth, collectionName: 'restaurants' }),
    fetchCollectionListings({ firestore, auth, collectionName: 'shops' }),
    fetchCollectionListings({ firestore, auth, collectionName: 'street_vendors' }),
  ]);

  const allListings = sortListingsByOnboarded([...restaurants, ...shops, ...streetVendors]);
  return { restaurants: allListings };
}

async function patchAdminListings(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: true });

  const body = req.body || {};
  const restaurantId = normalizeText(body.restaurantId);
  const businessType = normalizeText(body.businessType);
  const status = normalizeText(body.status);
  const restrictedFeatures = Array.isArray(body.restrictedFeatures) ? body.restrictedFeatures : [];
  const suspensionRemark = normalizeText(body.suspensionRemark);

  if (!restaurantId || !businessType || !status) {
    throw new HttpError(400, 'Missing required fields: restaurantId, businessType, status');
  }

  const validStatuses = new Set(['Approved', 'Suspended', 'Rejected']);
  if (!validStatuses.has(status)) {
    throw new HttpError(400, 'Invalid status provided');
  }

  const collectionName = resolveCollectionFromBusinessType(businessType);
  if (!collectionName) {
    throw new HttpError(400, 'Invalid business type');
  }

  const restaurantRef = firestore.collection(collectionName).doc(restaurantId);
  const updateData = {
    approvalStatus: status.toLowerCase(),
    // Public menu/bootstrap payload depends on listing-level fields.
    // Bump menuVersion so long-lived caches bust immediately.
    menuVersion: FieldValue.increment(1),
    updatedAt: new Date(),
  };

  if (status === 'Suspended') {
    updateData.restrictedFeatures = restrictedFeatures;
    updateData.suspensionRemark = suspensionRemark || '';
  } else {
    updateData.restrictedFeatures = [];
    updateData.suspensionRemark = '';
  }

  await restaurantRef.set(updateData, { merge: true });
  return { message: 'Business status updated successfully' };
}

module.exports = {
  getAdminListings,
  patchAdminListings,
};
