const { randomUUID } = require('crypto');
const { getFirestore, FieldValue, GeoPoint, verifyIdToken } = require('../lib/firebaseAdmin');
const { calculateHaversineDistance, calculateDeliveryCharge } = require('../utils/distance');
const { findBusinessById } = require('./business.service');
const { deobfuscateGuestId } = require('../utils/guest');
const { HttpError } = require('../utils/httpError');

const COORD_EPSILON = 0.00005;

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('91') && digits.length === 12) return digits.slice(2);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function toFiniteNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getCookieValue(req, name) {
  const header = String(req.headers.cookie || '');
  if (!header) return '';
  const parts = header.split(';').map((chunk) => chunk.trim());
  const target = parts.find((chunk) => chunk.startsWith(`${name}=`));
  if (!target) return '';
  return decodeURIComponent(target.slice(name.length + 1));
}

function parseUidFromAuthHeader(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice('Bearer '.length).trim();
}

async function getUserIdFromToken(req) {
  const token = parseUidFromAuthHeader(req);
  if (!token) return '';
  try {
    const decoded = await verifyIdToken(token);
    return String(decoded?.uid || '').trim();
  } catch {
    return '';
  }
}

function hasValidCoordinatePair(lat, lng) {
  return lat !== null && lng !== null;
}

function addressesMatch(existingAddress = {}, incomingAddress = {}) {
  const existingLat = toFiniteNumber(existingAddress.latitude);
  const existingLng = toFiniteNumber(existingAddress.longitude);
  const incomingLat = toFiniteNumber(incomingAddress.latitude);
  const incomingLng = toFiniteNumber(incomingAddress.longitude);

  const sameCoordinates =
    hasValidCoordinatePair(existingLat, existingLng) &&
    hasValidCoordinatePair(incomingLat, incomingLng) &&
    Math.abs(existingLat - incomingLat) <= COORD_EPSILON &&
    Math.abs(existingLng - incomingLng) <= COORD_EPSILON;

  if (sameCoordinates) return true;

  const sameFullAddress =
    String(existingAddress.full || '').trim().toLowerCase() &&
    String(existingAddress.full || '').trim().toLowerCase() ===
      String(incomingAddress.full || '').trim().toLowerCase();
  const samePhone =
    String(existingAddress.phone || '').trim().toLowerCase() &&
    String(existingAddress.phone || '').trim().toLowerCase() ===
      String(incomingAddress.phone || '').trim().toLowerCase();

  return sameFullAddress && samePhone;
}

function orderHasSameLocation(orderData = {}, incomingAddress = {}) {
  const orderLoc = orderData.customerLocation || {};
  const orderLat = toFiniteNumber(orderLoc._latitude ?? orderLoc.latitude ?? orderLoc.lat);
  const orderLng = toFiniteNumber(orderLoc._longitude ?? orderLoc.longitude ?? orderLoc.lng);
  const incomingLat = toFiniteNumber(incomingAddress.latitude);
  const incomingLng = toFiniteNumber(incomingAddress.longitude);

  return (
    hasValidCoordinatePair(orderLat, orderLng) &&
    hasValidCoordinatePair(incomingLat, incomingLng) &&
    Math.abs(orderLat - incomingLat) <= COORD_EPSILON &&
    Math.abs(orderLng - incomingLng) <= COORD_EPSILON
  );
}

function calculateGrandTotalFromOrder(orderData, deliveryChargeOverride) {
  const subtotal = toNumber(orderData?.subtotal, 0);
  const cgst = toNumber(orderData?.cgst, 0);
  const sgst = toNumber(orderData?.sgst, 0);
  const packagingCharge = toNumber(orderData?.packagingCharge, 0);
  const tipAmount = toNumber(orderData?.tipAmount, 0);
  const platformFee = toNumber(orderData?.platformFee, 0);
  const convenienceFee = toNumber(orderData?.convenienceFee, 0);
  const serviceFee = toNumber(orderData?.serviceFee, 0);
  const discount = toNumber(orderData?.discount, 0);

  const total =
    subtotal +
    cgst +
    sgst +
    toNumber(deliveryChargeOverride, 0) +
    packagingCharge +
    tipAmount +
    platformFee +
    convenienceFee +
    serviceFee -
    discount;

  return Number(total.toFixed(2));
}

