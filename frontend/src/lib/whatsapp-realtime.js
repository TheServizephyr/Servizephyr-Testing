import { getDatabase } from '@/lib/firebase-admin';

const ROOT = 'wa_realtime';
const RTDB_INVALID_KEY_CHARS = /[.#$/\[\]\u0000-\u001F\u007F]/g;
const toSafePathKey = (value) =>
    String(value || '')
        .trim()
        .replace(RTDB_INVALID_KEY_CHARS, (ch) => `_${ch.charCodeAt(0).toString(16).toUpperCase()}_`);
const isRealtimeDebug = String(process.env.WHATSAPP_RTDB_DEBUG || '').toLowerCase() === 'true';

const toTimestampMs = (value) => {
    if (!value) return Date.now();
    if (typeof value?.toDate === 'function') {
        const d = value.toDate();
        return Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
    }
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
};

const buildMessagePath = (businessId, conversationId, messageId) =>
    `${ROOT}/${toSafePathKey(businessId)}/conversations/${toSafePathKey(conversationId)}/messages/${toSafePathKey(messageId)}`;

export async function mirrorWhatsAppMessageToRealtime({
    businessId,
    conversationId,
    messageId,
    message = {}
}) {
    const path = buildMessagePath(businessId, conversationId, messageId);
    try {
        if (!businessId || !conversationId || !messageId) return false;
        const rtdb = await getDatabase();
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

        await rtdb.ref(path).set(payload);
        if (isRealtimeDebug) {
            console.log(`[WA RTDB] mirror success: ${path}`);
        }
        return true;
    } catch (error) {
        console.error('[WA RTDB] mirror message failed:', {
            error: error?.message || String(error),
            businessId,
            conversationId,
            messageId,
            path
        });
        return false;
    }
}

export async function updateWhatsAppMessageStatusInRealtime({
    businessId,
    conversationId,
    messageId,
    status
}) {
    const path = buildMessagePath(businessId, conversationId, messageId);
    try {
        if (!businessId || !conversationId || !messageId || !status) return false;
        const rtdb = await getDatabase();
        await rtdb.ref(path).update({
            status,
            updatedAt: Date.now(),
        });
        if (isRealtimeDebug) {
            console.log(`[WA RTDB] status update success: ${path} -> ${status}`);
        }
        return true;
    } catch (error) {
        console.error('[WA RTDB] status update failed:', {
            error: error?.message || String(error),
            businessId,
            conversationId,
            messageId,
            status,
            path
        });
        return false;
    }
}
