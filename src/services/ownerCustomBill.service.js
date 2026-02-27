const { createHash, randomBytes } = require('crypto');
const { FieldValue } = require('../lib/firebaseAdmin');
const { config } = require('../config/env');
const { HttpError } = require('../utils/httpError');
const { obfuscateGuestId, normalizePhone } = require('../utils/guest');
const { createOrderNative } = require('./orderCreate.service');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

const SHORT_LINK_COLLECTION = 'short_links';
const SHORT_LINK_LENGTH = 8;
const SHORT_LINK_MAX_ATTEMPTS = 5;
const SHORT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toAmount(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
}

function sanitizeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function toLowerText(value) {
  return String(value || '').toLowerCase();
}

function isSettlementEligible(printedVia) {
  return printedVia !== 'create_order';
}

function normalizeItem(item, index) {
  const quantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
  const unitPrice = toAmount(item?.price ?? item?.portion?.price, 0);
  const totalPrice = toAmount(item?.totalPrice, unitPrice * quantity);

  return {
    id: item?.id || `manual-item-${index + 1}`,
    name: sanitizeText(item?.name, 'Custom Item'),
    quantity,
    price: unitPrice,
    totalPrice,
    categoryId: sanitizeText(item?.categoryId, 'manual'),
    portionName: sanitizeText(item?.portion?.name || item?.portionName || '', ''),
    isVeg: item?.isVeg !== false,
    selectedAddOns: Array.isArray(item?.selectedAddOns)
      ? item.selectedAddOns.map((addon) => ({
        name: sanitizeText(addon?.name, 'Addon'),
        price: toAmount(addon?.price, 0),
        quantity: Math.max(1, parseInt(addon?.quantity, 10) || 1),
      }))
      : [],
  };
}

function normalizeAddAddressPath(fullUrl) {
  try {
    const parsed = new URL(fullUrl);
    if (!parsed.pathname.startsWith('/add-address')) {
      return null;
    }
    return `${parsed.pathname}${parsed.search || ''}`;
  } catch {
    return null;
  }
}

function generateShortCode(length = SHORT_LINK_LENGTH) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

async function createShortAddAddressCode({
  firestore,
  addAddressLink,
  businessId,
  orderId,
  customerPhone,
  customerName,
}) {
  const targetPath = normalizeAddAddressPath(addAddressLink);
  if (!targetPath) {
    throw new Error('Invalid add-address target path for short link.');
  }

  for (let attempt = 0; attempt < SHORT_LINK_MAX_ATTEMPTS; attempt += 1) {
    const code = generateShortCode();
    const docRef = firestore.collection(SHORT_LINK_COLLECTION).doc(code);
    try {
      await docRef.create({
        code,
        targetPath,
        purpose: 'manual_call_add_address',
        businessId,
        orderId,
        customerPhone,
        customerName: customerName || 'Guest',
        accessCount: 0,
        status: 'active',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SHORT_LINK_TTL_MS),
      });
      return code;
    } catch (error) {
      const alreadyExists =
        error?.code === 6 || /already exists/i.test(String(error?.message || ''));
      if (!alreadyExists) {
        throw error;
      }
    }
  }

  throw new Error('Unable to generate short link code. Please retry.');
}

function resolvePublicBaseUrl(req) {
  const PROD_BASE_URL = 'https://www.servizephyr.com';
  const envBase = (config.publicBaseUrl || '').trim();

  const requestOrigin = (() => {
    try {
      return `${req.protocol || 'https'}://${req.get('host')}`;
    } catch {
      return '';
    }
  })();

  const rawBase = (envBase || requestOrigin || PROD_BASE_URL).trim();
  const isTunnelOrLocal = /localhost|127\.0\.0\.1|ngrok|trycloudflare|loca\.lt|localtunnel/i.test(rawBase);
  return isTunnelOrLocal ? PROD_BASE_URL : rawBase;
}

function buildManualOrderIdempotencyKey({ businessId, phone, items, subtotal, deliveryCharge = 0 }) {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const normalizedItems = (items || [])
    .map((item) => {
      const id = String(item?.id || 'na');
      const qty = Number(item?.quantity || 1);
      const price = Number(item?.price || item?.totalPrice || 0);
      return `${id}:${qty}:${price}`;
    })
    .sort()
    .join('|');

  const signature = `${businessId}|${phone}|${normalizedItems}|${Number(subtotal || 0).toFixed(2)}|${Number(deliveryCharge || 0).toFixed(2)}|${minuteBucket}`;
  const digest = createHash('sha256').update(signature).digest('hex').slice(0, 24);
  return `manual_call_${digest}`;
}

function timestampToDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getBusinessTypeFromCollection(collectionName) {
  if (collectionName === 'shops') return 'store';
  if (collectionName === 'street_vendors') return 'street-vendor';
  return 'restaurant';
}

async function getOrCreateGuestProfile(firestore, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new HttpError(400, 'Valid customer phone is required.');
  }

  const userCandidates = [normalized, `+91${normalized}`];
  for (const candidate of userCandidates) {
    const userSnap = await firestore.collection('users').where('phone', '==', candidate).limit(1).get();
    if (!userSnap.empty) {
      return {
        userId: userSnap.docs[0].id,
        isGuest: false,
      };
    }
  }

  const guestSnap = await firestore.collection('guest_profiles').where('phone', '==', normalized).limit(1).get();
  if (!guestSnap.empty) {
    return {
      userId: guestSnap.docs[0].id,
      isGuest: true,
    };
  }

  const guestId = `g_${randomBytes(8).toString('hex')}`;
  await firestore.collection('guest_profiles').doc(guestId).set({
    phone: normalized,
    addresses: [],
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    userId: guestId,
    isGuest: true,
  };
}

async function postOwnerCustomBillCreateOrder(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANUAL_BILLING_WRITE, PERMISSIONS.VIEW_ORDERS],
  });

  const customerDetails = body.customerDetails || {};
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const notes = body.notes || '';

  const customerName = sanitizeText(customerDetails?.name, 'Guest') || 'Guest';
  const phone = normalizePhone(customerDetails?.phone);
  const addressText = sanitizeText(customerDetails?.address, '');

  if (!phone) {
    throw new HttpError(400, 'Valid customer phone is required.');
  }
  if (!rawItems.length) {
    throw new HttpError(400, 'At least one item is required.');
  }

  const items = rawItems.map(normalizeItem);
  const subtotal = items.reduce((sum, item) => sum + toAmount(item.totalPrice, 0), 0);
  const deliveryCharge = toAmount(body.deliveryCharge, 0);
  const hasOwnerDeliveryChargeOverride = deliveryCharge > 0;
  const grandTotal = subtotal + deliveryCharge;

  const ownerEnteredAddress = addressText ? { full: addressText } : null;

  const profile = await getOrCreateGuestProfile(owner.firestore, phone);
  const guestRef = obfuscateGuestId(profile.userId);

  const createOrderBody = {
    name: customerName,
    phone,
    address: ownerEnteredAddress,
    restaurantId: owner.businessId,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      categoryId: item.categoryId,
      isVeg: item.isVeg,
      quantity: item.quantity,
      price: item.price,
      totalPrice: item.totalPrice,
      cartItemId: item.id,
      portion: item.portionName ? { name: item.portionName, price: item.price } : undefined,
      selectedAddOns: item.selectedAddOns,
    })),
    notes,
    paymentMethod: 'cod',
    businessType: getBusinessTypeFromCollection(owner.collectionName),
    deliveryType: 'delivery',
    subtotal,
    cgst: 0,
    sgst: 0,
    grandTotal,
    deliveryCharge,
    skipAddressValidation: true,
    idempotencyKey: buildManualOrderIdempotencyKey({
      businessId: owner.businessId,
      phone,
      items,
      subtotal,
      deliveryCharge,
    }),
    guestRef,
  };

  const { payload: createOrderData } = await createOrderNative({
    req,
    body: createOrderBody,
  });

  const orderId = createOrderData?.order_id || createOrderData?.firestore_order_id;
  const token = createOrderData?.token;

  if (!orderId || !token) {
    throw new HttpError(500, 'Order created but tracking token missing.');
  }

  await owner.firestore.collection('orders').doc(orderId).set({
    status: 'confirmed',
    orderSource: 'manual_call',
    isManualCallOrder: true,
    ownerDeliveryChargeProvided: hasOwnerDeliveryChargeOverride,
    deliveryChargeLocked: hasOwnerDeliveryChargeOverride,
    manualDeliveryChargeLocked: hasOwnerDeliveryChargeOverride,
    manualDeliveryCharge: hasOwnerDeliveryChargeOverride ? deliveryCharge : 0,
    addressCaptureRequired: true,
    addAddressLinkRequired: true,
    addAddressRequestedAt: new Date(),
    manualCallUpdatedAt: new Date(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const baseUrl = resolvePublicBaseUrl(req);
  const encodedGuestRef = encodeURIComponent(guestRef);
  const encodedOrderId = encodeURIComponent(orderId);
  const encodedToken = encodeURIComponent(token);
  const encodedPhone = encodeURIComponent(phone);
  const encodedCustomerName = encodeURIComponent(customerName);

  const trackingUrl = `${baseUrl}/track/delivery/${orderId}?token=${token}&ref=${encodedGuestRef}&phone=${encodedPhone}&activeOrderId=${orderId}`;
  const returnTrackingPath = `/track/delivery/${orderId}?token=${encodedToken}&ref=${encodedGuestRef}&phone=${encodedPhone}&activeOrderId=${encodedOrderId}`;
  const addAddressPath = `/add-address?token=${encodedToken}&ref=${encodedGuestRef}&phone=${encodedPhone}&name=${encodedCustomerName}&activeOrderId=${encodedOrderId}&useCurrent=true&currentLocation=true&returnUrl=${encodeURIComponent(returnTrackingPath)}`;
  const addAddressLink = `${baseUrl}${addAddressPath}`;

  let addAddressShortLink = null;
  try {
    const shortCode = await createShortAddAddressCode({
      firestore: owner.firestore,
      addAddressLink,
      businessId: owner.businessId,
      orderId,
      customerPhone: phone,
      customerName,
    });
    addAddressShortLink = `${baseUrl}/a/${shortCode}`;
  } catch {
    addAddressShortLink = null;
  }

  return {
    message: 'Order created successfully.',
    orderId,
    token,
    guestRef,
    trackingUrl,
    addAddressLink,
    addAddressShortLink,
    addressPending: true,
    duplicateRequest: createOrderData?.message === 'Order already exists',
    whatsappSent: false,
    whatsappMode: 'none',
    whatsappError: owner.businessData?.botPhoneNumberId
      ? 'WhatsApp dispatch not yet enabled in backend-v2 custom bill service.'
      : 'Business botPhoneNumberId is not configured.',
  };
}

function buildHistoryQuery(historyRef, fromDate, toDate, maxRecords) {
  let query = historyRef.orderBy('printedAt', 'desc');
  if (fromDate) query = query.where('printedAt', '>=', fromDate);
  if (toDate) query = query.where('printedAt', '<=', toDate);
  return query.limit(maxRecords);
}

function buildFingerprint({ businessId, phone, items, totalAmount }) {
  const normalizedItems = (items || [])
    .map((item) => `${item.id}:${item.quantity}:${Number(item.totalPrice || 0).toFixed(2)}`)
    .sort()
    .join('|');

  const signature = `${businessId}|${phone}|${Number(totalAmount || 0).toFixed(2)}|${normalizedItems}`;
  return createHash('sha256').update(signature).digest('hex').slice(0, 32);
}

async function resolveCustomerIdentity(firestore, normalizedPhone) {
  if (!normalizedPhone) {
    return {
      customerType: 'guest',
      customerId: null,
    };
  }

  const usersRef = firestore.collection('users');
  const candidatePhones = [normalizedPhone, `+91${normalizedPhone}`];

  for (const candidate of candidatePhones) {
    const snap = await usersRef.where('phone', '==', candidate).limit(1).get();
    if (!snap.empty) {
      return {
        customerType: 'uid',
        customerId: snap.docs[0].id,
      };
    }
  }

  return {
    customerType: 'guest',
    customerId: normalizedPhone,
  };
}

async function postOwnerCustomBillHistory(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANUAL_BILLING_WRITE, PERMISSIONS.VIEW_ORDERS],
  });

  const customerDetails = body.customerDetails || {};
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const billDetails = body.billDetails || {};

  if (rawItems.length === 0) {
    throw new HttpError(400, 'At least one item is required for bill history.');
  }

  const items = rawItems.map(normalizeItem);
  const subtotalFromItems = items.reduce((sum, item) => sum + toAmount(item.totalPrice), 0);
  const subtotal = toAmount(billDetails.subtotal, subtotalFromItems);
  const cgst = toAmount(billDetails.cgst, 0);
  const sgst = toAmount(billDetails.sgst, 0);
  const deliveryCharge = toAmount(billDetails.deliveryCharge, 0);
  const totalAmount = toAmount(billDetails.grandTotal, subtotal + cgst + sgst + deliveryCharge);

  const customerName = sanitizeText(customerDetails.name, 'Walk-in Customer') || 'Walk-in Customer';
  const customerAddress = sanitizeText(customerDetails.address, '');
  const customerPhone = normalizePhone(customerDetails.phone);

  const billDraftId = sanitizeText(body.billDraftId, '');
  const printedViaRaw = sanitizeText(body.printedVia, '').toLowerCase();
  const printedVia = ['browser', 'direct_usb', 'create_order'].includes(printedViaRaw)
    ? printedViaRaw
    : 'browser';
  const settlementEligible = isSettlementEligible(printedVia);

  const historyRef = owner.businessSnap.ref.collection('custom_bill_history');

  if (billDraftId) {
    const duplicateSnap = await historyRef.where('billDraftId', '==', billDraftId).limit(1).get();
    if (!duplicateSnap.empty) {
      const duplicateDoc = duplicateSnap.docs[0];
      return {
        message: 'Bill history already saved.',
        duplicateRequest: true,
        historyId: duplicateDoc.id,
      };
    }
  }

  const { customerType, customerId } = await resolveCustomerIdentity(owner.firestore, customerPhone);
  const fingerprint = buildFingerprint({
    businessId: owner.businessId,
    phone: customerPhone || 'na',
    items,
    totalAmount,
  });

  const docRef = historyRef.doc();
  await docRef.set({
    historyId: docRef.id,
    billDraftId: billDraftId || null,
    source: 'offline_counter',
    channel: 'custom_bill',
    printedVia,
    fingerprint,
    businessId: owner.businessId,
    ownerId: owner.ownerUid,
    actorUid: owner.actorUid,
    customerName,
    customerPhone: customerPhone || null,
    customerAddress: customerAddress || null,
    customerType,
    customerId: customerId || null,
    itemCount: items.length,
    items,
    subtotal,
    cgst,
    sgst,
    deliveryCharge,
    totalAmount,
    settlementEligible,
    isSettled: false,
    settledAt: null,
    settledByUid: null,
    settledByRole: null,
    settlementBatchId: null,
    createdAt: FieldValue.serverTimestamp(),
    printedAt: FieldValue.serverTimestamp(),
  });

  return {
    message: 'Bill history saved successfully.',
    historyId: docRef.id,
    duplicateRequest: false,
  };
}

