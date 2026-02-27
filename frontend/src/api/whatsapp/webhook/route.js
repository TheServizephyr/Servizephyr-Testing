

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendOrderStatusUpdateToCustomer, sendNewOrderToOwner } from '@/lib/notifications';
import axios from 'axios';
import { nanoid } from 'nanoid';


const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

export async function GET(request) {
  console.log("[Webhook WA] GET request received for verification.");
  try {
    const { searchParams } = new URL(request.url);
    
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    console.log(`[Webhook WA] Mode: ${mode}, Token: ${token ? 'Present' : 'Missing'}, Challenge: ${challenge ? 'Present' : 'Missing'}`);

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log("[Webhook WA] Verification SUCCESS. Responding with challenge.");
      return new NextResponse(challenge, { status: 200 });
    } else {
      console.error("[Webhook WA] Verification FAILED. Tokens do not match or mode is not 'subscribe'.");
      return new NextResponse('Verification Failed', { status: 403 });
    }
  } catch (error) {
    console.error('[Webhook WA] CRITICAL ERROR in GET handler:', error);
    return new NextResponse('Server Error', { status: 500 });
  }
}

async function getBusiness(firestore, botPhoneNumberId) {
    console.log(`[Webhook WA] getBusiness: Searching for business with botPhoneNumberId: ${botPhoneNumberId}`);
    const restaurantsQuery = await firestore.collection('restaurants').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const doc = restaurantsQuery.docs[0];
        console.log(`[Webhook WA] getBusiness: Found business in 'restaurants' collection with ID: ${doc.id}`);
        return { id: doc.id, ref: doc.ref, data: doc.data(), collectionName: 'restaurants' };
    }
    
    const shopsQuery = await firestore.collection('shops').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        console.log(`[Webhook WA] getBusiness: Found business in 'shops' collection with ID: ${doc.id}`);
        return { id: doc.id, ref: doc.ref, data: doc.data(), collectionName: 'shops' };
    }
    
    console.warn(`[Webhook WA] getBusiness: No business found for botPhoneNumberId: ${botPhoneNumberId}`);
    return null;
}

const generateSecureToken = async (firestore, customerPhone) => {
    console.log(`[Webhook WA] generateSecureToken: Generating for phone: ${customerPhone}`);
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        phone: customerPhone,
        expiresAt: expiry,
        type: 'tracking'
    });
    console.log("[Webhook WA] generateSecureToken: Token generated.");
    return token;
};


const sendWelcomeMessageWithOptions = async (customerPhoneWithCode, business, botPhoneNumberId) => {
    console.log(`[Webhook WA] Sending interactive welcome message to ${customerPhoneWithCode}`);
    
    const payload = {
        type: "interactive",
        interactive: {
            type: "button",
            body: {
                text: `Welcome to ${business.data.name}!\n\nWhat would you like to do today?`
            },
            action: {
                buttons: [
                    { type: "reply", reply: { id: `action_order_${business.id}`, title: "Order Food" } },
                    { type: "reply", reply: { id: `action_track_${business.id}`, title: "Track Last Order" } },
                    { type: "reply", reply: { id: `action_help`, title: "Need Help?" } }
                ]
            }
        }
    };
    
    await sendWhatsAppMessage(customerPhoneWithCode, payload, botPhoneNumberId);
}


