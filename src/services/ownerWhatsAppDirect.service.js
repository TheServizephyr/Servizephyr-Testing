const { FieldValue, getStorage } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');
const { sendWhatsAppMessage, markWhatsAppMessageAsRead } = require('./whatsappGraph.service');
const {
  mirrorWhatsAppMessageToRealtime,
  updateWhatsAppMessageStatusInRealtime,
} = require('./whatsappRealtime.service');

const DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES = 30;

function normalizeBusinessType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'street_vendor') return 'street-vendor';
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'restaurant' || normalized === 'street-vendor') {
    return normalized;
  }
  return null;
}

function resolveBusinessType(businessData = {}, collectionName = '') {
  const explicitType = normalizeBusinessType(businessData?.businessType);
  if (explicitType) return explicitType;
  if (collectionName === 'shops') return 'store';
  if (collectionName === 'street_vendors') return 'street-vendor';
  return 'restaurant';
}

function getBusinessSupportLabel(businessType = 'restaurant') {
  if (businessType === 'store' || businessType === 'shop') return 'store';
  if (businessType === 'street-vendor') return 'stall';
  return 'restaurant';
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

function toIsoDate(value) {
  const parsed = coerceDate(value);
  return parsed ? parsed.toISOString() : null;
}

function getTimeoutMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES;
  }
  return parsed;
}

function normalizePhone10(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function getPhoneVariations(phoneNumber) {
  const last10 = normalizePhone10(phoneNumber);
  if (!last10) return [];
  return Array.from(new Set([last10, `91${last10}`]));
}

function toMoney(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return amount;
}

function parseBoolLike(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function resolveBucketName() {
  const explicit = String(
    process.env.FIREBASE_STORAGE_BUCKET
    || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    || ''
  ).trim();
  if (explicit) return explicit.replace(/^gs:\/\//i, '');

  const projectId = String(
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    || process.env.FIREBASE_PROJECT_ID
    || ''
  ).trim();
  if (!projectId) {
    throw new HttpError(500, 'Storage bucket cannot be resolved. Missing Firebase project id.');
  }
  return `${projectId}.firebasestorage.app`;
}

async function ensureOwnerContext(req) {
  return resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.VIEW_CUSTOMERS],
  });
}