async function getOwnerCustomBillHistory(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.MANUAL_BILLING_READ, PERMISSIONS.VIEW_ORDERS],
  });

  const fromParam = sanitizeText(req.query.from, '');
  const toParam = sanitizeText(req.query.to, '');
  const search = toLowerText(req.query.search || '');
  const maxRecords = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));

  const fromDate = fromParam ? new Date(fromParam) : null;
  const toDate = toParam ? new Date(toParam) : null;
  if (fromDate) fromDate.setHours(0, 0, 0, 0);
  if (toDate) toDate.setHours(23, 59, 59, 999);

  const historyRef = owner.businessSnap.ref.collection('custom_bill_history');

  let snapshot;
  try {
    snapshot = await buildHistoryQuery(historyRef, fromDate, toDate, maxRecords).get();
  } catch {
    snapshot = await historyRef.orderBy('printedAt', 'desc').limit(maxRecords).get();
  }

  let totalAmount = 0;
  let totalBills = 0;
  let pendingSettlementAmount = 0;
  let pendingSettlementBills = 0;
  let settledAmount = 0;
  let settledBills = 0;
  const history = [];

  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    const printedAt = timestampToDate(data.printedAt) || timestampToDate(data.createdAt);

    if (fromDate && printedAt && printedAt < fromDate) return;
    if (toDate && printedAt && printedAt > toDate) return;

    const itemNames = Array.isArray(data.items)
      ? data.items.map((item) => sanitizeText(item?.name, '')).join(' ')
      : '';

    if (search) {
      const haystack = [
        sanitizeText(data.historyId, doc.id),
        sanitizeText(data.billDraftId, ''),
        sanitizeText(data.customerName, ''),
        sanitizeText(data.customerPhone, ''),
        sanitizeText(data.customerAddress, ''),
        sanitizeText(data.customerId, ''),
        itemNames,
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(search)) return;
    }

    const amount = toAmount(data.totalAmount, 0);
    totalAmount += amount;
    totalBills += 1;

    const printedVia = data.printedVia || 'browser';
    const settlementEligible = data.settlementEligible ?? isSettlementEligible(printedVia);
    const isSettled = settlementEligible ? !!data.isSettled : false;
    if (settlementEligible) {
      if (isSettled) {
        settledAmount += amount;
        settledBills += 1;
      } else {
        pendingSettlementAmount += amount;
        pendingSettlementBills += 1;
      }
    }

    history.push({
      id: doc.id,
      historyId: data.historyId || doc.id,
      billDraftId: data.billDraftId || null,
      source: data.source || 'offline_counter',
      channel: data.channel || 'custom_bill',
      printedVia,
      customerName: data.customerName || 'Walk-in Customer',
      customerPhone: data.customerPhone || null,
      customerAddress: data.customerAddress || null,
      customerType: data.customerType || 'guest',
      customerId: data.customerId || null,
      settlementEligible,
      isSettled,
      settledAt: timestampToDate(data.settledAt)?.toISOString() || null,
      settledByUid: data.settledByUid || null,
      settledByRole: data.settledByRole || null,
      settlementBatchId: data.settlementBatchId || null,
      subtotal: toAmount(data.subtotal, 0),
      cgst: toAmount(data.cgst, 0),
      sgst: toAmount(data.sgst, 0),
      deliveryCharge: toAmount(data.deliveryCharge, 0),
      totalAmount: amount,
      itemCount: Number(data.itemCount || (Array.isArray(data.items) ? data.items.length : 0)),
      items: Array.isArray(data.items) ? data.items : [],
      printedAt: printedAt ? printedAt.toISOString() : null,
      createdAt: timestampToDate(data.createdAt)?.toISOString() || null,
    });
  });

  return {
    history,
    summary: {
      totalBills,
      totalAmount,
      avgBillValue: totalBills > 0 ? totalAmount / totalBills : 0,
      pendingSettlementAmount,
      pendingSettlementBills,
      settledAmount,
      settledBills,
    },
  };
}

