const { getFirestore } = require('../lib/firebaseAdmin');
const { findBusinessById } = require('./business.service');
const { calculateHaversineDistance, calculateDeliveryCharge } = require('../utils/distance');
const { HttpError } = require('../utils/httpError');

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getBusinessLabel(businessType = 'restaurant') {
  if (businessType === 'store' || businessType === 'shop') return 'store';
  if (businessType === 'street-vendor') return 'stall';
  return 'restaurant';
}

async function calculateCharge({ restaurantId, addressLat, addressLng, subtotal }) {
  const subtotalNum = Number(subtotal) || 0;
  const addressLatNum = toFiniteNumber(addressLat);
  const addressLngNum = toFiniteNumber(addressLng);

  if (!restaurantId || addressLatNum === null || addressLngNum === null || subtotal === undefined) {
    throw new HttpError(400, 'Missing required fields: restaurantId, addressLat, addressLng, subtotal');
  }

  const firestore = await getFirestore();
  const business = await findBusinessById({
    firestore,
    businessId: restaurantId,
  });
  const restaurantRef = business.ref;
  const restaurantData = business.data;
  const businessLabel = getBusinessLabel(business.businessType);

  const restaurantLat = toFiniteNumber(
    restaurantData.coordinates?.lat ??
      restaurantData.address?.latitude ??
      restaurantData.businessAddress?.latitude
  );
  const restaurantLng = toFiniteNumber(
    restaurantData.coordinates?.lng ??
      restaurantData.address?.longitude ??
      restaurantData.businessAddress?.longitude
  );

  if (restaurantLat === null || restaurantLng === null) {
    throw new HttpError(400, `${businessLabel.charAt(0).toUpperCase() + businessLabel.slice(1)} coordinates not configured`);
  }

  const aerialDistance = calculateHaversineDistance(
    restaurantLat,
    restaurantLng,
    addressLatNum,
    addressLngNum
  );

  const deliveryConfigSnap = await restaurantRef.collection('delivery_settings').doc('config').get();
  const deliveryConfig = deliveryConfigSnap.exists ? (deliveryConfigSnap.data() || {}) : {};
  const getSetting = (key, defaultVal) => deliveryConfig[key] ?? restaurantData[key] ?? defaultVal;

  const settings = {
    deliveryEnabled: getSetting('deliveryEnabled', true),
    deliveryRadius: getSetting('deliveryRadius', 10),
    deliveryChargeType: getSetting('deliveryFeeType', getSetting('deliveryChargeType', 'fixed')),
    fixedCharge: getSetting('deliveryFixedFee', getSetting('fixedCharge', 0)),
    perKmCharge: getSetting('deliveryPerKmFee', getSetting('perKmCharge', 0)),
    baseDistance: getSetting('deliveryBaseDistance', getSetting('baseDistance', 0)),
    freeDeliveryThreshold: getSetting('deliveryFreeThreshold', getSetting('freeDeliveryThreshold', 0)),
    freeDeliveryRadius: getSetting('freeDeliveryRadius', 0),
    freeDeliveryMinOrder: getSetting('freeDeliveryMinOrder', 0),
    roadDistanceFactor: getSetting('roadDistanceFactor', 1.0),
    deliveryTiers: getSetting('deliveryTiers', []),
    orderSlabRules: getSetting('deliveryOrderSlabRules', getSetting('orderSlabRules', [])),
    orderSlabAboveFee: getSetting('deliveryOrderSlabAboveFee', getSetting('orderSlabAboveFee', 0)),
    orderSlabBaseDistance: getSetting('deliveryOrderSlabBaseDistance', getSetting('orderSlabBaseDistance', 1)),
    orderSlabPerKmFee: getSetting('deliveryOrderSlabPerKmFee', getSetting('orderSlabPerKmFee', 15)),
  };

  if (settings.deliveryEnabled === false) {
    return {
      success: true,
      allowed: false,
      charge: 0,
      aerialDistance: 0,
      roadDistance: 0,
      roadFactor: Number(settings.roadDistanceFactor || 1),
      message: `Delivery is currently disabled for this ${businessLabel}.`,
    };
  }

  const result = calculateDeliveryCharge(aerialDistance, subtotalNum, settings);
  return {
    success: true,
    ...result,
  };
}

module.exports = {
  calculateCharge,
};
