const { HttpError } = require('../utils/httpError');

const GRAPH_API_BASE = String(process.env.WHATSAPP_GRAPH_API_BASE || 'https://graph.facebook.com/v19.0')
  .trim()
  .replace(/\/+$/, '');

function getAccessToken() {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  if (!token) {
    throw new HttpError(500, 'WHATSAPP_ACCESS_TOKEN is not configured.');
  }
  return token;
}

function getPhoneNumberId(phoneNumberId) {
  const safe = String(phoneNumberId || '').trim();
  if (!safe) {
    throw new HttpError(400, 'Business WhatsApp phone number is not configured.');
  }
  return safe;
}

async function graphRequest(pathname, options = {}) {
  const token = getAccessToken();
  const response = await fetch(`${GRAPH_API_BASE}/${String(pathname || '').replace(/^\/+/, '')}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || 'WhatsApp API request failed.';
    throw new HttpError(response.status || 502, message);
  }
  return payload;
}

function normalizeOutgoingPayload(phoneNumber, payload) {
  if (typeof payload === 'string') {
    return {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      type: 'text',
      text: { body: payload },
    };
  }

  if (payload && typeof payload === 'object' && ['text', 'image', 'video', 'audio', 'document', 'interactive'].includes(payload.type)) {
    return {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      ...payload,
    };
  }

  return {
    messaging_product: 'whatsapp',
    to: phoneNumber,
    type: 'template',
    template: payload || {},
  };
}

async function sendWhatsAppMessage(phoneNumber, payload, businessPhoneNumberId) {
  const to = String(phoneNumber || '').trim();
  if (!to) throw new HttpError(400, 'Recipient phone number is required.');
  const phoneId = getPhoneNumberId(businessPhoneNumberId);

  const body = normalizeOutgoingPayload(to, payload);
  return graphRequest(`${phoneId}/messages`, {
    method: 'POST',
    body,
  });
}

async function markWhatsAppMessageAsRead(messageId, businessPhoneNumberId) {
  const safeMessageId = String(messageId || '').trim();
  if (!safeMessageId) throw new HttpError(400, 'messageId is required.');
  const phoneId = getPhoneNumberId(businessPhoneNumberId);

  return graphRequest(`${phoneId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: safeMessageId,
    },
  });
}

module.exports = {
  sendWhatsAppMessage,
  markWhatsAppMessageAsRead,
};