async function patchOwnerCustomBillHistory(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANUAL_BILLING_WRITE],
  });

  const action = sanitizeText(body.action, '').toLowerCase();
  const historyIds = Array.isArray(body.historyIds)
    ? [...new Set(body.historyIds.map((id) => sanitizeText(id, '')).filter(Boolean))]
    : [];

  if (action !== 'settle') {
    throw new HttpError(400, 'Unsupported action.');
  }
  if (historyIds.length === 0) {
    throw new HttpError(400, 'At least one bill ID is required.');
  }
  if (historyIds.length > 500) {
    throw new HttpError(400, 'You can settle up to 500 bills in one request.');
  }

  const historyRef = owner.businessSnap.ref.collection('custom_bill_history');
  const nowIso = new Date().toISOString();
  const actorUid = owner.actorUid || owner.ownerUid;
  const settlementBatchId = createHash('sha256')
    .update(`${owner.businessId}|${historyIds.sort().join('|')}|${nowIso}`)
    .digest('hex')
    .slice(0, 16);

  const docs = await Promise.all(historyIds.map((id) => historyRef.doc(id).get()));
  const batch = owner.firestore.batch();
  let settledCount = 0;
  let settledAmount = 0;
  let skippedCount = 0;

  docs.forEach((docSnap) => {
    if (!docSnap.exists) {
      skippedCount += 1;
      return;
    }

    const data = docSnap.data() || {};
    const printedVia = data.printedVia || 'browser';
    const settlementEligible = data.settlementEligible ?? isSettlementEligible(printedVia);
    if (!settlementEligible || data.isSettled) {
      skippedCount += 1;
      return;
    }

    settledCount += 1;
    settledAmount += toAmount(data.totalAmount, 0);
    batch.update(docSnap.ref, {
      settlementEligible: true,
      isSettled: true,
      settledAt: FieldValue.serverTimestamp(),
      settledByUid: actorUid,
      settledByRole: owner.callerRole || null,
      settlementBatchId,
    });
  });

  if (settledCount > 0) {
    await batch.commit();
  }

  return {
    message: settledCount > 0
      ? `${settledCount} bill(s) settled successfully.`
      : 'No pending manual bills were eligible for settlement.',
    settledCount,
    settledAmount,
    skippedCount,
    settlementBatchId: settledCount > 0 ? settlementBatchId : null,
  };
}

module.exports = {
  postOwnerCustomBillCreateOrder,
  postOwnerCustomBillHistory,
  getOwnerCustomBillHistory,
  patchOwnerCustomBillHistory,
};