async function listConversations(owner) {
  const conversationsSnap = await owner.businessSnap.ref
    .collection('conversations')
    .orderBy('lastMessageTimestamp', 'desc')
    .limit(250)
    .get();

  const nowMs = Date.now();
  const batch = owner.firestore.batch();
  let shouldCommit = false;

  const conversations = conversationsSnap.docs.map((doc) => {
    const data = doc.data() || {};
    const enteredDirectChatDate = coerceDate(data.enteredDirectChatAt);
    const timeoutMinutes = getTimeoutMinutes(data.directChatTimeoutMinutes);

    let conversationState = data.state || 'menu';
    let timeoutStatus = 'active';

    if (conversationState === 'direct_chat' && enteredDirectChatDate) {
      const elapsedMinutes = (nowMs - enteredDirectChatDate.getTime()) / 60000;
      if (elapsedMinutes >= timeoutMinutes) {
        timeoutStatus = 'expired';
        conversationState = 'menu';
        batch.set(
          doc.ref,
          {
            state: 'menu',
            autoExpiredAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        shouldCommit = true;
      } else {
        timeoutStatus = `${Math.max(1, Math.ceil(timeoutMinutes - elapsedMinutes))}m left`;
      }
    } else if (conversationState === 'direct_chat' && !enteredDirectChatDate) {
      timeoutStatus = 'expired';
      conversationState = 'menu';
      batch.set(
        doc.ref,
        {
          state: 'menu',
          autoExpiredAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      shouldCommit = true;
    }

    return {
      id: doc.id,
      ...data,
      lastMessageTimestamp: toIsoDate(data.lastMessageTimestamp),
      orderLinkAccessedAt: toIsoDate(data.orderLinkAccessedAt),
      enteredDirectChatAt: toIsoDate(data.enteredDirectChatAt),
      timeoutStatus,
      conversationState,
    };
  });

  if (shouldCommit) {
    await batch.commit();
  }

  return { conversations };
}

async function appendSystemMessage({
  conversationRef,
  businessId,
  conversationId,
  text,
  type = 'system',
  messageId = '',
}) {
  const fallbackMessageId = messageId || `sys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await conversationRef.collection('messages').doc(fallbackMessageId).set({
    id: fallbackMessageId,
    sender: 'system',
    type,
    text: String(text || '').trim(),
    timestamp: FieldValue.serverTimestamp(),
    status: 'sent',
    isSystem: true,
  }, { merge: true });

  await mirrorWhatsAppMessageToRealtime({
    businessId,
    conversationId,
    messageId: fallbackMessageId,
    message: {
      id: fallbackMessageId,
      sender: 'system',
      type,
      text: String(text || '').trim(),
      status: 'sent',
      isSystem: true,
      timestamp: new Date().toISOString(),
    },
  });
}

async function patchConversation(owner, body = {}) {
  const conversationId = String(body.conversationId || '').trim();
  const tag = body.tag;
  const action = String(body.action || '').trim().toLowerCase();

  if (!conversationId) {
    throw new HttpError(400, 'Conversation ID is required.');
  }

  const conversationRef = owner.businessSnap.ref.collection('conversations').doc(conversationId);

  if (action === 'end_chat') {
    await conversationRef.set({ state: 'menu' }, { merge: true });

    const businessType = resolveBusinessType(owner.businessData, owner.collectionName);
    const supportLabel = getBusinessSupportLabel(businessType);
    const closedByText = `Chat ended by ${supportLabel}`;
    const browseLabel = businessType === 'store' ? 'catalog' : 'menu';
    const orderButtonLabel = businessType === 'restaurant' ? 'Order Food' : 'Order Now';
    const closureBody = `This chat has been closed by the ${supportLabel}. You can now use the ${browseLabel} below or type any message to start again.`;

    const botPhoneNumberId = String(owner.businessData?.botPhoneNumberId || '').trim();
    if (botPhoneNumberId) {
      const customerPhoneWithCode = `91${conversationId}`;
      const payload = {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: closureBody },
          action: {
            buttons: [
              { type: 'reply', reply: { id: `action_order_${owner.businessId}`, title: orderButtonLabel } },
              { type: 'reply', reply: { id: `action_track_${owner.businessId}`, title: 'Track Last Order' } },
              { type: 'reply', reply: { id: 'action_help', title: 'Need More Help?' } },
            ],
          },
        },
      };

      try {
        await sendWhatsAppMessage(customerPhoneWithCode, payload, botPhoneNumberId);
      } catch {
        // Non-blocking: state transition should still complete.
      }
    }

    await appendSystemMessage({
      conversationRef,
      businessId: owner.businessId,
      conversationId,
      text: closedByText,
    });
    await appendSystemMessage({
      conversationRef,
      businessId: owner.businessId,
      conversationId,
      text: closureBody,
    });

    return { message: 'Chat ended and menu sent.' };
  }

  const validTags = new Set(['Urgent', 'Feedback', 'Complaint', 'Resolved']);
  if (tag !== undefined) {
    if (tag !== null && !validTags.has(String(tag))) {
      throw new HttpError(400, 'Invalid tag provided.');
    }

    await conversationRef.set({
      tag: tag ? String(tag) : FieldValue.delete(),
    }, { merge: true });
    return { message: 'Tag updated successfully.' };
  }

  throw new HttpError(400, 'No valid action or tag provided.');
}

async function lookupCustomerDocs({ customersRef, phoneNumber }) {
  const variations = getPhoneVariations(phoneNumber);
  if (variations.length === 0) return { variations, docs: [] };

  const lookups = variations.flatMap((variant) => ([
    customersRef.where('phoneNumber', '==', variant).get(),
    customersRef.where('phone', '==', variant).get(),
    customersRef.doc(variant).get(),
  ]));

  const snapshots = await Promise.all(lookups);
  const allDocs = [];

  snapshots.forEach((snapshot) => {
    if (snapshot?.docs) {
      snapshot.docs.forEach((doc) => allDocs.push(doc));
      return;
    }
    if (snapshot?.exists) {
      allDocs.push(snapshot);
    }
  });

  const unique = Array.from(new Map(allDocs.map((doc) => [doc.id, doc])).values());
  return { variations, docs: unique };
}

function pickBestCustomerDoc(docs = []) {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const withTotalSpend = docs.find((doc) => {
    const data = doc.data() || {};
    return data.totalSpend !== undefined && data.totalSpend !== null;
  });
  return withTotalSpend || docs[0];
}

async function calculateCustomerStats({ firestore, businessId, variations }) {
  if (!variations.length) return { totalOrders: 0, totalSpent: 0 };

  const queries = variations.map((variant) => (
    firestore.collection('orders')
      .where('restaurantId', '==', businessId)
      .where('customerPhone', '==', variant)
      .get()
  ));

  const snapshots = await Promise.all(queries);
  const allOrders = new Map();

  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => allOrders.set(doc.id, doc));
  });

  let totalSpent = 0;
  allOrders.forEach((doc) => {
    const orderData = doc.data() || {};
    if (String(orderData.status || '').toLowerCase() === 'rejected') {
      allOrders.delete(doc.id);
      return;
    }
    const amount = toMoney(orderData.totalAmount ?? orderData.amount ?? orderData.billTotal, 0);
    totalSpent += amount;
  });

  return {
    totalOrders: allOrders.size,
    totalSpent,
  };
}

async function buildCustomerDetails({ owner, phoneNumber }) {
  const customersRef = owner.businessSnap.ref.collection('customers');
  const { variations, docs } = await lookupCustomerDocs({ customersRef, phoneNumber });
  const customerDoc = pickBestCustomerDoc(docs);
  if (!customerDoc) return null;

  const data = customerDoc.data() || {};
  const stats = await calculateCustomerStats({
    firestore: owner.firestore,
    businessId: owner.businessId,
    variations,
  });

  return {
    exists: true,
    id: customerDoc.id,
    details: {
      customName: data.customName || data.name || '',
      notes: data.notes || '',
      totalOrders: stats.totalOrders,
      totalSpent: stats.totalSpent,
      createdAt: toIsoDate(data.createdAt),
    },
  };
}

async function getCustomerDetails(owner, req) {
  const phoneNumber = String(req.query.phoneNumber || '').trim();
  if (!phoneNumber) {
    throw new HttpError(400, 'Phone number is required.');
  }

  const payload = await buildCustomerDetails({ owner, phoneNumber });
  if (payload) return payload;

  return {
    exists: false,
    details: {
      customName: '',
      notes: '',
      totalOrders: 0,
      totalSpent: 0,
      createdAt: null,
    },
  };
}

async function patchCustomerDetails(owner, body = {}) {
  const phoneNumber = String(body.phoneNumber || '').trim();
  if (!phoneNumber) {
    throw new HttpError(400, 'Phone number is required.');
  }

  const customersRef = owner.businessSnap.ref.collection('customers');
  const lookup = await lookupCustomerDocs({
    customersRef,
    phoneNumber,
  });

  const customName = body.customName;
  const notes = body.notes;
  let oldName = '';
  let customerRef = null;

  if (lookup.docs.length === 0) {
    const last10 = normalizePhone10(phoneNumber);
    if (!last10) {
      throw new HttpError(400, 'Invalid phone number.');
    }
    customerRef = customersRef.doc(last10);
    await customerRef.set({
      phoneNumber: last10,
      customName: customName || '',
      notes: notes || '',
      createdAt: new Date(),
      totalOrders: 0,
      totalSpent: 0,
    }, { merge: true });
  } else {
    const chosenDoc = pickBestCustomerDoc(lookup.docs);
    customerRef = chosenDoc.ref;
    oldName = String(chosenDoc.data()?.customName || chosenDoc.data()?.name || '').trim();

    const updates = {};
    if (customName !== undefined) updates.customName = customName;
    if (notes !== undefined) updates.notes = notes;
    if (Object.keys(updates).length > 0) {
      await customerRef.update(updates);
    }
  }

  const conversationId = normalizePhone10(phoneNumber);
  if (conversationId) {
    const conversationRef = owner.businessSnap.ref.collection('conversations').doc(conversationId);
    const convoUpdates = {};
    if (customName !== undefined && String(customName || '').trim() !== oldName) {
      convoUpdates.customerName = customName;
    }
    if (notes !== undefined) {
      convoUpdates.notes = notes;
    }

    if (Object.keys(convoUpdates).length > 0) {
      const convoSnap = await conversationRef.get();
      if (convoSnap.exists) {
        await conversationRef.update(convoUpdates);
      }
    }
  }

  const detailsPayload = await buildCustomerDetails({ owner, phoneNumber });
  return {
    message: 'Customer details updated successfully',
    details: detailsPayload?.details || null,
  };
}

function mapMessage(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    timestamp: toIsoDate(data.timestamp) || new Date().toISOString(),
  };
}

async function getMessages(owner, req) {
  const conversationId = String(req.query.conversationId || '').trim();
  const syncRealtime = parseBoolLike(req.query.syncRealtime);
  const since = String(req.query.since || '').trim();

  if (!conversationId) {
    throw new HttpError(400, 'Conversation ID is required.');
  }

  const messagesCollection = owner.businessSnap.ref
    .collection('conversations')
    .doc(conversationId)
    .collection('messages');

  let query = messagesCollection.orderBy('timestamp', 'asc');
  if (!syncRealtime && since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      query = messagesCollection
        .where('timestamp', '>', sinceDate)
        .orderBy('timestamp', 'asc')
        .limit(250);
    }
  }

  const messagesSnap = await query.get();
  const messages = messagesSnap.docs.map(mapMessage);

  if (syncRealtime && messages.length > 0) {
    const recent = messages.slice(-300);
    await Promise.allSettled(
      recent.map((message) => (
        mirrorWhatsAppMessageToRealtime({
          businessId: owner.businessId,
          conversationId,
          messageId: message.id,
          message: {
            id: message.id,
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
            timestamp: message.timestamp || new Date().toISOString(),
          },
        })
      ))
    );
  }

  return { messages };
}

async function maybePromoteMediaUrl(storagePath) {
  const safePath = String(storagePath || '').trim();
  if (!safePath) return null;

  const bucketName = resolveBucketName();
  const storage = await getStorage();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(safePath);

  await file.makePublic();
  return `https://storage.googleapis.com/${bucketName}/${safePath}`;
}

async function sendOwnerMessage(owner, body = {}) {
  const conversationId = String(body.conversationId || '').trim();
  const text = String(body.text || '').trim();
  const imageUrl = String(body.imageUrl || '').trim();
  const videoUrl = String(body.videoUrl || '').trim();
  const documentUrl = String(body.documentUrl || '').trim();
  const audioUrl = String(body.audioUrl || '').trim();
  const fileName = String(body.fileName || '').trim();
  const storagePath = String(body.storagePath || '').trim();

  if (!conversationId || (!text && !imageUrl && !videoUrl && !documentUrl && !audioUrl)) {
    throw new HttpError(
      400,
      'Conversation ID and at least one content parameter (text, imageUrl, videoUrl, documentUrl, audioUrl) are required.'
    );
  }

  const botPhoneNumberId = String(owner.businessData?.botPhoneNumberId || '').trim();
  if (!botPhoneNumberId) {
    throw new HttpError(400, 'WhatsApp bot is not connected for this business.');
  }

  let promotedMediaUrl = null;
  if (storagePath) {
    const expectedPrefix = `business_media/MESSAGE_MEDIA/${owner.businessId}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      throw new HttpError(403, 'Access denied: unauthorized storage path.');
    }
    promotedMediaUrl = await maybePromoteMediaUrl(storagePath).catch(() => null);
  }

  const effectiveImageUrl = promotedMediaUrl && imageUrl ? promotedMediaUrl : imageUrl;
  const effectiveVideoUrl = promotedMediaUrl && videoUrl ? promotedMediaUrl : videoUrl;
  const effectiveDocumentUrl = promotedMediaUrl && documentUrl ? promotedMediaUrl : documentUrl;
  const effectiveAudioUrl = promotedMediaUrl && audioUrl ? promotedMediaUrl : audioUrl;

  let messagePayload = null;
  let firestoreMessageData = null;
  let lastMessagePreview = '';

  if (effectiveImageUrl) {
    messagePayload = {
      type: 'image',
      image: {
        link: effectiveImageUrl,
        caption: text || undefined,
      },
    };
    firestoreMessageData = {
      type: 'image',
      mediaUrl: effectiveImageUrl,
      text: text || 'Image',
    };
    lastMessagePreview = text ? `Image: ${text}` : 'Image';
  } else if (text) {
    messagePayload = {
      type: 'text',
      text: { body: text },
    };
    firestoreMessageData = {
      type: 'text',
      text,
    };
    lastMessagePreview = text;
  } else if (effectiveVideoUrl) {
    messagePayload = {
      type: 'video',
      video: { link: effectiveVideoUrl },
    };
    firestoreMessageData = {
      type: 'video',
      mediaUrl: effectiveVideoUrl,
      text: 'Video',
      fileName: fileName || 'video',
    };
    lastMessagePreview = 'Video';
  } else if (effectiveDocumentUrl) {
    messagePayload = {
      type: 'document',
      document: {
        link: effectiveDocumentUrl,
        filename: fileName || 'document',
      },
    };
    firestoreMessageData = {
      type: 'document',
      mediaUrl: effectiveDocumentUrl,
      text: 'Document',
      fileName: fileName || 'document',
    };
    lastMessagePreview = `Document: ${fileName || 'Document'}`;
  } else if (effectiveAudioUrl) {
    messagePayload = {
      type: 'audio',
      audio: { link: effectiveAudioUrl },
    };
    firestoreMessageData = {
      type: 'audio',
      mediaUrl: effectiveAudioUrl,
      text: 'Audio',
      fileName: fileName || 'audio',
    };
    lastMessagePreview = 'Audio';
  }

  if (!messagePayload || !firestoreMessageData) {
    throw new HttpError(400, 'No valid WhatsApp message payload found.');
  }

  const customerPhoneWithCode = `91${conversationId}`;
  const waResponse = await sendWhatsAppMessage(customerPhoneWithCode, messagePayload, botPhoneNumberId);
  const messageDocId = String(waResponse?.messages?.[0]?.id || '').trim();
  if (!messageDocId) {
    throw new HttpError(502, 'WhatsApp API did not return message ID.');
  }

  const conversationRef = owner.businessSnap.ref.collection('conversations').doc(conversationId);
  const conversationSnap = await conversationRef.get();
  const conversationData = conversationSnap.exists ? (conversationSnap.data() || {}) : {};
  const enteredDirectChatAt = coerceDate(conversationData.enteredDirectChatAt);
  const timeoutMinutes = getTimeoutMinutes(conversationData.directChatTimeoutMinutes);

  const isExpiredDirectChat = conversationData.state === 'direct_chat'
    && enteredDirectChatAt
    && ((Date.now() - enteredDirectChatAt.getTime()) >= (timeoutMinutes * 60 * 1000));

  if (isExpiredDirectChat) {
    await conversationRef.set({
      state: 'menu',
      autoExpiredAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const hasActiveDirectChat = conversationData.state === 'direct_chat'
    && !!enteredDirectChatAt
    && !isExpiredDirectChat;
  const shouldStartDirectChat = !hasActiveDirectChat;

  const batch = owner.firestore.batch();
  if (shouldStartDirectChat) {
    const businessType = resolveBusinessType(owner.businessData, owner.collectionName);
    const supportLabel = getBusinessSupportLabel(businessType);
    const businessName = owner.businessData.name || `your ${supportLabel}`;
    const activationBody = `Now you are connected to *${businessName}* directly. Put up your queries.\n\nThe chat is active for 30 minutes.\n\nYou can end chat any time by typing *'end chat'* or clicking the button below.`;

    const notificationPayload = {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: activationBody },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'action_end_chat', title: 'End Chat' } },
          ],
        },
      },
    };

    try {
      await sendWhatsAppMessage(customerPhoneWithCode, notificationPayload, botPhoneNumberId);
    } catch {
      // non-blocking
    }

    const systemMessageId = `sys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    batch.set(
      conversationRef.collection('messages').doc(systemMessageId),
      {
        id: systemMessageId,
        sender: 'system',
        type: 'system',
        text: activationBody,
        timestamp: FieldValue.serverTimestamp(),
        status: 'sent',
        isSystem: true,
      },
      { merge: true }
    );

    await mirrorWhatsAppMessageToRealtime({
      businessId: owner.businessId,
      conversationId,
      messageId: systemMessageId,
      message: {
        id: systemMessageId,
        sender: 'system',
        type: 'system',
        text: activationBody,
        status: 'sent',
        isSystem: true,
        timestamp: new Date().toISOString(),
      },
    });
  }

  batch.set(
    conversationRef.collection('messages').doc(messageDocId),
    {
      id: messageDocId,
      sender: 'owner',
      timestamp: FieldValue.serverTimestamp(),
      status: 'sent',
      ...firestoreMessageData,
    },
    { merge: true }
  );

  const conversationUpdate = {
    lastMessage: lastMessagePreview,
    lastMessageType: firestoreMessageData.type,
    lastMessageTimestamp: FieldValue.serverTimestamp(),
    state: 'direct_chat',
    ownerInitiatedDirectChat: true,
    directChatTimeoutMinutes: DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES,
  };
  if (shouldStartDirectChat) {
    conversationUpdate.enteredDirectChatAt = FieldValue.serverTimestamp();
  }

  batch.set(conversationRef, conversationUpdate, { merge: true });
  await batch.commit();

  await mirrorWhatsAppMessageToRealtime({
    businessId: owner.businessId,
    conversationId,
    messageId: messageDocId,
    message: {
      id: messageDocId,
      sender: 'owner',
      status: 'sent',
      ...firestoreMessageData,
      timestamp: new Date().toISOString(),
    },
  });

  return { message: 'Message sent successfully!' };
}

async function markMessagesRead(owner, body = {}) {
  const conversationId = String(body.conversationId || '').trim();
  const messageIds = Array.isArray(body.messageIds) ? body.messageIds : [];

  if (!conversationId || messageIds.length === 0) {
    throw new HttpError(400, 'Conversation ID and Message IDs are required.');
  }

  const botPhoneNumberId = String(owner.businessData?.botPhoneNumberId || '').trim();
  if (!botPhoneNumberId) {
    throw new HttpError(400, 'WhatsApp bot is not connected for this business.');
  }

  const messagesCollection = owner.businessSnap.ref
    .collection('conversations')
    .doc(conversationId)
    .collection('messages');

  const batch = owner.firestore.batch();
  let updateCount = 0;

  await Promise.all(messageIds.map(async (msgIdRaw) => {
    const msgId = String(msgIdRaw || '').trim();
    if (!msgId) return;
    await markWhatsAppMessageAsRead(msgId, botPhoneNumberId).catch(() => null);
    batch.set(messagesCollection.doc(msgId), { status: 'read' }, { merge: true });
    updateCount += 1;
    await updateWhatsAppMessageStatusInRealtime({
      businessId: owner.businessId,
      conversationId,
      messageId: msgId,
      status: 'read',
    });
  }));

  if (updateCount > 0) {
    await batch.commit();
  }

  await owner.businessSnap.ref.collection('conversations').doc(conversationId).set({
    unreadCount: 0,
  }, { merge: true });

  return { message: 'Messages marked as read' };
}

async function getOwnerWhatsAppDirectConversations(req) {
  const owner = await ensureOwnerContext(req);
  return listConversations(owner);
}

async function patchOwnerWhatsAppDirectConversations(req, body = {}) {
  const owner = await ensureOwnerContext(req);
  return patchConversation(owner, body);
}

async function getOwnerWhatsAppDirectCustomerDetails(req) {
  const owner = await ensureOwnerContext(req);
  return getCustomerDetails(owner, req);
}

async function patchOwnerWhatsAppDirectCustomerDetails(req, body = {}) {
  const owner = await ensureOwnerContext(req);
  return patchCustomerDetails(owner, body);
}

async function getOwnerWhatsAppDirectMessages(req) {
  const owner = await ensureOwnerContext(req);
  return getMessages(owner, req);
}

async function postOwnerWhatsAppDirectMessage(req, body = {}) {
  const owner = await ensureOwnerContext(req);
  return sendOwnerMessage(owner, body);
}

async function patchOwnerWhatsAppDirectMessages(req, body = {}) {
  const owner = await ensureOwnerContext(req);
  return markMessagesRead(owner, body);
}

module.exports = {
  getOwnerWhatsAppDirectConversations,
  patchOwnerWhatsAppDirectConversations,
  getOwnerWhatsAppDirectCustomerDetails,
  patchOwnerWhatsAppDirectCustomerDetails,
  getOwnerWhatsAppDirectMessages,
  postOwnerWhatsAppDirectMessage,
  patchOwnerWhatsAppDirectMessages,
};
