/**
 * Distance Calculation Utilities
 * Zero-cost distance calculation using Haversine formula
 */

/**
 * Calculate straight-line (aerial) distance between two coordinates
 * @param {number} lat1 - Starting latitude
 * @param {number} lon1 - Starting longitude
 * @param {number} lat2 - Destination latitude
 * @param {number} lon2 - Destination longitude
 * @returns {number} Distance in kilometers
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance; // km
}

/**
 * Calculate approximate road distance using aerial distance + road factor
 * @param {number} lat1 - Starting latitude
 * @param {number} lon1 - Starting longitude
 * @param {number} lat2 - Destination latitude
 * @param {number} lon2 - Destination longitude
 * @param {number} roadFactor - Multiplier for road distance (1.0 = no adjustment, 1.4 = normal city, 1.7 = dense area)
 * @returns {object} { aerialDistance, roadDistance, roadFactor }
 */
export function calculateRoadDistance(lat1, lon1, lat2, lon2, roadFactor = 1.0) {
    const aerialDistance = calculateHaversineDistance(lat1, lon1, lat2, lon2);

    // If roadFactor is 1.0 or disabled, use aerial distance as-is
    const adjustedFactor = roadFactor && roadFactor > 0 ? roadFactor : 1.0;
    const roadDistance = aerialDistance * adjustedFactor;

    return {
        aerialDistance: parseFloat(aerialDistance.toFixed(2)),
        roadDistance: parseFloat(roadDistance.toFixed(2)),
        roadFactor: adjustedFactor
    };
}

/**
 * Convert degrees to radians
 * @param {number} degrees
 * @returns {number} radians
 */
function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Calculate delivery charge based on distance and settings
 * @param {number} aerialDistance - Straight-line distance in km
 * @param {number} subtotal - Order subtotal
 * @param {object} settings - Restaurant delivery settings
 * @returns {object} { allowed, charge, aerialDistance, roadDistance, reason, message }
 */
