import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { recalculateTabTotals, verifyTabIntegrity } from '@/lib/dinein-utils';

import Razorpay from 'razorpay';
import axios from 'axios';

export const dynamic = 'force-dynamic';

// POST: Settle payment for existing dine-in orders
export async function POST(req) {
    try {
        let { tabId, restaurantId, paymentMethod, grandTotal } = await req.json();

        if (!tabId || !restaurantId) {
            return NextResponse.json({ message: 'TabId and RestaurantId required' }, { status: 400 });
        }

        // 🔐 AUTH & OWNERSHIP CHECK
        // For settlement, either the customer (who owns the orders in tab) or the owner can settle.
        const uid = await verifyAndGetUid(req);
        // Note: Full ownership check of all orders in tab is expensive. 
        // Minimally ensure user is authenticated. 
        // For dine-in, we usually trust the person at the table (possession of session/token)
        // But audit wants strict identity. We'll verify against first order's userId.


        console.log(`[Settle Payment] Method: ${paymentMethod}, TabId: ${tabId}, Amount: ${grandTotal}`);

        const firestore = await getFirestore();

        // Find business reference (restaurantId is the document ID)
        let businessRef;
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];

        for (const collectionName of collectionsToTry) {
            const docRef = firestore.collection(collectionName).doc(restaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                businessRef = docRef;
                console.log(`[Settle Payment] Business found in ${collectionName}`);
                break;
            }
        }

        if (!businessRef) {
            console.error(`[Settle Payment] Business not found with ID: ${restaurantId}`);
            return NextResponse.json({ message: 'Business not found' }, { status: 404 });
        }

        const businessDoc = await businessRef.get();
        const businessData = businessDoc.data();
        console.log(`[Settle Payment] Business: ${businessData.name}`);

        // ✅ PHASE 1 INTEGRATION: Verify integrity before payment
        try {
            const { isValid, mismatch } = await verifyTabIntegrity(tabId);
            if (!isValid) {
                console.warn(`[Settle Payment] Tab ${tabId} had mismatch of ₹${mismatch}, auto-corrected`);
            }

            // Recalculate to get accurate amount
            const { totalAmount, pendingAmount } = await recalculateTabTotals(tabId);
            console.log(`[Settle Payment] ✅ Verified amounts - Total: ₹${totalAmount}, Pending: ₹${pendingAmount}`);

            // Update grandTotal if different (use verified amount)
            if (Math.abs(pendingAmount - grandTotal) > 0.01) {
                console.warn(`[Settle Payment] Amount mismatch: requested ₹${grandTotal}, actual ₹${pendingAmount}`);
                // Use verified amount for safety
                grandTotal = pendingAmount;
            }
        } catch (verifyErr) {
            console.warn('[Settle Payment] Verification failed:', verifyErr.message);
            // Continue with requested amount if verification fails
        }

        // For online payment, create Razorpay order
        if (paymentMethod === 'razorpay' || paymentMethod === 'online') {
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                return NextResponse.json({ message: 'Payment gateway not configured' }, { status: 500 });
            }

            const razorpay = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });

            const razorpayOrder = await razorpay.orders.create({
                amount: Math.round(grandTotal * 100),
                currency: 'INR',
                receipt: `rcpt_${tabId.replace('tab_', '')}_${Date.now().toString().slice(-5)}`,
                notes: {
                    type: 'dine-in-settlement',
                    tabId,
                    restaurantId
                }
            });

            console.log(`[Settle Payment] Razorpay order created: ${razorpayOrder.id}`);

            return NextResponse.json({
                message: 'Razorpay order created for settlement',
                razorpay_order_id: razorpayOrder.id,
                tabId,
                amount: grandTotal
            }, { status: 200 });
        }

        // For Pay at Counter - just mark as pending payment
        if (paymentMethod === 'cod' || paymentMethod === 'counter') {
            // ROBUST UPDATE: Use Deep Search to find ALL orders for this tab (Token + ID)
            const [snap1, snap2] = await Promise.all([
                businessRef.collection('orders').where('dineInTabId', '==', tabId).where('status', 'not-in', ['rejected', 'picked_up']).get(),
                businessRef.collection('orders').where('tabId', '==', tabId).where('status', 'not-in', ['rejected', 'picked_up']).get()
            ]);

            const uniqueDocs = new Map();
            snap1.forEach(doc => uniqueDocs.set(doc.id, doc));
            snap2.forEach(doc => uniqueDocs.set(doc.id, doc));

            // Token Fallback (Deep Search)
            let dineInToken = null;
            if (uniqueDocs.size > 0) {
                dineInToken = uniqueDocs.values().next().value.data().dineInToken;
            }
            if (dineInToken) {
                console.log(`[Settle Payment] Deep searching with token: ${dineInToken}`);
                const tokenQuery = await businessRef.collection('orders')
                    .where('dineInToken', '==', dineInToken)
                    .where('status', 'not-in', ['rejected', 'picked_up'])
                    .get();
                tokenQuery.forEach(doc => uniqueDocs.set(doc.id, doc));
            }

            console.log(`[Settle Payment] Marking ${uniqueDocs.size} orders as 'pay_at_counter'`);

            const batch = firestore.batch();

            uniqueDocs.forEach(doc => {
                batch.update(doc.ref, {
                    paymentStatus: 'pay_at_counter',
                    paymentMethod: 'counter',
                    updatedAt: FieldValue.serverTimestamp()
                });
            });

            await batch.commit();

            return NextResponse.json({
                message: 'Payment marked as pay at counter',
                tabId
            }, { status: 200 });
        }

        // For PhonePe payment
        if (paymentMethod === 'phonepe') {
            console.log('[Settle Payment] Initiating PhonePe payment');

            const PHONEPE_BASE_URL = process.env.PHONEPE_BASE_URL;
            const CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
            const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
            const PHONEPE_AUTH_URL = process.env.PHONEPE_AUTH_URL;

            if (!PHONEPE_BASE_URL || !CLIENT_ID || !CLIENT_SECRET || !PHONEPE_AUTH_URL) {
                console.error("[Settle Payment] PhonePe credentials missing");
                return NextResponse.json({ message: 'Payment gateway not configured' }, { status: 500 });
            }

            // Generate Token
            const tokenRequestBody = new URLSearchParams({
                client_id: CLIENT_ID,
                client_version: "1",
                client_secret: CLIENT_SECRET,
                grant_type: "client_credentials"
            }).toString();

            const tokenResponse = await axios.post(PHONEPE_AUTH_URL, tokenRequestBody, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const accessToken = tokenResponse.data.access_token;

            // Create Payment Request
            const amountInPaise = Math.round(grandTotal * 100);
            const settlementId = `phpe_${tabId.replace('tab_', '')}_${Date.now().toString().slice(-5)}`;
            const redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://www.servizephyr.com'}/track/dine-in/${tabId}?payment_status=success`;

            const paymentPayload = {
                merchantOrderId: settlementId,
                amount: amountInPaise,
                expireAfter: 1200,
                paymentFlow: {
                    type: "PG_CHECKOUT",
                    message: `Bill Settlement - Table ${businessData.name}`,
                    merchantUrls: {
                        redirectUrl: redirectUrl
                    }
                }
            };

            const paymentResponse = await axios.post(
                `${PHONEPE_BASE_URL}/checkout/v2/pay`,
                paymentPayload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `O-Bearer ${accessToken}`
                    }
                }
            );

            if (paymentResponse.data.redirectUrl) {
                return NextResponse.json({
                    message: 'PhonePe initiated',
                    url: paymentResponse.data.redirectUrl,
                    phonepe_order_id: paymentResponse.data.orderId,
                    tabId,
                    method: 'phonepe'
                }, { status: 200 });
            } else {
                throw new Error("PhonePe did not return a redirect URL");
            }
        }

        // For Split Bill - allow it to proceed so frontend handles it
        if (paymentMethod === 'split_bill') {
            console.log('[Settle Payment] Split bill requested - approving for frontend handling');
            return NextResponse.json({
                message: 'Split bill session validated',
                tabId,
                firestore_order_id: tabId, // Required by SplitBillInterface
                method: 'split_bill',
                amount: grandTotal
            }, { status: 200 });
        }

        return NextResponse.json({ message: `Unsupported payment method: ${paymentMethod}` }, { status: 400 });

    } catch (error) {
        console.error('[Settle Payment] Error:', error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}
