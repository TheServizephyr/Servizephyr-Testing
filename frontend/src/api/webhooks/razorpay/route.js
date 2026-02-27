

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { sendNewOrderToOwner } from '@/lib/notifications';
import crypto from 'crypto';
import https from 'https';
import { nanoid } from 'nanoid';


const generateSecureToken = async (firestore, customerPhone) => {
    console.log(`[Webhook RZP] generateSecureToken for phone: ${customerPhone}`);
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity for tracking link
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        phone: customerPhone,
        expiresAt: expiry,
        type: 'tracking'
    });
    console.log(`[Webhook RZP] Token generated: ${token}`);
    return token;
};


async function makeRazorpayRequest(options, payload) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedData);
                    } else {
                        reject(parsedData);
                    }
                } catch (e) {
                     reject({ error: { description: `Failed to parse Razorpay response. Raw data: ${data}` } });
                }
            });
        });
        req.on('error', (e) => reject({ error: { description: e.message } }));
        if(payload) {
          req.write(payload);
        }
        req.end();
    });
}

// --- NEW HELPER FOR SPLIT PAYMENTS ---
const handleSplitPayment = async (firestore, paymentEntity) => {
    const { order_id: razorpayOrderId, notes } = paymentEntity;
    const splitId = notes?.split_session_id;

    if (!splitId) {
        console.log(`[Webhook RZP] Not a split payment. No split_session_id found in notes for order ${razorpayOrderId}.`);
        return false;
    }
    
    console.log(`[Webhook RZP] Detected split payment for session ${splitId}.`);
    const splitRef = firestore.collection('split_payments').doc(splitId);
    
    try {
        await firestore.runTransaction(async (transaction) => {
            console.log(`[Webhook RZP] Starting Firestore transaction for split payment.`);
            const splitDoc = await transaction.get(splitRef);
            if (!splitDoc.exists) {
                console.error(`[Webhook RZP] CRITICAL: Split session ${splitId} not found in Firestore. Cannot process payment.`);
                return; // Abort transaction
            }

            const splitData = splitDoc.data();
            const shares = splitData.shares || [];
            console.log(`[Webhook RZP] Found ${shares.length} shares in session ${splitId}.`);
            const shareIndex = shares.findIndex(s => s.razorpay_order_id === razorpayOrderId);

            if (shareIndex === -1) {
                console.error(`[Webhook RZP] CRITICAL: Razorpay order ${razorpayOrderId} not found in shares for split ${splitId}.`);
                return; // Abort transaction
            }
            console.log(`[Webhook RZP] Matched Razorpay Order ID to share index ${shareIndex}.`);

            // Update the specific share that was paid
            shares[shareIndex].status = 'paid';
            shares[shareIndex].razorpay_payment_id = paymentEntity.id;
            console.log(`[Webhook RZP] Share index ${shareIndex} marked as paid.`);

            const paidShares = shares.filter(s => s.status === 'paid');
            const isFullyPaid = paidShares.length === splitData.splitCount;
            console.log(`[Webhook RZP] ${paidShares.length}/${splitData.splitCount} shares are now paid.`);

            const updateData = { shares };
            if (isFullyPaid) {
                console.log(`[Webhook RZP] All shares paid. Marking session ${splitId} as completed.`);
                updateData.status = 'completed';
                
                 const baseOrderRef = firestore.collection('orders').doc(splitData.baseOrderId);
                 const baseOrderSnap = await transaction.get(baseOrderRef);
                 
                 // If the base order exists, update it. If not, this part is skipped.
                 if(baseOrderSnap.exists){
                    console.log(`[Webhook RZP] Base order ${splitData.baseOrderId} found. Updating its status.`);
                    transaction.update(baseOrderRef, { paymentDetails: { ...paymentEntity, method: 'razorpay_split' }, status: 'pending' });
                 } else {
                    console.warn(`[Webhook RZP] Base order ${splitData.baseOrderId} not found for split payment. Cannot update status.`);
                 }
            }
            
            transaction.update(splitRef, updateData);
            console.log(`[Webhook RZP] Transaction update prepared for split session.`);
        });
        console.log(`[Webhook RZP] Firestore transaction for split payment ${splitId} successful.`);
    } catch (error) {
         console.error(`[Webhook RZP] CRITICAL ERROR during split payment transaction for ${splitId}:`, error);
    }

    return true; // Indicates this was a split payment and was handled
};


