/**
 * GET TABLE STATUS API
 * 
 * Returns current status of a table including:
 * - Active tab info
 * - Occupied/available seats
 * - Current orders
 */

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const restaurantId = searchParams.get('restaurantId');
        const tableId = searchParams.get('tableId');

        if (!restaurantId || !tableId) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();

        // Check for active tab
        const tabsSnapshot = await firestore
            .collection('dine_in_tabs')
            .where('tableId', '==', tableId)
            .where('restaurantId', '==', restaurantId)
            .where('status', '==', 'active')
            .limit(1)
            .get();

        if (tabsSnapshot.empty) {
            return NextResponse.json({
                hasActiveTab: false,
                tableId,
                restaurantId
            });
        }

        const tabDoc = tabsSnapshot.docs[0];
        const tabData = tabDoc.data();

        // Get orders count
        const ordersSnapshot = await firestore
            .collection('dine_in_tabs')
            .doc(tabDoc.id)
            .collection('orders')
            .get();

        return NextResponse.json({
            hasActiveTab: true,
            tabData: {
                id: tabDoc.id,
                tableId: tabData.tableId,
                capacity: tabData.capacity,
                occupiedSeats: tabData.occupiedSeats,
                availableSeats: tabData.availableSeats,
                orderCount: ordersSnapshot.size,
                totalAmount: tabData.totalAmount,
                pendingAmount: tabData.pendingAmount,
                token: tabData.token,
                createdAt: tabData.createdAt,
                status: tabData.status
            }
        });

    } catch (error) {
        console.error('[Get Table Status Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to get table status' },
            { status: 500 }
        );
    }
}
