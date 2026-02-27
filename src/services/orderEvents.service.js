const { publishWebsocketEvent } = require('../lib/websocket');

const SENSITIVE_KEYS = new Set([
  'customerName',
  'customerPhone',
  'customerAddress',
  'customerId',
  'userId',
  'phone',
  'trackingToken',
  'sessionToken',
  'token',
]);

function safeStr(value) {
  return String(value || '').trim();
}

function redactSensitiveFields(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveFields(entry));
  }
  if (!value || typeof value !== 'object') return value;

  const output = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (SENSITIVE_KEYS.has(key)) return;
    output[key] = redactSensitiveFields(entry);
  });
  return output;
}

function buildChannels({ businessId, riderId, orderId }) {
  const channels = [];
  const safeBusinessId = safeStr(businessId);
  const safeRiderId = safeStr(riderId);
  const safeOrderId = safeStr(orderId);
  if (safeBusinessId) channels.push(`owner:${safeBusinessId}`);
  if (safeRiderId) channels.push(`rider:${safeRiderId}`);
  if (safeOrderId) channels.push(`order:${safeOrderId}`);
  return channels;
}

function emitOrderEvent({
  eventType = 'order.updated',
  businessId = '',
  riderId = '',
  orderId = '',
  data = {},
}) {
  const channels = buildChannels({ businessId, riderId, orderId });
  const safePayload = redactSensitiveFields({
    orderId: safeStr(orderId) || null,
    businessId: safeStr(businessId) || null,
    riderId: safeStr(riderId) || null,
    ...data,
  });

  return publishWebsocketEvent({
    type: eventType,
    channels,
    payload: safePayload,
  });
}

module.exports = {
  emitOrderEvent,
};
