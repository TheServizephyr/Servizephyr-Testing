const { FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext } = require('./accessControl.service');

function canManageCoupons(owner) {
  if (owner.isAdminImpersonation) return true;
  const role = String(owner.callerRole || '').toLowerCase();
  return role === 'owner' || role === 'street-vendor' || role === 'manager';
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function serializeCoupon(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    startDate: toIso(data.startDate) || data.startDate || null,
    expiryDate: toIso(data.expiryDate) || data.expiryDate || null,
    createdAt: toIso(data.createdAt) || data.createdAt || null,
    updatedAt: toIso(data.updatedAt) || data.updatedAt || null,
  };
}

function normalizeCouponType(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCouponCode(value) {
  return String(value || '').trim().toUpperCase();
}

function sanitizeCouponWritePayload(coupon, { isUpdate = false } = {}) {
  if (!coupon || typeof coupon !== 'object' || Array.isArray(coupon)) {
    throw new HttpError(400, 'Invalid coupon payload.');
  }

  const next = { ...coupon };

  if (!isUpdate) {
    if (!normalizeCouponCode(next.code)) {
      throw new HttpError(400, 'Coupon code is required.');
    }
    if (next.minOrder === undefined || next.minOrder === null) {
      throw new HttpError(400, 'Minimum order value is required.');
    }
  }

  if (next.code !== undefined) next.code = normalizeCouponCode(next.code);
  if (next.type !== undefined) next.type = normalizeCouponType(next.type);
  if (next.status !== undefined) next.status = String(next.status || 'inactive').trim().toLowerCase();

  if (next.minOrder !== undefined) {
    const minOrder = Number(next.minOrder);
    next.minOrder = Number.isFinite(minOrder) ? minOrder : 0;
  }

  if (next.maxDiscount !== undefined) {
    const maxDiscount = Number(next.maxDiscount);
    next.maxDiscount = Number.isFinite(maxDiscount) ? maxDiscount : 0;
  }

  if (next.type === 'free_delivery') {
    next.value = 0;
  } else if (next.value !== undefined) {
    const value = Number(next.value);
    next.value = Number.isFinite(value) ? value : 0;
  } else if (!isUpdate) {
    throw new HttpError(400, 'Coupon value is required.');
  }

  if (next.startDate !== undefined) {
    const parsed = toDate(next.startDate);
    if (!parsed) throw new HttpError(400, 'Invalid startDate.');
    next.startDate = parsed;
  }

  if (next.expiryDate !== undefined) {
    const parsed = toDate(next.expiryDate);
    if (!parsed) throw new HttpError(400, 'Invalid expiryDate.');
    next.expiryDate = parsed;
  }

  delete next.id;
  delete next.createdAt;
  delete next.updatedAt;
  delete next.timesUsed;

  return next;
}

async function bumpMenuVersion(owner) {
  await owner.firestore
    .collection(owner.collectionName)
    .doc(owner.businessId)
    .update({
      menuVersion: FieldValue.increment(1),
      updatedAt: new Date(),
    })
    .catch(() => null);
}

async function getOwnerCoupons(req) {
  const owner = await resolveOwnerContext(req, {
    allowEmployee: true,
    allowAdminImpersonation: true,
  });

  const couponsRef = owner.firestore
    .collection(owner.collectionName)
    .doc(owner.businessId)
    .collection('coupons');

  let couponsSnap;
  try {
    couponsSnap = await couponsRef.orderBy('expiryDate', 'desc').get();
  } catch {
    couponsSnap = await couponsRef.get();
  }

  return {
    coupons: couponsSnap.docs.map(serializeCoupon),
  };
}

async function createOwnerCoupon(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    allowEmployee: true,
    allowAdminImpersonation: true,
  });

  if (!canManageCoupons(owner)) {
    throw new HttpError(403, 'Access denied: insufficient privileges to manage coupons.');
  }

  const couponRaw = req.body?.coupon;
  const coupon = sanitizeCouponWritePayload(couponRaw, { isUpdate: false });

  const couponsRef = owner.firestore
    .collection(owner.collectionName)
    .doc(owner.businessId)
    .collection('coupons');

  const newCouponRef = couponsRef.doc();
  await newCouponRef.set({
    ...coupon,
    id: newCouponRef.id,
    timesUsed: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await bumpMenuVersion(owner);

  return {
    message: 'Coupon created successfully!',
    id: newCouponRef.id,
  };
}

async function updateOwnerCoupon(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    allowEmployee: true,
    allowAdminImpersonation: true,
  });

  if (!canManageCoupons(owner)) {
    throw new HttpError(403, 'Access denied: insufficient privileges to manage coupons.');
  }

  const couponRaw = req.body?.coupon;
  if (!couponRaw || typeof couponRaw !== 'object') {
    throw new HttpError(400, 'Coupon payload is required.');
  }

  const couponId = String(couponRaw.id || '').trim();
  if (!couponId) {
    throw new HttpError(400, 'Coupon ID is required for updating.');
  }

  const updateData = sanitizeCouponWritePayload(couponRaw, { isUpdate: true });
  updateData.updatedAt = FieldValue.serverTimestamp();

  const couponRef = owner.firestore
    .collection(owner.collectionName)
    .doc(owner.businessId)
    .collection('coupons')
    .doc(couponId);

  await couponRef.update(updateData);
  await bumpMenuVersion(owner);

  return {
    message: 'Coupon updated successfully!',
  };
}

async function deleteOwnerCoupon(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    allowEmployee: true,
    allowAdminImpersonation: true,
  });

  if (!canManageCoupons(owner)) {
    throw new HttpError(403, 'Access denied: insufficient privileges to manage coupons.');
  }

  const couponId = String(req.body?.couponId || '').trim();
  if (!couponId) {
    throw new HttpError(400, 'Coupon ID is required.');
  }

  await owner.firestore
    .collection(owner.collectionName)
    .doc(owner.businessId)
    .collection('coupons')
    .doc(couponId)
    .delete();

  await bumpMenuVersion(owner);

  return {
    message: 'Coupon deleted successfully.',
  };
}

module.exports = {
  getOwnerCoupons,
  createOwnerCoupon,
  updateOwnerCoupon,
  deleteOwnerCoupon,
};
