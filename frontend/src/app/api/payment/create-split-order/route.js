

import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const body = await req.json();

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
            const firestore = await getFirestore();
            const amountPerShare = Math.round((finalAmount / splitCount) * 100); // Amount in paise

            const splitId = `split_${nanoid(16)}`;
            const splitRef = firestore.collection('split_payments').doc(splitId);

            const shares = [];
            for (let i = 0; i < splitCount; i++) {
                const shareReceipt = `share_${splitId}_${i}`;
                const rzpOrder = await razorpay.orders.create({
                    amount: amountPerShare,
                    currency: "INR",
                    receipt: shareReceipt,
                    notes: {
                        split_session_id: splitId
                    }
                });
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
                isPublic: true
            };
            await splitRef.set(firestorePayload);

            return NextResponse.json({ message: 'Split session created', splitId }, { status: 200 });
        }

        // --- Fallback for simple order creation (as it was before) ---

        const amountForSimpleOrder = subtotal !== undefined ? subtotal : finalAmount;

        if (!amountForSimpleOrder || amountForSimpleOrder < 1) {
            return NextResponse.json({ message: 'A valid amount is required for a simple order.' }, { status: 400 });
        }
        const options = {
            amount: Math.round(amountForSimpleOrder * 100),
            currency: "INR",
            receipt: `receipt_${nanoid(10)}`,
        };
        const order = await razorpay.orders.create(options);
        return NextResponse.json(order, { status: 200 });


    } catch (error) {
        console.error("CRITICAL ERROR in /api/payment/create-order:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