async function resolveProfileByPhone(firestore, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new HttpError(400, 'A phone number is required to save an address for a session.');
  }

  const userQuery = await firestore.collection('users').where('phone', '==', normalizedPhone).limit(1).get();
  if (!userQuery.empty) {
    const doc = userQuery.docs[0];
    return {
      userId: doc.id,
      isGuest: false,
      ref: doc.ref,
      data: doc.data() || {},
    };
  }

  const guestQuery = await firestore
    .collection('guest_profiles')
    .where('phone', '==', normalizedPhone)
    .limit(1)
    .get();
  if (!guestQuery.empty) {
    const doc = guestQuery.docs[0];
    return {
      userId: doc.id,
      isGuest: true,
      ref: doc.ref,
      data: doc.data() || {},
    };
  }

  const guestId = `g_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const ref = firestore.collection('guest_profiles').doc(guestId);
  await ref.set({
    phone: normalizedPhone,
    createdAt: FieldValue.serverTimestamp(),
    addresses: [],
  });
  return {
    userId: guestId,
    isGuest: true,
    ref,
    data: { phone: normalizedPhone, addresses: [] },
  };
}

async function resolveProfileById(firestore, profileId) {
  const safeId = String(profileId || '').trim();
  if (!safeId) return null;

  const userRef = firestore.collection('users').doc(safeId);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    return {
      userId: userSnap.id,
      isGuest: false,
      ref: userRef,
      data: userSnap.data() || {},
    };
  }

  const guestRef = firestore.collection('guest_profiles').doc(safeId);
  const guestSnap = await guestRef.get();
  if (guestSnap.exists) {
    return {
      userId: guestSnap.id,
      isGuest: true,
      ref: guestRef,
      data: guestSnap.data() || {},
    };
  }

  return null;
}

function getBusinessLabel(businessType = 'restaurant') {
  if (businessType === 'store' || businessType === 'shop') return 'store';
  if (businessType === 'street-vendor') return 'stall';
  return 'restaurant';
}

async function patchLinkedOrderIfNeeded({
  firestore,
  activeOrderId,
  address,
  profile,
  normalizedPhone,
}) {
  if (!activeOrderId) return;

  const orderRef = firestore.collection('orders').doc(String(activeOrderId));
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return;

  const orderData = orderSnap.data() || {};
  const orderPhone = normalizePhone(orderData.customerPhone || orderData.phone);
  const belongsToCustomer =
    (orderData.customerId && String(orderData.customerId) === profile.userId) ||
    (orderData.userId && String(orderData.userId) === profile.userId) ||
    (orderPhone && normalizedPhone && orderPhone === normalizedPhone);

  if (!belongsToCustomer) return;

  const alreadyCaptured =
    orderData.customerAddressPending === false && orderHasSameLocation(orderData, address);
  if (alreadyCaptured) return;

  const statusEvents = [{ status: 'address_captured', timestamp: new Date() }];
  const patchData = {
    customerAddress: address.full,
    customerLocation: new GeoPoint(Number(address.latitude), Number(address.longitude)),
    customerAddressPending: false,
    addressCapturedAt: FieldValue.serverTimestamp(),
    statusHistory: FieldValue.arrayUnion(...statusEvents),
  };

  if (String(orderData.deliveryType || '').toLowerCase() === 'delivery') {
    const business = await findBusinessById({
      firestore,
      businessId: orderData.restaurantId,
    });
    const businessData = business.data || {};
    const deliveryConfigSnap = await business.ref.collection('delivery_settings').doc('config').get();
    const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() || {} : {};
    const getSetting = (key, fallback) => deliveryConfig[key] ?? businessData[key] ?? fallback;

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

    const restaurantLat = toFiniteNumber(
      businessData.coordinates?.lat ??
        businessData.address?.latitude ??
        businessData.businessAddress?.latitude
    );
    const restaurantLng = toFiniteNumber(
      businessData.coordinates?.lng ??
        businessData.address?.longitude ??
        businessData.businessAddress?.longitude
    );

    if (restaurantLat === null || restaurantLng === null) {
      const label = getBusinessLabel(business.businessType);
      throw new HttpError(
        400,
        `${label.charAt(0).toUpperCase() + label.slice(1)} coordinates are not configured.`
      );
    }

    let deliveryResult;
    if (settings.deliveryEnabled === false) {
      deliveryResult = {
        allowed: false,
        charge: 0,
        aerialDistance: 0,
        roadDistance: 0,
        roadFactor: settings.roadDistanceFactor,
        message: `Delivery is currently disabled for this ${getBusinessLabel(business.businessType)}.`,
        reason: 'delivery-disabled',
      };
    } else {
      const aerialDistance = calculateHaversineDistance(
        restaurantLat,
        restaurantLng,
        Number(address.latitude),
        Number(address.longitude)
      );
      deliveryResult = calculateDeliveryCharge(aerialDistance, toNumber(orderData.subtotal, 0), settings);
    }

    const isManualCallOrder =
      Boolean(orderData.isManualCallOrder) ||
      String(orderData.orderSource || '').toLowerCase() === 'manual_call';
    const currentOrderCharge = toNumber(
      orderData.deliveryCharge,
      toNumber(orderData.billDetails?.deliveryCharge, 0)
    );
    const isOwnerLockedManualCharge =
      Boolean(orderData.ownerDeliveryChargeProvided) ||
      Boolean(orderData.deliveryChargeLocked) ||
      Boolean(orderData.manualDeliveryChargeLocked) ||
      toNumber(orderData.manualDeliveryCharge, 0) > 0 ||
      (isManualCallOrder && currentOrderCharge > 0);
    const lockedCharge = toNumber(
      orderData.manualDeliveryCharge,
      toNumber(orderData.billDetails?.deliveryCharge, toNumber(orderData.deliveryCharge, 0))
    );
    const validatedCharge = toNumber(deliveryResult.charge, 0);
    const effectiveDeliveryCharge = isOwnerLockedManualCharge ? lockedCharge : validatedCharge;
    const recalculatedGrandTotal = calculateGrandTotalFromOrder(orderData, effectiveDeliveryCharge);

    patchData.deliveryCharge = effectiveDeliveryCharge;
    patchData.totalAmount = recalculatedGrandTotal;
    patchData.deliveryValidation = {
      success: true,
      ...deliveryResult,
      ownerLockedDeliveryCharge: isOwnerLockedManualCharge,
      checkedAt: new Date(),
    };
    patchData.deliveryValidationMessage = deliveryResult.message || null;
    patchData.deliveryOutOfRange = !deliveryResult.allowed;
    patchData.billDetails = {
      ...(orderData.billDetails || {}),
      subtotal: toNumber(orderData.subtotal, toNumber(orderData.billDetails?.subtotal, 0)),
      cgst: toNumber(orderData.cgst, toNumber(orderData.billDetails?.cgst, 0)),
      sgst: toNumber(orderData.sgst, toNumber(orderData.billDetails?.sgst, 0)),
      deliveryCharge: effectiveDeliveryCharge,
      grandTotal: recalculatedGrandTotal,
    };

    if (isOwnerLockedManualCharge) {
      patchData.ownerDeliveryChargeProvided = true;
      patchData.deliveryChargeLocked = true;
      patchData.manualDeliveryChargeLocked = true;
      patchData.manualDeliveryCharge = effectiveDeliveryCharge;
    }

    if (!deliveryResult.allowed) {
      patchData.deliveryBlocked = true;
      patchData.deliveryBlockedReason = deliveryResult.message || 'Address is outside delivery range.';
      patchData.deliveryBlockedAt = FieldValue.serverTimestamp();
      patchData.statusHistory = FieldValue.arrayUnion(
        ...statusEvents,
        {
          status: 'delivery_blocked',
          timestamp: new Date(),
          message: patchData.deliveryBlockedReason,
        }
      );
    } else {
      patchData.deliveryBlocked = false;
      patchData.deliveryBlockedReason = null;
      patchData.deliveryBlockedAt = null;
      patchData.deliveryValidatedAt = FieldValue.serverTimestamp();
      patchData.statusHistory = FieldValue.arrayUnion(
        ...statusEvents,
        {
          status: 'delivery_validated',
          timestamp: new Date(),
          message: isOwnerLockedManualCharge
            ? `Address updated. Owner locked delivery charge retained at Rs ${effectiveDeliveryCharge}`
            : deliveryResult.reason || `Delivery charge set to Rs ${effectiveDeliveryCharge}`,
        }
      );
    }
  }

  await orderRef.set(patchData, { merge: true });
}

async function getUserAddresses(req) {
  const uid = await getUserIdFromToken(req);
  if (!uid) {
    throw new HttpError(401, 'User not authenticated.');
  }

  const firestore = await getFirestore();
  const userRef = firestore.collection('users').doc(uid);
  const docSnap = await userRef.get();
  if (!docSnap.exists) {
    return { addresses: [] };
  }

  const userData = docSnap.data() || {};
  return {
    addresses: Array.isArray(userData.addresses) ? userData.addresses : [],
  };
}

async function postUserAddress(req, body = {}) {
  const firestore = await getFirestore();
  const uid = await getUserIdFromToken(req);
  const address = body.address || {};

  const latitude = toFiniteNumber(address.latitude);
  const longitude = toFiniteNumber(address.longitude);
  if (!address || !address.id || !address.full || latitude === null || longitude === null) {
    throw new HttpError(
      400,
      'Invalid address data. A full address and location coordinates are required.'
    );
  }

  const normalizedPhone = normalizePhone(body.phone);
  const explicitGuestId = String(body.guestId || '').trim();
  const refGuestId = deobfuscateGuestId(String(body.ref || '').trim()) || '';
  const cookieGuestId = String(getCookieValue(req, 'auth_guest_session') || '').trim();
  const fallbackProfileId = explicitGuestId || refGuestId || cookieGuestId;

  let profile = null;
  if (uid) {
    profile = await resolveProfileById(firestore, uid);
    if (!profile) {
      const userRef = firestore.collection('users').doc(uid);
      profile = { userId: uid, isGuest: false, ref: userRef, data: {} };
    }
  } else if (normalizedPhone) {
    profile = await resolveProfileByPhone(firestore, normalizedPhone);
  } else if (fallbackProfileId) {
    profile = await resolveProfileById(firestore, fallbackProfileId);
  }

  if (!profile) {
    throw new HttpError(401, 'A phone number or authenticated user is required.');
  }

  const currentProfileSnap = await profile.ref.get();
  const currentProfileData = currentProfileSnap.exists ? currentProfileSnap.data() || {} : {};
  const existingAddresses = Array.isArray(currentProfileData.addresses) ? currentProfileData.addresses : [];
  const duplicateAddress = existingAddresses.find((savedAddress) => addressesMatch(savedAddress, address));
  const addressToPersist = duplicateAddress || address;

  const updateData = {};
  if (normalizedPhone) {
    updateData.phone = normalizedPhone;
  }
  if (!duplicateAddress) {
    updateData.addresses = FieldValue.arrayUnion(addressToPersist);
  }
  const currentName = String(currentProfileData.name || '').trim();
  const nextName = String(address.name || '').trim();
  if ((!currentName || currentName.toLowerCase() === 'guest') && nextName) {
    updateData.name = nextName;
  }

  if (Object.keys(updateData).length > 0) {
    await profile.ref.set(updateData, { merge: true });
  }

  await patchLinkedOrderIfNeeded({
    firestore,
    activeOrderId: body.activeOrderId,
    address: addressToPersist,
    profile,
    normalizedPhone: normalizedPhone || normalizePhone(currentProfileData.phone),
  }).catch(() => null);

  const responseMessage = duplicateAddress
    ? 'Address already exists. Existing saved location was reused.'
    : 'Address added successfully!';

  return {
    message: responseMessage,
    address: addressToPersist,
    duplicateAddressSkipped: Boolean(duplicateAddress),
  };
}

async function deleteUserAddress(req, body = {}) {
  const firestore = await getFirestore();
  const uid = await getUserIdFromToken(req);
  const queryAddressId = String(req.query.id || '').trim();
  const addressId = String(body.addressId || queryAddressId).trim();
  const phone = normalizePhone(body.phone || req.query.phone);

  if (!addressId) {
    throw new HttpError(400, 'Address ID is required.');
  }

  let profile = null;
  if (phone) {
    profile = await resolveProfileByPhone(firestore, phone);
  } else if (uid) {
    profile = await resolveProfileById(firestore, uid);
  }

  if (!profile) {
    throw new HttpError(401, 'User not authenticated.');
  }

  const docSnap = await profile.ref.get();
  if (!docSnap.exists) {
    throw new HttpError(404, 'User profile not found.');
  }

  const data = docSnap.data() || {};
  const currentAddresses = Array.isArray(data.addresses) ? data.addresses : [];
  const addressExists = currentAddresses.some((addr) => String(addr?.id || '') === addressId);
  if (!addressExists) {
    throw new HttpError(404, 'Address not found in user profile.');
  }

  const updatedAddresses = currentAddresses.filter((addr) => String(addr?.id || '') !== addressId);
  await profile.ref.update({
    addresses: updatedAddresses,
  });

  return { message: 'Address removed successfully!' };
}

module.exports = {
  getUserAddresses,
  postUserAddress,
  deleteUserAddress,
};
