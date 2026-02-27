const { getFirestore, FieldValue } = require('../lib/firebaseAdmin');
const { findBusinessById } = require('./business.service');
const { normalizeBusinessType } = require('./business.service');
const { getEffectiveBusinessOpenStatus } = require('../utils/businessSchedule');
const { toDateSafe } = require('../utils/guest');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext } = require('./accessControl.service');

function normalizeCouponType(couponType) {
  const normalized = String(couponType || '').trim().toLowerCase();
  if (normalized === 'fixed') return 'flat';
  return normalized;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value || '').trim());
}

function canManageOwnerSettings(owner) {
  if (owner.isAdminImpersonation) return true;
  const role = String(owner.callerRole || '').toLowerCase();
  return role === 'owner' || role === 'street-vendor' || role === 'manager';
}

function sanitizeAddress(address) {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return null;
  const next = { ...address };
  delete next.full;
  return next;
}

async function getDeliveryConfig(businessRef) {
  const deliveryConfigSnap = await businessRef.collection('delivery_settings').doc('config').get();
  if (!deliveryConfigSnap.exists) return {};
  return deliveryConfigSnap.data() || {};
}

function buildOwnerSettingsPayload({
  owner,
  userData,
  businessData,
  deliveryConfig,
}) {
  const fallback = (key, defaultValue) => {
    const fromDeliveryConfig = deliveryConfig[key];
    if (fromDeliveryConfig !== undefined && fromDeliveryConfig !== null) return fromDeliveryConfig;
    const fromBusinessData = businessData[key];
    if (fromBusinessData !== undefined && fromBusinessData !== null) return fromBusinessData;
    return defaultValue;
  };

  const businessType = normalizeBusinessType(businessData?.businessType, owner.collectionName);
  const effectiveIsOpen = getEffectiveBusinessOpenStatus(businessData);

  return {
    name: userData.name || 'No Name',
    email: userData.email || 'No Email',
    phone: userData.phone || '',
    role: userData.role || owner.callerRole || 'customer',
    businessType,
    restaurantName: businessData?.name || '',
    profilePicture: userData.profilePictureUrl || `https://picsum.photos/seed/${owner.actorUid}/200/200`,
    notifications: userData.notifications || { newOrders: true, dailySummary: false, marketing: true },
    address: (
      businessData?.address && typeof businessData.address === 'object'
        ? businessData.address
        : { street: '', city: '', state: '', postalCode: '', country: 'IN' }
    ),
    gstin: businessData?.gstin || '',
    fssai: businessData?.fssai || '',
    botPhoneNumberId: businessData?.botPhoneNumberId || '',
    botDisplayNumber: businessData?.botDisplayNumber || '',
    razorpayAccountId: businessData?.razorpayAccountId || '',
    logoUrl: businessData?.logoUrl || '',
    bannerUrls: Array.isArray(businessData?.bannerUrls) ? businessData.bannerUrls : [],

    deliveryEnabled: toBool(fallback('deliveryEnabled', true), true),
    deliveryRadius: toNumber(fallback('deliveryRadius', 5), 5),
    deliveryFeeType: String(fallback('deliveryFeeType', 'fixed') || 'fixed'),
    deliveryCharge: String(fallback('deliveryFeeType', 'fixed') || 'fixed') === 'fixed'
      ? toNumber(fallback('deliveryFixedFee', 30), 30)
      : 0,
    deliveryFixedFee: toNumber(fallback('deliveryFixedFee', 30), 30),
    deliveryPerKmFee: toNumber(fallback('deliveryPerKmFee', 5), 5),
    deliveryBaseDistance: toNumber(fallback('deliveryBaseDistance', 0), 0),
    deliveryFreeThreshold: toNumber(fallback('deliveryFreeThreshold', 500), 500),
    roadDistanceFactor: toNumber(fallback('roadDistanceFactor', 1.0), 1.0),
    freeDeliveryRadius: toNumber(fallback('freeDeliveryRadius', 0), 0),
    freeDeliveryMinOrder: toNumber(fallback('freeDeliveryMinOrder', 0), 0),
    deliveryTiers: Array.isArray(fallback('deliveryTiers', [])) ? fallback('deliveryTiers', []) : [],
    deliveryOrderSlabRules: Array.isArray(fallback('deliveryOrderSlabRules', []))
      ? fallback('deliveryOrderSlabRules', [])
      : [],
    deliveryOrderSlabAboveFee: toNumber(fallback('deliveryOrderSlabAboveFee', 0), 0),
    deliveryOrderSlabBaseDistance: toNumber(fallback('deliveryOrderSlabBaseDistance', 1), 1),
    deliveryOrderSlabPerKmFee: toNumber(fallback('deliveryOrderSlabPerKmFee', 15), 15),

    pickupEnabled: toBool(fallback('pickupEnabled', false), false),
    dineInEnabled: toBool(fallback('dineInEnabled', true), true),
    deliveryOnlinePaymentEnabled: toBool(fallback('deliveryOnlinePaymentEnabled', true), true),
    deliveryCodEnabled: toBool(fallback('deliveryCodEnabled', true), true),
    pickupOnlinePaymentEnabled: toBool(fallback('pickupOnlinePaymentEnabled', true), true),
    pickupPodEnabled: toBool(fallback('pickupPodEnabled', true), true),
    dineInOnlinePaymentEnabled: toBool(fallback('dineInOnlinePaymentEnabled', true), true),
    dineInPayAtCounterEnabled: toBool(fallback('dineInPayAtCounterEnabled', true), true),

    isOpen: effectiveIsOpen,
    autoScheduleEnabled: toBool(businessData?.autoScheduleEnabled, false),
    openingTime: businessData?.openingTime || '09:00',
    closingTime: businessData?.closingTime || '22:00',
    dineInModel: businessData?.dineInModel || 'post-paid',

    gstEnabled: toBool(businessData?.gstEnabled, false),
    gstRate: toNumber(businessData?.gstPercentage ?? businessData?.gstRate, 5),
    gstPercentage: toNumber(businessData?.gstPercentage ?? businessData?.gstRate, 0),
    gstMinAmount: toNumber(businessData?.gstMinAmount, 0),
    convenienceFeeEnabled: toBool(businessData?.convenienceFeeEnabled, false),
    convenienceFeeRate: toNumber(businessData?.convenienceFeeRate, 2.5),
    convenienceFeePaidBy: businessData?.convenienceFeePaidBy || 'customer',
    convenienceFeeLabel: businessData?.convenienceFeeLabel || 'Payment Processing Fee',
    packagingChargeEnabled: toBool(businessData?.packagingChargeEnabled, false),
    packagingChargeAmount: toNumber(businessData?.packagingChargeAmount, 0),

    businessId: owner.businessId,
    merchantId: businessData?.merchantId || '',
    customerId: userData?.customerId || '',
    paymentQRCode: businessData?.paymentQRCode || null,
    upiId: businessData?.upiId || '',
    upiPayeeName: businessData?.upiPayeeName || businessData?.name || '',
  };
}

