

import axios from 'axios';
import { getFirestore, FieldValue } from './firebase-admin.js';

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Sends a WhatsApp message using the Meta Graph API.
 * @param {string} phoneNumber The recipient's phone number (with country code).
 * @param {object|string} payload The message payload. For simple text, it's a string. For templates or interactive messages, it's an object.
 * @param {string} businessPhoneNumberId The ID of the WhatsApp Business phone number sending the message.
 */
export const sendWhatsAppMessage = async (phoneNumber, payload, businessPhoneNumberId) => {
    console.log(`[WhatsApp Lib] Preparing to send message to ${phoneNumber} from Bot ID ${businessPhoneNumberId}.`);

    if (!ACCESS_TOKEN || !businessPhoneNumberId) {
        const errorMessage = "WhatsApp credentials (Access Token or Business Phone ID) are not configured in environment variables.";
        console.error(`[WhatsApp Lib] CRITICAL: ${errorMessage}`);
        return;
    }

    let dataPayload;
    if (typeof payload === 'string') {
        dataPayload = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'text',
            text: { body: payload }
        };
        console.log(`[WhatsApp Lib] Payload is a simple text message.`);
    } else if (['text', 'image', 'video', 'audio', 'document', 'interactive'].includes(payload.type)) {
        dataPayload = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            ...payload
        };
        console.log(`[WhatsApp Lib] Payload is a ${payload.type} message.`);
    } else {
        dataPayload = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'template',
            template: payload
        };
        console.log(`[WhatsApp Lib] Payload is a template message: ${payload.name}`);
    }

    console.log('[WhatsApp Lib] Full request payload:', JSON.stringify(dataPayload, null, 2));

    try {
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${businessPhoneNumberId}/messages`,
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: dataPayload
        });
        console.log(`[WhatsApp Lib] Successfully initiated message to ${phoneNumber}. Response:`, JSON.stringify(response.data, null, 2));
        return response.data; // ✅ FIX: Return data so we can get the WAMID
    } catch (error) {
        console.error(`[WhatsApp Lib] FAILED to send message to ${phoneNumber}.`);
        if (error.response) {
            console.error('[WhatsApp Lib] Error Data:', JSON.stringify(error.response.data, null, 2));
            console.error('[WhatsApp Lib] Error Status:', error.response.status);
            throw new Error(JSON.stringify(error.response.data.error || { message: "WhatsApp API returned an error" }));
        } else if (error.request) {
            console.error('[WhatsApp Lib] No response received:', error.request);
            throw new Error("No response received from WhatsApp API");
        } else {
            console.error('[WhatsApp Lib] Error setting up request:', error.message);
            throw new Error(error.message);
        }
    }
};

/**
 * Uploads media to WhatsApp and returns media ID.
 * This avoids public URL fetch dependency for media delivery.
 * @param {{buffer: Buffer|Uint8Array, filename?: string, mimeType?: string, businessPhoneNumberId: string}} params
 * @returns {Promise<string>} mediaId
 */
export const uploadWhatsAppMediaFromBuffer = async ({
    buffer,
    filename = 'media.png',
    mimeType = 'image/png',
    businessPhoneNumberId
}) => {
    console.log(`[WhatsApp Lib] Uploading media to WhatsApp for Bot ID ${businessPhoneNumberId}...`);
    if (!ACCESS_TOKEN || !businessPhoneNumberId) {
        throw new Error('WhatsApp credentials are not configured.');
    }
    if (!buffer || !(buffer.length > 0)) {
        throw new Error('Media buffer is empty.');
    }

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', new Blob([buffer], { type: mimeType }), filename);

    const response = await fetch(`https://graph.facebook.com/v19.0/${businessPhoneNumberId}/media`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`
        },
        body: formData
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.id) {
        throw new Error(JSON.stringify(data?.error || data || { message: 'Failed to upload WhatsApp media' }));
    }

    console.log(`[WhatsApp Lib] Media uploaded successfully. Media ID: ${data.id}`);
    return data.id;
};

/**
 * Downloads media from WhatsApp using the Media ID.
 * @param {string} mediaId The WhatsApp Media ID.
 * @returns {Promise<{buffer: Buffer, mimeType: string}>} The media buffer and mime type.
 */
