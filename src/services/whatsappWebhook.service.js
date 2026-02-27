const { getFirestore, FieldValue } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { sendWhatsAppMessage } = require('./whatsappGraph.service');
const {
  mirrorWhatsAppMessageToRealtime,
  updateWhatsAppMessageStatusInRealtime,
} = require('./whatsappRealtime.service');

const DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES = 30;

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function coerceDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTimeoutMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES;
  return parsed;
}

function extractRawBodyString(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

function parseWebhookBody(req) {
  const raw = extractRawBodyString(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON payload.');
  }
}

async function getBusinessByPhoneNumberId(firestore, botPhoneNumberId) {
  const safePhoneNumberId = String(botPhoneNumberId || '').trim();
  if (!safePhoneNumberId) return null;

  for (const collectionName of ['restaurants', 'shops', 'street_vendors']) {
    const snapshot = await firestore
      .collection(collectionName)
      .where('botPhoneNumberId', '==', safePhoneNumberId)
      .limit(1)
      .get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return {
        id: doc.id,
        ref: doc.ref,
        data: doc.data() || {},
        collectionName,
      };
    }
  }

  return null;
}

async function generateTrackingToken(firestore, customerPhone) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await firestore.collection('auth_tokens').doc(token).set({
    phone: customerPhone,
    expiresAt: expiry,
    type: 'tracking',
  });
  return token;
}

