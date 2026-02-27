function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateDeliveryCharge(aerialDistance, subtotal, settings) {
  const normalizeOrderSlabRules = (rules) => {
    if (!Array.isArray(rules)) return [];
    return rules
      .map((rule) => ({
        maxOrder: toFiniteNumber(rule?.maxOrder, 0),
        fee: toFiniteNumber(rule?.fee, 0),
      }))
      .filter((rule) => rule.maxOrder > 0)
      .sort((a, b) => a.maxOrder - b.maxOrder);
  };

  const resolveOrderSlabBaseFee = (subtotalAmount, rules, aboveFee) => {
    const matchedRule = rules.find((rule) => subtotalAmount < rule.maxOrder);
    if (matchedRule) return matchedRule.fee;
    return aboveFee;
  };

  const roadFactor = Math.max(1.0, toFiniteNumber(settings.roadDistanceFactor, 1.0));
  const roadDistance = toFiniteNumber(aerialDistance, 0) * roadFactor;
  const deliveryRadius = toFiniteNumber(settings.deliveryRadius, 10);
  const subtotalNum = toFiniteNumber(subtotal, 0);

  if (roadDistance > deliveryRadius) {
    return {
      allowed: false,
      charge: 0,
      aerialDistance: parseFloat(aerialDistance.toFixed(1)),
      roadDistance: parseFloat(roadDistance.toFixed(1)),
      roadFactor,
      message: `Delivery not available. You are ${roadDistance.toFixed(1)}km away by road (max: ${deliveryRadius}km)`,
    };
  }

  let charge = 0;
  let reason = '';
  let type = '';

  const freeDeliveryRadius = toFiniteNumber(settings.freeDeliveryRadius, 0);
  const freeDeliveryMinOrder =
    settings.freeDeliveryMinOrder === undefined || settings.freeDeliveryMinOrder === null
      ? null
      : toFiniteNumber(settings.freeDeliveryMinOrder, 0);
  const hasRadiusRule = freeDeliveryRadius > 0;
  const hasGlobalMinOrderRule = freeDeliveryMinOrder !== null && freeDeliveryMinOrder > 0;
  const isWithinFreeRadius = hasRadiusRule ? roadDistance <= freeDeliveryRadius : true;
  const isFreeMinOrderMet = freeDeliveryMinOrder === null || subtotalNum >= freeDeliveryMinOrder;
  const isUniversalFreeZone = (hasRadiusRule || hasGlobalMinOrderRule) && isWithinFreeRadius && isFreeMinOrderMet;

  if (settings.deliveryChargeType === 'fixed') {
    charge = toFiniteNumber(settings.fixedCharge, 0);
    reason = charge === 0 ? 'Free delivery (Fixed 0)' : `₹${charge.toFixed(0)} Fixed delivery charge`;
    type = 'fixed';
  } else if (settings.deliveryChargeType === 'per-km') {
    type = 'per-km';
    const baseFee = toFiniteNumber(settings.fixedCharge, 0);
    const includedKm = toFiniteNumber(settings.baseDistance, 0);
    const perKmRate = toFiniteNumber(settings.perKmCharge, 0);

    if (roadDistance <= includedKm) {
      charge = baseFee;
      reason =
        baseFee === 0
          ? `Free delivery within ${includedKm}km`
          : `₹${baseFee.toFixed(0)} Base fare (${roadDistance.toFixed(1)}km dist)`;
    } else {
      const extraKm = roadDistance - includedKm;
      charge = baseFee + extraKm * perKmRate;
      reason =
        baseFee === 0
          ? `${roadDistance.toFixed(1)}km × ₹${perKmRate}/km`
          : `₹${baseFee.toFixed(0)} Base + ${extraKm.toFixed(1)}km extra (₹${perKmRate}/km)`;
    }
  } else if (settings.deliveryChargeType === 'free-over') {
    type = 'threshold';
    const freeDeliveryThreshold = toFiniteNumber(settings.freeDeliveryThreshold, 0);
    if (subtotalNum >= freeDeliveryThreshold) {
      charge = 0;
      reason = `Free delivery for orders ≥₹${freeDeliveryThreshold}`;
    } else {
      charge = toFiniteNumber(settings.fixedCharge, 0);
      reason = `₹${charge.toFixed(0)} fee (Free for orders ≥₹${freeDeliveryThreshold})`;
    }
  } else if (settings.deliveryChargeType === 'tiered') {
    type = 'tiered';
    const tiers = Array.isArray(settings.deliveryTiers) ? settings.deliveryTiers : [];
    const sortedTiers = [...tiers]
      .map((tier) => ({
        minOrder: toFiniteNumber(tier?.minOrder, 0),
        fee: toFiniteNumber(tier?.fee, 0),
      }))
      .sort((a, b) => b.minOrder - a.minOrder);

    const activeTier = sortedTiers.find((tier) => subtotalNum >= tier.minOrder);
    if (activeTier) {
      charge = activeTier.fee;
      reason =
        activeTier.fee === 0
          ? `Free delivery (Order ≥₹${activeTier.minOrder})`
          : `₹${activeTier.fee} fee for orders ≥₹${activeTier.minOrder}`;
    } else {
      charge = toFiniteNumber(settings.fixedCharge, 0);
      reason = `Standard fee ₹${charge.toFixed(0)}`;
    }
  } else if (settings.deliveryChargeType === 'order-slab-distance') {
    type = 'order-slab-distance';
    const rules = normalizeOrderSlabRules(settings.orderSlabRules);
    const aboveFee = toFiniteNumber(settings.orderSlabAboveFee, 0);
    const includedKm = Math.max(0, toFiniteNumber(settings.orderSlabBaseDistance, 1));
    const perKmRate = Math.max(0, toFiniteNumber(settings.orderSlabPerKmFee, 15));
    const baseFee = resolveOrderSlabBaseFee(subtotalNum, rules, aboveFee);

    if (roadDistance <= includedKm) {
      charge = baseFee;
      reason = `Order slab base fee applied for ${includedKm}km`;
    } else {
      const billedExtraKm = Math.ceil(roadDistance - includedKm);
      charge = baseFee + billedExtraKm * perKmRate;
      reason = `Order slab base + ${billedExtraKm}km extra (${perKmRate}/km)`;
    }
  }

  const isOverrideDisabledMode =
    settings.deliveryChargeType === 'tiered' || settings.deliveryChargeType === 'order-slab-distance';

  if (!isOverrideDisabledMode && isUniversalFreeZone && charge > 0) {
    charge = 0;
    if (hasRadiusRule && hasGlobalMinOrderRule) {
      reason = `Free in ${freeDeliveryRadius}km zone for orders ≥₹${freeDeliveryMinOrder}`;
    } else if (hasRadiusRule) {
      reason = `Free for locals (${roadDistance.toFixed(1)}km zone)`;
    } else {
      reason = `Free delivery for orders ≥₹${freeDeliveryMinOrder}`;
    }
    type = 'override-free';
  }

  return {
    allowed: true,
    charge: Math.max(0, Math.round(charge)),
    aerialDistance: parseFloat(aerialDistance.toFixed(1)),
    roadDistance: parseFloat(roadDistance.toFixed(1)),
    roadFactor,
    reason,
    type,
  };
}

module.exports = {
  calculateHaversineDistance,
  calculateDeliveryCharge,
};
