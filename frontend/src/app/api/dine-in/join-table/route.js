/**
 * JOIN DINE-IN TABLE API
 * 
 * Allows a customer to join an existing table
 * Increments occupied seats
 * Validates capacity
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { validateTabToken } from '@/lib/dinein-utils';

export async function POST(req) {
    try {
        const { tabId, customerName, token } = await req.json();

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

            const tabData = tabSnap.data();

            // Check capacity
            if (tabData.occupiedSeats >= tabData.capacity) {
                throw new Error('Table is full');
            }

            // Increment occupied seats
            transaction.update(tabRef, {
                occupiedSeats: FieldValue.increment(1),
                availableSeats: FieldValue.increment(-1),
                lastModifiedAt: FieldValue.serverTimestamp()
            });

            // Add customer to subcollection
            const customerRef = firestore
                .collection('dine_in_tabs')
                .doc(tabId)
                .collection('customers')
                .doc();

            transaction.set(customerRef, {
                name: customerName || 'Guest',
                joinedAt: FieldValue.serverTimestamp()
            });
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('[Join Table Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to join table' },
            { status: 500 }
        );
    }
}