async function sendWelcomeMessage({
  firestore,
  business,
  botPhoneNumberId,
  customerPhoneWithCode,
  customerPhone,
}) {
  const token = await generateTrackingToken(firestore, customerPhone);
  const orderLink = `https://www.servizephyr.com/order/${business.id}?phone=${customerPhone}&token=${token}`;

  const payload = {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `Welcome to ${business.data?.name || 'ServiZephyr'}!\n\nWhat would you like to do today?`,
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `action_order_${business.id}`, title: 'Order Food' } },
          { type: 'reply', reply: { id: `action_track_${business.id}`, title: 'Track Last Order' } },
          { type: 'reply', reply: { id: 'action_help', title: 'Need Help?' } },
        ],
      },
    },
  };

  await sendWhatsAppMessage(customerPhoneWithCode, payload, botPhoneNumberId);
  await business.ref.collection('conversations').doc(customerPhone).set({
    customerPhone,
    state: 'menu',
    lastWelcomeSent: FieldValue.serverTimestamp(),
    orderLinkAccessedAt: FieldValue.serverTimestamp(),
    lastMessage: `Order link ready: ${orderLink}`,
    lastMessageType: 'system',
    lastMessageTimestamp: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function handleButtonAction({
  firestore,
  business,
  botPhoneNumberId,
  fromNumber,
  fromPhoneNumber,
  buttonId,
}) {
  const parts = String(buttonId || '').split('_');
  const action = parts[1] || '';
  const payloadParts = parts.slice(2);
  const conversationRef = business.ref.collection('conversations').doc(fromPhoneNumber);

  if (action === 'order') {
    const token = await generateTrackingToken(firestore, fromPhoneNumber);
    const businessId = payloadParts.join('_') || business.id;
    const link = `https://www.servizephyr.com/order/${businessId}?phone=${fromPhoneNumber}&token=${token}`;
    await conversationRef.set({
      state: 'browsing_order',
      orderLinkAccessedAt: FieldValue.serverTimestamp(),
      lastMessage: 'Order link shared',
      lastMessageType: 'system',
      lastMessageTimestamp: FieldValue.serverTimestamp(),
    }, { merge: true });
    await sendWhatsAppMessage(
      fromNumber,
      `Here is your personal link to place an order:\n\n${link}\n\nThis link is valid for 24 hours.`,
      botPhoneNumberId
    );
    return;
  }

  if (action === 'track') {
    const latestOrderSnap = await firestore.collection('orders')
      .where('customerPhone', '==', fromPhoneNumber)
      .orderBy('orderDate', 'desc')
      .limit(1)
      .get();

    if (latestOrderSnap.empty) {
      await sendWhatsAppMessage(fromNumber, 'You do not have any recent orders to track.', botPhoneNumberId);
      return;
    }

    const orderDoc = latestOrderSnap.docs[0];
    const orderData = orderDoc.data() || {};
    const trackingToken = String(orderData.trackingToken || '').trim();
    if (!trackingToken) {
      await sendWhatsAppMessage(fromNumber, 'Tracking information is not available for your latest order.', botPhoneNumberId);
      return;
    }

    const trackingPath = String(orderData.deliveryType || '').toLowerCase() === 'dine-in' ? 'dine-in/' : '';
    const link = `https://www.servizephyr.com/track/${trackingPath}${orderDoc.id}?token=${trackingToken}`;
    await sendWhatsAppMessage(fromNumber, `Here is your tracking link:\n\n${link}`, botPhoneNumberId);
    return;
  }

  if (action === 'help') {
    await conversationRef.set({
      state: 'direct_chat',
      enteredDirectChatAt: FieldValue.serverTimestamp(),
      directChatTimeoutMinutes: DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES,
      lastMessageTimestamp: FieldValue.serverTimestamp(),
    }, { merge: true });
    await sendWhatsAppMessage(fromNumber, 'You are now connected to support. Type "end chat" anytime to close this chat.', botPhoneNumberId);
    return;
  }

  if (action === 'end' && payloadParts[0] === 'chat') {
    await conversationRef.set({ state: 'menu' }, { merge: true });
    await sendWhatsAppMessage(fromNumber, 'Chat has ended. You can place a new order anytime.', botPhoneNumberId);
    await sendWelcomeMessage({
      firestore,
      business,
      botPhoneNumberId,
      customerPhoneWithCode: fromNumber,
      customerPhone: fromPhoneNumber,
    });
  }
}

function parseMessageContent(message) {
  const type = String(message?.type || 'text').toLowerCase();
  let text = '';
  let mediaId = null;

  if (type === 'text') {
    text = String(message?.text?.body || '').trim();
  } else if (type === 'image') {
    text = String(message?.image?.caption || '[Photo]');
    mediaId = String(message?.image?.id || '').trim() || null;
  } else if (type === 'video') {
    text = String(message?.video?.caption || '[Video]');
    mediaId = String(message?.video?.id || '').trim() || null;
  } else if (type === 'document') {
    text = String(message?.document?.caption || message?.document?.filename || '[Document]');
    mediaId = String(message?.document?.id || '').trim() || null;
  } else if (type === 'audio') {
    text = '[Audio]';
    mediaId = String(message?.audio?.id || '').trim() || null;
  } else if (type === 'interactive') {
    text = String(
      message?.interactive?.button_reply?.title
      || message?.interactive?.list_reply?.title
      || '[Interactive]'
    );
  } else if (type === 'button') {
    text = String(message?.button?.text || message?.button?.payload || '[Button]');
  } else {
    text = '[Message]';
  }

  return {
    type,
    text,
    mediaId,
  };
}

async function processStatuses({
  statuses,
  business,
}) {
  const firestore = await getFirestore();
  for (const statusUpdate of statuses) {
    const messageId = String(statusUpdate?.id || '').trim();
    const status = String(statusUpdate?.status || '').trim();
    if (!messageId || !status) continue;

    const recipient = String(statusUpdate?.recipient_id || '').trim();
    const normalizedPhone = normalizePhone(recipient);
    const phoneCandidates = Array.from(new Set([normalizedPhone, recipient].filter(Boolean)));

    let updated = false;
    for (const conversationId of phoneCandidates) {
      const msgRef = business.ref.collection('conversations').doc(conversationId).collection('messages').doc(messageId);
      const msgSnap = await msgRef.get();
      if (!msgSnap.exists) continue;
      await msgRef.set({ status }, { merge: true });
      await updateWhatsAppMessageStatusInRealtime({
        businessId: business.id,
        conversationId,
        messageId,
        status,
      });
      updated = true;
      break;
    }

    if (!updated) {
      // best-effort: ignore missing message
      continue;
    }
  }
}

async function processMessages({
  firestore,
  business,
  botPhoneNumberId,
  contacts = [],
  messages = [],
}) {
  for (const message of messages) {
    const fromNumber = String(message?.from || '').trim();
    if (!fromNumber) continue;
    const fromPhoneNumber = normalizePhone(fromNumber);
    if (!fromPhoneNumber) continue;

    const conversationRef = business.ref.collection('conversations').doc(fromPhoneNumber);
    const conversationSnap = await conversationRef.get();
    const conversationData = conversationSnap.exists ? (conversationSnap.data() || {}) : { state: 'menu' };
    const now = new Date();

    // Auto-expire direct chat sessions when idle timeout elapsed.
    if (conversationData.state === 'direct_chat') {
      const enteredAt = coerceDate(conversationData.enteredDirectChatAt);
      const timeoutMinutes = getTimeoutMinutes(conversationData.directChatTimeoutMinutes);
      if (!enteredAt || ((Date.now() - enteredAt.getTime()) / 60000) >= timeoutMinutes) {
        await conversationRef.set({
          state: 'menu',
          autoExpiredAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        conversationData.state = 'menu';
      }
    }

    const parsed = parseMessageContent(message);
    const messageId = String(message?.id || '').trim() || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const waTimestamp = message?.timestamp
      ? new Date(Number.parseInt(String(message.timestamp), 10) * 1000)
      : now;

    await conversationRef.collection('messages').doc(messageId).set({
      id: messageId,
      sender: 'customer',
      timestamp: waTimestamp,
      status: parsed.mediaId ? 'media_pending' : 'received',
      type: parsed.type,
      text: parsed.text,
      mediaId: parsed.mediaId,
      rawPayload: JSON.stringify(message),
    }, { merge: true });

    await mirrorWhatsAppMessageToRealtime({
      businessId: business.id,
      conversationId: fromPhoneNumber,
      messageId,
      message: {
        id: messageId,
        sender: 'customer',
        type: parsed.type,
        text: parsed.text,
        mediaId: parsed.mediaId,
        status: parsed.mediaId ? 'media_pending' : 'received',
        rawPayload: JSON.stringify(message),
        timestamp: waTimestamp.toISOString(),
      },
    });

    const customerName = String(contacts?.[0]?.profile?.name || fromPhoneNumber).trim();
    const updates = {
      customerName,
      customerPhone: fromPhoneNumber,
      lastMessage: parsed.text,
      lastMessageType: parsed.type,
      lastMessageTimestamp: FieldValue.serverTimestamp(),
    };
    if (conversationData.state === 'direct_chat') {
      updates.unreadCount = FieldValue.increment(1);
    }
    await conversationRef.set(updates, { merge: true });

    // Command handling in direct chat.
    if (parsed.type === 'text' && conversationData.state === 'direct_chat') {
      const normalizedText = parsed.text.toLowerCase().replace(/\s+/g, ' ').trim();
      if (normalizedText === 'end chat' || normalizedText === 'endchat') {
        await conversationRef.set({ state: 'menu' }, { merge: true });
        await sendWhatsAppMessage(fromNumber, 'Chat ended. You can order anytime.', botPhoneNumberId);
        await sendWelcomeMessage({
          firestore,
          business,
          botPhoneNumberId,
          customerPhoneWithCode: fromNumber,
          customerPhone: fromPhoneNumber,
        });
        continue;
      }
    }

    // Interactive button handling.
    if (parsed.type === 'interactive' && message?.interactive?.type === 'button_reply') {
      const buttonId = message?.interactive?.button_reply?.id || message?.interactive?.button_reply?.title;
      await handleButtonAction({
        firestore,
        business,
        botPhoneNumberId,
        fromNumber,
        fromPhoneNumber,
        buttonId,
      });
      continue;
    }

    if (parsed.type === 'button') {
      const buttonId = message?.button?.payload || message?.button?.text;
      await handleButtonAction({
        firestore,
        business,
        botPhoneNumberId,
        fromNumber,
        fromPhoneNumber,
        buttonId,
      });
      continue;
    }

    // Need help in menu mode.
    if (parsed.type === 'text') {
      const normalizedText = parsed.text.toLowerCase().replace(/\s+/g, ' ').trim();
      if (normalizedText === 'need help' || normalizedText === 'need help?' || normalizedText === 'help') {
        await conversationRef.set({
          state: 'direct_chat',
          enteredDirectChatAt: FieldValue.serverTimestamp(),
          directChatTimeoutMinutes: DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES,
        }, { merge: true });
        await sendWhatsAppMessage(
          fromNumber,
          `You are now connected to ${business.data?.name || 'support'} directly. Type "end chat" to exit.`,
          botPhoneNumberId
        );
        continue;
      }
    }

    // Menu-mode welcome flow.
    if (conversationData.state !== 'direct_chat' && parsed.type === 'text') {
      await sendWelcomeMessage({
        firestore,
        business,
        botPhoneNumberId,
        customerPhoneWithCode: fromNumber,
        customerPhone: fromPhoneNumber,
      });
    }
  }
}

async function handleWhatsAppWebhookGet(req) {
  const verifyToken = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = String(req.query['hub.challenge'] || '').trim();

  if (mode === 'subscribe' && token && verifyToken && token === verifyToken) {
    return {
      statusCode: 200,
      contentType: 'text/plain; charset=utf-8',
      body: challenge,
    };
  }

  return {
    statusCode: 403,
    contentType: 'text/plain; charset=utf-8',
    body: 'Verification Failed',
  };
}

async function handleWhatsAppWebhookPost(req) {
  try {
    const body = parseWebhookBody(req);
    if (body?.object !== 'whatsapp_business_account') {
      return { statusCode: 200, body: { message: 'Not a WhatsApp event' } };
    }

    const firestore = await getFirestore();
    const change = body?.entry?.[0]?.changes?.[0];
    const value = change?.value || {};
    if (!value || !value?.metadata?.phone_number_id) {
      return { statusCode: 200, body: { message: 'No change data' } };
    }

    const botPhoneNumberId = String(value.metadata.phone_number_id || '').trim();
    const business = await getBusinessByPhoneNumberId(firestore, botPhoneNumberId);
    if (!business) {
      return { statusCode: 404, body: { message: 'Business not found' } };
    }

    if (Array.isArray(value.statuses) && value.statuses.length > 0) {
      await processStatuses({
        statuses: value.statuses,
        business,
      });
      return { statusCode: 200, body: { message: 'Statuses processed' } };
    }

    if (Array.isArray(value.messages) && value.messages.length > 0) {
      await processMessages({
        firestore,
        business,
        botPhoneNumberId,
        contacts: value.contacts || [],
        messages: value.messages,
      });
      return { statusCode: 200, body: { message: 'Messages processed' } };
    }

    return { statusCode: 200, body: { message: 'Event received' } };
  } catch {
    // For webhook reliability, acknowledge with 200 so Meta does not keep retrying infinitely.
    return { statusCode: 200, body: { message: 'Error processed with acknowledgement' } };
  }
}

module.exports = {
  handleWhatsAppWebhookGet,
  handleWhatsAppWebhookPost,
};
