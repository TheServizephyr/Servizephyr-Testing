const { randomUUID } = require('crypto');
const { getFirestore, FieldValue, GeoPoint, verifyIdToken } = require('../lib/firebaseAdmin');
const { findBusinessById } = require('./business.service');
const { getEffectiveBusinessOpenStatus } = require('../utils/businessSchedule');
const { deobfuscateGuestId, normalizePhone } = require('../utils/guest');
const { generateCustomerOrderId } = require('../utils/orderId');
const { HttpError } = require('../utils/httpError');
const {
  calculateServerTotal,
  validatePriceMatch,
  calculateTaxes,
  mapPricingError,
} = require('./orderPricing.service');
const { calculateCharge: calculateDeliveryChargeServer } = require('./deliveryCharge.service');
const { emitOrderEvent } = require('./orderEvents.service');

const LEGACY_ONLY_PAYMENT_METHODS = new Set(['split_bill']);
const SUPPORTED_PAYMENT_METHODS = new Set(['cod', 'cash', 'counter', 'pay_at_counter', 'phonepe', 'razorpay']);
const ONLINE_PAYMENT_METHODS = new Set(['phonepe', 'razorpay']);

function randomToken(length = 24) {
  return randomUUID().replace(/-/g, '').slice(0, length);
}

function normalizePaymentMethod(value) {
  const method = String(value || '').trim().toLowerCase();
  if (method === 'cash') return 'cod';
  if (method === 'counter' || method === 'pay_at_counter') return 'pay_at_counter';
  if (method === 'online') return 'razorpay';
  return method;
}

function shouldUseLegacyCreateOrder(body = {}) {
  const paymentMethod = normalizePaymentMethod(body?.paymentMethod);
  if (LEGACY_ONLY_PAYMENT_METHODS.has(paymentMethod)) {
    return { useLegacy: true, reason: `paymentMethod:${paymentMethod}` };
  }
  if (body?.existingOrderId) {
    return { useLegacy: true, reason: 'existingOrderId:addon-flow' };
  }
  if (paymentMethod && !SUPPORTED_PAYMENT_METHODS.has(paymentMethod)) {
    return { useLegacy: true, reason: `unsupportedPaymentMethod:${paymentMethod}` };
  }
  return { useLegacy: false, reason: '' };
}

async function verifyBearerUid(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return '';
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return '';
  try {
    const decoded = await verifyIdToken(idToken);
    return decoded.uid || '';
  } catch {
    return '';
  }
}

async function getOrCreateGuestProfileByPhone(firestore, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const userQuery = await firestore.collection('users').where('phone', '==', normalized).limit(1).get();
  if (!userQuery.empty) {
    return {
      userId: userQuery.docs[0].id,
      phone: normalized,
      profile: userQuery.docs[0].data() || {},
      isGuest: false,
    };
  }

  const guestQuery = await firestore.collection('guest_profiles').where('phone', '==', normalized).limit(1).get();
  if (!guestQuery.empty) {
    return {
      userId: guestQuery.docs[0].id,
      phone: normalized,
      profile: guestQuery.docs[0].data() || {},
      isGuest: true,
    };
  }

  const guestId = `g_${randomToken(16)}`;
  const profile = {
    phone: normalized,
    addresses: [],
    createdAt: FieldValue.serverTimestamp(),
  };
  await firestore.collection('guest_profiles').doc(guestId).set(profile);
  return {
    userId: guestId,
    phone: normalized,
    profile,
    isGuest: true,
  };
}

async function resolveCustomerIdentity({ firestore, req, body }) {
  const guestRef = String(body?.guestRef || '').trim();
  const rawPhone = String(body?.phone || '').trim();

  if (guestRef) {
    const guestId = deobfuscateGuestId(guestRef);
    if (guestId) {
      const guestDoc = await firestore.collection('guest_profiles').doc(guestId).get();
      const guestData = guestDoc.exists ? (guestDoc.data() || {}) : {};
      return {
        userId: guestId,
        phone: normalizePhone(rawPhone || guestData.phone || ''),
        profileName: guestData.name || '',
        isGuest: true,
      };
    }
  }

  const bearerUid = await verifyBearerUid(req);
  if (bearerUid) {
    const userDoc = await firestore.collection('users').doc(bearerUid).get();
    const userData = userDoc.exists ? (userDoc.data() || {}) : {};
    return {
      userId: bearerUid,
      phone: normalizePhone(rawPhone || userData.phone || userData.phoneNumber || ''),
      profileName: userData.name || '',
      isGuest: false,
    };
  }

  const phoneProfile = await getOrCreateGuestProfileByPhone(firestore, rawPhone);
  if (phoneProfile) {
    return {
      userId: phoneProfile.userId,
      phone: phoneProfile.phone,
      profileName: phoneProfile.profile?.name || '',
      isGuest: phoneProfile.isGuest,
    };
  }

  throw new HttpError(400, 'Customer identity could not be resolved. Phone or guestRef required.');
}

