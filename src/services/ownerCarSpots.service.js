const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

function normalizeSpotId(spotLabel) {
  return String(spotLabel || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function toIsoString(value) {
  if (value?.toDate && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

function mapSpot(doc, businessId) {
  const data = doc.data() || {};
  const safeSpotLabel = String(data.spotLabel || doc.id).trim();
  return {
    id: doc.id,
    spotLabel: safeSpotLabel,
    spotCode: data.spotCode || doc.id,
    isActive: data.isActive !== false,
    orderPath:
      data.orderPath || `/order/${businessId}?orderType=car&spot=${encodeURIComponent(safeSpotLabel)}`,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function byUpdatedAtDesc(a, b) {
  const at = Date.parse(a.updatedAt || '') || 0;
  const bt = Date.parse(b.updatedAt || '') || 0;
  return bt - at;
}

async function getOwnerCarSpots(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_DINE_IN_ORDERS, PERMISSIONS.MANAGE_DINE_IN],
  });

  const businessRef = owner.businessSnap.ref;
  let docs = [];
  try {
    const snap = await businessRef.collection('carSpots').orderBy('updatedAt', 'desc').get();
    docs = snap.docs;
  } catch {
    const fallback = await businessRef.collection('carSpots').get();
    docs = fallback.docs;
  }

  const spots = docs
    .map((doc) => mapSpot(doc, owner.businessId))
    .filter((spot) => spot.isActive !== false)
    .sort(byUpdatedAtDesc);

  return { spots };
}

async function postOwnerCarSpot(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });

  const rawSpotLabel = String(body.spotLabel || '').trim();
  if (!rawSpotLabel) {
    throw new HttpError(400, 'Spot label is required.');
  }

  const safeSpotLabel = rawSpotLabel.slice(0, 60);
  const spotId = normalizeSpotId(safeSpotLabel);
  if (!spotId) {
    throw new HttpError(400, 'Spot label is invalid.');
  }

  const businessRef = owner.businessSnap.ref;
  const spotRef = businessRef.collection('carSpots').doc(spotId);
  const existingSpotSnap = await spotRef.get();

  const payload = {
    id: spotId,
    spotLabel: safeSpotLabel,
    spotCode: spotId,
    isActive: true,
    orderPath: `/order/${owner.businessId}?orderType=car&spot=${encodeURIComponent(safeSpotLabel)}`,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (!existingSpotSnap.exists) {
    payload.createdAt = FieldValue.serverTimestamp();
  }

  await spotRef.set(payload, { merge: true });
  const savedSpotSnap = await spotRef.get();

  return {
    message: existingSpotSnap.exists ? 'Car spot QR updated.' : 'Car spot QR saved.',
    spot: mapSpot(savedSpotSnap, owner.businessId),
    statusCode: existingSpotSnap.exists ? 200 : 201,
  };
}

async function deleteOwnerCarSpot(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });

  const spotId = normalizeSpotId(body.spotId || body.spotCode || '');
  if (!spotId) {
    throw new HttpError(400, 'Spot ID is required.');
  }

  const spotRef = owner.businessSnap.ref.collection('carSpots').doc(spotId);
  const spotSnap = await spotRef.get();
  if (!spotSnap.exists) {
    throw new HttpError(404, 'Car spot not found.');
  }

  await spotRef.delete();
  return {
    message: 'Car spot QR deleted.',
  };
}

module.exports = {
  getOwnerCarSpots,
  postOwnerCarSpot,
  deleteOwnerCarSpot,
};