export async function POST(req) {
    console.log("[Webhook RZP] Received POST request.");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
        console.error("[Webhook RZP] CRITICAL: RAZORPAY_WEBHOOK_SECRET is not set.");
        return NextResponse.json({ message: 'Webhook secret not configured' }, { status: 500 });
    }

    try {
        const body = await req.text();
        console.log("[Webhook RZP] Raw body:", body);
        const signature = req.headers.get('x-razorpay-signature');
        console.log(`[Webhook RZP] Received signature: ${signature}`);

        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(body);
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.warn(`[Webhook RZP] Invalid signature. Digest: ${digest}, Signature: ${signature}`);
            return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
        }
        console.log("[Webhook RZP] Signature verified successfully.");

        const eventData = JSON.parse(body);
        console.log(`[Webhook RZP] Event received: ${eventData.event}`);
        
        if (eventData.event === 'payment.captured') {
            const paymentEntity = eventData.payload.payment.entity;
            console.log("[Webhook RZP] Payment Entity:", JSON.stringify(paymentEntity, null, 2));

            const razorpayOrderId = paymentEntity.order_id;
            const paymentId = paymentEntity.id;
            const paymentAmount = paymentEntity.amount; 
            
            if (!razorpayOrderId) {
                console.warn("[Webhook RZP] 'order_id' not found in payment entity. Skipping.");
                return NextResponse.json({ status: 'ok' });
            }
            console.log(`[Webhook RZP] Processing payment for Razorpay Order ID: ${razorpayOrderId}`);
            
            const firestore = await getFirestore();
            
            // --- NEW: Check if this is a split payment ---
            const isSplitPayment = await handleSplitPayment(firestore, paymentEntity);
            if (isSplitPayment) {
                console.log(`[Webhook RZP] Split payment for order ${razorpayOrderId} handled. Ending request.`);
                return NextResponse.json({ status: 'ok', message: 'Split payment processed.' });
            }

            // --- Regular Order Processing Continues Below ---
            console.log(`[Webhook RZP] Not a split payment. Proceeding with regular order flow for ${razorpayOrderId}.`);
            const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
            const key_secret = process.env.RAZORPAY_KEY_SECRET;
            const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
            const fetchOrderOptions = {
                hostname: 'api.razorpay.com',
                port: 443,
                path: `/v1/orders/${razorpayOrderId}`,
                method: 'GET',
                headers: { 'Authorization': `Basic ${credentials}` }
            };

            const rzpOrder = await makeRazorpayRequest(fetchOrderOptions);
            console.log("[Webhook RZP] Fetched Razorpay order details:", JSON.stringify(rzpOrder, null, 2));
            const payloadString = rzpOrder.notes?.servizephyr_payload;
            
            if (!payloadString) {
                console.error(`[Webhook RZP] CRITICAL: servizephyr_payload not found for Razorpay Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order payload not found in notes.' });
            }
            
            const { 
                order_id: firestoreOrderId,
                user_id: userId,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: customerDetailsString,
                items: itemsString,
                bill_details: billDetailsString,
                notes: customNotes 
            } = JSON.parse(payloadString);
            console.log("[Webhook RZP] Parsed servizephyr_payload:", { firestoreOrderId, userId, restaurantId, businessType });
            
            if (!firestoreOrderId || !userId || !restaurantId || !businessType) {
                console.error(`[Webhook RZP] CRITICAL: Missing key identifiers in payload for RZP Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order identifier notes missing.' });
            }

            const customerDetails = JSON.parse(customerDetailsString);
            const orderItems = JSON.parse(itemsString);
            const billDetails = JSON.parse(billDetailsString);
            const isStreetVendorOrder = billDetails.deliveryType === 'street-vendor-pre-order';
            console.log(`[Webhook RZP] Is street vendor order? ${isStreetVendorOrder}`);
            
            const trackingToken = await generateSecureToken(firestore, customerDetails.phone || firestoreOrderId);

            const batch = firestore.batch();

            if (!isStreetVendorOrder && customerDetails.phone) {
                 console.log("[Webhook RZP] Processing customer profile updates for non-street-vendor order.");
                const usersRef = firestore.collection('users');
                const existingUserQuery = await usersRef.where('phone', '==', customerDetails.phone).limit(1).get();
                const isNewUser = existingUserQuery.empty;

                if (isNewUser) {
                    console.log(`[Webhook RZP] New user detected (${customerDetails.phone}), creating unclaimed profile.`);
                    const unclaimedUserRef = firestore.collection('unclaimed_profiles').doc(customerDetails.phone);
                    batch.set(unclaimedUserRef, {
                        name: customerDetails.name, 
                        phone: customerDetails.phone, 
                        addresses: [customerDetails.address],
                        createdAt: FieldValue.serverTimestamp(),
                        orderedFrom: FieldValue.arrayUnion({
                            restaurantId: restaurantId,
                            restaurantName: rzpOrder.notes?.restaurantName || 'Unknown',
                            businessType: businessType,
                        })
                    }, { merge: true });
                }
            
                const subtotal = billDetails.subtotal || 0;
                const loyaltyDiscount = billDetails.loyaltyDiscount || 0;
                const pointsEarned = Math.floor(subtotal / 100) * 10;
                const pointsSpent = loyaltyDiscount > 0 ? loyaltyDiscount / 0.5 : 0;
            
                const businessCollectionNameForCustomer = (businessType === 'shop' || businessType === 'store') ? 'shops' : 'restaurants';
                const restaurantCustomerRef = firestore.collection(businessCollectionNameForCustomer).doc(restaurantId).collection('customers').doc(userId);
            
                batch.set(restaurantCustomerRef, {
                    name: customerDetails.name, phone: customerDetails.phone, 
                    status: isNewUser ? 'unclaimed' : 'verified',
                    totalSpend: FieldValue.increment(subtotal),
                    loyaltyPoints: FieldValue.increment(pointsEarned - pointsSpent),
                    lastOrderDate: FieldValue.serverTimestamp(),
                    totalOrders: FieldValue.increment(1),
                }, { merge: true });
            } else {
                console.log("[Webhook RZP] Skipping customer profile updates for street vendor order or order with no phone.");
            }
            
            const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);
            console.log(`[Webhook RZP] Preparing to write main order document to: ${newOrderRef.path}`);
            
            let finalDineInTabId = billDetails.dineInTabId;
            if (billDetails.deliveryType === 'dine-in' && billDetails.tableId && !finalDineInTabId) {
                 console.log("[Webhook RZP] Pre-paid dine-in order detected, creating new tab.");
                 const businessCollectionName = (businessType === 'shop' || businessType === 'store') ? 'shops' : 'restaurants';
                const newTabRef = firestore.collection(businessCollectionName).doc(restaurantId).collection('dineInTabs').doc();
                finalDineInTabId = newTabRef.id;

                batch.set(newTabRef, {
                    id: finalDineInTabId,
                    tableId: billDetails.tableId,
                    status: 'active',
                    tab_name: billDetails.tab_name || "Guest",
                    pax_count: billDetails.pax_count || 1,
                    createdAt: FieldValue.serverTimestamp(),
                });
                
                const tableRef = firestore.collection(businessCollectionName).doc(restaurantId).collection('tables').doc(billDetails.tableId);
                batch.update(tableRef, {
                    current_pax: FieldValue.increment(billDetails.pax_count || 1),
                    state: 'occupied'
                });
            }
            
            let dineInToken = null;
            if (isStreetVendorOrder) {
                const vendorRef = firestore.collection('street_vendors').doc(restaurantId);
                try {
                    const vendorData = (await vendorRef.get()).data();
                    if (vendorData) {
                        const lastToken = vendorData.lastOrderToken || 0;
                        const newTokenNumber = lastToken + 1;
                        
                        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                        const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                        
                        dineInToken = `${String(newTokenNumber).padStart(4, '0')}-${randomChar1}${randomChar2}`;
                        
                        batch.update(vendorRef, { lastOrderToken: newTokenNumber });
                        console.log(`[Webhook RZP] Generated Street Vendor Token: ${dineInToken}`);
                    } else {
                        console.warn(`[Webhook RZP] Street vendor document ${restaurantId} not found, cannot generate token.`);
                    }
                } catch (e) {
                    console.error(`[Webhook RZP] Error fetching street vendor doc to generate token:`, e);
                }
            }

            batch.set(newOrderRef, {
                customerName: customerDetails.name,
                customerId: userId,
                customerAddress: customerDetails.address.full,
                customerPhone: customerDetails.phone,
                restaurantId: restaurantId,
                businessType: businessType,
                deliveryType: billDetails.deliveryType || 'delivery',
                pickupTime: billDetails.pickupTime || null,
                tipAmount: billDetails.tipAmount || 0,
                tableId: billDetails.tableId || null,
                dineInTabId: finalDineInTabId || null,
                dineInToken: dineInToken,
                items: orderItems,
                subtotal: billDetails.subtotal, 
                coupon: billDetails.coupon || null,
                loyaltyDiscount: billDetails.loyaltyDiscount || 0, 
                discount: (billDetails.coupon?.discount || 0) + (billDetails.loyaltyDiscount || 0), 
                cgst: billDetails.cgst, 
                sgst: billDetails.sgst, 
                deliveryCharge: billDetails.deliveryCharge || 0,
                totalAmount: billDetails.grandTotal,
                status: 'pending',
                orderDate: FieldValue.serverTimestamp(),
                notes: customNotes || null,
                trackingToken: trackingToken,
                paymentDetails: {
                    razorpay_payment_id: paymentId,
                    razorpay_order_id: razorpayOrderId,
                    method: 'razorpay',
                }
            });
            
            await batch.commit();
            console.log(`[Webhook RZP] Successfully created Firestore order ${newOrderRef.id} from Razorpay Order ${razorpayOrderId}.`);

            const collectionForBusinessLookup = businessType === 'street-vendor'
                ? 'street_vendors'
                : ((businessType === 'shop' || businessType === 'store') ? 'shops' : 'restaurants');
            const businessDoc = await firestore.collection(collectionForBusinessLookup).doc(restaurantId).get();

            if (businessDoc.exists) {
                const businessData = businessDoc.data();
                if(!businessData.name) {
                     await newOrderRef.update({ restaurantName: "Unnamed Business" });
                } else {
                     await newOrderRef.update({ restaurantName: businessData.name });
                }

                const linkedAccountId = businessData.razorpayAccountId;
                if (linkedAccountId && linkedAccountId.startsWith('acc_')) {
                    const transferPayload = JSON.stringify({ transfers: [{ account: linkedAccountId, amount: paymentAmount, currency: "INR" }] });
                    const transferOptions = {
                        hostname: 'api.razorpay.com',
                        port: 443,
                        path: `/v1/payments/${paymentId}/transfers`,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${credentials}` }
                    };
                    
                    try {
                        await makeRazorpayRequest(transferOptions, transferPayload);
                        console.log(`[Webhook RZP] Initiated transfer for payment ${paymentId} to account ${linkedAccountId}.`);
                    } catch (transferError) {
                        console.error(`[Webhook RZP] CRITICAL: Failed to process transfer for payment ${paymentId}. Error:`, JSON.stringify(transferError, null, 2));
                    }
                } else {
                    console.warn(`[Webhook RZP] Restaurant ${restaurantId} has no Linked Account. Skipping transfer.`);
                }

                if (businessData.ownerPhone && businessData.botPhoneNumberId) {
                    console.log(`[Webhook RZP] Sending new order notification to owner.`);
                    await sendNewOrderToOwner({
                        ownerPhone: businessData.ownerPhone,
                        botPhoneNumberId: businessData.botPhoneNumberId,
                        customerName: customerDetails.name,
                        totalAmount: billDetails.grandTotal,
                        orderId: newOrderRef.id,
                        restaurantName: businessData.name
                    });
                }
            }
        }

        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('[Webhook RZP] CRITICAL Error processing webhook:', error);
        return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 200 });
    }
}