function extractAddressLatLng(address = {}) {
  const lat = Number(address?.lat ?? address?.latitude);
  const lng = Number(address?.lng ?? address?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function normalizeMoney(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function optimizeItemSnapshot(item = {}) {
  const snapshot = {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId || 'general',
    isVeg: !!item.isVeg,
    price:
      item.price !== undefined
        ? item.price
        : (item.serverVerifiedPrice !== undefined ? item.serverVerifiedPrice : 0),
    quantity: item.quantity || 1,
    selectedAddOns: Array.isArray(item.selectedAddOns)
      ? item.selectedAddOns.map((addon) => ({
          name: addon.name,
          price: addon.price || 0,
          quantity: addon.quantity || 1,
        }))
      : [],
    totalPrice:
      item.totalPrice !== undefined
        ? item.totalPrice
        : (item.serverVerifiedTotal !== undefined ? item.serverVerifiedTotal : 0),
    cartItemId: item.cartItemId || null,
    isAddon: !!item.isAddon,
  };

  if (item.portion) {
    snapshot.portion = {
      name: item.portion.name,
      price: item.portion.price || 0,
      isDefault: item.portion.isDefault === true,
    };
  }
  if (item.addedAt) {
    snapshot.addedAt = item.addedAt;
  }
  return snapshot;
}

function generateDineInTokenValue(tokenNumber) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const c1 = alphabet[Math.floor(Math.random() * alphabet.length)];
  const c2 = alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${tokenNumber}-${c1}${c2}`;
}

async function resolveDineInToken({ firestore, businessRef, businessData, body }) {
  const deliveryType = String(body?.deliveryType || '').trim().toLowerCase();
  const needsToken = deliveryType === 'dine-in' || deliveryType === 'car-order' || businessData.businessType === 'street-vendor';
  if (!needsToken) return { dineInToken: null };

  if (body?.dineInToken) {
    return { dineInToken: String(body.dineInToken) };
  }

  const explicitTabId = String(body?.dineInTabId || body?.tabId || '').trim();
  if (explicitTabId) {
    const existingSnap = await firestore
      .collection('orders')
      .where('restaurantId', '==', businessRef.id)
      .where('dineInTabId', '==', explicitTabId)
      .where('status', 'in', ['awaiting_payment', 'pending', 'accepted', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'delivered'])
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0].data() || {};
      if (existing.dineInToken) return { dineInToken: existing.dineInToken };
    }
  }

  const result = await firestore.runTransaction(async (tx) => {
    const businessSnap = await tx.get(businessRef);
    const data = businessSnap.exists ? (businessSnap.data() || {}) : {};
    const lastToken = Number(data.lastOrderToken || 0);
    const nextToken = lastToken + 1;
    tx.update(businessRef, { lastOrderToken: nextToken });
    return nextToken;
  });

  return { dineInToken: generateDineInTokenValue(result) };
}

async function createTrackingToken({ firestore, identity }) {
  const token = randomToken(24);
  const payload = {
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    type: 'tracking',
  };
  if (identity.userId && String(identity.userId).startsWith('g_')) {
    payload.guestId = identity.userId;
  } else if (identity.userId) {
    payload.userId = identity.userId;
  }
  if (identity.phone) {
    payload.phone = identity.phone;
  }
  await firestore.collection('auth_tokens').doc(token).set(payload);
  return token;
}

async function reserveIdempotency({ firestore, key }) {
  if (!key) {
    throw new HttpError(400, 'Missing idempotency key. Please refresh and try again.');
  }
  const ref = firestore.collection('idempotency_keys').doc(key);

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.status === 'completed' && data.responsePayload) {
        return { duplicate: true, responsePayload: data.responsePayload, ref };
      }

      const startedAt = data.startedAt?.toMillis ? data.startedAt.toMillis() : 0;
      if (data.status === 'processing' && startedAt && (Date.now() - startedAt) < 30000) {
        throw new HttpError(409, 'Order is already being processed. Please wait a few seconds.');
      }
    }

    tx.set(
      ref,
      {
        status: 'processing',
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { duplicate: false, ref };
  });
}

async function markIdempotencyComplete({ ref, payload, orderId }) {
  await ref.set(
    {
      status: 'completed',
      orderId,
      responsePayload: payload,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function markIdempotencyFailed({ ref, message }) {
  if (!ref) return;
  await ref.set(
    {
      status: 'failed',
      failureReason: String(message || 'unknown_error').slice(0, 200),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function createOrderNative({ req, body }) {
  const firestore = await getFirestore();

  const restaurantId = String(body?.restaurantId || body?.shopId || '').trim();
  const items = Array.isArray(body?.items) ? body.items : [];
  const paymentMethod = normalizePaymentMethod(body?.paymentMethod);
  const deliveryType = String(body?.deliveryType || 'delivery').trim().toLowerCase();
  const idempotencyKey = String(body?.idempotencyKey || '').trim();

  if (!restaurantId) throw new HttpError(400, 'Restaurant ID is required.');
  if (!items.length) throw new HttpError(400, 'At least one item is required.');
  if (!paymentMethod) throw new HttpError(400, 'Payment method is required.');
  if (!SUPPORTED_PAYMENT_METHODS.has(paymentMethod)) {
    throw new HttpError(400, `Unsupported payment method for native flow: ${paymentMethod}`);
  }

  const reservation = await reserveIdempotency({ firestore, key: idempotencyKey });
  if (reservation.duplicate) {
    return {
      payload: reservation.responsePayload,
      duplicate: true,
    };
  }

  const keyRef = reservation.ref;
  try {
    const business = await findBusinessById({ firestore, businessId: restaurantId });
    const businessData = business.data || {};
    if (!getEffectiveBusinessOpenStatus(businessData)) {
      throw new HttpError(403, 'Restaurant is currently closed. Please order during opening hours.');
    }

    const identity = await resolveCustomerIdentity({ firestore, req, body });
    const customerName = String(body?.name || body?.tab_name || identity.profileName || 'Guest').trim();
    const customerPhone = normalizePhone(body?.phone || identity.phone || '');

    const pricing = await calculateServerTotal({
      firestore,
      restaurantRef: business.ref,
      items,
    });

    try {
      validatePriceMatch(Number(body?.subtotal || 0), pricing.serverSubtotal, 2);
    } catch (error) {
      throw mapPricingError(error);
    }

    const taxes = calculateTaxes(pricing.serverSubtotal, businessData);
    const packagingCharge = normalizeMoney(body?.packagingCharge, 0);
    const tipAmount = normalizeMoney(body?.tipAmount, 0);
    const convenienceFee = normalizeMoney(body?.convenienceFee, 0);
    const platformFee = normalizeMoney(body?.platformFee, 0);
    const serviceFee = normalizeMoney(body?.serviceFee, 0);
    const discount = normalizeMoney(body?.discount, 0) + normalizeMoney(body?.loyaltyDiscount, 0);

    let deliveryCharge = normalizeMoney(body?.deliveryCharge, 0);
    const skipAddressValidation = body?.skipAddressValidation === true;
    const address = body?.address && typeof body.address === 'object' ? body.address : null;

    if (deliveryType === 'delivery') {
      const coords = extractAddressLatLng(address || {});
      if (!coords && !skipAddressValidation) {
        throw new HttpError(400, 'Delivery address coordinates are required.');
      }
      if (coords && !skipAddressValidation) {
        const validation = await calculateDeliveryChargeServer({
          restaurantId,
          addressLat: coords.lat,
          addressLng: coords.lng,
          subtotal: pricing.serverSubtotal,
        });
        if (!validation.allowed) {
          throw new HttpError(400, validation.message || 'Delivery not available for selected address.');
        }
        deliveryCharge = normalizeMoney(validation.charge, 0);
      }
    } else {
      deliveryCharge = 0;
    }

    const serverGrandTotal = Math.max(
      0,
      pricing.serverSubtotal +
        taxes.cgst +
        taxes.sgst +
        deliveryCharge +
        packagingCharge +
        tipAmount +
        convenienceFee +
        platformFee +
        serviceFee -
        discount
    );

    const clientGrandTotal = Number(body?.grandTotal || 0);
    const grandTotalDiff = Math.abs(clientGrandTotal - serverGrandTotal);
    if (grandTotalDiff > 5) {
      throw new HttpError(
        400,
        `Grand total mismatch. Please refresh and try again. (Client: ₹${clientGrandTotal}, Server: ₹${serverGrandTotal})`
      );
    }

    const status = ONLINE_PAYMENT_METHODS.has(paymentMethod) ? 'awaiting_payment' : 'pending';
    const paymentStatus = 'pending';
    const trackingToken = await createTrackingToken({ firestore, identity });
    const dineInTabId = String(body?.dineInTabId || body?.tabId || '').trim() || null;
    const dineInTokenResult = await resolveDineInToken({
      firestore,
      businessRef: business.ref,
      businessData,
      body,
    });

    const addressCoords = extractAddressLatLng(address || {});
    const orderDocRef = firestore.collection('orders').doc();
    const customerOrderId = generateCustomerOrderId();

    const orderPayload = {
      customerOrderId,
      restaurantId,
      restaurantName: businessData.name || '',
      businessType: business.businessType || 'restaurant',

      userId: identity.userId || null,
      customerId: identity.userId || null,
      customerName,
      customerPhone: customerPhone || null,
      customerAddress: address || null,
      customerLocation: addressCoords ? new GeoPoint(addressCoords.lat, addressCoords.lng) : null,

      items: pricing.validatedItems.map(optimizeItemSnapshot),
      notes: body?.notes || '',
      coupon: body?.coupon || null,
      discount,
      loyaltyDiscount: normalizeMoney(body?.loyaltyDiscount, 0),

      subtotal: pricing.serverSubtotal,
      cgst: taxes.cgst,
      sgst: taxes.sgst,
      deliveryCharge,
      packagingCharge,
      tipAmount,
      convenienceFee,
      platformFee,
      serviceFee,
      totalAmount: serverGrandTotal,

      status,
      paymentStatus,
      paymentMethod,
      trackingToken,

      deliveryType,
      pickupTime: body?.pickupTime || '',
      diningPreference: deliveryType === 'dine-in' ? (body?.diningPreference || null) : null,
      tableId: body?.tableId || null,
      dineInTabId,
      tabId: dineInTabId,
      tab_name: body?.tab_name || body?.tabName || null,
      pax_count: Number(body?.pax_count || body?.paxCount || 0) || null,
      dineInToken: dineInTokenResult.dineInToken || null,

      isCarOrder: deliveryType === 'car-order',
      carSpot: body?.carSpot || null,
      carDetails: body?.carDetails || null,

      ordered_by: body?.ordered_by || 'customer',
      ordered_by_name: body?.ordered_by_name || null,
      source: 'backend_v2',

      orderDate: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: [
        {
          status,
          timestamp: new Date(),
          notes: ONLINE_PAYMENT_METHODS.has(paymentMethod) ? 'Waiting for payment confirmation' : 'Order created',
        },
      ],
    };

    await orderDocRef.set(orderPayload);

    const responsePayload = {
      message: 'Order created successfully.',
      order_id: orderDocRef.id,
      firestore_order_id: orderDocRef.id,
      token: trackingToken,
      payment_method: paymentMethod,
      status,
      dineInTabId: dineInTabId || null,
      dine_in_tab_id: dineInTabId || null,
      dineInToken: dineInTokenResult.dineInToken || null,
      customerOrderId,
      source: 'backend_v2_native',
    };

    await markIdempotencyComplete({
      ref: keyRef,
      payload: responsePayload,
      orderId: orderDocRef.id,
    });

    emitOrderEvent({
      eventType: 'order.created',
      businessId: restaurantId,
      orderId: orderDocRef.id,
      data: {
        status,
        paymentStatus,
        deliveryType,
      },
    });

    return {
      payload: responsePayload,
      duplicate: false,
    };
  } catch (error) {
    await markIdempotencyFailed({
      ref: keyRef,
      message: error?.message || 'order_create_failed',
    });
    throw error;
  }
}

module.exports = {
  shouldUseLegacyCreateOrder,
  createOrderNative,
};