async function getPublicOwnerSettings({ businessId, includeCoupons = false }) {
  const safeBusinessId = String(businessId || '').trim();
  if (!safeBusinessId) throw new HttpError(400, 'Business ID is required.');

  const firestore = await getFirestore();
  const business = await findBusinessById({
    firestore,
    businessId: safeBusinessId,
  });

  const businessData = business.data || {};
  const deliveryConfigSnap = await business.ref.collection('delivery_settings').doc('config').get();
  const deliveryConfig = deliveryConfigSnap.exists ? (deliveryConfigSnap.data() || {}) : {};
  const fallback = (key, defaultValue) => {
    const fromDeliveryConfig = deliveryConfig[key];
    if (fromDeliveryConfig !== undefined && fromDeliveryConfig !== null) return fromDeliveryConfig;
    const fromBusinessData = businessData[key];
    if (fromBusinessData !== undefined && fromBusinessData !== null) return fromBusinessData;
    return defaultValue;
  };

  const responsePayload = {
    deliveryCodEnabled: fallback('deliveryCodEnabled', true),
    deliveryOnlinePaymentEnabled: fallback('deliveryOnlinePaymentEnabled', true),
    pickupPodEnabled: fallback('pickupPodEnabled', true),
    pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
    dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),
    dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),
    botPhoneNumberId: businessData.botPhoneNumberId || null,
    botDisplayNumber: businessData.botDisplayNumber || null,

    gstEnabled: Boolean(businessData.gstEnabled),
    gstPercentage: Number(businessData.gstPercentage || businessData.gstRate || 0),
    gstMinAmount: Number(businessData.gstMinAmount || 0),
    convenienceFeeEnabled: Boolean(businessData.convenienceFeeEnabled),
    convenienceFeeRate: Number(businessData.convenienceFeeRate || 2.5),
    convenienceFeePaidBy: businessData.convenienceFeePaidBy || 'customer',
    convenienceFeeLabel: businessData.convenienceFeeLabel || 'Payment Processing Fee',
    packagingChargeEnabled: Boolean(businessData.packagingChargeEnabled),
    packagingChargeAmount: Number(businessData.packagingChargeAmount || 0),

    deliveryFeeType: fallback('deliveryFeeType', 'fixed'),
    deliveryCharge: fallback('deliveryFeeType', 'fixed') === 'fixed' ? fallback('deliveryFixedFee', 30) : 0,
    deliveryFixedFee: Number(fallback('deliveryFixedFee', 30)),
    deliveryPerKmFee: Number(fallback('deliveryPerKmFee', 5)),
    deliveryFreeThreshold: Number(fallback('deliveryFreeThreshold', 500)),
    deliveryRadius: Number(fallback('deliveryRadius', 5)),
    deliveryEnabled: fallback('deliveryEnabled', true),
    roadDistanceFactor: Number(fallback('roadDistanceFactor', 1.0)),
    freeDeliveryRadius: Number(fallback('freeDeliveryRadius', 0)),
    freeDeliveryMinOrder: Number(fallback('freeDeliveryMinOrder', 0)),
    deliveryOrderSlabRules: fallback('deliveryOrderSlabRules', []),
    deliveryOrderSlabAboveFee: Number(fallback('deliveryOrderSlabAboveFee', 0)),
    deliveryOrderSlabBaseDistance: Number(fallback('deliveryOrderSlabBaseDistance', 1)),
    deliveryOrderSlabPerKmFee: Number(fallback('deliveryOrderSlabPerKmFee', 15)),
    pickupEnabled: fallback('pickupEnabled', true),
    dineInEnabled: fallback('dineInEnabled', true),
    isOpen: getEffectiveBusinessOpenStatus(businessData),
  };

  if (includeCoupons) {
    const now = new Date();
    try {
      const couponsSnap = await business.ref.collection('coupons').where('status', '==', 'active').get();
      responsePayload.coupons = couponsSnap.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
        .filter((coupon) => {
          const expiry = toDateSafe(coupon.expiryDate);
          return !expiry || expiry > now;
        })
        .map((coupon) => ({
          ...coupon,
          type: normalizeCouponType(coupon.type),
          value: Number(coupon.value || 0),
          minOrder: Number(coupon.minOrder || 0),
          maxDiscount: Number(coupon.maxDiscount || 0),
        }));
    } catch {
      responsePayload.coupons = [];
    }
  }

  return responsePayload;
}

