import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { sendWhatsAppMessage, markWhatsAppMessageAsRead } from '@/lib/whatsapp';
import { mirrorWhatsAppMessageToRealtime, updateWhatsAppMessageStatusInRealtime } from '@/lib/whatsapp-realtime';

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

function getTimeoutMinutes(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES;
    }
    return parsed;
}

async function verifyOwnerAndGetBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;

    if (userRole === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    } else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }
        targetOwnerId = employeeOfOwnerId;
    } else if (!['owner', 'restaurant-owner', 'shop-owner'].includes(userRole)) {
        throw { message: 'Access Denied', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0];
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0];
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const conversationId = searchParams.get('conversationId');
        const syncRealtime = ['1', 'true', 'yes'].includes(String(searchParams.get('syncRealtime') || '').toLowerCase());
        const since = searchParams.get('since');

        if (!conversationId) {
            return NextResponse.json({ message: 'Conversation ID is required.' }, { status: 400 });
        }

        const businessDoc = await verifyOwnerAndGetBusinessRef(req);
        const messagesCollection = businessDoc.ref.collection('conversations').doc(conversationId).collection('messages');
        let messagesQuery = messagesCollection.orderBy('timestamp', 'asc');

        // Poll optimization: when `since` is supplied, return only new messages after that timestamp.
        // Keep full fetch for initial load and RTDB backfill sync.
        if (!syncRealtime && since) {
            const sinceDate = new Date(since);
            if (!Number.isNaN(sinceDate.getTime())) {
                messagesQuery = messagesCollection
                    .where('timestamp', '>', sinceDate)
                    .orderBy('timestamp', 'asc')
                    .limit(250);
            }
        }

        const messagesSnap = await messagesQuery.get();

        const messages = messagesSnap.docs.map(doc => {
            const data = doc.data();
            let timestamp;
            if (data.timestamp?.toDate) {
                timestamp = data.timestamp.toDate().toISOString();
            } else if (data.timestamp) {
                timestamp = new Date(data.timestamp).toISOString();
            } else {
                timestamp = new Date().toISOString();
            }

            return {
                id: doc.id,
                ...data,
                timestamp,
            };
        });

        if (syncRealtime && messages.length > 0) {
            const recentMessages = messages.slice(-300);
            const syncResults = await Promise.allSettled(
                recentMessages.map((message) =>
                    mirrorWhatsAppMessageToRealtime({
                        businessId: businessDoc.id,
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
                        }
                    })
                )
            );

            const failedSyncCount = syncResults.filter((result) => result.status === 'rejected').length;
            if (failedSyncCount > 0) {
                console.warn(`[WhatsApp Direct] RTDB backfill partially failed for ${conversationId}: ${failedSyncCount}/${recentMessages.length}`);
            } else {
                console.log(`[WhatsApp Direct] RTDB backfill completed for ${conversationId}: ${recentMessages.length} messages`);
            }
        }

        return NextResponse.json({ messages }, { status: 200 });

    } catch (error) {
        console.error('GET MESSAGES ERROR:', error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

export async function POST(req) {
    try {
        const { conversationId, text, imageUrl, videoUrl, documentUrl, audioUrl, fileName, storagePath } = await req.json();

        if (!conversationId || (!text && !imageUrl && !videoUrl && !documentUrl && !audioUrl)) {
            return NextResponse.json(
                { message: 'Conversation ID and at least one content parameter (text, imageUrl, videoUrl, documentUrl, audioUrl) are required.' },
                { status: 400 }
            );
        }

        const businessDoc = await verifyOwnerAndGetBusinessRef(req);
        const businessData = businessDoc.data();
        const botPhoneNumberId = businessData.botPhoneNumberId;
        const businessType = resolveBusinessType(businessData, businessDoc.ref.parent.id);
        const supportLabel = getBusinessSupportLabel(businessType);

        if (!botPhoneNumberId) {
            throw { message: 'WhatsApp bot is not connected for this business.', status: 400 };
        }

        let permanentMediaUrl = null;
        if (storagePath) {
            try {
                const restaurantId = businessDoc.id;
                const expectedPrefix = `business_media/MESSAGE_MEDIA/${restaurantId}/`;

                if (!storagePath.startsWith(expectedPrefix)) {
                    console.error(`[Messages API] SECURITY ALERT: Attempt to access unauthorized path: ${storagePath} for business ${restaurantId}`);
                    throw { message: 'Access Denied: Unauthorized storage path.', status: 403 };
                }

                const originalUrl = imageUrl || videoUrl || documentUrl || audioUrl;
                if (originalUrl) {
                    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'studio-6552995429-8bffe';
                    const bucketName = `${projectId}.firebasestorage.app`;
                    const bucket = getStorage().bucket(bucketName);
                    const file = bucket.file(storagePath);

                    await file.makePublic();
                    permanentMediaUrl = `https://storage.googleapis.com/${bucketName}/${storagePath}`;
                    console.log(`[Messages API] File made public: ${permanentMediaUrl}`);
                }
            } catch (error) {
                console.error('[Messages API] Failed to make file public:', error);
                if (error.status === 403) throw error;
            }
        }

        const customerPhoneWithCode = `91${conversationId}`;

        let messagePayload;
        let firestoreMessageData;
        let lastMessagePreview;

        const effectiveImageUrl = (permanentMediaUrl && imageUrl) ? permanentMediaUrl : imageUrl;
        const effectiveVideoUrl = (permanentMediaUrl && videoUrl) ? permanentMediaUrl : videoUrl;
        const effectiveDocumentUrl = (permanentMediaUrl && documentUrl) ? permanentMediaUrl : documentUrl;
        const effectiveAudioUrl = (permanentMediaUrl && audioUrl) ? permanentMediaUrl : audioUrl;

        if (effectiveImageUrl) {
            const caption = text || undefined;
            messagePayload = {
                type: 'image',
                image: {
                    link: effectiveImageUrl,
                    caption,
                }
            };
            firestoreMessageData = { type: 'image', mediaUrl: effectiveImageUrl, text: text || 'Image' };
            lastMessagePreview = text ? `Image: ${text}` : 'Image';
        } else if (text) {
            messagePayload = {
                type: 'text',
                text: { body: text }
            };
            firestoreMessageData = { type: 'text', text };
            lastMessagePreview = text;
        } else if (effectiveVideoUrl) {
            messagePayload = { type: 'video', video: { link: effectiveVideoUrl } };
            firestoreMessageData = { type: 'video', mediaUrl: effectiveVideoUrl, text: 'Video', fileName: fileName || 'video' };
            lastMessagePreview = 'Video';
        } else if (effectiveDocumentUrl) {
            messagePayload = { type: 'document', document: { link: effectiveDocumentUrl, filename: fileName || 'document' } };
            firestoreMessageData = { type: 'document', mediaUrl: effectiveDocumentUrl, text: 'Document', fileName: fileName || 'document' };
            lastMessagePreview = `Document: ${fileName || 'Document'}`;
        } else if (effectiveAudioUrl) {
            messagePayload = { type: 'audio', audio: { link: effectiveAudioUrl } };
            firestoreMessageData = { type: 'audio', mediaUrl: effectiveAudioUrl, text: 'Audio', fileName: fileName || 'audio' };
            lastMessagePreview = 'Audio';
        }

        const response = await sendWhatsAppMessage(customerPhoneWithCode, messagePayload, botPhoneNumberId);

        if (!response || !response.messages || response.messages.length === 0) {
            console.error('[API ERROR] Failed to send message to WhatsApp. Response was invalid or empty.');
            throw { message: 'Failed to send message via WhatsApp API.', status: 502 };
        }

        const messageDocId = response.messages[0].id;

        const firestore = await getFirestore();
        const conversationRef = businessDoc.ref.collection('conversations').doc(conversationId);
        const batch = firestore.batch();

        const conversationSnap = await conversationRef.get();
        const conversationData = conversationSnap.exists ? conversationSnap.data() : {};
        const enteredDirectChatAt = coerceDate(conversationData.enteredDirectChatAt);
        const timeoutMinutes = getTimeoutMinutes(conversationData.directChatTimeoutMinutes);
        const isExpiredDirectChat = conversationData.state === 'direct_chat' &&
            enteredDirectChatAt &&
            ((Date.now() - enteredDirectChatAt.getTime()) >= (timeoutMinutes * 60 * 1000));

        if (isExpiredDirectChat) {
            await conversationRef.set({
                state: 'menu',
                autoExpiredAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }

        const hasActiveDirectChat = conversationData.state === 'direct_chat' &&
            !!enteredDirectChatAt &&
            !isExpiredDirectChat;
        const shouldStartDirectChat = !hasActiveDirectChat;

        if (shouldStartDirectChat) {
            const businessName = businessData.name || `your ${supportLabel}`;
            const activationBody = `Now you are connected to *${businessName}* directly. Put up your queries.\n\nThe chat is active for 30 minutes.\n\nYou can end chat any time by typing *'end chat'* or clicking the button below.`;

            const notificationPayload = {
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: activationBody },
                    action: {
                        buttons: [
                            { type: 'reply', reply: { id: 'action_end_chat', title: 'End Chat' } }
                        ]
                    }
                }
            };
            await sendWhatsAppMessage(customerPhoneWithCode, notificationPayload, botPhoneNumberId);

            const notificationRef = conversationRef.collection('messages').doc(`sys_${Date.now()}`);
            const notificationId = notificationRef.id;
            batch.set(notificationRef, {
                sender: 'system',
                type: 'system',
                text: activationBody,
                timestamp: FieldValue.serverTimestamp(),
                status: 'sent',
                isSystem: true
            });
            await mirrorWhatsAppMessageToRealtime({
                businessId: businessDoc.id,
                conversationId,
                messageId: notificationId,
                message: {
                    sender: 'system',
                    type: 'system',
                    text: activationBody,
                    status: 'sent',
                    isSystem: true,
                    timestamp: new Date().toISOString(),
                }
            });
            console.log(`[Messages API] Started direct chat session for ${customerPhoneWithCode}`);
        }

        const messageRef = conversationRef.collection('messages').doc(messageDocId);
        batch.set(messageRef, {
            id: messageDocId,
            sender: 'owner',
            timestamp: FieldValue.serverTimestamp(),
            status: 'sent',
            ...firestoreMessageData
        });

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
            businessId: businessDoc.id,
            conversationId,
            messageId: messageDocId,
            message: {
                sender: 'owner',
                status: 'sent',
                ...firestoreMessageData,
                timestamp: new Date().toISOString(),
            }
        });

        return NextResponse.json({ message: 'Message sent successfully!' }, { status: 200 });

    } catch (error) {
        console.error('POST MESSAGE ERROR:', error);

        let errorMessage = error.message || 'Internal Server Error';
        try {
            const parsed = JSON.parse(errorMessage);
            if (parsed && parsed.message) errorMessage = `WhatsApp Error: ${parsed.message}`;
        } catch {
            // Keep original message.
        }

        return NextResponse.json({ message: errorMessage }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const { conversationId, messageIds } = await req.json();

        if (!conversationId || !Array.isArray(messageIds) || messageIds.length === 0) {
            return NextResponse.json({ message: 'Conversation ID and Message IDs are required.' }, { status: 400 });
        }

        const businessDoc = await verifyOwnerAndGetBusinessRef(req);
        const businessData = businessDoc.data();
        const botPhoneNumberId = businessData.botPhoneNumberId;

        if (!botPhoneNumberId) {
            throw { message: 'WhatsApp bot is not connected for this business.', status: 400 };
        }

        const firestore = await getFirestore();
        const messagesCollection = businessDoc.ref.collection('conversations').doc(conversationId).collection('messages');
        const batch = firestore.batch();
        let updateCount = 0;

        await Promise.all(messageIds.map(async (msgId) => {
            await markWhatsAppMessageAsRead(msgId, botPhoneNumberId);
            const msgRef = messagesCollection.doc(msgId);
            batch.update(msgRef, { status: 'read' });
            updateCount += 1;
            await updateWhatsAppMessageStatusInRealtime({
                businessId: businessDoc.id,
                conversationId,
                messageId: msgId,
                status: 'read'
            });
        }));

        if (updateCount > 0) {
            await batch.commit();
        }

        await businessDoc.ref.collection('conversations').doc(conversationId).set({ unreadCount: 0 }, { merge: true });

        return NextResponse.json({ message: 'Messages marked as read' }, { status: 200 });

    } catch (error) {
        console.error('PATCH MESSAGES ERROR:', error);
        return NextResponse.json({ message: error.message || 'Error marking messages as read' }, { status: error.status || 500 });
    }
}