const handleDineInConfirmation = async (firestore, text, fromNumber, business, botPhoneNumberId) => {
    const orderIdMatch = text.match(/order ID: ([a-zA-Z0-9]+)/i);
    if (!orderIdMatch || !orderIdMatch[1]) {
        return false; // Not a dine-in confirmation message
    }
    
    const orderId = orderIdMatch[1];
    console.log(`[Webhook WA DineIn] Found confirmation request for orderId: ${orderId}`);

    const orderRef = firestore.collection('orders').doc(orderId);
    const businessRef = business.ref;
    let dineInToken;
    let trackingTokenForLink;

    try {
        await firestore.runTransaction(async (transaction) => {
            console.log(`[Webhook WA DineIn] Starting transaction for order ${orderId}`);
            const businessDoc = await transaction.get(businessRef);
            if (!businessDoc.exists) throw new Error("Business document not found.");

            const orderDoc = await transaction.get(orderRef);
            if (!orderDoc.exists) throw new Error("Order document not found.");
            
            const orderData = orderDoc.data();
            const businessData = businessDoc.data();

            if (orderData.dineInToken && orderData.trackingToken) {
                dineInToken = orderData.dineInToken;
                trackingTokenForLink = orderData.trackingToken;
                 console.log(`[Webhook WA DineIn] Token already exists for order ${orderId}. Re-sending.`);
                return;
            }

            const lastToken = businessData.lastDineInToken || 0;
            const newTokenNumber = lastToken + 1;
            const randomChar = String.fromCharCode(65 + Math.floor(Math.random() * 26));
            dineInToken = `#${String(newTokenNumber).padStart(2, '0')}-${randomChar}`;
            
            const customerPhone = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;
            trackingTokenForLink = orderData.trackingToken; 
            
            transaction.update(businessRef, { lastDineInToken: newTokenNumber });
            transaction.update(orderRef, { customerPhone: customerPhone, dineInToken: dineInToken });
            console.log(`[Webhook WA DineIn] Transaction successful. New token: ${dineInToken}`);
        });
        
        const trackingUrl = `https://servizephyr.com/track/dine-in/${orderId}?token=${trackingTokenForLink}`;

        await sendWhatsAppMessage(fromNumber, `Thanks, your order request has been received!\n\n*Your Token is: ${dineInToken}*\n\nPlease show this token at the counter.\n\nTrack its live status here:\n${trackingUrl}`, botPhoneNumberId);
        
        if (business.data.ownerPhone && business.data.botPhoneNumberId) {
            await sendNewOrderToOwner({
                ownerPhone: business.data.ownerPhone,
                botPhoneNumberId: business.data.botPhoneNumberId,
                customerName: `Dine-In (Token: ${dineInToken})`,
                totalAmount: (await orderRef.get()).data().totalAmount,
                orderId: orderId,
                restaurantName: business.data.name
            });
        }
        
        return true;

    } catch (error) {
        console.error(`[Webhook WA DineIn] CRITICAL error processing confirmation for ${orderId}:`, error);
        if (error.message.includes("Order document not found")) {
            await sendWhatsAppMessage(fromNumber, "Sorry, this order ID is invalid. Please try placing your order again.", botPhoneNumberId);
        } else {
            await sendWhatsAppMessage(fromNumber, "Sorry, we couldn't process your request at the moment. Please try again or contact staff.", botPhoneNumberId);
        }
        return true;
    }
};


