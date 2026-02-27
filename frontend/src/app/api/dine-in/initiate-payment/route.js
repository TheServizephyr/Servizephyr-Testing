/**
 * INITIATE PAYMENT API
 * 
 * Locks table for payment processing
 * Recalculates totals before payment
 * Prevents concurrent modifications
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { recalculateTabTotals, validateTabToken } from '@/lib/dinein-utils';

export async function POST(req) {
    try {
        const { tabId, token, paymentMethod } = await req.json();

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

        const result = await firestore.runTransaction(async (transaction) => {
            const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
            const tabSnap = await transaction.get(tabRef);

            if (!tabSnap.exists) {
                throw new Error('Tab not found');
            }

            const tabData = tabSnap.data();

            // Check if already locked
            if (tabData.status === 'locked_for_payment') {
                throw new Error('Another payment is in progress');
            }

            // Lock table
            transaction.update(tabRef, {
                status: 'locked_for_payment',
                paymentInitiatedAt: FieldValue.serverTimestamp(),
                paymentMethod
            });

            return {
                pendingAmount: tabData.pendingAmount || 0
            };
        });

        // Recalculate after lock (outside transaction for performance)
        await recalculateTabTotals(tabId);

        // Get updated amount
        const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
        const updatedSnap = await tabRef.get();
        const updatedData = updatedSnap.data();

        if (updatedData.pendingAmount <= 0) {
            // Unlock if nothing to pay
            await tabRef.update({
                status: 'active',
                paymentInitiatedAt: null
            });

            return NextResponse.json(
                { error: 'No pending amount' },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            amount: updatedData.pendingAmount,
            tabId,
            paymentLocked: true
        });

    } catch (error) {
        console.error('[Initiate Payment Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to initiate payment' },
            { status: 500 }
        );
    }
}
