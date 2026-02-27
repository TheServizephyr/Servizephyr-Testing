/**
 * UNLOCK PAYMENT API
 * 
 * Unlocks table after payment failure
 * Allows retrying payment or adding more items
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { validateTabToken } from '@/lib/dinein-utils';

export async function POST(req) {
    try {
        const { tabId, token, reason } = await req.json();

        if (!tabId || !token) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Verify token
        const isValid = await validateTabToken(tabId, token);
        if (!isValid) {
            return NextResponse.json(
                { error: 'Invalid token' },
                { status: 401 }
            );
        }

        const firestore = await getFirestore();

        await firestore.runTransaction(async (transaction) => {
            const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
            const tabSnap = await transaction.get(tabRef);

            if (!tabSnap.exists) {
                throw new Error('Tab not found');
            }

            // Unlock
            transaction.update(tabRef, {
                status: 'active',
                paymentFailedReason: reason || 'Payment cancelled',
                paymentFailedAt: FieldValue.serverTimestamp(),
                paymentInitiatedAt: null,
                paymentMethod: null
            });
        });

        return NextResponse.json({ success: true, unlocked: true });

    } catch (error) {
        console.error('[Unlock Payment Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to unlock payment' },
            { status: 500 }
        );
    }
}