const handleButtonActions = async (firestore, buttonId, fromNumber, business, botPhoneNumberId) => {
    const [action, type, ...payloadParts] = buttonId.split('_');

    if (action !== 'action') return;
    
    const customerPhone = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;
    const conversationRef = business.ref.collection('conversations').doc(customerPhone);
    
    console.log(`[Webhook WA] Handling button action: '${type}' for customer ${customerPhone}`);

    try {
        switch(type) {
            case 'order': {
                const businessId = payloadParts.join('_');
                const token = await generateSecureToken(firestore, customerPhone);
                const link = `https://servizephyr.com/order/${businessId}?phone=${customerPhone}&token=${token}`;
                
                // ✅ TRACK: Create/update conversation to show customer accessed order link
                await conversationRef.set({
                    customerName: 'Unknown',
                    customerPhone: customerPhone,
                    state: 'browsing_order',
                    orderLinkAccessedAt: FieldValue.serverTimestamp(),
                    lastActivity: 'Order link accessed',
                    lastActivityTimestamp: FieldValue.serverTimestamp(),
                }, { merge: true });
                
                await sendWhatsAppMessage(fromNumber, `Here is your personal link to place an order:\n\n${link}\n\nThis link is valid for 24 hours.`, botPhoneNumberId);
                console.log(`[Webhook WA] Order link tracked for customer ${customerPhone}`);
                break;
            }
            case 'track': {
                console.log(`[Webhook WA] 'track' action initiated for ${customerPhone}.`);
                const ordersRef = firestore.collection('orders');
                const q = ordersRef.where('customerPhone', '==', customerPhone).orderBy('orderDate', 'desc').limit(1);
                const querySnapshot = await q.get();

                if (querySnapshot.empty) {
                    console.log(`[Webhook WA] No recent orders found for ${customerPhone}.`);
                    await sendWhatsAppMessage(fromNumber, `You don't have any recent orders to track.`, botPhoneNumberId);
                } else {
                    const latestOrderDoc = querySnapshot.docs[0];
                    const latestOrder = latestOrderDoc.data();
                    
                    if (!latestOrder.trackingToken) {
                        console.error(`[Webhook WA] CRITICAL: Tracking token missing for latest order ${latestOrderDoc.id} of customer ${customerPhone}.`);
                        await sendWhatsAppMessage(fromNumber, `We couldn't find tracking information for your last order. Please contact support.`, botPhoneNumberId);
                        return;
                    }
                    const orderId = latestOrderDoc.id;
                    const token = latestOrder.trackingToken;
                    console.log(`[Webhook WA] Found latest order ${orderId} with tracking token.`);

                    const trackingPath = latestOrder.deliveryType === 'dine-in' ? 'dine-in/' : '';
                    const link = `https://servizephyr.com/track/${trackingPath}${orderId}?token=${token}`;

                    await sendWhatsAppMessage(fromNumber, `Here is the tracking link for your latest order (#${orderId.substring(0, 6)}):\n\n${link}`, botPhoneNumberId);
                }
                break;
            }
            case 'help': {
                // ✅ NOTIFY CUSTOMER: Send interactive message with End Chat button
                await conversationRef.set({ 
                    state: 'direct_chat',
                    enteredDirectChatAt: FieldValue.serverTimestamp(),
                    directChatTimeoutMinutes: 30,
                    lastActivity: 'Entered direct chat',
                    lastActivityTimestamp: FieldValue.serverTimestamp(),
                }, { merge: true });
                
                // Send interactive message with End Chat button
                const payload = {
                    type: "interactive",
                    interactive: {
                        type: "button",
                        body: {
                            text: `✅ You are now connected directly with support from ${business.data.name}.\n\n👋 A representative will help you shortly.\n\n💬 You can exit anytime by typing: end chat\n\n⏱️ Auto-exit in 30 minutes if no activity.`
                        },
                        action: {
                            buttons: [
                                { type: "reply", reply: { id: `action_end_chat`, title: "End Chat" } }
                            ]
                        }
                    }
                };
                
                await sendWhatsAppMessage(fromNumber, payload, botPhoneNumberId);
                console.log(`[Webhook WA] Customer ${customerPhone} entered direct chat with End Chat button`);
                break;
            }
            case 'end': {
                // ✅ Handle End Chat button click (action_end_chat splits to type='end', payloadParts=['chat'])
                if (payloadParts[0] === 'chat') {
                    await conversationRef.set({ state: 'menu' }, { merge: true });
                    const exitMessage = `👋 Thank you for chatting with ${business.data.name}!\n\nYour chat has been closed. Feel free to place an order anytime!`;
                    await sendWhatsAppMessage(fromNumber, exitMessage, botPhoneNumberId);
                    // Send welcome menu after a short delay
                    setTimeout(() => sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId), 1000);
                    console.log(`[Webhook WA] Customer ${customerPhone} ended direct chat via button`);
                }
                break;
            }
            case 'report': {
                if (payloadParts[0] === 'admin') {
                    console.log(`[Webhook WA] Admin Report triggered by ${customerPhone} for business ${business.id}`);
                    await sendWhatsAppMessage(fromNumber, `Thank you. Your request to speak with an admin has been noted. We will review the conversation and get back to you shortly.`, botPhoneNumberId);
                }
                break;
            }
            default:
                 console.warn(`[Webhook WA] Unhandled button action type: ${type}`);
        }
    } catch (e) {
        console.error(`[Webhook WA] Error handling button action '${type}':`, e);
        await sendWhatsAppMessage(fromNumber, `Sorry, we couldn't process your request right now. Please try again.`, botPhoneNumberId);
    }
}


