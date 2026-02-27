const { FieldValue } = require('../lib/firebaseAdmin');
const { resolveOwnerContext } = require('./accessControl.service');

const DEFAULT_DELIVERY_SETTINGS = {
  deliveryEnabled: true,
  deliveryRadius: 5,
  deliveryFeeType: 'fixed',
  deliveryFixedFee: 30,
  deliveryBaseDistance: 0,
  deliveryPerKmFee: 5,
  deliveryFreeThreshold: 500,
  deliveryOnlinePaymentEnabled: true,
  deliveryCodEnabled: true,
  roadDistanceFactor: 1.0,
  freeDeliveryRadius: 0,
  freeDeliveryMinOrder: 0,
  deliveryTiers: [],
  deliveryOrderSlabRules: [
    { maxOrder: 100, fee: 10 },
    { maxOrder: 200, fee: 20 },
  ],
  deliveryOrderSlabAboveFee: 0,
  deliveryOrderSlabBaseDistance: 1,
  deliveryOrderSlabPerKmFee: 15,
};

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function getOwnerDeliverySettings(req) {
  const owner = await resolveOwnerContext(req, { checkRevoked: false });
  const businessRef = owner.businessSnap.ref;
  const configDoc = await businessRef.collection('delivery_settings').doc('config').get();
  const parentData = owner.businessData || {};
  const configData = configDoc.exists ? (configDoc.data() || {}) : {};

  return {
    ...DEFAULT_DELIVERY_SETTINGS,
    ...parentData,
    ...configData,
  };
}

async function patchOwnerDeliverySettings(req, body = {}) {
  const owner = await resolveOwnerContext(req, { checkRevoked: true });
  const businessRef = owner.businessSnap.ref;
  const updates = body && typeof body === 'object' ? body : {};

  const allowedFields = [
    'deliveryEnabled',
    'deliveryRadius',
    'deliveryFeeType',
    'deliveryFixedFee',
    'deliveryPerKmFee',
    'deliveryBaseDistance',
    'deliveryFreeThreshold',
    'deliveryOnlinePaymentEnabled',
    'deliveryCodEnabled',
    'roadDistanceFactor',
    'freeDeliveryRadius',
    'freeDeliveryMinOrder',
    'deliveryTiers',
    'deliveryOrderSlabRules',
    'deliveryOrderSlabAboveFee',
    'deliveryOrderSlabBaseDistance',
    'deliveryOrderSlabPerKmFee',
  ];

  const cleanUpdates = {};
  allowedFields.forEach((field) => {
    if (updates[field] !== undefined) cleanUpdates[field] = updates[field];
  });

  if (cleanUpdates.deliveryRadius !== undefined) {
    cleanUpdates.deliveryRadius = toFiniteNumber(cleanUpdates.deliveryRadius, 5);
  }
  if (cleanUpdates.deliveryFixedFee !== undefined) {
    cleanUpdates.deliveryFixedFee = toFiniteNumber(cleanUpdates.deliveryFixedFee, 0);
  }
  if (cleanUpdates.deliveryBaseDistance !== undefined) {
    cleanUpdates.deliveryBaseDistance = toFiniteNumber(cleanUpdates.deliveryBaseDistance, 0);
  }
  if (cleanUpdates.deliveryPerKmFee !== undefined) {
    cleanUpdates.deliveryPerKmFee = toFiniteNumber(cleanUpdates.deliveryPerKmFee, 0);
  }
  if (cleanUpdates.deliveryFreeThreshold !== undefined) {
    cleanUpdates.deliveryFreeThreshold = toFiniteNumber(cleanUpdates.deliveryFreeThreshold, 0);
  }
  if (cleanUpdates.roadDistanceFactor !== undefined) {
    cleanUpdates.roadDistanceFactor = Math.max(1.0, toFiniteNumber(cleanUpdates.roadDistanceFactor, 1.0));
  }
  if (cleanUpdates.freeDeliveryRadius !== undefined) {
    cleanUpdates.freeDeliveryRadius = toFiniteNumber(cleanUpdates.freeDeliveryRadius, 0);
  }
  if (cleanUpdates.freeDeliveryMinOrder !== undefined) {
    cleanUpdates.freeDeliveryMinOrder = toFiniteNumber(cleanUpdates.freeDeliveryMinOrder, 0);
  }
  if (Array.isArray(cleanUpdates.deliveryTiers)) {
    cleanUpdates.deliveryTiers = cleanUpdates.deliveryTiers.map((tier) => ({
      minOrder: toFiniteNumber(tier?.minOrder, 0),
      fee: toFiniteNumber(tier?.fee, 0),
    }));
  }
  if (cleanUpdates.deliveryOrderSlabAboveFee !== undefined) {
    cleanUpdates.deliveryOrderSlabAboveFee = toFiniteNumber(cleanUpdates.deliveryOrderSlabAboveFee, 0);
  }
  if (cleanUpdates.deliveryOrderSlabBaseDistance !== undefined) {
    cleanUpdates.deliveryOrderSlabBaseDistance = Math.max(
      0,
      toFiniteNumber(cleanUpdates.deliveryOrderSlabBaseDistance, 1)
    );
  }
  if (cleanUpdates.deliveryOrderSlabPerKmFee !== undefined) {
    cleanUpdates.deliveryOrderSlabPerKmFee = Math.max(
      0,
      toFiniteNumber(cleanUpdates.deliveryOrderSlabPerKmFee, 15)
    );
  }
  if (Array.isArray(cleanUpdates.deliveryOrderSlabRules)) {
    cleanUpdates.deliveryOrderSlabRules = cleanUpdates.deliveryOrderSlabRules
      .map((rule) => ({
        maxOrder: toFiniteNumber(rule?.maxOrder, 0),
        fee: toFiniteNumber(rule?.fee, 0),
      }))
      .filter((rule) => rule.maxOrder > 0)
      .sort((a, b) => a.maxOrder - b.maxOrder);
  }

  cleanUpdates.updatedAt = new Date();
  await businessRef.collection('delivery_settings').doc('config').set(cleanUpdates, { merge: true });

  await businessRef.update({
    menuVersion: FieldValue.increment(1),
    updatedAt: new Date(),
  });

  return {
    success: true,
    message: 'Delivery settings updated',
  };
}

module.exports = {
  getOwnerDeliverySettings,
  patchOwnerDeliverySettings,
};
