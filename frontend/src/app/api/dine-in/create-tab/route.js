/**
 * CREATE DINE-IN TAB API
 * 
 * Creates a new dine-in tab with transaction-based atomicity
 * Prevents concurrent tab creation for same table
 * Supports group sizes > 1
 */

import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const {
            restaurantId,
            tableId,
            capacity,
            groupSize = 1,
            customerName
        } = await req.json();

        // Validate inputs
        if (!restaurantId || !tableId || !capacity) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Validate group size
        if (groupSize > capacity) {
            return NextResponse.json(
                { error: 'Group size exceeds table capacity' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();

        // Transaction for atomicity
        const result = await firestore.runTransaction(async (transaction) => {
            // Check for EXISTING active tabs to potentially join
            const tabsRef = firestore.collection('dine_in_tabs');

            // Query ALL tabs for this table to check capacity
            // We need to count seats from all tabs that are NOT 'clean' or 'closed'
            const allTableTabsQuery = tabsRef
                .where('tableId', '==', tableId)
                .where('restaurantId', '==', restaurantId);

            const allTableTabsSnap = await transaction.get(allTableTabsQuery);

            let currentOccupiedSeats = 0;
            let existingActiveTab = null;

            allTableTabsSnap.docs.forEach(doc => {
                const data = doc.data();
                // User requirement: Ignore 'clean' tabs (and assuming 'closed'/'cancelled' meant finished)
                // Count any tab that is still holding the table
                const isOccupied = !['clean', 'closed', 'cancelled'].includes(data.status);

                if (isOccupied) {
                    currentOccupiedSeats += (data.occupiedSeats || 0);
                }

                // Identify if there's a joinable 'active' tab (exact match for rejoin logic)
                if (data.status === 'active') {
                    existingActiveTab = { id: doc.id, ...data };
                }
            });

            // 1. CAPACITY CHECK FIRST (for both new and existing tabs)
            if (currentOccupiedSeats + groupSize > capacity) {
                throw new Error(`Table capacity exceeded. Occupied: ${currentOccupiedSeats}/${capacity}, Requested: ${groupSize}`);
            }

            // 2. REJOIN LOGIC: If active tab exists, update its occupiedSeats atomically
            if (existingActiveTab) {
                const newOccupiedSeats = existingActiveTab.occupiedSeats + groupSize;
                const newAvailableSeats = capacity - newOccupiedSeats;

                // Update the tab atomically in transaction
                const tabDocRef = tabsRef.doc(existingActiveTab.id);
                transaction.update(tabDocRef, {
                    occupiedSeats: newOccupiedSeats,
                    availableSeats: newAvailableSeats,
                    lastModifiedAt: FieldValue.serverTimestamp()
                });

                return {
                    exists: true,
                    joined: true,
                    tabId: existingActiveTab.id,
                    token: existingActiveTab.token,
                    occupiedSeats: newOccupiedSeats,
                    availableSeats: newAvailableSeats,
                    capacity: capacity
                };
            }

            // Create new tab
            const tabId = `tab_${nanoid(12)}`;
            const token = nanoid(32);

            const tabData = {
                restaurantId,
                tableId,
                capacity,
                occupiedSeats: groupSize,
                availableSeats: capacity - groupSize,
                status: 'active',
                token,

                // Amounts (cached - derived from orders)
                totalAmount: 0,
                paidAmount: 0,
                pendingAmount: 0,

                // Timestamps
                createdAt: FieldValue.serverTimestamp(),
                createdBy: customerName || 'Guest',
                lastRecalculatedAt: FieldValue.serverTimestamp(),
                lastModifiedAt: FieldValue.serverTimestamp()
            };

            transaction.set(tabsRef.doc(tabId), tabData);

            return {
                exists: false,
                tabId,
                token,
                occupiedSeats: groupSize,
                availableSeats: capacity - groupSize,
                capacity
            };
        });

        return NextResponse.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('[Create Tab Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create tab' },
            { status: 500 }
        );
    }
}