export async function POST(request) {
    console.log("[Webhook WA] POST request received.");
    try {
        const body = await request.json();
        
        console.log("[Webhook WA] Request Body Received:", JSON.stringify(body, null, 2));

        if (body.object !== 'whatsapp_business_account') {
            console.log("[Webhook WA] Event is not from a WhatsApp Business Account. Skipping.");
            return NextResponse.json({ message: 'Not a WhatsApp event' }, { status: 200 });
        }

        const firestore = await getFirestore();
        const change = body.entry?.[0]?.changes?.[0];
        
        if (!change || !change.value) {
            console.log("[Webhook WA] No 'change' or 'value' object found in payload. Skipping.");
            return NextResponse.json({ message: 'No change data' }, { status: 200 });
        }
        
        const botPhoneNumberId = change.value.metadata.phone_number_id;
        const business = await getBusiness(firestore, botPhoneNumberId);
        if (!business) {
             console.error(`[Webhook WA] No business found for Bot Phone Number ID: ${botPhoneNumberId}`);
             return NextResponse.json({ message: 'Business not found' }, { status: 404 });
        }

        if (change.value.messages && change.value.messages.length > 0) {
            const message = change.value.messages[0];
            const fromNumber = message.from;
            const fromPhoneNumber = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;

            if (message.type === 'text') {
                const isDineInHandled = await handleDineInConfirmation(firestore, message.text.body, fromNumber, business, botPhoneNumberId);
                if (isDineInHandled) {
                    console.log(`[Webhook WA] Message handled by Dine-in flow. Skipping further processing.`);
                    return NextResponse.json({ message: 'Dine-in confirmation processed.' }, { status: 200 });
                }
            }

            const conversationRef = business.ref.collection('conversations').doc(fromPhoneNumber);
            const conversationSnap = await conversationRef.get();
            const conversationData = conversationSnap.exists ? conversationSnap.data() : { state: 'menu' };
            
            // ✅ CHECK FOR AUTO-TIMEOUT: If in direct_chat mode and exceeded timeout window (30 min default)
            if (conversationData.state === 'direct_chat' && conversationData.enteredDirectChatAt) {
                const enteredAt = conversationData.enteredDirectChatAt.toDate ? conversationData.enteredDirectChatAt.toDate() : new Date(conversationData.enteredDirectChatAt);
                const timeoutMinutes = conversationData.directChatTimeoutMinutes || 30;
                const elapsedMinutes = (Date.now() - enteredAt.getTime()) / 60000;
                
                if (elapsedMinutes > timeoutMinutes) {
                    console.log(`[Webhook WA] Chat timeout detected for customer ${fromPhoneNumber} after ${elapsedMinutes.toFixed(1)} minutes`);
                    // Auto-exit from direct chat
                    await conversationRef.set({ state: 'menu' }, { merge: true });
                    const timeoutMsg = `⏰ Your 30-minute chat session has ended.\n\nFeel free to reach out again anytime you need support!`;
                    await sendWhatsAppMessage(fromNumber, timeoutMsg, botPhoneNumberId);
                    await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId);
                    return NextResponse.json({ message: 'Chat timed out, returning to menu' }, { status: 200 });
                }
            }
            
            // ✅ HANDLE 'END CHAT' COMMAND: Allow customer to manually exit direct chat (any case/spacing)
            if (conversationData.state === 'direct_chat' && message.type === 'text') {
                const cleanText = message.text.body.toLowerCase().trim().replace(/\s+/g, '');
                if (cleanText === 'endchat') {
                    console.log(`[Webhook WA] Customer ${fromPhoneNumber} ended direct chat manually`);
                    await conversationRef.set({ state: 'menu' }, { merge: true });
                    const exitMessage = `👋 Thank you for chatting with ${business.data.name}!\n\nYour chat has been closed. Feel free to place an order or ask for help anytime!`;
                    await sendWhatsAppMessage(fromNumber, exitMessage, botPhoneNumberId);
                    // Send welcome menu after a short delay
                    setTimeout(() => sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId), 1000);
                    return NextResponse.json({ message: 'Chat ended by customer' }, { status: 200 });
                }
            }
            
            if (conversationData.state === 'direct_chat' && message.type === 'text') {
                const messageRef = conversationRef.collection('messages').doc(message.id);
                
                await messageRef.set({
                    id: message.id,
                    sender: 'customer',
                    timestamp: FieldValue.serverTimestamp(),
                    status: 'received',
                    type: 'text',
                    text: message.text.body
                });
                
                await conversationRef.set({
                    customerName: change.value.contacts[0].profile.name,
                    customerPhone: fromPhoneNumber,
                    lastMessage: message.text.body,
                    lastMessageType: 'text',
                    lastMessageTimestamp: FieldValue.serverTimestamp(),
                    unreadCount: FieldValue.increment(1)
                }, { merge: true });
                
                console.log(`[Webhook WA] Message from ${fromPhoneNumber} forwarded to owner.`);
                return NextResponse.json({ message: 'Forwarded to owner' }, { status: 200 });
            }

            if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
                const buttonReply = message.interactive.button_reply;
                const buttonId = buttonReply.id;
                
                console.log(`[Webhook WA] Button click detected. Button ID: "${buttonId}", From: ${fromNumber}`);
                
                await handleButtonActions(firestore, buttonId, fromNumber, business, botPhoneNumberId);
            } 
            else if (message.type === 'text' && conversationData.state !== 'direct_chat') {
                await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId);
            }
        }
        
        console.log("[Webhook WA] POST request processed successfully.");
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook WA] CRITICAL Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
    
