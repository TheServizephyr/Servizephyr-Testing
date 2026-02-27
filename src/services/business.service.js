const { getCache, setCache } = require('../lib/cache');
const { HttpError } = require('../utils/httpError');

const CANDIDATE_COLLECTIONS = ['restaurants', 'street_vendors', 'shops'];
const COLLECTION_CACHE_TTL_SEC = 60 * 60; // 1 hour
const BUSINESS_DOC_L1_TTL_MS = 5000;
const businessDocL1Cache = new Map();

function normalizeBusinessType(value, fallbackCollectionName = null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street-vendor';
  if (normalized === 'restaurant') return 'restaurant';
  if (fallbackCollectionName === 'shops') return 'store';
  if (fallbackCollectionName === 'street_vendors') return 'street-vendor';
  return 'restaurant';
}

function toBusinessResult({ collectionName, ref, id, data }) {
  return {
    collectionName,
    ref,
    id,
    data,
    menuVersion: Number(data.menuVersion || 1),
    businessType: normalizeBusinessType(data.businessType, collectionName),
  };
}

function getBusinessDocL1(businessId) {
  const entry = businessDocL1Cache.get(businessId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    businessDocL1Cache.delete(businessId);
    return null;
  }
  return entry.value;
}

function setBusinessDocL1(businessId, value) {
  businessDocL1Cache.set(businessId, {
    value,
    expiresAt: Date.now() + BUSINESS_DOC_L1_TTL_MS,
  });
}

function buildBusinessFromCachedValue({ firestore, businessId, cachedValue }) {
  if (!cachedValue || typeof cachedValue !== 'object') return null;
  const collectionName = String(cachedValue.collectionName || '').trim();
  if (!CANDIDATE_COLLECTIONS.includes(collectionName)) return null;
  const data = cachedValue.data;
  if (!data || typeof data !== 'object') return null;

  const ref = firestore.collection(collectionName).doc(businessId);
  return toBusinessResult({
    collectionName,
    ref,
    id: businessId,
    data,
  });
}

async function tryBusinessDoc(firestore, collectionName, businessId) {
  const docRef = firestore.collection(collectionName).doc(businessId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) return null;
  const data = docSnap.data() || {};
  return toBusinessResult({
    collectionName,
    ref: docRef,
    id: docSnap.id,
    data,
  });
}

async function findBusinessById({ firestore, businessId }) {
  const safeBusinessId = String(businessId || '').trim();
  if (!safeBusinessId) throw new HttpError(400, 'Business ID is required');

  const l1Hit = getBusinessDocL1(safeBusinessId);
  if (l1Hit) {
    const business = buildBusinessFromCachedValue({
      firestore,
      businessId: safeBusinessId,
      cachedValue: l1Hit,
    });
    if (business) return business;
  }

  const collectionCacheKey = `business_collection:${safeBusinessId}`;
  const collectionHit = await getCache(collectionCacheKey);
  if (collectionHit.hit && collectionHit.value) {
    const cachedCollection = String(collectionHit.value);
    const cached = await tryBusinessDoc(firestore, cachedCollection, safeBusinessId);
    if (cached) {
      setBusinessDocL1(safeBusinessId, {
        collectionName: cached.collectionName,
        data: cached.data,
      });
      return cached;
    }
  }

  const found = (
    await Promise.all(
      CANDIDATE_COLLECTIONS.map((collectionName) =>
        tryBusinessDoc(firestore, collectionName, safeBusinessId)
      )
    )
  ).filter(Boolean);

  if (found.length === 0) {
    throw new HttpError(404, 'Business not found');
  }

  found.sort((a, b) => b.menuVersion - a.menuVersion);
  const winner = found[0];
  await setCache(collectionCacheKey, winner.collectionName, COLLECTION_CACHE_TTL_SEC);
  setBusinessDocL1(safeBusinessId, {
    collectionName: winner.collectionName,
    data: winner.data,
  });
  return winner;
}

module.exports = {
  findBusinessById,
  normalizeBusinessType,
};
