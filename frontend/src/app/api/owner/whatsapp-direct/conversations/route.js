import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { mirrorWhatsAppMessageToRealtime } from '@/lib/whatsapp-realtime';

export const dynamic = 'force-dynamic';

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

function getDirectChatTimeoutMinutes(value) {
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
        return restaurantsQuery.docs[0].ref;
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].ref;
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}

export async function GET(req) {
    try {
        const firestore = await getFirestore();
        const businessRef = await verifyOwnerAndGetBusinessRef(req);

        const conversationsSnap = await businessRef.collection('conversations')
            .orderBy('lastMessageTimestamp', 'desc')
            .limit(250)
            .get();

        const nowMs = Date.now();
        const batch = firestore.batch();
        let hasAutoExpireUpdates = false;

        const conversations = conversationsSnap.docs.map(doc => {
            const data = doc.data();
            const lastMessageTimestamp = coerceDate(data.lastMessageTimestamp)?.toISOString() || null;
            const orderLinkAccessedAt = coerceDate(data.orderLinkAccessedAt)?.toISOString() || null;
            const enteredDirectChatDate = coerceDate(data.enteredDirectChatAt);
            const enteredDirectChatAt = enteredDirectChatDate?.toISOString() || null;
            const timeoutMinutes = getDirectChatTimeoutMinutes(data.directChatTimeoutMinutes);

            let conversationState = data.state;
            let timeoutStatus = 'active';

            if (conversationState === 'direct_chat' && enteredDirectChatDate) {
                const elapsedMinutes = (nowMs - enteredDirectChatDate.getTime()) / 60000;
                if (elapsedMinutes >= timeoutMinutes) {
                    timeoutStatus = 'expired';
                    conversationState = 'menu';
                    hasAutoExpireUpdates = true;
                    batch.set(doc.ref, {
                        state: 'menu',
                        autoExpiredAt: FieldValue.serverTimestamp(),
                    }, { merge: true });
                } else {
                    timeoutStatus = `${Math.max(1, Math.ceil(timeoutMinutes - elapsedMinutes))}m left`;
                }
            } else if (conversationState === 'direct_chat' && !enteredDirectChatDate) {
                timeoutStatus = 'expired';
                conversationState = 'menu';
                hasAutoExpireUpdates = true;
                batch.set(doc.ref, {
                    state: 'menu',
                    autoExpiredAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            }

            return {
                id: doc.id,
                ...data,
                lastMessageTimestamp,
                orderLinkAccessedAt,
                enteredDirectChatAt,
                timeoutStatus,
                conversationState,
            };
        });

        if (hasAutoExpireUpdates) {
            await batch.commit();
        }

        return NextResponse.json({ conversations }, { status: 200 });

    } catch (error) {
        console.error('GET /api/owner/whatsapp-direct/conversations ERROR:', error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const businessDoc = await businessRef.get();
        const businessData = businessDoc.data();

        const { conversationId, tag, action } = await req.json();

        if (!conversationId) {
            return NextResponse.json({ message: 'Conversation ID is required.' }, { status: 400 });
        }

        const conversationRef = businessRef.collection('conversations').doc(conversationId);

        if (action === 'end_chat') {
            await conversationRef.set({ state: 'menu' }, { merge: true });

            const botPhoneNumberId = businessData.botPhoneNumberId;
            const customerPhoneWithCode = `91${conversationId}`;
            const businessType = resolveBusinessType(businessData, businessDoc.ref.parent.id);
            const supportLabel = getBusinessSupportLabel(businessType);
            const closedByText = `Chat ended by ${supportLabel}`;
            const browseLabel = businessType === 'store' ? 'catalog' : 'menu';
            const orderButtonLabel = businessType === 'restaurant' ? 'Order Food' : 'Order Now';

            const closureBody = `This chat has been closed by the ${supportLabel}. You can now use the ${browseLabel} below or type any message to start again.`;

            const payload = {
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: {
                        text: closureBody
                    },
                    action: {
                        buttons: [
                            { type: 'reply', reply: { id: `action_order_${businessDoc.id}`, title: orderButtonLabel } },
                            { type: 'reply', reply: { id: `action_track_${businessDoc.id}`, title: 'Track Last Order' } },
                            { type: 'reply', reply: { id: 'action_help', title: 'Need More Help?' } }
                        ]
                    }
                }
            };
            await sendWhatsAppMessage(customerPhoneWithCode, payload, botPhoneNumberId);

            await conversationRef.collection('messages').add({
                sender: 'system',
                type: 'system',
                text: closedByText,
                timestamp: FieldValue.serverTimestamp(),
                status: 'sent',
                isSystem: true
            });
            await mirrorWhatsAppMessageToRealtime({
                businessId: businessDoc.id,
                conversationId,
                messageId: `sys_${Date.now()}_ended_by_${supportLabel}`,
                message: {
                    sender: 'system',
                    type: 'system',
                    text: closedByText,
                    status: 'sent',
                    isSystem: true,
                    timestamp: new Date().toISOString(),
                }
            });
            await conversationRef.collection('messages').add({
                sender: 'system',
                type: 'system',
                text: closureBody,
                timestamp: FieldValue.serverTimestamp(),
                status: 'sent',
                isSystem: true
            });
            await mirrorWhatsAppMessageToRealtime({
                businessId: businessDoc.id,
                conversationId,
                messageId: `sys_${Date.now()}_closure_body`,
                message: {
                    sender: 'system',
                    type: 'system',
                    text: closureBody,
                    status: 'sent',
                    isSystem: true,
                    timestamp: new Date().toISOString(),
                }
            });

            return NextResponse.json({ message: 'Chat ended and menu sent.' }, { status: 200 });
        }

        const validTags = ['Urgent', 'Feedback', 'Complaint', 'Resolved', null];
        if (tag !== undefined && !validTags.includes(tag)) {
            return NextResponse.json({ message: 'Invalid tag provided.' }, { status: 400 });
        }

        if (tag !== undefined) {
            await conversationRef.set({ tag: tag || FieldValue.delete() }, { merge: true });
            return NextResponse.json({ message: 'Tag updated successfully.' }, { status: 200 });
        }

        return NextResponse.json({ message: 'No valid action or tag provided.' }, { status: 400 });

    } catch (error) {
        console.error('PATCH /api/owner/whatsapp-direct/conversations ERROR:', error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