async function getAuthenticatedOwnerSettings(req) {
  const owner = await resolveOwnerContext(req, {
    allowEmployee: true,
    allowAdminImpersonation: true,
  });

  const userDoc = await owner.firestore.collection('users').doc(owner.actorUid).get();
  const userData = userDoc.exists ? (userDoc.data() || {}) : {};
  const deliveryConfig = await getDeliveryConfig(owner.businessSnap.ref);

  return buildOwnerSettingsPayload({
    owner,
    userData,
    businessData: owner.businessData || {},
    deliveryConfig,
  });
}

async function patchAuthenticatedOwnerSettings(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    allowEmployee: true,
    allowAdminImpersonation: true,
  });

  if (!canManageOwnerSettings(owner)) {
    throw new HttpError(403, 'Access denied: insufficient privileges to update settings.');
  }

  const updates = req.body || {};
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new HttpError(400, 'Invalid settings payload.');
  }

  const firestore = owner.firestore;
  const userRef = firestore.collection('users').doc(owner.actorUid);
  const businessRef = owner.businessSnap.ref;
  const businessData = owner.businessData || {};

  const userUpdateData = {};
  if (updates.name !== undefined) userUpdateData.name = String(updates.name || '').trim();
  if (updates.phone !== undefined) userUpdateData.phone = String(updates.phone || '').trim();
  if (updates.notifications !== undefined && typeof updates.notifications === 'object') {
    userUpdateData.notifications = updates.notifications;
  }
  if (Object.keys(userUpdateData).length > 0) {
    await userRef.set(userUpdateData, { merge: true });
  }

  const businessUpdateData = {};

  if (updates.restaurantName !== undefined) {
    businessUpdateData.name = String(updates.restaurantName || '').trim();
  }
  if (updates.gstin !== undefined) businessUpdateData.gstin = String(updates.gstin || '').trim();
  if (updates.fssai !== undefined) businessUpdateData.fssai = String(updates.fssai || '').trim();
  if (updates.botPhoneNumberId !== undefined) {
    businessUpdateData.botPhoneNumberId = String(updates.botPhoneNumberId || '').trim();
  }
  if (updates.botDisplayNumber !== undefined) {
    businessUpdateData.botDisplayNumber = String(updates.botDisplayNumber || '').trim();
  }
  if (updates.razorpayAccountId !== undefined) {
    businessUpdateData.razorpayAccountId = String(updates.razorpayAccountId || '').trim();
  }
  if (updates.logoUrl !== undefined) businessUpdateData.logoUrl = String(updates.logoUrl || '');
  if (updates.bannerUrls !== undefined) {
    businessUpdateData.bannerUrls = Array.isArray(updates.bannerUrls) ? updates.bannerUrls : [];
  }
  if (updates.address !== undefined) {
    const sanitizedAddress = sanitizeAddress(updates.address);
    if (!sanitizedAddress) {
      throw new HttpError(400, 'Address must be an object.');
    }
    businessUpdateData.address = sanitizedAddress;
  }
  if (updates.paymentQRCode !== undefined) {
    businessUpdateData.paymentQRCode = updates.paymentQRCode || null;
  }
  if (updates.upiId !== undefined) businessUpdateData.upiId = String(updates.upiId || '').trim();
  if (updates.upiPayeeName !== undefined) {
    businessUpdateData.upiPayeeName = String(updates.upiPayeeName || '').trim();
  }

  if (updates.isOpen !== undefined) {
    const nextIsOpen = toBool(updates.isOpen, false);
    if (nextIsOpen !== toBool(businessData?.isOpen, false)) {
      businessUpdateData.isOpen = nextIsOpen;
      businessUpdateData.menuVersion = FieldValue.increment(1);
    }
  }

  if (updates.phone !== undefined && String(updates.phone || '').trim() !== String(businessData?.ownerPhone || '').trim()) {
    businessUpdateData.ownerPhone = String(updates.phone || '').trim();
  }

  if (updates.autoScheduleEnabled !== undefined) {
    businessUpdateData.autoScheduleEnabled = toBool(updates.autoScheduleEnabled, false);
  }

  if (updates.openingTime !== undefined) {
    if (!isValidTime(updates.openingTime)) {
      throw new HttpError(400, 'Invalid opening time. Use HH:mm format.');
    }
    businessUpdateData.openingTime = String(updates.openingTime).trim();
  }

  if (updates.closingTime !== undefined) {
    if (!isValidTime(updates.closingTime)) {
      throw new HttpError(400, 'Invalid closing time. Use HH:mm format.');
    }
    businessUpdateData.closingTime = String(updates.closingTime).trim();
  }

  if (updates.gstEnabled !== undefined) businessUpdateData.gstEnabled = toBool(updates.gstEnabled, false);
  if (updates.gstPercentage !== undefined || updates.gstRate !== undefined) {
    const gstPercentage = toNumber(updates.gstPercentage ?? updates.gstRate, 0);
    businessUpdateData.gstPercentage = gstPercentage;
    businessUpdateData.gstRate = gstPercentage;
  }
  if (updates.gstMinAmount !== undefined) businessUpdateData.gstMinAmount = toNumber(updates.gstMinAmount, 0);
  if (updates.convenienceFeeEnabled !== undefined) {
    businessUpdateData.convenienceFeeEnabled = toBool(updates.convenienceFeeEnabled, false);
  }
  if (updates.convenienceFeeRate !== undefined) {
    businessUpdateData.convenienceFeeRate = toNumber(updates.convenienceFeeRate, 2.5);
  }
  if (updates.convenienceFeePaidBy !== undefined) {
    businessUpdateData.convenienceFeePaidBy = String(updates.convenienceFeePaidBy || 'customer').trim() || 'customer';
  }
  if (updates.convenienceFeeLabel !== undefined) {
    businessUpdateData.convenienceFeeLabel = String(updates.convenienceFeeLabel || '').trim();
  }
  if (updates.packagingChargeEnabled !== undefined) {
    businessUpdateData.packagingChargeEnabled = toBool(updates.packagingChargeEnabled, false);
  }
  if (updates.packagingChargeAmount !== undefined) {
    businessUpdateData.packagingChargeAmount = toNumber(updates.packagingChargeAmount, 0);
  }

  if (updates.dineInEnabled !== undefined) {
    businessUpdateData.dineInEnabled = toBool(updates.dineInEnabled, true);
  }
  if (updates.dineInModel !== undefined) {
    businessUpdateData.dineInModel = String(updates.dineInModel || '').trim() || 'post-paid';
  }
  if (updates.pickupEnabled !== undefined) {
    businessUpdateData.pickupEnabled = toBool(updates.pickupEnabled, true);
  }
  if (updates.pickupOnlinePaymentEnabled !== undefined) {
    businessUpdateData.pickupOnlinePaymentEnabled = toBool(updates.pickupOnlinePaymentEnabled, true);
  }
  if (updates.pickupPodEnabled !== undefined) {
    businessUpdateData.pickupPodEnabled = toBool(updates.pickupPodEnabled, true);
  }
  if (updates.dineInOnlinePaymentEnabled !== undefined) {
    businessUpdateData.dineInOnlinePaymentEnabled = toBool(updates.dineInOnlinePaymentEnabled, true);
  }
  if (updates.dineInPayAtCounterEnabled !== undefined) {
    businessUpdateData.dineInPayAtCounterEnabled = toBool(updates.dineInPayAtCounterEnabled, true);
  }

  const deliveryFields = [
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
    'pickupEnabled',
    'dineInEnabled',
    'pickupOnlinePaymentEnabled',
    'pickupPodEnabled',
    'dineInOnlinePaymentEnabled',
    'dineInPayAtCounterEnabled',
  ];

  const deliveryUpdates = {};
  for (const field of deliveryFields) {
    if (updates[field] !== undefined) {
      deliveryUpdates[field] = updates[field];
    }
  }
  if (updates.deliveryCharge !== undefined && deliveryUpdates.deliveryFixedFee === undefined) {
    deliveryUpdates.deliveryFixedFee = toNumber(updates.deliveryCharge, 0);
  }

  if (Object.keys(deliveryUpdates).length > 0) {
    await businessRef.collection('delivery_settings').doc('config').set(deliveryUpdates, { merge: true });
  }

  // Bump menuVersion if any public-facing field changed (delivery, GST, name, logo, etc.)
  // This automatically busts the 12h public menu cache without waiting for TTL to expire.
  const publicFacingFieldsChanged =
    Object.keys(businessUpdateData).some((key) =>
      key !== 'updatedAt' && key !== 'isOpen' // isOpen already bumps menuVersion above
    ) || Object.keys(deliveryUpdates).length > 0;

  if (publicFacingFieldsChanged && !businessUpdateData.menuVersion) {
    // isOpen change already sets businessUpdateData.menuVersion — avoid double increment
    businessUpdateData.menuVersion = FieldValue.increment(1);
  }

  if (Object.keys(businessUpdateData).length > 0) {
    businessUpdateData.updatedAt = new Date();
    await businessRef.update(businessUpdateData);
  }

  const [finalBusinessSnap, finalUserSnap] = await Promise.all([businessRef.get(), userRef.get()]);
  const finalBusinessData = finalBusinessSnap.exists ? (finalBusinessSnap.data() || {}) : {};
  const finalUserData = finalUserSnap.exists ? (finalUserSnap.data() || {}) : {};
  const finalDeliveryConfig = await getDeliveryConfig(businessRef);

  return buildOwnerSettingsPayload({
    owner: {
      ...owner,
      businessData: finalBusinessData,
    },
    userData: finalUserData,
    businessData: finalBusinessData,
    deliveryConfig: finalDeliveryConfig,
  });
}

module.exports = {
  getPublicOwnerSettings,
  getAuthenticatedOwnerSettings,
  patchAuthenticatedOwnerSettings,
};