export const downloadWhatsAppMedia = async (mediaId) => {
    try {
        console.log(`[WhatsApp Lib] downloadWhatsAppMedia called for ID: ${mediaId}`);
        if (!ACCESS_TOKEN) {
            console.error("[WhatsApp Lib] CRITICAL: ACCESS_TOKEN is missing in downloadWhatsAppMedia");
            throw new Error("Missing ACCESS_TOKEN");
        }

        console.log(`[WhatsApp Lib] Getting media URL for ID: ${mediaId}`);
        // 1. Get Media URL
        const urlResponse = await axios({
            method: 'GET',
            url: `https://graph.facebook.com/v19.0/${mediaId}`,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        const mediaUrl = urlResponse.data.url;
        const mimeType = urlResponse.data.mime_type;
        console.log(`[WhatsApp Lib] Media URL found: ${mediaUrl}, Type: ${mimeType}`);

        // 2. Download Binary Data
        const binaryResponse = await axios({
            method: 'GET',
            url: mediaUrl,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
            responseType: 'arraybuffer'
        });

        return {
            buffer: Buffer.from(binaryResponse.data),
            mimeType: mimeType
        };

    } catch (error) {
        console.error(`[WhatsApp Lib] Failed to download media ${mediaId}:`, error.message);
        throw error;
    }
};

/**
 * Marks a message as read in WhatsApp.
 * @param {string} messageId The WhatsApp Message ID to mark as read.
 * @param {string} businessPhoneNumberId The ID of the WhatsApp Business phone number.
 */
export const markWhatsAppMessageAsRead = async (messageId, businessPhoneNumberId) => {
    try {
        console.log(`[WhatsApp Lib] Marking message ${messageId} as READ.`);

        if (!ACCESS_TOKEN || !businessPhoneNumberId) {
            throw new Error("Missing Credentials");
        }

        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${businessPhoneNumberId}/messages`,
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            }
        });

        console.log(`[WhatsApp Lib] Message ${messageId} marked as read. Response: ${response.data?.success}`);
        return true;
    } catch (error) {
        console.error(`[WhatsApp Lib] Failed to mark message ${messageId} as read:`, error.message);
        // Don't throw here, just log failure. It's a non-critical UX feature.
        return false;
    }
};

const normalizePhoneForConversation = (phoneNumber = '') => {
    return String(phoneNumber).replace(/^\+?91/, '').replace(/\D/g, '').slice(-10);
};

const storeSystemConversationMessage = async ({
    phoneNumber,
    businessId,
    collectionName = 'restaurants',
    wamid,
    text,
    customerName = null,
    conversationPreview = null,
    extra = {}
}) => {
    if (!wamid || !businessId) return;

    const firestore = await getFirestore();
    const cleanPhone = normalizePhoneForConversation(phoneNumber);
    if (!cleanPhone) return;
    const conversationRef = firestore
        .collection(collectionName)
        .doc(businessId)
        .collection('conversations')
        .doc(cleanPhone);

    const messageData = {
        id: wamid,
        wamid: wamid,
        sender: 'system',
        type: 'system',
        text: text,
        body: text,
        timestamp: FieldValue.serverTimestamp(),
        status: 'sent',
        isSystem: true,
        ...extra
    };

    const previewBase = typeof conversationPreview === 'string' && conversationPreview.trim()
        ? conversationPreview
        : text;
    const previewText = String(previewBase || 'System message')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400);

    const conversationData = {
        customerPhone: cleanPhone,
        lastMessage: previewText || 'System message',
        lastMessageType: 'system',
        lastMessageTimestamp: FieldValue.serverTimestamp(),
    };

    if (customerName && String(customerName).trim()) {
        conversationData.customerName = String(customerName).trim().slice(0, 80);
    }

    const messageRef = conversationRef.collection('messages').doc(wamid);
    const batch = firestore.batch();
    batch.set(conversationRef, conversationData, { merge: true });
    batch.set(messageRef, messageData);
    await batch.commit();
};

/**
 * Sends a system-generated WhatsApp message with header, footer and stores it in Firestore.
 * @param {string} phoneNumber The recipient's phone number (with country code, e.g., '919876543210').
 * @param {string} messageText The message text to send.
 * @param {string} businessPhoneNumberId The WhatsApp Business Phone Number ID.
 * @param {string} businessId The Firestore business document ID (restaurant/shop ID).
 * @param {string} restaurantName The name of the restaurant/business.
 * @param {string} collectionName The Firestore collection name ('restaurants' or 'shops').
 */
export const sendSystemMessage = async (
    phoneNumber,
    messageText,
    businessPhoneNumberId,
    businessId,
    restaurantName,
    collectionName = 'restaurants',
    options = {}
) => {
    try {
        // Add header and footer to message
        const header = `*${restaurantName} (powered by ServiZephyr)*\n\n`;
        const fullMessage = header + messageText;

        // Send via WhatsApp API
        const response = await sendWhatsAppMessage(phoneNumber, fullMessage, businessPhoneNumberId);

        if (!response || !response.messages || !response.messages[0]) {
            console.error('[WhatsApp Lib] Failed to get message ID from WhatsApp response');
            return;
        }

        const wamid = response.messages[0].id;
        await storeSystemConversationMessage({
            phoneNumber,
            businessId,
            collectionName,
            wamid,
            text: fullMessage,
            customerName: options?.customerName || null,
            conversationPreview: options?.conversationPreview || messageText,
        });

        console.log(`[WhatsApp Lib] System message sent and stored: ${wamid}`);
        return response;

    } catch (error) {
        console.error('[WhatsApp Lib] Error in sendSystemMessage:', error);
        throw error;
    }
};

/**
 * Sends a WhatsApp template message and stores a readable system copy in Firestore.
 * Use this when interactive/template UX is needed but conversation history must remain intact.
 */
export const sendSystemTemplateMessage = async (
    phoneNumber,
    templatePayload,
    readableMessageText,
    businessPhoneNumberId,
    businessId,
    restaurantName,
    collectionName = 'restaurants',
    options = {}
) => {
    try {
        if (!templatePayload || typeof templatePayload !== 'object') {
            throw new Error('Invalid template payload');
        }

        const response = await sendWhatsAppMessage(phoneNumber, templatePayload, businessPhoneNumberId);

        if (!response || !response.messages || !response.messages[0]) {
            console.error('[WhatsApp Lib] Failed to get message ID from template response');
            return;
        }

        const wamid = response.messages[0].id;
        const header = `*${restaurantName} (powered by ServiZephyr)*\n\n`;
        const fallbackText = header + (readableMessageText || 'Template message sent.');

        await storeSystemConversationMessage({
            phoneNumber,
            businessId,
            collectionName,
            wamid,
            text: fallbackText,
            customerName: options?.customerName || null,
            conversationPreview: options?.conversationPreview || readableMessageText,
            extra: {
                messageFormat: 'template',
                templateName: templatePayload?.name || null,
                templateLanguage: templatePayload?.language?.code || null,
            }
        });

        console.log(`[WhatsApp Lib] System template message sent and stored: ${wamid}`);
        return response;
    } catch (error) {
        console.error('[WhatsApp Lib] Error in sendSystemTemplateMessage:', error);
        throw error;
    }
};
