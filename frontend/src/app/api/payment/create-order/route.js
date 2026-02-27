

import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API /payment/create-order] POST request received.");
    try {
        const body = await req.json();
        console.log("[API /payment/create-order] Request body parsed:", JSON.stringify(body, null, 2));

        const { grandTotal, totalAmount, subtotal, splitCount, baseOrderId, restaurantId } = body;

        const finalAmount = grandTotal ?? totalAmount;

        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.error("CRITICAL: Razorpay credentials are not configured.");
            return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
        }

        const razorpay = new Razorpay({
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        // If it's a split bill request
        if (splitCount && baseOrderId && restaurantId && finalAmount) {
            console.log(`[API /payment/create-order] Creating split payment session. Base Order: ${baseOrderId}, Split Count: ${splitCount}, Amount: ${finalAmount}`);
            if (!baseOrderId) {
                console.error("[API /payment/create-order] CRITICAL: baseOrderId is missing for split payment.");
                return NextResponse.json({ message: 'Base Order ID is missing for split payment.' }, { status: 400 });
            }

            const firestore = await getFirestore();
            const amountPerShare = Math.round((finalAmount / splitCount) * 100); // Amount in paise

            const splitId = `split_${baseOrderId}`;
            const splitRef = firestore.collection('split_payments').doc(splitId);
            console.log(`[API /payment/create-order] Split session ID: ${splitId}`);

            const shares = [];
            for (let i = 0; i < splitCount; i++) {
                const shareReceipt = `share_${splitId}_${i}`;
                console.log(`[API /payment/create-order] Creating Razorpay order for share ${i + 1}/${splitCount}`);
                const rzpOrder = await razorpay.orders.create({
                    amount: amountPerShare,
                    currency: "INR",
                    receipt: shareReceipt,
                    notes: {
                        split_session_id: splitId,
                        base_order_id: baseOrderId,
                        share_number: i,
                    }
                });
                console.log(`[API /payment/create-order] Razorpay order created for share ${i}: ${rzpOrder.id}`);
                shares.push({
                    shareId: i,
                    razorpay_order_id: rzpOrder.id,
                    amount: amountPerShare / 100,
                    status: 'pending',
                });
            }

            const firestorePayload = {
                id: splitId,
                baseOrderId,
                restaurantId,
                totalAmount: finalAmount,
                splitCount,
                shares,
                status: 'pending',
                createdAt: FieldValue.serverTimestamp(),
                isPublic: true,
                // Store pending items for add-on orders (will be added after payment)
                pendingItems: body.pendingItems || [],
                pendingSubtotal: body.pendingSubtotal || 0,
                pendingCgst: body.pendingCgst || 0,
                pendingSgst: body.pendingSgst || 0,
            };
            console.log("[API /payment/create-order] Saving split session to Firestore:", JSON.stringify(firestorePayload, null, 2));
            await splitRef.set(firestorePayload);

            return NextResponse.json({ message: 'Split session created', splitId }, { status: 200 });
        }

        // --- NEW: Pay Remaining Logic ---
        const { isPayRemaining, splitSessionId } = body;
        if (isPayRemaining && splitSessionId) {
            console.log(`[API /payment/create-order] Handling 'Pay Remaining' for session ${splitSessionId}`);
            const firestore = await getFirestore();
            const splitRef = firestore.collection('split_payments').doc(splitSessionId);

            try {
                const result = await firestore.runTransaction(async (transaction) => {
                    const splitDoc = await transaction.get(splitRef);
                    if (!splitDoc.exists) throw new Error("Split session not found.");

                    const splitData = splitDoc.data();
                    const shares = splitData.shares || [];
                    const pendingShares = shares.filter(s => s.status !== 'paid');

                    if (pendingShares.length === 0) throw new Error("All shares are already paid.");

                    const remainingAmount = pendingShares.reduce((sum, s) => sum + s.amount, 0);
                    console.log(`[API /payment/create-order] Calculated remaining amount: ${remainingAmount}`);

                    // Create Razorpay Order
                    const rzpOrder = await razorpay.orders.create({
                        amount: Math.round(remainingAmount * 100),
                        currency: "INR",
                        receipt: `rem_${nanoid(15)}`,
                        notes: {
                            split_session_id: splitSessionId,
                            type: 'pay_remaining'
                        }
                    });

                    // DO NOT update razorpay_order_id on shares. 
                    // The 'Pay Remaining' webhook uses notes.type='pay_remaining' to identify the transaction
                    // and updates all pending shares. We must preserve the individual order IDs 
                    // so that individual payments still work if the user chooses that route.

                    // transaction.update(splitRef, { shares: updatedShares }); // <-- REMOVED THIS
                    return rzpOrder;
                });

                return NextResponse.json(result, { status: 200 });
            } catch (error) {
                console.error("[API /payment/create-order] Pay Remaining Transaction Failed:", error);
                return NextResponse.json({ message: error.message }, { status: 400 });
            }
        }

        // --- Fallback for simple order creation (as it was before) ---
        console.log("[API /payment/create-order] Handling as a simple, non-split order.");
        const amountForSimpleOrder = subtotal !== undefined ? subtotal : finalAmount;

        if (!amountForSimpleOrder || amountForSimpleOrder < 1) {
            console.error("[API /payment/create-order] Invalid amount for simple order:", amountForSimpleOrder);
            return NextResponse.json({ message: 'A valid amount is required for a simple order.' }, { status: 400 });
        }

        const splitIdFromNotes = body.notes?.split_session_id;

        const options = {
            amount: Math.round(amountForSimpleOrder * 100),
            currency: "INR",
            receipt: `receipt_${nanoid(10)}`,
            notes: {
                ...(splitIdFromNotes && { split_session_id: splitIdFromNotes }),
            }
        };
        const order = await razorpay.orders.create(options);
        console.log("[API /payment/create-order] Simple Razorpay order created:", order.id, "with notes:", options.notes);
        return NextResponse.json(order, { status: 200 });


    } catch (error) {
        console.error("CRITICAL ERROR in /api/payment/create-order:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