export function calculateDeliveryCharge(aerialDistance, subtotal, settings) {
    const toNum = (value, fallback = 0) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };
    const normalizeOrderSlabRules = (rules) => {
        if (!Array.isArray(rules)) return [];
        return rules
            .map((rule) => ({
                maxOrder: toNum(rule?.maxOrder, 0),
                fee: toNum(rule?.fee, 0),
            }))
            .filter((rule) => rule.maxOrder > 0)
            .sort((a, b) => a.maxOrder - b.maxOrder);
    };
    const resolveOrderSlabBaseFee = (subtotalAmount, rules, aboveFee) => {
        const matchedRule = rules.find((rule) => subtotalAmount < rule.maxOrder);
        if (matchedRule) return matchedRule.fee;
        return aboveFee;
    };

    // Apply road distance factor (optional)
    const roadFactor = Math.max(1.0, toNum(settings.roadDistanceFactor, 1.0));
    const roadDistance = toNum(aerialDistance, 0) * roadFactor;
    const deliveryRadius = toNum(settings.deliveryRadius, 10);

    // Check if within max delivery radius (using road distance)
    if (roadDistance > deliveryRadius) {
        return {
            allowed: false,
            charge: 0,
            aerialDistance: parseFloat(aerialDistance.toFixed(1)),
            roadDistance: parseFloat(roadDistance.toFixed(1)),
            roadFactor,
            message: `Delivery not available. You are ${roadDistance.toFixed(1)}km away by road (max: ${deliveryRadius}km)`
        };
    }

    let charge = 0;
    let reason = '';
    let type = ''; // NEW: explicit type for UI

    // 1. UNIVERSAL FREE ZONE / GLOBAL FREE-MIN-ORDER (non-tier modes)
    // - Radius free zone: free within configured km
    // - Global free threshold: if min order is configured, free regardless of local radius
    const freeDeliveryRadius = toNum(settings.freeDeliveryRadius, 0);
    const freeDeliveryMinOrder = settings.freeDeliveryMinOrder === undefined || settings.freeDeliveryMinOrder === null
        ? null
        : toNum(settings.freeDeliveryMinOrder, 0);
    const subtotalNum = toNum(subtotal, 0);
    const hasRadiusRule = freeDeliveryRadius > 0;
    const hasGlobalMinOrderRule = freeDeliveryMinOrder !== null && freeDeliveryMinOrder > 0;
    const isWithinFreeRadius = hasRadiusRule ? roadDistance <= freeDeliveryRadius : true;
    const isFreeMinOrderMet = freeDeliveryMinOrder === null || subtotalNum >= freeDeliveryMinOrder;
    const isUniversalFreeZone = (hasRadiusRule || hasGlobalMinOrderRule) && isWithinFreeRadius && isFreeMinOrderMet;

    console.log(`[distance.js] 🔍 Calc: d=${roadDistance.toFixed(1)}km, subtotal=${subtotalNum}, freeRad=${freeDeliveryRadius}, freeMin=${freeDeliveryMinOrder}`);

    // 2. PRIMARY ENGINE CALCULATION
    if (settings.deliveryChargeType === 'fixed') {
        charge = settings.fixedCharge || 0;
        charge = toNum(charge, 0);
        reason = charge === 0 ? 'Free delivery (Fixed 0)' : `₹${charge.toFixed(0)} Fixed delivery charge`;
        type = 'fixed';
    } else if (settings.deliveryChargeType === 'per-km') {
        type = 'per-km';
        const baseFee = toNum(settings.fixedCharge, 0);
        const includedKm = toNum(settings.baseDistance, 0);
        const perKmRate = toNum(settings.perKmCharge, 0);

        if (roadDistance <= includedKm) {
            charge = baseFee;
            reason = baseFee === 0
                ? `Free delivery within ${includedKm}km`
                : `₹${baseFee.toFixed(0)} Base fare (${roadDistance.toFixed(1)}km dist)`;
        } else {
            const extraKm = roadDistance - includedKm;
            charge = baseFee + (extraKm * perKmRate);
            reason = baseFee === 0
                ? `${roadDistance.toFixed(1)}km × ₹${perKmRate}/km`
                : `₹${baseFee.toFixed(0)} Base + ${extraKm.toFixed(1)}km extra (₹${perKmRate}/km)`;
        }
    } else if (settings.deliveryChargeType === 'free-over') {
        type = 'threshold';
        const freeDeliveryThreshold = toNum(settings.freeDeliveryThreshold, 0);
        if (subtotalNum >= freeDeliveryThreshold) {
            charge = 0;
            reason = `Free delivery for orders ≥₹${freeDeliveryThreshold}`;
        } else {
            charge = toNum(settings.fixedCharge, 0);
            reason = `₹${charge.toFixed(0)} fee (Free for orders ≥₹${freeDeliveryThreshold})`;
        }
    } else if (settings.deliveryChargeType === 'tiered') {
        type = 'tiered';
        const tiers = settings.deliveryTiers || [];

        const sortedTiers = [...tiers]
            .map(t => ({ minOrder: toNum(t.minOrder, 0), fee: toNum(t.fee, 0) }))
            .sort((a, b) => b.minOrder - a.minOrder);

        const activeTier = sortedTiers.find(t => subtotalNum >= t.minOrder);

        if (activeTier) {
            charge = activeTier.fee;
            reason = activeTier.fee === 0
                ? `Free delivery (Order ≥₹${activeTier.minOrder})`
                : `₹${activeTier.fee} fee for orders ≥₹${activeTier.minOrder}`;
        } else {
            charge = toNum(settings.fixedCharge, 0);
            reason = `Standard fee ₹${charge.toFixed(0)}`;
        }
    } else if (settings.deliveryChargeType === 'order-slab-distance') {
        type = 'order-slab-distance';
        const orderSlabRules = normalizeOrderSlabRules(settings.orderSlabRules);
        const orderSlabAboveFee = toNum(settings.orderSlabAboveFee, 0);
        const includedKm = Math.max(0, toNum(settings.orderSlabBaseDistance, 1));
        const perKmRate = Math.max(0, toNum(settings.orderSlabPerKmFee, 15));
        const baseFee = resolveOrderSlabBaseFee(subtotalNum, orderSlabRules, orderSlabAboveFee);

        if (roadDistance <= includedKm) {
            charge = baseFee;
            reason = `Order slab base fee applied for ${includedKm}km`;
        } else {
            const extraKmRaw = roadDistance - includedKm;
            const billedExtraKm = Math.ceil(extraKmRaw);
            charge = baseFee + (billedExtraKm * perKmRate);
            reason = `Order slab base + ${billedExtraKm}km extra (${perKmRate}/km)`;
        }
    }

    // 3. OVERRIDE LOGIC (Universal Free Zone / Global Min Order)
    // CRITICAL: Do not apply on engines that already encode full pricing rules.
    const isOverrideDisabledMode =
        settings.deliveryChargeType === 'tiered' ||
        settings.deliveryChargeType === 'order-slab-distance';

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
        console.log(`[distance.js] ⚡ Radius Override applied: ${reason}`);
    }

    return {
        allowed: true,
        charge: Math.max(0, Math.round(charge)),
        aerialDistance: parseFloat(aerialDistance.toFixed(1)),
        roadDistance: parseFloat(roadDistance.toFixed(1)),
        roadFactor,
        reason,
        type
    };
}
