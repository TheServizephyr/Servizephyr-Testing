const { randomUUID } = require('crypto');
const { createOrderNative, shouldUseLegacyCreateOrder } = require('./orderCreate.service');

function toMoney(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

function normalizePaymentMethod(value) {
  const safe = String(value || '').trim().toLowerCase();
  if (!safe) return '';
  if (safe === 'pay at counter') return 'pay_at_counter';
  if (safe === 'cash') return 'cod';
  return safe;
}

function normalizeAddress(value) {
  if (!value || typeof value !== 'object') return null;
  return value;
}

function mapLegacyRegisterBody(body = {}) {
  const deliveryType = String(body.deliveryType || 'delivery').trim().toLowerCase();
  const paymentMethod = normalizePaymentMethod(body.paymentMethod);
  const tabName = String(body.tab_name || '').trim();
  const userName = String(body.name || '').trim() || tabName || 'Guest';

  const mapped = {
    restaurantId: String(body.restaurantId || '').trim(),
    items: Array.isArray(body.items) ? body.items : [],
    name: userName,
    phone: String(body.phone || '').trim(),
    address: normalizeAddress(body.address),
    notes: body.notes || '',
    coupon: body.coupon || null,
    loyaltyDiscount: toMoney(body.loyaltyDiscount, 0),
    grandTotal: toMoney(body.grandTotal, 0),
    paymentMethod,
    businessType: body.businessType || undefined,
    deliveryType,
    pickupTime: body.pickupTime || '',
    tipAmount: toMoney(body.tipAmount, 0),
    subtotal: toMoney(body.subtotal, 0),
    cgst: toMoney(body.cgst, 0),
    sgst: toMoney(body.sgst, 0),
    deliveryCharge: toMoney(body.deliveryCharge, 0),
    tableId: body.tableId || null,
    pax_count: Number(body.pax_count || 0) || null,
    tab_name: tabName || null,
    dineInTabId: body.dineInTabId || body.tabId || null,
    ordered_by: body.ordered_by || 'customer',
    ordered_by_name: body.ordered_by_name || tabName || userName,
    idempotencyKey:
      String(body.idempotencyKey || body.clientRequestId || body.requestId || '').trim()
      || `cust_reg_${randomUUID()}`,
  };

  if (body.packagingCharge !== undefined) mapped.packagingCharge = toMoney(body.packagingCharge, 0);
  if (body.convenienceFee !== undefined) mapped.convenienceFee = toMoney(body.convenienceFee, 0);
  if (body.platformFee !== undefined) mapped.platformFee = toMoney(body.platformFee, 0);
  if (body.serviceFee !== undefined) mapped.serviceFee = toMoney(body.serviceFee, 0);
  if (body.discount !== undefined) mapped.discount = toMoney(body.discount, 0);

  return mapped;
}

function mapRegisterResponse(resultPayload = {}, fallbackPaymentMethod = '') {
  return {
    message: resultPayload.message || 'Order created successfully.',
    order_id: resultPayload.order_id || resultPayload.firestore_order_id || null,
    firestore_order_id: resultPayload.firestore_order_id || resultPayload.order_id || null,
    token: resultPayload.token || null,
    payment_method: resultPayload.payment_method || fallbackPaymentMethod || null,
    status: resultPayload.status || null,
    dineInTabId: resultPayload.dineInTabId || resultPayload.dine_in_tab_id || null,
    dine_in_tab_id: resultPayload.dine_in_tab_id || resultPayload.dineInTabId || null,
    customerOrderId: resultPayload.customerOrderId || null,
    source: resultPayload.source || 'backend_v2_native',
  };
}

async function createOrderFromCustomerRegister({ req, body }) {
  const mappedBody = mapLegacyRegisterBody(body || {});
  const fallback = shouldUseLegacyCreateOrder(mappedBody);
  if (fallback.useLegacy) {
    return {
      mode: 'legacy',
      reason: fallback.reason,
    };
  }

  const result = await createOrderNative({
    req,
    body: mappedBody,
  });

  return {
    mode: 'native',
    payload: mapRegisterResponse(result.payload, mappedBody.paymentMethod),
    duplicate: result.duplicate === true,
  };
}

module.exports = {
  createOrderFromCustomerRegister,
};
