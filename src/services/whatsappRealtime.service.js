const { getDatabase } = require('../lib/firebaseAdmin');

const ROOT = 'wa_realtime';
const RTDB_INVALID_KEY_CHARS = /[.#$/\[\]\u0000-\u001F\u007F]/g;

function toSafePathKey(value) {
  return String(value || '')
    .trim()
    .replace(RTDB_INVALID_KEY_CHARS, (ch) => `_${ch.charCodeAt(0).toString(16).toUpperCase()}_`);
}

function toTimestampMs(value) {
  if (!value) return Date.now();
  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate();
    return Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
}

function buildMessagePath(businessId, conversationId, messageId) {
  return `${ROOT}/${toSafePathKey(businessId)}/conversations/${toSafePathKey(conversationId)}/messages/${toSafePathKey(messageId)}`;
}

async function mirrorWhatsAppMessageToRealtime({
  businessId,
  conversationId,
  messageId,
  message = {},
}) {
  if (!businessId || !conversationId || !messageId) return false;

  const timestampMs = toTimestampMs(message.timestamp || message.timestampMs);
  const payload = {
    id: messageId,
    sender: message.sender || 'system',
    type: message.type || 'text',
    text: message.text || '',
    status: message.status || 'sent',
    mediaId: message.mediaId || null,
    mediaUrl: message.mediaUrl || null,
    fileName: message.fileName || null,
    interactive_type: message.interactive_type || null,
    rawPayload: message.rawPayload || null,
    isSystem: message.isSystem === true,
    timestampMs,
    timestamp: message.timestamp || new Date(timestampMs).toISOString(),
    updatedAt: Date.now(),
  };

  try {
    const rtdb = await getDatabase();
    await rtdb.ref(buildMessagePath(businessId, conversationId, messageId)).set(payload);
    return true;
  } catch {
    return false;
  }
}

async function updateWhatsAppMessageStatusInRealtime({
  businessId,
  conversationId,
  messageId,
  status,
}) {
  if (!businessId || !conversationId || !messageId || !status) return false;

  try {
    const rtdb = await getDatabase();
    await rtdb.ref(buildMessagePath(businessId, conversationId, messageId)).update({
      status,
      updatedAt: Date.now(),
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  mirrorWhatsAppMessageToRealtime,
  updateWhatsAppMessageStatusInRealtime,
};
